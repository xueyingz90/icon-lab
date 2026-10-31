import {TAXONOMY,UNCLASSIFIED} from './taxonomy.js';
// Only publishable / legacy anon keys belong in a browser. Database RLS is mandatory.
export function validateConfig(url, key) {
  let parsed; try {parsed = new URL(url);} catch {throw Error('请填写有效的 Supabase Project URL。');}
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Project URL 应为不带路径的 HTTPS 地址。');
  if (key.startsWith('sb_secret_')) throw Error('不能使用 Secret key；请使用 Publishable key。');
  if (!key.startsWith('sb_publishable_')) {
    try {if (JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role !== 'anon') throw Error();}
    catch {throw Error('请使用 Publishable key，或角色为 anon 的旧公钥。');}
  }
  return {url:parsed.origin, key};
}
export class CloudClient {
  constructor(config, {fetcher = globalThis.fetch.bind(globalThis), storage = sessionStorage} = {}) {
    this.config = validateConfig(config.url, config.key); this.fetcher = fetcher; this.storage = storage;
    this.storageKey = 'iconlab-session:' + this.config.url;
    try {this.session = JSON.parse(storage.getItem(this.storageKey));} catch {this.session = null;}
  }
  setSession(session) {this.session = session; if(session) this.storage.setItem(this.storageKey, JSON.stringify(session)); else this.storage.removeItem(this.storageKey);}
  async request(path, {method = 'GET', body, auth = true} = {}) {
    if (auth && this.session?.expires_at < Date.now() / 1000 + 60) await this.refresh();
    if (auth && !this.session?.access_token) throw Error('请先登录云端账号。');
    const headers = {'apikey':this.config.key, 'Content-Type':'application/json'};
    if (auth) headers.Authorization = 'Bearer ' + this.session.access_token;
    const response = await this.fetcher(this.config.url + path, {method, headers, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(20000)});
    let data; const text = await response.text(); try {data = text ? JSON.parse(text) : null;} catch {throw Error('服务响应异常，请稍后重试。');}
    if (!response.ok) {if (auth && response.status === 401 && this.session?.access_token && headers.Authorization === 'Bearer '+this.session.access_token) this.setSession(null); const error=Error(data?.msg || data?.message || data?.error_description || data?.error || '请求失败，请检查连接。');error.status=response.status;throw error;}
    return data;
  }
  storeTokens(data) {if (data?.access_token) this.setSession({...data, expires_at:data.expires_at || Date.now()/1000 + data.expires_in}); return data;}
  async signIn(email, password) {return this.storeTokens(await this.request('/auth/v1/token?grant_type=password', {method:'POST', body:{email, password}, auth:false}));}
  async signUp(email, password) {return this.storeTokens(await this.request('/auth/v1/signup', {method:'POST', body:{email, password}, auth:false}));}
  async refresh() {
    if (!this.refreshPromise) {
      const previous=this.session;
      this.refreshPromise=this.request('/auth/v1/token?grant_type=refresh_token', {method:'POST', body:{refresh_token:previous?.refresh_token}, auth:false}).then(d=>{
        if(this.session!==previous)throw Error('登录状态已变化，请重试。');
        if(!d?.access_token||!d?.refresh_token||!d?.user?.id)throw Error('登录服务返回异常，请稍后重试。');
        return this.storeTokens(d);
      }).catch(e=>{if(this.session===previous&&[400,401,403].includes(e.status))this.setSession(null);throw e;}).finally(()=>{this.refreshPromise=null;});
    }
    return this.refreshPromise;
  }
  async signOut() {try {await this.request('/auth/v1/logout', {method:'POST'});} finally {this.setSession(null);}}
  rpc(name, body = {}) {return this.request('/rest/v1/rpc/' + name, {method:'POST', body});}
  workspaces() {return this.request('/rest/v1/il_workspaces?select=id,name,owner_id&order=created_at.asc');}
  async role(workspaceId, userId) {const rows=await this.request('/rest/v1/il_members?select=role&workspace_id=eq.' + encodeURIComponent(workspaceId) + '&user_id=eq.' + encodeURIComponent(userId)); return rows[0]?.role || 'viewer';}
  assets(workspaceId) {return this.request('/rest/v1/il_assets?select=*&workspace_id=eq.' + encodeURIComponent(workspaceId) + '&order=updated_at.desc&limit=501');}
  revisions(assetId) {return this.request('/rest/v1/il_revisions?select=*&asset_id=eq.' + encodeURIComponent(assetId) + '&order=version.desc&limit=100');}
  standards(workspaceId) {return this.request('/rest/v1/il_standards?select=*&workspace_id=eq.'+encodeURIComponent(workspaceId)+'&order=platform.asc');}
  searchAssets(workspaceId,{name='',structure='',visual_style='',color_mode='',target_platform='',offset=0,limit=40}={}) {
    if(!workspaceId)throw Error('请先选择工作空间。');
    const query=new URLSearchParams({select:'*',workspace_id:'eq.'+workspaceId,order:'updated_at.desc,id.desc',limit:String(Math.min(100,Math.max(1,limit))),offset:String(Math.max(0,offset))});
    const text=String(name).trim().slice(0,100);if(text)query.set('name','ilike.%'+text.replace(/[\\%_*]/g,'\\$&')+'%');
    for(const [key,value] of Object.entries({structure,visual_style,color_mode,target_platform})){
      if(!value)continue;if(value===UNCLASSIFIED)query.set(key,'is.null');
      else if(TAXONOMY[key].some(([v])=>v===value))query.set(key,'eq.'+value);else throw Error('筛选条件无效。');
    }
    return this.request('/rest/v1/il_assets?'+query.toString());
  }
}
