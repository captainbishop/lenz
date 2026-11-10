// Browser encodings from the same pinned package used by the account checks.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url), { build } = require('./near-connector/node_modules/esbuild');
const root = resolve(import.meta.dirname, '..'), out = resolve(import.meta.dirname, 'public/intents-vendor');
const pkg = JSON.parse(await readFile(resolve(root, 'integrations/node_modules/@scure/base/package.json'), 'utf8'));
if (pkg.version !== '1.2.6') throw Error('Review the Intents encodings before changing their version.');
await mkdir(out, { recursive: true });
const result = await build({ stdin: { contents: "export { base58, base64 } from '@scure/base';", resolveDir: resolve(root, 'integrations') },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', write: false });
await writeFile(resolve(out, 'codecs.js'), result.outputFiles[0].contents);
await writeFile(resolve(out, 'LICENSE.txt'), await readFile(resolve(root, 'integrations/node_modules/@scure/base/LICENSE')));
await writeFile(resolve(out, 'NOTICE.txt'), '@scure/base 1.2.6 (MIT). Base58 and base64 encodings. Built with web/build-intents-codecs.mjs.\n');
console.log('Built Intents encodings: ' + result.outputFiles[0].contents.length + ' bytes.');
