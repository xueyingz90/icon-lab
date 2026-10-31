import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS || process.cwd(),'package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const {selectionSource,prepareSelection,syncSelection,memoryStorage}=await import('../figma-plugin/src/sync-core.js');
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 2L12 12" fill="none" stroke="#111"/></svg>';
const selection={token:1,nodeId:'12:34',name:'收藏',nodeType:'FRAME',width:24,height:24,fileKey:'',svg};
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Plugin condition timed out');};

test('Figma source is canonical, uses the selected node and rejects missing or mismatched files',async()=>{
 assert.throws(()=>selectionSource(selection),/文件链接/);
 assert.throws(()=>selectionSource(selection,'https://evil.test/design/file'),/Figma Design/);
 assert.throws(()=>selectionSource({...selection,fileKey:'known'},'https://www.figma.com/design/other/name'),/不一致/);
 assert.throws(()=>selectionSource({...selection,nodeId:'../../'},'https://www.figma.com/design/file/name'),/节点/);
 const prepared=prepareSelection(selection,{name:' 收藏 ',source_url:'https://www.figma.com/design/file/name?node-id=99-99',tags:'书签,收藏'});
 assert.equal(prepared.meta.source_key,'figma:file:12:34');
 assert.deepEqual(prepared.meta.tags,['书签','收藏']);assert.equal(prepared.meta.width,24);
 assert.equal(new URL(prepared.meta.source_url).searchParams.get('node-id'),'12-34');
 assert.equal(selectionSource({...selection,fileKey:'known'}),'https://www.figma.com/design/known/Icon-Lab?node-id=12-34');
 const calls=[];const client={rpc:async(name,body)=>{calls.push({name,body});return {result:'duplicate'};}};
 await syncSelection(client,'space',prepared);
 assert.equal(calls[0].body.p_asset_id,null);assert.equal(calls[0].name,'il_save_asset');
 await syncSelection(client,'space',prepared,{id:'existing',version:4});
 assert.equal(calls[1].body.p_asset_id,'existing');assert.equal(calls[1].body.p_expected_version,4);
 const a=memoryStorage(),b=memoryStorage();a.setItem('token','session');assert.equal(b.getItem('token'),null);
});

test('Figma bridge exports one selected icon; stale exports and changed selections cannot be confirmed',async()=>{
 const messages=[];const callbacks={};const opened=[];let bridgeId;
 const node={id:'12:34',name:'收藏',type:'FRAME',width:24,height:24,visible:true,exportAsync:async opts=>{assert.equal(opts.format,'SVG_STRING');return svg;}};
 const figma={currentPage:{selection:[]},ui:{postMessage:m=>messages.push(m)},showUI(html){bridgeId=html.match(/const BRIDGE_ID = "([^"]+)"/)[1];},on:(event,handler)=>callbacks[event]=handler,openExternal:url=>opened.push(url)};
 vm.runInNewContext(await fs.readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8'),{figma,__html__:await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8')});
 assert.notEqual(bridgeId,'__ICONLAB_BRIDGE_ID__');
 figma.ui.onmessage({type:'ready',bridgeId});await wait(()=>messages.some(m=>m.type==='selection-error'));
 assert.match(messages.at(-1).message,/只选中一个/);
 figma.currentPage.selection=[node];callbacks.selectionchange();await wait(()=>messages.at(-1).type==='selection');
 const token=messages.at(-1).selection.token;assert.equal(messages.at(-1).selection.fileKey,'');
 figma.ui.onmessage({type:'verify',requestId:'ok',nodeId:node.id,token,bridgeId});await wait(()=>messages.at(-1).type==='verified');
 figma.ui.onmessage({type:'verify',requestId:'wrong',nodeId:'wrong',token,bridgeId});await wait(()=>messages.at(-1).type==='verify-error');
 let finish;const slow={...node,id:'1:1',exportAsync:()=>new Promise(resolve=>finish=resolve)};
 figma.currentPage.selection=[slow];callbacks.selectionchange();
 figma.currentPage.selection=[{...node,id:'2:2'}];callbacks.selectionchange();await wait(()=>messages.at(-1).type==='selection');
 finish(svg);await new Promise(r=>setTimeout(r,5));assert.equal(messages.at(-1).selection.nodeId,'2:2');
 figma.ui.onmessage({type:'open-workbench',bridgeId:'wrong-bridge'});assert.equal(opened.length,0);
 figma.ui.onmessage({type:'open-workbench',bridgeId});assert.equal(opened[0],'https://xueyingz90.github.io/icon-lab/');
 figma.currentPage.selection=[{...node,type:'GROUP'}];callbacks.selectionchange();await wait(()=>messages.at(-1).type==='selection-error');
});

