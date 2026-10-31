import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS||process.cwd(),'package.json'));
const {Window}=await import(pathToFileURL(require.resolve('happy-dom')).href);
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Session condition timed out');};
const origin='https://blolhaacvmciirmiovdo.supabase.co',key='iconlab.remembered-session.v1:'+origin;
const token=(n=1)=>({access_token:'access-'+n,refresh_token:'refresh-'+n,expires_in:3600,user:{id:'u',email:'test@example.com'},password:'must-never-persist',user_metadata:{private:'not-needed'}});
function backend(){let counter=0;return {mode:'online',calls:[],async fetch(url,options){
 this.calls.push({url,options});
 if(url.includes('grant_type=refresh_token')){if(this.mode==='offline')throw Error('Network unavailable');if(this.mode==='server-error')return new Response('{"message":"unavailable"}',{status:503});if(this.mode==='revoked')return new Response('{"message":"refresh token revoked"}',{status:400});return new Response(JSON.stringify(token(++counter)));}
 if(url.includes('grant_type=password'))return new Response(JSON.stringify(token(++counter)));
 if(url.includes('/auth/v1/logout')){if(this.mode==='offline')throw Error('Network unavailable');return new Response('{}');}
 assert.match(options.headers.Authorization,/^Bearer access-/);
 if(url.includes('/il_workspaces'))return new Response('[{"id":"space","name":"My library","owner_id":"u"}]');
 if(url.includes('/il_members'))return new Response('[{"role":"owner"}]');
 if(url.includes('/il_assets'))return this.mode==='assets-expired'?new Response('{"message":"JWT expired"}',{status:401}):new Response('[]');
 throw Error('Unexpected request '+url);
 }};}
async function openPlugin(storage,server){
 const w=new Window({settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}}),d=w.document;let html,bridgeId;const posts=[];
 const figma={clientStorage:{getAsync:async k=>structuredClone(storage.get(k)),setAsync:async(k,v)=>storage.set(k,structuredClone(v)),deleteAsync:async k=>storage.delete(k)},currentPage:{selection:[]},on(){},showUI:value=>{html=value;bridgeId=value.match(/const BRIDGE_ID = "([^"]+)"/)[1];},ui:{postMessage:message=>{posts.push(message);queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{data:{pluginMessage:message}})));}}};
 vm.runInNewContext(await fs.readFile(new URL('../figma-plugin/code.js',import.meta.url),'utf8'),{figma,__html__:await fs.readFile(new URL('../figma-plugin/ui.html',import.meta.url),'utf8')});
 d.documentElement.innerHTML=html.replace(/<!doctype html>/i,'').replace(/<html[^>]*>|<\/html>/g,'');
 const context=vm.createContext({window:w,document:d,parent:{postMessage:({pluginMessage})=>figma.ui.onmessage(pluginMessage)},DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer,FormData:w.FormData,TextEncoder,URL,URLSearchParams,Map,Response,AbortSignal,fetch:server.fetch.bind(server),setTimeout,clearTimeout,console});
 vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 await wait(()=>!d.getElementById('login').disabled);
 const login=async remember=>{if(d.getElementById('remember-session').checked!==remember){d.getElementById('remember-session').checked=remember;d.getElementById('remember-session').dispatchEvent(new w.Event('change'));await wait(()=>!d.getElementById('login').disabled);}
 d.getElementById('email').value='test@example.com';d.getElementById('password').value='typed-password';d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>!d.getElementById('account').hidden&&!d.getElementById('login').disabled);};
 return {w,d,figma,bridgeId,posts,login,close:()=>w.happyDOM.abort()};
}

test('unchecked login is ephemeral; opting in survives real bundled plugin restarts and rotates saved tokens',async()=>{
 const storage=new Map(),server=backend();let app=await openPlugin(storage,server);
 try{
 assert.equal(app.d.getElementById('remember-session').checked,false);await app.login(false);assert.equal(storage.size,0);await app.close();
 app=await openPlugin(storage,server);assert.equal(app.d.getElementById('account').hidden,true);await app.login(true);
 assert.equal(storage.size,1);const record=storage.get(key);assert.deepEqual(Object.keys(record.session).sort(),['access_token','expires_at','refresh_token','user']);assert.equal(record.session.password,undefined);assert.equal(record.session.user_metadata,undefined);assert.doesNotMatch(JSON.stringify(record),/typed-password|must-never-persist/);assert.equal(app.d.getElementById('password').value,'');
 const oldRefresh=record.session.refresh_token;await app.close();app=await openPlugin(storage,server);
 assert.equal(app.d.getElementById('account').hidden,false);assert.equal(app.d.getElementById('remember-session').checked,true);assert.notEqual(storage.get(key).session.refresh_token,oldRefresh);
 const refresh=server.calls.filter(c=>c.url.includes('grant_type=refresh_token'));assert.equal(refresh.length,1);assert.equal(JSON.parse(refresh[0].options.body).refresh_token,oldRefresh);
 app.d.getElementById('library-tab').click();await wait(()=>app.d.getElementById('library-message').textContent.includes('没有符合'));assert.equal(server.calls.at(-1).options.headers.Authorization,'Bearer '+storage.get(key).session.access_token);
 app.d.getElementById('remember-session').checked=false;app.d.getElementById('remember-session').dispatchEvent(new app.w.Event('change'));await wait(()=>storage.size===0&&!app.d.getElementById('login').disabled);assert.equal(app.d.getElementById('account').hidden,false,'forgetting the device keeps this runtime logged in');
 await app.close();app=await openPlugin(storage,server);assert.equal(app.d.getElementById('account').hidden,true);
 }finally{await app.close();}
});

