import {parentPort,workerData} from 'node:worker_threads';
import {createAIChat} from '../integrations/ai-chat.mjs';
try{const ask=await createAIChat(workerData.config);parentPort.postMessage({result:await ask(workerData.input)});}
catch{parentPort.postMessage({error:'NEAR AI could not verify a reply.'});}
