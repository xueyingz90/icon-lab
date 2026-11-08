import test from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeHandler} from '../supabase/functions/icon-ai/handler.ts';
const user='11111111-2222-4333-8444-555555555555';
const values={AI_ALLOWED_ORIGINS:'https://app.invalid',AI_ALLOWED_USER_IDS:user,SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon-test'};
function setup({userId=user,fail=false}={}){const calls=[];return {calls,handler:createEdgeHandler({client:'figma',env:{get:n=>values[n]},credentialStore:{available:true,load:async()=>null,save:async()=>assert.fail('No credential writes'),remove:async()=>assert.fail('No credential removals')},fetcher:async(url,init)=>{calls.push(String(url));return fail?new Response('{}',{status:401}):Response.json({id:userId});}})};}
function req({origin,token='login',marker='figma-plugin',body={operation:'credentials',action:'status'},method='POST',extra={}}={}){return new Request('https://edge.invalid',{method,headers:{...(origin===undefined?{}:{Origin:origin}),...(token?{Authorization:'Bearer '+token}:{}),...(marker?{'X-Iconlab-Client':marker}:{}),'Content-Type':'application/json',...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})});}
test('plugin endpoint accepts native/no origin and exact Figma opaque origin only after real user authentication',async()=>{
 for(const origin of [undefined,'null','https://www.figma.com']){const {handler,calls}=setup();const r=await handler(req({origin}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{configured:false});assert.equal(calls.length,1);assert.equal(r.headers.get('access-control-allow-origin'),origin??null);}
 for(const origin of ['https://evil.invalid','https://app.invalid']){const {handler,calls}=setup();assert.equal((await handler(req({origin}))).status,403);assert.equal(calls.length,0);}
 for(const options of [{token:null},{marker:null}]){const {handler,calls}=setup();assert.ok((await handler(req(options))).status>=400);assert.equal(calls.length,0);}
 assert.equal((await setup({userId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}).handler(req())).status,403);
 assert.equal((await setup({fail:true}).handler(req())).status,401);
});
test('Figma preflight is exact, never wildcard; plugin cannot save or delete personal credentials',async()=>{
 const {handler}=setup();
 const response=await handler(req({origin:'null',method:'OPTIONS',extra:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,apikey,x-iconlab-client'}}));
 assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'null');
 for(const action of ['save','remove'])assert.equal((await handler(req({body:{operation:'credentials',action,config:{key:'not-real'}}}))).status,400);
 assert.equal((await handler(req({origin:'null',method:'OPTIONS',extra:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-foreign'}}))).status,403);
});
