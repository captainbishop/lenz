import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// One SQLite transaction commits ciphertext before the HTTP acknowledgement.
export class CarrierStore {
  constructor(directory, {maxMessages=256, maxBytes=32*1024*1024, perSender=32, perRecipient=64} = {}) {
    mkdirSync(directory,{recursive:true});
    this.db = new DatabaseSync(resolve(directory,'mail.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, packet TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL, size INTEGER NOT NULL, UNIQUE(sender,packet));');
    this.limits={maxMessages,maxBytes,perSender,perRecipient};
  }
  prune(now) { this.db.prepare('DELETE FROM mail WHERE expires <= ?').run(now); }
  put(envelope, now=Date.now()) {
    const body=JSON.stringify(envelope), size=Buffer.byteLength(body), e=envelope;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.prune(now);
      const old=this.db.prepare('SELECT id, body FROM mail WHERE sender=? AND packet=?').get(e.sender.id,e.packet.id);
      if(old) { if(old.id!==e.id || old.body!==body)throw Error('Conflicting envelope for this message.'); this.db.exec('COMMIT'); return false; }
      const total=this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM mail').get();
      const sender=this.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE sender=?').get(e.sender.id).n;
      const recipient=this.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE recipient=?').get(e.packet.to).n;
      const l=this.limits;
      if(total.n>=l.maxMessages || total.bytes+size>l.maxBytes || sender>=l.perSender || recipient>=l.perRecipient)throw Error('Carrier storage quota reached.');
      this.db.prepare('INSERT INTO mail VALUES (?,?,?,?,?,?,?)').run(e.id,e.sender.id,e.packet.to,e.packet.id,e.expiresAt,body,size);
      this.db.exec('COMMIT'); return true;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  inbox(recipient, after, limit, now=Date.now()) {
    this.prune(now);
    return this.db.prepare('SELECT body FROM mail WHERE recipient=? AND id>? ORDER BY id LIMIT ?').all(recipient,after,limit).map(r=>JSON.parse(r.body));
  }
  all(now=Date.now()) { this.prune(now); return this.db.prepare('SELECT body FROM mail ORDER BY id').all().map(r=>JSON.parse(r.body)); }
  close(){this.db.close();}
}
