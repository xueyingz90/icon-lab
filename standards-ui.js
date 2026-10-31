import {EXAMPLE_STANDARD,normalizeStandard,checkSVGStandard,applicableStandard} from './standards-core.js';

const devicePlatforms=['通用','App','AI 眼镜','其他设备'];
const standardLocalKey='iconlab.standards.local.v1';
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function createStandardsUI({context,onChange}) {
  let profiles=[],loadedKey='',loadError='',generation=0,platform='通用',busy=false;
  const drafts=new Map();
  const scopeKey=()=>{const c=context();return c.mode==='cloud'?'cloud:'+c.client?.config.url+':'+c.workspace+':'+c.user?.id:'local';};
  const dialog=node('dialog',undefined,'catalog-dialog standard-dialog');dialog.id='catalog-standards-dialog';dialog.setAttribute('aria-labelledby','standard-title');
  dialog.innerHTML=`<div class="catalog-dialog-head"><div><span class="eyebrow">ICON STANDARDS</span><h2 id="standard-title">图标规范</h2></div><button class="icon-button" type="button" id="standard-close" aria-label="关闭图标规范">×</button></div><div class="standard-body"><p id="standard-scope" class="catalog-hint"></p><label class="standard-device">适用设备<select id="standard-platform"></select></label><p class="standard-version" id="standard-version"></p><form id="standard-form" class="catalog-form-grid"><label class="catalog-full">规范名称<input name="name" maxlength="80" required></label><label>画布宽度<input name="width" type="number" min="1" max="2048" step="any" required></label><label>画布高度<input name="height" type="number" min="1" max="2048" step="any" required></label><label class="standard-toggle catalog-full"><input name="stroke_enabled" type="checkbox">检查描边粗细</label><label class="catalog-full">允许描边（SVG 设计单位）<input name="stroke_widths" placeholder="例如：1.5, 2"><small>多个值用逗号分隔；允许 0.05 的数值误差。转轮廓图形将提示人工确认。</small></label><label class="standard-toggle catalog-full"><input name="colors_enabled" type="checkbox">检查图标颜色</label><label class="catalog-full">允许颜色<input name="colors" placeholder="#30343b, currentColor"><small>支持 HEX 色值和 currentColor；会检查可读取的渐变色标。</small></label><label class="standard-toggle catalog-full"><input name="allow_gradients" type="checkbox">允许渐变</label><label class="standard-toggle catalog-full"><input name="safe_enabled" type="checkbox">检查安全区域</label><label class="catalog-full">四周最小留白（SVG 设计单位）<input name="safe_inset" type="number" min="0" step="any" required><small>基于图形和可计算描边的几何边界；复杂裁剪、圆弧等将提示人工确认。</small></label></form><p class="catalog-hint">示例仅供编辑参考，保存后才应用。检查会提示偏差，不改动 SVG，也不阻止保存。</p><p id="standard-message" role="status" class="catalog-hint"></p></div><div class="catalog-dialog-actions"><button type="button" id="standard-example" class="button">载入示例</button><button type="button" id="standard-reload" class="button">重新载入</button><button type="submit" form="standard-form" id="standard-save" class="button primary">保存并应用</button></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id),form=$('standard-form');
  devicePlatforms.forEach(p=>{const option=node('option',p);option.value=p;$('standard-platform').append(option);});
  const canEdit=()=>context().mode!=='cloud'||context().role==='owner';
  const current=()=>loadedKey===scopeKey()?profiles.find(p=>p.platform===platform):null;
  function controls(){form.querySelectorAll('input').forEach(n=>n.disabled=busy||!canEdit());$('standard-save').disabled=busy||!canEdit()||!!loadError;$('standard-example').disabled=busy||!canEdit();$('standard-reload').disabled=busy;$('standard-platform').disabled=busy;}
  function rawForm(){return Object.fromEntries(Array.from(form.elements).filter(n=>n.name).map(n=>[n.name,n.type==='checkbox'?n.checked:n.value]));}
  function fill(){
    const key=scopeKey()+':'+platform,profile=current();if(!canEdit())drafts.delete(key);
    const draft=drafts.get(key),definition=draft?.dirty?draft.raw:profile?.definition||EXAMPLE_STANDARD;
    for(const field of form.elements){if(!field.name)continue;const value=definition[field.name];if(field.type==='checkbox')field.checked=!!value;else field.value=Array.isArray(value)?value.join(', '):value??'';}
    if(!draft?.dirty)drafts.set(key,{raw:{...definition},expectedVersion:profile?.version||0,dirty:false});
    $('standard-version').textContent=(profile?`${profile.definition.name} · v${profile.version}`:'未设置规范 · 当前为示例草稿')+(draft?.dirty&&draft.expectedVersion!==(profile?.version||0)?' · 草稿基于旧版，请重新载入':'');
    $('standard-scope').textContent=context().mode==='cloud'?(canEdit()?'当前云端空间共用此规范；仅空间所有者可以修改。':'此空间规范为只读，修改请联系空间所有者。'):'仅保存在当前浏览器；本地规范与云端空间分开保存。';
    $('standard-message').textContent=loadError;controls();
  }
  async function load(){
    const key=scopeKey(),request=++generation;loadedKey='';loadError='';profiles=[];
    try{
      const c=context();const data=c.mode==='cloud'?await c.client.standards(c.workspace):JSON.parse(localStorage.getItem(standardLocalKey)||'[]');
      if(!Array.isArray(data))throw Error('规范记录格式异常。');
      for(const p of data){normalizeStandard(p.definition);if(!p.platform || !Number.isInteger(p.version)||p.version<1)throw Error('规范记录格式异常。');}
      if(request!==generation || key!==scopeKey())return;
      profiles=data;loadedKey=key;
    }catch(e){if(request!==generation || key!==scopeKey())return;loadedKey=key;loadError='规范暂时无法读取：'+e.message;}
    if(dialog.open)fill();onChange?.();
  }
  async function open(selected='通用'){
    platform=devicePlatforms.includes(selected)?selected:'通用';$('standard-platform').value=platform;
    if(loadedKey!==scopeKey())await load();
    fill();if(!dialog.open)dialog.showModal();
  }
  form.addEventListener('input',()=>{const key=scopeKey()+':'+platform,draft=drafts.get(key);drafts.set(key,{raw:rawForm(),expectedVersion:draft?.expectedVersion??current()?.version??0,dirty:true});$('standard-message').textContent='有未保存的修改；保存后才用于检查。';});
  $('standard-platform').onchange=()=>{platform=$('standard-platform').value;fill();};
  $('standard-close').onclick=()=>dialog.close();
  $('standard-example').onclick=()=>{const key=scopeKey()+':'+platform,expectedVersion=drafts.get(key)?.expectedVersion??current()?.version??0;drafts.set(key,{raw:{...EXAMPLE_STANDARD},expectedVersion,dirty:true});fill();$('standard-message').textContent='已载入示例草稿，请按实际标准修改并保存。';};
  $('standard-reload').onclick=async()=>{busy=true;controls();drafts.delete(scopeKey()+':'+platform);try{await load();fill();}finally{busy=false;controls();}};
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!canEdit())return;
    const key=scopeKey(),selected=platform;
    try{
      const definition=normalizeStandard({...rawForm(),schema_version:1});
      const expectedVersion=drafts.get(key+':'+selected)?.expectedVersion??current()?.version??0;
      busy=true;controls();let saved;
      const c=context();
      if(c.mode==='cloud')saved=(await c.client.rpc('il_save_standard',{p_workspace_id:c.workspace,p_platform:selected,p_definition:definition,p_expected_version:expectedVersion})).standard;
      else{
        const records=JSON.parse(localStorage.getItem(standardLocalKey)||'[]');const old=records.find(p=>p.platform===selected);
        if((old?.version||0)!==expectedVersion)throw Error('规范版本已变化，请重新载入后再保存。');
        const same=old&&JSON.stringify(old.definition)===JSON.stringify(definition);
        saved=same?old:{id:old?.id||crypto.randomUUID(),platform:selected,definition,version:(old?.version||0)+1,updated_at:new Date().toISOString(),versions:[{version:(old?.version||0)+1,definition},...(old?.versions||[])]};
        localStorage.setItem(standardLocalKey,JSON.stringify([saved,...records.filter(p=>p.platform!==selected)]));
      }
      if(key!==scopeKey())return;
      if(!saved?.definition||!Number.isInteger(saved.version))throw Error('规范保存结果异常，请重新载入核对。');
      drafts.delete(key+':'+selected);await load();fill();$('standard-message').textContent=`已保存并应用 v${saved.version}，当前设备的检查结果已更新。`;
    }catch(e){$('standard-message').textContent=e.message;}finally{busy=false;controls();}
  };
  function renderCheck(container,svg,selected='通用',expanded=false){
    const profile=loadedKey===scopeKey()&&!loadError?applicableStandard(profiles,selected):null;
    const report=checkSVGStandard(svg,profile);container.replaceChildren();
    const details=node('details',undefined,'standard-check');details.open=expanded&&['warning','manual','invalid'].includes(report.status);
    const labels={pass:'未发现规范偏差',warning:`${report.warnings||1} 项提示`,manual:`${report.manual||1} 项需确认`,invalid:'基础检查未通过',unconfigured:'未设置适用规范'};
    const summary=node('summary',loadError?'规范暂不可用 · 未进行设计规范检查':loadedKey!==scopeKey()?'规范尚未载入':labels[report.status] || '规范检查');summary.dataset.status=loadError?'manual':report.status;details.append(summary);
    details.append(node('p',profile?`按当前 ${profile.platform} 规范「${profile.definition.name}」v${profile.version} 检查；不是入库时的历史结论。`:loadError||'仅完成基础 SVG 检查。示例规范不会自动应用。','catalog-hint'));
    for(const item of report.items){const row=node('div',undefined,'standard-check-row');const state={pass:'通过',warning:'提示',manual:'需确认',disabled:'未启用'};row.dataset.status=item.status;row.append(node('strong',item.label+' · '+state[item.status]),node('p',item.detail));details.append(row);}
    const edit=node('button',canEdit()?'设置规范':'查看规范','text-button');edit.type='button';edit.onclick=()=>open(selected);details.append(edit);container.append(details);return report;
  }
  return {load,open,renderCheck};
}
