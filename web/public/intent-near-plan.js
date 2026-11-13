import {base58,base64} from './intents-vendor/codecs.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
export const NEAR_INTENT_DEPLOYMENT=Object.freeze({network:'testnet',chainId:'near:testnet',rpc:'https://test.rpc.fastnear.com',verifier:'verifierif13a.lenz-dev-1794582631653.testnet',source:'sourceif13a.lenz-dev-1794582631653.testnet',target:'targetif13a.lenz-dev-1794582631653.testnet',sourceRevision:'16d04f6ec4401263f8914638710260da50bb46b0',verifierSha256:'9c385736268b5240e8000169401b1d700393367cc5de74e3a9b627624b4005db',tokenSha256:'bcac83483ad6d8bbec302060a8ceac6bd83151cb3c8ed1ce17685bb59a87636d'});
export const nearAccount=value=>typeof value==='string'&&value.length<=64&&(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value)||/^[0-9a-f]{64}$/.test(value));
const quantity=value=>typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value)&&BigInt(value)<(1n<<127n);
export function implicitNearOwner(publicKey){check(typeof publicKey==='string'&&publicKey.startsWith('ed25519:'),'Choose an Ed25519 NEAR key.');const raw=base58.decode(publicKey.slice(8));check(raw.length===32&&base58.encode(raw)===publicKey.slice(8),'Invalid NEAR public key.');return Array.from(raw,byte=>byte.toString(16).padStart(2,'0')).join('');}
export function checkNearSelection(selection,{now=Date.now(),allowExpired=false}={}){
 const c=NEAR_INTENT_DEPLOYMENT,s=selection?.source,d=selection?.destination;
 check(selection?.action==='swap'&&selection.privacy==='public','This NEAR testnet swap is public on-chain.');
 check(s?.chainId===c.chainId&&d?.chainId===c.chainId&&s.asset==='nep141:'+c.source&&d.asset==='nep141:'+c.target,'Choose LTS to LTT on NEAR testnet.');
 check(/^[0-9a-f]{64}$/.test(s.accountId)&&!/^0{64}$/.test(s.accountId)&&nearAccount(d.accountId),'Choose the original NEAR source and result account.');
 check(quantity(s.amount)&&BigInt(s.amount)<=1000000n&&quantity(d.minAmount)&&BigInt(d.minAmount)<=BigInt(s.amount)*2n,'This route accepts at most 1 LTS and quotes 2 LTT per LTS.');
 check(Number.isSafeInteger(selection.deadline)&&selection.deadline>0&&(allowExpired||selection.deadline>now&&selection.deadline<=now+600000),'Review a deadline within ten minutes.');
 return structuredClone(selection);
}
function nonce(salt,deadline,random){check(/^[0-9a-f]{8}$/.test(salt),'The verifier salt is invalid.');const bytes=base64.decode(random);check(bytes.length===15&&bytes.some(Boolean)&&base64.encode(bytes)===random,'Invalid signing nonce.');const result=new Uint8Array(32);result.set([86,40,246,198,0]);result.set(salt.match(/../g).map(value=>parseInt(value,16)),5);new DataView(result.buffer).setBigInt64(9,BigInt(deadline)*1000000n,true);result.set(bytes,17);return base64.encode(result);}
export function buildNearReview(selection,{salt,userRandom,solverRandom,withdrawRandom,solverId},{now=Date.now(),allowExpired=false}={}){
 const chosen=checkNearSelection(selection,{now,allowExpired}),c=NEAR_INTENT_DEPLOYMENT;
 check(/^[0-9a-f]{64}$/.test(solverId)&&solverId!==chosen.source.accountId&&new Set([userRandom,solverRandom,withdrawRandom]).size===3,'Swap participants and nonces must differ.');
 const input=chosen.source.amount,output=(BigInt(input)*2n).toString(),deadline=new Date(chosen.deadline).toISOString(),tokenIn='nep141:'+c.source,tokenOut='nep141:'+c.target;
 const payload=(signer,intents,random)=>({message:JSON.stringify({signer_id:signer,deadline,intents}),nonce:nonce(salt,chosen.deadline,random),recipient:c.verifier});
 const userSwap=payload(chosen.source.accountId,[{intent:'token_diff',diff:{[tokenIn]:'-'+input,[tokenOut]:output}}],userRandom);
 const solverSwap=payload(solverId,[{intent:'token_diff',diff:{[tokenIn]:input,[tokenOut]:'-'+output}}],solverRandom);
 const withdrawal=payload(chosen.source.accountId,[{intent:'ft_withdraw',token:c.target,receiver_id:chosen.destination.accountId,amount:output}],withdrawRandom);
 return {id:'near:'+userSwap.nonce,routeId:'near-intents-testnet',...chosen,quote:{input,output,rate:'2',decimals:6},fees:[{label:'Protocol fee',amount:'0',asset:tokenIn},{label:'Relayer gas paid by testnet service',amount:'0',asset:'near:testnet'}],sourceRevision:c.sourceRevision,configHash:c.verifierSha256,authorityId:c.verifier+':'+chosen.source.accountId+':'+userSwap.nonce,privacyDisclosure:'Public NEAR testnet balances, signatures, source account and destination. LTS and LTT are owner-issued test assets.',recoveryDisclosure:'A lost response keeps the original signed request. Check its status before creating another request. Failed external withdrawal may leave LTT in your Intents account.',authorization:{standard:'NEP-413',label:'Confirm swap',payloads:[userSwap,withdrawal]},solverPayload:solverSwap,nonceTerms:{salt,userRandom,solverRandom,withdrawRandom,solverId}};
}
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
export const sameNearValue=(left,right)=>JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
export function checkNearReview(review,chosen=review,options={}){const expected=buildNearReview(chosen,review?.nonceTerms,options);check(sameNearValue(review,expected),'The NEAR route changed the reviewed terms.');return expected;}
export function nearAuthorizationId(signed){check(Array.isArray(signed)&&signed.length===2,'Both exact user signatures are required.');return 'near:'+signed.map(item=>item.signature?.slice(8)).join(':');}
export function checkNearAuthorization(authorization,review){
 checkNearReview(review,review,{allowExpired:true});
 check(authorization?.intentId===review.id&&Array.isArray(authorization.signed)&&authorization.signed.length===2&&authorization.artifactId===nearAuthorizationId(authorization.signed),'The signed request changed.');
 authorization.signed.forEach((item,index)=>{check(sameNearValue(Object.keys(item).sort(),['payload','public_key','signature','standard'])&&item.standard==='nep413'&&sameNearValue(item.payload,review.authorization.payloads[index])&&implicitNearOwner(item.public_key)===review.source.accountId&&typeof item.signature==='string'&&item.signature.startsWith('ed25519:'),'The wallet signed different NEAR terms.');const bytes=base58.decode(item.signature.slice(8));check(bytes.length===64&&base58.encode(bytes)===item.signature.slice(8),'Invalid NEAR signature encoding.');});
 return structuredClone(authorization);
}
export function buildNearFundingReview(owner,{nonce,deadline,solverId,destination=owner},{now=Date.now(),allowExpired=false}={}){
 check(/^[0-9a-f]{64}$/.test(owner)&&nearAccount(destination)&&/^[0-9a-f]{64}$/.test(solverId)&&owner!==solverId,'Choose the original source and destination.');
 const raw=base64.decode(nonce);check(raw.length===32&&base64.encode(raw)===nonce&&raw.some(Boolean),'Invalid test grant nonce.');
 check(Number.isSafeInteger(deadline)&&(allowExpired||deadline>now&&deadline<=now+300000),'The test funding review expired.');
 const c=NEAR_INTENT_DEPLOYMENT,terms={domain:'lenz/near-test-funds/v1',network:'testnet',owner,sourceToken:c.source,sourceAmount:'1000000',solverId,solverToken:c.target,solverAmount:'2000000',verifier:c.verifier,destination,deadline};
 return {id:'grant:'+nonce,...terms,label:'Add 1 LTS test funds',disclosure:'Mint 1 LTS test asset into your Intents account and fund the solver with 2 LTT test assets. The service pays testNEAR gas and registration. This creates no spending authority.',payload:{message:JSON.stringify(terms),nonce,recipient:c.verifier}};
}
