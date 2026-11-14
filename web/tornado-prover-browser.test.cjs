const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');

(async()=>{
 const artifactRoot=process.env.LENZ_TORNADO_ARTIFACTS;
 const toolsRoot=process.env.LENZ_TORNADO_TOOLS;
 assert(artifactRoot&&toolsRoot,'Set LENZ_TORNADO_ARTIFACTS and LENZ_TORNADO_TOOLS to the released v2.1 artifacts and pinned dependencies');
 const {securityHeaders}=await import('./security-policy.mjs'),publicRoot=path.join(__dirname,'public'),requests=[];
 let corruptArtifact=false;
 const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;requests.push({method:request.method,pathname});
  for(const [name,value]of Object.entries(securityHeaders('/money.html')))response.setHeader(name,value);
  if(pathname==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Genuine local Tornado proof check</title>');return;}
  const artifact=pathname.startsWith('/api/intent-testnet/private-pool/artifacts/');
  const file=artifact?path.join(artifactRoot,path.basename(pathname)):path.resolve(publicRoot,'.'+pathname);
  if(!artifact&&!file.startsWith(publicRoot+path.sep)){response.writeHead(403);response.end();return;}
  if(artifact&&!['withdraw.json','withdraw_proving_key.bin','withdraw_verification_key.json'].includes(path.basename(file))){response.writeHead(404);response.end();return;}
  let bytes=await fs.readFile(file);if(corruptArtifact&&path.basename(file)==='withdraw_proving_key.bin'){bytes=Buffer.from(bytes);bytes[50]^=1;}
  response.setHeader('content-type',path.extname(file)==='.js'?'text/javascript':path.extname(file)==='.json'?'application/json':'application/octet-stream');
  response.setHeader('Cache-Control','no-store');response.end(bytes);
 }catch{response.writeHead(404);response.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port,errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.evaluate(()=>{globalThis.cspViolations=[];addEventListener('securitypolicyviolation',event=>cspViolations.push({directive:event.violatedDirective,blockedURI:event.blockedURI}));});
  const note=await page.evaluate(async()=>{
   const {createTornadoProver}=await import('/tornado-prover.js');globalThis.current=true;globalThis.prover=createTornadoProver({isCurrent:()=>current});
   return prover.generateNote();
  });
  const localRequire=createRequire(path.join(toolsRoot,'package.json')),snarkjs=localRequire('snarkjs'),circomlib=localRequire('circomlib');
  const pedersen=bytes=>circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(bytes))[0].toString();
  assert.equal(BigInt(note.commitment).toString(),pedersen(Buffer.concat([snarkjs.bigInt(note.nullifier).leInt2Buff(31),snarkjs.bigInt(note.secret).leInt2Buff(31)])));
  assert.equal(BigInt(note.nullifierHash).toString(),pedersen(snarkjs.bigInt(note.nullifier).leInt2Buff(31)));
  const MerkleTree=localRequire('fixed-merkle-tree'),referenceTree=new MerkleTree(20,[BigInt(note.commitment).toString()]);
  const proofResult=await page.evaluate(async note=>{
   globalThis.path=await prover.buildMerklePath([note.commitment],0);globalThis.input={note,...path,recipient:'0x000000000000000000000000000000000000beef',relayer:'0x000000000000000000000000000000000000cafe',fee:'1',refund:'0'};
   globalThis.proofResult=await prover.prove(input);return {path,proofResult};
  },note);
  assert.equal(BigInt(proofResult.path.root).toString(),referenceTree.root());
  const vk=snarkjs.unstringifyBigInts(JSON.parse(await fs.readFile(path.join(artifactRoot,'withdraw_verification_key.json'),'utf8'))),decoded=snarkjs.unstringifyBigInts(proofResult.proofResult.proof);
  assert.equal(snarkjs.groth.isValid(vk,decoded,decoded.publicSignals),true);
  const {createLocalEvm}=await import('../aurora/local-evm.mjs'),{Interface}=await import('../aurora/node_modules/ethers/lib.esm/index.js');
  const compiled=JSON.parse(await fs.readFile(path.join(artifactRoot,'compiled-verifier.json'),'utf8')),evm=await createLocalEvm(),deployed=await evm.send('0x'+compiled.evm.bytecode.object),iface=new Interface(compiled.abi);
  const calldata=proofResult.proofResult.solidity,signals=calldata.publicSignals.map(BigInt);
  const verify=async values=>iface.decodeFunctionResult('verifyProof',await evm.call(iface.encodeFunctionData('verifyProof',[calldata.proof,values]),deployed.createdAddress))[0];
  assert.equal(await verify(signals),true);
  for(let index=0;index<6;index++){const changed=signals.slice();changed[index]+=1n;assert.equal(await verify(changed),false);}
  const boundaries=await page.evaluate(async()=>{
   const changed={...proofResult.proof,publicSignals:proofResult.proof.publicSignals.slice()};changed.publicSignals[2]=(BigInt(changed.publicSignals[2])+1n).toString();
   const valid=await prover.verify(proofResult.proof),changedRejected=!(await prover.verify(changed));
   const wrongPath={...input,pathElements:input.pathElements.slice()};wrongPath.pathElements[0]='0x'+(BigInt(wrongPath.pathElements[0])+1n).toString(16);
   const wrongPathRejected=await prover.prove(wrongPath).then(()=>false,error=>/could not produce a valid/.test(error.message));
   const tamperedNote={...input,note:{...input.note,secret:(BigInt(input.note.secret)^1n).toString()}};
   const tamperedNoteRejected=await prover.prove(tamperedNote).then(()=>false,error=>/note integrity/.test(error.message));
   const controller=new AbortController();const cancelled=await prover.prove(input,{signal:controller.signal,onProgress:phase=>{if(phase==='witness')controller.abort();}}).then(()=>false,error=>error.name==='AbortError');
   const stale=await prover.prove(input,{onProgress:phase=>{if(phase==='witness'){current=false;dispatchEvent(new Event('lenz-account-identity'));}}}).then(()=>false,error=>error.name==='AbortError');
   const blocked=await prover.generateNote().then(()=>false,error=>error.name==='AbortError');
   current=true;const fresh=await prover.generateNote();prover.dispose();
   return {valid,changedRejected,wrongPathRejected,tamperedNoteRejected,cancelled,stale,blocked,freshCommitment:fresh.commitment,cspViolations};
  });
  assert.equal(boundaries.valid,true);assert.equal(boundaries.changedRejected,true);assert.equal(boundaries.cancelled,true);assert.equal(boundaries.stale,true);assert.equal(boundaries.blocked,true);
  assert.equal(boundaries.wrongPathRejected,true);assert.equal(boundaries.tamperedNoteRejected,true);
  assert.notEqual(boundaries.freshCommitment,note.commitment);assert.deepEqual(boundaries.cspViolations,[]);assert.deepEqual(errors,[]);
  corruptArtifact=true;
  const tamper=await page.evaluate(async()=>{const {createTornadoProver}=await import('/tornado-prover.js');const instance=createTornadoProver();try{await instance.prove(input);return false;}catch(error){return /integrity/i.test(error.message);}finally{instance.dispose();}});
  assert.equal(tamper,true);assert(requests.every(request=>request.method==='GET'));assert(requests.filter(request=>request.pathname.startsWith('/api/')).every(request=>request.pathname.startsWith('/api/intent-testnet/private-pool/artifacts/')));
  const evidence={passed:13,failed:0,checks:['Browser-generated note hashes agree with independent original implementation','Browser Merkle root agrees with original tree','Genuine browser proof accepted by released key','Genuine browser proof accepted by original Solidity verifier','Six changed public inputs rejected by Solidity','Browser verification rejects changed recipient','Incorrect Merkle path cannot produce a proof','Changed note secret fails integrity before proving','Cancellation during witness phase aborts local work','Account invalidation aborts proof and blocks stale operation','Fresh operation after cancellation succeeds','Tampered proving key rejected before witness/proof','Actual Lenz CSP, no violations, only public artifact GETs'],metrics:proofResult.proofResult.metrics,scope:'Isolated Edge, real random notes/witness/proof and original verifier bytecode. No wallet, RPC, signature, funding or settlement. The local EVM is an explicit internal verification gate.',publicProof:calldata};
  if(process.env.LENZ_TORNADO_EVIDENCE)await fs.writeFile(process.env.LENZ_TORNADO_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({...evidence,publicProof:undefined},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
