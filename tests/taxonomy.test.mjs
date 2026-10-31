import test from 'node:test';
import assert from 'node:assert/strict';
import {classification,normalizeClassification,matchesClassification,UNCLASSIFIED} from '../taxonomy.js';
import {normalizeMetadata} from '../catalog-core.js';
import {CloudClient} from '../cloud-client.js';

test('independent dimensions combine without guessing ambiguous legacy categories',()=>{
 const dimensions={structure:'Filled',visual_style:'Glassmorphism',color_mode:'Multicolor',target_platform:'Glasses'};
 const asset=normalizeMetadata({name:'玻璃图标',...dimensions});
 assert.deepEqual(classification(asset),dimensions);assert.equal(asset.platform,'AI 眼镜');assert.equal(asset.visual_type,'面型');
 assert.equal(matchesClassification(asset,dimensions),true);
 assert.equal(matchesClassification(asset,{structure:'Filled',visual_style:'Flat'}),false);
 assert.equal(matchesClassification(asset,{}),true);
 assert.deepEqual(classification({visual_type:'彩色',platform:'通用'}),{structure:null,visual_style:null,color_mode:null,target_platform:null});
 assert.deepEqual(classification({visual_type:'多色',platform:'App'}),{structure:null,visual_style:null,color_mode:'Multicolor',target_platform:'App'});
 assert.equal(classification({visual_type:'线性',structure:null}).structure,null,'explicit unclassified must not revert to legacy');
 assert.equal(matchesClassification({visual_type:'面型'}, {structure:'Filled',visual_style:UNCLASSIFIED}),true);
 assert.equal(matchesClassification({visual_type:'彩色'}, {structure:UNCLASSIFIED,color_mode:UNCLASSIFIED}),true);
 const legacy={name:'旧图标',visual_type:'彩色',platform:'通用'};
 assert.equal(normalizeMetadata({...legacy,...classification(legacy)}).visual_type,'彩色','normalizing backups retains raw legacy labels');
 assert.throws(()=>normalizeClassification({structure:'Glassmorphism'}),/无效/);
});

test('shared asset API searches by name with AND filters, scoped workspace and pagination',async()=>{
 const requests=[];const client=new CloudClient({url:'https://test.supabase.co',key:'sb_publishable_test'},{storage:{getItem:()=>null,setItem(){},removeItem(){}},fetcher:async(url,options)=>{requests.push({url,options});return new Response('[]');}});
 client.setSession({access_token:'token',user:{id:'u'},expires_at:Date.now()/1000+3600});
 await client.searchAssets('workspace',{name:'收藏',structure:'Filled',visual_style:'Glassmorphism',color_mode:'Multicolor',target_platform:'App',offset:24,limit:24});
 const query=new URL(requests[0].url);assert.equal(query.pathname,'/rest/v1/il_assets');assert.equal(query.searchParams.get('workspace_id'),'eq.workspace');
 assert.equal(query.searchParams.get('name'),'ilike.%收藏%');assert.equal(query.searchParams.get('structure'),'eq.Filled');assert.equal(query.searchParams.get('visual_style'),'eq.Glassmorphism');assert.equal(query.searchParams.get('color_mode'),'eq.Multicolor');assert.equal(query.searchParams.get('target_platform'),'eq.App');assert.equal(query.searchParams.get('offset'),'24');assert.equal(query.searchParams.get('limit'),'24');assert.equal(requests[0].options.headers.Authorization,'Bearer token');
 await client.searchAssets('workspace',{visual_style:UNCLASSIFIED});assert.equal(new URL(requests[1].url).searchParams.get('visual_style'),'is.null');
 await client.searchAssets('workspace',{});assert.equal(new URL(requests[2].url).searchParams.has('structure'),false);
 assert.throws(()=>client.searchAssets('workspace',{structure:'Flat'}),/无效/);
});
