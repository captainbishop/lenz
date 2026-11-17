import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

const fail=(message,status=503)=>Object.assign(Error(message),{status});
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;

/** Reserves the sponsor allowance before dispatch; uncertain attempts retain their reservation. */
export function createReserveSponsor({directory,dailyLimit=12,now=Date.now}){
 if(typeof directory!=='string'||!directory||!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>1000)throw Error('Configure the reserve sponsor directory and daily limit.');
 const root=resolve(directory),file=join(root,'allowance.json'),lock=join(root,'allowance.lock'),marker=join(root,'initialized');
 return async function reserve(id,operation,contract,owner){
  await mkdir(root,{recursive:true});let held,temp;
  try{
   held=await open(lock,'wx',0o600);
   let ledger;try{const raw=await readFile(file,'utf8');if(raw.length>2_000_000)throw Error();ledger=JSON.parse(raw);}catch(error){if(error.code!=='ENOENT')throw fail('The saved testnet sponsor allowance cannot be verified.');try{await readFile(marker);throw fail('The original testnet sponsor allowance is missing. Restore its saved journal.');}catch(missing){if(missing.code!=='ENOENT')throw missing;}ledger={version:1,requests:{}};}
   if(!plain(ledger)||ledger.version!==1||!plain(ledger.requests)||Object.keys(ledger.requests).length>10000||Object.entries(ledger.requests).some(([key,row])=>!/^[a-f0-9]{64}$/.test(key)||!plain(row)||!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!['fund','settle','rhea-settle','rhea-submit','rhea-advance','rhea-recover'].includes(row.operation)||typeof row.contract!=='string'||(row.owner!==null&&typeof row.owner!=='string')))throw fail('The saved testnet sponsor allowance cannot be verified.');
   if(ledger.requests[id])throw fail('The original sponsored request has no verified outcome yet. Check its saved status before another attempt.',409);
   if(operation==='fund'&&Object.values(ledger.requests).some(row=>row.operation==='fund'&&row.contract===contract&&row.owner===owner))throw fail('This spending key already has an original funding request. Keep and check that request.',409);
   const day=new Date(now()).toISOString().slice(0,10);
   if(Object.values(ledger.requests).filter(row=>row.day===day).length>=dailyLimit)throw fail('The testnet service reached its daily limit. Your signed request stays saved. Try again tomorrow.',429);
   if(Object.keys(ledger.requests).length===10000)throw fail('The testnet sponsor journal needs review before more funding.');
   try{const initialized=await open(marker,'wx',0o600);try{await initialized.writeFile('lenz/near-reserve-sponsor/v1\n');await initialized.sync();}finally{await initialized.close();}}catch(error){if(error.code!=='EEXIST')throw error;}
   ledger.requests[id]={day,operation,contract,owner};temp=join(root,'allowance-'+randomBytes(12).toString('hex')+'.tmp');
   const saved=await open(temp,'wx',0o600);try{await saved.writeFile(JSON.stringify(ledger)+'\n');await saved.sync();}finally{await saved.close();}
   await rename(temp,file);temp=null;
  }catch(error){throw error.status?error:fail('The testnet sponsor allowance is unavailable. Your original request stays saved.');}
  finally{if(temp)await unlink(temp).catch(()=>{});if(held){await held.close();await unlink(lock);}}
 };
}
