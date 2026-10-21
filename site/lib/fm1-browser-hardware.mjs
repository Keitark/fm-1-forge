/** Inspect this document's browser APIs and policy without requesting device access. */
const read=(object,key)=>{
  try{return {known:true,value:object==null?undefined:object[key]};}
  catch{return {known:false,value:undefined};}
};
function apiPresence(navigatorValue,feature){
  if(!navigatorValue.known)return {apiAvailable:false,apiStatus:'unknown'};
  const container=feature==='midi'?navigatorValue:read(navigatorValue.value,feature);
  if(!container.known)return {apiAvailable:false,apiStatus:'unknown'};
  const method=read(container.value,{midi:'requestMIDIAccess',serial:'requestPort',usb:'requestDevice'}[feature]);
  if(!method.known)return {apiAvailable:false,apiStatus:'unknown'};
  const apiAvailable=typeof method.value==='function';
  return {apiAvailable,apiStatus:apiAvailable?'present':'absent'};
}
function documentPolicy(documentValue){
  if(!documentValue.known)return {source:'unavailable',value:undefined};
  for(const name of ['permissionsPolicy','featurePolicy']){
    const candidate=read(documentValue.value,name);
    if(!candidate.known)return {source:'unavailable',value:undefined};
    if(candidate.value!=null)return {source:name,value:candidate.value};
  }
  return {source:'unavailable',value:undefined};
}
function policyState(policy,feature){
  const method=read(policy,'allowsFeature');
  if(!method.known||typeof method.value!=='function')return 'unknown';
  try{
    const allowed=Reflect.apply(method.value,policy,[feature]);
    return allowed===true?'allowed':allowed===false?'blocked':'unknown';
  }catch{return 'unknown';}
}
export function browserHardwareCapabilities(runtime=globalThis){
  const secure=read(runtime,'isSecureContext'),navigatorValue=read(runtime,'navigator');
  const policy=documentPolicy(read(runtime,'document'));
  return {schemaVersion:1,secureContext:secure.value===true,
    secureContextKnown:secure.known&&typeof secure.value==='boolean',permissionPolicySource:policy.source,
    ...Object.fromEntries(['midi','serial','usb'].map(feature=>[feature,
      {...apiPresence(navigatorValue,feature),policy:policyState(policy.value,feature)}]))};
}
if(typeof window!=='undefined')window.FM1BrowserHardwareCapabilities=browserHardwareCapabilities;
