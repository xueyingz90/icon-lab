export const MAX_SVG_BYTES = 1024 * 1024;
const elements = new Set('svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc'.split(' '));
const attrs = new Set('xmlns viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity transform id gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod fx fy fr clip-path mask maskUnits maskContentUnits clipPathUnits preserveAspectRatio vector-effect'.split(' '));
const styles = new Set('fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity stop-color stop-opacity'.split(' '));
export function cleanSVG(input) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_SVG_BYTES) throw Error('SVG 最大为 1MB。');
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw Error('不支持带文档类型或实体声明的 SVG。');
  const doc = new DOMParser().parseFromString(input, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw Error('文件不是有效 SVG。');
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (nodes.length > 10000) throw Error('图标结构过于复杂。');
  const ids = new Set();
  for (const node of nodes) {
    if (!elements.has(node.localName) || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/2000/svg')) throw Error('含不支持的图形元素：' + node.localName);
    const id = node.getAttribute('id');
    if (id) { if (!/^[A-Za-z_][\w.:-]*$/.test(id) || ids.has(id)) throw Error('SVG 内部 ID 无效或重复。'); ids.add(id); }
  }
  const safeValue = value => {
    if (/[\\\u0000-\u001f]|\/\*|javascript:|data:|https?:|expression\s*\(/i.test(value)) throw Error('不支持外部资源或动态样式。');
    const rest = value.replace(/url\(\s*['"]?#([\w.:-]+)['"]?\s*\)/gi, (_, id) => { if (!ids.has(id)) throw Error('内部资源引用不存在。'); return ''; });
    if (/url|[<>]/i.test(rest)) throw Error('不支持此资源引用。');
    return value;
  };
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'style') {
        for (const rule of attr.value.split(';').filter(s => s.trim())) {
          const i = rule.indexOf(':'), key = rule.slice(0, i).trim(), value = rule.slice(i + 1).trim();
          if (i < 0 || !styles.has(key)) throw Error('样式包含不支持的属性。');
          node.setAttribute(key, safeValue(value));
        }
        node.removeAttribute('style');
      } else if (attr.name === 'xmlns') {
        if (attr.value !== 'http://www.w3.org/2000/svg') throw Error('SVG 命名空间无效。');
      } else {
        if (!attrs.has(attr.name)) throw Error('不支持此 SVG 属性：' + attr.name);
        safeValue(attr.value);
      }
    }
  }
  let box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite)) {
    const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
    if (!(width > 0 && height > 0)) throw Error('SVG 需要有效的 viewBox 或数字宽高。');
    box = [0, 0, width, height];
  }
  if (box[2] <= 0 || box[3] <= 0 || box.some(n => Math.abs(n) > 100000)) throw Error('SVG 画布尺寸无效。');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('viewBox', box.join(' '));
  root.setAttribute('width', String(box[2])); root.setAttribute('height', String(box[3]));
  const svg = new XMLSerializer().serializeToString(root);
  return {svg, width: box[2], height: box[3]};
}
export function validSource(value) {
  if (!value?.trim()) return '';
  if (value.length > 2000) throw Error('来源链接最长为 2000 字符。');
  let u; try {u = new URL(value.trim());} catch {throw Error('来源需要填写完整 HTTPS 链接。');}
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('来源仅支持 HTTPS 链接。');
  return u.href;
}
export function sourceKey(value) {
  if (!value) return '';
  const u = new URL(validSource(value));
  if (u.hostname === 'www.figma.com' || u.hostname === 'figma.com') {
    const match = u.pathname.match(/^\/(?:design|file)\/([^/]+)/);
    const node = u.searchParams.get('node-id');
    if (match && node) return `figma:${match[1]}:${node.replaceAll('-', ':')}`;
  }
  return u.href;
}
export async function sha256(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');}
export function normalizeMetadata(input) {
  const text = (value, max) => String(value || '').trim().slice(0, max);
  const name = text(input.name, 100); if (!name) throw Error('请填写图标名称。');
  const tags = Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[,，、\n]/);
  return {name, tags:[...new Set(tags.map(s => text(s, 30)).filter(Boolean))].slice(0, 12), platform:text(input.platform, 30) || '通用', visual_type:text(input.visual_type, 30) || '线性', state_name:text(input.state_name, 30) || '默认', source_url:validSource(input.source_url), note:text(input.note, 500)};
}
export function matchesAsset(asset, query, platform = '', type = '') {
  const haystack = [asset.name, ...(asset.tags || []), asset.platform, asset.state_name].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => haystack.includes(word)) && (!platform || asset.platform === platform) && (!type || asset.visual_type === type);
}
export function localSave(records, metadata, svgInfo, hash, assetId = null, expectedVersion = null) {
  const source_key = sourceKey(metadata.source_url);
  let previous = assetId && records.find(a => a.id === assetId);
  if (assetId && !previous) throw Error('资产已不存在，请刷新。');
  if (!previous && source_key) previous = records.find(a => a.source_key === source_key && a.platform === metadata.platform && a.visual_type === metadata.visual_type && a.state_name === metadata.state_name);
  if (!previous) previous = records.find(a => a.content_hash === hash && a.platform === metadata.platform && a.visual_type === metadata.visual_type && a.state_name === metadata.state_name);
  if (previous && assetId && expectedVersion !== previous.version) throw Error('版本已变化，请刷新后重试。');
  const same = previous && previous.content_hash === hash && Object.entries(metadata).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value));
  if (same) return {records, asset:previous, result:'unchanged'};
  if (previous && !assetId) return {records, asset:previous, result:'duplicate'};
  const revision = {id:crypto.randomUUID(), ...metadata, ...svgInfo, content_hash:hash, version:(previous?.version || 0) + 1, created_at:new Date().toISOString()};
  const asset = {...revision, id:previous?.id || crypto.randomUUID(), source_key, revisions:[revision, ...(previous?.revisions || [])], created_at:previous?.created_at || revision.created_at, updated_at:revision.created_at};
  return {records:[asset, ...records.filter(a => a.id !== asset.id)], asset, result:previous ? 'updated' : 'created'};
}
