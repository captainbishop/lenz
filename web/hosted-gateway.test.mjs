import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostedGateway as createGateway} from './hosted-gateway.mjs';
import {createHostedProxy as createProxy,HOSTED_SESSION_REQUEST} from './hosted-proxy.mjs';
import {accountKeys,ACCOUNT_REQUEST} from './public/account-keys.js';
import {digest,signValue,createIdentity} from './public/peer-crypto.js';
import {createHash} from 'node:crypto';
import {createHostedNativeFetch} from './public/hosted-native-fetch.js';
import {createHostedSession} from './public/hosted-session.js';
import {requirePaymentAccess,RECOVERED_CHAT} from './public/chat-access.js';
import {createTestnetRelay} from './testnet-relay.mjs';
import {fundingRequest} from './public/near-protocol.js';
const origin='https://lenz-test.vercel.app',gatewaySecret='g'.repeat(48),sessionSecret='s'.repeat(48);
const demoIdentity=await createIdentity('Authorized demo identity');
const nativeSource='native-zcash:a:'+'a'.repeat(64),nativeRecipient='utest1'+'q'.repeat(70),custody={[demoIdentity.profile.id]:{native:{accountId:nativeSource,wallet:'a',recipient:nativeRecipient}}};
const createHostedProxy=options=>createProxy({...options,custody:options.custody??custody});
const createHostedGateway=options=>createGateway({...options,custody:options.custody??custody});
const nativeBody=reviewId=>JSON.stringify({review:{id:reviewId,source:{accountId:nativeSource}}});
const fetch=(url,options={})=>new Promise((resolve,reject)=>{const request=http.request(url,{method:options.method??'GET',headers:options.headers instanceof Headers?Object.fromEntries(options.headers):options.headers,signal:options.signal},response=>resolve(new Response(options.method==='HEAD'?null:Readable.toWeb(response),{status:response.statusCode,headers:response.headers})));request.on('error',reject);request.end(options.body);});
async function listen(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:'http://127.0.0.1:'+server.address().port};}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.listeners('request')[0]?.close?.();}
async function login(url,headers,identity=demoIdentity){const challenge=await(await fetch(url+'/api/hosted/session/challenge',{method:'POST',headers,body:JSON.stringify({id:identity.profile.id})})).json(),signature=await signValue(identity,[HOSTED_SESSION_REQUEST,origin,identity.profile.id,challenge.nonce,challenge.until]);return fetch(url+'/api/hosted/session',{method:'POST',headers,body:JSON.stringify({profile:identity.profile,nonce:challenge.nonce,until:challenge.until,signature})});}

test('a fresh visitor can read a public Rhea rate without signing in or entering custody',async()=>{
 const seen=[],input={network:'testnet',contract:'ref-finance-101.testnet',poolId:7,tokenIn:'reserve.lenz.testnet',tokenOut:'wrap.testnet',amountIn:'1000000',slippageBps:100};
 const backend=await listen(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({path:req.url,body:JSON.parse(body),identity:req.headers['x-lenz-hosted-identity']});res.setHeader('content-type','application/json');res.end(JSON.stringify({state:'quote',amountOut:'250000000000000000000000',minAmountOut:'247500000000000000000000',request:input}));});
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetch(gateway.url+url.pathname,options)}));
 const paths=[],wallet=createHostedSession({origin,hosted:true,read:()=>assert.fail('Public quotes must not read or sign the account'),fetcher:(path,options={})=>{paths.push(path);return fetch(site.url+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}});}});
 try{
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},quote=await wallet.fetch('/api/defi/rhea/quote',options);
  assert.equal(quote.status,200);assert.equal((await quote.json()).amountOut,'250000000000000000000000');assert.deepEqual(paths,['/api/defi/rhea/quote']);assert.deepEqual(seen,[{path:'/api/defi/rhea/quote',body:input,identity:undefined}]);
  for(const path of ['/api/defi/intents/quote','/api/rhea/submit','/api/intents/lending/submit'])assert.equal((await fetch(site.url+path,{...options,headers:{...options.headers,host:new URL(origin).host,origin},body:'{}'})).status,401);
  assert.equal((await fetch(site.url+'/api/defi/rhea/quote',{...options,headers:{...options.headers,host:new URL(origin).host,origin},body:JSON.stringify({data:'x'.repeat(5000)})})).status,413);
  assert.equal((await fetch(site.url+'/api/defi/rhea/quote?source=private',{...options,headers:{...options.headers,host:new URL(origin).host,origin}})).status,404);assert.equal(seen.length,1);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);}
});

