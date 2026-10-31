import {classification,classificationLabel,matchesClassification,populateClassificationSelect,legacyPlatform} from './taxonomy.js';
import {createStandardsUI} from './standards-ui.js?v=20261031-standards-7';
import {cleanSVG, normalizeMetadata, sourceKey, sha256, matchesAsset, localSave} from './catalog-core.js?v=20261031-taxonomy-8';
import {CloudClient, validateConfig} from './cloud-client.js?v=20261031-standards-7';
import {cloudConfig} from './cloud-config.js?v=20261031-cloud-1';

const $ = id => document.getElementById(id);
const LOCAL_KEY = 'iconlab.catalog.local.v1', CONFIG_KEY = 'iconlab.cloud.config.v1';
const model = {mode:'local', assets:[], workspace:null, workspaces:[], user:null, client:null, upload:null, editing:null, selected:null, demos:[], scope:'all', busy:false, generation:0};
const el = (tag, text, cls) => {const n = document.createElement(tag); if(text !== undefined) n.textContent = text; if(cls) n.className = cls; return n;};
const option = (text, value) => {const node=el('option',text); node.value=value; return node;};
const button = (text, action, cls = 'button') => {const n = el('button', text, cls); n.type = 'button'; n.onclick = action; return n;};
const showError = error => { $('catalog-message').textContent = error.message || String(error); $('catalog-message').hidden = false; };
const clearError = () => {$('catalog-message').hidden = true;};
function download(content, name, mime = 'application/json') {const url = URL.createObjectURL(new Blob([content], {type:mime})); const a = el('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);}
function copyCodeButton(asset) {
  const copy=button('复制代码',async()=>{
    copy.disabled=true;
    let code;
    const content=$('catalog-detail-content');
    content.querySelector('#catalog-copy-result')?.remove();
    const result=el('div');result.id='catalog-copy-result';
    const status=el('p',undefined,'catalog-hint');status.setAttribute('role','status');result.append(status);
    try {code=cleanSVG(asset.svg).svg;}catch(e){status.textContent='无法复制：'+e.message;content.prepend(result);copy.disabled=false;return;}
    try {
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code);
      copy.textContent='已复制';status.textContent='SVG 代码已复制，保留原始颜色。';
      if(model.selected?.id===asset.id)content.prepend(result);
    }catch {
      if(model.selected?.id!==asset.id)return;
      status.textContent='浏览器未允许直接复制，代码已选中，请按 ⌘C / Ctrl+C 复制。';
      const field=el('textarea',undefined,'catalog-code');field.value=code;field.readOnly=true;field.rows=6;field.spellcheck=false;field.setAttribute('aria-label','SVG 源码');
      result.append(field);content.prepend(result);field.focus();field.select();
    }finally{copy.disabled=false;}
  });
  return copy;
}
function image(svg, name) {const img = el('img'); img.alt = name; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cleanSVG(svg).svg); return img;}
function selectOptions(id, values, all = false) {const node=$(id); if(all) node.append(option('全部', '')); values.forEach(x => node.append(option(x, x)));}
function openDialog(id) {const dialog=$(id); if(!dialog.open) dialog.showModal();}
async function run(action) {if(model.busy) return; model.busy=true; clearError(); document.body.classList.add('catalog-busy'); try {await action();} catch(e) {showError(e);} finally {model.busy=false; document.body.classList.remove('catalog-busy');}}

