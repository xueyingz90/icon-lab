import {cleanSVG} from './catalog-core.js';
import {n as iconToCubics} from './vendor/morphicons/normalize-CYnN3Npw.js';

export const EXAMPLE_STANDARD={schema_version:1,name:'线性图标示例规范',width:24,height:24,stroke_enabled:true,stroke_widths:[2],colors_enabled:true,colors:['#30343b','currentColor'],allow_gradients:false,safe_enabled:true,safe_inset:2};
export function normalizeColor(value) {
  let s=String(value).trim().toLowerCase();
  if(s==='currentcolor')return 'currentColor';
  const names={black:'#000000',white:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',gray:'#808080',grey:'#808080',yellow:'#ffff00',cyan:'#00ffff',magenta:'#ff00ff',transparent:'none',none:'none'};
  if(names[s])return names[s];
  if(/^#[\da-f]{3}$/.test(s))return '#'+s.slice(1).split('').map(c=>c+c).join('');
  if(/^#[\da-f]{4}$/.test(s))return s[4]==='0'?'none':'#'+s.slice(1,4).split('').map(c=>c+c).join('');
  if(/^#[\da-f]{6}$/.test(s))return s;
  if(/^#[\da-f]{8}$/.test(s))return s.slice(7)==='00'?'none':s.slice(0,7);
  const rgb=s.match(/^rgba?\(([^)]+)\)$/);
  if(rgb){
    const values=rgb[1].trim().split(/[\s,/]+/);if(values.length<3 || values.length>4)return null;
    const channels=values.slice(0,3).map(v=>v.endsWith('%')?Number(v.slice(0,-1))*2.55:Number(v));
    const alpha=values[3]===undefined?1:values[3].endsWith('%')?Number(values[3].slice(0,-1))/100:Number(values[3]);
    if(!channels.every(n=>Number.isFinite(n)&&n>=0&&n<=255)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
    return alpha===0?'none':'#'+channels.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
  }
  return null;
}
export function normalizeStandard(input) {
  if(input?.schema_version!==1)throw Error('不支持此规范格式版本。');
  const number=(value,min,max,label)=>{if(value===null || value==='' || typeof value==='boolean')throw Error(label+'无效。');const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(label+`需在 ${min}–${max} 之间。`);return n;};
  const name=String(input.name || '').trim();if(!name || name.length>80)throw Error('规范名称需为 1–80 字。');
  const width=number(input.width,1,2048,'画布宽度'),height=number(input.height,1,2048,'画布高度');
  const bool=key=>{if(typeof input[key]!=='boolean')throw Error('规范开关格式无效。');return input[key];};
  const stroke_enabled=bool('stroke_enabled'),colors_enabled=bool('colors_enabled'),safe_enabled=bool('safe_enabled'),allow_gradients=bool('allow_gradients');
  const rawWidths=Array.isArray(input.stroke_widths)?input.stroke_widths:String(input.stroke_widths || '').split(/[,，\s]+/).filter(Boolean);
  const stroke_widths=[...new Set(rawWidths.map(v=>number(v,.1,64,'描边粗细')))];
  if(stroke_widths.length>8 || (stroke_enabled&&!stroke_widths.length))throw Error('启用描边检查时，请填写 1–8 个允许粗细。');
  const rawColors=Array.isArray(input.colors)?input.colors:String(input.colors || '').split(/[,，\s]+/).filter(Boolean);
  const colors=[...new Set(rawColors.map(v=>{const c=normalizeColor(v);if(!c || c==='none' || !/^(?:#[\da-f]{6}|currentColor)$/.test(c))throw Error('允许颜色请填写 HEX 色值或 currentColor。');return c;}))];
  if(colors.length>16 || (colors_enabled&&!colors.length))throw Error('启用颜色检查时，请填写 1–16 个允许颜色。');
  const safe_inset=number(input.safe_inset,0,Math.min(width,height)/2-.001,'安全区留白');
  return {schema_version:1,name,width,height,stroke_enabled,stroke_widths,colors_enabled,colors,allow_gradients,safe_enabled,safe_inset};
}
const stdShapes=new Set(['path','rect','circle','ellipse','line','polyline','polygon']);
const stdIdentity=[1,0,0,1,0,0];
function stdMultiply(m,n){return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];}
function stdTransform(value) {
  let matrix=stdIdentity;const text=value || '';let consumed='';
  for(const match of text.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)){
    consumed+=match[0];const v=match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);if(!v.every(Number.isFinite))throw Error('变换参数无效');
    let n;const [a,b,c]=v;
    if(match[1]==='matrix'&&v.length===6)n=v;
    else if(match[1]==='translate'&&[1,2].includes(v.length))n=[1,0,0,1,a,b??0];
    else if(match[1]==='scale'&&[1,2].includes(v.length))n=[a,0,0,b??a,0,0];
    else if(match[1]==='rotate'&&[1,3].includes(v.length)){
      const angle=a*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);n=[cos,sin,-sin,cos,0,0];
      if(v.length===3)n=stdMultiply(stdMultiply([1,0,0,1,b,c],n),[1,0,0,1,-b,-c]);
    }else if(['skewX','skewY'].includes(match[1])&&v.length===1)n=match[1]==='skewX'?[1,0,Math.tan(a*Math.PI/180),1,0,0]:[1,Math.tan(a*Math.PI/180),0,1,0,0];
    else throw Error('变换暂不支持');
    matrix=stdMultiply(matrix,n);
  }
  if(text.replace(/\s|,/g,'')!==consumed.replace(/\s|,/g,''))throw Error('变换表达式无效');
  return matrix;
}
function stdAncestors(node){const list=[];for(let n=node;n?.nodeType===1;n=n.parentNode)list.unshift(n);return list;}
function stdInherited(node,key,fallback){for(let n=node;n?.nodeType===1;n=n.parentNode){const v=n.getAttribute(key);if(v && !['inherit','unset'].includes(v))return v==='initial'?fallback:v;}return fallback;}
function stdStopValue(node,key,fallback){const value=node.getAttribute(key);return value==='inherit'?stdInherited(node.parentNode,key,fallback):!value||['initial','unset'].includes(value)?fallback:value;}
function stdNumeric(value){return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(String(value))?Number(String(value).replace(/px$/i,'')):NaN;}
function stdOpacity(value){const s=String(value);return s.endsWith('%')?Number(s.slice(0,-1))/100:Number(s);}
function stdOpacityZero(node){return stdAncestors(node).some(n=>stdOpacity(n.getAttribute('opacity') || 1)===0);}
function stdPoint(m,x,y){return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
function stdExtrema(p0,p1,p2,p3){
  const a=-p0+3*p1-3*p2+p3,b=2*(p0-2*p1+p2),c=p1-p0;const ts=[0,1];
  if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)ts.push(-c/b);}else{const disc=b*b-4*a*c;if(disc>=0){ts.push((-b+Math.sqrt(disc))/(2*a),(-b-Math.sqrt(disc))/(2*a));}}
  return ts.filter(t=>t>=0&&t<=1).map(t=>(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3);
}
function stdBounds(node,m) {
  const tag=node.localName,attrs=Object.fromEntries(Array.from(node.attributes).map(a=>[a.name,a.value]));
  for(const key of ['x','y','width','height','x1','x2','y1','y2','r','rx','ry','cx','cy'])if(attrs[key]!==undefined&&!Number.isFinite(stdNumeric(attrs[key])))throw Error('几何单位需确认');
  if(tag==='circle'||tag==='ellipse'){
    const cx=stdNumeric(attrs.cx??0),cy=stdNumeric(attrs.cy??0),rx=stdNumeric(tag==='circle'?attrs.r:attrs.rx),ry=stdNumeric(tag==='circle'?attrs.r:attrs.ry);
    if(!(rx>0&&ry>0))throw Error('圆尺寸无效');
    const [x,y]=stdPoint(m,cx,cy),dx=Math.hypot(m[0]*rx,m[2]*ry),dy=Math.hypot(m[1]*rx,m[3]*ry);return [x-dx,y-dy,x+dx,y+dy];
  }
  for(const key of Object.keys(attrs))if(/^(?:x|y|width|height|x1|x2|y1|y2|rx|ry)$/.test(key))attrs[key]=String(stdNumeric(attrs[key]));
  const paths=iconToCubics([[tag,attrs]]);let bounds=[Infinity,Infinity,-Infinity,-Infinity];let segments=0;
  for(const path of paths){const p=path.pts;for(let i=2;i<p.length;i+=6){if(++segments>20000)throw Error('路径过于复杂');const points=[stdPoint(m,p[i-2],p[i-1]),stdPoint(m,p[i],p[i+1]),stdPoint(m,p[i+2],p[i+3]),stdPoint(m,p[i+4],p[i+5])];
    const xs=stdExtrema(...points.map(q=>q[0])),ys=stdExtrema(...points.map(q=>q[1]));bounds=[Math.min(bounds[0],...xs),Math.min(bounds[1],...ys),Math.max(bounds[2],...xs),Math.max(bounds[3],...ys)];}}
  if(!bounds.every(Number.isFinite))throw Error('未找到有效几何');return bounds;
}
function stdSummary(items){const warnings=items.filter(i=>i.status==='warning').length,manual=items.filter(i=>i.status==='manual').length;return {status:warnings?'warning':manual?'manual':'pass',warnings,manual};}
export function checkSVGStandard(svg, profile=null) {
  const items=[];const item=(id,label,status,detail)=>items.push({id,label,status,detail});let info;
  try{info=cleanSVG(svg);item('safety','SVG 基础检查','pass','通过当前支持的结构、引用及文件大小检查。');}catch(e){item('safety','SVG 基础检查','warning',e.message);return {status:'invalid',items};}
  if(!profile){item('standard','设计规范','manual','尚未设置适用规范；示例规范不会自动用于判定。');return {status:'unconfigured',items};}
  let spec;try{spec=normalizeStandard(profile.definition);}catch(e){item('standard','设计规范','manual','当前规范无效：'+e.message);return {status:'unconfigured',items};}
  item('canvas','画布尺寸',Math.abs(info.width-spec.width)<.001&&Math.abs(info.height-spec.height)<.001?'pass':'warning',`实际 ${info.width} × ${info.height}；要求 ${spec.width} × ${spec.height}。`);
  const root=new DOMParser().parseFromString(info.svg,'image/svg+xml').documentElement;
  const nodes=Array.from(root.getElementsByTagName('*'));
  if(nodes.length>1500 || info.svg.length>250000){item('complexity','图形结构','manual','图形较复杂，描边、颜色与安全区需人工确认。');return {...stdSummary(items),items,profile};}
  const shapes=nodes.filter(n=>stdShapes.has(n.localName)&&!stdAncestors(n).some(a=>['defs','mask','clipPath'].includes(a.localName))&&!stdOpacityZero(n));
  const widths=[],colors=new Set(),strokeUnknown=[],paintUnknown=[],geometryUnknown=[];let gradient=false,bounds=[Infinity,Infinity,-Infinity,-Infinity];
  const resources=new Map(nodes.filter(n=>n.getAttribute('id')).map(n=>[n.getAttribute('id'),n]));
  const paint=value=>{
    const ref=String(value).match(/^url\(\s*['"]?#([\w.:-]+)['"]?\s*\)$/i);
    if(ref){const gradientNode=resources.get(ref[1]);if(!gradientNode||!['linearGradient','radialGradient'].includes(gradientNode.localName)){paintUnknown.push('资源并非可检查的渐变');return;}gradient=true;const stops=Array.from(gradientNode.getElementsByTagName('stop'));
      if(!stops.length)paintUnknown.push('渐变缺少可读取的色标');
      for(const stop of stops){const alpha=stdOpacity(stdStopValue(stop,'stop-opacity','1'));if(!Number.isFinite(alpha))paintUnknown.push('渐变透明度需确认');if(alpha!==0){const color=normalizeColor(stdStopValue(stop,'stop-color','#000000'));if(color&&color!=='none')colors.add(color);else if(!color)paintUnknown.push('渐变颜色需确认');}}return;
    }
    const color=normalizeColor(value);if(color&&color!=='none')colors.add(color);else if(!color)paintUnknown.push('存在变量或暂不支持的颜色表达式：'+value);
  };
  for(const node of shapes){
    const label=node.getAttribute('id') || node.localName;
    const fill=stdInherited(node,'fill','#000000'),stroke=stdInherited(node,'stroke','none');
    const fillVisible=node.localName!=='line' && normalizeColor(fill)!=='none' && stdOpacity(stdInherited(node,'fill-opacity','1'))!==0;
    const width=stdNumeric(stdInherited(node,'stroke-width','1'));
    const strokeVisible=normalizeColor(stroke)!=='none' && width!==0 && stdOpacity(stdInherited(node,'stroke-opacity','1'))!==0;
    if(!fillVisible&&!strokeVisible)continue;
    if(fillVisible)paint(fill);if(strokeVisible)paint(stroke);
    let m=stdIdentity,scale=NaN;
    const chain=stdAncestors(node);
    if(chain.some(n=>n.hasAttribute('opacity')&&!Number.isFinite(stdOpacity(n.getAttribute('opacity'))))||!Number.isFinite(stdOpacity(stdInherited(node,'fill-opacity','1')))||!Number.isFinite(stdOpacity(stdInherited(node,'stroke-opacity','1')))){paintUnknown.push('透明度表达式需确认');geometryUnknown.push(label+'：可见性需确认');}
    try{for(const ancestor of chain){m=stdMultiply(m,stdTransform(ancestor.getAttribute('transform')));if(ancestor!==root&&ancestor.localName==='svg')throw Error('嵌套画布');}
      const sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]);if(Math.abs(sx-sy)<1e-7&&Math.abs(m[0]*m[2]+m[1]*m[3])<1e-7)scale=sx;
    }catch(e){geometryUnknown.push(label+'：'+e.message);}
    let effectiveStroke=0;
    if(strokeVisible){effectiveStroke=node.getAttribute('vector-effect')==='non-scaling-stroke'?width:width*scale;
      if(Number.isFinite(effectiveStroke)&&effectiveStroke>0)widths.push(effectiveStroke);else strokeUnknown.push(label+'：描边单位或非等比变换需确认');}
    try{
      if(chain.some(n=>n.getAttribute('mask') || n.getAttribute('clip-path'))){paintUnknown.push('含裁剪或蒙版，实际可见颜色需确认');throw Error('含裁剪或蒙版');}
      if(node.localName==='path'&&/[Aa]/.test(node.getAttribute('d') || ''))throw Error('圆弧路径边界需人工确认');
      const continuousEllipse=['circle','ellipse'].includes(node.localName);
      if(strokeVisible && (!Number.isFinite(effectiveStroke) || !continuousEllipse&&(stdInherited(node,'stroke-linecap','butt')!=='round' || !['round','bevel'].includes(stdInherited(node,'stroke-linejoin','miter')))))throw Error('描边端点或连接边界需确认');
      if(node.localName==='rect'&&(node.hasAttribute('rx')||node.hasAttribute('ry'))&&(Math.abs(m[1])>.00001||Math.abs(m[2])>.00001))throw Error('旋转圆角矩形边界需确认');
      const b=stdBounds(node,m),expand=strokeVisible?effectiveStroke/2:0;
      bounds=[Math.min(bounds[0],b[0]-expand),Math.min(bounds[1],b[1]-expand),Math.max(bounds[2],b[2]+expand),Math.max(bounds[3],b[3]+expand)];
    }catch(e){geometryUnknown.push(label+'：'+e.message);}
  }
  const uniqueWidths=[...new Set(widths.map(w=>Math.round(w*10000)/10000))];
  if(!spec.stroke_enabled)item('stroke','描边粗细','disabled','此规范未启用描边检查。');
  else{const mismatched=uniqueWidths.filter(w=>!spec.stroke_widths.some(expected=>Math.abs(w-expected)<=.05));item('stroke','描边粗细',mismatched.length?'warning':strokeUnknown.length||!widths.length?'manual':'pass',`实际 ${uniqueWidths.join('、')||'未发现可检查描边'}；允许 ${spec.stroke_widths.join('、')}。`+(!widths.length?'转轮廓的描边需人工确认。':'')+(strokeUnknown.length?'存在无法可靠测定的描边。':''));}
  if(!spec.colors_enabled)item('colors','图标颜色','disabled','此规范未启用颜色检查。');
  else{const mismatched=[...colors].filter(c=>!spec.colors.includes(c));const status=paintUnknown.length?'manual':mismatched.length||gradient&&!spec.allow_gradients?'warning':!colors.size?'manual':'pass';item('colors','图标颜色',status,`实际 ${[...colors].join('、')||'未确定'}；允许 ${spec.colors.join('、')}。`+(gradient?(spec.allow_gradients?'含渐变，已检查可读取色标。':'当前规范不允许渐变。'):'')+(paintUnknown.length?'含变量、裁剪或其他表达式，需确认实际显示。':''));}
  if(!spec.safe_enabled)item('safe','安全区域','disabled','此规范未启用安全区检查。');
  else{const vb=root.getAttribute('viewBox').split(/\s+/).map(Number),inset=spec.safe_inset;
    const outside=bounds[0]<vb[0]+inset-.01||bounds[1]<vb[1]+inset-.01||bounds[2]>vb[0]+vb[2]-inset+.01||bounds[3]>vb[1]+vb[3]-inset+.01;
    const unknown=geometryUnknown.length||!bounds.every(Number.isFinite)||!shapes.length;
    item('safe','安全区域',unknown?'manual':outside?'warning':'pass',`画布四周要求至少留白 ${inset}。`+(unknown?[...new Set(geometryUnknown)].slice(0,3).join('；')||'未找到可计算图形。':outside?'图形或描边超出建议安全区。':'当前几何边界未发现超出。'));
  }
  return {...stdSummary(items),items,profile};
}
export function applicableStandard(profiles,platform){return profiles.find(p=>p.platform===platform)||profiles.find(p=>p.platform==='通用')||null;}
