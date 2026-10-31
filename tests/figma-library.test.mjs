import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS||process.cwd(),'package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const {prepareLibrarySVG,createPluginLibrary}=await import('../figma-plugin/src/library.js');
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M1 1L22 22L1 22Z"/></svg>';
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Library condition timed out');};
const windowFor=async()=>{const w=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});const html=await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8');w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');return {w,html};};

test('actual bundled plugin queries the shared asset API and inserts SVG through main bridge without saving',async()=>{
 const {w}=await windowFor(),d=w.document;const requests=[],outbound=[],nodes=[],viewportCalls=[];let html,bridgeId,emptyImport=false,expired=false;
 const figma={clientStorage:{getAsync:async()=>undefined,setAsync:async()=>{},deleteAsync:async()=>{}},currentPage:{selection:[],appendChild:node=>nodes.push(node)},viewport:{center:{x:200,y:300},scrollAndZoomIntoView:list=>viewportCalls.push(list)},ui:{postMessage:message=>{outbound.push(message);queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{data:{pluginMessage:message}})));}},showUI:content=>{html=content;bridgeId=content.match(/const BRIDGE_ID = "([^"]+)"/)[1];},on(){},createNodeFromSvg:content=>{assert.equal(content,prepareLibrarySVG({svg}).svg);return {id:'inserted',width:24,height:24,children:emptyImport?[]:[{type:'VECTOR',editable:true}],remove(){this.removed=true;}};}};
 vm.runInNewContext(await fs.readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8'),{figma,__html__:await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8')});
 const asset={id:'asset',workspace_id:'space',name:'玻璃星星',svg,structure:'Filled',visual_style:'Glassmorphism',color_mode:'Multicolor',target_platform:'App'};
 const png={id:'png',workspace_id:'space',name:'图片资源',format:'image/png',svg:'data:image/png;base64,x'};
 const fetcher=async(url,options)=>{
  requests.push({url,options});
  if(url.includes('/auth/v1/token'))return new Response(JSON.stringify({access_token:'user-token',expires_in:3600,user:{id:'viewer',email:'viewer@test.com'}}));
  assert.equal(options.headers.Authorization,'Bearer user-token');
  if(url.includes('/il_workspaces'))return new Response('[{"id":"space","name":"同一资产库","owner_id":"other"}]');
  if(url.includes('/il_members'))return new Response('[{"role":"viewer"}]');
  if(url.includes('/il_assets'))return expired?new Response('{"message":"expired"}',{status:401}):new Response(JSON.stringify([asset,png]));
  if(url.includes('/auth/v1/logout'))return new Response('{}');
  throw Error('Unexpected request; insertion must not upload '+url);
 };
 const context=vm.createContext({window:w,document:d,parent:{postMessage:({pluginMessage})=>figma.ui.onmessage(pluginMessage)},DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,FormData:w.FormData,TextEncoder,URL,URLSearchParams,Map,Response,AbortSignal,fetch:fetcher,setTimeout,clearTimeout,console});
 try{
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
  d.getElementById('library-tab').click();assert.match(d.getElementById('library-message').textContent,/登录/);
  await wait(()=>!d.getElementById('login').disabled);d.getElementById('email').value='viewer@test.com';d.getElementById('password').value='test-password';d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await wait(()=>d.querySelectorAll('.plugin-library-card').length===2);
  assert.match(d.getElementById('role').textContent,/只读/,'read-only users can reuse but cannot upload');
  const cards=()=>d.querySelectorAll('.plugin-library-card');
  assert.ok(cards()[0].querySelector('img').src.startsWith('data:image/svg+xml'));assert.equal(cards()[0].querySelector('button').disabled,false);assert.equal(cards()[1].querySelector('button').disabled,true);assert.match(cards()[1].textContent,/image\/png/);
  const query=d.getElementById('library-query');query.value='玻璃';d.getElementById('library-structure').value='Filled';d.getElementById('library-style').value='Glassmorphism';d.getElementById('library-search').click();
  await wait(()=>requests.filter(r=>r.url.includes('/il_assets')).length===2&&cards().length===2);
  const params=new URL(requests.at(-1).url).searchParams;assert.equal(params.get('name'),'ilike.%玻璃%');assert.equal(params.get('structure'),'eq.Filled');assert.equal(params.get('visual_style'),'eq.Glassmorphism');assert.equal(params.get('workspace_id'),'eq.space');
  cards()[0].querySelector('button').click();await wait(()=>d.getElementById('library-message').textContent.includes('已插入并选中'));
  assert.equal(nodes.length,1);assert.equal(nodes[0].name,'玻璃星星');assert.equal(nodes[0].x,188);assert.equal(nodes[0].y,288);assert.equal(nodes[0].children[0].type,'VECTOR');assert.equal(figma.currentPage.selection[0],nodes[0]);assert.equal(viewportCalls[0][0],nodes[0]);
  assert.ok(!requests.some(r=>r.url.includes('/rpc/il_save_asset')),'reuse never creates an asset or revision');
  figma.ui.onmessage({type:'insert-svg',bridgeId:'wrong',svg,requestId:'wrong'});assert.equal(nodes.length,1);
  figma.ui.onmessage({type:'insert-svg',bridgeId,svg:'data:image/png;base64,x',requestId:'png'});assert.equal(outbound.at(-1).ok,false);assert.equal(nodes.length,1);
  emptyImport=true;figma.ui.onmessage({type:'insert-svg',bridgeId,svg:prepareLibrarySVG({svg}).svg,requestId:'empty'});assert.equal(outbound.at(-1).ok,false);assert.match(outbound.at(-1).message,/未生成可编辑图层/);assert.equal(nodes.length,1);
  d.getElementById('library-reset').click();await wait(()=>requests.filter(r=>r.url.includes('/il_assets')).length===3&&cards().length===2);assert.equal(query.value,'');assert.equal(new URL(requests.at(-1).url).searchParams.has('structure'),false);
  expired=true;d.getElementById('library-search').click();await wait(()=>!d.getElementById('login-form').hidden&&cards().length===0);assert.match(d.getElementById('library-message').textContent,/登录/);
  expired=false;d.getElementById('password').value='test-password';d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>cards().length===2);
  d.getElementById('logout').click();await wait(()=>cards().length===0);assert.match(d.getElementById('library-message').textContent,/登录/);
 }finally{await w.happyDOM.abort();}
});

