// Independent optional dimensions. Missing legacy information stays unclassified.
export const TAXONOMY={
  structure:[['Outline','线性'],['Filled','面型'],['Hybrid','线面结合']],
  visual_style:[['Flat','扁平'],['Gradient','渐变'],['Glassmorphism','毛玻璃'],['Volumetric','立体']],
  color_mode:[['Monochrome','单色'],['Duotone','双色'],['Multicolor','多色']],
  target_platform:[['App','App'],['Glasses','眼镜'],['Other','其他']]
};
export const UNCLASSIFIED='__unclassified__';
export function legacyStructure(value){return ({'线性':'Outline','面型':'Filled',Outline:'Outline',Filled:'Filled',Hybrid:'Hybrid'})[value]||null;}
export function legacyColorMode(value){return ({'单色':'Monochrome','双色':'Duotone','多色':'Multicolor',Monochrome:'Monochrome',Duotone:'Duotone',Multicolor:'Multicolor'})[value]||null;}
export function legacyTargetPlatform(value){return ({App:'App','AI 眼镜':'Glasses',Glasses:'Glasses','其他设备':'Other',Other:'Other'})[value]||null;}
export function legacyPlatform(value){return ({App:'App',Glasses:'AI 眼镜',Other:'其他设备'})[value]||'通用';}
export function legacyVisualType(value){return ({Outline:'线性',Filled:'面型',Hybrid:'其他'})[value]||'其他';}
export function classification(asset) {
  const fallback={structure:legacyStructure(asset.visual_type),visual_style:null,color_mode:legacyColorMode(asset.visual_type),target_platform:legacyTargetPlatform(asset.platform)};
  return Object.fromEntries(Object.keys(TAXONOMY).map(key=>[key,Object.hasOwn(asset,key)?TAXONOMY[key].some(([v])=>v===asset[key])?asset[key]:null:fallback[key]]));
}
export function normalizeClassification(input) {
  return Object.fromEntries(Object.keys(TAXONOMY).map(key=>{
    if(!Object.hasOwn(input,key))return [key,classification(input)[key]];
    const value=input[key];if(value===null || value===undefined || value==='')return [key,null];
    if(!TAXONOMY[key].some(([v])=>v===value))throw Error('分类值无效：'+key);
    return [key,value];
  }));
}
export function matchesClassification(asset,filters={}) {
  const values=classification(asset);
  return Object.keys(TAXONOMY).every(key=>!filters[key] || (filters[key]===UNCLASSIFIED?values[key]===null:values[key]===filters[key]));
}
export function classificationLabel(key,value){const item=TAXONOMY[key]?.find(([v])=>v===value);return item?(item[0]===item[1]?item[0]:item.join(' · ')):'未分类';}
export function populateClassificationSelect(select,key,filter=false) {
  select.replaceChildren();
  const add=(value,label)=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);};
  add('',filter?'全部':'未分类');if(filter)add(UNCLASSIFIED,'未分类');
  TAXONOMY[key].forEach(([value,label])=>add(value,value===label?value:value+' · '+label));
}
