// Existing selection/export bridge plus explicit local SVG insertion. No network or stored credentials.
const bridgeId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
const html=__html__.replace('"__ICONLAB_BRIDGE_ID__"',JSON.stringify(bridgeId));
figma.showUI(html, {width:420, height:720, themeColors:true});
const post=message=>figma.ui.postMessage(Object.assign({},message,{bridgeId:bridgeId}));
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
    post({type:'selection',selection:{token:token,nodeId:node.id,name:node.name,nodeType:node.type,width:node.width,height:node.height,fileKey:fileKey,svg:svg},requestId:requestId});
  }catch(e){if(token===generation)post({type:'selection-error',message:e.message || '无法读取所选图标。',requestId:requestId});}
}
figma.on('selectionchange',()=>capture());
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
  if(message.type==='ready' || message.type==='capture') capture(message.requestId);
  if(message.type==='verify') verify(message);
  if(message.type==='open-workbench') figma.openExternal('https://xueyingz90.github.io/icon-lab/');
  if(message.type==='insert-svg') insertSVG(message);
};
