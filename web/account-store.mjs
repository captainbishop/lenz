import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export class AccountStore{
  constructor(directory,{maxAccounts=128,maxBytes=256*1024*1024}={}){
    mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(resolve(directory,'accounts.sqlite'));this.limits={maxAccounts,maxBytes};
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, size INTEGER NOT NULL, updated INTEGER NOT NULL);');
  }
  get(id){const row=this.db.prepare('SELECT revision,digest,body,updated FROM accounts WHERE id=?').get(id);return row?{revision:row.revision,digest:row.digest,archive:JSON.parse(row.body),savedAt:row.updated}:null;}
  put(id,expected,previous,archive){
    const body=JSON.stringify(archive),digest=hash(body),size=Buffer.byteLength(body);if(size>16_001_024)throw Error('Backup exceeds the account limit.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.get(id);
      // A lost response can safely retry the identical encrypted snapshot.
      if(old&&old.revision===expected+1&&old.digest===digest){this.db.exec('COMMIT');return old;}
      if((old?.revision??0)!==expected||(old?.digest??'')!==previous)throw Object.assign(Error('A newer backup is already saved.'),{code:'CONFLICT'});
      const total=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS size FROM accounts').get(),oldSize=this.db.prepare('SELECT size FROM accounts WHERE id=?').get(id)?.size??0;
      if((!old&&total.n>=this.limits.maxAccounts)||total.size-oldSize+size>this.limits.maxBytes)throw Error('Backup storage is full.');
      const savedAt=Date.now(),revision=expected+1;
      this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,digest=excluded.digest,body=excluded.body,size=excluded.size,updated=excluded.updated').run(id,revision,digest,body,size,savedAt);
      this.db.exec('COMMIT');return {revision,digest,savedAt};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
