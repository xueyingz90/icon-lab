import {cleanSVG} from './catalog-core.js';
import {normalizeSpec,validateGeneratedIcon} from './ai-core.js';
export const PROJECT_KEY='iconflow-v1',UNDO_KEY='iconlab.project.before-restore.v1';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
// Reject unsafe renderable payloads before anything reaches the existing project renderer.
export function parseProjectBackup(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>15*1024*1024)throw Error('项目备份最大为 15MB。');
 let data;try{data=JSON.parse(text);}catch{throw Error('备份不是有效的 JSON。');}
 if(data?.version!==1||!object(data.state)||!object(data.custom)||!Array.isArray(data.state.assets)||!Array.isArray(data.state.references))throw Error('请选择“备份本地项目”导出的文件；资产库备份请在资产库导入。');
 if(data.state.assets.length>1000||data.state.references.length>8||Object.keys(data.custom).length>1000)throw Error('备份中的项目数量超出支持范围。');
 let nodes=0;
 const visit=(value,depth=0)=>{
  if(++nodes>100000||depth>20)throw Error('备份结构过于复杂。');
  if(Array.isArray(value))return value.forEach(v=>visit(v,depth+1));
  if(!object(value))return;
  for(const [key,v] of Object.entries(value)){
   if(['__proto__','prototype','constructor'].includes(key))throw Error('备份包含无效字段。');
   if(['markup','original','svg'].includes(key)&&typeof v==='string'&&v.trim())cleanSVG(v);
   if(['stroke','duration','stateDuration','bounceStrength','aiPadding'].includes(key)&&v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<0||v>4096))throw Error('备份中的数值参数无效。');
   if(key==='d'&&v!=null&&(typeof v!=='string'||v.length>200000||!/^[MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]*$/.test(v)))throw Error('备份包含无效矢量路径。');
   if(key==='bitmap'&&v&&(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)||v.length>2800000))throw Error('备份中的图片必须是内嵌 PNG 或 JPEG。');
   if(key==='color'&&v&&!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(v))throw Error('备份中的图标颜色无效。');
   if(['cap','join'].includes(key)&&v&&!({cap:['round','butt','square'],join:['round','miter','bevel']}[key].includes(v)))throw Error('备份中的描边参数无效。');
   if(typeof v==='number'&&!Number.isFinite(v))throw Error('备份包含无效数值。');
   visit(v,depth+1);
  }
 };
 visit(data);
 for(const item of data.state.assets){
  if(!object(item)||typeof item.name!=='string'||!['icon','motion'].includes(item.type))throw Error('备份中存在不完整的图标记录。');
  if(item.type==='motion'){if(!object(item.from)||!object(item.to))throw Error('动效备份缺少起始或目标素材。');}
  else if(typeof item.d!=='string'||!item.d.trim())throw Error('静态图标缺少矢量路径。');
  if(item.aiMeta)validateGeneratedIcon(item,item.spec);
 }
 for(const reference of data.state.references)if(!object(reference)||typeof reference.markup!=='string'||!Array.isArray(reference.vb)||reference.vb.length!==4||reference.vb.some(n=>typeof n!=='number'||!Number.isFinite(n))||reference.vb[2]<=0||reference.vb[3]<=0)throw Error('备份中的参考图标无效。');
 for(const [key,value] of Object.entries(data.custom))if(!object(value)||typeof value.name!=='string')throw Error('备份中的自定义素材无效。');
 for(const key of ['selected','from','to'])if(data.state[key]!==undefined&&(typeof data.state[key]!=='string'||Object.getOwnPropertyNames(Object.prototype).includes(data.state[key])))throw Error('备份中的素材选择无效。');
 if(data.state.aiCanvas!==undefined)normalizeSpec({canvas:data.state.aiCanvas,stroke:1,color:'#000000',cap:'round',join:'round',padding:0,styleNotes:''});
 if(data.state.spring!==undefined&&!['smooth','snappy','bouncy'].includes(data.state.spring))throw Error('备份中的动画节奏无效。');
 if(data.state.aiSpec)data.state.aiSpec.confirmed=false;
 data.state.mode='assets';
 return {version:1,state:data.state,custom:data.custom};
}
export function restoreProject(storage,backup){
 const next=JSON.stringify(backup),previous=storage.getItem(PROJECT_KEY);
 // The original project is untouched if either write exceeds the device quota.
 if(previous!==null)storage.setItem(UNDO_KEY,previous);else storage.removeItem(UNDO_KEY);
 storage.setItem(PROJECT_KEY,next);
}
export function undoProjectRestore(storage){
 const previous=storage.getItem(UNDO_KEY);if(previous===null)throw Error('没有可撤销的项目恢复。');
 storage.setItem(PROJECT_KEY,previous);storage.removeItem(UNDO_KEY);
}
