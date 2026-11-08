import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Window} from 'happy-dom';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64'));
const wait=async f=>{for(let i=0;i<300;i++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('Figma AI condition timed out');};
async function fixture(filled=false){
 const w=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}}),d=w.document;
 let geometry=filled?'M8 8L24 8L24 24L8 24Z':'M8 16L14 22L25 9',html,role='owner',mode='success',resolvePaid;
 const calls=[],sent=[],nodes=[],callbacks={},pageEvents={},undo=[];
 const svg=()=>`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${geometry}" ${filled?'fill="#252833" stroke="none"':'fill="none" stroke="#252833" stroke-width="2"'} stroke-linecap="round" stroke-linejoin="round"/></svg>`;
 const vector={id:'1:2',type:'VECTOR',visible:true,strokeWeight:filled?0:2,strokeCap:'ROUND',strokeJoin:'ROUND',strokeAlign:'CENTER',strokes:filled?[]:[{type:'SOLID',color:{r:37/255,g:40/255,b:51/255}}],fills:filled?[{type:'SOLID',color:{r:37/255,g:40/255,b:51/255}}]:[]};
 const source={id:'1:1',type:'FRAME',name:'公开参考',width:32,height:32,visible:true,children:[vector],absoluteBoundingBox:{x:100,y:200,width:32,height:32},exportAsync:async o=>o.format==='PNG'?png:svg()};vector.parent=source;
 const deliver=m=>{sent.push(m);queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{data:{pluginMessage:m}})));};
 const figma={currentPage:{selection:[source],on:(n,f)=>pageEvents[n]=f,off(){},appendChild:n=>nodes.push(n)},viewport:{center:{x:0,y:0},scrollAndZoomIntoView(){}},clientStorage:{getAsync:async()=>null,setAsync:async()=>{},deleteAsync:async()=>{}},ui:{postMessage:deliver},showUI:value=>html=value,on:(n,f)=>callbacks[n]=f,openExternal(){},base64Encode:bytes=>Buffer.from(bytes).toString('base64'),commitUndo:()=>undo.push(true),createNodeFromSvg:svg=>{const node={id:'9:'+nodes.length,type:'FRAME',name:'',width:Number(svg.match(/width="([\d.]+)"/)[1]),height:Number(svg.match(/height="([\d.]+)"/)[1]),children:[{type:'VECTOR'}],data:{},setPluginData(k,v){this.data[k]=v;},getPluginData(k){return this.data[k]||'';},exportAsync:async()=>svg,remove(){this.removed=true;}};return node;}};
 const network=async(url,opts)=>{
  const body=opts.body?JSON.parse(opts.body):null;calls.push({url:String(url),opts,body});
  if(String(url).includes('/auth/v1/token'))return Response.json({access_token:'user-token',refresh_token:'refresh',expires_in:3600,user:{id:'u',email:'u@test.invalid'}});
  if(String(url).includes('/il_workspaces'))return Response.json([{id:'space',name:'Test',owner_id:'u'}]);
  if(String(url).includes('/il_members'))return Response.json([{role}]);
  if(String(url).includes('/il_assets'))return Response.json([]);
  if(String(url).includes('/auth/v1/logout'))return Response.json({});
  if(String(url).endsWith('/functions/v1/icon-ai-figma')){
   assert.equal(opts.headers.Authorization,'Bearer user-token');assert.equal(opts.headers['X-Iconlab-Client'],'figma-plugin');
   if(mode==='deferred'&&body.operation==='generate')await new Promise(r=>resolvePaid=r);
   if(body.operation==='credentials')return Response.json({configured:false});
   if(mode==='offline')throw Error('Network unavailable');
   const spec=body.target||body.spec;
   if(body.operation==='analyze')return Response.json({spec:{...spec,styleNotes:'AI建议：少细节'},model:'mock/qoder'});
   let icons=[{name:'相机A',d:'M8 8L24 8L24 24L8 24Z'},{name:'相机B',d:'M6 10L26 10L26 22L6 22Z'},{name:'相机C',d:'M10 6L22 6L22 26L10 26Z'}];
   if(mode==='unsafe')icons[0].d='M1 1"/><script/>';
   return Response.json({icons,model:'mock/qoder'});
  }
  if(String(url).includes('/rpc/il_save_asset'))return Response.json({result:'created',asset:{id:'asset',name:body.p_meta.name,version:1}});
  throw Error('Unexpected '+url);
 };
 vm.runInNewContext(await fs.readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8'),{figma,__html__:await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8'),fetch:network,setTimeout,clearTimeout,console});
 d.documentElement.innerHTML=html.replace(/<!doctype html>|<html[^>]*>|<\/html>/gi,'');
 const context=vm.createContext({window:w,document:d,parent:{postMessage:({pluginMessage:m})=>figma.ui.onmessage(m)},DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,FormData:w.FormData,TextEncoder,URL,Map,Response,AbortSignal,fetch:network,setTimeout,clearTimeout,console,crypto:globalThis.crypto});
 vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const $=id=>d.getElementById(id);
 await wait(()=>!$('login').disabled);$('email').value='u@test.invalid';$('password').value='not-a-real-password';$('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>!$('account').hidden&&!$('login').disabled);
 $('ai-tab').click();await wait(()=>$('pai-connection').textContent.includes('团队'));
 return {w,d,$,calls,sent,nodes,figma,source,vector,pageEvents,callbacks,undo,setMode:v=>mode=v,release:()=>resolvePaid(),edit:()=>geometry='M9 17L15 23L26 10',capture:async()=>{$('pai-capture').click();await wait(()=>!$('pai-capture').disabled&&$('pai-reference-state').textContent.includes('32 × 32'));},generate:async()=>{$('pai-consent').checked=true;$('pai-confirm').click();$('pai-prompt').value='相机：机身与镜头。\n使用场景：智能家居设备列表。';$('pai-prompt').dispatchEvent(new w.Event('input'));$('pai-generate').click();await wait(()=>!$('pai-generate').disabled&&$('pai-results').hidden===false);}};
}
test('real main and packaged UI read native facts, analyze optional style, generate 32/48x32 candidates, insert editable SVG with undo and prepare existing upload',async()=>{
 const f=await fixture(),{$,calls,nodes,w}=f;try{
  await f.capture();assert.equal($('pai-stroke').value,'2');assert.equal($('pai-color').value,'#252833');assert.equal(calls.filter(c=>c.body?.operation==='analyze').length,0,'capture stays local');
  $('pai-analyze').click();await wait(()=>$('pai-status').textContent.includes('允许'));assert.equal(calls.filter(c=>c.body?.operation==='analyze').length,0);
  $('pai-consent').checked=true;$('pai-analyze').click();await wait(()=>!$('pai-analyze').disabled&&$('pai-notes').value.includes('AI建议'));
  assert.equal($('pai-generate').disabled,true,'analysis does not confirm');
  await f.generate();assert.equal($('pai-candidates').children.length,3);assert.match(calls.find(c=>c.body?.operation==='generate').body.prompt,/使用场景/);
  const enter=new w.KeyboardEvent('keydown',{key:'Enter',cancelable:true});$('pai-prompt').dispatchEvent(enter);assert.equal(enter.defaultPrevented,false);
  $('pai-width').value='48';$('pai-width').dispatchEvent(new w.Event('input'));assert.equal($('pai-generate').disabled,true);assert.equal($('pai-insert').disabled,true);
  await f.generate();$('pai-candidates').children[1].click();$('pai-insert').click();await wait(()=>nodes.length===1&&$('upload-panel').hidden===false&&$('name').value==='相机B');
  assert.equal(nodes[0].width,48);assert.equal(nodes[0].height,32);assert.equal(nodes[0].x,164);assert.equal(nodes[0].y,200);assert.equal(nodes[0].children[0].type,'VECTOR');assert.equal(f.undo.length,2);
  const meta=JSON.parse(nodes[0].data['iconlab.ai.v1']);assert.equal(meta.spec.canvas.width,48);assert.equal(meta.reference.nodeId,'1:1');assert.match(meta.prompt,/使用场景/);assert.match($('asset-form').elements.namedItem('note').value,/AI生成/);
  assert.equal(calls.some(c=>c.url.includes('/il_save_asset')),false,'inserting does not auto-upload');
  $('source').value='https://www.figma.com/design/testfile/Icon-Lab';$('asset-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>calls.some(c=>c.url.includes('/il_save_asset')));
  assert.match(calls.find(c=>c.url.includes('/il_save_asset')).body.p_meta.note,/AI生成/);
  assert.equal(w.localStorage.length+w.sessionStorage.length,0);
 }finally{await w.happyDOM.abort();}
});
test('changed selection/content and unsafe model output never replace accepted candidates or create layers',async()=>{
 const f=await fixture(),{$,calls,w}=f;try{
  await f.capture();await f.generate();const prior=$('pai-candidates').textContent;
  f.setMode('unsafe');$('pai-generate').click();await wait(()=>!$('pai-capture').disabled&&$('pai-status').dataset.tone==='error');assert.equal($('pai-candidates').textContent,prior);assert.equal(f.nodes.length,0);
  f.setMode('success');f.edit();$('pai-generate').click();await wait(()=>!$('pai-capture').disabled&&$('pai-status').textContent.includes('已变化'));assert.equal(f.nodes.length,0);assert.equal(calls.filter(c=>c.body?.operation==='generate').length,2,'changed content rejected before paid call');
  await f.capture();f.setMode('deferred');$('pai-consent').checked=true;$('pai-confirm').click();$('pai-generate').click();await wait(()=>calls.filter(c=>c.body?.operation==='generate').length===3);
  f.figma.currentPage.selection=[];f.callbacks.selectionchange();f.release();await wait(()=>!$('pai-capture').disabled);assert.equal(f.nodes.length,0);assert.equal($('pai-insert').disabled,true);assert.equal($('pai-consent').checked,false);
 }finally{await w.happyDOM.abort();}
});
test('native mixed parameters are explicit and page-local edits invalidate confirmation without loading all pages',async()=>{
 const f=await fixture(),{$,w}=f;try{
  f.source.children.push({...f.vector,id:'1:3',strokeWeight:3,parent:f.source});await f.capture();assert.equal($('pai-stroke').value,'');assert.match($('pai-facts').textContent,/2 \/ 3/);
  $('pai-confirm').click();assert.match($('pai-status').textContent,/描边/);assert.equal($('pai-generate').disabled,true);
  $('pai-stroke').value='2';$('pai-stroke').dispatchEvent(new w.Event('input'));$('pai-confirm').click();assert.equal($('pai-generate').disabled,false);
  f.pageEvents.nodechange({nodeChanges:[{type:'PROPERTY_CHANGE',node:f.vector,properties:['strokeWeight']}]});await wait(()=>$('pai-generate').disabled);assert.equal($('pai-insert').disabled,true);
 }finally{await w.happyDOM.abort();}
});

test('filled native selection seeds filled target without stroke; generated filled SVG and provenance survive insertion',async()=>{
 const f=await fixture(true),{$,w}=f;try{
  await f.capture();assert.equal($('pai-mode').value,'filled');assert.equal($('pai-color').value,'#252833');assert.equal($('pai-stroke').closest('label').hidden,true);assert.equal($('pai-stroke').value,'');
  await f.generate();const call=f.calls.find(c=>c.body?.operation==='generate');assert.equal(call.body.spec.renderMode,'filled');assert.equal(call.body.spec.stroke,0);assert.equal(call.body.spec.fillRule,'evenodd');
  const img=$('pai-candidates').querySelector('img');assert.match(decodeURIComponent(img.src),/fill-rule="evenodd" stroke="none"/);
  $('pai-mode').value='outline';$('pai-mode').dispatchEvent(new w.Event('input'));assert.equal($('pai-insert').disabled,true);assert.equal($('pai-stroke').closest('label').hidden,false);
  $('pai-mode').value='filled';$('pai-mode').dispatchEvent(new w.Event('input'));await f.generate();$('pai-insert').click();await wait(()=>f.nodes.length===1);
  assert.equal(JSON.parse(f.nodes[0].data['iconlab.ai.v1']).spec.renderMode,'filled');assert.match(await f.nodes[0].exportAsync(),/fill-rule="evenodd" stroke="none"/);
 }finally{await w.happyDOM.abort();}
});