const root = el('section', undefined, 'catalog'); root.id='catalog-view'; root.hidden=true;
root.innerHTML = `
 <div class="catalog-statusbar"><span class="catalog-mode" id="catalog-mode">本地试用 · 仅此浏览器</span><span id="catalog-account"></span></div>
 <div class="catalog-intro"><div><span class="eyebrow">ASSET LIBRARY</span><h2>让每一次设计，都能被再次使用。</h2><p>先查找已有资产，再决定是否创建。为图标保留来源、平台和每次修改。</p></div><div class="catalog-heading-actions"><button class="button" id="catalog-standards" type="button">图标规范</button><button class="button primary" id="catalog-add">＋ 上传图标</button></div></div>
 <div class="catalog-stats"><div><strong id="catalog-total">0</strong><span id="catalog-total-label">我的资产</span></div><div><strong id="catalog-platforms">0</strong><span>演示素材</span></div><div><strong id="catalog-sources">0</strong><span>已记录来源</span></div><div class="catalog-stat-note" id="catalog-storage-note">先查找已有资产，再登记新的设计。</div></div>
 <div id="catalog-message" role="alert" class="catalog-error" hidden></div>
 <div class="catalog-scope" role="group" aria-label="资产范围"><button type="button" data-scope="all" aria-pressed="true">全部</button><button type="button" data-scope="assets" aria-pressed="false" id="catalog-owned-tab">我的资产</button><button type="button" data-scope="demo" aria-pressed="false">演示素材</button></div>
 <div class="catalog-tools"><input id="catalog-search" type="search" placeholder="搜索名称、标签或状态" aria-label="搜索资产"><label>图形结构 <select id="catalog-type"></select></label><label>视觉风格 <select id="catalog-style"></select></label><button class="button" id="catalog-refresh">刷新</button><button class="button" id="catalog-reset">重置筛选</button><button class="button" id="catalog-import-legacy">登记本地图标</button><details><summary>更多</summary><button id="catalog-backup" type="button">备份资产库</button><label class="catalog-file-label">导入资产备份<input id="catalog-restore" type="file" accept=".json,application/json" hidden></label></details></div>
 <details class="catalog-advanced-filters"><summary>更多筛选</summary><div><label>颜色模式 <select id="catalog-color-mode"></select></label><label>适用平台 <select id="catalog-platform"></select></label></div></details>
 <div class="catalog-cloud-tools" id="catalog-cloud-tools" hidden><label>工作空间 <select id="catalog-workspace"></select></label><button class="button" id="catalog-new-workspace">新建空间</button><button class="button" id="catalog-members">添加成员</button><button class="button" id="catalog-signout">退出登录</button></div>
 <div class="catalog-results"><span id="catalog-result-count"></span><small>演示素材可直接试用，上传资产保存后即可复用</small></div>
 <div id="catalog-grid" class="catalog-grid"></div><div id="catalog-empty" class="catalog-empty" hidden><strong>还没有找到合适的图标</strong><p id="catalog-empty-help">试试其他关键词，或者上传一份新资产。</p><button class="button" id="catalog-clear">清除筛选</button></div>
 <p class="catalog-footnote" id="catalog-footnote">本地试用数据与原工作台项目独立保存，不会自动上传。</p>`;
document.querySelector('.workspace-footer').before(root);
const nav=button('资产库', () => showCatalog(), 'nav catalog-nav'); nav.id='catalog-nav'; nav.setAttribute('aria-label','资产库'); document.querySelector('nav[aria-label="工作模式"]').prepend(nav);
document.querySelector('.session-pill').lastChild.textContent='资产工作台 · 阶段 1';

