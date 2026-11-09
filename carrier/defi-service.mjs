import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {assert,openMessage} from '../web/public/peer-crypto.js';
import {carrierSenderProfile} from '../web/public/defi-request.js';
import {CARRIER_DOMAIN,MAX_ENVELOPE_BYTES,PAGE_SIZE,carrierOrigin,validateInbox,wrapForCarrier} from '../web/public/carrier-protocol.js';

// The operator provides the identity, trusted senders, inbox and pinned worker.
// HTTP stores requests and reads ciphertext; only the operator's tick can execute.
export function createDefiService({directory,origin,identity,inbox,worker,senders,mode='observe',allowedOrigins=[],now=Date.now,maxBytes=32*1024*1024}) {
  carrierOrigin(origin);allowedOrigins.forEach(carrierOrigin);
  assert(['observe','execute'].includes(mode),'Choose observe or execute mode');
  assert(Array.isArray(senders) && senders.length>0 && senders.length<=256 && new Set(senders).size===senders.length
    && senders.every(id=>typeof id==='string' && /^[0-9a-f]{64}$/.test(id) && id!==identity.profile.id),'Configure allowed sender identities');
  assert(Number.isSafeInteger(maxBytes) && maxBytes>0,'Invalid delivery byte limit');
  const local=structuredClone(identity),allowed=new Set(senders),browserOrigins=new Set(allowedOrigins);
  mkdirSync(directory,{recursive:true});const db=new DatabaseSync(resolve(directory,'delivery.sqlite'));
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS settings (slot INTEGER PRIMARY KEY CHECK(slot=1), domain TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (request TEXT NOT NULL, kind TEXT NOT NULL, recipient TEXT NOT NULL,
        id TEXT NOT NULL, body TEXT NOT NULL, size INTEGER NOT NULL, height INTEGER NOT NULL, terminal INTEGER NOT NULL,
        checked INTEGER NOT NULL, PRIMARY KEY(request,kind));`);
    const domain=JSON.stringify([local.profile.id,origin,[...allowed].sort()]);
    db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').run(domain);
    assert(db.prepare('SELECT domain FROM settings WHERE slot=1').get().domain===domain,'Delivery store belongs to another executor, origin or sender policy');
  } catch(error) {db.close();throw error;}
  const pending=new Set();let closed=false,work=null,closing=null,cursor='';
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const reservedBytes=()=>db.prepare("SELECT COALESCE(SUM(size+?),0) AS bytes FROM replies WHERE kind='receipt'").get(MAX_ENVELOPE_BYTES).bytes;
  const checkCapacity=()=>assert(reservedBytes()<=maxBytes,'Delivery capacity must be restored before execution');
  async function publish(id,kind,packet) {
    const saved=inbox.read(id);assert(saved && allowed.has(saved.envelope.sender.id),'Request sender is not allowed');
    const sender=carrierSenderProfile(saved.envelope.sender),payload=await openMessage(local,sender,packet);
    assert(packet.from===local.profile.id && packet.to===sender.id && payload.requestId===id,'Different outgoing result');
    const old=db.prepare('SELECT * FROM replies WHERE request=? AND kind=?').get(id,kind);
    if(old){const envelope=JSON.parse(old.body);if(envelope.packet.id===packet.id && envelope.expiresAt>now())return;}
    const envelope=await wrapForCarrier(local,packet,now()),body=JSON.stringify(envelope),size=Buffer.byteLength(body);
    const height=kind==='report'?(payload.observation?.block?.height??-1):-1,terminal=payload.state==='observed'?1:0,checked=payload.checkedAt??payload.storedAt;
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing=db.prepare('SELECT * FROM replies WHERE request=? AND kind=?').get(id,kind);
      // Concurrent intake must keep the first durable receipt and its exact wrapper.
      if(kind==='receipt' && existing && existing.body!==old?.body){db.exec('COMMIT');return;}
      if(existing && (existing.height>height || existing.terminal>terminal || (existing.height===height && existing.checked>checked))) {
        db.exec('COMMIT');return;
      }
      // Each receipt reserves one maximum-size result for the same request.
      const total=reservedBytes(),required=kind==='receipt'?total-(existing?existing.size+MAX_ENVELOPE_BYTES:0)+size+MAX_ENVELOPE_BYTES:total;
      assert(kind==='receipt' || db.prepare("SELECT request FROM replies WHERE request=? AND kind='receipt'").get(id),'Result has no reserved delivery slot');
      assert(required<=maxBytes,'Delivery store is full; existing replies remain saved');
      db.prepare('INSERT INTO replies VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(request,kind) DO UPDATE SET recipient=excluded.recipient,id=excluded.id,body=excluded.body,size=excluded.size,height=excluded.height,terminal=excluded.terminal,checked=excluded.checked')
        .run(id,kind,sender.id,envelope.id,body,size,height,terminal,checked);
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  async function receipt(id,packet=null) {
    const row=db.prepare("SELECT body FROM replies WHERE request=? AND kind='receipt'").get(id);
    if(row){const envelope=JSON.parse(row.body);if(envelope.expiresAt>now())return;await publish(id,'receipt',envelope.packet);}
    else await publish(id,'receipt',packet??await inbox.receipt(id));
  }
  async function handle(req,res) {
    try {
      assert(!closed && pending.size<8,'Service busy');
      assert(req.headers.host===new URL(origin).host,'Incorrect service host');
      if(req.headers.origin) {
        assert(browserOrigins.has(req.headers.origin),'App origin not allowed');
        res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
      }
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(req.method!=='POST' || !['/v1/store','/v1/inbox'].includes(req.url)){json(res,404,{error:'Unknown operation.'});return;}
      assert(req.headers['content-type']==='application/json','JSON required');
      const limit=req.url==='/v1/store'?MAX_ENVELOPE_BYTES:2048,parts=[];let size=0;
      assert(Number(req.headers['content-length']??0)<=limit,'Request too large');
      const deadline=setTimeout(()=>req.destroy(),8000);deadline.unref();
      try {for await(const part of req){size+=part.length;assert(size<=limit,'Request too large');parts.push(part);}}
      finally {clearTimeout(deadline);}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(req.url==='/v1/store') {
        assert(allowed.has(body.sender?.id),'Sender is not allowed');
        const accepted=await inbox.receive(body);
        assert(JSON.stringify(inbox.read(accepted.id).envelope)===JSON.stringify(body),'Different saved delivery');
        await receipt(accepted.id,accepted.receipt);
        json(res,200,{type:CARRIER_DOMAIN,id:body.id,status:'stored',expiresAt:body.expiresAt});
      } else {
        const q=await validateInbox(body,origin,now());
        const envelopes=db.prepare("SELECT body FROM replies WHERE recipient=? AND id>? AND json_extract(body,'$.expiresAt')>? ORDER BY id LIMIT ?")
          .all(q.recipient.id,q.after,now(),PAGE_SIZE).map(row=>JSON.parse(row.body));
        json(res,200,{type:CARRIER_DOMAIN,envelopes,next:envelopes.length===PAGE_SIZE?envelopes.at(-1).id:''});
      }
    } catch(error) {if(!res.headersSent && !res.destroyed)json(res,400,{error:'Executor rejected request.'});}
  }
  const server=http.createServer((req,res)=>{const p=handle(req,res).finally(()=>pending.delete(p));pending.add(p);});
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;server.maxRequestsPerSocket=100;
  async function cycle() {
    const entries=inbox.list({after:cursor,limit:8});cursor=entries.length===8?entries.at(-1).id:'';
    const outcomes=[];
    for(const entry of entries) {
      if(closed)break;
      if(!allowed.has(entry.sender))continue;
      try {
        await receipt(entry.id);if(closed)break;
        checkCapacity();
        const savedReport=worker.report(entry.id);if(savedReport)await publish(entry.id,'report',savedReport);
        if(closed)break;
        if(mode==='execute' && !entry.expired)await worker.run(entry.id);else await worker.check(entry.id);
        const report=worker.report(entry.id);if(report)await publish(entry.id,'report',report);
        outcomes.push({id:entry.id,state:'checked'});
      } catch {outcomes.push({id:entry.id,state:'unavailable'});}
    }
    return outcomes;
  }
  return {server,
    async listen(){assert(!closed,'Service closed');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(new URL(origin).port),'127.0.0.1',resolve);});return origin;},
    tick(){assert(!closed,'Service closed');work??=cycle().finally(()=>{work=null;});return work;},
    close(){return closing??=(async()=>{closed=true;server.closeAllConnections();await new Promise(r=>server.close(r));await Promise.allSettled([...pending,...(work?[work]:[])]);db.close();})();},
  };
}