test('a new hosted visitor funds its own signed offline reserve without entering configured custody',async()=>{
 const visitor=await createIdentity('New hosted visitor'),contract='reserve.lenz.testnet',request=await fundingRequest(visitor,contract),folder=await mkdtemp(join(tmpdir(),'lenz-hosted-reserve-'));let root=null,sponsored=0;
 let reserve;const backend=await listen((req,res)=>reserve(req,res));
 reserve=createTestnetRelay({origin:backend.url,sponsorDir:folder,configuration:async()=>({network:'testnet',ready:true,contract}),relayAccount:async()=>({accountId:'sponsor.testnet'}),view:async(_contract,method)=>method==='get_root'?root:null,call:async()=>{sponsored++;root={id:request.id,owner:request.owner,amount:'100000000'};return {finality:'FINAL',value:root};}});
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetch(gateway.url+url.pathname,options)}));
 const wallet=createHostedSession({origin,hosted:true,read:async()=>({identity:visitor}),fetcher:(url,options={})=>fetch(site.url+url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}})});
 try{
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,contract})};const funded=await wallet.fetch('/api/testnet/fund',options);assert.equal(funded.status,200);assert.equal((await funded.json()).root.owner,request.owner);
  assert.equal((await wallet.fetch('/api/testnet/fund',options)).status,200);assert.equal(sponsored,1);
  for(const path of ['/api/intent-zcash/config','/api/intent-near/config','/api/intents/lending/config'])assert.equal((await wallet.fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const invalid=await wallet.fetch('/api/testnet/fund',{...options,body:JSON.stringify({...request,contract,signature:'0'.repeat(128)})});assert.equal(invalid.status,400);assert.equal(sponsored,1);
  const recovered=createHostedSession({origin,hosted:true,read:async()=>({identity:{...visitor,access:RECOVERED_CHAT}}),fetcher:()=>{throw Error('Recovered funds must not reach the public relay.');}});await assert.rejects(recovered.fetch('/api/testnet/fund',options),/Offline funds are not restored/);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);await rm(folder,{recursive:true,force:true});}
});