const dialogs=el('div'); dialogs.innerHTML=`
<dialog class="catalog-dialog" id="catalog-upload" aria-labelledby="catalog-upload-title"><form id="catalog-upload-form"><div class="catalog-dialog-head"><div><span class="eyebrow">REGISTER ASSET</span><h2 id="catalog-upload-title">登记图标资产</h2></div><button type="button" class="icon-button" data-close="catalog-upload" aria-label="关闭入库窗口">×</button></div><div class="catalog-upload-body"><div class="catalog-upload-layout"><label class="catalog-drop" id="catalog-drop"><span id="catalog-file-preview">＋ 选择或拖入 SVG</span><small id="catalog-file-name">支持线性、面型与多色图标，最大 1MB</small><input id="catalog-file" type="file" accept=".svg,image/svg+xml" hidden></label><div class="catalog-form-grid"><label class="catalog-full">图标名称 *<input name="name" maxlength="100" required placeholder="例如：收藏"></label><label>图形结构<select name="structure" id="catalog-form-type"></select></label><label>视觉风格<select name="visual_style" id="catalog-form-style"></select></label><label>颜色模式<select name="color_mode" id="catalog-form-color-mode"></select></label><label>适用平台<select name="target_platform" id="catalog-form-platform"></select></label><label>图标状态<input name="state_name" maxlength="30" value="默认" required></label><label>语义标签<input name="tags" placeholder="收藏, 书签, 稍后查看" maxlength="380"></label><label class="catalog-full">原始来源链接<input name="source_url" type="url" maxlength="2000" placeholder="可选：Figma 节点或其他 HTTPS 来源"></label><label class="catalog-full">备注<textarea name="note" maxlength="500" rows="2" placeholder="使用场景、适用限制等"></textarea></label></div></div><p class="catalog-hint" id="catalog-upload-hint"></p><div id="catalog-upload-check"></div><div id="catalog-upload-error" class="catalog-error" role="alert" hidden></div></div><div class="catalog-dialog-actions"><button type="button" class="button" data-close="catalog-upload">取消</button><button id="catalog-save" type="submit" class="button primary">确认入库</button></div></form></dialog>
<dialog class="catalog-dialog catalog-detail" id="catalog-detail" aria-labelledby="catalog-detail-title"><div class="catalog-dialog-head"><div><span class="eyebrow">ASSET DETAILS</span><h2 id="catalog-detail-title"></h2></div><button type="button" class="icon-button" data-close="catalog-detail" aria-label="关闭资产详情">×</button></div><div id="catalog-detail-content"></div><div class="catalog-dialog-actions" id="catalog-detail-actions"></div></dialog>
<dialog class="catalog-dialog catalog-auth" id="catalog-connection" aria-labelledby="catalog-auth-title"><div class="catalog-dialog-head"><h2 id="catalog-auth-title">账号与同步</h2><button type="button" class="icon-button" data-close="catalog-connection" aria-label="关闭账号与同步">×</button></div><p class="catalog-hint">登录后，在不同电脑访问同一份资产。原有本地资产不会自动上传。</p><form id="catalog-auth-form" class="catalog-form-grid"><label class="catalog-full">邮箱<input id="catalog-email" type="email" autocomplete="username" required></label><label class="catalog-full">密码<input id="catalog-password" type="password" autocomplete="current-password" minlength="8" required></label><button type="submit" id="catalog-login" class="button primary">登录</button><button type="button" class="button" id="catalog-register">注册账号</button></form><p id="catalog-auth-message" role="status" class="catalog-hint"></p><p class="catalog-hint">登录状态仅保留在当前标签页，关闭后需重新登录。</p><details class="catalog-advanced" id="catalog-advanced"><summary>高级连接设置</summary><form id="catalog-config-form" class="catalog-form-grid"><label class="catalog-full">Project URL<input id="catalog-url" type="url" placeholder="https://你的项目.supabase.co" required></label><label class="catalog-full">Publishable key<input id="catalog-key" type="text" placeholder="sb_publishable_..." autocomplete="off" required></label><button type="submit" class="button">保存连接配置</button><a href="https://github.com/xueyingz90/icon-lab/blob/main/docs/SETUP.md" target="_blank" rel="noreferrer" class="catalog-link">部署说明 ↗</a></form></details></dialog>
<dialog class="catalog-dialog catalog-auth" id="catalog-member-dialog" aria-labelledby="catalog-member-title"><div class="catalog-dialog-head"><h2 id="catalog-member-title">添加工作空间成员</h2><button class="icon-button" type="button" data-close="catalog-member-dialog" aria-label="关闭添加成员">×</button></div><p class="catalog-hint">对方需先注册同一后端的账号。添加成员会授权其查看此空间的全部图标与历史版本，不会发送邮件。</p><form id="catalog-member-form" class="catalog-form-grid"><label class="catalog-full">成员邮箱<input name="email" type="email" required></label><label class="catalog-full">角色<select name="role"><option value="viewer">只读：查看与下载</option><option value="editor">编辑：查看、下载、创建和更新资产</option></select></label><button class="button primary" type="submit">确认添加</button></form><p class="catalog-hint" role="status" id="catalog-member-message"></p></dialog>`;
document.body.append(dialogs);
document.querySelectorAll('[data-close]').forEach(b => b.onclick=() => $(b.dataset.close).close());
for(const [key,id] of [['structure','type'],['visual_style','style'],['color_mode','color-mode'],['target_platform','platform']]){populateClassificationSelect($('catalog-'+id),key,true);populateClassificationSelect($('catalog-form-'+id),key);}
function taxonomyFilters(){return {structure:$('catalog-type').value,visual_style:$('catalog-style').value,color_mode:$('catalog-color-mode').value,target_platform:$('catalog-platform').value};}
const standards=createStandardsUI({context:()=>({mode:model.mode,client:model.client,workspace:model.workspace,user:model.user,role:model.role}),onChange:()=>{updateUploadCheck();updateDetailCheck();}});
function updateUploadCheck(){const container=$('catalog-upload-check');if(!model.upload){container.replaceChildren();return;}standards.renderCheck(container,model.upload.svg,legacyPlatform($('catalog-form-platform').value));}
function updateDetailCheck(){const container=$('catalog-detail-check');if(container&&model.selected)standards.renderCheck(container,model.selected.svg,model.selected.platform);}
$('catalog-standards').onclick=()=>standards.open(legacyPlatform($('catalog-platform').value));
$('catalog-form-platform').addEventListener('change',updateUploadCheck);


function showCatalog() {
  window.iconflow.stop();
  ['workspace','assets-view'].forEach(id => $(id).hidden=true); root.hidden=false;
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b===nav));
  $('page-title').firstChild.textContent='团队图标，从这里开始'; $('page-description').textContent='查找已有资产、记录设计来源，让每次设计沉淀为下一次复用。';
  ['demo-start','export-open','backup','save-status'].forEach(id => $(id).hidden=true);
  document.querySelector('.workspace-footer').firstElementChild.textContent='本地试用与云端空间分开保存';
  localStorage.setItem('iconlab.lastView','catalog');
  render();
}
window.addEventListener('iconlab:mode', () => {root.hidden=true; ['demo-start','export-open','backup','save-status'].forEach(id => $(id).hidden=false); localStorage.setItem('iconlab.lastView','workbench'); document.querySelector('.workspace-footer').firstElementChild.textContent='动效编辑数据保存在当前浏览器；资产库可单独连接云端';});

