import {cleanSVG} from '../../catalog-core.js';
import {classification,classificationLabel,populateClassificationSelect} from '../../taxonomy.js';

export function prepareLibrarySVG(asset) {
  const format=String(asset.format||asset.mime_type||asset.file_type||'').toLowerCase();
  if(format&&!['svg','image/svg+xml'].includes(format))throw Error('该资源为 '+format+'，当前仅支持插入 SVG 矢量，请使用网页下载原资源。');
  if(typeof asset.svg!=='string'||!/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(asset.svg))throw Error('此资源没有可插入的 SVG 内容；PNG 等图片暂不支持插入。');
  return {svg:cleanSVG(asset.svg).svg,name:String(asset.name||'Icon Lab 图标').slice(0,100),assetId:String(asset.id||'')};
}
export function createPluginLibrary({client,context,send,onSessionExpired=()=>{}}) {
  const $=id=>document.getElementById(id);
  let active=true,key='',generation=0,items=[],offset=0,hasMore=false,loading=false,debounce,insertCounter=0;
  const pending=new Map(),pageSize=24;
  const currentKey=()=>client.session?.access_token&&context().workspace?client.config.url+':'+client.session.user?.id+':'+context().workspace:'';
  const message=text=>$('library-message').textContent=text;
  populateClassificationSelect($('library-structure'),'structure',true);populateClassificationSelect($('library-style'),'visual_style',true);
  function filters(){return {name:$('library-query').value,structure:$('library-structure').value,visual_style:$('library-style').value};}
  function render(){
    const grid=$('library-results');grid.replaceChildren();
    for(const asset of items){
      const card=document.createElement('article');card.className='plugin-library-card';
      const preview=document.createElement('div');preview.className='plugin-library-preview';let prepared,error;
      try{prepared=prepareLibrarySVG(asset);const img=document.createElement('img');img.alt=asset.name;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(prepared.svg);preview.append(img);}catch(e){error=e.message;preview.textContent='暂不支持预览';}
      const content=document.createElement('div');content.className='plugin-library-card-content';
      const title=document.createElement('strong');title.textContent=asset.name;
      const metadata=document.createElement('small'),dims=classification(asset);metadata.textContent=classificationLabel('structure',dims.structure)+' / '+classificationLabel('visual_style',dims.visual_style);
      const insert=document.createElement('button');insert.type='button';insert.textContent='插入画布';insert.disabled=!!error||pending.size>0||!currentKey();
      const assetKey=key;
      insert.onclick=()=>insertAsset(prepared,assetKey);
      content.append(title,metadata);if(error){const hint=document.createElement('small');hint.textContent=error;content.append(hint);}content.append(insert);card.append(preview,content);grid.append(card);
    }
    $('library-more').hidden=!hasMore;$('library-more').disabled=loading;
    $('library-search').disabled=loading||!currentKey();
  }
  async function load(reset=true){
    clearTimeout(debounce);const requestKey=currentKey();
    if(!requestKey){items=[];hasMore=false;loading=false;render();message('请先登录并选择工作空间。');return;}
    if(!reset&&loading)return;
    const request=++generation;key=requestKey;
    if(reset){items=[];offset=0;hasMore=false;}loading=true;render();message('正在查询已有资产…');
    try{
      const rows=await client.searchAssets(context().workspace,{...filters(),offset,limit:pageSize});
      if(request!==generation||requestKey!==currentKey())return;
      if(!Array.isArray(rows))throw Error('资源库返回格式异常。');
      offset+=rows.length;hasMore=rows.length===pageSize;
      items=[...items,...rows.filter(row=>!items.some(old=>old.id===row.id))];
      message(items.length?`已加载 ${items.length} 个资产；点击插入可在画布继续编辑。`:'没有符合条件的已上传图标，可调整筛选或重置。');
    }catch(e){if(request!==generation)return;if(requestKey!==currentKey()){if(!client.session)onSessionExpired();contextChanged();return;}hasMore=false;message('资源库查询失败：'+e.message+'。请确认分类迁移已部署后重试。');}
    finally{if(request===generation){loading=false;render();}}
  }
  function contextChanged(){
    const next=currentKey();if(next===key)return;
    ++generation;key=next;items=[];offset=0;hasMore=false;loading=false;render();
    if(active&&next)load();else message(next?'打开资源库后查询当前空间。':'请先登录并选择工作空间。');
  }
  function switchTab(library){
    active=library;$('library-panel').hidden=!library;$('upload-panel').hidden=library;
    $('library-tab').setAttribute('aria-pressed',String(library));$('upload-tab').setAttribute('aria-pressed',String(!library));
    if(library){contextChanged();if(currentKey()&&!loading)load();else if(!currentKey())message('请先登录并选择工作空间。');}
  }
  async function insertAsset(prepared,assetKey){
    if(!prepared)return;
    if(!currentKey()||assetKey!==currentKey()){message('账号或空间已变化，请重新查询资源库。');return;}
    if(pending.size){message('正在插入，请稍候。');return;}
    const requestId='library-insert-'+(++insertCounter);
    message('正在插入 '+prepared.name+'…');
    const timer=setTimeout(()=>{pending.delete(requestId);render();message('尚未收到插入结果，请先检查画布，避免重复插入。');},15000);
    pending.set(requestId,{timer,key:assetKey});render();
    send({type:'insert-svg',requestId,...prepared});
  }
  function handleMessage(data){
    if(data.type!=='insert-result')return;
    const request=pending.get(data.requestId);if(!request)return;
    clearTimeout(request.timer);pending.delete(data.requestId);render();
    if(request.key!==currentKey())return;
    message(data.ok?'已插入并选中图标，可在 Figma 中编辑矢量图层。':'插入失败：'+data.message);
  }
  $('library-tab').onclick=()=>switchTab(true);$('upload-tab').onclick=()=>switchTab(false);
  $('library-search').onclick=()=>load();$('library-more').onclick=()=>load(false);
  $('library-query').oninput=()=>{clearTimeout(debounce);++generation;items=[];hasMore=false;loading=false;render();debounce=setTimeout(()=>load(),250);};
  $('library-query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load();}};
  ['library-structure','library-style'].forEach(id=>$(id).onchange=()=>load());
  $('library-reset').onclick=()=>{$('library-query').value='';$('library-structure').value='';$('library-style').value='';load();};
  render();return {contextChanged,handleMessage};
}
