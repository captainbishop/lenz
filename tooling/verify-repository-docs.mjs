import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const files = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md'];
let links = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const anchors = new Set([...source.matchAll(/^#{1,6} (.+)$/gm)].map(m => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replaceAll(' ', '-')));
  const references = [...source.matchAll(/\]\(([^)]+)\)/g), ...source.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  for (const target of references) {
    if (/^https?:\/\//.test(target)) continue;
    if (target.startsWith('#')) assert(anchors.has(target.slice(1)), `Missing anchor ${target} in ${file}`);
    else await access(resolve(dirname(file), target.split('#')[0]));
    links++;
  }
}
const license = await readFile('LICENSE', 'utf8');
assert(license.startsWith('MIT License\n'));
assert(license.includes('Copyright (c) 2026 captainbishop'));
const banner = await readFile('brand/github-banner.svg', 'utf8');
assert(banner.includes('Talk privately. Use DeFi without internet.'));
assert(!banner.includes('WEB FIRST') && !banner.includes('TESTNET DEVELOPMENT'));
assert(!/<(?:script|foreignObject)|https?:\/\/(?!www\.w3\.org)/.test(banner));
console.log(JSON.stringify({ ok: true, documents: files.length + 1, localLinks: links, banner: 'local SVG; no development label' }, null, 2));
