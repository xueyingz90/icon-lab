import {cleanSVG, normalizeMetadata, sourceKey} from '../../catalog-core.js';

export function selectionSource(selection, input='') {
  if(!selection || !/^(?:I)?\d[\d:;I-]*$/.test(selection.nodeId || '')) throw Error('所选节点 ID 无效，请重新读取图标。');
  let key=selection.fileKey || '';
  if(input.trim()) {
    let url;try {url=new URL(input.trim());}catch{throw Error('请粘贴当前 Figma 设计文件的完整链接。');}
    const match=url.pathname.match(/^\/(?:design|file)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if(url.protocol!=='https:' || !['figma.com','www.figma.com'].includes(url.hostname) || url.username || url.password || !match) throw Error('来源必须是 Figma Design 文件链接。');
    if(key && key!==match[1]) throw Error('链接与当前文件不一致，请粘贴当前设计文件链接。');
    key=match[1];
  }
  if(!key) throw Error('请粘贴当前设计文件链接，以保留图标来源。');
  if(!/^[A-Za-z0-9_-]+$/.test(key)) throw Error('Figma 文件 Key 无效。');
  const url=new URL('https://www.figma.com/design/'+key+'/Icon-Lab');
  url.searchParams.set('node-id',selection.nodeId.replaceAll(':','-'));
  return url.href;
}
export function prepareSelection(selection, fields) {
  if(!selection?.svg) throw Error('请先选中并读取一个图标。');
  const info=cleanSVG(selection.svg);
  const meta=normalizeMetadata({...fields,source_url:selectionSource(selection,fields.source_url)});
  return {svg:info.svg,meta:{...meta,width:info.width,height:info.height,source_key:sourceKey(meta.source_url)},token:selection.token,nodeId:selection.nodeId};
}
export async function syncSelection(client, workspaceId, prepared, previous=null) {
  if(!workspaceId) throw Error('请先选择工作空间。');
  return client.rpc('il_save_asset',{p_workspace_id:workspaceId,p_meta:prepared.meta,p_svg:prepared.svg,p_asset_id:previous?.id || null,p_expected_version:previous?.version || null});
}
export function memoryStorage() {
  const values=new Map();
  return {getItem:key=>values.get(key) || null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
export function syncError(error) {
  const message=error?.message || String(error);
  if(/Invalid login credentials/i.test(message)) return '邮箱或密码不正确，请使用工作台账号登录。';
  if(/Email not confirmed/i.test(message)) return '邮箱尚未确认，请先打开注册确认邮件。';
  if(/版本已变化/.test(message)) return '资产已被更新，本次未覆盖。请再次点击同步，检查最新版本后再确认更新。';
  if(/Failed to fetch|NetworkError|TimeoutError|aborted/i.test(message)) return '连接未完成。请检查网络；若同步结果不确定，可重新同步，系统会检查重复。';
  if(/不支持.*(?:元素|属性)|内部资源|动态样式/.test(message)) return message+' 请移除该效果或嵌入图片，再重新读取；不会静默修改原图。';
  return message;
}
