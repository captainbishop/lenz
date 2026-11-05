import {randomBytes} from 'node:crypto';
import {keysAre,assert,verifyValue} from './public/peer-crypto.js';
import {aiConversation,checkAIIdentity,aiTerms} from './public/ai-conversation.js';

export function createAIRoute({origin='http://127.0.0.1:4173',enabled=false,allowedIds=[],consume,ask,now=Date.now}={}){
  const host=new URL(origin).host,allowed=new Set(allowedIds),nonces=new Map();let busy=false,reading=0;
  return async(req,res)=>{
    if(!req.url.startsWith('/api/ai/'))return false;
    const send=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(req.headers.host!==host){send(403,{error:'Open NEAR AI in Lenz.'});return true;}
    if(req.url==='/api/ai/status'&&req.method==='GET'){send(200,{available:enabled,executable:false});return true;}
    if(req.headers.origin!==origin){send(403,{error:'Open NEAR AI in Lenz.'});return true;}
    if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(405,{error:'Use an AI request.'});return true;}
    if(!enabled){send(503,{error:'NEAR AI is not connected yet.'});return true;}
    if(reading>=4){send(429,{error:'AI is busy.'});return true;}reading++;
    let ownsBusy=false;const abort=new AbortController(),onClose=()=>{if(!res.writableEnded)abort.abort();};res.on('close',onClose);
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;assert(size<=100000,'AI request too large.');chunks.push(chunk);}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      for(const [id,n]of nonces)if(n.until<=now())nonces.delete(id);
      if(req.url==='/api/ai/challenge'){
        assert(keysAre(value,['id'])&&typeof value.id==='string'&&allowed.has(value.id),'AI access is not enabled for this account.');
        const nonce=randomBytes(32).toString('hex');nonces.set(value.id,{nonce,until:now()+60000});send(200,{nonce});return true;
      }
      assert(req.url==='/api/ai/chat'&&keysAre(value,['identity','nonce','input','signature']),'Invalid AI request.');
      const identity=await checkAIIdentity(value.identity);assert(allowed.has(identity.id),'AI access is not enabled for this account.');
      const n=nonces.get(identity.id);assert(n&&n.until>now()&&n.nonce===value.nonce,'AI request expired.');
      nonces.delete(identity.id);const input=aiConversation(value.input);
      assert(await verifyValue(identity.signingPublic,await aiTerms(origin,identity.id,value.nonce,input),value.signature),'AI authorization failed.');
      if(busy){send(429,{error:'AI is busy. Try again shortly.'});return true;}
      assert(!abort.signal.aborted,'AI request cancelled.');busy=ownsBusy=true;
      try{consume(identity.id,now());}catch{send(429,{error:'AI daily limit reached.'});return true;}
      const result=await ask(input,{signal:abort.signal});
      assert(keysAre(result,['text','verified','executable'])&&result.verified===true&&result.executable===false&&typeof result.text==='string'&&result.text.trim().length>0&&result.text.length<=8000,'Invalid AI reply.');
      send(200,result);
    }catch{send(400,{error:'AI request could not be completed. Nothing was sent to your contacts.'});}
    finally{reading--;if(ownsBusy)busy=false;res.removeListener('close',onClose);}
    return true;
  };
}
