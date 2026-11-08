import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {cloudConfig} from '../cloud-config.js';
import {createAIWorkflow} from '../ai-workflow.js';
const wait=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,5));}throw Error('Feedback timed out');};
test('cloud AI reports actual config and stages, rejects double submission and retains candidates after failures',async()=>{
 const w=new Window({url:'https://xueyingz90.github.io/icon-lab/'}),d=w.document;
 d.documentElement.innerHTML=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 for(const name of ['window','document','localStorage','sessionStorage','DOMParser','XMLSerializer'])globalThis[name]=name==='window'?w:w[name];
 sessionStorage.setItem('iconlab-session:'+cloudConfig.url,JSON.stringify({access_token:'mock',expires_at:Date.now()/1000+3600,user:{id:'u'}}));
 globalThis.Image=class{naturalWidth=24;naturalHeight=24;set src(v){queueMicrotask(()=>this.onload());}};
 w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=>'data:image/png;base64,aGVsbG8=';
 const spec={canvas:24,stroke:2,color:'#252833',cap:'round',join:'round',padding:1,styleNotes:''};
 let failure=false,finish,paid=0,results=['previous'];const calls=[];
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);if(body.operation==='credentials'){if(failure)return Response.json({message:'个人配置服务暂不可用'}, {status:503});return Response.json({configured:true,model:'personal-model'});}
  paid++;if(body.operation==='analyze')return Response.json({spec,model:'mock'});
  await new Promise(r=>finish=r);return Response.json({message:'模型服务暂时不可用'}, {status:503});};
 const state={references:[{name:'参考',markup:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20"/></svg>'}]};
 const flow=createAIWorkflow({state,getSpec:()=>spec,applySpec(){},setCandidates:r=>results=r,persist(){},getMode:()=>'generate'});
 try{
  d.getElementById('ai-consent').checked=true;d.getElementById('ai-read').click();await wait(()=>!d.getElementById('ai-read').disabled);
  assert.match(d.getElementById('ai-provider-summary').textContent,/个人 Qoder.*personal-model/);d.getElementById('ai-confirm').click();d.getElementById('prompt').value='相机';
  const job=flow.generate();await wait(()=>finish);assert.equal(d.getElementById('generate').disabled,true);assert.equal(d.getElementById('generate').textContent,'正在生成…');assert.equal(d.getElementById('ai-progress').textContent,'等待生成服务');await flow.generate();assert.equal(paid,2);
  finish();await job;assert.deepEqual(results,['previous']);assert.match(d.getElementById('ai-status').textContent,/服务状态.*已有候选已保留/);assert.equal(d.getElementById('generate').disabled,false);
  failure=true;await flow.generate();assert.equal(paid,2,'configuration failure must stop before billable calls');assert.match(d.getElementById('ai-status').textContent,/个人配置服务暂不可用/);assert.equal(calls.at(-1).operation,'credentials');
 }finally{await w.happyDOM.abort();}
});