test('public reads reach the loopback service, custody requires a separate browser session, and hostile paths never reach it',async()=>{
 const seen=[],backend=await listen((req,res)=>{seen.push({url:req.url,headers:req.headers});res.setHeader('content-type','application/json');res.end('{"visible":"market result"}');});
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-'));
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,backendURL:backend.url,backendOrigin:'http://localhost:'+backend.server.address().port,jobsDir:join(folder,'jobs')}));
 const proxy=createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,fetcher:(url,options)=>fetch(gateway.url+url.pathname+url.search,options)});
 const site=await listen(proxy),headers={host:new URL(origin).host,origin,'content-type':'application/json','sec-fetch-site':'same-origin','x-lenz-hosted-identity':demoIdentity.profile.id};
 try{
  const read=await fetch(site.url+'/api/markets/assets',{method:'POST',headers,body:'{"privacy":"public"}'});assert.equal(read.status,200);assert.equal((await read.json()).visible,'market result');
  assert.equal(seen[0].headers.host,new URL(backend.url).host);assert.equal(seen[0].headers.origin,backend.url);assert.equal(seen[0].headers.cookie,undefined);assert.equal(seen[0].headers.authorization,undefined);
  for(const path of ['/api/intent-zcash/config','/api/intents/lending/config'])assert.equal((await fetch(site.url+path,{method:'POST',headers,body:'{}'})).status,401);
  for(const path of ['/api/intent-zcash/config?x=1','/api/unknown','/api/intent-zcash/%2e%2e/config'])assert.equal((await fetch(site.url+path,{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(site.url+'/api/markets/assets',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:'{}'})).status,403);
  assert.equal((await fetch(gateway.url+'/api/intent-zcash/config',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  assert.equal(seen.length,1);
  const session=await login(site.url,headers);assert.equal(session.status,200);
  const cookie=session.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const native=await fetch(site.url+'/api/intent-zcash/config',{method:'POST',headers:{...headers,cookie},body:'{}'});assert.equal(native.status,200);assert.equal(seen.length,2);
  assert.equal(seen[1].headers.cookie,undefined);assert.equal(seen[1].headers['x-lenz-gateway-authorization'],undefined);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);await rm(folder,{recursive:true,force:true});}
});

test('native polling preserves one exact dispatch across disconnect, rejects concurrent gateway ownership, and returns the completed result',async()=>{
 let calls=0,release;const pending=new Promise(resolve=>release=resolve);
 const backend=await listen(async(req,res)=>{calls++;await pending;res.setHeader('content-type','application/json');res.end('{"artifactId":"original-signed-artifact"}');});
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-jobs-')),options={origin,gatewaySecret,backendURL:backend.url,backendOrigin:'http://localhost:'+backend.server.address().port,jobsDir:join(folder,'jobs')};
 const gateway=await listen(await createHostedGateway(options)),headers={'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':origin,'x-lenz-privileged':'1','x-lenz-hosted-identity':demoIdentity.profile.id,'x-lenz-hosted-request-id':'1794690000000-'+ 'a'.repeat(32),'content-type':'application/json'};
 try{
  const first=await fetch(gateway.url+'/api/intent-zcash/authorize',{method:'POST',headers,body:nativeBody('original')});assert.equal(first.status,202);const job=await first.json();
  assert.equal(job.state,'pending');assert.match(job.lenzHostedJob,/^[a-f0-9]{64}$/);
  await fetch(gateway.url+'/api/intent-zcash/authorize',{method:'POST',headers,body:nativeBody('original')});assert.equal(calls,1);
  assert.equal((await fetch(gateway.url+'/api/intent-zcash/authorize',{method:'POST',headers,body:nativeBody('replacement')})).status,502);assert.equal(calls,1);
  await assert.rejects(createHostedGateway(options),/already owned/);assert.equal(calls,1);
  release();let result;
  for(let i=0;i<40;i++){result=await(await fetch(gateway.url+'/api/hosted/jobs/'+job.lenzHostedJob,{headers})).json();if(result.state==='complete')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result.state,'complete');assert.equal(result.body.artifactId,'original-signed-artifact');assert.equal(calls,1);
 }finally{release();await close(gateway.server);await close(backend.server);await rm(folder,{recursive:true,force:true});}
});

test('a crash-recovered running job remains uncertain and never dispatches again',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-crash-')),directory=join(folder,'jobs'),id='d'.repeat(64);await mkdir(directory);
 await writeFile(join(directory,id+'.json'),JSON.stringify({version:2,id,identity:demoIdentity.profile.id,requestDigest:'c'.repeat(64),path:'/api/intent-zcash/authorize',state:'running',createdAt:1794690000000}));
 let calls=0;const gateway=await listen(await createHostedGateway({origin,gatewaySecret,backendURL:'http://127.0.0.1:4173',jobsDir:directory,fetcher:()=>{calls++;throw Error('Must not dispatch');}}));
 try{const response=await fetch(gateway.url+'/api/hosted/jobs/'+id,{headers:{'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':origin,'x-lenz-privileged':'1','x-lenz-hosted-identity':demoIdentity.profile.id}});assert.equal((await response.json()).state,'unknown');assert.equal(calls,0);}
 finally{await close(gateway.server);await rm(folder,{recursive:true,force:true});}
});

