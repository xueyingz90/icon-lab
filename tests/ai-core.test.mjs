import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpec,validateGeneratedIcon,validateGeneratedIcons,generatedSVG} from '../ai-core.js';

const spec={canvas:24,stroke:2,color:'#252833',cap:'round',join:'round',padding:1,styleNotes:'等粗描边，简洁几何'};
const icon={name:'机械臂',d:'M4 20L4 16L10 10L16 6L20 10 M3 20L12 20'};

test('AI definitions validate all supported fields and discard unknown model properties',()=>{
  assert.deepEqual(normalizeSpec({...spec,color:'#AABBCC',unknown:'ignored'}),{...spec,color:'#aabbcc'});
  for (const patch of [{canvas:0},{stroke:0},{stroke:Infinity},{color:'url(#paint)'},{cap:'evil'},{join:'evil'},{padding:NaN},{padding:12},{styleNotes:null},{styleNotes:'x'.repeat(1001)}]) assert.throws(()=>normalizeSpec({...spec,...patch}));
});

test('AI paths yield safe SVG with verified numeric geometry and a fixed generation specification',()=>{
  const checked=validateGeneratedIcon({...icon,name:'<img onerror=alert(1)>',svg:'<script/>'},spec);
  assert.equal(checked.validation.status,'pass');assert.deepEqual(checked.spec,spec);
  const svg=generatedSVG(checked,106);
  assert.match(svg,/width="106"/);assert.match(svg,/stroke="#252833"/);assert.doesNotMatch(svg,/script|img|onerror/);
  assert.equal(checked.name,'<img onerror=alert(1)>');
  assert.throws(()=>generatedSVG(checked,10000));
  for (const size of [64,128,256]) assert.match(generatedSVG(checked,size),new RegExp(`width="${size}"`));
});

test('invalid, injected, relative, empty and excessively complex model paths are rejected',()=>{
  const invalid=['M4 4"/><script>alert(1)</script>','m4 4l2 2','M4 4A2 2 0 0 1 8 8','M4 4LNaN 5','M4 4L1e999 5','M4 4L20000 5','M4 4L5','M4 4','M4 4L4 4','M4 4L'+('5 5 '.repeat(140)),'M4 4L5 5 '+('M4 4L5 5 '.repeat(33)),'x'.repeat(12001)];
  for (const d of invalid) assert.throws(()=>validateGeneratedIcon({...icon,d},spec),d.slice(0,40));
  assert.throws(()=>validateGeneratedIcon({name:'',d:icon.d},spec));
  for (const d of ['M4 4L20 20 M0 0L0 0','M0 0L0 0 M4 4L20 20','M4 4L20 20 M0 0Z','M4 4L20 20 M0 0','M4 4L20 20Z L0 0']) assert.throws(()=>validateGeneratedIcon({...icon,d},spec),/子路径/);
});

test('cubic and quadratic extrema, stroke width, padding and conservative miter extents are enforced',()=>{
  assert.equal(validateGeneratedIcon({name:'曲线',d:'M4 12C8 2 16 2 20 12 Q12 20 4 12'},spec).validation.status,'pass');
  assert.throws(()=>validateGeneratedIcon({name:'超界曲线',d:'M4 12C8 -24 16 -24 20 12'},spec),/安全区域/);
  assert.throws(()=>validateGeneratedIcon({name:'描边越界',d:'M1 4L20 20'},spec),/安全区域/);
  assert.throws(()=>validateGeneratedIcon(icon,{...spec,padding:3}),/安全区域/);
  assert.throws(()=>validateGeneratedIcon(icon,{...spec,join:'miter'}),/安全区域/);
});

const candidates=[
  {name:'横线',d:'M6 12L18 12'},
  {name:'竖线',d:'M12 6L12 18'},
  {name:'折线',d:'M6 16L12 8L18 16'}
];

test('batch validator returns exactly three independently verified icons under one normalized spec',()=>{
  const input=candidates.map(value=>({...value,stroke:4,color:'#ffffff',fill:true,spec:{canvas:99},validation:{status:'pass'}}));
  const original=structuredClone(input);
  const definition={...spec,color:'#AABBCC',styleNotes:'  简洁线性  '};
  const checked=validateGeneratedIcons(input,definition);
  assert.equal(checked.length,3);
  assert.deepEqual(input,original,'validation must not mutate model output');
  checked.forEach((value,index)=>{
    assert.deepEqual(value,validateGeneratedIcon(candidates[index],definition));
    assert.equal(value.validation.status,'pass');
    assert.deepEqual(value.spec,normalizeSpec(definition));
    assert.equal(value.fill,false);
    assert.match(generatedSVG(value),/fill="none"/);
  });
});

