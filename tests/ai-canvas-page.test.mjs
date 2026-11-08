import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {canvasDimensions} from '../ai-core.js';
const wait=async p=>{for(let i=0;i<200;i++){if(p())return;await new Promise(r=>setTimeout(r,5));}throw Error('Canvas page timed out');};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';

test('32/64 and rectangular canvas survive analyze/confirm/generate, frozen candidates, local save, SVG/PNG export and reload',async()=>{
 const w=new Window({url:'http://localhost/',settings:{disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true,disableCSSFileLoading:true}});
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8'),mount=()=>{w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');};mount();
 for(const name of ['window','document','navigator','localStorage','sessionStorage','DOMParser','XMLSerializer','CustomEvent','FormData','File','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?w:w[name],configurable:true,writable:true});
 globalThis.Image=class{naturalWidth=24;naturalHeight=24;set src(v){queueMicrotask(()=>this.onload());}};
 const rasters=[];w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=>png;
 w.HTMLCanvasElement.prototype.toBlob=function(callback){rasters.push([this.width,this.height]);callback(new Blob(['png'],{type:'image/png'}));};
 const downloads=[];w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
 globalThis.matchMedia=w.matchMedia.bind(w);globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);
 const calls=[];globalThis.fetch=async(url,options)=>{
  if(url!=='/api/icon-ai')return new Response(await fs.readFile(new URL('../'+url,import.meta.url)));
  const body=JSON.parse(options.body);calls.push(body);
  if(body.operation==='analyze')return new Response(JSON.stringify({model:'mock',spec:{...body.target,canvas:canvasDimensions(body.target.canvas)}}));
  const {width,height}=canvasDimensions(body.spec.canvas);
  return new Response(JSON.stringify({model:'mock',icons:[{name:'横线',d:`M4 ${height-4}L${width-4} ${height-4}`},{name:'竖线',d:`M${width-4} 4L${width-4} ${height-4}`},{name:'折线',d:`M4 ${height-4}L${width/2} 4L${width-4} ${height-4}`}]}));
 };
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="#252833" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4L28 28"/></svg>';
 w.localStorage.setItem('iconflow-v1',JSON.stringify({version:1,state:{references:[{name:'32px参考',markup:svg,original:svg}]},custom:{}}));
 try{
  await import('../app.js');const d=w.document,$=id=>d.getElementById(id);
  await wait(()=>d.querySelector('.catalog-card'));d.querySelector('[data-mode=generate]').click();
  assert.equal($('ai-canvas-width').value,'32');assert.equal($('ai-canvas-height').value,'32');
  $('ai-consent').checked=true;$('ai-read').click();await wait(()=>!$('ai-read').disabled&&$('ai-status').textContent.includes('规范已读取'));
  assert.equal(calls[0].target.canvas,32);assert.equal($('generate').disabled,true);
  $('ai-confirm').click();$('prompt').value='公开测试图标';$('generate').click();await wait(()=>!$('generate').disabled&&$('candidate-source').textContent.startsWith('AI'));
  assert.match($('code-view').textContent,/viewBox="0 0 32 32"/);assert.match($('checks').textContent,/32 × 32/);$('save-asset').click();
  d.querySelector('[data-canvas-size="64"]').click();assert.equal($('generate').disabled,true);assert.match($('code-view').textContent,/viewBox="0 0 32 32"/,'editing target never distorts existing candidate');
  $('ai-confirm').click();$('generate').click();await wait(()=>!$('generate').disabled&&$('code-view').textContent.includes('0 0 64 64'));
  assert.equal(calls.at(-1).spec.canvas,64);$('save-asset').click();
  $('ai-canvas-width').value='48';$('ai-canvas-width').dispatchEvent(new w.Event('input'));$('ai-canvas-height').value='32';$('ai-canvas-height').dispatchEvent(new w.Event('input'));
  $('ai-confirm').click();$('generate').click();await wait(()=>!$('generate').disabled&&$('code-view').textContent.includes('0 0 48 32'));
  assert.deepEqual(calls.at(-1).spec.canvas,{width:48,height:32});assert.match($('code-view').textContent,/width="48" height="32"/);
  assert.equal(Number(d.querySelector('#icon-stage svg').getAttribute('width'))/Number(d.querySelector('#icon-stage svg').getAttribute('height')),1.5);
  $('save-asset').click();const saved=JSON.parse(w.localStorage.getItem('iconflow-v1'));assert.deepEqual(saved.state.assets.at(-1).spec.canvas,{width:48,height:32});
  $('export-open').click();$('download').click();await wait(()=>!$('download').disabled);assert.equal(downloads.at(-1),'iconflow-icon.svg');
  d.querySelector('[name=format][value=png]').click();$('export-size').value='128';$('download').click();await wait(()=>!$('download').disabled);assert.doesNotMatch($('toast').textContent,/失败/);assert.deepEqual(rasters.at(-1),[128,85],$('toast').textContent+' '+downloads.join(','));$('export-close').click();
  $('ai-canvas-width').value='';$('ai-canvas-width').dispatchEvent(new w.Event('input'));assert.equal($('generate').disabled,true);$('ai-confirm').click();assert.match($('ai-status').textContent,/画布/);
  $('ai-canvas-width').value='48';$('ai-canvas-width').dispatchEvent(new w.Event('input'));
  w.iconflow.stop();mount();await import('../app.js?canvas-reload');
  assert.equal($('ai-canvas-width').value,'48');assert.equal($('ai-canvas-height').value,'32');assert.match($('code-view').textContent,/viewBox="0 0 48 32"/);assert.equal(w.iconflow.state.assets.length,3);
  w.iconflow.stop();
 }finally{await w.happyDOM.abort();}
});
