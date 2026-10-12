// The native panel holds metadata only. Package selection happens on the laptop.
export const libraryHtml = `<section class="local-library" aria-labelledby="apps-library-title"><div class="library-toolbar"><div><div class="eyebrow">Your saved app sets</div><h2 id="apps-library-title">Apps library</h2><p class="muted">Add exported FM1 app bundles from your laptop.</p></div><div class="library-buttons"><button class="primary" id="library-add" disabled>Add local set</button><button class="secondary" id="library-refresh">Refresh library</button></div></div><div class="library-filter"><label for="library-set">Show set</label><select id="library-set"><option value="">All packages</option></select></div><div id="library-sets" class="library-sets"></div><p id="library-status" class="note" role="status" aria-live="polite">Package files stay on your laptop. Adding a set does not transfer firmware.</p></section>`;
export const libraryCss = `.local-library{background:var(--header);border:1px solid var(--line);border-radius:13px;padding:20px;margin:22px 0}.library-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px}.library-toolbar h2{font-size:23px;margin:5px 0}.library-toolbar p{font-size:13px}.library-buttons{display:flex;flex-wrap:wrap;gap:8px}.library-filter{display:block;max-width:340px;margin:18px 0 12px;font-size:12px;color:var(--muted)}.library-filter select{margin-top:5px}.library-sets{display:flex;flex-wrap:wrap;gap:8px}.library-set-card{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:10px 13px;text-align:left;min-width:140px;max-width:100%;overflow-wrap:anywhere}.library-set-card[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.library-set-card strong{display:block;font-size:13px}.library-set-card span{font-size:11px;color:var(--muted)}@media(max-width:680px){.library-toolbar{align-items:flex-start;flex-direction:column}.library-buttons{width:100%}.library-buttons button{flex:1}.library-filter{max-width:none}}`;

