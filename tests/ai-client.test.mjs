import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {requestAI,prepareReferences} from '../ai-workflow.js';

const w=new Window({url:'https://example.test/'});
for (const name of ['window','localStorage','sessionStorage','DOMParser','XMLSerializer']) Object.defineProperty(globalThis,name,{value:name==='window'?w:w[name],configurable:true,writable:true});
const body={operation:'analyze'};

test('AI client never sends model secrets or requests cloud inference without a user session',async()=>{
  let calls=0;
  await assert.rejects(requestAI(body,{transport:'local',fetcher:async()=>{calls++;}}),/本地接口/);
  await assert.rejects(requestAI(body,{transport:'cloud',fetcher:async()=>{calls++;}}),/先.*登录/);
  assert.equal(calls,0);
});

test('AI cloud client refreshes and forwards only the user JWT and publishable key',async()=>{
  const config={url:'https://cloud.test',key:'sb_publishable_test'};
  localStorage.setItem('iconlab.cloud.config.v1',JSON.stringify(config));
  const storageKey='iconlab-session:'+config.url;
  sessionStorage.setItem(storageKey,JSON.stringify({access_token:'old-user-jwt',refresh_token:'refresh',expires_at:1,user:{id:'owner'}}));
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({access_token:'new-user-jwt',refresh_token:'refresh-2',expires_in:3600,user:{id:'owner'}}));
    assert.equal(options.headers.Authorization,'Bearer new-user-jwt');
    assert.equal(options.headers.apikey,config.key);
    assert.equal(options.body,JSON.stringify(body));
    assert.equal(url,config.url+'/functions/v1/icon-ai');
    return new Response('{"spec":{},"model":"mock"}');
  };
  const result=await requestAI(body,{transport:'cloud',fetcher});
  assert.equal(result.model,'mock');assert.equal(calls.length,2);
  assert.equal(JSON.parse(sessionStorage.getItem(storageKey)).access_token,'new-user-jwt');
});

test('AI client surfaces server failures and refuses results from a logged-out session',async()=>{
  const storageKey='iconlab-session:https://cloud.test';
  sessionStorage.setItem(storageKey,JSON.stringify({access_token:'jwt',expires_at:Date.now()/1000+3600,user:{id:'owner'}}));
  await assert.rejects(requestAI(body,{transport:'cloud',fetcher:async()=>new Response('{"message":"模型服务尚未配置"}',{status:503})}),/尚未配置/);
  await assert.rejects(requestAI(body,{transport:'cloud',fetcher:async()=>new Response('<html>missing function</html>')}),/未返回 JSON/);
  await assert.rejects(requestAI(body,{transport:'cloud',fetcher:async()=>{sessionStorage.removeItem(storageKey);return new Response('{"spec":{}}');}}),/账号已变化/);
});

test('AI references are cleaned and bounded before preview generation or network transmission',async()=>{
  await assert.rejects(prepareReferences([]),/1–8/);
  let previews=0;
  const reference={name:'样本',markup:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" onload="evil()"/></svg>',vb:[0,0,24,24]};
  await assert.rejects(prepareReferences([reference],async()=>{previews++;return ''; }),/属性/);
  assert.equal(previews,0);
  await assert.rejects(prepareReferences([{...reference,markup:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20"/></svg>'}],async()=> 'x'.repeat(180001)),/预览过大/);
});