test('offline restore retains saved session for retry; revoked refresh clears it; offline logout forgets the device',async()=>{
 const storage=new Map(),server=backend();let app=await openPlugin(storage,server);
 try{
 await app.login(true);const saved=structuredClone(storage.get(key));await app.close();server.mode='offline';app=await openPlugin(storage,server);
 assert.equal(app.d.getElementById('account').hidden,true);assert.deepEqual(storage.get(key),saved);assert.equal(app.d.getElementById('session-retry').hidden,false);
 server.mode='online';app.d.getElementById('session-retry').click();await wait(()=>!app.d.getElementById('account').hidden&&!app.d.getElementById('login').disabled);
 await app.close();server.mode='revoked';app=await openPlugin(storage,server);assert.equal(storage.size,0);assert.equal(app.d.getElementById('account').hidden,true);assert.match(app.d.getElementById('session-status').textContent,/失效/);
 server.mode='online';await app.login(true);server.mode='offline';app.d.getElementById('logout').click();await wait(()=>app.d.getElementById('account').hidden&&!app.d.getElementById('login').disabled);assert.equal(storage.size,0);assert.equal(app.d.getElementById('remember-session').checked,false);
 }finally{await app.close();}
});

test('main storage bridge drops invalid records, ignores foreign bridges and serializes save before clear',async()=>{
 const storage=new Map([[key,{version:1,origin:'https://wrong.supabase.co',session:{access_token:'wrong'}}]]),server=backend();const app=await openPlugin(storage,server);
 try{
 assert.equal(storage.size,0);assert.equal(app.d.getElementById('account').hidden,true);
 const session={...token(),expires_at:Date.now()/1000+3600};
 app.figma.ui.onmessage({type:'session-save',bridgeId:'wrong',origin,requestId:'bad',session});await new Promise(r=>setTimeout(r,5));assert.equal(storage.size,0);
 app.figma.ui.onmessage({type:'session-save',bridgeId:app.bridgeId,origin:'https://wrong.supabase.co',requestId:'wrong-origin',session});await wait(()=>app.posts.some(m=>m.requestId==='wrong-origin'));assert.equal(storage.size,0);
 let finish;app.figma.clientStorage.setAsync=async(k,v)=>{await new Promise(r=>finish=r);storage.set(k,structuredClone(v));};
 app.figma.ui.onmessage({type:'session-save',bridgeId:app.bridgeId,origin,requestId:'slow-save',session});await wait(()=>finish);
 app.figma.ui.onmessage({type:'session-clear',bridgeId:app.bridgeId,origin,requestId:'after-clear'});finish();await wait(()=>app.posts.some(m=>m.requestId==='after-clear'));assert.equal(storage.size,0,'late save must not resurrect a forgotten session');
 }finally{await app.close();}
});

test('failed local persistence is reported and can be disabled without losing the current login',async()=>{
 const storage=new Map(),server=backend(),app=await openPlugin(storage,server);
 try{
 app.figma.clientStorage.setAsync=async()=>{throw Error('storage denied');};await app.login(true);
 assert.equal(storage.size,0);assert.match(app.d.getElementById('session-status').textContent,/无法/);assert.equal(app.d.getElementById('account').hidden,false);
 app.d.getElementById('remember-session').checked=false;app.d.getElementById('remember-session').dispatchEvent(new app.w.Event('change'));await wait(()=>!app.d.getElementById('login').disabled);assert.match(app.d.getElementById('session-status').textContent,/已清除/);assert.equal(app.d.getElementById('account').hidden,false);
 }finally{await app.close();}
});

