import {initPersonalQoderUI} from './personal-qoder-ui.js?v=20261109-usability-2';
import {CloudClient} from './cloud-client.js';
import {cloudConfig} from './cloud-config.js';
import {cleanSVG} from './catalog-core.js';
import {normalizeSpec,validateGeneratedIcons,normalizeCanvas,canvasDimensions} from './ai-core.js?v=20261109-usability-2';

const $ = id => document.getElementById(id);
const loopback = () => ['127.0.0.1','localhost','[::1]'].includes(window.location.hostname);

async function rasterize(svg) {
  const image = new Image();
  await new Promise((resolve,reject) => {image.onload=resolve;image.onerror=()=>reject(Error('参考图标预览无法生成。'));image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
  const canvas = document.createElement('canvas');
  canvas.width=canvas.height=256;
  const context = canvas.getContext('2d');
  if (!context) throw Error('浏览器无法生成参考图标预览。');
  context.fillStyle='#ffffff';context.fillRect(0,0,256,256);
  const scale=256/Math.max(image.naturalWidth,image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  context.drawImage(image,(256-w)/2,(256-h)/2,w,h);
  return canvas.toDataURL('image/png');
}

export async function prepareReferences(references, render = rasterize) {
  if (!references.length || references.length > 8) throw Error('请上传 1–8 个参考 SVG。');
  return Promise.all(references.map(async reference => {
    const svg=cleanSVG(reference.markup).svg;
    if (svg.length > 65536) throw Error('AI 参考 SVG 最长为 64KB，请先简化。');
    const preview=await render(svg);
    if (preview.length > 180000) throw Error('参考预览过大，请先简化图标。');
    return {name:reference.name,svg,preview,vb:reference.vb,widths:reference.widths,caps:reference.caps,joins:reference.joins,strokes:reference.strokes,fills:reference.fills};
  }));
}

export async function requestAI(body, {transport,fetcher=globalThis.fetch.bind(globalThis)} = {}) {
  let endpoint='/api/icon-ai',client=null,userId=null;
  const headers={'Content-Type':'application/json'};
  if (transport === 'local') {
    if (!loopback()) throw Error('本地接口仅可在 localhost 或 127.0.0.1 使用，请选择云端接口。');
  } else if (transport === 'cloud') {
    let config=cloudConfig;
    try {const saved=JSON.parse(localStorage.getItem('iconlab.cloud.config.v1'));if(saved)config=saved;} catch {throw Error('云端连接配置损坏，请重新设置。');}
    client=new CloudClient(config,{fetcher});
    if (!client.session?.access_token) throw Error('请先通过“云端账号”登录；个人 Qoder 配置在连接设置中填写。');
    if (client.session.expires_at < Date.now()/1000+60) await client.refresh();
    userId=client.session.user?.id;
    endpoint=client.config.url+'/functions/v1/icon-ai';
    headers.apikey=client.config.key;headers.Authorization='Bearer '+client.session.access_token;
  } else throw Error('请选择 AI 接口。');
  let response;
  try {response=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});}
  catch (error) {throw Object.assign(Error(error.name==='TimeoutError'?'模型请求超时。请求可能已发送，请先检查服务任务状态，避免立即重复生成。':'无法连接 AI 服务。请检查网络或服务状态；请求可能已发送，请勿连续重试。'),{code:'connection_uncertain'});}
  let data;try {data=await response.json();} catch {throw Error('AI 接口未返回 JSON，请检查服务部署。');}
  if (!response.ok) throw Object.assign(Error(typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : `AI 请求失败（${response.status}）。`),{status:response.status,code:data?.code});
  if (client) {
    const session=JSON.parse(sessionStorage.getItem(client.storageKey)||'null');
    if (!session?.access_token || session.user?.id !== userId) throw Error('登录账号已变化，已丢弃本次 AI 结果。');
  }
  return data;
}

export function createAIWorkflow({state,getSpec,applySpec,setCandidates,persist,getMode}) {
  let busy=false,revision=0,operation='',phase='';
  const progress=(text)=>{phase=text;update();};
  const recovery=error=>error.status===401?'请打开连接设置，重新登录工作台账号。':error.status===403?'当前账号没有 AI 权限，请联系空间管理员。':error.status===429?'请求过于频繁，请稍后手动重试。':error.code==='connection_uncertain'?'':error.status>=500?'请先检查连接设置和服务状态，再手动重试；已有候选已保留。':'已有候选保留，请检查提示后重试。';
  const referencesKey=()=>JSON.stringify(state.references.map(r=>({name:r.name,markup:r.markup})));
  const signature=()=>JSON.stringify({references:referencesKey(),spec:getSpec()});
  const message=(text,error=false)=>{$('ai-status').textContent=text;$('ai-status').dataset.error=String(error);};
  const update=()=>{
    const record=state.aiSpec;
    let confirmed=false;
    try {confirmed=!!record?.confirmed && record.signature===signature();} catch {}
    $('ai-read').disabled=busy;
    $('ai-confirm').disabled=busy||!record||record.references!==referencesKey();
    $('generate').disabled=busy||!confirmed;
    $('ai-read').textContent=busy&&operation==='analyze'?'正在读取…':'读取参考规范';
    $('ai-confirm').textContent=confirmed?'规范已确认':'确认规范';
    $('generate').textContent=busy&&operation==='generate'?'正在生成…':'生成 3 个候选';
    $('ai-confirm-state').textContent=confirmed?'已确认；可以生成':record?'修改参考或规范后需要重新确认':'请先读取并确认当前参考规范';
    $('ai-progress').textContent=busy?phase||'准备请求':confirmed?'规范已确认':record?.references===referencesKey()?'规范待确认':'参考待分析';$('ai-transport').disabled=busy;
    $('generator-controls').setAttribute('aria-busy',String(busy));
  };
  const consent=()=>{if(!$('ai-consent').checked)throw Error('请先确认允许将参考图标和描述发送到模型服务。');};
  async function run(kind,action) {
    if (busy) return;
    busy=true;operation=kind;phase='准备参考';update();
    try {await action();} catch(error) {message(error.message+' '+recovery(error),true);} finally {busy=false;operation='';phase='';update();}
  }
  async function provider(){
    if($('ai-transport').value==='local'){$('ai-provider-summary').textContent='使用本地服务；模型与费用以本地配置为准。';return;}
    progress('核对云端配置');
    const status=await requestAI({operation:'credentials',action:'status'},{transport:'cloud'});
    $('ai-provider-summary').textContent=status.configured?'使用个人 Qoder · '+status.model+'；额度计入你的账号。':'使用团队接口；额度计入团队配置的服务。';
  }
  const read=()=>run('analyze',async()=>{
    consent();
    const target=normalizeSpec(getSpec()),before=signature(),started=revision;
    await provider();progress('准备参考');message('正在读取显式参数与参考预览…');
    const references=await prepareReferences(state.references);
    progress('等待规范分析');
    const result=await requestAI({operation:'analyze',references,target},{transport:$('ai-transport').value});
    if (started!==revision || before!==signature() || getMode()!=='generate') throw Error('参考或规范已变化，已丢弃读取结果，请重新读取。');
    progress('校验规范');const spec=normalizeSpec(result.spec);
    applySpec(spec);
    state.aiSpec={definition:spec,references:referencesKey(),confirmed:false,model:result.model};
    persist();
    message('规范已读取。请检查右侧图形结构、颜色、留白与风格说明，再确认。');
  });
  const confirm=()=>{
    if (busy) return;
    try {
      if (!state.aiSpec || state.aiSpec.references!==referencesKey()) throw Error('请先对当前参考图标执行 AI 读取。');
      const definition=normalizeSpec(getSpec());
      state.aiSpec={...state.aiSpec,definition,signature:signature(),confirmed:true};
      persist();message('规范已确认。生成结果仍需人工检查语义与视觉一致性。');
    } catch(error) {message(error.message,true);}
    update();
  };
  const generate=()=>run('generate',async()=>{
    consent();
    if (!state.aiSpec?.confirmed || state.aiSpec.signature!==signature()) throw Error('请先读取并确认当前规范。');
    const prompt=$('prompt').value.trim();
    if (!prompt || prompt.length>2000) throw Error('请填写 1–2000 字符的图标描述。');
    const spec=normalizeSpec(state.aiSpec.definition),before=signature(),started=revision;
    await provider();progress('准备参考');message('正在生成 3 个候选并校验；无效结果最多修正一次；等待期间请勿重复提交…');
    const references=await prepareReferences(state.references);
    progress('等待生成服务');
    const result=await requestAI({operation:'generate',references,spec,prompt},{transport:$('ai-transport').value});
    if (started!==revision || before!==signature() || prompt!==$('prompt').value.trim() || getMode()!=='generate') throw Error('输入已变化，已丢弃过期候选，请重新生成。');
    progress('校验候选');const icons=validateGeneratedIcons(result.icons,spec);
    const aiMeta={prompt,model:typeof result.model==='string'?result.model.slice(0,100):'',generatedAt:new Date().toISOString(),references:state.references.map(r=>({name:r.name,markup:r.markup})),spec};
    setCandidates(icons.map(icon=>({...icon,aiMeta})));
    persist();message('3 个候选的结构与图形边界通过。请选择并检查语义，再保存所选图标。');
  });
  $('ai-transport').value=loopback()?'local':'cloud';
  $('ai-transport').querySelector('[value="local"]').disabled=!loopback();
  $('ai-provider-summary').textContent=loopback()?'使用本地服务；模型与费用以本地配置为准。':'云端配置将在请求前核对。';
  $('ai-read').onclick=read;$('ai-confirm').onclick=confirm;
  $('ai-account').onclick=()=>{window.location.hash='account-settings';window.dispatchEvent(new Event('hashchange'));};
  for (const id of ['ai-render-mode','stroke','color','linecap','linejoin','ai-padding','ai-style-notes','ai-canvas-width','ai-canvas-height']) $(id).addEventListener('input',()=>{revision++;try{state.aiCanvas=normalizeCanvas({width:+$('ai-canvas-width').value,height:+$('ai-canvas-height').value});const dims=canvasDimensions(state.aiCanvas);$('target-viewbox-display').textContent=`${dims.width} × ${dims.height}`;$('pixel-width').textContent=Number((state.stroke*24/Math.max(dims.width,dims.height)).toFixed(2));$('stroke').max=Math.min(dims.width,dims.height)/2;$('ai-padding').max=Math.min(dims.width,dims.height)/2;}catch{}state.aiPadding=+$('ai-padding').value;state.aiStyleNotes=$('ai-style-notes').value;update();persist();if(state.aiSpec)message('规范已修改，请重新确认；现有候选保留生成时的规范。');});
  $('prompt').addEventListener('input',()=>{revision++;state.promptDraft=$('prompt').value;persist();});
  window.addEventListener('iconlab:mode',()=>revision++);
  $('ai-transport').onchange=()=>{$('ai-provider-summary').textContent=$('ai-transport').value==='local'?'使用本地服务；模型与费用以本地配置为准。':'云端配置将在请求前核对。';message('接口已切换。个人 Qoder 配置仅用于云端连接。');};
  initPersonalQoderUI({request:requestAI});
  update();
  if(state.aiSpec){
    if(state.aiSpec.references!==referencesKey())message('参考图标已变化，请重新读取规范。');
    else if(state.aiSpec.confirmed&&state.aiSpec.signature===signature())message('规范已确认。填写需求后生成候选。');
    else message('检查右侧规范后确认，再生成候选。');
  }
  return {generate,update,invalidate:(reason)=>{revision++;if(state.aiSpec)state.aiSpec.confirmed=false;update();message(reason==='demo'?'已切换内置演示，未调用 AI。使用当前参考生成前，请重新读取并确认规范。':'参考图标已变化，请重新读取规范。');}};
}
