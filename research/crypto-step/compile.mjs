import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CircomRunner, bindings } = require('circom2');
// Use the package's documented API with only this folder preopened. Its CLI
// preopens every parent folder, which is unnecessary for this local project.
const runner = new CircomRunner({
  args: process.argv.slice(2), env: {}, preopens: { '.': '.' },
  bindings: { ...bindings, fs },
});
await runner.execute(fs.readFileSync(require.resolve('circom2/circom.wasm')));
