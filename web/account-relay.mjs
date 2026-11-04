import {randomBytes} from 'node:crypto';
import {assert,bytes,digest,keysAre,validateProfile,verifyValue} from './public/peer-crypto.js';
import {ACCOUNT_REQUEST} from './public/account-keys.js';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export function createAccountRoute({origin,store,now=Date.now,maxChallenges=128}){
  const host=new URL(origin).host,nonces=new Map();let active=0;
  return async function(req,res){
    if(!req.url.startsWith('/api/accounts/'))return false;
    if(req.headers.host!==host||req.headers.origin!==origin){send(res,403,{error:'Open your Lenz account on its saved address.'});return true;}
    if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(res,405,{error:'Use an account request.'});return true;}
    if(active>=8){send(res,429,{error:'Backup is busy. It will retry.'});return true;}active++;
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;assert(size<16_100_000,'Account request too large.');chunks.push(chunk);}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      for(const [key,n]of nonces)if(n.until<now())nonces.delete(key);
      if(req.url==='/api/accounts/challenge'){
        assert(keysAre(value,['accountId','operation'])&&/^[0-9a-f]{64}$/.test(value.accountId)&&['read','write'].includes(value.operation),'Invalid account request.');
        assert(nonces.size<maxChallenges,'Backup is busy. It will retry.');
        const nonce=randomBytes(32).toString('hex');nonces.set(nonce,{...value,until:now()+60000});send(res,200,{nonce});return true;
      }
      assert(['/api/accounts/read','/api/accounts/write'].includes(req.url),'Unknown account action.');
      const operation=req.url.endsWith('/write')?'write':'read';
      assert(keysAre(value,['profile','nonce','expected','previous','archive','signature']),'Invalid account request.');
      const n=nonces.get(value.nonce);nonces.delete(value.nonce);
      assert(n&&n.until>=now()&&n.operation===operation,'Account request expired.');
      const profile=await validateProfile(value.profile);assert(profile.id===n.accountId,'Account does not match.');
      assert(Number.isSafeInteger(value.expected)&&value.expected>=0&&value.expected<1_000_000_000&&typeof value.previous==='string'&&/^(?:[0-9a-f]{64})?$/.test(value.previous),'Invalid backup revision.');
      if(operation==='read')assert(value.archive===null&&(value.expected===0?value.previous==='':value.previous.length===64),'Invalid read request.');
      else assert(keysAre(value.archive,['type','accountId','revision','previous','iv','ciphertext'])&&value.archive.type==='lenz/account-backup/v1'&&value.archive.accountId===n.accountId&&value.archive.revision===value.expected+1&&value.archive.previous===value.previous&&bytes(value.archive).length<=16_001_024,'Invalid encrypted backup.');
      const terms=[ACCOUNT_REQUEST,origin,operation,n.accountId,value.nonce,value.expected,value.previous,await digest(value.archive)];
      assert(await verifyValue(profile.signingPublic,terms,value.signature),'Account authorization failed.');
      let result=operation==='read'?store.get(n.accountId):store.put(n.accountId,value.expected,value.previous,value.archive);
      if(operation==='read'&&result?.revision===value.expected&&result.digest===value.previous){const {archive,...unchanged}=result;result=unchanged;}
      send(res,result?200:404,result??{error:'No saved account was found.'});
    }catch(e){send(res,e.code==='CONFLICT'?409:400,{error:e.code==='CONFLICT'?'A newer backup is already saved.':e.message,code:e.code??'ACCOUNT_REQUEST'});}
    finally{active--;}
    return true;
  };
}