test('real plugin main and bundled UI exchange relayed null-source messages without uploading',async()=>{
 const w=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 const callbacks={};let html;
 const deliver=message=>w.dispatchEvent(new w.MessageEvent('message',{data:{pluginMessage:message}}));
 const node={id:'12:34',name:'AI星星',type:'FRAME',width:86,height:86,visible:true,exportAsync:async()=>svg};
 const figma={currentPage:{selection:[node]},ui:{postMessage:msg=>queueMicrotask(()=>deliver(msg))},showUI:value=>html=value,on:(name,fn)=>callbacks[name]=fn,openExternal(){}};
 vm.runInNewContext(await fs.readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8'),{figma,__html__:await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8')});
 w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');
 const bridge={postMessage:({pluginMessage})=>figma.ui.onmessage(pluginMessage)};
 const context=vm.createContext({window:w,document:w.document,parent:bridge,DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,FormData:w.FormData,TextEncoder,URL,Map,Response,AbortSignal,fetch:()=>{throw Error('Reading selection must not upload');},setTimeout,clearTimeout,console});
 try {
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
  await wait(()=>w.document.getElementById('preview').querySelector('img'));
  assert.equal(w.document.getElementById('selection-name').textContent,'AI星星');
  assert.match(w.document.getElementById('sync-hint').textContent,/登录/);
  w.document.getElementById('preview-background').click();assert.equal(w.document.getElementById('preview').dataset.background,'dark');
  figma.currentPage.selection=[];callbacks.selectionchange();
  await wait(()=>w.document.getElementById('selection-error').textContent.includes('只选中一个'));
  assert.equal(w.document.getElementById('sync').disabled,true);
 }finally{await w.happyDOM.abort();}
});

