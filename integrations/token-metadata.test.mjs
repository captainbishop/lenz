import test from 'node:test';import assert from 'node:assert/strict';
import {readTokenMetadata,resolveTokenMetadata,solanaMetadataAddress} from './token-metadata.mjs';
import {tokenAddressNetworks,tokenMetadataRequest,tokenMetadataResult,tokenMetadata,readTokenMetadata as savedMetadata,saveTokenMetadata} from '../web/public/token-metadata.js';
import {createIdentity} from '../web/public/peer-crypto.js';
const mint='So11111111111111111111111111111111111111112',evm='0x'+'12'.repeat(20),stamp=Date.now(),meta={network:'near',contract:'wrap.near',name:'Wrapped NEAR',symbol:'wNEAR',decimals:24,observedAt:stamp};
const source=answer=>async(url,options)=>{assert.equal(options.redirect,'error');const q=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:answer(q,url)}));};
test('address detection preserves non-EVM case and rejects URLs, malformed keys and injected fields',()=>{
 assert.deepEqual(tokenAddressNetworks(mint),['solana']);assert.deepEqual(tokenAddressNetworks('wrap.near'),['near']);assert.deepEqual(tokenAddressNetworks(evm),['ethereum','arbitrum','base']);
 for(const contract of ['https://evil.invalid','bad.near/../','0x'+'0'.repeat(40),'z'.repeat(44),'secret words here'])assert.throws(()=>tokenMetadataRequest({contract}));
 assert.throws(()=>tokenMetadataRequest({contract:evm,account:evm}));
});
test('NEAR ft_metadata autofill uses mainnet finalized view calls without account or balance requests',async()=>{
 const calls=[],fetcher=source((q,url)=>{calls.push(q);assert.equal(url,'https://rpc.mainnet.near.org');if(q.method==='status')return {chain_id:'mainnet'};assert.deepEqual(q.params,{request_type:'call_function',finality:'final',account_id:'wrap.near',method_name:'ft_metadata',args_base64:'e30='});return {block_height:42,block_hash:mint,result:[...Buffer.from(JSON.stringify({spec:'ft-1.0.0',name:'Wrapped NEAR',symbol:'wNEAR',decimals:24}))]};});
 assert.deepEqual(await readTokenMetadata('near','wrap.near',{fetcher,clock:()=>stamp}),meta);assert.equal(calls.length,2);
 await assert.rejects(readTokenMetadata('near','wrap.near',{fetcher:source(()=>({chain_id:'testnet'}))}),/Wrong NEAR/);
});
test('Solana Token-2022 metadata checks program, initialization, mint and network',async()=>{
 const base={owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:9,extensions:[{extension:'tokenMetadata',state:{mint,name:'Example Solana',symbol:'EXS'}}]}}}};
 // Full hash returned by mainnet getGenesisHash; the shortened CAIP chain reference is not an RPC hash.
 const run=value=>readTokenMetadata('solana',mint,{clock:()=>stamp,fetcher:source(q=>q.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':{context:{slot:42},value})});
 assert.deepEqual(await run(base),{network:'solana',contract:mint,name:'Example Solana',symbol:'EXS',decimals:9,observedAt:stamp});
 await assert.rejects(run({...base,owner:mint}),/Not an initialized/);await assert.rejects(run({...base,executable:true}));
 const wrong=structuredClone(base);wrong.data.parsed.info.extensions[0].state.mint='11111111111111111111111111111111';await assert.rejects(run(wrong),/Metadata mint changed/);
});
test('ambiguous EVM matches stay separate and partial source availability is explicit',async()=>{
 const result=await resolveTokenMetadata({contract:evm},{read:async network=>{if(network==='base')throw Error('Timeout');return {network,contract:evm,name:'Example',symbol:'EXM',decimals:6,observedAt:stamp};}});
 assert.deepEqual(result.matches.map(m=>m.network),['ethereum','arbitrum']);assert.deepEqual(result.unavailable,['base']);assert.equal(tokenMetadataResult(result,{contract:evm}).matches.length,2);
 const altered=structuredClone(result);altered.matches[0].contract='0x'+'34'.repeat(20);assert.throws(()=>tokenMetadataResult(altered,{contract:evm}));
 assert.throws(()=>tokenMetadata({...meta,decimals:99}));assert.throws(()=>tokenMetadata({...meta,name:'Bad\u202ename'}));
});
test('metadata imports persist encrypted under the local identity, independently of account holdings',async()=>{
 const state={identity:await createIdentity('Metadata fixture')};await saveTokenMetadata(state,[meta]);assert.deepEqual(await savedMetadata(state),[meta]);assert(!state.tokenWatchBox);assert(!JSON.stringify(state.tokenMetadataBox).includes('Wrapped'));const changed={...state,identity:await createIdentity('Other')};await assert.rejects(savedMetadata(changed));
});
test('Metaplex PDA is a bounded Solana address and a metadata account cannot claim another mint',async()=>{
 const address=solanaMetadataAddress(mint);assert.deepEqual(tokenAddressNetworks(address),['solana']);assert.notEqual(address,mint);
 const fetcher=source(q=>q.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':q.params[1].encoding==='jsonParsed'?{context:{slot:42},value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:9}}}}}:{context:{slot:42},value:{owner:'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',executable:false,data:[Buffer.alloc(100).toString('base64'),'base64']}});
 await assert.rejects(readTokenMetadata('solana',mint,{fetcher}),/Metadata mint changed/);
});
