// Publishes only newly generated test ciphertext; never reads browser wallet state.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
(async()=>{
  const config=JSON.parse(await fs.readFile(path.join(__dirname,'public/nostr-config.json'),'utf8'));
  const server=http.createServer(async(req,res)=>{try{
    for(const[k,v]of Object.entries(securityHeaders('/chat.html',[],config.relays)))res.setHeader(k,v);
    const file=new URL(req.url,'http://localhost').pathname;
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
    res.end(file==='/check.html'?'<!doctype html><title>Disposable relay check</title>':await fs.readFile(path.join(__dirname,'public',file)));
  }catch{res.writeHead(404);res.end();}});
  let browser;
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext(),page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/check.html');
    const results=await page.evaluate(async config=>{
      const crypto=await import('/peer-crypto.js'),p=await import('/nostr-protocol.js'),socket=await import('/nostr-socket.js');
      return Promise.all(config.relays.map(async origin=>{
        let relay,mailbox;
        const result={origin,accepted:false,retrieved:false,validated:false};
        try{
          const a=await crypto.createIdentity('Relay check sender'),b=await crypto.createIdentity('Relay check recipient');
          const packet=await crypto.sealMessage(a,b.profile,{kind:'chat',text:'Disposable encrypted Lenz transport check'});
          const packed=await p.packEnvelope(a,b.profile,packet);mailbox=await p.mailboxKey(b,a.profile,a.profile.id);
          relay=await socket.openRelay(origin,{allowed:async()=>true,timeout:10000});
          for(const event of packed.events)await relay.publish(event);
          result.accepted=true;
          const assembler=p.createReassembler();
          await socket.readMailbox(relay,mailbox.publicKey,null,async event=>{
            if(!packed.events.some(e=>e.id===event.id))return;
            result.retrieved=true;
            const envelope=await assembler.accept(event,mailbox,a.profile,b.profile.id);
            if(envelope)result.validated=envelope.packet.id===packet.id;
          });
        }catch(error){result.error=error.message;}
        finally{relay?.close();mailbox?.secret.fill(0);}
        return result;
      }));
    },config);
    const report={checkedAt:new Date().toISOString(),scope:'Fresh disposable Edge context, generated test identities and encrypted test messages only. Public relay write acceptance and same-session readback; not retention, delayed cross-device delivery or financial settlement.',results};
    await fs.writeFile(path.join(__dirname,'nostr-public-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    if(!results.some(r=>r.validated))process.exitCode=1;
  }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
