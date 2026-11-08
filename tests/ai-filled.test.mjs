import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpec,validateGeneratedIcon,validateGeneratedIcons,generatedSVG} from '../ai-core.js';
import {handleAIRequest} from '../ai-api.js';
const spec={canvas:{width:48,height:32},renderMode:'filled',color:'#3478F6',padding:2,styleNotes:'简洁面形，镜头使用透明镂空'};
const ring={name:'相机',d:'M2 2L46 2L46 30L2 30Z M16 8L32 8L32 24L16 24Z'};
const icons=[ring,{name:'文件',d:'M10 2L32 2L38 8L38 30L10 30Z'},{name:'播放',d:'M10 4L38 16L10 28Z'}];
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
const reference={name:'面形参考',svg:'<svg viewBox="0 0 48 32"><path d="M2 2L46 2L46 30L2 30Z" fill="#3478F6"/></svg>',preview:png,vb:[0,0,48,32],widths:[],caps:[],joins:[],strokes:[],fills:['#3478F6']};
test('filled spec needs no stroke/cap/join; native SVG preserves transparent holes, color and rectangular canvas',()=>{
 const normalized=normalizeSpec(spec);assert.equal(normalized.stroke,0);assert.equal(normalized.fillRule,'evenodd');
 const icon=validateGeneratedIcon({...ring,fill:false,color:'#000000',stroke:99},spec);assert.equal(icon.fill,true);assert.equal(icon.stroke,0);assert.equal(icon.color,'#3478f6');
 assert.deepEqual(icon.validation.bounds,{left:2,top:2,right:46,bottom:30});
 const svg=generatedSVG(icon);assert.match(svg,/width="48" height="32"/);assert.match(svg,/fill="#3478f6" fill-rule="evenodd" stroke="none"/);assert.ok(svg.includes(ring.d));assert.doesNotMatch(svg,/stroke-width/);
 assert.match(generatedSVG(icon,128),/height="85.33333333333333"/);assert.deepEqual(validateGeneratedIcons(icons,spec).map(i=>i.fill),[true,true,true]);
 assert.throws(()=>normalizeSpec({...spec,renderMode:'gradient'}),/结构/);assert.throws(()=>normalizeSpec({...spec,fillRule:'nonzero'}),/evenodd/);
});
test('filled validation rejects open, zero-area, duplicate-cancelling, unsafe and out-of-bounds contours',()=>{
 for(const [d,reason] of [['M3 3L30 3L30 24',/闭合/],['M3 3L30 3L3 3Z',/面积/],['M3 3L30 3L30 24Z M3 3L30 3L30 24Z',/重复轮廓/],['M1 3L30 3L30 24Z',/安全区域/],['M3 3L30 3L30 24Z M4 4L8 4',/闭合/],['M3 3"/><script/>',/仅支持/]])assert.throws(()=>validateGeneratedIcon({name:'非法',d},spec),reason);
 const curve=validateGeneratedIcon({name:'曲面',d:'M4 16C4 2 44 2 44 16C44 30 4 30 4 16Z'},spec);assert.equal(curve.fill,true);
 const outline={canvas:24,stroke:2,color:'#252833',cap:'round',join:'round',padding:1,styleNotes:''};assert.equal(validateGeneratedIcon({name:'线',d:'M4 4L20 20'},outline).fill,false);assert.throws(()=>normalizeSpec({...outline,stroke:NaN}),/请填写/);
});
test('filled request tells model closed compound-path rules; analysis preserves user mode and bounded repair fixes an open contour',async()=>{
 let count=0;const calls=[];
 const result=await handleAIRequest({operation:'generate',references:[reference],spec,prompt:'场景：设备列表，面形相机，镜头透明镂空。'},{model:'mock',callModel:async messages=>{calls.push(messages);return {icons:++count===1?[{...ring,d:'M4 4L30 4L30 24'},...icons.slice(1)]:icons};}});
 assert.equal(count,2);assert.match(calls[0][0].content,/面形填充.*Z闭合.*evenodd/);assert.match(calls[1].at(-1).content,/闭合/);assert.equal(result.icons[0].fill,true);
 const analyzed=await handleAIRequest({operation:'analyze',references:[reference],target:spec},{model:'mock',callModel:async()=>({spec:{...spec,renderMode:'outline',stroke:2,cap:'butt',join:'miter',canvas:24}})});assert.equal(analyzed.spec.renderMode,'filled');assert.deepEqual(analyzed.spec.canvas,spec.canvas);assert.equal(analyzed.spec.stroke,0);
});