function persistLocal(records) {localStorage.setItem(LOCAL_KEY, JSON.stringify(records)); model.assets=records;}
async function localRecords() {
  const text=localStorage.getItem(LOCAL_KEY);
  let records=text?JSON.parse(text):[];
  // Archive only exact, untouched seeds from the old six-item demo catalog.
  const seeds=records.filter(a=>a.version===1 && a.note==='内置演示素材；用于体验本地资产库。' && model.demos.some(d=>d.name===a.name && d.content_hash===a.content_hash));
  if(seeds.length){
    const key='iconlab.catalog.archived-seeds.v1';
    const archived=JSON.parse(localStorage.getItem(key)||'[]');
    localStorage.setItem(key,JSON.stringify([...archived,...seeds.filter(a=>!archived.some(b=>b.id===a.id))]));
    records=records.filter(a=>!seeds.includes(a));
    localStorage.setItem(LOCAL_KEY,JSON.stringify(records));
  }
  return records;
}
async function demoRecords() {
  return Promise.all(window.iconflow.demoAssets().map(async item=>{
    const info=cleanSVG(item.svg);
    return {id:'demo:'+item.key,kind:'demo',...info,name:item.name,tags:['演示',item.key],platform:'通用',visual_type:'线性',state_name:'默认',source_url:'',note:'内置演示素材，可下载或用于状态动效。',content_hash:await sha256(info.svg)};
  }));
}
function assetLabel(asset) {return asset.kind==='demo'?'演示素材':model.mode==='local'?'已保存 · 本地':'已保存 · 云端';}
function setScope(scope){model.scope=scope;render();}