test('encrypted backup signatures bind the public origin and preserve the exact saved archive',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-account-')),gateway=await listen(await createHostedGateway({origin,gatewaySecret,accountDir:join(folder,'accounts')}));
 const headers={'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':origin,'x-lenz-privileged':'1','content-type':'application/json'};
 const material=await accountKeys(new Uint8Array(32).fill(9).buffer,'Disposable hosted account');
 async function post(action,body){return fetch(gateway.url+'/api/accounts/'+action,{method:'POST',headers,body:JSON.stringify(body)});}
 async function signed(operation,archive,signingOrigin=origin){const challenge=await(await post('challenge',{accountId:material.accountId,operation})).json(),terms=[ACCOUNT_REQUEST,signingOrigin,operation,material.accountId,challenge.nonce,0,'',await digest(archive)];return {profile:material.authority.profile,nonce:challenge.nonce,expected:0,previous:'',archive,signature:await signValue(material.authority,terms)};}
 try{
  const archive={type:'lenz/account-backup/v1',accountId:material.accountId,revision:1,previous:'',iv:'ab'.repeat(12),ciphertext:'cd'.repeat(128)};
  assert.equal((await post('write',await signed('write',archive,'http://localhost:4173'))).status,400);
  assert.equal((await post('write',await signed('write',archive))).status,200);
  const read=await post('read',await signed('read',null));assert.equal(read.status,200);assert.deepEqual((await read.json()).archive,archive);
 }finally{await close(gateway.server);await rm(folder,{recursive:true,force:true});}
});

test('NDJSON frames are visible before the backend stream closes and disconnection releases the stream',async()=>{
 let release,closed=false;const backend=await listen((req,res)=>{res.writeHead(200,{'content-type':'application/x-ndjson'});res.write('{"visible":"first frame"}\n');release=()=>res.end('{"visible":"second frame"}\n');res.on('close',()=>closed=true);});
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,backendURL:backend.url,backendOrigin:'http://localhost:'+backend.server.address().port}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,fetcher:(url,options)=>fetch(gateway.url+url.pathname,options)}));
 try{const response=await fetch(site.url+'/api/markets/stream',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json'},body:'{}'}),reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'{"visible":"first frame"}\n');release();assert.equal(new TextDecoder().decode((await reader.read()).value),'{"visible":"second frame"}\n');await reader.cancel();assert.equal(closed,true);}
 finally{release?.();await close(site.server);await close(gateway.server);await close(backend.server);}
});

test('proxy carries only validated native transport identifiers and stops oversized backups before disclosure',async()=>{
 let seen;const proxy=createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,fetcher:async(url,options)=>{seen={url,options};return Response.json({lenzHostedJob:'a'.repeat(64),state:'pending'},{status:202});}});
 const site=await listen(proxy),headers={host:new URL(origin).host,origin,'content-type':'application/json','x-lenz-hosted-identity':demoIdentity.profile.id};
 try{
  const session=await login(site.url,headers),cookie=session.headers.get('set-cookie');
  const id='1794690000000-'+ 'a'.repeat(32),request=await fetch(site.url+'/api/intent-zcash/authorize',{method:'POST',headers:{...headers,cookie,'x-lenz-hosted-request-id':id,authorization:'browser-secret'},body:nativeBody('original')});
  assert.equal(request.status,202);assert.equal(seen.options.headers['x-lenz-hosted-request-id'],id);assert.equal(seen.options.headers['x-lenz-hosted-identity'],demoIdentity.profile.id);assert.equal(seen.options.headers.authorization,undefined);assert.equal(seen.options.headers.cookie,undefined);
  seen=null;const large=await fetch(site.url+'/api/accounts/write',{method:'POST',headers:{...headers,cookie},body:'x'.repeat(4_000_001)});assert.equal(large.status,413);assert.equal(seen,null);
 }finally{await close(site.server);}
});

