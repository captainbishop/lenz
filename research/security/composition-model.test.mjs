// Executable design counterexamples, NOT a deployed lending engine or a contract audit.
import test from 'node:test';import assert from 'node:assert/strict';

// Units are fixed-price illustrative dollars; no oracle, fees or liquidity simulation.
const badDebt=(debt,liquidatableCollateral)=>debt>liquidatableCollateral?debt-liquidatableCollateral:0n;
test('freezing an address, freezing a market, and freezing pooled collateral have different losses',()=>{
  const collateral=60_000_000n,debt=44_600_000n;
  assert.equal(badDebt(debt,collateral),0n); // Market freeze alone does not destroy collateral.
  assert.equal(badDebt(debt,0n),debt); // Hypothetical custodian freeze blocks all liquidation.
  // A pause after the borrow does not return the ETH already delivered.
  const attackerEthValue=debt;assert.equal(attackerEthValue,debt);
});
test('a correct par-price feed does not prove bridge backing or redemption',()=>{
  const nominal=100n,borrow=75n,actualBacking=20n;
  assert(nominal>=borrow);assert.equal(badDebt(borrow,actualBacking),55n);
});
test('reserve exposure must aggregate sibling routes before either asynchronous payout',()=>{
  const reserve=100n;
  for(let first=0n;first<=reserve;first++)for(let second=0n;second<=reserve;second++){
    const naive=first<=reserve&&second<=reserve;
    const reserved=first<=reserve&&second<=reserve-first;
    if(reserved)assert(first+second<=reserve);
    if(first===75n&&second===75n){assert(naive);assert(!reserved);}
  }
});
test('per-wallet limits do not bound losses accepted by disconnected recipients',()=>{
  const escrow=100n,copies=10n,acceptedClaims=copies*escrow;
  assert.equal(acceptedClaims-escrow,900n);
  // Canonical payout may be bounded, but recipients' locally accepted claims are not.
  assert(escrow<acceptedClaims);
});
test('expiry and a network timeout cannot prove a previously signed payout did not happen',()=>{
  const worlds=[{delivered:true,reply:false},{delivered:false,reply:false}];
  assert.equal(worlds[0].reply,worlds[1].reply);
  assert.notEqual(worlds[0].delivered,worlds[1].delivered);
  for(const world of worlds){const locallyTimedOut=true;const safelyReleased=locallyTimedOut&&world.reply;assert.equal(safelyReleased,false);}
});
test('blocking only one asset leaves a swap-then-supply path when another entry route stays open',()=>{
  const routes=[{asset:'stolen-USDT',frozen:true},{asset:'WETH',frozen:false}];
  assert(routes.some(r=>!r.frozen));
  const contained=routes.map(r=>({...r,frozen:true}));assert(contained.every(r=>r.frozen));
  // This models admission containment, not clawback or a reason to block repayments.
});
