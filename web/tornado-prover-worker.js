import bigInt from 'snarkjs/src/bigint';
import babyJub from 'circomlib/src/babyjub';
import pedersenHash from 'circomlib/src/pedersenHash';
import MerkleTree from 'fixed-merkle-tree';
import buildGroth16 from 'websnark/src/groth16';
import proofUtils from 'websnark/src/utils';
import isValid from 'snarkjs/src/verifier_groth';
import bigintUtils from 'snarkjs/src/stringifybigint';
import {artifacts} from 'lenz-tornado-artifacts';

const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const {stringifyBigInts,unstringifyBigInts}=bigintUtils;
const hex=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
function scalar(value){
 if(typeof value!=='string'||!(/^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)))throw Error('Invalid Tornado field input');
 const number=BigInt(value);if(number<0n||number>=field)throw Error('Invalid Tornado field input');return number.toString();
}
function address(value){if(typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value))throw Error('Invalid Tornado beneficiary or relayer');return value;}
const pedersen=bytes=>babyJub.unpackPoint(pedersenHash.hash(bytes))[0];
function decodeNote(note){
 if(!note||note.version!==1)throw Error('Unsupported Tornado note');
 const nullifier=bigInt(scalar(note.nullifier)),secret=bigInt(scalar(note.secret));
 if(nullifier>=1n<<248n||secret>=1n<<248n)throw Error('Invalid Tornado note size');
 const commitment=pedersen(Buffer.concat([nullifier.leInt2Buff(31),secret.leInt2Buff(31)])),nullifierHash=pedersen(nullifier.leInt2Buff(31));
 if(scalar(note.commitment)!==commitment.toString()||scalar(note.nullifierHash)!==nullifierHash.toString())throw Error('Tornado note integrity check failed');
 return {nullifier,secret,nullifierHash};
}
async function artifact(base,name){
 const expected=artifacts[name],response=await fetch(new URL(name,base),{method:'GET',mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error('The public Tornado proving artifacts are unavailable');
 const reader=response.body.getReader(),data=new Uint8Array(expected.bytes);let offset=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.byteLength>data.byteLength)throw Error('Tornado artifact integrity check failed');data.set(value,offset);offset+=value.byteLength;}
 }catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 if(offset!==expected.bytes)throw Error('Tornado artifact integrity check failed');
 const bytes=data.buffer;
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 if(Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('')!==expected.sha256)throw Error('Tornado artifact integrity check failed');
 return name.endsWith('.json')?JSON.parse(new TextDecoder().decode(bytes)):bytes;
}
function validProof(proof,key){
 if(!proof||!Array.isArray(proof.publicSignals)||proof.publicSignals.length!==6)return false;
 try{
  proof.publicSignals.forEach(scalar);
  return isValid(unstringifyBigInts(key),unstringifyBigInts(proof),unstringifyBigInts(proof.publicSignals));
 }catch{return false;}
}
async function execute(operation,input,base){
 if(operation==='note'){
  const nullifier=bigInt.leBuff2int(crypto.getRandomValues(new Uint8Array(31))),secret=bigInt.leBuff2int(crypto.getRandomValues(new Uint8Array(31)));
  return {version:1,nullifier:nullifier.toString(),secret:secret.toString(),commitment:hex(pedersen(Buffer.concat([nullifier.leInt2Buff(31),secret.leInt2Buff(31)]))),nullifierHash:hex(pedersen(nullifier.leInt2Buff(31)))};
 }
 if(operation==='path'){
  if(!Array.isArray(input.commitments)||input.commitments.length>2**20||!Number.isSafeInteger(input.index)||input.index<0||input.index>=input.commitments.length)throw Error('Invalid Tornado commitment path');
  const tree=new MerkleTree(20,input.commitments.map(scalar)),path=tree.path(input.index);
  return {root:hex(tree.root()),pathElements:path.pathElements.map(hex),pathIndices:path.pathIndices};
 }
 if(operation==='validate-note'){decodeNote(input);return true;}
 if(operation==='verify')return validProof(input,await artifact(base,'withdraw_verification_key.json'));
 if(operation!=='prove')throw Error('Unknown local proving operation');
 const note=decodeNote(input.note);
 if(!Array.isArray(input.pathElements)||input.pathElements.length!==20||!Array.isArray(input.pathIndices)||input.pathIndices.length!==20||input.pathIndices.some(value=>value!==0&&value!==1))throw Error('Invalid Tornado commitment path');
 const witnessInput=stringifyBigInts({root:scalar(input.root),nullifierHash:note.nullifierHash,recipient:address(input.recipient),relayer:address(input.relayer),fee:scalar(input.fee),refund:scalar(input.refund),nullifier:note.nullifier,secret:note.secret,pathElements:input.pathElements.map(scalar),pathIndices:input.pathIndices});
 const started=performance.now();self.postMessage({phase:'artifacts'});
 const [circuit,key,verificationKey]=await Promise.all([artifact(base,'withdraw.json'),artifact(base,'withdraw_proving_key.bin'),artifact(base,'withdraw_verification_key.json')]);
 self.postMessage({phase:'initializing'});
 let groth16;
 try{
  groth16=await buildGroth16({wasmInitialMemory:1000});
  const witnessStarted=performance.now();self.postMessage({phase:'witness'});
  const proof=await proofUtils.genWitnessAndProve(groth16,witnessInput,circuit,key);
  const proofMilliseconds=performance.now()-witnessStarted;self.postMessage({phase:'verifying'});
  if(!validProof(proof,verificationKey))throw Error('The local Tornado proof did not verify');
  return {proof,solidity:proofUtils.toSolidityInput(proof),publicSignals:proof.publicSignals,metrics:{totalMilliseconds:Math.round(performance.now()-started),witnessAndProofMilliseconds:Math.round(proofMilliseconds),workers:groth16.workers.length,mainWasmBytes:groth16.memory.buffer.byteLength,initialWorkerWasmBytes:1000*65536}};
 }catch(error){
  if(error.message==='The local Tornado proof did not verify')throw error;
  throw Error('This browser, note or Merkle path could not produce a valid local Tornado proof');
 }finally{groth16?.terminate();}
}
self.onmessage=async event=>{
 try{self.postMessage({result:await execute(event.data.operation,event.data.input,event.data.artifactBase)});}
 catch(error){self.postMessage({error:error.message});}
};
