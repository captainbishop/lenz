import { updateState } from './chat-store.js';
import { assert, keysAre, digest } from './peer-crypto.js';
import { readNearVault, saveNearVault } from './near-protocol.js';
import { defiHandoff } from './defi-wallet.js';
import { CARRIER_DOMAIN, carrierConfig, carrierPost } from './carrier-protocol.js';

// Explicit, bounded delivery only. A carrier acknowledgement conveys no execution.
export async function sendDefiRequest(config,requestId,delivery,{post=carrierPost}={}) {
  const c=structuredClone(config),origins=carrierConfig(structuredClone(delivery));
  assert(origins.length>0,'No carriers are configured');
  let stored=0;
  for(const origin of origins) {
    // Recheck persisted consent, expiry and conflicts before each network call.
    const envelope=await defiHandoff(c,requestId,{envelope:true,carrier:true});
    const ack=await post(origin,'/v1/store',envelope,{limit:1024});
    assert(keysAre(ack,['type','id','status','expiresAt']) && ack.type===CARRIER_DOMAIN && ack.id===envelope.id
      && ack.status==='stored' && ack.expiresAt===envelope.expiresAt,'Invalid carrier storage response');
    await updateState(async state=>{
      const vault=await readNearVault(state,c.reserve),order=(vault.rheaOrders??[]).find(o=>o.defi?.request.id===requestId);
      assert(order?.defi?.envelope && await digest(order.defi.envelope)===await digest(envelope),'Saved delivery changed');
      order.defi.storedBy??=[];
      if(!order.defi.storedBy.includes(origin))order.defi.storedBy.push(origin);
      await saveNearVault(state,vault);
    });
    stored++;
  }
  return {state:'carrier-stored',carriers:stored};
}