test('completed authority replies survive caller storage failure and restart with one backend dispatch, while explicit reconciliation stays fresh',async()=>{
 const calls=[],backend=await listen((req,res)=>{calls.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify({artifactId:'original',checks:calls.filter(path=>path.endsWith('/reconcile')).length}));});
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-retained-')),gateway=await listen(await createHostedGateway({origin,gatewaySecret,backendURL:backend.url,backendOrigin:'http://localhost:'+backend.server.address().port,jobsDir:join(folder,'jobs')}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,fetcher:(url,options)=>fetch(gateway.url+url.pathname,options)})),headers={host:new URL(origin).host,origin,'content-type':'application/json','x-lenz-hosted-identity':demoIdentity.profile.id};
 try{
  const session=await login(site.url,headers),cookie=session.headers.get('set-cookie'),values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const fetcher=(url,options)=>fetch(site.url+url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),...headers,cookie}}),request=()=>createHostedNativeFetch({hosted:true,storage,fetcher,lock:operation=>Promise.resolve().then(operation),pollMs:1}),options={method:'POST',body:nativeBody('original')};
  for(const action of ['authorize','submit']){const response=await request()('/api/intent-zcash/'+action,options),value=await response.json();assert.equal(value.artifactId,'original',JSON.stringify({action,status:response.status,value}));const before=storage.setItem;storage.setItem=()=>{throw Error('Caller persistence unavailable');};assert.equal((await(await request()('/api/intent-zcash/'+action,options)).json()).artifactId,'original');storage.setItem=before;assert.equal(calls.filter(path=>path.endsWith('/'+action)).length,1);}
  assert.equal((await(await request()('/api/intent-zcash/reconcile',options)).json()).checks,1);assert.equal((await(await request()('/api/intent-zcash/reconcile',options)).json()).checks,2);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);await rm(folder,{recursive:true,force:true});}
});

test('operator sessions require an approved Lenz identity signature and reject altered, expired, or legacy password proofs',async()=>{
 let clock=1794690000000,forwarded=0;const stranger=await createIdentity('Unapproved identity'),site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,now:()=>clock,fetcher:async()=>{forwarded++;return Response.json({ok:true});}})),headers={host:new URL(origin).host,origin,'content-type':'application/json'};
 const post=(path,body)=>fetch(site.url+path,{method:'POST',headers,body:JSON.stringify(body)});
 try{
  assert.equal((await post('/api/hosted/session/challenge',{id:stranger.profile.id})).status,403);
  assert.equal((await post('/api/hosted/session',{code:sessionSecret})).status,400);
  const {nonce,until}=await(await post('/api/hosted/session/challenge',{id:demoIdentity.profile.id})).json(),terms=[HOSTED_SESSION_REQUEST,origin,demoIdentity.profile.id,nonce,until],proof={profile:demoIdentity.profile,nonce,until,signature:await signValue(demoIdentity,terms)};
  assert.equal((await post('/api/hosted/session',{...proof,signature:await signValue(stranger,terms)})).status,403);
  assert.equal((await post('/api/hosted/session',{...proof,until:until+1})).status,403);
  const accepted=await post('/api/hosted/session',proof),cookie=accepted.headers.get('set-cookie');assert.equal(accepted.status,200);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await fetch(site.url+'/api/intent-zcash/config',{method:'POST',headers:{...headers,cookie,'x-lenz-hosted-identity':stranger.profile.id},body:'{}'})).status,401);assert.equal(forwarded,0);
  clock=until+1;assert.equal((await post('/api/hosted/session',proof)).status,403);
 }finally{await close(site.server);}
});