// Serialize one scope so production minification keeps helper names and callers together.
export function createLibraryEngine() {
  function librarySets(catalog) {
    // Treat relay metadata as untrusted; a saved set cannot invent package IDs.
    const apps=Array.isArray(catalog?.apps)?catalog.apps:[];
    const variants = new Map(apps.flatMap(app => (Array.isArray(app?.variants)?app.variants:[]).filter(v=>v&&typeof v.id==='string').map(v => [v.id, v])));
    return (Array.isArray(catalog?.sets) ? catalog.sets : []).filter(set =>
      typeof set?.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(set.id) &&
      typeof set.name === 'string' && set.name.length > 0 && set.name.length <= 80 &&
      Array.isArray(set.members) && set.members.length > 0 && set.members.length <= 8 &&
      new Set(set.members.map(member => member?.id)).size === set.members.length &&
      set.members.every(member => member && typeof member.id==='string' && typeof member.sha256==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(member.id) &&
        /^[a-f0-9]{64}$/.test(member.sha256) && variants.get(member.id)?.sha256 === member.sha256));
  }
  function filterLibrary(catalog, setId) {
    const set = librarySets(catalog).find(item => item.id === setId);
    if (!set) return catalog?.apps || [];
    const ids = new Set(set.members.map(member => member.id));
    return (catalog?.apps || []).map(app => ({...app, variants:(app.variants || []).filter(v => ids.has(v.id))})).filter(app => app.variants.length);
  }

  function libraryController({el, call, snapshot, getState, render, signal, pause, now=()=>Date.now()}) {
    let busy=false, launchId=null, catalogId=null, watchingUntil=0, closed=false, watching=false;
    const status=message=>{el('library-status').textContent=message;};
    const availability=()=>{el('library-add').disabled=busy||!getState().relay?.connected;el('library-refresh').disabled=busy||!getState().relay?.connected;};
    const validId=id=>typeof id==='string' && /^[a-f0-9]{32}$/.test(id);
    async function delivery(id) {
      if (!validId(id)) throw new Error('The library did not return a saved request ID.');
      for (let attempt=0;attempt<12&&!closed;attempt++) {
        const result=await call('get_fm1_request',{request_id:id},signal);
        if (!['pending','dispatched'].includes(result.state)) {
          if (result.state!=='succeeded') {const error=new Error((result.error||'Library request needs inspection.')+' Saved request: '+id);error.deliveryState=result.state;throw error;}
          return result.data;
        }
        if (!await pause(1000,signal)) return null;
      }
      return null;
    }
    function paint() {
      const state=getState(), sets=librarySets(state.catalog), filter=el('library-set'), previous=filter.value;
      const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      filter.innerHTML='<option value="">All packages</option>'+sets.map(set=>'<option value="'+esc(set.id)+'">'+esc(set.name)+'</option>').join('');
      filter.value=sets.some(set=>set.id===previous)?previous:'';
      el('library-sets').innerHTML=sets.length?sets.map(set=>'<button class="library-set-card" data-library-set="'+esc(set.id)+'" aria-pressed="'+(set.id===filter.value)+'"><strong>'+esc(set.name)+'</strong><span>'+set.members.length+' package'+(set.members.length===1?'':'s')+' · Saved locally</span></button>').join(''):'<p class="note">No local sets yet. Existing packages remain available below.</p>';
      el('library-sets').querySelectorAll('[data-library-set]').forEach(button=>{button.onclick=()=>{filter.value=button.dataset.librarySet;render();};});
      availability();
      el('library-add').textContent=launchId?'Check saved importer request':'Add local set';
    }
    async function refresh({automatic=false}={}) {
      if (busy||closed||!getState().relay?.connected) return;
      busy=true;paint();
      try {
        if (!catalogId) {const queued=await call('list_fm1_apps',{},signal);catalogId=queued.request_id;}
        const result=await delivery(catalogId);
        if (!result) {if(!automatic)status('Waiting for library metadata. Saved request: '+catalogId);return;}
        catalogId=null;
        await snapshot();
        if (!automatic) status('Library refreshed. '+librarySets(getState().catalog).length+' local set(s).');
      } catch(error) {if(error.deliveryState==='failed')catalogId=null;status(error.message||'Library refresh stopped.');}
      finally {busy=false;paint();}
    }
    async function add() {
      if (busy||closed||!getState().relay?.connected) return;
      busy=true;paint();
      try {
        if (!launchId) {
          status('Opening the local importer on your laptop…');
          const queued=await call('open_fm1_local_import',{},signal);
          if(!validId(queued.request_id))throw new Error('The importer did not return a saved request ID.');
          launchId=queued.request_id;
        }
        const result=await delivery(launchId);
        if(!result){status('Waiting for the local importer. Check saved request '+launchId+' to resume without reopening it.');return;}
        launchId=null;
        if(result?.opened!==true)throw new Error('The laptop could not open the local importer.');
        watchingUntil=now()+300000;
        status('Choose a folder or bundle files in the local importer, then add the set. This library refreshes while you import.');
        void watch();
      } catch(error) {if(error.deliveryState==='failed')launchId=null;const message=error.message||'The local importer is unavailable.';status(message+(/unknown tool|tool.*not.*(found|allowed)|unauthorized.*tool/i.test(message)?' Reconnect FM1 Forge to refresh its tool catalog.':''));}
      finally {busy=false;paint();}
    }
    async function watch() {
      if(watching)return;
      watching=true;
      try{while(!closed&&now()<watchingUntil) {
        if(!await pause(5000,signal))return;
        if(typeof document==='undefined'||(!document.hidden&&window.navigator?.onLine!==false)) await refresh({automatic:true});
      }}finally{watching=false;}
    }
    el('library-set').onchange=()=>render();
    el('library-add').onclick=()=>{void add();};
    el('library-refresh').onclick=()=>{void refresh();};
    return {paint,availability,refresh,close(){closed=true;}};
  }
  return {librarySets,filterLibrary,mount:libraryController};
}

export const {librarySets,filterLibrary,mount:libraryController}=createLibraryEngine();
export const libraryRuntime = `window.FM1Library=(${createLibraryEngine.toString()})();`;
