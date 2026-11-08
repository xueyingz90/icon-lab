// Shared core is embedded locally by build-figma-plugin; no remote JS or PAT storage.
export function createPluginAI({client,context,send,onSessionExpired,onInserted}){
  const $=id=>document.getElementById(id),core=PluginAICore;
  let reference=null,confirmed=null,candidates=[],index=0,busy=false,revision=0,counter=0,key='',resultRevision=-1;
  const pending=new Map(),fields=['pai-width','pai-height','pai-stroke','pai-color','pai-cap','pai-join','pai-padding','pai-notes'];
  const currentKey=()=>client.session?.user?.id?client.session.user.id+':'+context().workspace:'';
  const message=(text,error=false)=>{$('pai-status').textContent=text;$('pai-status').dataset.tone=error?'error':'info';};
  const signature=()=>JSON.stringify({token:reference?.token,spec:spec()});
  function spec(){return core.normalizeSpec({canvas:{width:Number($('pai-width').value),height:Number($('pai-height').value)},stroke:$('pai-stroke').value.trim()?Number($('pai-stroke').value):NaN,color:$('pai-color').value.trim(),cap:$('pai-cap').value,join:$('pai-join').value,padding:$('pai-padding').value.trim()?Number($('pai-padding').value):NaN,styleNotes:$('pai-notes').value});}
  function update(){
    let valid=false;try{valid=!!reference&&confirmed===signature();}catch(_){}
    fields.forEach(id=>$(id).disabled=busy);
    $('pai-prompt').disabled=busy;$('pai-consent').disabled=busy;
    $('pai-capture').disabled=busy;$('pai-analyze').disabled=busy||!reference||!client.session;
    $('pai-confirm').disabled=busy||!reference;$('pai-generate').disabled=busy||!valid||!client.session;
    $('pai-insert').disabled=busy||!candidates.length||resultRevision!==revision;
    $('pai-progress').textContent=busy?'处理中':valid?'规范已确认':reference?'待确认规范':'待选取参考';
    $('ai-panel').setAttribute('aria-busy',String(busy));
  }
  function rpc(type,data={},timeout=150000){
    const requestId='pai-'+(++counter);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('请求超时，请先检查结果，避免重复调用。'));},timeout);pending.set(requestId,{resolve,reject,timer});send({type,requestId,...data});});
  }
  async function cloud(body){
    if(!client.session?.access_token)throw Error('请先登录工作台账号。');
    if(client.session.expires_at<Date.now()/1000+60)await client.refresh();
    const owner=currentKey(),result=await rpc('ai-request',{body,token:reference?.token,accessToken:client.session.access_token,apiKey:client.config.key});
    if(currentKey()!==owner||!client.session)throw Error('账号或空间已变化，已丢弃结果。');
    return result;
  }
  function refBody(){
    if(!reference)throw Error('请先读取参考选区。');
    const info=cleanSVG(reference.svg),root=new DOMParser().parseFromString(info.svg,'image/svg+xml').documentElement;
    const vb=(root.getAttribute('viewBox')||`0 0 ${info.width} ${info.height}`).trim().split(/[\s,]+/).map(Number),facts=reference.facts;
    return [{name:reference.name.slice(0,200)||'参考图标',svg:info.svg,preview:reference.preview,vb,widths:facts.widths,caps:facts.caps,joins:facts.joins,strokes:facts.colors,fills:facts.fills}];
  }
  function consent(){if(!$('pai-consent').checked)throw Error('请先允许将当前参考图标、预览和需求发送到所选 AI 服务。');}
  async function run(fn){if(busy)return;busy=true;update();try{await fn();}catch(e){message(e.message,true);}finally{busy=false;update();}}
  function apply(value){const s=core.normalizeSpec(value),size=core.canvasDimensions(s.canvas);$('pai-width').value=size.width;$('pai-height').value=size.height;$('pai-stroke').value=s.stroke;$('pai-color').value=s.color;$('pai-cap').value=s.cap;$('pai-join').value=s.join;$('pai-padding').value=s.padding;$('pai-notes').value=s.styleNotes;}
  function renderCandidates(){
    $('pai-candidates').replaceChildren(...candidates.map((item,i)=>{const button=document.createElement('button');button.type='button';button.className='pai-candidate';button.setAttribute('aria-pressed',String(i===index));const image=document.createElement('img');image.alt=item.name;image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(core.generatedSVG(item));const label=document.createElement('span');label.textContent=item.name;button.append(image,label);button.onclick=()=>{index=i;renderCandidates();update();};return button;}));
    $('pai-results').hidden=!candidates.length;
    if(candidates.length){const item=candidates[index],size=core.canvasDimensions(item.spec.canvas);$('pai-result-note').textContent=`${size.width} × ${size.height} · 结构与描边边界通过；语义和视觉需人工检查。`;}
  }
  function invalidate(reason='参考选区已变化，请重新读取并确认。'){
    revision++;reference=null;confirmed=null;
    $('pai-reference-state').textContent='参考已失效';$('pai-consent').checked=false;
    if(candidates.length)$('pai-result-note').textContent='保留上次候选供查看；参考已变化，不能继续插入。';
    message(reason);update();
  }
  $('pai-capture').onclick=()=>run(async()=>{
    revision++;reference=null;confirmed=null;const started=revision;message('正在本地读取选区，不会上传素材…');
    const result=await rpc('ai-capture',{},30000);
    if(started!==revision)throw Error('选区已变化，请重新读取。');
    cleanSVG(result.svg);reference=result;const f=result.facts;
    $('pai-reference-name').textContent=result.name;$('pai-reference-state').textContent=`${result.width} × ${result.height} · ${f.layers} 个可见图层`;
    const img=document.createElement('img');img.alt=result.name;img.src=result.preview;$('pai-preview').replaceChildren(img);
    $('pai-facts').textContent=`原始描边：${f.widths.length?f.widths.join(' / '):'未识别'}；颜色：${f.colors.length?f.colors.join(' / '):'未识别'}。${f.warnings.join('；')}`;
    $('pai-width').value=result.width;$('pai-height').value=result.height;
    for(const [field,values] of [['pai-stroke',f.widths],['pai-color',f.colors],['pai-cap',f.caps],['pai-join',f.joins]])$(field).value=values.length===1?values[0]:'';
    $('pai-padding').value='1';$('pai-notes').value='';$('pai-spec').open=true;$('pai-consent').checked=false;
    message('已读取原始参数。留白为待确认目标值；混用或未识别字段请手动指定。也可让 AI 分析风格。');
  });
  $('pai-analyze').onclick=()=>run(async()=>{
    consent();const target=spec(),before=signature(),started=revision;message('正在分析参考风格…');
    const result=await cloud({operation:'analyze',references:refBody(),target});
    if(started!==revision||before!==signature())throw Error('参考或目标已变化，已丢弃分析结果。');
    const s=core.normalizeSpec(result.spec);if(JSON.stringify(s.canvas)!==JSON.stringify(target.canvas))throw Error('AI 返回的画布与目标不一致。');
    apply(s);confirmed=null;message('AI 建议已填入目标规范。请对照原始参数检查，再确认。');
  });
  $('pai-confirm').onclick=()=>{try{if(!reference)throw Error('请先读取选区。');spec();confirmed=signature();message('规范已确认。填写图标需求和使用场景后生成。');}catch(e){message(e.message,true);}update();};
  $('pai-generate').onclick=()=>run(async()=>{
    consent();if(!reference||confirmed!==signature())throw Error('请先确认当前规范。');
    const prompt=$('pai-prompt').value.trim();if(!prompt||prompt.length>2000)throw Error('请填写 1–2000 字符的图形描述和使用场景。');
    const target=spec(),before=signature(),started=revision,source={nodeId:reference.nodeId,fileKey:reference.fileKey,name:reference.name,width:reference.width,height:reference.height};
    message('正在生成三个候选并校验，最多修正一次…');
    const result=await cloud({operation:'generate',references:refBody(),spec:target,prompt});
    if(started!==revision||before!==signature()||prompt!==$('pai-prompt').value.trim())throw Error('输入已变化，已丢弃过期候选。');
    const icons=core.validateGeneratedIcons(result.icons,target),meta={version:1,prompt,model:String(result.model||'').slice(0,100),generatedAt:new Date().toISOString(),spec:target,reference:source};
    candidates=icons.map(item=>({...item,aiMeta:meta}));index=0;resultRevision=revision;renderCandidates();message('三个候选已就绪。选择后插入画布，再通过上传页确认入库。');
  });
  $('pai-insert').onclick=()=>run(async()=>{
    if(!reference||resultRevision!==revision||!candidates[index])throw Error('参考或需求已变化，请重新生成。');
    const item=candidates[index];message('正在插入所选候选…');
    const result=await rpc('ai-insert',{token:reference.token,svg:core.generatedSVG(item),name:item.name,meta:item.aiMeta},30000);
    message('已插入可编辑矢量。请在上传页核对信息后确认入库。');onInserted(result);
  });
  $('pai-manage').onclick=()=>send({type:'ai-manage'});
  $('pai-prompt').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('pai-generate').click();}};
  fields.forEach(id=>$(id).addEventListener('input',()=>{revision++;confirmed=null;update();message('目标规范已修改，请重新确认。');}));
  $('pai-prompt').addEventListener('input',()=>{revision++;update();});
  function contextChanged(){const next=currentKey();if(next!==key){key=next;invalidate('账号或空间已变化，请重新读取参考。');candidates=[];renderCandidates();$('pai-connection').textContent='打开 AI 生成后检查连接。';}update();}
  function open(){
    $('ai-panel').hidden=false;$('ai-tab').setAttribute('aria-pressed','true');contextChanged();
    if(!client.session){$('pai-connection').textContent='请先登录工作台账号。';return;}
    run(async()=>{const status=await cloud({operation:'credentials',action:'status'});$('pai-connection').textContent=status.configured?`个人 Qoder · ${status.model}`:'团队云端接口';});
  }
  function handleMessage(data){
    if(data.type==='ai-invalidated'){invalidate();return;}
    if(!['ai-captured','ai-capture-error','ai-response','ai-inserted'].includes(data.type))return;
    const task=pending.get(data.requestId);if(!task)return;clearTimeout(task.timer);pending.delete(data.requestId);
    if(data.type==='ai-capture-error'||data.ok===false){if(data.status===401){client.setSession(null);onSessionExpired();}task.reject(Error(data.message||'AI 操作失败。'));}
    else task.resolve(data.type==='ai-captured'?data.reference:data.type==='ai-response'?data.data:data);
  }
  update();return {open,contextChanged,invalidate,handleMessage};
}
