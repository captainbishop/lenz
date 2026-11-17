import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
const root = new URL('./public/', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');
const cacheManifest=runInNewContext(source.slice(0,source.indexOf('self.addEventListener'))+';({paths:PATHS,shell:BRAND_SHELL})',{importScripts:()=>{}});
const normalize=path=>path.replace(/^\.\//,'/');
const paths=Array.from(cacheManifest.paths,normalize);
assert.equal(new Set(paths).size, paths.length, 'Duplicate cache entry');
const shell=Array.from(cacheManifest.shell,normalize);
assert.equal(new Set(shell).size, shell.length, 'Duplicate brand-shell entry');
assert(shell.every(path => paths.includes(path)), 'Brand shell must use known cache entries');
assert(paths.includes('/vendor/ffjavascript-worker.js'), 'Proof subworker must be cached for offline proving');
assert(paths.includes('/account-return.js'), 'Account funding return must be cached');
let bytes = 0;
for (const entry of paths) {
  const file = new URL(entry === '/' ? './index.html' : '.'+entry, root);
  const info = await stat(file); assert(info.isFile()); bytes += info.size;
  if (entry.endsWith('.js')) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert(match[1].startsWith('./') || match[1].startsWith('../'), `Nonlocal import in ${entry}: ${match[1]}`);
      const dependency = new URL(match[1], file);
      const cached = '/' + decodeURIComponent(dependency.pathname.slice(root.pathname.length));
      assert(paths.includes(cached), `Uncached import in ${entry}: ${match[1]}`);
    }
  }
}
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
for (const icon of manifest.icons) {
  assert(paths.includes(icon.src), 'Manifest icon must be cached');
  const png = await readFile(new URL('.' + icon.src, root));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
console.log(`${paths.length} cache routes exist; browser module imports are local and cached; manifest icons match dimensions. ${(bytes / 1e6).toFixed(2)} MB total cached responses.`);
