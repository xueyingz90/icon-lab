import {CloudClient} from '../../cloud-client.js';
import {cloudConfig} from '../../cloud-config.js';
import {cleanSVG} from '../../catalog-core.js';
import {prepareSelection, syncSelection, memoryStorage, syncError} from './sync-core.js';
import {populateClassificationSelect} from '../../taxonomy.js';
import {createPluginLibrary} from './library.js';
import {createRememberedSession} from './session.js';

const BRIDGE_ID = "__ICONLAB_BRIDGE_ID__";
const $=id=>document.getElementById(id);
const client=new CloudClient(cloudConfig,{storage:memoryStorage()});
const model={selection:null,spaces:[],workspace:'',role:'viewer',busy:false,pending:null,accountAction:'',starting:true,wasLogged:null};
const verifications=new Map();let requestCounter=0;
let readTimer;
const send=message=>parent.postMessage({pluginMessage:{...message,bridgeId:BRIDGE_ID}},'*');
for(const [key,id] of [['structure','upload-structure'],['visual_style','upload-style'],['color_mode','upload-color-mode'],['target_platform','upload-platform']])populateClassificationSelect($(id),key);
const library=createPluginLibrary({client,context:()=>({workspace:model.workspace}),send,onSessionExpired:()=>{model.spaces=[];model.workspace='';model.role='viewer';clearPending();controls();}});
const remembered=createRememberedSession({client,send,onChange:({remember})=>{
  $('remember-session').checked=remember;
  if(!client.session){model.spaces=[];model.workspace='';model.role='viewer';clearPending();}
  controls();library.contextChanged();
},onStatus:(text,retry)=>{$('session-status').textContent=text;$('session-retry').hidden=!retry;if(retry)showAccount(true);}});
function message(text,tone='info') {$('message').textContent=text;$('message').dataset.tone=tone;$('message').hidden=!text;}
function showAccount(open){$('account-settings').hidden=!open;$('account-toggle').setAttribute('aria-expanded',String(open));}
function accountMessage(text,tone='info') {const notice=$('account-message');notice.textContent=text;notice.dataset.tone=tone;notice.hidden=!text;notice.setAttribute('role',tone==='error'?'alert':'status');if(tone==='error')showAccount(true);}
function accountError(error){
  const text=error?.message||String(error);
  if(/Invalid login credentials|invalid_credentials/i.test(text))return '邮箱或密码不正确，请检查后重试。请使用 Icon Lab 工作台账号。';
  if(/Email not confirmed/i.test(text))return '邮箱尚未确认，请先打开注册确认邮件。';
  if(error?.status===429||/rate limit|too many requests/i.test(text))return '登录尝试过于频繁，请稍后再试。';
  if(error?.name==='TimeoutError'||/timeout|timed out|aborted/i.test(text))return '登录连接超时，请检查网络后重试。';
  if(/Failed to fetch|NetworkError|Network unavailable|Load failed|fetch failed/i.test(text))return '无法连接资产库，请检查网络或代理后重试。';
  if(error?.status>=500)return '登录服务暂时不可用，请稍后重试。';
  return syncError(error);
}
function clearPending() {model.pending=null;$('duplicate').hidden=true;}
function watchRead() {
  clearTimeout(readTimer);
  readTimer=setTimeout(()=>{
    if(model.selection)return;
    $('selection-error').textContent='未收到图标读取结果。请点击“重新读取”；若仍无响应，请关闭插件并重新运行当前修复版本。';
    $('preview').textContent='暂未读取到图标';controls();
  },10000);
}
function requestCapture(type='capture') {watchRead();send({type});}
function controls() {
  const logged=!!client.session?.access_token;
  if(!model.starting){if(!logged&&model.wasLogged!==false){showAccount(true);if(model.wasLogged===true)accountMessage('登录已失效或已退出，请重新登录。');}model.wasLogged=logged;}
  $('workspace-picker').hidden=!logged||!model.workspace;
  $('workspace-status').hidden=logged&&!!model.workspace;
  $('workspace-status').textContent=model.starting?'正在恢复登录…':logged?'正在加载空间…':model.busy&&model.accountAction==='login'?'正在登录…':'未登录';
  $('compact-role').hidden=!logged||!model.workspace||model.role!=='viewer';
  $('account-toggle').title=logged?'账号设置：'+(client.session.user?.email||''):'登录与账号设置';
  $('account-close').disabled=model.busy;
  $('login-form').hidden=logged;$('account').hidden=!logged;
  $('account-email').textContent=client.session?.user?.email || '';
  $('role').textContent=model.role==='viewer'?'只读 · 可查看，不能同步':model.role==='owner'?'空间所有者 · 可同步':'编辑成员 · 可同步';
  $('login').disabled=model.busy||remembered.state().initializing;
  $('login').textContent=model.busy&&model.accountAction==='login'?'正在登录…':'登录';
  $('login-form').setAttribute('aria-busy',String(model.busy&&model.accountAction==='login'));
  $('remember-session').disabled=model.busy||remembered.state().initializing;
  $('session-retry').disabled=model.busy;
  ['logout','workspace','reload-spaces','read'].forEach(id=>$(id).disabled=model.busy);
  document.querySelectorAll('#asset-form input,#asset-form select,#asset-form textarea').forEach(n=>n.disabled=model.busy);
  const reason=model.busy?'正在处理，请稍候。':!logged?'请先在上方登录资产库。':!model.selection?'请选中图标并点击“重新读取”，出现预览后才能同步。':!model.workspace?'请选择目标工作空间。':model.role==='viewer'?'当前空间为只读，需要空间所有者授予编辑权限。':!$('name').value.trim()?'请填写图标名称。':!$('asset-form').elements.namedItem('state_name').value.trim()?'请填写图标状态。':!$('source').value.trim()?'请填写当前 Figma 文件链接。':model.pending?'已发现已有资产，请在上方确认更新或取消。':'';
  $('sync').disabled=!!reason;
  $('sync-hint').textContent=reason || '预览已就绪，将同步到当前选中的工作空间。';
  $('update').disabled=model.busy || !logged || model.role==='viewer' || !model.pending;
  $('cancel-update').disabled=model.busy;
}
async function task(action,{account=false,progress='',name=''}={}) {
  if(model.busy)return;
  model.busy=true;model.accountAction=account?name:'';if(account)accountMessage(progress);else message('');controls();
  try {await action();}catch(e){if(/版本已变化/.test(e.message || ''))clearPending();if(account)accountMessage(accountError(e),'error');else message(syncError(e),'error');}
  finally {model.busy=false;model.accountAction='';if(!client.session){model.spaces=[];model.workspace='';model.role='viewer';clearPending();}controls();library.contextChanged();}
}
async function chooseSpace() {
  clearPending();model.workspace=$('workspace').value;
  model.role=model.workspace?await client.role(model.workspace,client.session.user.id):'viewer';
  library.contextChanged();
}
async function loadSpaces() {
  model.spaces=await client.workspaces();
  if(!model.spaces.length){await client.rpc('il_create_workspace',{p_name:'我的图标库'});model.spaces=await client.workspaces();}
  const current=model.spaces.find(s=>s.id===model.workspace)?.id || model.spaces[0]?.id || '';
  $('workspace').replaceChildren(...model.spaces.map(space=>{const n=document.createElement('option');n.value=space.id;n.textContent=space.name;return n;}));
  $('workspace').value=current;await chooseSpace();
  if(!current)throw Error('没有可用工作空间，请先在工作台创建空间。');
}
function acceptSelection(selection,preserveFields=false) {
  clearPending();model.selection=null;
  try {
    const info=cleanSVG(selection.svg);
    model.selection={...selection,svg:info.svg};
    const img=document.createElement('img');img.alt=selection.name || '图标预览';img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(info.svg);$('preview').replaceChildren(img);
    $('selection-name').textContent=selection.name || '未命名图标';
    $('selection-meta').textContent=`${info.width} × ${info.height} · 节点 ${selection.nodeId}`;
    $('selection-error').textContent='';
    if(!preserveFields){$('name').value=(selection.name || '').slice(0,100);const f=$('asset-form').elements;f.namedItem('tags').value='';f.namedItem('note').value='';f.namedItem('state_name').value='默认';}
    if(selection.fileKey){$('source').value='https://www.figma.com/design/'+selection.fileKey+'/Icon-Lab';}
  }catch(e){$('preview').textContent='此图标暂不支持同步';$('selection-error').textContent=syncError(e);}
  controls();
}
function verifySelection(selection) {
  const requestId='verify-'+(++requestCounter);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{verifications.delete(requestId);reject(Error('读取确认超时，请重新读取后再同步。'));},15000);
    verifications.set(requestId,{resolve,reject,timer});
    send({type:'verify',requestId,nodeId:selection.nodeId,token:selection.token});
  });
}
async function submit(selection,fields,previous=null) {
  if(!client.session || !model.workspace || model.role==='viewer')throw Error('请登录并选择具有编辑权限的工作空间。');
  if(!selection)throw Error('请先读取一个图标。');
  const prepared=prepareSelection(selection,fields);
  const workspace=model.workspace;
  const verified=await verifySelection(selection);
  if(model.selection?.token!==selection.token)throw Error('选区已变化，请检查新预览后重试。');
  if(cleanSVG(verified.svg).svg!==prepared.svg){acceptSelection({...selection,...verified},true);throw Error('图标已变化。预览已更新，请检查后再次确认同步。');}
  const result=await syncSelection(client,workspace,prepared,previous);
  if(!result?.asset?.id || !['created','updated','unchanged','duplicate'].includes(result.result))throw Error('同步返回结果异常，请到工作台刷新核对。');
  const sameSelection=model.selection?.token===selection.token;
  clearPending();
  if(result.result==='duplicate'){
    if(!sameSelection){message('刚才预览的图标已有资产。选区已变化，请重新确认后再更新。');return;}
    model.pending={asset:result.asset,token:selection.token};
    $('duplicate-description').textContent=`${result.asset.name} · v${result.asset.version}\n同一来源或相同内容已登记，尚未覆盖。\n原状态：${result.asset.state_name || '未填写'} · ${result.asset.platform || '未填写'} · ${result.asset.visual_type || '未填写'}\n原来源：${result.asset.source_url || '未记录'}`;
    $('duplicate').hidden=false;message('请核对已有资产，再决定是否更新。');return;
  }
  const status=result.result==='unchanged'?'内容与记录一致，未新增版本':result.result==='updated'?'已更新，旧版本已保留':'已保存到云端资产库';
  message(`${result.asset.name} · v${result.asset.version}\n${status}。请在工作台刷新查看。`+(sameSelection?'':'\n已同步刚才确认的预览；当前选区尚未同步。'),'success');
}
function queueSync(previous=null) {
  if(!$('asset-form').reportValidity())return;
  // FormData excludes disabled fields: snapshot before task() locks the form.
  const fields=Object.fromEntries(new FormData($('asset-form')));
  const selection=model.selection;
  task(()=>submit(selection,fields,previous));
}
window.addEventListener('message',event=>{
  // Figma relays do not guarantee event.source === parent. Match the current
  // plugin runtime's bridge ID instead of depending on Window identity.
  const data=event.data?.pluginMessage;
  if(!data || typeof data!=='object' || data.bridgeId!==BRIDGE_ID || !['selection-loading','selection','selection-error','verified','verify-error','insert-result','session-result'].includes(data.type))return;
  if(data.type==='session-result'){remembered.handleMessage(data);return;}
  if(data.type==='insert-result'){library.handleMessage(data);return;}
  if(data.type==='selection-loading'){
    watchRead();
    model.selection=null;clearPending();$('preview').textContent='正在读取所选图标…';$('selection-name').textContent='正在读取';$('selection-meta').textContent='';$('selection-error').textContent='';message('');controls();
  }
  if(data.type==='selection'){clearTimeout(readTimer);acceptSelection(data.selection);}
  if(data.type==='selection-error'){
    clearTimeout(readTimer);
    model.selection=null;clearPending();$('preview').textContent='请选中一个图标';$('selection-name').textContent='尚未读取图标';$('selection-error').textContent=data.message;controls();
  }
  if(data.type==='verified' || data.type==='verify-error'){
    const pending=verifications.get(data.requestId);if(!pending)return;
    clearTimeout(pending.timer);verifications.delete(data.requestId);
    if(data.type==='verify-error')pending.reject(Error(data.message));else pending.resolve(data.selection);
  }
});
$('login-form').onsubmit=event=>{event.preventDefault();if(!$('login-form').reportValidity()){accountMessage('请检查邮箱格式，并填写至少 8 位密码。','error');return;}task(async()=>{
  await client.signIn($('email').value.trim(),$('password').value);
  $('password').value='';accountMessage('登录成功，正在保存登录状态…');await remembered.commitLogin();accountMessage('登录成功，正在加载工作空间…');await loadSpaces();await remembered.flush();accountMessage(model.role==='viewer'?'已登录。当前空间为只读，可从资源库插入图标。':'已登录，可以上传图标或调用资源库。','success');showAccount(false);
},{account:true,progress:'正在连接资产库，请稍候…',name:'login'});};
$('remember-session').onchange=()=>{const remember=$('remember-session').checked;task(()=>remembered.setRemember(remember),{account:true});};
async function restoreLogin(){if(await remembered.restore()){accountMessage('已恢复登录，正在加载工作空间…');await loadSpaces();accountMessage('已恢复登录，可以上传或从资源库插入图标。','success');showAccount(false);}}
$('account-toggle').onclick=()=>showAccount($('account-settings').hidden);
$('account-close').onclick=()=>showAccount(false);
$('session-retry').onclick=()=>task(restoreLogin,{account:true});
$('logout').onclick=()=>task(async()=>{await remembered.setRemember(false).catch(()=>{});try{await client.request('/auth/v1/logout?scope=local',{method:'POST'});}finally{client.setSession(null);$('password').value='';clearPending();await remembered.flush();}accountMessage('已退出，已清除本机保存的登录。');},{account:true,progress:'正在退出并清除本机登录…'});
$('workspace').onchange=()=>task(chooseSpace,{account:true});
$('reload-spaces').onclick=()=>task(loadSpaces,{account:true,progress:'正在刷新工作空间…'});
$('read').onclick=()=>requestCapture();
$('preview-background').onclick=()=>{
  const dark=$('preview').dataset.background!=='dark';
  $('preview').dataset.background=dark?'dark':'light';
  $('preview-background').textContent=dark?'浅色底':'深色底';
  $('preview-background').setAttribute('aria-pressed',String(dark));
};
$('open-workbench').onclick=()=>send({type:'open-workbench'});
$('asset-form').addEventListener('input',()=>{clearPending();controls();});
$('asset-form').addEventListener('change',()=>{clearPending();controls();});
$('asset-form').onsubmit=event=>{event.preventDefault();queueSync();};
$('update').onclick=()=>{const pending=model.pending;
  if(!pending || pending.token!==model.selection?.token){message('预览已变化，请重新同步检查。','error');return;}
  queueSync(pending.asset);
};
$('cancel-update').onclick=()=>{clearPending();message('已取消更新。可修改图标状态后重新同步。');controls();};
controls();requestCapture('ready');task(restoreLogin,{account:true}).finally(()=>{model.starting=false;controls();});
