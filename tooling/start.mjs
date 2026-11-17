import {fileURLToPath} from 'node:url';

process.chdir(fileURLToPath(new URL('../web/',import.meta.url)));
await import('../web/server.mjs');
