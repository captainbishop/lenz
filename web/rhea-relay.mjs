import { adapterConfig, verifyAdapter, verifyPacketRoot, adapterCall } from '../contracts/adapter-client.mjs';
import { relayAccount, view, call } from '../contracts/client.mjs';
import { serialize } from './testnet-relay.mjs';
import { returnRefund, depositReceipt } from '../contracts/refund-return.mjs';
import { reconcileAdapterOrder } from '../contracts/adapter-recovery.mjs';
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function createRheaRoute(clients={adapterConfig,verifyAdapter,verifyPacketRoot,adapterCall,relayAccount,view,call,serialize,returnRefund,depositReceipt,reconcileAdapterOrder}) {
  return async(req,res)=>{
    if(!req.url.startsWith('/api/rhea/'))return false;
    try{
      if(req.headers.host!=='127.0.0.1:4173'||req.headers.origin!=='http://127.0.0.1:4173'){send(res,403,{error:'Only this local Lenz app can submit test swaps'});return true;}
      if(req.method!=='POST'){send(res,405,{error:'Use POST'});return true;}
      if(req.headers['content-type']!=='application/json')throw new Error('Expected JSON');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>50000)throw new Error('Swap request too large');chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks));const c=await clients.adapterConfig();
      if(!c.ready||data.adapter!==c.adapter)throw new Error('Wrong or unavailable swap adapter');
      if(!['/api/rhea/submit','/api/rhea/advance','/api/rhea/order','/api/rhea/recover','/api/rhea/return','/api/rhea/deposit-check'].includes(req.url)){send(res,404,{error:'Unknown swap action'});return true;}
      const id=req.url.endsWith('/submit')?data.packet?.id:data.id;
      if(typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))throw new Error('Invalid swap id');
      const result=await clients.serialize(async()=>{
        await clients.verifyAdapter(c);
        if(req.url.endsWith('/deposit-check')){
          if(data.request?.contract!==c.reserve)throw new Error('Wrong deposit reserve');
          return clients.depositReceipt(data.request);
        }
        if(req.url.endsWith('/order'))return clients.reconcileAdapterOrder(c,id);
        if(req.url.endsWith('/recover')){
          if(c.recoverRedemption!==true)throw new Error('Swap recovery is not available yet');
          if(Object.keys(data).sort().join(',')!=='adapter,id')throw new Error('Recovery accepts only a swap id');
          const current=await clients.reconcileAdapterOrder(c,id);
          if(!current.order)throw new Error('This swap has not started yet');
          // Reconciliation verifies the current signed order before opening the sponsor.
          // A stage that changed since rendering needs no recovery transaction.
          if(current.order.stage!=='redeeming')return current;
          return clients.adapterCall(await clients.relayAccount(),c,'recover_redemption',{id});
        }
        const account=await clients.relayAccount();
        if(req.url.endsWith('/return'))return clients.returnRefund(account,c,id,data.request);
        if(req.url.endsWith('/submit')){
          await clients.verifyPacketRoot(c,data.packet);
          const existing=await clients.view(c.adapter,'get_order',{id});if(existing)return {finality:'FINAL',order:existing,recovered:true};
          if(data.packet.path.length)await clients.call(account,c.reserve,'settle',{path:data.packet.path},'0.2');
          return clients.adapterCall(account,c,'submit',{instruction:data.packet.instruction});
        }
        return clients.adapterCall(account,c,'advance',{id});
      });send(res,200,result);
    }catch(error){send(res,400,{error:error.message.slice(0,400)});}return true;
  };
}
export const rheaRoute=createRheaRoute();
