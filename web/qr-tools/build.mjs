import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const output = new URL('../public/qr-vendor/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, version, source] of [
  ['qrcode-generator', '1.4.4', 'qrcode.js'], ['jsqr', '1.4.0', 'dist/jsQR.js'],
]) {
  const root = new URL(`./node_modules/${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  if (pkg.version !== version) throw new Error(`Unexpected ${name} version`);
  const code = await readFile(new URL(source, root), 'utf8');
  await writeFile(new URL(`${name}.js`, output),
    `// Vendored ${name} ${version}. Rebuild with node web/qr-tools/build.mjs.\nconst library = (() => {\nconst module = { exports: {} };\nconst exports = module.exports;\nconst define = undefined;\n${code}\nreturn module.exports;\n})();\nexport default library;\n`);
}
await copyFile(new URL('./node_modules/jsqr/LICENSE', import.meta.url), new URL('jsqr-LICENSE.txt', output));
console.log('Built two pinned, local QR modules.');