test('batch validator rejects non-arrays and every count other than exactly three',()=>{
  for (const value of [undefined,null,{},candidates[0],{icons:candidates},[],candidates.slice(0,1),candidates.slice(0,2),[...candidates,{name:'斜线',d:'M6 6L18 18'}]]) {
    assert.throws(()=>validateGeneratedIcons(value,spec),/3|三/);
  }
});

test('batch validator rejects any invalid candidate, regardless of its position or forged pass status',()=>{
  const invalids=[
    null,{}, {...candidates[0],name:''}, {...candidates[0],name:'x'.repeat(81)},
    {name:'注入',d:'M4 4"/><script>globalThis.executed=true</script>'},
    {name:'相对',d:'m6 12l12 0'}, {name:'弧线',d:'M6 12A6 6 0 0 1 18 12'},
    {name:'退化',d:'M6 6L6 6'}, {name:'越界',d:'M0 0L24 24'},
    {name:'曲线越界',d:'M4 12C8 -24 16 -24 20 12'},
    {name:'空子路径',d:'M6 12L18 12 M0 0'}, {name:'超长',d:'x'.repeat(12001)}
  ];
  for (const invalid of invalids) for (let index=0;index<3;index++) {
    const values=structuredClone(candidates);
    values[index]=invalid && {...invalid,validation:{status:'pass'}};
    assert.throws(()=>validateGeneratedIcons(values,spec),`candidate ${index+1}: ${JSON.stringify(invalid)?.slice(0,60)}`);
  }
  assert.throws(()=>validateGeneratedIcons(candidates,{...spec,padding:5,stroke:4}),/安全区域/);
  assert.equal(globalThis.executed,undefined);
});

test('duplicate detection uses normalized cubic geometry, not names, whitespace or number spelling',()=>{
  for (const d of [
    candidates[0].d, ' M6,12\n L18,12 ', 'M+6.00 1.2e1 L1.8e1 12.000',
    'M6 12 18 12', 'M6 12C10 12 14 12 18 12', 'M6 12Q12 12 18 12',
    'M18 12L6 12', 'M6 12L10 12L14 12L18 12', 'M18 12L14 12L10 12L6 12'
  ]) {
    const duplicate={name:'不同名称不代表不同候选',d};
    assert.equal(validateGeneratedIcon(duplicate,spec).validation.status,'pass');
    for (const values of [[candidates[0],duplicate,candidates[1]],[candidates[0],candidates[1],duplicate]]) {
      assert.throws(()=>validateGeneratedIcons(values,spec),/重复|不同/);
    }
  }
  const curve={name:'二次曲线',d:'M6 12Q12 6 18 12'};
  const sameCurve={name:'三次曲线',d:'M6 12C10 8 14 8 18 12'};
  assert.equal(validateGeneratedIcon(sameCurve,spec).validation.status,'pass');
  assert.throws(()=>validateGeneratedIcons([curve,candidates[1],sameCurve],spec),/重复|不同/);
  assert.equal(validateGeneratedIcons(candidates.map(value=>({...value,name:'同名但不同几何'})),spec).length,3);
});

test('duplicate detection ignores traversal direction, closed starting vertex and subpath order',()=>{
  const equivalentPaths=[
    ['M6 12L18 12','M18 12L6 12','M6 12L10 12L14 12L18 12'],
    ['M6 12C10 8 14 8 18 12','M18 12C14 8 10 8 6 12'],
    ['M6 6L18 6L18 18L6 18Z','M18 6L18 18L6 18L6 6Z','M6 6L6 18L18 18L18 6Z'],
    ['M6 8L18 8 M6 16L18 16','M18 16L6 16 M18 8L6 8']
  ];
  for(const paths of equivalentPaths){
    const values=paths.map(d=>({name:'相同图形',d}));
    values.forEach(value=>assert.equal(validateGeneratedIcon(value,spec).validation.status,'pass'));
    for(const duplicate of values.slice(1)) assert.throws(()=>validateGeneratedIcons([values[0],duplicate,candidates[1]],spec),/重复|不同/);
  }
  const backtrack={name:'折返曲线',d:'M6 12C20 12 4 12 18 12'};
  assert.equal(validateGeneratedIcons([candidates[0],backtrack,candidates[1]],spec).length,3);
});
