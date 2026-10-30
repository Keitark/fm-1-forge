import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Exercise the actual generated schema and SQL, rather than mocking query strings.
export function database() {
  const sqlite=new DatabaseSync(':memory:');
  const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const entry of journal.entries)sqlite.exec(readFileSync(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
  const DB={sqlite,prepare(sql){let args=[];return {
    bind(...values){args=values;return this;},
    async first(){return sqlite.prepare(sql).get(...args)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};},
  };},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  return {DB,FM1_RELAY_TOKEN:'test-only-relay-token-'.repeat(3),SITE_ORIGIN:'https://fm1.test'};
}
export const seconds=()=>Math.floor(Date.now()/1000);
export const digest='a'.repeat(64);
export const catalog={apps:[{profile:'nes',title:'NES',variants:[{id:'nes-test',title:'Synthetic NES test',variant:'test',sha256:digest,ready:true}]}]};
export function connect(env,allow=true,official=false,stock=false){env.DB.sqlite.prepare("INSERT OR REPLACE INTO relay_state(id,last_seen,allow_switch,allow_official_update,allow_stock_update) VALUES('bench',?,?,?,?)").run(seconds(),Number(allow),Number(official),Number(stock));}
export function cacheCatalog(env,owner='alice',value=catalog){env.DB.sqlite.prepare('INSERT OR REPLACE INTO relay_tasks(id,user_id,operation,arguments,state,result,created,dispatched) VALUES(?,?,?,?,?,?,?,?)').run('c'.repeat(32),owner,'catalog','{}','succeeded',JSON.stringify({status:'succeeded',data:value}),seconds(),seconds());}
export function cacheInventory(env,owner='alice',value={device:{update_mode:{mode:'serial',app_entry_method:'serial'},official_update:{configured:true,available:true,sha256:digest}}},{observedAt=seconds()}={}){env.DB.sqlite.prepare('INSERT OR REPLACE INTO relay_tasks(id,user_id,operation,arguments,state,result,created,dispatched) VALUES(?,?,?,?,?,?,?,?)').run('d'.repeat(32),owner,'status','{}','succeeded',JSON.stringify({status:'succeeded',data:value,...(observedAt===null?{}:{_site_inventory_observed_at:observedAt})}),seconds(),seconds());}
