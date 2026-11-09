import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert, digest, sealMessage } from '../web/public/peer-crypto.js';
import { validateEnvelope } from '../web/public/carrier-protocol.js';
import { checkRheaConfig } from '../web/public/rhea-protocol.js';
import { DEFI_REQUEST, DEFI_RECEIPT, carrierSenderProfile, openDefiRequest, defiConflictId } from '../web/public/defi-request.js';

// Separate from the forwarding carrier. No chain credentials, calls or wallet mutations.
export class DefiInbox {
  #db; #identity; #config; #now; #limits;
  constructor(directory, {identity, config, now = Date.now, maxRequests = 256, maxBytes = 32 * 1024 * 1024, perSender = 32}) {
    checkRheaConfig(config);
    for (const n of [maxRequests,maxBytes,perSender]) assert(Number.isSafeInteger(n) && n > 0, 'Invalid DeFi inbox limit');
    this.#identity = structuredClone(identity); this.#config = structuredClone(config); this.#now = now;
    this.#limits = {maxRequests,maxBytes,perSender};
    mkdirSync(directory, {recursive:true});
    this.#db = new DatabaseSync(resolve(directory,'defi.sqlite'));
    try {
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS settings (slot INTEGER PRIMARY KEY CHECK(slot=1), domain TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, conflict TEXT NOT NULL UNIQUE, sender TEXT NOT NULL,
          expires INTEGER NOT NULL, stored INTEGER NOT NULL, envelope TEXT NOT NULL, size INTEGER NOT NULL);`);
      const domain = JSON.stringify([identity.profile.id, ...['network','adapter','reserve','exchange','poolId','tokenOut'].map(k=>config[k])]);
      this.#db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').run(domain);
      assert(this.#db.prepare('SELECT domain FROM settings WHERE slot=1').get().domain === domain, 'DeFi inbox belongs to another executor or configuration');
    } catch (error) { this.#db.close(); throw error; }
  }

  async receive(input) {
    const e = structuredClone(input), now = this.#now();
    await validateEnvelope(e, now);
    const sender = carrierSenderProfile(e.sender);
    const request = await openDefiRequest(this.#identity, sender, this.#config, e.packet, now);
    const conflict = await defiConflictId(request), body = JSON.stringify(e), size = Buffer.byteLength(body);
    // Older inboxes keyed conflicts by messaging identity. Preserve those records while
    // checking every identity that used the same spending public key.
    const aliases=this.#db.prepare("SELECT DISTINCT sender FROM requests WHERE json_extract(envelope,'$.sender.signingPublic')=?").all(e.sender.signingPublic);
    const legacy=await Promise.all(aliases.map(({sender})=>digest([DEFI_REQUEST,'input',sender,request.operation.kind,
      request.operation.packet.config.reserve,request.operation.kind==='rhea-swap'
        ? request.operation.packet.instruction.input : request.operation.deposit.id])));
    // Crypto checks may take time: reject expiry at the actual durable acceptance boundary.
    const storedAt = this.#now();
    assert(storedAt < request.expiresAt && storedAt < e.expiresAt, 'DeFi request expired before storage');
    let stored, duplicate = false;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      stored = this.#db.prepare('SELECT stored FROM requests WHERE id=?').get(request.id);
      if (stored) duplicate = true;
      else {
        for(const slot of [conflict,...legacy])
          assert(!this.#db.prepare('SELECT id FROM requests WHERE conflict=?').get(slot), 'Conflicting DeFi authorization; existing request is retained');
        const total = this.#db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM requests').get();
        const count = this.#db.prepare('SELECT COUNT(*) AS n FROM requests WHERE sender=?').get(request.sender).n;
        assert(total.n < this.#limits.maxRequests && total.bytes + size <= this.#limits.maxBytes && count < this.#limits.perSender, 'DeFi inbox quota reached');
        this.#db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?)').run(request.id,conflict,request.sender,request.expiresAt,storedAt,body,size);
        stored = {stored:storedAt};
      }
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    const receipt = await sealMessage(this.#identity, sender, {type:DEFI_RECEIPT,requestId:request.id,state:'stored',storedAt:stored.stored});
    return {id:request.id, duplicate, receipt};
  }

  read(id) {
    const row = this.#db.prepare('SELECT envelope, expires, stored FROM requests WHERE id=?').get(id);
    return row ? {envelope:JSON.parse(row.envelope), storedAt:row.stored, expired:this.#now() >= row.expires} : null;
  }
  list({after='',limit=8}={}) {
    assert(after==='' || /^[0-9a-f]{64}$/.test(after),'Invalid inbox cursor');
    assert(Number.isSafeInteger(limit) && limit>0 && limit<=32,'Invalid inbox page limit');
    return this.#db.prepare('SELECT id,sender,stored,expires FROM requests WHERE id>? ORDER BY id LIMIT ?').all(after,limit)
      .map(row=>({id:row.id,sender:row.sender,storedAt:row.stored,expired:this.#now()>=row.expires}));
  }
  async receipt(id) {
    const saved=this.read(id);assert(saved,'Unknown DeFi request');
    const e=await validateEnvelope(saved.envelope,saved.storedAt),sender=carrierSenderProfile(e.sender);
    const request=await openDefiRequest(this.#identity,sender,this.#config,e.packet,saved.storedAt);
    assert(request.id===id,'Different saved DeFi request');
    return sealMessage(this.#identity,sender,{type:DEFI_RECEIPT,requestId:id,state:'stored',storedAt:saved.storedAt});
  }
  // Expiry never deletes conflict records or implies a financial reservation can be released.
  close() { this.#db.close(); }
}
