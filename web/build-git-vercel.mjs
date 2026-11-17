import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildHostedVercel} from './build-hosted-vercel.mjs';
import {preparePublicAssets} from './prepare-public-assets.mjs';

await preparePublicAssets();
const destination=fileURLToPath(new URL('../.vercel-package/',import.meta.url));
try{await stat(destination);throw Error('Git build output already exists. Use a fresh checkout.');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log(JSON.stringify(await buildHostedVercel({destination})));
