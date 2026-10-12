import { PublicError } from './fm1-contract.mjs';

const names=['SELECT','ALGORITHM','KNOB1','KNOB2','KNOB3','KNOB4','PRESETS'];
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uint=value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;
const exact=(value,fields)=>object(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const mask=value=>typeof value==='string'&&/^[0-9a-f]{16}$/.test(value)&&BigInt('0x'+value)<(1n<<41n);

/** Accept only the fixed input metadata contract; never store serial transcripts. */
export function inputSample(value){
  const fail=()=>{throw new PublicError('Invalid hardware input sample.');};
  if(!exact(value,['state','firmware','port','capabilities','keys','encoders','volume','observation','message']))fail();
  if(!['available','unsupported','unavailable','busy'].includes(value.state))fail();
  if(value.firmware!==null&&!['FM1-FORGE/1','MOD-EDITOR/1'].includes(value.firmware))fail();
  if(value.port!==null&&(typeof value.port!=='string'||!/^COM[1-9][0-9]{0,3}$/.test(value.port)))fail();
  if(typeof value.message!=='string'||value.message.length>250||/(?:[a-z]:[\\/]|\\\\|Bearer\s)/i.test(value.message))fail();
  const caps=value.capabilities;
  if(!exact(caps,['keys','encoders','volume'])||Object.values(caps).some(item=>typeof item!=='boolean'))fail();
  const observation=value.observation;
  if(!exact(observation,['started_at','completed_at'])||![observation.started_at,observation.completed_at].every(item=>Number.isSafeInteger(item)&&item>0)||observation.started_at>observation.completed_at||observation.completed_at-observation.started_at>3)fail();
  if(caps.keys){
    const keys=value.keys;
    if(value.firmware!=='FM1-FORGE/1'||!exact(keys,['pressed','seen','scans','errors'])||!mask(keys.pressed)||!mask(keys.seen)||!uint(keys.scans)||!uint(keys.errors))fail();
  }else if(value.keys!==null)fail();
  if(caps.encoders){
    if(value.firmware!=='FM1-FORGE/1'||!Array.isArray(value.encoders)||value.encoders.length!==7)fail();
    value.encoders.forEach((knob,id)=>{if(!exact(knob,['id','name','edges','invalid','seen'])||knob.id!==id||knob.name!==names[id]||!Number.isInteger(knob.edges)||knob.edges< -2147483648||knob.edges>2147483647||!uint(knob.invalid)||typeof knob.seen!=='boolean')fail();});
  }else if(value.encoders!==null)fail();
  if(caps.volume){
    const volume=value.volume;
    if(value.firmware===null||!exact(volume,['value','gain','valid','samples','errors'])||!Number.isInteger(volume.value)||volume.value<0||volume.value>1023||!Number.isInteger(volume.gain)||volume.gain<0||volume.gain>127||typeof volume.valid!=='boolean'||!uint(volume.samples)||!uint(volume.errors))fail();
  }else if(value.volume!==null)fail();
  if(value.state==='available'&&(!caps.keys||!caps.encoders||!caps.volume))fail();
  if(value.state==='unsupported'&&(caps.keys||caps.encoders))fail();
  if(['unavailable','busy'].includes(value.state)&&Object.values(caps).some(Boolean))fail();
  return structuredClone(value);
}

/** Queue age never renews a replay; source time and first Site receipt must agree. */
export function inputActivity(row,connection,instant){
  const activity={sample:null,state:'unavailable',observed_at:null,age_seconds:null,max_age_seconds:15,request_id:row?.id||null};
  if(!row?.result)return activity;
  const saved=JSON.parse(row.result);
  if(row.state!=='succeeded'||saved.status!=='succeeded')return {...activity,state:'error'};
  let sample;try{sample=inputSample(saved.data);}catch{return {...activity,state:'error'};}
  const received=saved._site_input_observed_at,start=sample.observation.started_at,end=sample.observation.completed_at;
  const valid=Number.isSafeInteger(received)&&received>0&&Number.isSafeInteger(row.created)&&row.created>0&&row.created<=start&&start<=end&&end<=received&&received<=instant;
  const age=valid?Math.max(instant-start,instant-received):null;
  return {...activity,sample,state:valid&&age<=15&&connection.connected?'fresh':'stale',observed_at:Number.isSafeInteger(received)?received:null,age_seconds:age};
}
