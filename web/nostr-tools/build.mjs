import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = fileURLToPath(new URL('.', import.meta.url));
const output = new URL('../public/nostr-vendor/', import.meta.url);
await mkdir(output, { recursive: true });
await build({absWorkingDir:here,entryPoints:['entry.mjs'],outfile:fileURLToPath(new URL('nostr.js',output)),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
const packages = ['nostr-tools','@noble/curves','@noble/hashes','@noble/ciphers','@scure/base'];
const dependencies = {};
for(const name of packages) {
  const dir=new URL('./node_modules/'+name+'/',import.meta.url);
  dependencies[name]=JSON.parse(await readFile(new URL('package.json',dir))).version;
  await copyFile(new URL('LICENSE',dir),new URL(name.replaceAll('/','-').replace('@','')+'-LICENSE.txt',output));
}
const hash=data=>createHash('sha256').update(data).digest('hex');
await writeFile(new URL('build.json',output),JSON.stringify({dependencies,entrySha256:hash(await readFile(new URL('entry.mjs',import.meta.url))),bundleSha256:hash(await readFile(new URL('nostr.js',output)))},null,2)+'\n');
console.log('Built local Nostr cryptography bundle and preserved dependency licenses.');
