// Persist signed testnet calls before submission. No signing or payment accounting.
import assert from 'node:assert/strict';
import {mkdirSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {validateSignedEngineCall} from './engine-signed.mjs';
import {checkEngineTransaction,inspectEngineTransaction} from './engine-receipt.mjs';
import {rpcOptions,submissionRpc} from './engine-submit-rpc.mjs';

const terminal=new Set(['evm_succeeded','evm_failed','near_failed','needs_review']);
const states=new Set([...terminal,'pending','unavailable','unverified']);
const retryable=outcome=>outcome?.state==='unavailable'||(outcome?.state==='pending'&&outcome.finality==='NONE');
const json=x=>JSON.stringify(x,(_key,value)=>typeof value==='bigint'?value.toString():value);
function operationId(id){assert(typeof id==='string'&&/^[0-9a-f]{64}$/.test(id),'Expected a stable 32-byte operation ID');}
export class EngineJournal {
  #db;
  constructor(directory){
    assert(typeof directory==='string'&&directory.length>0,'Expected a journal directory');
    mkdirSync(directory,{recursive:true,mode:0o700});
    const file=resolve(directory,'submissions.sqlite');this.#db=new DatabaseSync(file);
    try{
      chmodSync(file,0o600);
      const version=this.#db.prepare('PRAGMA user_version').get().user_version;
      assert(version===0||version===1,'Unsupported submission journal version');
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, tx_hash TEXT UNIQUE NOT NULL, reference TEXT NOT NULL, signed TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, observation TEXT); PRAGMA user_version=1;');
    }catch(error){this.#db.close();throw error;}
  }
  #load(id){
    operationId(id);const row=this.#db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
    assert(row,'Unknown submission');const artifact=validateSignedEngineCall(JSON.parse(row.reference),row.signed);
    assert(row.tx_hash===artifact.reference.txHash,'Journal transaction hash mismatch');
    assert(Number.isSafeInteger(row.attempts)&&row.attempts>=0&&row.attempts<=100&&Number.isSafeInteger(row.revision)&&row.revision>=0,'Invalid journal counters');
    const observation=row.observation===null?null:JSON.parse(row.observation);
    assert(!observation||(states.has(observation.state)&&observation.txHash===row.tx_hash),'Invalid saved observation');
    return {...row,...artifact,observation};
  }
  #summary(row){
    return {operationId:row.id,txHash:row.tx_hash,attempts:row.attempts,
      outcome:row.observation??{state:row.attempts?'unavailable':'prepared',txHash:row.tx_hash}};
  }
  inspect(id){return this.#summary(this.#load(id));}
  record(id,reference,signedTxBase64){
    operationId(id);const a=validateSignedEngineCall(reference,signedTxBase64),ref=json(a.reference);
    this.#db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.#db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
      if(old)assert(old.reference===ref&&old.signed===a.signedTxBase64,'This operation already has a different signed transaction');
      else{
        assert(this.#db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n<128,'Submission journal capacity reached');
        this.#db.prepare('INSERT INTO submissions(id,tx_hash,reference,signed) VALUES (?,?,?,?)').run(id,a.reference.txHash,ref,a.signedTxBase64);
      }
      this.#db.exec('COMMIT');
    }catch(error){this.#db.exec('ROLLBACK');throw error;}
    return this.inspect(id);
  }
  #observe(row,outcome){
    const observation=JSON.parse(json(outcome));
    assert(states.has(observation.state)&&observation.txHash===row.tx_hash,'Different observation identity');
    assert(Buffer.byteLength(json(observation))<=256*1024,'Observation size limit');
    this.#db.exec('BEGIN IMMEDIATE');
    try{
      const current=this.#load(row.id);
      if(terminal.has(current.observation?.state)){
        if(terminal.has(observation.state))assert(json(observation)===json(current.observation),'Conflicting final execution evidence');
      }else if(terminal.has(observation.state)||current.revision===row.revision){
        this.#db.prepare('UPDATE submissions SET observation=?, revision=revision+1 WHERE id=?').run(json(observation),row.id);
      }
      this.#db.exec('COMMIT');
    }catch(error){this.#db.exec('ROLLBACK');throw error;}
    return this.inspect(row.id);
  }
  async check(id,options={}){
    const opts=rpcOptions(options),row=this.#load(id);
    return this.#observe(row,await checkEngineTransaction(row.reference,opts));
  }
  async send(id,{retry=false,...options}={}){
    assert(typeof retry==='boolean','Retry must be explicit');const opts=rpcOptions(options);
    let row=this.#load(id);
    if(terminal.has(row.observation?.state))return this.#summary(row);
    if(row.attempts>0||row.observation){
      const checked=await this.check(id,opts);
      if(!retry||!retryable(checked.outcome))return checked;
      row=this.#load(id);
      if(!retryable(row.observation))return this.#summary(row);
    }
    const network=await submissionRpc('status',[],opts);
    assert(network?.chain_id==='testnet','Submission endpoint is not NEAR testnet');
    assert(row.attempts<100,'Submission attempt limit reached');
    // Atomic claim commits before fetch. Concurrent initial sends cannot both win.
    const claim=this.#db.prepare('UPDATE submissions SET attempts=attempts+1, revision=revision+1, observation=NULL WHERE id=? AND revision=?').run(id,row.revision);
    if(claim.changes!==1)return this.inspect(id);
    row=this.#load(id);let outcome;
    try{
      const response=await submissionRpc('send_tx',{signed_tx_base64:row.signedTxBase64,wait_until:'NONE'},opts);
      outcome=inspectEngineTransaction(row.reference,response);
    }catch(error){outcome={state:error.code==='ERR_ASSERTION'?'unverified':'unavailable',txHash:row.tx_hash};}
    return this.#observe(row,outcome);
  }
  close(){this.#db.close();}
}
