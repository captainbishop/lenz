import {createAuroraIntentReader} from './intent-aurora-read.mjs';
import {createAuroraFundingService,emptyAuroraFundingJournal} from './intent-aurora-funding.mjs';
import {openAuroraPrivateJournal,openAuroraSponsorRuntime} from './intent-aurora-sponsor-live.mjs';

export async function openAuroraFundingService({stateDir,deployerKeyFile,operatorId,engineCodeHash,maxGrants=5,fetchImpl=fetch}={}){
 const journal=await openAuroraPrivateJournal({stateDir,fileName:'funding-state.json',initial:emptyAuroraFundingJournal});let runtime;
 try{
  runtime=await openAuroraSponsorRuntime({deployerKeyFile,operatorId,engineCodeHash});const reader=createAuroraIntentReader({fetchImpl});
  const rpc={snapshot:selection=>reader.snapshot(selection),operatorState:runtime.operatorState,send:runtime.send,transaction:runtime.transaction,settle:runtime.settle};
  const service=createAuroraFundingService({rpc,signer:runtime,journal,operatorId,operatorAddress:runtime.operatorAddress,maxGrants,serialize:runtime.serialize});let closed=false;
  return Object.freeze({...service,async close(){if(closed)return;closed=true;await runtime.close();await journal.close();}});
 }catch(error){await runtime?.close();await journal.close();throw error;}
}
