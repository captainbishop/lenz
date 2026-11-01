const states=['address_found','account_found','not_found','no_address','offchain_required','unavailable','unverified'];
const chains={mainnet:1313161554,testnet:1313161555};
export function validateNameResult(value,request){
  const fail=()=>{throw Error('The lookup returned an invalid or mismatched result.');};
  if(!value || typeof value!=='object' || Array.isArray(value) || !request || !Object.hasOwn(chains,request.network) || !['ens','near'].includes(request.system))fail();
  if(value.version!==1 || value.system!==request.system || value.network!==request.network || value.requestedName!==request.name || value.chainId!==chains[request.network] || value.identityBinding!=='not_verified' || !states.includes(value.state))fail();
  if(typeof value.name!=='string' || value.name.length<1 || value.name.length>255)fail();
  const found=['address_found','account_found'].includes(value.state);
  if(found && (typeof value.auroraAddress!=='string' || !/^0x[0-9a-fA-F]{40}$/.test(value.auroraAddress) || /^0x0{40}$/.test(value.auroraAddress)))fail();
  if(!found && value.auroraAddress!==undefined)fail();
  if(!['unavailable','unverified'].includes(value.state)){
    if(value.authority!==(request.system==='ens'?'ethereum:mainnet':'near:'+request.network) || !value.block || typeof value.checkedAt!=='string' || !Number.isFinite(Date.parse(value.checkedAt)))fail();
    if(request.system==='ens'){
      if(!/^0x[0-9a-fA-F]{64}$/.test(value.block.hash) || typeof value.block.height!=='string' || !/^[1-9][0-9]*$/.test(value.block.height) || value.coinType!==String(BigInt(value.chainId)|0x80000000n))fail();
      if(value.state==='account_found' || (found && value.addressKind!=='ens-aurora-record'))fail();
    }else{
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.block.hash) || !Number.isSafeInteger(value.block.height) || value.block.height<1 || !['account_found','not_found'].includes(value.state))fail();
      if(found && (value.accountId!==request.name || value.name!==request.name || value.addressKind!=='derived-near-caller'))fail();
    }
  }
  return structuredClone(value);
}
export function changedNameAddress(previous,current){
  if(!previous?.auroraAddress || previous.system!==current.system || previous.network!==current.network || previous.name!==current.name)return false;
  return !current.auroraAddress || previous.auroraAddress.toLowerCase()!==current.auroraAddress.toLowerCase();
}
