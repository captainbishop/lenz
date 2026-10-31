import { configuration, relayAccount, call, view } from '../contracts/client.mjs';
const origin='http://127.0.0.1:4173';
let queue=Promise.resolve();
export const serialize=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result;};
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
async function body(req) {
  if(req.headers['content-type']!=='application/json'||req.headers.origin!==origin)throw new Error('Only this local Lenz app can use the test relay.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>50000)throw new Error('Request too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks));
}
export async function testnetRoute(req,res) {
  if(!req.url.startsWith('/api/testnet/'))return false;
  try {
    if(req.headers.host!=='127.0.0.1:4173')throw new Error('Invalid host');
    const config=await configuration();
    if(req.url==='/api/testnet/status'&&req.method==='GET'){send(res,200,config);return true;}
    if(req.method!=='POST'){send(res,405,{error:'Use POST'});return true;}
    const data=await body(req);
    if(!config.ready||!config.contract){send(res,503,{error:'The NEAR contract has not been deployed yet.'});return true;}
    if(data.contract!==config.contract)throw new Error('Wrong testnet contract');
    const contract=config.contract;
    if(req.url==='/api/testnet/fund') {
      const result=await serialize(async()=> {
        const {owner,amount,nonce,signature,id}=data;
        if(!/^root:[0-9a-f]{64}$/.test(id))throw new Error('Invalid funding id');
        const existing=await view(contract,'get_root',{id});
        if(existing){if(existing.owner!==owner||existing.amount!==amount)throw new Error('Funding record does not match');return {root:existing,finality:'FINAL',recovered:true};}
        const receipt=await call(await relayAccount(),contract,'fund_test',{owner,amount,nonce,signature},'0.03');
        const root=await view(contract,'get_root',{id});if(!root)throw new Error('Funding has not appeared in final NEAR state.');return {...receipt,value:undefined,root};
      });send(res,200,result);
    } else if(req.url==='/api/testnet/settle') {
      if(!Array.isArray(data.path)||!data.path.length||data.path.length>16)throw new Error('Expected 1 to 16 transfers');
      const result=await serialize(async()=> {const receipt=await call(await relayAccount(),contract,'settle',{path:data.path});return {...receipt,value:undefined,receipts:receipt.value};});send(res,200,result);
    } else if(req.url==='/api/testnet/check') {
      if(!Array.isArray(data.ids)||data.ids.length>80||data.ids.some(id=>typeof id!=='string'||!/^(root:)?[0-9a-f]{64}(:[01])?$/.test(id)))throw new Error('Invalid payment ids');
      const results=[];for(const id of data.ids){const note=await view(contract,'get_note',{id});const spent=await view(contract,'spent_by',{id});const receipt=id.startsWith('root:')?null:await view(contract,'get_receipt',{id:id.split(':')[0]});results.push({id,note,spent,receipt});}send(res,200,{finality:'FINAL',results});
    } else send(res,404,{error:'Unknown testnet action'});
  } catch(error){send(res,400,{error:error.message.slice(0,500)});}
  return true;
}
