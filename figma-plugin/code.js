// Native Figma bridge: fixed endpoint, bounded selection, no provider secrets.
function createPluginAIHost({figma,post}){
  let epoch=0,snapshot=null,requesting=false,page=null,pageHandler=null,changeTimer;
  const endpoint='https://blolhaacvmciirmiovdo.supabase.co/functions/v1/icon-ai-figma';
  const errorText=e=>e?.message||'AI 操作失败，请重试。';
  function invalidate(){epoch++;snapshot=null;post({type:'ai-invalidated'});}
  function factsFor(root){
    const nodes=[],ids=new Set(),widths=new Set(),caps=new Set(),joins=new Set(),colors=new Set(),fills=new Set(),warnings=new Set();
    function visit(n){
      if(n.visible===false)return;
      if(nodes.length>=200)throw Error('选区过于复杂，请选择单个图标画板（最多 200 个可见图层）。');
      nodes.push(n);ids.add(n.id);
      if(n.type==='TEXT')throw Error('参考中包含文本，请选择单个纯图形图标画板。');
      if(n.type!=='FRAME'&&n.type!=='COMPONENT'&&n.type!=='INSTANCE'&&Array.isArray(n.fills))for(const paint of n.fills){if(paint.visible===false)continue;if(paint.type==='SOLID')fills.add(hex(paint.color));else warnings.add('存在非纯色填充');}
      const strokes=Array.isArray(n.strokes)?n.strokes.filter(p=>p.visible!==false):[];
      if(strokes.length){
        if(typeof n.strokeWeight==='number'&&n.strokeWeight>0)widths.add(n.strokeWeight);else warnings.add('描边宽度混用或无法读取');
        if(typeof n.strokeCap==='string'&&['ROUND','NONE','SQUARE'].includes(n.strokeCap))caps.add(n.strokeCap==='NONE'?'butt':n.strokeCap.toLowerCase());else warnings.add('描边端点需确认');
        if(typeof n.strokeJoin==='string')joins.add(n.strokeJoin.toLowerCase());
        if(n.strokeAlign&&n.strokeAlign!=='CENTER')warnings.add('存在内侧或外侧描边，生成目标使用中心描边');
        for(const paint of strokes){if(paint.type==='SOLID'){colors.add(hex(paint.color));if((paint.opacity??1)!==1)warnings.add('存在透明描边');}else warnings.add('存在非纯色描边');}
      }
      if(typeof n.opacity==='number'&&n.opacity!==1)warnings.add('存在图层透明度');
      if(n.effects?.some(e=>e.visible!==false))warnings.add('存在效果，当前生成仅支持单色线性');
      if(Array.isArray(n.children))n.children.forEach(visit);
    }
    visit(root);
    return {data:{width:root.width,height:root.height,widths:[...widths].sort(),caps:[...caps].sort(),joins:[...joins].sort(),colors:[...colors].sort(),fills:[...fills].sort(),warnings:[...warnings].sort(),layers:nodes.length},ids};
  }
  function hex(c){if(!c||![c.r,c.g,c.b].every(Number.isFinite))throw Error('参考颜色无效。');return '#'+[c.r,c.g,c.b].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');}
  function selected(){
    const nodes=figma.currentPage.selection;
    if(nodes.length!==1||!['FRAME','COMPONENT','INSTANCE'].includes(nodes[0].type))throw Error('请选中一个图标 Frame、Component 或 Instance。');
    const n=nodes[0];if(n.visible===false||![n.width,n.height].every(v=>Number.isFinite(v)&&v>=1&&v<=4096))throw Error('参考宽高应为 1–4096。请选择单个图标画板。');
    return n;
  }
  const svgSettings={format:'SVG_STRING',svgOutlineText:true,svgIdAttribute:false,svgSimplifyStroke:true};
  async function verify(s){
    if(!s||snapshot!==s||s.epoch!==epoch||s.node.removed||selected().id!==s.node.id)throw Error('参考选区已变化，请重新读取并确认。');
    const facts=factsFor(s.node).data,svg=await s.node.exportAsync(svgSettings);
    if(snapshot!==s||s.epoch!==epoch||svg!==s.svg||JSON.stringify(facts)!==s.factsKey)throw Error('参考图层内容已变化，请重新读取并确认。');
  }
  async function capture(m){
    const started=++epoch;snapshot=null;
    try{
      const node=selected(),facts=factsFor(node),factsKey=JSON.stringify(facts.data),svg=await node.exportAsync(svgSettings);
      if(typeof svg!=='string'||svg.length>65536)throw Error('AI 参考 SVG 超过 64KB，请简化图标。');
      const bytes=await node.exportAsync({format:'PNG',constraint:{type:'SCALE',value:256/Math.max(node.width,node.height)}});
      if(!bytes||bytes.length>135000)throw Error('参考预览过大，请简化图标。');
      if(epoch!==started||node.removed||selected().id!==node.id||JSON.stringify(factsFor(node).data)!==factsKey||await node.exportAsync(svgSettings)!==svg)throw Error('读取期间参考已变化，请重试。');
      const preview='data:image/png;base64,'+figma.base64Encode(bytes);
      snapshot={epoch:started,node,svg,preview,factsKey,ids:facts.ids};
      let fileKey='';try{fileKey=figma.fileKey||'';}catch(_){}
      post({type:'ai-captured',requestId:m.requestId,reference:{token:started,nodeId:node.id,name:node.name,width:node.width,height:node.height,fileKey,svg,preview,facts:facts.data}});
    }catch(e){post({type:'ai-capture-error',requestId:m.requestId,message:errorText(e)});}
  }
  async function request(m){
    if(requesting){post({type:'ai-response',requestId:m.requestId,ok:false,message:'已有 AI 请求正在处理，请稍候。'});return;}
    requesting=true;
    try{
      const body=m.body,status=body?.operation==='credentials'&&body.action==='status';
      if(!status&&!['analyze','generate'].includes(body?.operation))throw Error('不支持的 AI 操作。');
      if(typeof m.accessToken!=='string'||!m.accessToken||m.accessToken.length>8192||typeof m.apiKey!=='string'||!m.apiKey.startsWith('sb_publishable_')||m.apiKey.length>512)throw Error('请先登录工作台账号。');
      const captured=snapshot;
      if(!status){if(m.token!==captured?.epoch||body.references?.length!==1||body.references[0].preview!==captured.preview)throw Error('参考已失效，请重新读取。');await verify(captured);}
      const text=JSON.stringify(body);if(text.length>1500000)throw Error('请求内容过大。');
      let timer;
      const data=await Promise.race([
        (async()=>{
          const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:m.apiKey,Authorization:'Bearer '+m.accessToken,'X-Iconlab-Client':'figma-plugin'},body:text});
          let data;try{const output=await response.text();if(output.length>2097152)throw Error();data=JSON.parse(output);}catch(_){throw Error('AI 服务响应格式异常。');}
          if(!response.ok){const e=Error(typeof data?.message==='string'?data.message:'AI 服务请求失败。');e.status=response.status;throw e;}
          return data;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AI 服务超时，请先检查结果，避免重复调用。')),status?20000:140000);})
      ]).finally(()=>clearTimeout(timer));
      if(!status)await verify(captured);
      post({type:'ai-response',requestId:m.requestId,ok:true,data});
    }catch(e){post({type:'ai-response',requestId:m.requestId,ok:false,status:e.status,message:errorText(e)});}
    finally{requesting=false;}
  }
  async function insert(m){
    let node;
    try{
      await verify(snapshot);
      if(m.token!==snapshot?.epoch)throw Error('参考已变化，请重新生成。');
      if(typeof m.svg!=='string'||m.svg.length>65536||!/^<svg(?:\s|>)/.test(m.svg)||/<!|<(?:script|foreignObject|image|use|iframe|style)\b|\son\w+\s*=/i.test(m.svg))throw Error('候选 SVG 无效。');
      if(typeof m.meta!=='object'||JSON.stringify(m.meta).length>40000)throw Error('生成记录无效。');
      const source=snapshot.node,box=source.absoluteBoundingBox;
      figma.commitUndo();
      node=figma.createNodeFromSvg(m.svg);
      if(!node.children?.length)throw Error('候选未生成可编辑图层。');
      node.name=String(m.name||'AI 图标').slice(0,100);
      node.setPluginData('iconlab.ai.v1',JSON.stringify(m.meta));
      figma.currentPage.appendChild(node);
      node.x=box?box.x+box.width+32:figma.viewport.center.x-node.width/2;
      node.y=box?box.y:figma.viewport.center.y-node.height/2;
      figma.currentPage.selection=[node];figma.commitUndo();
      figma.viewport.scrollAndZoomIntoView([source,node]);
      post({type:'ai-inserted',requestId:m.requestId,ok:true,nodeId:node.id,name:node.name});
      invalidate();
    }catch(e){if(node&&!node.removed)try{node.remove();}catch(_){}post({type:'ai-inserted',requestId:m.requestId,ok:false,message:errorText(e)});}
  }
  function bindPage(){
    if(page&&pageHandler&&page.off)page.off('nodechange',pageHandler);
    page=figma.currentPage;
    pageHandler=event=>{
      if(!snapshot)return;
      const relevant=event.nodeChanges?.some(change=>{let n=change.node;for(let i=0;n&&i<40;i++,n=n.parent)if(snapshot?.ids.has(n.id))return true;return false;});
      if(relevant){invalidate();clearTimeout(changeTimer);}
    };
    if(page.on)page.on('nodechange',pageHandler);
  }
  bindPage();figma.on('currentpagechange',()=>{invalidate();bindPage();});
  return {invalidate,handleMessage(m){if(m.type==='ai-capture')void capture(m);if(m.type==='ai-request')void request(m);if(m.type==='ai-insert')void insert(m);if(m.type==='ai-manage')figma.openExternal('https://xueyingz90.github.io/icon-lab/#ai-settings');}};
}

