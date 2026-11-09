import {assert,keysAre} from './public/peer-crypto.js';
import {checkDefiRequest} from './public/defi-request.js';
import {adapterConfig} from '../contracts/adapter-client.mjs';
import {createDefiExecutorClients} from '../contracts/defi-executor-client.mjs';

// The local wallet checks its own pinned chain configuration, never the executor's claim.
export async function readDefiStatus(input,{configuration=adapterConfig,createClients=createDefiExecutorClients}={}) {
  const data=structuredClone(input);
  assert(keysAre(data,['sender','executor','request']),'Invalid status request');
  const config=await configuration();
  const request=await checkDefiRequest(config,data.sender,data.executor,data.request,data.request?.createdAt);
  const clients=await createClients(config,{getSigner:()=>{throw Error('Status checks cannot sign');}});
  const observation=await clients.observe(request.operation);
  return {requestId:request.id,state:observation.state,observation:{finality:observation.finality,block:observation.block,order:observation.order}};
}