test('library pagination, stale workspace results, expired session and non-SVG errors are explicit',async()=>{
 assert.throws(()=>prepareLibrarySVG({format:'image/png',svg}),/仅支持插入 SVG/);
 assert.throws(()=>prepareLibrarySVG({svg:'<html>not SVG</html>'}),/没有可插入/);
 const {w}=await windowFor();globalThis.document=w.document;
 let workspace='a',resolveStale;const calls=[];
 const page=Array.from({length:24},(_,i)=>({id:String(i),name:'图标'+i,svg}));
 const client={config:{url:'https://test.supabase.co'},session:{access_token:'token',user:{id:'u'}},searchAssets:async(space,options)=>{calls.push({space,options});if(space==='a'&&options.offset===24)return new Promise(resolve=>resolveStale=resolve);if(space==='b')return [{id:'b',name:'新空间',svg}];return page;}};
 const api=createPluginLibrary({client,context:()=>({workspace}),send:()=>{}}),d=w.document;
 try{
  d.getElementById('library-tab').click();await wait(()=>d.querySelectorAll('.plugin-library-card').length===24);assert.equal(d.getElementById('library-more').hidden,false);
  d.getElementById('library-more').click();await wait(()=>resolveStale);assert.equal(calls.at(-1).options.offset,24);
  workspace='b';api.contextChanged();await wait(()=>d.querySelectorAll('.plugin-library-card').length===1);resolveStale(page);await new Promise(r=>setTimeout(r,5));assert.match(d.getElementById('library-results').textContent,/新空间/);assert.doesNotMatch(d.getElementById('library-results').textContent,/图标0/);
  client.searchAssets=async()=>{client.session=null;throw Error('expired');};d.getElementById('library-search').click();await wait(()=>d.querySelectorAll('.plugin-library-card').length===0);assert.match(d.getElementById('library-message').textContent,/登录/);
 }finally{await w.happyDOM.abort();}
});