// Selection/export and insertion bridge; optional login session stays in clientStorage.
const bridgeId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
const html=__html__.replace('"__ICONLAB_BRIDGE_ID__"',JSON.stringify(bridgeId));
figma.showUI(html, {width:420, height:720, themeColors:true});
const post=message=>figma.ui.postMessage(Object.assign({},message,{bridgeId:bridgeId}));
const aiHost=createPluginAIHost({figma,post});
const sessionOrigin='https://blolhaacvmciirmiovdo.supabase.co';
const sessionKey='iconlab.remembered-session.v1:'+sessionOrigin;
let sessionQueue=Promise.resolve();
function allowedSession(value){
  if(!value||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>16000||typeof value.refresh_token!=='string'||!value.refresh_token||value.refresh_token.length>16000||!Number.isFinite(value.expires_at)||!value.user||typeof value.user.id!=='string'||!value.user.id||value.user.id.length>100)throw Error('Invalid session');
  return {access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at,user:{id:value.user.id,email:typeof value.user.email==='string'?value.user.email.slice(0,320):''}};
}
function sessionStorage(message){
  sessionQueue=sessionQueue.then(async()=>{
    try{
      if(message.origin!==sessionOrigin)throw Error('Invalid origin');
      if(message.type==='session-load'){
        const record=await figma.clientStorage.getAsync(sessionKey);
        let session=null;
        if(record){try{if(record.version!==1||record.origin!==sessionOrigin)throw Error('Invalid record');session=allowedSession(record.session);}catch(_){await figma.clientStorage.deleteAsync(sessionKey);}}
        post({type:'session-result',requestId:message.requestId,ok:true,session:session});
      }else if(message.type==='session-save'){
        const session=allowedSession(message.session);
        await figma.clientStorage.setAsync(sessionKey,{version:1,origin:sessionOrigin,session:session});
        post({type:'session-result',requestId:message.requestId,ok:true});
      }else{
        await figma.clientStorage.deleteAsync(sessionKey);
        post({type:'session-result',requestId:message.requestId,ok:true});
      }
    }catch(_){post({type:'session-result',requestId:message.requestId,ok:false,message:'无法访问本机登录存储，请重试。'});}
  });
}
let generation=0;
function selectionError() {
  const nodes=figma.currentPage.selection;
  if(nodes.length!==1) return '请只选中一个图标 Frame 或 Component。';
  const node=nodes[0];
  if(!['FRAME','COMPONENT','INSTANCE'].includes(node.type)) return '请将图标放入 Frame 或 Component 后选中它。';
  if(node.visible===false || !(node.width>0 && node.height>0)) return '所选图标不可见或尺寸无效。';
  return '';
}
async function capture(requestId) {
  const token=++generation;
  post({type:'selection-loading',token:token});
  try {
    const error=selectionError();if(error) throw Error(error);
    const node=figma.currentPage.selection[0];
    const svg=await node.exportAsync({format:'SVG_STRING',svgOutlineText:true,svgIdAttribute:false,svgSimplifyStroke:true});
    if(token!==generation || node.removed) return;
    if(typeof svg!=='string' || svg.length>1048576) throw Error('导出的 SVG 超过 1MB 或格式无效。');
    let fileKey='';try {fileKey=figma.fileKey || '';}catch(_){}
    let aiMeta;try{const raw=node.getPluginData&&node.getPluginData('iconlab.ai.v1');if(raw&&raw.length<=40000)aiMeta=JSON.parse(raw);}catch(_){}
    post({type:'selection',selection:{token:token,nodeId:node.id,name:node.name,nodeType:node.type,width:node.width,height:node.height,fileKey:fileKey,svg:svg,aiMeta:aiMeta},requestId:requestId});
  }catch(e){if(token===generation)post({type:'selection-error',message:e.message || '无法读取所选图标。',requestId:requestId});}
}
figma.on('selectionchange',()=>{aiHost.invalidate();capture();});
async function verify(message) {
  const token=generation;
  try {
    const error=selectionError();if(error)throw Error(error);
    const node=figma.currentPage.selection[0];
    if(node.id!==message.nodeId || token!==message.token)throw Error('选区已变化，请检查新预览后重试。');
    const svg=await node.exportAsync({format:'SVG_STRING',svgOutlineText:true,svgIdAttribute:false,svgSimplifyStroke:true});
    if(token!==generation || node.removed)throw Error('选区已变化，请重新读取。');
    post({type:'verified',requestId:message.requestId,selection:{token:token,nodeId:node.id,name:node.name,nodeType:node.type,width:node.width,height:node.height,svg:svg}});
  }catch(e){post({type:'verify-error',requestId:message.requestId,message:e.message || '无法确认选区。'});}
}
function insertSVG(message) {
  let inserted;
  try {
    const svg=message.svg;
    if(typeof svg!=='string'||svg.length>1048576||!/^<svg(?:\s|>)/i.test(svg)||/<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|image|use|iframe|style)\b|\son\w+\s*=/i.test(svg))throw Error('仅支持安全的 SVG 矢量，PNG 等图片不能按 SVG 插入。');
    inserted=figma.createNodeFromSvg(svg);
    if(!inserted.children?.length)throw Error('SVG 未生成可编辑图层，请检查源文件。');
    inserted.name=String(message.name||'Icon Lab 图标').slice(0,100);
    const center=figma.viewport.center;
    inserted.x=center.x-inserted.width/2;inserted.y=center.y-inserted.height/2;
    figma.currentPage.appendChild(inserted);figma.currentPage.selection=[inserted];
    try{figma.viewport.scrollAndZoomIntoView([inserted]);}catch(_){}
    post({type:'insert-result',requestId:message.requestId,ok:true,nodeId:inserted.id});
  }catch(e){if(inserted&&!inserted.removed)try{inserted.remove();}catch(_){}post({type:'insert-result',requestId:message.requestId,ok:false,message:e.message||'无法插入 SVG。'});}
}
figma.ui.onmessage=message=>{
  if(!message || typeof message!=='object' || message.bridgeId!==bridgeId) return;
  if(message.type.startsWith('ai-'))aiHost.handleMessage(message);
  if(['session-load','session-save','session-clear'].includes(message.type))sessionStorage(message);
  if(message.type==='ready' || message.type==='capture') capture(message.requestId);
  if(message.type==='verify') verify(message);
  if(message.type==='open-workbench') figma.openExternal('https://xueyingz90.github.io/icon-lab/');
  if(message.type==='insert-svg') insertSVG(message);
};
