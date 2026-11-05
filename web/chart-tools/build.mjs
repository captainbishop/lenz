import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url),out=new URL('../public/chart-vendor/',root),pkg=JSON.parse(await readFile(new URL('node_modules/lightweight-charts/package.json',root),'utf8'));
assert.equal(pkg.version,'5.2.1');await mkdir(out,{recursive:true});
const files={'lightweight-charts.js':'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs','LICENSE.txt':'node_modules/lightweight-charts/LICENSE','NOTICE.txt':'NOTICE.txt','fancy-canvas-LICENSE.txt':'fancy-canvas-LICENSE.txt'};
const hashes={};for(const [name,source]of Object.entries(files)){await copyFile(new URL(source,root),new URL(name,out));hashes[name]=createHash('sha256').update(await readFile(new URL(name,out))).digest('hex');}
await writeFile(new URL('build.json',out),JSON.stringify({package:'lightweight-charts',version:pkg.version,files:hashes},null,2)+'\n');
console.log('Copied Lightweight Charts '+pkg.version+' and licenses.');
