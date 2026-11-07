import {iconToCubics} from './vendor/morphicons/index.js';

export function normalizeSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.canvas !== 24) throw Error('AI 规范只支持 24 × 24 画布。');
  if (!Number.isFinite(value.stroke) || value.stroke < 0.5 || value.stroke > 4) throw Error('描边宽度应为 0.5–4。');
  if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color)) throw Error('图标颜色应为六位十六进制色值。');
  if (!['round','butt','square'].includes(value.cap)) throw Error('描边端点无效。');
  if (!['round','miter','bevel'].includes(value.join)) throw Error('描边连接无效。');
  if (!Number.isFinite(value.padding) || value.padding < 0 || value.padding > 5) throw Error('安全留白应为 0–5。');
  if (typeof value.styleNotes !== 'string' || value.styleNotes.length > 1000) throw Error('风格说明最长为 1000 字符。');
  return {canvas:24,stroke:value.stroke,color:value.color.toLowerCase(),cap:value.cap,join:value.join,padding:value.padding,styleNotes:value.styleNotes.trim()};
}

function parseGeneratedPath(d) {
  if (typeof d !== 'string' || !d.trim() || d.length > 12000) throw Error('生成路径为空或超过 12000 字符。');
  const tokens = d.match(/[MLCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  if (d.replace(/[MLCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, '').replace(/[\s,]/g, '') || tokens.length > 2048) throw Error('仅支持 M、L、C、Q、Z 绝对路径和有限坐标。');
  const sizes = {M:2,L:2,C:6,Q:4,Z:0};
  if (tokens[0] !== 'M') throw Error('路径必须以绝对坐标 M 开始。');
  let i = 0, moves = 0, segments = 0, hasSegment = false, closed = false;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (!Object.hasOwn(sizes, command)) throw Error('路径必须使用大写 M、L、C、Q、Z。');
    if (closed && command !== 'M') throw Error('闭合子路径后必须用 M 开始新子路径。');
    if (command === 'M') {moves++;closed=false;}
    if (command === 'Z') {closed=true;continue;}
    let count = 0;
    while (i < tokens.length && !/^[a-z]$/i.test(tokens[i])) {
      const number = Number(tokens[i++]);
      if (!Number.isFinite(number) || Math.abs(number) > 10000) throw Error('路径坐标无效或过大。');
      count++;
    }
    if (!count || count % sizes[command]) throw Error(`路径 ${command} 的坐标数量不正确。`);
    segments += count / sizes[command];
    if (command !== 'M' || count > 2) hasSegment = true;
  }
  if (!hasSegment || moves > 32 || segments > 128) throw Error('路径为空或过于复杂；最多 32 个子路径、128 段。');
  const paths = iconToCubics([['path',{d}]]);
  if (paths.length !== moves || paths.some(p => p.pts.length < 8 || [...p.pts].some(n => !Number.isFinite(n)))) throw Error('生成路径包含空或退化的子路径。');
  return paths;
}

function generatedGeometryKey(paths) {
  const aligned = (a,b,c) => Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) < 1e-9;
  return JSON.stringify(paths.map(path => {
    const segments = [];
    for (let i=0;i+7<path.pts.length;i+=6) {
      const points = Array.from({length:4},(_,j)=>[path.pts[i+j*2],path.pts[i+j*2+1]]);
      const [a,b,c,d] = points, dx=d[0]-a[0], dy=d[1]-a[1], length=dx*dx+dy*dy;
      const t1=((b[0]-a[0])*dx+(b[1]-a[1])*dy)/length, t2=((c[0]-a[0])*dx+(c[1]-a[1])*dy)/length;
      const line = length>0 && aligned(a,d,b) && aligned(a,d,c) && t1>=0 && t1<=t2 && t2<=1;
      const previous = segments.at(-1);
      if (line && previous?.length===2 && aligned(previous[0],a,d) && (a[0]-previous[0][0])*dx+(a[1]-previous[0][1])*dy>=0) previous[1]=d;
      else segments.push(line?[a,d]:points);
    }
    const directions = [segments,segments.slice().reverse().map(segment=>segment.slice().reverse())];
    const keys = directions.flatMap(direction=>path.closed?direction.map((_,i)=>JSON.stringify([...direction.slice(i),...direction.slice(0,i)])):[JSON.stringify(direction)]);
    return JSON.stringify({closed:path.closed,segments:keys.sort()[0]});
  }).sort());
}

function extrema(a, b, c, d) {
  const values = [a,d], A = -a + 3*b - 3*c + d, B = 2*(a - 2*b + c), C = b-a;
  const roots = [];
  if (Math.abs(A) < 1e-12) {if (Math.abs(B) > 1e-12) roots.push(-C/B);}
  else {
    const discriminant = B*B - 4*A*C;
    if (discriminant >= 0) roots.push((-B+Math.sqrt(discriminant))/(2*A),(-B-Math.sqrt(discriminant))/(2*A));
  }
  for (const t of roots) if (t > 0 && t < 1) {const u = 1-t;values.push(u*u*u*a + 3*u*u*t*b + 3*u*t*t*c + t*t*t*d);}
  return values;
}

export function validateGeneratedIcon(value, definition) {
  const spec = normalizeSpec(definition);
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw Error('生成图标需要 1–80 字符的名称。');
  const paths = parseGeneratedPath(value.d);
  const xs = [], ys = [];
  for (const path of paths) for (let i = 0; i+7 < path.pts.length; i += 6) {
    const p = path.pts;
    xs.push(...extrema(p[i],p[i+2],p[i+4],p[i+6]));
    ys.push(...extrema(p[i+1],p[i+3],p[i+5],p[i+7]));
  }
  if (!xs.length || !ys.length) throw Error('生成图标没有可见路径。');
  const radius = spec.stroke/2 * (spec.join === 'miter' ? 4 : spec.cap === 'square' ? Math.SQRT2 : 1);
  const bounds = {left:Math.min(...xs)-radius,top:Math.min(...ys)-radius,right:Math.max(...xs)+radius,bottom:Math.max(...ys)+radius};
  if (bounds.left < spec.padding-1e-6 || bounds.top < spec.padding-1e-6 || bounds.right > 24-spec.padding+1e-6 || bounds.bottom > 24-spec.padding+1e-6) throw Error(`路径或描边超出安全区域；保守描边边界需位于 ${spec.padding}–${24-spec.padding}。`);
  if (Math.max(...xs)-Math.min(...xs) < 0.01 && Math.max(...ys)-Math.min(...ys) < 0.01) throw Error('生成图标退化为一个点。');
  return {name:value.name.trim(),d:value.d.trim(),stroke:spec.stroke,color:spec.color,cap:spec.cap,join:spec.join,fill:false,spec,validation:{status:'pass',bounds,manual:'图标语义、视觉重心与风格一致性仍需人工确认。'}};
}

export function validateGeneratedIcons(value, definition) {
  if (!Array.isArray(value) || value.length !== 3) throw Error('必须返回恰好 3 个候选图标。');
  const seen = new Set();
  return value.map((item, index) => {
    let icon;
    try { icon = validateGeneratedIcon(item, definition); }
    catch (error) { throw Error(`候选 ${index+1}：${error.message}`); }
    const geometry = generatedGeometryKey(parseGeneratedPath(icon.d));
    if (seen.has(geometry)) throw Error(`候选 ${index+1} 与其他候选路径重复，请提供不同构图。`);
    seen.add(geometry);
    return icon;
  });
}

export function generatedSVG(icon, size = 24) {
  const safe = validateGeneratedIcon(icon,icon.spec);
  if (![16,24,32,64,106,128,256].includes(size)) throw Error('预览尺寸无效。');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${safe.color}" stroke-width="${safe.stroke}" stroke-linecap="${safe.cap}" stroke-linejoin="${safe.join}" stroke-miterlimit="4"><path d="${safe.d}"/></svg>`;
}
