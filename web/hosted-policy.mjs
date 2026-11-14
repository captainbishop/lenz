const routes=new Map();
function add(prefix,names,{method='POST',maxBytes=65536,privileged=true,stream=false,async=false}={}){
 for(const name of names)routes.set(prefix+name,Object.freeze({method,maxBytes,privileged,stream,async}));
}
add('/api/markets/',['read','quote','tape','price','oracles','hyper-catalog','hyper-tape','predictions','context','indices','assets','lending'],{maxBytes:4096,privileged:false});
add('/api/markets/',['stream','hyper-stream'],{maxBytes:256,privileged:false,stream:true});
add('/api/degen/',['read','quote','preflight'],{maxBytes:8192,privileged:false});
add('/api/tokens/',['read','discover','metadata'],{maxBytes:512,privileged:false});
add('/api/names/',['resolve'],{maxBytes:2048,privileged:false});
add('/api/receive/',['assets'],{method:'GET',maxBytes:0,privileged:false});
add('/api/testnet/',['status'],{method:'GET',maxBytes:0,privileged:false});
add('/api/testnet/',['fund','settle','check'],{maxBytes:50000});
add('/api/defi/',['rhea/status','rhea/refund-status','rhea/quote','intents/quote','intents/tokens']);
add('/api/rhea/',['submit','advance','order','recover','return','deposit-check'],{maxBytes:50000});
add('/api/intent-near/',['config','status','prepare','prepare-funds','add-funds','reconcile-funds','submit','reconcile']);
add('/api/intent-aurora/',['config','snapshot'],{maxBytes:4096});
add('/api/intent-aurora-funds/',['config','prepare','submit','reconcile','resume','cleanup'],{maxBytes:16384});
add('/api/intent-aurora-swap/',['config','prepare','submit','reconcile','recover'],{maxBytes:16384});
add('/api/intents/lending/',['config','prepare','submit','reconcile','resume','setup','setup-status','supply/config','supply/prepare','supply/submit','supply/reconcile','supply/recover','supply/resume','funding/config','funding/submit','funding/reconcile','funding/resume','repayment-funding/config','repayment-funding/submit','repayment-funding/reconcile','repayment-funding/resume'],{maxBytes:32768});
add('/api/intents/lending/',['snapshot','supply/snapshot'],{maxBytes:4096});
add('/api/intent-zcash/',['config','status']);
add('/api/intent-zcash/',['prepare','authorize','submit','reconcile','recover-authorization'],{async:true});
add('/api/hyperliquid-testnet/funding',[''],{method:'GET',maxBytes:0});
add('/api/hyperliquid-testnet/funding/',['request','recover'],{maxBytes:1024});
add('/api/zcash/',['status','refresh','review','review-status','review-discard','review-check','review-effects','review-memos','review-memo-confirm'],{maxBytes:256});
add('/api/private-spend/',['prepare','fund-prepare','fund-status','swap-prepare'],{maxBytes:70000});
add('/api/private-executor/',['config','submit','status']);
add('/api/accounts/',['challenge','read','write'],{maxBytes:4_000_000,privileged:false});
add('/api/ai/',['status'],{method:'GET',maxBytes:0});
add('/api/ai/',['challenge','chat'],{maxBytes:100000});
const artifacts=new Set(['withdraw.json','withdraw_proving_key.bin','withdraw_verification_key.json']);

export function publicOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||['localhost','127.0.0.1'].includes(url.hostname))throw Error('Choose the exact public HTTPS Lenz origin.');
 return url.origin;
}

/** Removes Vercel's routing fields before checking the requested action. */
export function hostedIncomingPath(raw){
 const incoming=new URL(raw,'https://placeholder.invalid'),paths=incoming.searchParams.getAll('__lenz_path');
 if(paths.length!==1)return null;
 incoming.searchParams.delete('__lenz_path');
 // Vercel appends the catch-all route parameter to the rewritten query.
 incoming.searchParams.delete('path');
 return paths[0]+incoming.search;
}

/** Matches only supported API paths; callers cannot choose a proxy destination. */
export function hostedRoute(raw,method){
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//')||/[\\\s#]/.test(raw)||/%(?:2f|5c|2e|00)/i.test(raw.split('?')[0]))return null;
 const url=new URL(raw,'https://lenz.invalid');
 if(url.pathname!==raw.split('?')[0])return null;
 let policy=routes.get(url.pathname);
 if(!policy&&url.pathname==='/api/asset-image'&&url.searchParams.size===1&&url.searchParams.has('url'))policy={method:'GET',maxBytes:0,privileged:false};
 else if(!policy&&url.pathname==='/api/markets/prediction-image'&&url.searchParams.size===1&&(url.searchParams.has('url')||url.searchParams.has('event')))policy={method:'GET',maxBytes:0,privileged:false};
 else if(!policy&&url.pathname.startsWith('/api/intent-testnet/private-pool/artifacts/')&&artifacts.has(url.pathname.split('/').at(-1)))policy={method:'GET',maxBytes:0,privileged:false,stream:true,artifact:true};
 else if(!policy&&/^\/api\/hosted\/jobs\/[a-f0-9]{64}$/.test(url.pathname))policy={method:'GET',maxBytes:0,privileged:true,job:true};
 if(!policy||(url.search&&!['/api/asset-image','/api/markets/prediction-image'].includes(url.pathname)))return null;
 if(method!==policy.method&&!(method==='HEAD'&&policy.method==='GET'))return null;
 return {...policy,path:url.pathname,raw:url.pathname+url.search};
}

export async function readHostedBody(request,maxBytes){
 const declared=request.headers['content-length'];
 if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw Object.assign(Error('This hosted request exceeds its size limit.'),{status:413});
 let bytes=0;const chunks=[];
 for await(const chunk of request){bytes+=chunk.length;if(bytes>maxBytes)throw Object.assign(Error('This hosted request exceeds its size limit.'),{status:413});chunks.push(chunk);}
 return Buffer.concat(chunks);
}
