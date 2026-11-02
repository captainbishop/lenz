import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert, digest, sealMessage, openMessage } from '../web/public/peer-crypto.js';
import { validateEnvelope } from '../web/public/carrier-protocol.js';
import { openDefiRequest, carrierSenderProfile } from '../web/public/defi-request.js';

// The caller supplies the authenticated executor identity and the pinned chain client.
// Stored reports are observations for independent verification, never wallet credits.
export class DefiExecutor {
  #db; #inbox; #identity; #config; #clients; #now;
  constructor(directory,{inbox,identity,config,clients,now=Date.now}) {
    this.#inbox=inbox;this.#identity=structuredClone(identity);this.#config=structuredClone(config);this.#clients=clients;this.#now=now;
    mkdirSync(directory,{recursive:true});this.#db=new DatabaseSync(resolve(directory,'execution.sqlite'));
    try {
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS settings (slot INTEGER PRIMARY KEY CHECK(slot=1), domain TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (n INTEGER PRIMARY KEY, request TEXT NOT NULL, step TEXT NOT NULL UNIQUE,
          call TEXT NOT NULL, sender TEXT, hash TEXT, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS reports (request TEXT PRIMARY KEY, packet TEXT NOT NULL, height INTEGER NOT NULL, terminal INTEGER NOT NULL);`);
      const domain=JSON.stringify([identity.profile.id,config]);
      this.#db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').run(domain);
      assert(this.#db.prepare('SELECT domain FROM settings WHERE slot=1').get().domain===domain,'Executor journal belongs to another identity or configuration');
    } catch(e) {this.#db.close();throw e;}
  }
  #latest(id) {return this.#db.prepare('SELECT * FROM attempts WHERE request=? ORDER BY n DESC LIMIT 1').get(id);}
  #superseded(id,observation) {
    const known=this.#db.prepare('SELECT height,terminal FROM reports WHERE request=?').get(id);
    return !!known && (known.height>observation.block.height || (known.terminal===1 && !!observation.call));
  }
  async #load(id) {
    const saved=this.#inbox.read(id);assert(saved,'Unknown DeFi request');
    const e=structuredClone(saved.envelope);await validateEnvelope(e,saved.storedAt);
    const sender=carrierSenderProfile(e.sender);
    const request=await openDefiRequest(this.#identity,sender,this.#config,e.packet,saved.storedAt);
    assert(request.id===id,'Different saved DeFi request');return {request,sender};
  }
  async #report(id,sender,state,observation,transaction=null) {
    const packet=await sealMessage(this.#identity,sender,{type:'lenz/defi-observation/v1',requestId:id,checkedAt:this.#now(),state,observation,transaction});
    const height=observation?.block?.height??-1,terminal=state==='observed'?1:0;
    this.#db.prepare(`INSERT INTO reports VALUES (?,?,?,?) ON CONFLICT(request) DO UPDATE SET
      packet=excluded.packet,height=excluded.height,terminal=excluded.terminal
      WHERE excluded.height>=reports.height AND excluded.terminal>=reports.terminal`)
      .run(id,JSON.stringify(packet),height,terminal);
    return packet;
  }
  async run(id) {
    const {request,sender}=await this.#load(id);
    let observation;
    try {observation=await this.#clients.observe(request.operation);}
    catch {return this.#report(id,sender,'unavailable',null);}
    let last=this.#latest(id),transaction=null;
    if(last?.hash) {
      const saved=await openMessage(this.#identity,sender,JSON.parse(last.call));
      assert(saved.type==='lenz/defi-attempt/v1' && saved.requestId===id,'Different saved attempt');
      transaction=await this.#clients.reconcile({sender:last.sender,txHash:last.hash},saved.call,observation);
    }
    // Fresh final state may demonstrate progress even when a previous reply was lost.
    if(!observation.call) return this.#report(id,sender,observation.state,observation,transaction);
    if(this.#superseded(id,observation))return this.#report(id,sender,'needs_review',observation,transaction);
    const step=await digest([id,observation.step,observation.call]);
    if(this.#db.prepare('SELECT n FROM attempts WHERE step=?').get(step))
      return this.#report(id,sender,'pending',observation,transaction);
    if(this.#now()>=request.expiresAt) return this.#report(id,sender,'expired',observation,transaction);
    // Revalidate the current approval immediately before opening the signing boundary.
    await openDefiRequest(this.#identity,sender,this.#config,this.#inbox.read(id).envelope.packet,this.#now());
    const call=structuredClone(observation.call);
    const sealed=await sealMessage(this.#identity,sender,{type:'lenz/defi-attempt/v1',requestId:id,call});
    assert(this.#now()<request.expiresAt,'DeFi approval expired before dispatch');
    if(this.#superseded(id,observation))return this.#report(id,sender,'needs_review',observation,transaction);
    const claimed=this.#db.prepare('INSERT OR IGNORE INTO attempts (request,step,call,created) VALUES (?,?,?,?)')
      .run(id,step,JSON.stringify(sealed),this.#now()).changes;
    if(!claimed) return this.#report(id,sender,'pending',observation,transaction);
    try {
      await this.#clients.send(call,ref=>{
        assert(this.#now()<request.expiresAt,'DeFi approval expired before broadcast');
        assert(typeof ref.sender==='string' && ref.sender.length<=64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(ref.sender)
          && typeof ref.txHash==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref.txHash),'Invalid signed transaction reference');
        // No second signature for this step, including SDK nonce retries.
        assert(this.#db.prepare('UPDATE attempts SET sender=?,hash=? WHERE step=? AND hash IS NULL').run(ref.sender,ref.txHash,step).changes===1,'Execution step already signed');
      });
    } catch {
      // Failure may follow broadcast. Keep the immutable attempt for status-only recovery.
    }
    try {
      observation=await this.#clients.observe(request.operation);
      last=this.#db.prepare('SELECT * FROM attempts WHERE step=?').get(step);
      if(last?.hash) transaction=await this.#clients.reconcile({sender:last.sender,txHash:last.hash},call,observation);
      return this.#report(id,sender,observation.call?'pending':observation.state,observation,transaction);
    } catch {return this.#report(id,sender,'pending',null,transaction);}
  }
  report(id) {const row=this.#db.prepare('SELECT packet FROM reports WHERE request=?').get(id);return row?JSON.parse(row.packet):null;}
  close(){this.#db.close();}
}
