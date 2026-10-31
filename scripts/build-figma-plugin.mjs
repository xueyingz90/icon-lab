import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources=['taxonomy.js','catalog-core.js','cloud-client.js','cloud-config.js','figma-plugin/src/sync-core.js','figma-plugin/src/library.js','figma-plugin/src/session.js','figma-plugin/src/ui.js'];
const scripts=await Promise.all(sources.map(async file=>{
  const source=await fs.readFile(path.join(root,file),'utf8');
  return '// '+file+'\n'+source.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
}));
const script='"use strict";\n(()=>{\n'+scripts.join('\n\n')+'\n})();';
const template=await fs.readFile(path.join(root,'figma-plugin/src/ui.template.html'),'utf8');
if(!template.includes('/*__BUNDLE__*/'))throw Error('Plugin UI template marker missing');
await fs.writeFile(path.join(root,'figma-plugin/ui.html'),template.replace('/*__BUNDLE__*/',()=>script.replace(/<\/script/gi,'<\\/script')));
console.log('Built figma-plugin/ui.html (local bundle, no remote scripts)');
