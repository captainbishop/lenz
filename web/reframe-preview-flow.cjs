// Read-only presentation replay from the captured, signed packets and receipts.
// No wallet writes, signing, funding, settlement, RPC mocks or profile restores.
const { chromium } = require('playwright'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname,'..'), base='http://127.0.0.1:4173';
const privateRoot=path.join(root,'contracts/.testnet/offline-social-live-2026-10-31');
const sha=b=>createHash('sha256').update(b).digest('hex');
(async()=>{
  const capture=JSON.parse(await fs.readFile(path.join(privateRoot,'preview-capture.json')));
  const ev=JSON.parse(await fs.readFile(path.join(__dirname,'preview-flow-results.json')));
  assert(capture.complete && ev.complete && ev.finalTransaction.finality==='FINAL');
  const profiles=JSON.parse(await fs.readFile(path.join(__dirname,'offline-social-live-results.json'))).profiles;
  const sources=new Set(['web/reframe-preview-flow.cjs']), snapshots={};
  for(const [role, names] of [['a',['private-send']],['b',['private-read','payment-received']],['c',['payment-onward','payment-confirmed']]]) {
    const ctx=await chromium.launchPersistentContext(path.join(privateRoot,role),{channel:'msedge',headless:true,viewport:{width:900,height:760},reducedMotion:'reduce',serviceWorkers:'block'});
    try {
      const p=ctx.pages()[0]||await ctx.newPage();
      const network=await ctx.newCDPSession(p);
      await network.send('Network.enable');
      await network.send('Network.setBypassServiceWorker',{bypass:true});
      await network.send('Network.setCacheDisabled',{cacheDisabled:true});
      await p.route('**/api/**',r=>r.abort());
      ctx.on('request',r=>{const u=new URL(r.url());if(u.origin===base&&/\.(js|css|html|json)$/.test(u.pathname))sources.add('web/public'+u.pathname);});
      await p.goto(base+'/chat.html');await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Private chat is ready'));
      const snapshot=()=>p.evaluate(async()=>JSON.stringify(await(await import('/chat-store.js')).readState()));
      const before=await snapshot();
      assert.equal(await p.evaluate(async()=>(await(await import('/chat-store.js')).readState()).identity.profile.id),profiles[role].id);
      await p.addStyleTag({content:`.topbar,.contacts,.composer,#status,#back-people{display:none!important}.chat-shell{padding:0!important;height:auto!important;max-width:none!important}.workspace{display:block!important;border:0!important;box-shadow:none!important;border-radius:0!important}.conversation{display:flex!important;width:520px!important;height:350px!important;border:0!important;border-radius:0!important;padding:0!important}.conversation-top{padding:18px 22px!important}.conversation-top h2{font-size:22px!important}.messages{padding:16px 24px!important;overflow:hidden!important;justify-content:center!important}#messages>*{max-width:100%!important;width:100%!important}.near-chat-card{padding:12px!important}.near-chat-card .near-payment-actions{margin-top:8px!important}.near-chat-card .near-payment-actions button{margin:0!important;min-height:44px!important}.near-chat-card a{display:none!important}.near-chat-card h3{margin:0 0 4px!important;font-size:17px!important}.near-chat-card .eyebrow{display:none!important}.near-chat-card .payment-amount{font-size:24px!important;margin:0 0 4px!important}.near-chat-card .trade-state{font-size:13px!important;margin:0 0 8px!important;padding:8px!important}.near-chat-card small{font-size:10px!important;line-height:1.4!important}.near-chat-card a{min-height:26px!important;font-size:12px!important}.bubble:not(.financial){font-size:17px!important}.bubble small{font-size:12px!important}`});
      for(const name of names) {
        await ctx.setOffline(name !== 'payment-confirmed');
        const packet=capture.packets[name.startsWith('private')?'message':name==='payment-received'?'first':'onward'];
        const contactId=packet.from===profiles[role].id?packet.to:packet.from;
        // The contact list is deliberately outside this presentation crop.
        await p.locator('#contact-list button').filter({hasText:Object.values(profiles).find(x=>x.id===contactId).name}).evaluate(button=>button.click());
        await p.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
        if(name.startsWith('payment')) {
          // Only the DOM renderer sees the historical receipt state. Persistent
          // wallet data and spendability are never changed or restored.
          const detail=await p.evaluate(async({packet,confirmed,receipt})=>{
            const s=await(await import('/chat-store.js')).readState(), contact=s.contacts.find(c=>c.id===packet.from);
            const payload=await(await import('/peer-crypto.js')).openMessage(s.identity,contact,packet);
            const crypto=await import('/peer-crypto.js'),protocol=await import('/near-protocol.js');
            const id=await crypto.digest(protocol.transferTerms(payload.contract,payload.path.at(-1)));
            const ledger={blocked:new Set(),reserved:new Set(),consumed:new Map(),notes:new Map([[id+':0',{}]])};
            const money={ledger,vault:{receipts:confirmed?{[receipt.id]:{finality:'FINAL'}}:{}}};
            const card=await(await import('/near-chat.js')).renderNearPaymentCard(payload,packet,s,money);
            const bubble=document.createElement('div');bubble.className='bubble financial';bubble.append(card);document.querySelector('#messages').replaceChildren(bubble);
            return card.textContent;
          },{packet,confirmed:name==='payment-confirmed',receipt:ev.receipts[1]});
          assert(detail.includes('1 tUSD'));
          assert(detail.includes(name==='payment-confirmed'?'Payment confirmed on NEAR':'awaiting online confirmation'));
        } else {
          await p.evaluate(()=>{const messages=document.querySelector('#messages');for(const bubble of [...messages.children])if(!bubble.textContent.includes('Meet by the bookshop'))bubble.remove();});
          assert.equal(await p.locator('#messages>*').count(),1);
        }
        snapshots[name]={};
        for(const theme of ['light','dark']) {
          await p.evaluate(async t=>{localStorage.setItem('lenz-home-theme',t);document.documentElement.dataset.theme=t;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);},theme);
          assert.equal(await p.locator('.conversation-top').evaluate(n=>getComputedStyle(n).backgroundColor),theme==='dark'?'rgb(32, 56, 43)':'rgb(255, 255, 255)');
          if(theme==='dark'&&name.startsWith('payment'))assert.equal(await p.locator('.trade-state').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(43, 68, 50)','Dark payment state must use the current readable palette');
          const file=`web/evidence/preview-replay/${name}-${theme}.png`;await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
          const data=await p.locator('.conversation').screenshot();await fs.writeFile(path.join(root,file),data);snapshots[name][theme]={file,sha256:sha(data)};
        }
        assert.notEqual(snapshots[name].light.sha256,snapshots[name].dark.sha256,'Themes must differ');
      }
      assert.equal(await snapshot(),before,'Reframing changed account data');
    } finally { await ctx.close(); }
  }
  ev.originalCaptures??=ev.captures;ev.originalSourceFiles??=ev.sourceFiles;ev.captures=snapshots;ev.sourceFiles={};
  for(const file of [...sources].sort())ev.sourceFiles[file]=sha(await fs.readFile(path.join(root,file)));
  ev.reframedAt=new Date().toISOString();
  ev.presentation='Read-only replay of the recorded signed packets through current UI renderers with captured pending/final receipt states. Cropped layout and corrected dark palette; historical source captures retained. No wallet state writes or financial calls.';
  await fs.writeFile(path.join(__dirname,'preview-flow-results.json'),JSON.stringify(ev,null,2)+'\n');
  console.log('Reframed five recorded states in both themes; all three stored accounts unchanged.');
})().catch(e=>{console.error(e);process.exitCode=1;});
