import test from 'node:test';import assert from 'node:assert/strict';
import {inspectLock} from './check-dependencies.mjs';
function lock(name,version,extra={}){return {lockfileVersion:3,packages:{'':{},['node_modules/'+name]:{version,resolved:'https://registry.npmjs.org/'+name+'/-/x.tgz',integrity:'sha512-fixture',...extra}}};}
for(const [name,version]of [['axios','1.14.1'],['axios','0.30.4'],['plain-crypto-js','4.2.0'],['easy-day-js','1.11.21'],['mastra','1.13.1'],['@mastra/core','1.0.0']])
  test('blocks or requires review: '+name+'@'+version,()=>assert(inspectLock(lock(name,version)).findings.length>0));
test('alias cannot hide known malicious package name',()=>assert(inspectLock(lock('innocent-alias','4.2.1',{name:'plain-crypto-js'})).findings.length>0));
test('records later Axios without claiming it is free of other flaws',()=>{const r=inspectLock(lock('axios','1.21.0'));assert.equal(r.findings.length,0);assert.equal(r.watched[0].version,'1.21.0');});
test('unreviewed tarball source fails',()=>assert(inspectLock(lock('example','1.0.0',{resolved:'https://example.invalid/x.tgz'})).findings.length>0));
test('missing integrity fails',()=>assert(inspectLock(lock('example','1.0.0',{integrity:undefined})).findings.length>0));
test('lifecycle script is recorded for review without execution',()=>assert.equal(inspectLock(lock('example','1.0.0',{hasInstallScript:true})).installScripts.length,1));
test('missing lock package inventory fails',()=>assert.throws(()=>inspectLock({lockfileVersion:1})));
