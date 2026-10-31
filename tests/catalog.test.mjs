import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.join(process.env.ICONLAB_TEST_DEPS || process.cwd(),'package.json'));
const {DOMParser, XMLSerializer}=require('@xmldom/xmldom');
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const {cleanSVG,normalizeMetadata,sourceKey,sha256,localSave,matchesAsset}=await import('../catalog-core.js');
const {CloudClient,validateConfig}=await import('../cloud-client.js');
const simple='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2L12 12" stroke="#111"/></svg>';
test('SVG preserves transformed multicolor geometry and local gradient references',()=>{
 const s=cleanSVG('<svg viewBox="0 0 32 32"><defs><linearGradient id="a"><stop offset="0" stop-color="#f00"/></linearGradient></defs><g transform="translate(1 2)"><path d="M0 0L12 12" fill="url(#a)"/></g></svg>');
 assert.equal(s.width,32);assert.match(s.svg,/translate\(1 2\)/);assert.match(s.svg,/url\(#a\)/);
});
test('SVG rejects executable elements, event handlers, external references, CSS obfuscation and invalid bounds',()=>{
 for(const inner of ['<script>alert(1)</script>','<foreignObject/>','<image href="https://evil.test/a"/>','<path onload="x"/>','<path style="fill:url(https://evil.test/a)"/>','<path fill="url(#missing)"/>','<path style="fill:u/**/rl(x)"/>'])assert.throws(()=>cleanSVG('<svg viewBox="0 0 24 24">'+inner+'</svg>'));
 assert.throws(()=>cleanSVG('<!DOCTYPE svg><svg viewBox="0 0 24 24"/>'));
 assert.throws(()=>cleanSVG('<svg viewBox="0 0 -1 24"/>'));
 assert.throws(()=>cleanSVG('<svg viewBox="0 0 24 24">'+' '.repeat(1048576)+'</svg>'));
});
test('local revisions are immutable; duplicate upload needs explicit update and stale edit is rejected',async()=>{
 const info=cleanSVG(simple), hash=await sha256(info.svg), meta=normalizeMetadata({name:'收藏',tags:'收藏,收藏,书签',source_url:'https://www.figma.com/design/key/name?node-id=1-2'});
 const first=localSave([],meta,info,hash);
 assert.equal(first.asset.version,1);assert.deepEqual(meta.tags,['收藏','书签']);
 const same=localSave(first.records,meta,info,hash);assert.equal(same.result,'unchanged');assert.equal(same.records.length,1);
 const changed={...meta,name:'收藏状态'};
 assert.equal(localSave(first.records,changed,info,hash).result,'duplicate');
 const next=localSave(first.records,changed,info,hash,first.asset.id,1);
 assert.equal(next.asset.version,2);assert.equal(next.asset.revisions[1].name,'收藏');
 assert.throws(()=>localSave(next.records,meta,info,hash,first.asset.id,1),/版本/);
 assert.equal(sourceKey('https://figma.com/file/key/other?node-id=1%3A2'),'figma:key:1:2');
 assert.ok(matchesAsset(next.asset,'书签 收藏','通用','线性'));
 assert.ok(!matchesAsset(next.asset,'不存在'));
});
test('browser config rejects secret/service keys and unsupported URL schemes',()=>{
 assert.throws(()=>validateConfig('https://a.supabase.co','sb_secret_x'));
 assert.throws(()=>validateConfig('http://a.supabase.co','sb_publishable_x'));
 const key='e30.'+btoa(JSON.stringify({role:'service_role'}))+'.x';assert.throws(()=>validateConfig('https://a.supabase.co',key));
 assert.deepEqual(validateConfig('https://a.supabase.co','sb_publishable_x'),{url:'https://a.supabase.co',key:'sb_publishable_x'});
});
test('default fetch keeps the browser global receiver during login and registration',async()=>{
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async function(url,options) {
  assert.equal(this,globalThis,'native browser fetch requires its global receiver');
  calls.push({url,options});
  return new Response(JSON.stringify({user:{id:'u'}}));
 };
 try {
  const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const c=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage});
  await c.signIn('user@example.com','password');
  await c.signUp('user@example.com','password');
  assert.equal(calls.length,2);
  assert.ok(calls[0].url.endsWith('/auth/v1/token?grant_type=password'));
  assert.ok(calls[1].url.endsWith('/auth/v1/signup'));
 } finally {globalThis.fetch=originalFetch;}
});
test('authenticated request uses user JWT; expired session refreshes and RPC errors are surfaced',async()=>{
 const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const calls=[];const fetcher=async(url,opts)=>{calls.push({url,opts});
 if(url.includes('grant_type=password'))return new Response(JSON.stringify({access_token:'old',refresh_token:'refresh',expires_in:0,user:{id:'u'}}));
 if(url.includes('grant_type=refresh_token'))return new Response(JSON.stringify({access_token:'new',refresh_token:'refresh2',expires_in:3600,user:{id:'u'}}));
 if(url.includes('rpc/fail'))return new Response(JSON.stringify({message:'版本冲突'}),{status:409});
 return new Response('[]');};
 const c=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage,fetcher});
 await c.signIn('user@example.com','password');await c.assets('workspace');
 assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer new');assert.equal(calls.at(-1).opts.headers.apikey,'sb_publishable_test');
 await assert.rejects(()=>c.rpc('fail'),/版本冲突/);
 assert.equal(values.size,1);c.setSession(null);assert.equal(values.size,0);
});

test('refresh failures distinguish offline/server errors from revocation; stale responses cannot restore a logged-out session',async()=>{
 const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const session={access_token:'old',refresh_token:'refresh',expires_at:0,user:{id:'u'}};
 for(const failure of ['offline',503,429,400,401]){
  const c=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage,fetcher:async()=>{if(failure==='offline')throw Error('offline');return new Response('{"message":"failed"}',{status:failure});}});c.setSession(session);
  await assert.rejects(()=>c.refresh());assert.equal(c.session,[400,401].includes(failure)?null:session);
 }
 let finish;const c=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage,fetcher:()=>new Promise(r=>finish=r)});c.setSession(session);
 const refreshing=c.refresh();c.setSession(null);finish(new Response(JSON.stringify({access_token:'late',refresh_token:'late-refresh',expires_in:3600,user:{id:'u'}})));await assert.rejects(()=>refreshing,/已变化/);assert.equal(c.session,null);
 let respond;const d=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage,fetcher:()=>new Promise(r=>respond=r)});d.setSession({...session,expires_at:Date.now()/1000+3600});const request=d.assets('space');d.setSession({access_token:'new-user',refresh_token:'new-refresh',expires_at:Date.now()/1000+3600,user:{id:'other'}});respond(new Response('{"message":"old user failed"}',{status:401}));await assert.rejects(()=>request);assert.equal(d.session.user.id,'other');
});
