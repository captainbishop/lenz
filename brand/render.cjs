// Requires sharp, installed locally and available through NODE_PATH.
const path = require('node:path');
const sharp = require('sharp');
const directory = path.resolve(__dirname, '../web/public/brand');
(async () => {
  for (const size of [16, 32, 180, 192, 512, 1024]) {
    await sharp(path.join(directory, 'icon.svg')).resize(size, size).png().toFile(path.join(directory, `icon-${size}.png`));
  }
  await sharp(path.join(directory, 'brand-card.svg')).png().toFile(path.join(directory, 'brand-card.png'));
  await sharp(path.join(directory, 'logo.svg')).resize(720, 288).png().toFile(path.join(directory, 'logo.png'));
  await sharp(path.join(directory, 'logo-reverse.svg')).resize(720, 288).png().toFile(path.join(directory, 'logo-reverse.png'));
  console.log('Lenz PNG exports rendered from SVG masters.');
})().catch(error => { console.error(error); process.exitCode = 1; });
