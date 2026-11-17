import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
const root = new URL('./public/', import.meta.url);
const source = await readFile(new URL('chat-sw.js', root), 'utf8');
const paths=Array.from(runInNewContext(source.slice(0,source.indexOf('self.addEventListener'))+';PATHS',{importScripts:()=>{}}),path=>path.replace(/^\.\//,'/'));
assert.equal(new Set(paths).size, paths.length);
assert(paths.includes('/account-return.js'), 'Account funding return must be cached');
let bytes = 0;
for (const path of paths) {
  const file = new URL('.' + path, root); const info = await stat(file); assert(info.isFile()); bytes += info.size;
  if (path.endsWith('.js')) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert(match[1].startsWith('./'), `Nonlocal module: ${path}`);
      assert(paths.includes('/' + match[1].slice(2)), `Uncached module: ${match[1]}`);
    }
  }
}
for (const file of ['peer-crypto.js', 'peer-exchange.js', 'peer-scenario.js']) {
  const text = await readFile(new URL(file, root), 'utf8');
  assert(!/\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon\s*\()/.test(text), `Network API in ${file}`);
}
assert((await readFile(new URL('index.html', root), 'utf8')).includes('href="/chat.html"'));
console.log(`${paths.length} chat cache routes exist; all imports are local and cached; cryptographic scenario has no network APIs; ${bytes} cached bytes.`);