test('login failures stay visible next to login on the library tab, with actionable errors and no saved credentials',async()=>{
 const failures=[
  {status:400,body:{message:'Invalid login credentials'},expected:/邮箱或密码不正确/},
  {status:400,body:{message:'Email not confirmed'},expected:/邮箱尚未确认/},
  {status:429,body:{message:'rate limit'},expected:/过于频繁/},
  {status:503,body:{message:'upstream unavailable'},expected:/暂时不可用/},
  {error:new TypeError('Failed to fetch'),expected:/无法连接资产库/},
  {error:Object.assign(Error('request timed out'),{name:'TimeoutError'}),expected:/连接超时/}
 ];
 for(const failure of failures){
  const storage=new Map(),server=backend(),baseFetch=server.fetch.bind(server);server.fetch=async(url,options)=>{if(url.includes('grant_type=password')){if(failure.error)throw failure.error;return new Response(JSON.stringify(failure.body),{status:failure.status});}return baseFetch(url,options);};
  const app=await openPlugin(storage,server);
  try{
   const {d,w}=app;d.getElementById('library-tab').click();d.getElementById('email').value='test@example.com';d.getElementById('password').value='private-password';d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
   await wait(()=>!d.getElementById('login').disabled);const notice=d.getElementById('account-message');
   assert.equal(notice.hidden,false);assert.equal(notice.closest('#upload-panel'),null);assert.equal(d.getElementById('library-panel').hidden,false);assert.match(notice.textContent,failure.expected);assert.equal(notice.getAttribute('role'),'alert');assert.equal(d.getElementById('login').textContent,'登录');assert.doesNotMatch(notice.textContent,/private-password/);assert.equal(storage.size,0);
  }finally{await app.close();}
 }
});

test('login shows progress immediately and selection updates cannot hide it; success collapses account settings in library mode',async()=>{
 const server=backend(),baseFetch=server.fetch.bind(server);let finish;
 server.fetch=async(url,options)=>url.includes('grant_type=password')?new Promise(resolve=>finish=resolve):baseFetch(url,options);
 const app=await openPlugin(new Map(),server);
 try{
  const {d,w}=app;d.getElementById('library-tab').click();d.getElementById('email').value='test@example.com';d.getElementById('password').value='private-password';d.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal(d.getElementById('login').textContent,'正在登录…');assert.equal(d.getElementById('login').disabled,true);assert.equal(d.getElementById('login-form').getAttribute('aria-busy'),'true');assert.match(d.getElementById('account-message').textContent,/正在连接/);
  app.figma.ui.onmessage({type:'capture',bridgeId:app.bridgeId});await new Promise(r=>setTimeout(r,5));assert.equal(d.getElementById('account-message').hidden,false);assert.match(d.getElementById('account-message').textContent,/正在连接/);
  finish(new Response(JSON.stringify(token())));await wait(()=>!d.getElementById('login').disabled);assert.match(d.getElementById('account-message').textContent,/已登录/);assert.equal(d.getElementById('account-message').dataset.tone,'success');assert.equal(d.getElementById('account-message').hidden,false);assert.equal(d.getElementById('library-panel').hidden,false);assert.equal(d.getElementById('account-settings').hidden,true);assert.equal(d.getElementById('workspace-picker').hidden,false);
 }finally{await app.close();}
});

test('compact toolbar restores directly to library, exposes settings on demand and reopens login on expired sessions',async()=>{
 const storage=new Map(),server=backend();let app=await openPlugin(storage,server);
 try{
  assert.equal(app.d.querySelector('h1'),null);assert.equal(app.d.getElementById('account-settings').hidden,false,'first use shows login');
  await app.login(true);assert.equal(app.d.getElementById('account-settings').hidden,true);assert.equal(app.d.getElementById('account-toggle').getAttribute('aria-expanded'),'false');assert.equal(app.d.getElementById('library-panel').hidden,false);assert.equal(app.d.getElementById('upload-panel').hidden,true);
  app.d.getElementById('account-toggle').click();assert.equal(app.d.getElementById('account-settings').hidden,false);assert.equal(app.d.getElementById('account-toggle').getAttribute('aria-expanded'),'true');assert.equal(app.d.getElementById('account-email').textContent,'test@example.com');assert.equal(app.d.getElementById('remember-session').checked,true);
  app.d.getElementById('account-close').click();assert.equal(app.d.getElementById('account-settings').hidden,true);
  const passwordCalls=server.calls.filter(c=>c.url.includes('grant_type=password')).length;await app.close();app=await openPlugin(storage,server);
  await wait(()=>server.calls.at(-1).url.includes('/il_assets'));assert.equal(app.d.getElementById('account-settings').hidden,true);assert.equal(app.d.getElementById('library-tab').getAttribute('aria-pressed'),'true');assert.equal(app.d.getElementById('workspace-picker').hidden,false);assert.equal(app.d.getElementById('workspace').value,'space');assert.equal(server.calls.filter(c=>c.url.includes('grant_type=password')).length,passwordCalls,'restore never asks for the password');
  await wait(()=>!app.d.getElementById('library-search').disabled);server.mode='assets-expired';
  app.d.getElementById('library-search').click();await wait(()=>!app.d.getElementById('account-settings').hidden&&app.d.getElementById('account').hidden);assert.equal(app.d.getElementById('login-form').hidden,false);assert.equal(app.d.getElementById('workspace-picker').hidden,true);assert.equal(app.d.getElementById('account-message').dataset.tone,'info');assert.match(app.d.getElementById('account-message').textContent,/重新登录/);
 }finally{await app.close();}
});