test('normal Wallet identity establishes its operator session without a new screen, and account changes remove custody access',async()=>{
 let forwarded=0;const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,fetcher:async()=>{forwarded++;return Response.json({visible:'owned native source'});}}));
 let identity=demoIdentity,cookie='';const headers={host:new URL(origin).host,origin};
 const fetcher=async(url,options={})=>{const response=await fetch(site.url+url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),...headers,cookie}});const next=response.headers.get('set-cookie');if(next)cookie=next;return response;};
 const wallet=createHostedSession({origin,hosted:true,fetcher,read:async()=>({identity})});
 try{
  const owned=await wallet.fetch('/api/intent-zcash/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(owned.status,200);assert.equal((await owned.json()).visible,'owned native source');assert.equal(forwarded,1);
  identity=await createIdentity('Another local Wallet');assert.equal((await wallet.fetch('/api/intent-zcash/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal(forwarded,1);
  identity={...demoIdentity,access:RECOVERED_CHAT};assert.equal((await wallet.ensure()).identity,demoIdentity.profile.id);await assert.rejects(wallet.fetch('/api/intent-zcash/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),/Offline funds are not restored/);assert.equal(forwarded,1);
 }finally{await close(site.server);}
});

test('recovered sign-in preserves existing certified source access while a missing or mismatched financial source remains blocked',async()=>{
 const original=await createIdentity('Recoverable owner'),identity={...original,access:RECOVERED_CHAT},account='0x'+'1'.repeat(40),ownerAddress='0x'+'2'.repeat(40),auroraBeneficiary='0x'+'3'.repeat(40),nearPublicKey='ed25519:3eeXtQu2KZN4ryJbrYeCzuq3X3tHkDib37WRnhzvpozr';
 const bindings={[identity.profile.id]:{lending:{account,ownerAddress},aurora:{owner:'275c4d4c892979a3adfe5ebe335298844cda33c140d6d85795201f91bbe9605b',beneficiary:auroraBeneficiary,notes:[{commitment:'0x'+'4'.repeat(64),nullifierHash:'0x'+'5'.repeat(64)}]}}};
 let state={identity},cookie='',forwarded=0;const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:bindings,fetcher:async()=>{forwarded++;return Response.json({visible:'certified original source'});}}));
 const headers={host:new URL(origin).host,origin},fetcher=async(url,options={})=>{const response=await fetch(site.url+url,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),...headers,cookie}});const next=response.headers.get('set-cookie');if(next)cookie=next;return response;},wallet=createHostedSession({origin,hosted:true,fetcher,read:async()=>state}),options={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
 try{
  assert.equal((await wallet.ensure()).identity,identity.profile.id);await assert.rejects(wallet.fetch('/api/intents/lending/config',options),/Recover the original lending/);assert.equal(forwarded,0);
  state={identity,lendingOwnedAccount:{owner:identity.profile.id,account,ownerAddress,recoveryVerified:{chainId:'eip155:11155111',ownerAddress,account}}};assert.equal((await wallet.fetch('/api/intents/lending/config',options)).status,200);assert.equal(forwarded,1);
  assert.throws(()=>requirePaymentAccess(state.identity),/Offline funds are not restored/);
  state.lendingOwnedAccount.recoveryVerified.account=auroraBeneficiary;await assert.rejects(wallet.fetch('/api/intents/lending/config',options),/Recover the original lending/);assert.equal(forwarded,1);
  state={identity,nearIntentSource:{owner:identity.profile.id,publicKey:nearPublicKey,recoveryVerified:{chainId:'near:testnet',publicKey:nearPublicKey}}};assert.equal((await wallet.fetch('/api/intent-aurora-funds/config',options)).status,200);assert.equal(forwarded,2);
  await assert.rejects(wallet.fetch('/api/intent-aurora-swap/config',options),/Recover the original Aurora/);assert.equal(forwarded,2);
  state.auroraOwnedAccount={owner:identity.profile.id,address:auroraBeneficiary,recoveryVerified:{chainId:'eip155:1313161555',address:auroraBeneficiary}};assert.equal((await wallet.fetch('/api/intent-aurora-swap/config',options)).status,200);assert.equal(forwarded,3);
  state.nearIntentSource.recoveryVerified.publicKey='ed25519:11111111111111111111111111111111';await assert.rejects(wallet.fetch('/api/intent-aurora-swap/config',options),/Recover the original NEAR/);assert.equal(forwarded,3);
 }finally{await close(site.server);}
});

