import { mkdir, writeFile } from 'node:fs/promises';
const directory = new URL('../web/public/brand/', import.meta.url);
await mkdir(directory, { recursive: true });
const green = '#173f35', lime = '#e1efa6', paper = '#f5f5ef';
// Two opposing L forms: open paths, balanced weight, no central node.
const symbol = color => `<g fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M30 20 V78 Q30 98 50 98 H74"/><path d="M98 108 V50 Q98 30 78 30 H54"/></g>`;
const svg = (width, height, label, contents) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><title>${label}</title>${contents}</svg>\n`;
for (const [name, color] of [['mark', green], ['mark-reverse', lime], ['mark-black', '#000000'], ['mark-white', '#ffffff']]) {
  await writeFile(new URL(`${name}.svg`, directory), svg(128, 128, 'Lenz symbol: two opposing L forms', symbol(color)));
}
await writeFile(new URL('icon.svg', directory), svg(512, 512, 'Lenz app icon', `<rect width="512" height="512" rx="120" fill="${green}"/><g transform="translate(64 64) scale(3)">${symbol(lime)}</g>`));
for (const [name, color] of [['logo', green], ['logo-reverse', lime]]) {
  await writeFile(new URL(`${name}.svg`, directory), svg(360, 144, 'Lenz', `<g transform="translate(0 8)">${symbol(color)}</g><text x="148" y="98" fill="${color}" font-family="Segoe UI,Arial,sans-serif" font-size="82" font-weight="600" letter-spacing="-3">Lenz</text>`));
}
await writeFile(new URL('brand-card.svg', directory), svg(1200, 760, 'Lenz. Value moves with people.', `<rect width="1200" height="760" fill="${paper}"/><text x="72" y="77" fill="${green}" font-family="Segoe UI,Arial,sans-serif" font-size="16" letter-spacing="3">LENZ / IDENTITY 01</text><line x1="72" y1="103" x2="1128" y2="103" stroke="#cbd6c3"/><g transform="translate(479 136) scale(1.9)">${symbol(green)}</g><text x="600" y="447" text-anchor="middle" fill="${green}" font-family="Segoe UI,Arial,sans-serif" font-weight="600" font-size="106" letter-spacing="-4">Lenz</text><text x="600" y="501" text-anchor="middle" fill="${green}" font-family="Georgia,serif" font-size="32">Value moves with people.</text><rect x="72" y="587" width="1056" height="106" rx="22" fill="${green}"/><text x="600" y="653" text-anchor="middle" fill="${paper}" font-family="Segoe UI,Arial,sans-serif" font-size="30">Talk privately. Use DeFi without internet.</text><text x="72" y="730" fill="#52665b" font-family="Segoe UI,Arial,sans-serif" font-size="13">Offline DeFi. Private conversations. · Web first</text>`));
console.log('Lenz SVG masters generated.');
