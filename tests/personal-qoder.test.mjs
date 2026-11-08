import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizePersonalQoder,publicQoderStatus,createPersonalQoderStore,handlePersonalQoder} from '../personal-qoder.js';
import {initPersonalQoderUI} from '../personal-qoder-ui.js';
const config={key:'pt-private-test-only',agentId:'agent_own',environmentId:'env_own',model:'ultimate',credits:'1.00'};
const user='11111111-2222-4333-8444-555555555555';
const wait=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
function qoderFetch(calls,{reject=false}={}){return async(url,init)=>{calls.push({url:String(url),init});if(reject)return new Response('upstream private details '+config.key,{status:401});return Response.json(String(url).includes('/agents/')?{id:config.agentId,type:'agent',version:1,model:'ultimate',tools:[],mcp_servers:[],skills:[],multiagent:null}:{id:config.environmentId,type:'environment'});};}
test('personal configuration validates bounded IDs/budget, blank PAT preserves existing secret, status never returns secret',()=>{
 assert.deepEqual(normalizePersonalQoder({...config,key:''},config),config);
 for(const change of [{key:'bad'},{agentId:'https://evil.invalid'},{environmentId:'bad'},{credits:'11'},{credits:'0'},{model:'x\nheader'}])assert.throws(()=>normalizePersonalQoder({...config,...change}));
 assert.equal(JSON.stringify(publicQoderStatus(config)).includes(config.key),false);
 assert.deepEqual(publicQoderStatus(null),{configured:false});
});
test('saving checks PAT access to both resources with GET only, then encrypts; upstream failure is sanitized and never saves',async()=>{
 const calls=[],saved=[],store={load:async()=>null,save:async(u,c)=>saved.push({u,c})};
 const result=await handlePersonalQoder({action:'save',config},user,store,{fetcher:qoderFetch(calls)});
 assert.equal(result.configured,true);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.init.method==='GET'));
 assert.equal(saved[0].u,user);assert.deepEqual(saved[0].c,config);assert.equal(JSON.stringify(result).includes(config.key),false);
 saved.length=0;
 await assert.rejects(handlePersonalQoder({action:'save',config},user,store,{fetcher:qoderFetch([],{reject:true})}),e=>!e.message.includes(config.key));
 assert.equal(saved.length,0);
});
test('credential store sends service key only to fixed Supabase RPC and sanitizes all storage failures',async()=>{
 const calls=[],values={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only-test'};
 const store=createPersonalQoderStore({get:n=>values[n]},{fetcher:async(url,init)=>{calls.push({url:String(url),init});return Response.json(config);}});
 assert.deepEqual(await store.load(user),config);assert.equal(calls[0].url,'https://db.invalid/rest/v1/rpc/il_personal_qoder');
 assert.deepEqual(JSON.parse(calls[0].init.body),{p_action:'load',p_user:user,p_config:null});
 const broken=createPersonalQoderStore({get:n=>values[n]},{fetcher:async()=>new Response(config.key,{status:500})});
 await assert.rejects(broken.load(user),e=>e.code==='credentials_unavailable'&&!e.message.includes(config.key));
});
test('Edge derives credential owner from verified login, ignores body owner, does not return PAT, denies unapproved users first',async()=>{
 const prior=globalThis.Deno;globalThis.Deno={env:{get:()=>undefined},serve(){}};
 let createEdgeHandler;try{({createEdgeHandler}=await import('../supabase/functions/icon-ai/index.ts'));}finally{globalThis.Deno=prior;}
 const values={AI_ALLOWED_ORIGINS:'https://app.invalid',AI_ALLOWED_USER_IDS:user,SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'server-test'};
 const calls=[];
 const handler=createEdgeHandler({env:{get:n=>values[n]},fetcher:async(url,init)=>{calls.push({url:String(url),init});return Response.json(String(url).endsWith('/auth/v1/user')?{id:user}:config);}});
 const req=(body)=>new Request('https://edge.invalid',{method:'POST',headers:{Origin:'https://app.invalid',Authorization:'Bearer login','Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await handler(req({operation:'credentials',action:'status',userId:'other',p_user:'other'}));
 assert.equal(response.status,200);assert.equal(JSON.parse(calls[1].init.body).p_user,user);assert.equal((await response.text()).includes(config.key),false);
 values.AI_ALLOWED_USER_IDS='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';calls.length=0;
 assert.equal((await handler(req({operation:'credentials',action:'remove'}))).status,403);assert.equal(calls.length,1);
});
test('stored personal Qoder failure never falls back to a shared model; storage outage also stops before model use',async()=>{
 const {createEdgeHandler}=await import('../supabase/functions/icon-ai/index.ts');
 const values={AI_ALLOWED_ORIGINS:'https://app.invalid',AI_ALLOWED_USER_IDS:user,SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',MODEL_API_URL:'https://shared.invalid/v1/chat/completions',MODEL_API_KEY:'shared-test',MODEL_NAME:'shared'};
 for(const storageFailure of [false,true]){
  const calls=[];
  const handler=createEdgeHandler({env:{get:n=>values[n]},fetcher:async(url,init)=>{url=String(url);calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:user});if(url.endsWith('/il_personal_qoder'))return storageFailure?new Response('private',{status:500}):Response.json(config);assert.ok(url.includes('/agents/agent_own'));assert.equal(init.headers.Authorization,'Bearer '+config.key);return new Response('private',{status:401});}});
  const response=await handler(new Request('https://edge.invalid',{method:'POST',headers:{Origin:'https://app.invalid',Authorization:'Bearer login','Content-Type':'application/json'},body:JSON.stringify({operation:'generate',references:[{name:'ref',svg:'<svg viewBox="0 0 24 24"><path d="M6 12L18 12"/></svg>',preview:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII='}],spec:{canvas:24,stroke:2,color:'#30343b',cap:'round',join:'round',padding:2,styleNotes:'线性'},prompt:'搜索图标，用于查找设备'})}));
  assert.ok(response.status>=400);assert.ok(calls.every(url=>!url.includes('shared.invalid')));assert.equal((await response.text()).includes(config.key),false);
 }
});
test('personal settings UI clears PAT on success/failure/close and never writes browser storage',async()=>{
 const w=new Window({url:'https://app.invalid'}),d=w.document;
 d.documentElement.innerHTML=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace(/<!doctype html>|<html[^>]*>|<\/html>/gi,'');
 globalThis.window=w;globalThis.document=d;
 const $=id=>d.getElementById(id),calls=[];let fail=false;
 initPersonalQoderUI({request:async body=>{calls.push(structuredClone(body));if(fail)throw Error('连接失败');return body.action==='remove'?{configured:false}:body.action==='status'?{configured:false}:publicQoderStatus(config);}});
 $('ai-connection-details').open=true;$('ai-connection-details').dispatchEvent(new w.Event('toggle'));await wait(()=>calls.length&&rootBusy()===false);
 function rootBusy(){return $('personal-qoder-settings').getAttribute('aria-busy')==='true';}
 $('qoder-pat').value=config.key;$('qoder-agent').value=config.agentId;$('qoder-environment').value=config.environmentId;$('qoder-save').click();await wait(()=>!rootBusy());
 assert.equal($('qoder-pat').value,'');assert.equal($('qoder-remove').hidden,false);
 assert.equal(w.localStorage.length+w.sessionStorage.length,0);
 fail=true;$('qoder-pat').value=config.key;$('qoder-save').click();await wait(()=>!rootBusy());assert.equal($('qoder-pat').value,'');assert.match($('qoder-status').textContent,/连接失败/);
 fail=false;$('qoder-remove').click();await wait(()=>!rootBusy());assert.equal($('qoder-remove').hidden,true);
 $('qoder-pat').value=config.key;$('ai-connection-details').open=false;$('ai-connection-details').dispatchEvent(new w.Event('toggle'));assert.equal($('qoder-pat').value,'');
 await w.happyDOM.close();
});
