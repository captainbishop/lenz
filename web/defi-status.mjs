import {assert,keysAre} from './public/peer-crypto.js';
import {checkDefiRequest} from './public/defi-request.js';
import {checkDepositRequest,refundSource} from './public/near-deposit.js';
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

export async function readDefiRefund(input,{configuration=adapterConfig,createClients=createDefiExecutorClients}={}) {
  const data=structuredClone(input);
  assert(keysAre(data,['sender','executor','request','deposit']),'Invalid refund status request');
  const config=await configuration(),request=await checkDefiRequest(config,data.sender,data.executor,data.request,data.request?.createdAt);
  assert(request.operation.kind==='rhea-swap','Choose the original swap approval');
  const deposit=await checkDepositRequest(data.deposit),packet=request.operation.packet,i=packet.instruction;
  assert(deposit.contract===config.reserve && deposit.owner===i.owner && deposit.payer===i.receiver_id && deposit.amount===i.amount
    && deposit.source===await refundSource(config.adapter,packet.id),'Different refund authority');
  const clients=await createClients(config,{getSigner:()=>{throw Error('Refund checks cannot sign');}});
  const observation=await clients.observe({kind:'rhea-refund-return',packet,deposit});
  return {requestId:request.id,depositId:deposit.id,state:observation.state,
    observation:{finality:observation.finality,block:observation.block,order:observation.order,deposit:observation.deposit??null}};
}