test('each hosted identity can enter only its original custody family, source and beneficiary, and native jobs never cross identities',async()=>{
 const nativeB=await createIdentity('Native B owner'),loan=await createIdentity('Lending owner'),privateOwner=await createIdentity('Private owner'),nearOwner=await createIdentity('NEAR original owner'),clean=await createIdentity('Unmapped empty Wallet');
 const sourceB='native-zcash:b:'+'b'.repeat(64),recipientB='utest1'+'p'.repeat(70),loanAccount='0x'+'1'.repeat(40),loanAddress='0x'+'2'.repeat(40),beneficiary='0x'+'3'.repeat(40),note='0x'+'4'.repeat(64),nullifier='0x'+'5'.repeat(64),fundingOwner='6'.repeat(64),nearAccount='7'.repeat(64);
 const bindings={...custody,[nativeB.profile.id]:{native:{accountId:sourceB,wallet:'b',recipient:recipientB}},[loan.profile.id]:{lending:{account:loanAccount,ownerAddress:loanAddress}},[privateOwner.profile.id]:{aurora:{owner:fundingOwner,beneficiary,notes:[{commitment:note,nullifierHash:nullifier}]}},[nearOwner.profile.id]:{near:{accountId:nearAccount,operations:['config','status','reconcile']}}};
 const calls=[],backend=await listen(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);calls.push({path:req.url,body:JSON.parse(Buffer.concat(chunks).toString()),identity:req.headers['x-lenz-hosted-identity']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/config')?{sources:[{accountId:nativeSource,wallet:'a',recipient:nativeRecipient},{accountId:sourceB,wallet:'b',recipient:recipientB}]}:{artifactId:'original-owned-result'}));});
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-custody-')),gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:bindings,backendURL:backend.url,backendOrigin:'http://localhost:'+backend.server.address().port,jobsDir:join(folder,'jobs')}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:bindings,fetcher:(url,options)=>fetch(gateway.url+url.pathname,options)})),baseHeaders={host:new URL(origin).host,origin,'content-type':'application/json'};
 const cookies=new Map(),identityHeaders=identity=>({...baseHeaders,cookie:cookies.get(identity.profile.id),'x-lenz-hosted-identity':identity.profile.id});
 const post=(identity,path,body,headers={})=>fetch(site.url+path,{method:'POST',headers:{...identityHeaders(identity),...headers},body:JSON.stringify(body)});
 try{
  for(const identity of [demoIdentity,nativeB,loan,privateOwner,nearOwner]){const accepted=await login(site.url,baseHeaders,identity);assert.equal(accepted.status,200);cookies.set(identity.profile.id,accepted.headers.get('set-cookie'));}
  assert.equal((await login(site.url,baseHeaders,clean)).status,400);assert.equal(calls.length,0);
  for(const identity of [loan,privateOwner,nearOwner])assert.equal((await post(identity,'/api/intent-zcash/authorize',{review:{source:{accountId:nativeSource}}},{'x-lenz-hosted-request-id':'1794690000000-'+'1'.repeat(32)})).status,403);
  for(const action of ['prepare','authorize','submit','reconcile','recover-authorization'])assert.equal((await post(nativeB,'/api/intent-zcash/'+action,action==='prepare'?{source:{accountId:nativeSource}}:{review:{source:{accountId:nativeSource}}},{'x-lenz-hosted-request-id':'1794690000000-'+'1'.repeat(32)})).status,403);
  assert.equal((await post(demoIdentity,'/api/intent-zcash/status',{owner:sourceB})).status,403);
  assert.equal((await post(demoIdentity,'/api/zcash/refresh',{wallet:'b'})).status,403);
  assert.equal((await post(loan,'/api/intents/lending/funding/submit',{owner:demoIdentity.profile.id,ownerAddress:loanAddress,account:loanAccount})).status,403);
  assert.equal((await post(loan,'/api/intents/lending/setup',{owner:loanAddress,account:beneficiary})).status,403);
  assert.equal((await post(nearOwner,'/api/intent-near/prepare-funds',{owner:nearAccount})).status,403);
  assert.equal((await post(nearOwner,'/api/intent-near/reconcile',{review:{source:{accountId:'8'.repeat(64)}}})).status,403);
  assert.equal(calls.length,0);
  const directlyDenied=await fetch(gateway.url+'/api/intent-zcash/authorize',{method:'POST',headers:{'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':origin,'x-lenz-privileged':'1','x-lenz-hosted-identity':nativeB.profile.id,'x-lenz-hosted-request-id':'1794690000000-'+'1'.repeat(32),'content-type':'application/json'},body:nativeBody('original')});assert.equal(directlyDenied.status,403);assert.equal(calls.length,0);
  const configuration=await(await post(demoIdentity,'/api/intent-zcash/config',{})).json();assert.deepEqual(configuration.sources,[{accountId:nativeSource,wallet:'a',recipient:nativeRecipient}]);
  assert.equal((await post(loan,'/api/intents/lending/funding/submit',{owner:loan.profile.id,ownerAddress:loanAddress,account:loanAccount})).status,200);
  assert.equal((await post(nearOwner,'/api/intent-near/reconcile',{review:{source:{accountId:nearAccount}}})).status,200);
  const original=await post(demoIdentity,'/api/intent-zcash/authorize',{review:{source:{accountId:nativeSource}}},{'x-lenz-hosted-request-id':'1794690000000-'+'1'.repeat(32)});assert.equal(original.status,202);const job=(await original.json()).lenzHostedJob;
  const stolen=await fetch(site.url+'/api/hosted/jobs/'+job,{headers:identityHeaders(nativeB)});assert.equal(stolen.status,403);assert.equal((await stolen.json()).code,'HOSTED_CUSTODY_SCOPE');
  let retained;for(let i=0;i<40;i++){retained=await(await fetch(site.url+'/api/hosted/jobs/'+job,{headers:identityHeaders(demoIdentity)})).json();if(retained.state==='complete')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(retained.body.artifactId,'original-owned-result');
  assert.equal(calls.filter(value=>value.path.endsWith('/authorize')).length,1);assert.equal(calls.at(-1).identity,demoIdentity.profile.id);
 }finally{await close(site.server);await close(gateway.server);await close(backend.server);await rm(folder,{recursive:true,force:true});}
});

test('legacy unbound native jobs disclose no completed authority and cannot be reassigned or dispatched again',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-legacy-')),directory=join(folder,'jobs'),requestId='1794690000000-'+'a'.repeat(32),id=createHash('sha256').update(requestId).digest('hex');await mkdir(directory);await writeFile(join(directory,id+'.json'),JSON.stringify({version:1,id,requestDigest:'c'.repeat(64),path:'/api/intent-zcash/authorize',state:'complete',status:200,body:{artifactId:'old-unbound-authority'},createdAt:1794690000000}));
 let calls=0;const gateway=await listen(await createHostedGateway({origin,gatewaySecret,jobsDir:directory,fetcher:()=>{calls++;throw Error('Must not dispatch');}})),headers={'x-lenz-gateway-authorization':gatewaySecret,'x-lenz-public-origin':origin,'x-lenz-privileged':'1','x-lenz-hosted-identity':demoIdentity.profile.id,'x-lenz-hosted-request-id':requestId,'content-type':'application/json'};
 try{const read=await(await fetch(gateway.url+'/api/hosted/jobs/'+id,{headers})).json(),replayed=await(await fetch(gateway.url+'/api/intent-zcash/authorize',{method:'POST',headers,body:nativeBody('original')})).json();for(const value of [read,replayed]){assert.equal(value.state,'unknown');assert.equal(value.body,undefined);}assert.equal(calls,0);}
 finally{await close(gateway.server);await rm(folder,{recursive:true,force:true});}
});
