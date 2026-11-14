// Compile the exact released circuit expressions into static JavaScript for Lenz's CSP.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
const require=createRequire(import.meta.url),{build,version}=require('./near-connector/node_modules/esbuild');
const tools=process.env.LENZ_TORNADO_TOOLS,artifactRoot=process.env.LENZ_TORNADO_ARTIFACTS;
if(!tools||!artifactRoot)throw Error('Set LENZ_TORNADO_TOOLS and LENZ_TORNADO_ARTIFACTS to the pinned v2.1 build inputs');
const deps=resolve(tools,'node_modules'),out=resolve(import.meta.dirname,'public/tornado-vendor');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins=JSON.parse(await readFile(resolve(import.meta.dirname,'tornado-prover-inputs.json'),'utf8'));
for(const [name,sha256]of Object.entries(pins.inputs))if(hash(await readFile(resolve(deps,name)))!==sha256)throw Error('Pinned Tornado dependency changed: '+name);
const expected={
 'withdraw.json':'3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98',
 'withdraw_proving_key.bin':'8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',
 'withdraw_verification_key.json':'3eedcf6ec6b5c24219ed19c7a33966fbfa6a03ae7c84124270589091e87cf8d3',
};
const artifacts={};let circuit;
for(const [name,sha256]of Object.entries(expected)){
 const bytes=await readFile(resolve(artifactRoot,name));if(hash(bytes)!==sha256)throw Error('Released Tornado artifact hash mismatch: '+name);
 artifacts[name]={bytes:bytes.length,sha256};if(name==='withdraw.json')circuit=JSON.parse(bytes);
}
const circuitPath=resolve(deps,'snarkjs/src/circuit.js'),grothPath=resolve(deps,'websnark/src/groth16.js');
let circuitSource=await readFile(circuitPath,'utf8'),grothSource=await readFile(grothPath,'utf8');
const toolsRequire=createRequire(resolve(tools,'package.json'));
const mimcConstants=toolsRequire('circomlib/src/mimcsponge').getConstants().map(value=>value.toString());
if(hash(JSON.stringify(mimcConstants))!==pins.mimcConstantsSha256)throw Error('Pinned MiMC constants changed');
const acorn=toolsRequire('acorn');
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('Pinned dependency layout changed; review browser adaptation');return source.replace(from,to);}
function generatorTemplate(source){
 const ast=acorn.parseExpressionAt(source,0,{ecmaVersion:2020}),changes=[];
 function walk(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='ctx'&&['setSignal','setPin'].includes(node.callee.property.name))changes.push({position:node.start,text:'(yield '},{position:node.end,text:')'});
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
 }
 walk(ast);changes.push({position:'function'.length,text:'*'});
 for(const change of changes.sort((a,b)=>b.position-a.position))source=source.slice(0,change.position)+change.text+source.slice(change.position);
 return source;
}
const templates='const staticTemplates={'+Object.entries(circuit.templates).map(([key,value])=>JSON.stringify(key)+':('+generatorTemplate(value)+')').join(',')+'};\n';
const functions='const staticFunctions={'+Object.entries(circuit.functions).map(([key,value])=>JSON.stringify(key)+':{params:'+JSON.stringify(value.params)+',func:('+value.func+')}').join(',')+'};\n';
circuitSource=replaceOnce(circuitSource,'module.exports = class Circuit {',templates+functions+'module.exports = class Circuit {');
circuitSource=replaceOnce(circuitSource,'this.templates[t] = eval(" const __f= " +circuitDef.templates[t] + "\\n__f");','this.templates[t] = staticTemplates[t];');
circuitSource=replaceOnce(circuitSource,'func: eval(" const __f= " +circuitDef.functions[f].func + "\\n__f;")','func: staticFunctions[f].func');
const threadStart=grothSource.indexOf('function thread(self) {'),threadEnd=grothSource.indexOf('// We use the Object.assign approach');
if(threadStart<0||threadEnd<threadStart)throw Error('Pinned websnark worker layout changed');
let thread=grothSource.slice(threadStart,threadEnd);
thread=replaceOnce(thread,'process.exit();','self.close();');
grothSource=replaceOnce(grothSource,'const inBrowser = (typeof window !== "undefined");','const inBrowser = true;');
grothSource=replaceOnce(grothSource,'let NodeWorker;\nlet NodeCrypto;\nif (!inBrowser) {\n    NodeWorker = require("worker_threads").Worker;\n    NodeCrypto = require("crypto");\n}','');
grothSource=grothSource.replaceAll('window.crypto.getRandomValues(rnd);','globalThis.crypto.getRandomValues(rnd);');
grothSource=replaceOnce(grothSource,'concurrency = navigator.hardwareConcurrency;','concurrency = Math.max(1, Math.min(2, navigator.hardwareConcurrency));');
grothSource=replaceOnce(grothSource,'concurrency = 8;','concurrency = 2;');
const blobStart='const blob = new Blob(["(", thread.toString(), ")(self);"], { type: "text/javascript" });\n            const url = URL.createObjectURL(blob);\n\n            groth16.workers[i] = new Worker(url);';
grothSource=replaceOnce(grothSource,blobStart,"groth16.workers[i] = new Worker(new URL('./groth16-thread.js', import.meta.url));\n            groth16.workers[i].onerror = groth16.workers[i].onmessageerror = () => groth16.terminate();");
grothSource=replaceOnce(grothSource,`        } else {
            groth16.workers[i] = new NodeWorker("(" + thread.toString()+ ")(require('worker_threads').parentPort);", {eval: true});

            groth16.workers[i].on("message", getOnMsg(i));
        }`,'        }');
