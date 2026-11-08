import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCanvas,canvasDimensions,normalizeSpec,validateGeneratedIcon,generatedSVG} from '../ai-core.js';
import {handleAIRequest} from '../ai-api.js';
const base={canvas:32,stroke:2,color:'#252833',cap:'round',join:'round',padding:2,styleNotes:'圆头等粗描边'};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
const ref={name:'公开测试',svg:'<svg viewBox="0 0 32 32"><path d="M4 4L28 28"/></svg>',preview:png,vb:[0,0,32,32],widths:['2'],caps:['round'],joins:['round'],strokes:['#252833'],fills:['none']};
const request=(operation,spec=base)=>({operation,references:[ref],...(operation==='analyze'?{target:spec}:{spec,prompt:'公开测试图标'})});

test('canvas accepts explicit square/rectangular forms and preserves old numeric projects without inventing missing dimensions',()=>{
 for(const n of [16,24,32,48,64,128,1024,4096])assert.equal(normalizeCanvas(n),n);
 for(const input of ['32','32x32','32 × 32',[32,32],{width:32,height:32}])assert.equal(normalizeCanvas(input),32);
 for(const input of ['48×32',[48,32],{width:48,height:32}])assert.deepEqual(canvasDimensions(input),{width:48,height:32});
 for(const input of [null,{},undefined,0,-24,Infinity,4097,'24px',[],[24],{width:32},{width:'32',height:32}])assert.throws(()=>normalizeCanvas(input));
 assert.equal(normalizeSpec({...base,canvas:24}).canvas,24);
 assert.equal(normalizeSpec({...base,canvas:64,stroke:6,padding:8}).stroke,6);
});

test('generated SVG and conservative X/Y bounds use actual canvas dimensions, including native export and proportional preview',()=>{
 for(const canvas of [32,48,64,{width:48,height:32},{width:32,height:48}]){
  const spec=normalizeSpec({...base,canvas}),{width,height}=canvasDimensions(canvas);
  const icon=validateGeneratedIcon({name:'边界测试',d:`M4 4L${width-4} ${height-4}`},spec);
  assert.match(generatedSVG(icon),new RegExp(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`));
  const preview=generatedSVG(icon,106);assert.match(preview,new RegExp(`viewBox="0 0 ${width} ${height}"`));
  assert.throws(()=>validateGeneratedIcon({name:'横向越界',d:`M4 4L${width-1} 8`},spec),/安全区域/);
  assert.throws(()=>validateGeneratedIcon({name:'纵向越界',d:`M4 4L8 ${height-1}`},spec),/安全区域/);
 }
 const rect=validateGeneratedIcon({name:'矩形',d:'M4 4L44 28'},{...base,canvas:{width:48,height:32}});
 assert.match(generatedSVG(rect,24),/width="24" height="16"/);
 assert.throws(()=>normalizeSpec({...base,padding:16}),/留白/);
});

test('real request handler supports larger/rectangular targets, explicit model shapes and only one repair without defaults',async()=>{
 for(const canvas of [32,48,64,{width:48,height:32}]){
  const spec=normalizeSpec({...base,canvas});let calls=0;
  const result=await handleAIRequest(request('analyze',spec),{model:'test-model',callModel:async messages=>{
   calls++;const data=JSON.parse(messages[1].content[1].text);assert.deepEqual(data.target,spec);assert.deepEqual(data.responseExample.spec,spec);
   return {spec:{...spec,canvas:canvasDimensions(canvas)}};
  }});
  assert.deepEqual(result.spec,spec);assert.equal(calls,1);
  const generated=await handleAIRequest(request('generate',spec),{model:'test-model',callModel:async messages=>{
   assert.deepEqual(JSON.parse(messages[1].content[1].text).canvasSize,canvasDimensions(canvas));
   return {icons:[{name:'横线',d:'M4 28L28 28'},{name:'竖线',d:'M28 4L28 28'},{name:'折线',d:'M4 28L16 4L28 28'}]};
  }});
  assert.ok(generated.icons.every(icon=>JSON.stringify(icon.spec.canvas)===JSON.stringify(spec.canvas)));
 }
 let calls=0;const repaired=await handleAIRequest(request('analyze'),{model:'test',callModel:async messages=>{calls++;if(calls===1)return {spec:{canvas:'wrong'}};assert.match(messages.at(-1).content,/唯一一次修复/);return {spec:base};}});
 assert.equal(calls,2);assert.equal(repaired.spec.canvas,32);
 const direct=await handleAIRequest(request('analyze'),{model:'test',callModel:async()=>({...base,canvas:'32×32'})});assert.equal(direct.spec.canvas,32);
 calls=0;const userCanvas=await handleAIRequest(request('analyze'),{model:'test',callModel:async()=>{calls++;return {spec:{...base,canvas:64}};}});assert.equal(userCanvas.spec.canvas,32);assert.equal(calls,1,'model cannot override the explicit user canvas');
 const missingCanvas=await handleAIRequest(request('analyze'),{model:'test',callModel:async()=>{const {canvas,...style}=base;return {spec:style};}});assert.equal(missingCanvas.spec.canvas,32);
 calls=0;await assert.rejects(handleAIRequest(request('analyze'),{model:'test',callModel:async()=>{calls++;return {};}}),/缺少完整 spec/);assert.equal(calls,2);
});