test('bundled Figma UI logs in, saves source metadata, confirms duplicate updates, blocks stale and read-only writes',async()=>{
 const w=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
 const html=await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8');
 w.document.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');
 const script=html.match(/<script>([\s\S]*)<\/script>/)[1];assert.doesNotMatch(script,/^import /m);
 const manifest=JSON.parse(await fs.readFile(new URL('../figma-plugin/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.networkAccess.allowedDomains,['https://blolhaacvmciirmiovdo.supabase.co']);assert.equal(manifest.documentAccess,'dynamic-page');
 const d=w.document,calls=[];let role='owner',reply='created',current={...selection},geometry=svg,version=1,verifyHook;
 const deliver=(message,source=null)=>{const event=new w.MessageEvent('message',{data:{pluginMessage:{bridgeId:'__ICONLAB_BRIDGE_ID__',...message}},source});w.dispatchEvent(event);};
 const bridge={postMessage:({pluginMessage:m})=>{
  if(m.type==='verify')queueMicrotask(()=>{
   if(verifyHook){verifyHook(m);return;}
   deliver({type:'verified',requestId:m.requestId,selection:{...current,svg:geometry}});
  });
 }};
 const fetcher=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});
  if(url.includes('/auth/v1/token'))return new Response(JSON.stringify({access_token:'user-token',refresh_token:'refresh',expires_in:3600,user:{id:'u',email:'test@example.com'}}));
  assert.equal(options.headers.Authorization,'Bearer user-token');
  if(url.includes('/auth/v1/logout'))return new Response('{}');
  if(url.includes('/il_workspaces'))return new Response('[{"id":"space","name":"我的图标库","owner_id":"u"}]');
  if(url.includes('/il_members'))return new Response(JSON.stringify([{role}]));
  if(url.includes('/rpc/il_save_asset')){
   if(reply==='conflict')return new Response('{"message":"版本已变化，请刷新后重试。"}',{status:409});
   if(reply==='updated')version++;
   return new Response(JSON.stringify({result:reply,asset:{id:'asset',name:body.p_meta.name,version}}));
  }
  throw Error('Unexpected plugin request '+url);
 };
 const context=vm.createContext({window:w,document:d,parent:bridge,DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,FormData:w.FormData,TextEncoder,URL,Map,Response,AbortSignal,fetch:fetcher,setTimeout,clearTimeout,console,crypto:globalThis.crypto});
 try {
  vm.runInContext(script,context);assert.equal(d.getElementById('sync').disabled,true);
  assert.match(d.getElementById('sync-hint').textContent,/登录/);
  deliver({type:'selection',selection:current});
  assert.ok(d.getElementById('preview').querySelector('img'),'Figma messages with a null source must render a preview');
  deliver({type:'selection-error',bridgeId:'wrong-bridge',message:'unrelated frame'},{postMessage(){}});
  assert.ok(d.getElementById('preview').querySelector('img'),'unrelated bridge messages must not change selection');
  deliver({type:'selection',selection:current},w);
  assert.ok(d.getElementById('preview').querySelector('img'),'self-dispatched Figma relay messages must also render a preview');
  d.getElementById('source').value='https://www.figma.com/design/file/name';
  d.getElementById('email').value='test@example.com';d.getElementById('password').value='test-password';
  d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await wait(()=>!d.getElementById('account').hidden && !d.getElementById('sync').disabled);
  assert.equal(d.getElementById('password').value,'');
  const submit=()=>d.getElementById('asset-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  const saves=()=>calls.filter(c=>c.url.includes('/rpc/il_save_asset'));
  submit();await wait(()=>saves().length===1 && !d.getElementById('sync').disabled);
  assert.equal(saves()[0].body.p_meta.source_key,'figma:file:12:34');assert.equal(saves()[0].body.p_meta.name,'收藏');
  assert.match(d.getElementById('message').textContent,/已保存/);
  assert.doesNotMatch(d.getElementById('message').textContent,/未审核/);
  reply='duplicate';submit();await wait(()=>!d.getElementById('duplicate').hidden);
  assert.equal(saves().at(-1).body.p_asset_id,null);assert.equal(saves().length,2);
  reply='updated';d.getElementById('update').click();await wait(()=>saves().length===3 && !d.getElementById('sync').disabled);
  assert.equal(saves().at(-1).body.p_asset_id,'asset');assert.equal(saves().at(-1).body.p_expected_version,1);
  assert.match(d.getElementById('message').textContent,/v2/);
  reply='duplicate';submit();await wait(()=>!d.getElementById('duplicate').hidden);
  reply='conflict';d.getElementById('update').click();await wait(()=>d.getElementById('message').textContent.includes('资产已被更新'));
  assert.equal(d.getElementById('duplicate').hidden,true);
  const count=saves().length;
  // Editing a node without changing selection must refresh the preview instead of writing stale geometry.
  geometry=svg.replace('M2 2L12 12','M3 3L13 13');submit();await wait(()=>d.getElementById('message').textContent.includes('图标已变化'));
  assert.equal(saves().length,count);
  // Switching selection while confirmation is pending cannot submit the previous icon.
  verifyHook=m=>{current={...selection,token:2,nodeId:'22:44'};deliver({type:'selection-loading',token:2});deliver({type:'selection',selection:current});deliver({type:'verified',requestId:m.requestId,selection:current});};
  submit();await wait(()=>d.getElementById('message').textContent.includes('选区已变化'));
  assert.equal(saves().length,count);verifyHook=null;
  role='viewer';d.getElementById('reload-spaces').click();await wait(()=>d.getElementById('role').textContent.includes('只读'));
  assert.equal(d.getElementById('sync').disabled,true);submit();await wait(()=>d.getElementById('message').textContent.includes('编辑权限'));
  assert.equal(saves().length,count);
  d.getElementById('logout').click();await wait(()=>!d.getElementById('login-form').hidden);
  assert.ok(calls.some(c=>c.url.endsWith('/auth/v1/logout?scope=local')));
  assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 }finally{await w.happyDOM.abort();}
});