grothSource=replaceOnce(grothSource,`        } else {
            const br = NodeCrypto.randomBytes(32);
            this.putBin(pr, br);
            const bs = NodeCrypto.randomBytes(32);
            this.putBin(ps, bs);
        }`,'        }');
grothSource=replaceOnce(grothSource,'module.exports = build;','export default build;');
grothSource=replaceOnce(grothSource,'terminate() {\n        for (let i=0; i<this.workers.length; i++) {\n            this.workers[i].postMessage({command: "TERMINATE"});\n        }\n    }',`terminate() {
        for (const worker of this.workers) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
        const error = new Error('Local Tornado worker stopped');
        for (let i=0; i<this.pendingDeferreds.length; i++) if (this.working[i]) this.pendingDeferreds[i]?.reject(error);
        for (const work of this.actionQueue) work.deferred.reject(error);
        this.actionQueue = [];
    }`);
const virtual={
 'snarkjs':`exports.bigInt=require(${JSON.stringify(resolve(deps,'snarkjs/src/bigint.js'))});const BN128=require(${JSON.stringify(resolve(deps,'snarkjs/src/bn128.js'))});exports.bn128=new BN128();`,
 'circomlib':`exports.mimcsponge=require(${JSON.stringify(resolve(deps,'circomlib/src/mimcsponge.js'))});`,
 'assert':"module.exports=function(condition){if(!condition)throw Error('Local Tornado worker invariant failed');};",
 'blake-hash':`const Blake256=require(${JSON.stringify(resolve(deps,'blake-hash/lib/blake256.js'))});module.exports=function(algorithm){if(algorithm!=='blake256')throw Error('Unsupported note hash');const engine=new Blake256();let finalized=false;return {update(data){if(finalized)throw Error('Digest already called');engine.update(Buffer.isBuffer(data)?data:Buffer.from(data));return this;},digest(){if(finalized)throw Error('Digest already called');finalized=true;return engine.digest();}};};`,
 'lenz-tornado-artifacts':'export const artifacts='+JSON.stringify(artifacts)+';',
 'lenz-tornado-globals':`import {Buffer} from ${JSON.stringify(resolve(deps,'buffer/index.js'))};export {Buffer};`,
};
const plugins=[{name:'pinned-tornado-browser',setup(builder){
 builder.onResolve({filter:/^(snarkjs|circomlib|assert|blake-hash|lenz-tornado-artifacts|lenz-tornado-globals)$/},args=>({path:args.path,namespace:'lenz-tornado'}));
 builder.onLoad({filter:/.*/,namespace:'lenz-tornado'},args=>({contents:virtual[args.path],loader:'js',resolveDir:deps}));
 builder.onLoad({filter:/[\\/]snarkjs[\\/]src[\\/]circuit\.js$/},()=>({contents:circuitSource,loader:'js',resolveDir:dirname(circuitPath)}));
 builder.onLoad({filter:/[\\/]websnark[\\/]src[\\/]groth16\.js$/},()=>({contents:grothSource,loader:'js',resolveDir:dirname(grothPath)}));
 builder.onLoad({filter:/[\\/]snarkjs[\\/]src[\\/]calculateWitness\.js$/},async args=>{
  let source=await readFile(args.path,'utf8');source=replaceOnce(source,'this.scopes = [];','this.scopes = [];\n        this.pendingFrames = [];\n        this.driving = false;');
  source=replaceOnce(source,`callComponents.map( (c) => {
            if (this.notInitSignals[c] == 0) this.triggerComponent(c);
        });`,'this.triggerComponents(callComponents);');
  const start=source.indexOf('    triggerComponent(c) {'),end=source.indexOf('    callFunction(functionName, params) {');
  if(start<0||end<start)throw Error('Pinned witness scheduler layout changed');
  const driver=`    triggerComponent(c) {
        this.pendingFrames.push({kind: 'component', id: c});
        this.driveFrames();
    }

    triggerComponents(components) {
        this.pendingFrames.push({kind: 'triggers', components, index: 0});
        this.driveFrames();
    }

    driveFrames() {
        if (this.driving) return;
        const oldComponent = this.currentComponent, oldScopes = this.scopes, frames = [];
        this.driving = true;
        try {
            while (frames.length || this.pendingFrames.length) {
                if (this.pendingFrames.length) {
                    frames.push(...this.pendingFrames.reverse());
                    this.pendingFrames = [];
                }
                const frame = frames[frames.length - 1];
                if (frame.kind === 'triggers') {
                    if (frame.index === frame.components.length) frames.pop();
                    else {
                        const c = frame.components[frame.index++];
                        if (this.notInitSignals[c] === 0) frames.push({kind: 'component', id: c});
                    }
                    continue;
                }
                if (frame.kind === 'component') {
                    this.notInitSignals[frame.id]--;
                    const component = this.circuit.components[frame.id], newScope = {};
                    for (const p in component.params) newScope[p] = component.params[p];
                    frames[frames.length - 1] = {kind: 'iterator', component: component.name, scopes: [this.scopes[0], newScope], iterator: this.circuit.templates[component.template](this), value: undefined};
                    continue;
                }
                this.currentComponent = frame.component;
                this.scopes = frame.scopes;
                const step = frame.iterator.next(frame.value);
                if (step.done) frames.pop(); else frame.value = step.value;
            }
        } finally {
            this.driving = false;
            this.currentComponent = oldComponent;
            this.scopes = oldScopes;
        }
    }

`;
  return {contents:source.slice(0,start)+driver+source.slice(end),loader:'js',resolveDir:dirname(args.path)};
 });
 builder.onLoad({filter:/[\\/]snarkjs[\\/]src[\\/]zqfield\.js$/},async args=>{
  const source=await readFile(args.path,'utf8'),start=source.indexOf('function getRandomByte() {'),end=source.indexOf('class ZqField {');
  if(start<0||end<start)throw Error('Pinned field entropy layout changed');
  return {contents:source.slice(0,start)+'function getRandomByte() { return globalThis.crypto.getRandomValues(new Uint8Array(1))[0]; }\n\n'+source.slice(end),loader:'js',resolveDir:dirname(args.path)};
 });
 builder.onLoad({filter:/[\\/]circomlib[\\/]src[\\/]mimcsponge\.js$/},async args=>{
  let source=await readFile(args.path,'utf8');source=replaceOnce(source,'const Web3Utils = require("web3-utils");','');
  const start=source.indexOf('exports.getIV ='),end=source.indexOf('exports.hash =');
  if(start<0||end<start)throw Error('Pinned MiMC constants layout changed');
  return {contents:source.slice(0,start)+'const cts='+JSON.stringify(mimcConstants)+'.map(bigInt);\n\n'+source.slice(end),loader:'js',resolveDir:dirname(args.path)};
 });
}}];
const result=await build({entryPoints:[resolve(import.meta.dirname,'tornado-prover-worker.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',metafile:true,write:false,nodePaths:[deps],inject:['lenz-tornado-globals'],plugins});
let diagnosticLocations=0;
const runtime=Buffer.from(Buffer.from(result.outputFiles[0].contents).toString('utf8').replace(/"[/][^"]+[/]tornado-core[/]([^"]+[.]circom:[0-9]+:[0-9]+)"/g,(_match,location)=>{
 diagnosticLocations+=1;
 return JSON.stringify('tornado-core/'+location);
}));
if(diagnosticLocations!==13)throw Error('Released circuit diagnostic locations changed; review the publication build');
if(/\beval\s*\(|\bnew\s+Function\s*\(|worker_threads/.test(Buffer.from(runtime).toString()))throw Error('Runtime contains a JavaScript evaluation or Node worker path');
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'prover-worker.js'),runtime);await writeFile(resolve(out,'groth16-thread.js'),thread+'\nthread(self);\n');
await writeFile(resolve(out,'artifacts.json'),JSON.stringify(artifacts,null,2)+'\n');
await writeFile(resolve(out,'COPYING.txt'),await readFile(resolve(deps,'websnark/COPYING')));
await writeFile(resolve(out,'NOTICE.txt'),'Tornado v2.1 browser witness/proof runtime. snarkjs 0.1.20 and websnark (GPL-3.0-or-later); circomlib and fixed-merkle-tree (GPL-3.0). Source is reproducibly built by web/build-tornado-prover.mjs from the pinned dependency revisions. The released proving artifacts are fetched only on demand and are not bundled here. See COPYING.txt and dependency-LICENSES.txt.\n');
const inputs={},licenses=[],packages=new Set();
for(const input of Object.keys(result.metafile.inputs)){
 if(input.startsWith('lenz-tornado:'))continue;
 const absolute=resolve(input);let name=relative(deps,absolute).replaceAll('\\','/');if(name.startsWith('../'))name=relative(import.meta.dirname,absolute).replaceAll('\\','/');
 inputs[name]=hash(await readFile(absolute));
 let directory=dirname(absolute);
 while(directory!==dirname(directory)){
  try{const pkg=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));
   if(!packages.has(directory)){packages.add(directory);let text='';for(const filename of ['LICENSE','LICENSE.md','LICENSE.txt','COPYING'])try{text=await readFile(resolve(directory,filename),'utf8');break;}catch{}
    licenses.push(pkg.name+' '+pkg.version+' ('+pkg.license+')\n'+(text||'License notice retained in bundled source.')+'\n');}
   break;
  }catch{}directory=dirname(directory);
 }
}
await writeFile(resolve(out,'dependency-LICENSES.txt'),licenses.join('\n'));
await writeFile(resolve(import.meta.dirname,'tornado-prover-build.json'),JSON.stringify({esbuild:version,acorn:acorn.version,witnessScheduling:'Static generators preserve synchronous child-trigger order through an explicit stack',dependencies:{snarkjs:'869181cfaf7526fe8972073d31655493a04326d5',circomlib:'c372f14d324d57339c88451834bf2824e73bbdbc',websnark:'4c0af6a8b65aabea3c09f377f63c44e7a58afa6d',fixedMerkleTree:'0.6.0'},artifacts,inputs,outputs:{'prover-worker.js':hash(runtime),'groth16-thread.js':hash(thread+'\nthread(self);\n')}},null,2)+'\n');
console.log('Built genuine Tornado browser prover: '+runtime.length+' bytes; '+Object.keys(circuit.templates).length+' static templates; proving artifacts remain outside the bundle.');
