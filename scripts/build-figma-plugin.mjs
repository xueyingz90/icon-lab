import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources=['taxonomy.js','catalog-core.js','cloud-client.js','cloud-config.js','figma-plugin/src/sync-core.js','figma-plugin/src/library.js','figma-plugin/src/session.js','figma-plugin/src/ai.js','figma-plugin/src/ui.js'];
const scripts=await Promise.all(sources.map(async file=>{
  const source=await fs.readFile(path.join(root,file),'utf8');
  return '// '+file+'\n'+source.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
}));
const normalizer=(await fs.readFile(path.join(root,'vendor/morphicons/normalize-CYnN3Npw.js'),'utf8')).replace(/^export \{[^\n]+\};?$/gm,'');
const core=(await fs.readFile(path.join(root,'ai-core.js'),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const aiCore='const PluginAICore=(()=>{'+normalizer+'\n'+core+'\nreturn {normalizeCanvas,canvasDimensions,normalizeSpec,validateGeneratedIcons,generatedSVG};})();';
scripts.unshift(aiCore);
const script='"use strict";\n(()=>{\n'+scripts.join('\n\n')+'\n})();';
const template=await fs.readFile(path.join(root,'figma-plugin/src/ui.template.html'),'utf8');
if(!template.includes('/*__BUNDLE__*/'))throw Error('Plugin UI template marker missing');
await fs.writeFile(path.join(root,'figma-plugin/ui.html'),template.replace('/*__BUNDLE__*/',()=>script.replace(/<\/script/gi,'<\\/script')));
console.log('Built figma-plugin/ui.html (local bundle, no remote scripts)');

const host=await fs.readFile(path.join(root,'figma-plugin/src/ai-main.js'),'utf8');
const main=await fs.readFile(path.join(root,'figma-plugin/src/main.js'),'utf8');
await fs.writeFile(path.join(root,'figma-plugin/code.js'),host+'\n'+main);