async function refresh() {
  const generation=++model.generation;
  const assets=model.mode==='cloud' ? await model.client.assets(model.workspace) : await localRecords();
  if(generation!==model.generation) return;
  model.assets=assets; render();
}
function render() {
  const cloud=model.mode==='cloud';
  $('catalog-mode').textContent=cloud ? (model.client?.session ? '云端空间 · 已登录' : '云端空间 · 需要重新登录') : '本地试用 · 仅此浏览器';
  $('catalog-mode').classList.toggle('connected', cloud && !!model.client?.session);
  const canEdit=!cloud || (model.client?.session && model.role!=='viewer');
  $('catalog-add').disabled=!canEdit; $('catalog-import-legacy').disabled=!canEdit;
  $('catalog-account').textContent=cloud ? (model.user?.email || '') : '本地数据不会随账号跨电脑同步';
  $('catalog-cloud-tools').hidden=!cloud;
  $('catalog-storage-note').textContent=cloud ? '共享保存 · 手动刷新获取最新版本' : '独立本地试用 · 数据保存在此浏览器';
  $('catalog-upload-hint').textContent=cloud ? '本次提交将保存到当前云端工作空间，具有空间权限的成员可以查看。' : '本次提交仅保存在此浏览器，可先备份，之后逐项登记到云端。';
  $('catalog-footnote').textContent=cloud ? '最多加载最近 500 项；搜索和筛选作用于这些资产。云端出错时不会自动改存本地。' : '演示素材为内置样本，不会自动保存到你的资产；本地资产仅此浏览器可见。';
  $('catalog-total').textContent=String(model.assets.length);
  $('catalog-total-label').textContent=cloud?'空间资产':'我的资产';
  $('catalog-owned-tab').textContent=cloud?'空间资产':'我的资产';
  document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===model.scope)));
  $('catalog-platforms').textContent=String(model.demos.length);
  $('catalog-sources').textContent=String(model.assets.filter(a=>a.source_url).length);
  const candidates=model.scope==='demo'?model.demos:model.scope==='assets'?model.assets.slice(0,500):[...model.assets.slice(0,500),...model.demos];
  const shown=candidates.filter(a=>matchesAsset(a,$('catalog-search').value)&&matchesClassification(a,taxonomyFilters()));
  $('catalog-result-count').textContent=`${shown.length} 项资产${model.assets.length>500?' · 已达到本页加载上限':''}`;
  const grid=$('catalog-grid'); grid.replaceChildren();
  shown.forEach(asset => {
    const card=el('button',undefined,'catalog-card'); card.type='button'; card.setAttribute('aria-label','查看资产 '+asset.name);
    const preview=el('span',undefined,'catalog-card-preview');
    try {preview.append(image(asset.svg, asset.name));} catch {preview.textContent='预览不可用';}
    const info=el('span',undefined,'catalog-card-info'); const meta=el('span', `${classificationLabel('structure',classification(asset).structure)} / ${classificationLabel('visual_style',classification(asset).visual_style)}`, 'catalog-card-meta');
    info.append(el('strong',asset.name),meta,el('small',`${asset.state_name} · ${asset.kind==='demo'?'内置演示':'v'+asset.version}`));
    info.append(el('span',assetLabel(asset),'catalog-badge '+(asset.kind==='demo'?'demo':'saved')));
    card.append(preview,info); card.onclick=()=>run(()=>showDetail(asset)); grid.append(card);
  });
  $('catalog-empty').hidden=shown.length>0;
  $('catalog-empty-help').textContent=model.scope==='demo'?'试试其他关键词或筛选条件。':model.assets.length ? '试试其他关键词或筛选条件，或者上传一份新资产。' : '此空间还没有资产。上传一个 SVG，建立第一份设计记录。';
}
function setUpload(info, filename='所选图标') {
  model.upload=info; const preview=$('catalog-file-preview'); preview.replaceChildren(image(info.svg,filename)); $('catalog-file-name').textContent=`${filename} · ${info.width} × ${info.height}`;updateUploadCheck();
}
function openUpload(asset=null) {
  model.editing=asset; model.upload=null;
  const form=$('catalog-upload-form'); form.reset(); $('catalog-file-preview').textContent='＋ 选择或拖入 SVG'; $('catalog-file-name').textContent='支持线性、面型与多色图标，最大 1MB';
  $('catalog-upload-error').hidden=true;
  $('catalog-upload-title').textContent=asset?'更新图标版本':'登记图标资产'; $('catalog-save').textContent=asset?'保存新版本':'确认入库';
  if(asset) {const dims=classification(asset);for(const key of Object.keys(dims))form.elements.namedItem(key).value=dims[key]||'';for(const key of ['name','state_name','source_url','note']) form.elements.namedItem(key).value=asset[key] || ''; form.elements.namedItem('tags').value=(asset.tags||[]).join(', '); setUpload(cleanSVG(asset.svg),asset.name);}
  updateUploadCheck();render(); openDialog('catalog-upload');
}
async function readUpload(file) {
  if(!file) return;
  if(file.size>1024*1024) throw Error('SVG 最大为 1MB。');
  setUpload(cleanSVG(await file.text()),file.name);
  const input=$('catalog-upload-form').elements.namedItem('name'); if(!input.value) input.value=file.name.replace(/\.svg$/i,'');
}
async function saveUpload(event) {
  event.preventDefault(); const save=$('catalog-save'); save.disabled=true; $('catalog-upload-error').hidden=true;
  try {
    if(!model.upload) throw Error('请先选择 SVG 文件。');
    const fields=Object.fromEntries(new FormData($('catalog-upload-form')));
    // Preserve ambiguous legacy labels on an ordinary metadata edit.
    if(model.editing){const old=classification(model.editing);if((fields.structure||null)===old.structure)fields.visual_type=model.editing.visual_type;if((fields.target_platform||null)===old.target_platform)fields.platform=model.editing.platform;}
    const metadata=normalizeMetadata(fields);
    let result;
    if(model.mode==='cloud') {
      result=await model.client.rpc('il_save_asset',{p_workspace_id:model.workspace,p_meta:{...metadata,width:model.upload.width,height:model.upload.height,source_key:sourceKey(metadata.source_url)},p_svg:model.upload.svg,p_asset_id:model.editing?.id||null,p_expected_version:model.editing?.version||null});
    } else {
      result=localSave(await localRecords(),metadata,model.upload,await sha256(model.upload.svg),model.editing?.id,model.editing?.version);
      if(result.result==='created'||result.result==='updated') persistLocal(result.records);
    }
    if(result.result==='duplicate') { $('catalog-upload-error').textContent=`发现已有资产“${result.asset.name}” v${result.asset.version}。请先核对已有版本。`; $('catalog-upload-error').hidden=false;
      const open=button('查看已有资产',()=>{$('catalog-upload').close(); run(()=>showDetail(result.asset));}); $('catalog-upload-error').append(open); return;
    }
    $('catalog-upload').close(); await refresh(); await showDetail(result.asset);
    $('catalog-detail-content').prepend(el('p',result.result==='unchanged'?'内容与信息未变化，保留原版本。':result.result==='updated'?'新版本已保存，历史版本仍可查看。':model.mode==='cloud'?'已保存到云端空间，可直接查看、下载或继续编辑。':'已保存到本地，可直接试用。','catalog-success'));
  } catch(e) {$('catalog-upload-error').textContent=e.message; $('catalog-upload-error').hidden=false;} finally {save.disabled=false;}
}
function showDemoDetail(asset) {
  model.selected=asset;$('catalog-detail-title').textContent=asset.name;
  const content=$('catalog-detail-content');content.replaceChildren();
  const preview=el('div',undefined,'catalog-detail-preview');preview.append(image(asset.svg,asset.name));
  const properties=el('dl',undefined,'catalog-properties');
  for(const [label,value] of [['结构',classificationLabel('structure',classification(asset).structure)],['风格',classificationLabel('visual_style',classification(asset).visual_style)],['画布',asset.width+' × '+asset.height],['来源','Icon Lab 内置演示素材']])properties.append(el('dt',label),el('dd',value));
  const overview=el('div',undefined,'catalog-detail-summary');overview.append(preview,properties);
  const checks=el('section');checks.id='catalog-detail-check';
  content.append(overview,el('span','演示素材','catalog-badge demo'),el('p','内置基础图标，用于体验与复用。下载或用于动效不会自动上传；保存后才会进入你的资产。','catalog-hint'),checks);updateDetailCheck();
  const use=target=>{$('catalog-detail').close();window.iconflow.useCatalogSVG(asset.svg,asset.name,target);};
  const save=button(model.mode==='cloud'?'保存到空间资产':'保存到我的资产',()=>{
    $('catalog-detail').close();openUpload();setUpload(cleanSVG(asset.svg),asset.name);
    const form=$('catalog-upload-form');form.elements.namedItem('name').value=asset.name;for(const [key,value] of Object.entries(classification(asset)))form.elements.namedItem(key).value=value||'';updateUploadCheck();
    form.elements.namedItem('tags').value=asset.tags.filter(t=>t!=='演示').join(', ');
    form.elements.namedItem('note').value='来自 Icon Lab 内置演示素材。';
  });
  save.disabled=model.mode==='cloud' && (!model.client?.session || model.role==='viewer');
  $('catalog-detail-actions').replaceChildren(button('下载 SVG',()=>download(asset.svg,asset.id.replace(':','-')+'.svg','image/svg+xml')),copyCodeButton(asset),button('用作起始状态',()=>use('from')),button('用作目标状态',()=>use('to')),save);
  openDialog('catalog-detail');
}
async function showDetail(asset) {
  if(asset.kind==='demo')return showDemoDetail(asset);
  model.selected=asset; $('catalog-detail-title').textContent=asset.name;
  const content=$('catalog-detail-content'); content.replaceChildren();
  const preview=el('div',undefined,'catalog-detail-preview');let svgCheck='通过基础结构与尺寸检查';try {preview.append(image(asset.svg,asset.name));} catch {svgCheck='未通过当前 SVG 检查';preview.textContent='此文件无法安全预览';}
  const properties=el('dl',undefined,'catalog-properties');
  for(const [label,value] of [['图形结构',classificationLabel('structure',classification(asset).structure)],['视觉风格',classificationLabel('visual_style',classification(asset).visual_style)],['颜色模式',classificationLabel('color_mode',classification(asset).color_mode)],['平台',classificationLabel('target_platform',classification(asset).target_platform)],['状态',asset.state_name],['版本','v'+asset.version],['画布',asset.width+' × '+asset.height],['保存状态',assetLabel(asset)]]) properties.append(el('dt',label),el('dd',value));
  const overview=el('div',undefined,'catalog-detail-summary');overview.append(preview,properties);
  const extra=el('details',undefined,'catalog-detail-extra');extra.append(el('summary','更多信息'));
  const extraProperties=el('dl',undefined,'catalog-properties catalog-extra-properties');
  for(const [label,value] of [['语义标签',(asset.tags||[]).join('、')||'未填写'],['备注',asset.note||'未填写'],['更新时间',new Date(asset.updated_at||asset.created_at).toLocaleString('zh-CN')],['SVG 检查',svgCheck]])extraProperties.append(el('dt',label),el('dd',value));
  extra.append(extraProperties);
  const source=el('div',undefined,'catalog-source'); source.append(el('strong','原始来源'));
  if(asset.source_url) {try {const link=el('a','打开原始设计 ↗','catalog-link'); link.href=normalizeMetadata(asset).source_url; link.target='_blank'; link.rel='noreferrer noopener';source.append(link);}catch{source.append(el('p','来源链接无效'));}} else source.append(el('p','未填写来源，可通过更新版本补充。'));
  const historyDetails=el('details',undefined,'catalog-detail-history');
  const historySummary=el('summary','版本记录');
  const history=el('div',undefined,'catalog-history');historyDetails.append(historySummary,history);
  const checks=el('section');checks.id='catalog-detail-check';
  content.append(overview,source,checks,extra,historyDetails);updateDetailCheck();
  const edit=button('更新版本',()=>{$('catalog-detail').close();openUpload(asset);},'button primary'); edit.disabled=model.mode==='cloud' && (model.role==='viewer'||!model.client?.session);
  const actions=$('catalog-detail-actions'); actions.replaceChildren(button('下载 SVG',()=>{try{download(cleanSVG(asset.svg).svg,asset.name.replace(/[^\p{L}\p{N}_-]/gu,'_')+'.svg','image/svg+xml');}catch(e){showError(e);}}),copyCodeButton(asset),button('用于状态动效',()=>{$('catalog-detail').close(); window.iconflow.useCatalogSVG(cleanSVG(asset.svg).svg,asset.name);}),edit);
  openDialog('catalog-detail');
  try {
    const revisions=model.mode==='cloud' ? await model.client.revisions(asset.id) : asset.revisions||[];
    if(model.selected?.id!==asset.id) return;
    historySummary.textContent='版本记录 · '+revisions.length+(revisions.length>=100?'（最近）':'');
    revisions.forEach(r=>{const row=el('div');row.append(el('span',`v${r.version} · ${new Date(r.created_at).toLocaleString('zh-CN')}`),button('下载此版本',()=>download(cleanSVG(r.svg).svg,`${asset.name}-v${r.version}.svg`,'image/svg+xml'),'text-button'));history.append(row);});
    if(!revisions.length) history.textContent='暂无版本记录。';
    if(revisions.length>=100)history.append(el('p','这里展示最近 100 个版本。','catalog-hint'));
  } catch(e) {history.textContent='版本记录暂时无法读取：'+e.message;}
}
async function connectAccount() {
  const client=model.client;
  if(!client?.session) throw Error('请先登录。');
  model.user=client.session.user;
  let spaces=await client.workspaces();
  if(!spaces.length) {await client.rpc('il_create_workspace',{p_name:'我的图标库'});spaces=await client.workspaces();}
  if(!spaces.length) throw Error('无法读取工作空间，请检查建表与权限配置。');
  model.workspaces=spaces;model.workspace=spaces.find(s=>s.id===localStorage.getItem('iconlab.workspace:'+client.config.url))?.id||spaces[0].id;
  model.role=await client.role(model.workspace,model.user.id); model.mode='cloud';model.assets=[];
  const select=$('catalog-workspace'); select.replaceChildren(...spaces.map(s=>option(s.name,s.id)));select.value=model.workspace;
  $('catalog-members').hidden=spaces.find(s=>s.id===model.workspace)?.owner_id!==model.user?.id;
  await standards.load();render(); await refresh(); $('catalog-connection').close();
}
function connection() {
  const c=model.client?.config||cloudConfig;
  $('catalog-url').value=c.url||''; $('catalog-key').value=c.key||''; $('catalog-auth-message').textContent=''; $('catalog-advanced').open=false; openDialog('catalog-connection');
}
$('catalog-config-form').onsubmit=e=>{e.preventDefault();try {if(model.mode==='cloud') throw Error('请先退出当前账号，再更换后端。'); const config=validateConfig($('catalog-url').value.trim(),$('catalog-key').value.trim()); localStorage.setItem(CONFIG_KEY,JSON.stringify(config));model.client=new CloudClient(config);$('catalog-auth-message').textContent='配置已保存在本机，请登录。';}catch(e){$('catalog-auth-message').textContent=e.message;}};
async function authenticate(signup=false) {
  $('catalog-login').disabled=true;$('catalog-register').disabled=true;
  try {
    if(!model.client) throw Error('请先保存连接配置。');
    if(!$('catalog-auth-form').reportValidity()) return;
    const email=$('catalog-email').value.trim(),password=$('catalog-password').value;
    if(signup) {const data=await model.client.signUp(email,password); if(!data.access_token) {$('catalog-auth-message').textContent='如需验证邮箱，请在邮件中确认后返回这里登录。';return;}}
    else await model.client.signIn(email,password);
    $('catalog-password').value=''; await connectAccount();
  }catch(e){$('catalog-auth-message').textContent=e.message;} finally {$('catalog-login').disabled=false;$('catalog-register').disabled=false;}
}
$('catalog-auth-form').onsubmit=e=>{e.preventDefault();authenticate();}; $('catalog-register').onclick=()=>authenticate(true);
$('catalog-add').onclick=()=>openUpload(); $('catalog-upload-form').onsubmit=saveUpload;
$('catalog-file').onchange=()=>readUpload($('catalog-file').files[0]).catch(e=>{$('catalog-upload-error').textContent=e.message;$('catalog-upload-error').hidden=false;});
$('catalog-drop').ondragover=e=>{e.preventDefault();}; $('catalog-drop').ondrop=e=>{e.preventDefault();readUpload(e.dataTransfer.files[0]).catch(e=>{$('catalog-upload-error').textContent=e.message;$('catalog-upload-error').hidden=false;});};
['catalog-search','catalog-platform','catalog-type','catalog-style','catalog-color-mode'].forEach(id=>$(id).addEventListener(id==='catalog-search'?'input':'change',render));
function resetFilters(){['catalog-search','catalog-platform','catalog-type','catalog-style','catalog-color-mode'].forEach(id=>$(id).value='');model.scope='all';render();}
$('catalog-clear').onclick=resetFilters;$('catalog-reset').onclick=resetFilters;
$('catalog-refresh').onclick=()=>run(async()=>{await standards.load();await refresh();});
document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>setScope(b.dataset.scope));
$('catalog-workspace').onchange=()=>run(async()=>{model.workspace=$('catalog-workspace').value;localStorage.setItem('iconlab.workspace:'+model.client.config.url,model.workspace);model.assets=[]; model.role=await model.client.role(model.workspace,model.user.id); $('catalog-members').hidden=model.workspaces.find(s=>s.id===model.workspace)?.owner_id!==model.user?.id; await standards.load();render();await refresh();});
$('catalog-new-workspace').onclick=()=>{const name=prompt('工作空间名称');if(name?.trim())run(async()=>{await model.client.rpc('il_create_workspace',{p_name:name.trim()});await connectAccount();});};
$('catalog-members').onclick=()=>{$('catalog-member-message').textContent='';openDialog('catalog-member-dialog');};
$('catalog-member-form').onsubmit=async e=>{e.preventDefault(); const b=e.submitter;b.disabled=true;try{const d=Object.fromEntries(new FormData(e.target));await model.client.rpc('il_add_member',{p_workspace_id:model.workspace,p_email:d.email,p_role:d.role});$('catalog-member-message').textContent='成员权限已保存。对方登录后刷新即可选择此空间。';}catch(e){$('catalog-member-message').textContent=e.message;}finally{b.disabled=false;}};
$('catalog-signout').onclick=()=>run(async()=>{try{await model.client.signOut();}finally{model.mode='local';model.user=null;model.workspace=null;model.assets=[];model.generation++;await standards.load();await refresh();}});
$('catalog-backup').onclick=()=>run(async()=>{download(JSON.stringify({format:'iconlab-catalog',version:1,exported_at:new Date().toISOString(),scope:model.mode,assets:model.assets},null,2),'icon-lab-assets.json');});
$('catalog-restore').onchange=()=>run(async()=>{
  const file=$('catalog-restore').files[0];if(!file)return;
  if(model.mode==='cloud') throw Error('请退出云端后导入到本地试用，再逐项核对后登记到云端。');
  if(file.size>15*1024*1024)throw Error('备份文件超过 15MB。');
  const data=JSON.parse(await file.text());if(data.format!=='iconlab-catalog'||data.version!==1||!Array.isArray(data.assets)||data.assets.length>500)throw Error('不支持此备份格式；此入口用于资产库备份。');
  let records=await localRecords(), count=0;
  for(const asset of data.assets){const metadata=normalizeMetadata(asset),info=cleanSVG(asset.svg);const saved=localSave(records,metadata,info,await sha256(info.svg));if(saved.result==='created'){records=saved.records;count++;}}
  // Commit once, only after the entire import validates. Existing assets are never overwritten.
  persistLocal(records);render();$('catalog-message').textContent=`已合并 ${count} 项资产；已有或重复项保留原样。历史版本不会由此入口恢复。`;$('catalog-message').hidden=false;$('catalog-restore').value='';
});
$('catalog-import-legacy').onclick=()=>{
  const assets=window.iconflow.staticAssets();
  if(!assets.length){showError(Error('旧工作台尚未保存静态图标。请先在“同风格生成”保存到项目资产。'));return;}
  const modal=$('catalog-detail');$('catalog-detail-title').textContent='选择要登记的本地图标';$('catalog-detail-actions').replaceChildren();const content=$('catalog-detail-content');content.replaceChildren(el('p','选择一项后补充信息，确认前不会上传。','catalog-hint'));
  assets.forEach(a=>content.append(button(a.name,()=>{modal.close();openUpload();setUpload(cleanSVG(a.svg),a.name);$('catalog-upload-form').elements.namedItem('name').value=a.name;})));openDialog('catalog-detail');
};


function openAccountSettings() {
  if(window.location.hash!=='#account-settings') return;
  showCatalog(); connection();
}
window.addEventListener('hashchange',openAccountSettings);
$('catalog-connection').addEventListener('close',()=>{
  if(window.location.hash==='#account-settings') window.history.replaceState(null,'',window.location.pathname+window.location.search);
});

async function init() {
  let config=cloudConfig;try{config=JSON.parse(localStorage.getItem(CONFIG_KEY))||config;}catch{}
  if(config.url && config.key) {try{model.client=new CloudClient(config);}catch(e){showError(e);}}
  model.demos=await demoRecords();
  model.assets=await localRecords();
  await standards.load();
  if(model.client?.session) {try{await connectAccount();}catch(e){model.mode='cloud';model.assets=[];render();showError(Error('云端暂时不可用：'+e.message+'。可退出登录使用本地试用。'));}}
  render(); if(localStorage.getItem('iconlab.lastView')!=='workbench')showCatalog();
  openAccountSettings();
}
init().catch(showError);
