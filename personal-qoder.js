import {AIError,createQoderCaller,verifyQoderConfig} from './ai-api.js';

export function normalizePersonalQoder(value,previous=null){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AIError(400,'请填写个人 Qoder 配置。','invalid_credentials');
  const config={key:typeof value.key==='string'&&value.key.trim()?value.key.trim():previous?.key,agentId:String(value.agentId||'').trim(),environmentId:String(value.environmentId||'').trim(),model:String(value.model||'ultimate').trim(),credits:String(value.credits||'10.00').trim()};
  try{createQoderCaller(config);}catch{throw new AIError(400,'请检查 PAT（pt-）、Agent ID（agent_）、环境 ID（env_）、模型和预算。','invalid_credentials');}
  if(Number(config.credits)>10)throw new AIError(400,'单次会话预算应大于 0 且不超过 10 credits。','invalid_credentials');
  return config;
}
export function publicQoderStatus(config){return config?{configured:true,agentId:config.agentId,environmentId:config.environmentId,model:config.model,credits:config.credits}:{configured:false};}
export function createPersonalQoderStore(env,{fetcher=globalThis.fetch}={}){
  const url=env.get('SUPABASE_URL'),key=env.get('SUPABASE_SERVICE_ROLE_KEY');
  async function rpc(action,user,config=null){
    if(!key){throw new AIError(503,'个人配置服务尚未启用，请联系管理员。','credentials_unavailable');}
    try{
      const response=await fetcher(new URL('/rest/v1/rpc/il_personal_qoder',url),{method:'POST',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_user:user,p_config:config}),signal:AbortSignal.timeout(10000)});
      if(!response.ok){await response.body?.cancel();throw Error();}
      return await response.json();
    }catch{throw new AIError(503,'个人配置服务暂不可用，请稍后重试。','credentials_unavailable');}
  }
  return {available:!!key,load:user=>rpc('load',user),save:(user,config)=>rpc('save',user,config),remove:user=>rpc('remove',user)};
}
export async function handlePersonalQoder(body,user,store,{fetcher=globalThis.fetch}={}){
  if(store.available===false)throw new AIError(503,'个人配置服务尚未启用，请联系管理员。','credentials_unavailable');
  if(body.action==='status')return publicQoderStatus(await store.load(user));
  if(body.action==='remove'){await store.remove(user);return {configured:false};}
  if(body.action!=='save')throw new AIError(400,'不支持的配置操作。','invalid_credentials');
  const previous=await store.load(user),config=normalizePersonalQoder(body.config,previous);
  await verifyQoderConfig(config,{fetcher});
  await store.save(user,config);
  return publicQoderStatus(config);
}
