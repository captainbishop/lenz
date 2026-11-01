// Static metadata inspection only; never imports or runs the packages being checked.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function inspectLock(lock) {
  if(!lock.packages || lock.lockfileVersion<2)throw Error('An npm v2+ lockfile is required');
  const findings=[],watched=[],installScripts=[];
  for(const [path,p] of Object.entries(lock.packages)){
    if(!path)continue;
    const name=p.name??path.split('node_modules/').at(-1);
    if(['plain-crypto-js','easy-day-js'].includes(name)||(name==='axios'&&['1.14.1','0.30.4'].includes(p.version)))
      findings.push({path,name,version:p.version,reason:'Matches a reported malicious package/version'});
    if(name==='mastra'||name.startsWith('@mastra/'))findings.push({path,name,version:p.version,reason:'Requires comparison with the full affected Mastra version list before use'});
    if(name==='axios')watched.push({path,name,version:p.version});
    if(p.hasInstallScript)installScripts.push({path,name,version:p.version});
    if(!p.link&&(!p.resolved?.startsWith('https://registry.npmjs.org/')||!/^sha(?:512|384|256|1)-/.test(p.integrity??'')))
      findings.push({path,name,version:p.version,reason:'Unreviewed source or missing integrity value'});
  }
  return {entries:Object.keys(lock.packages).length-1,findings,watched,installScripts};
}
async function lockfiles(root){
  // Include tracked files even if ignored; respect local exclusions for untracked files.
  const result=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--','package-lock.json','**/package-lock.json'],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.status!==0)throw Error('Cannot enumerate project lockfiles with Git');
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort().map(file=>join(root,file));
}
export async function checkDependencies(root){
  const results=[];
  for(const file of await lockfiles(root)){
    const lock=JSON.parse(await readFile(file,'utf8')),result=inspectLock(lock);
    const config=await readFile(join(file,'..','.npmrc'),'utf8');
    if(!/^ignore-scripts=true\s*$/m.test(config)||!/^save-exact=true\s*$/m.test(config))result.findings.push({reason:'Missing script-disable or exact-version project policy'});
    const manifest=JSON.parse(await readFile(join(file,'..','package.json'),'utf8'));
    for(const [name,version] of Object.entries({...manifest.dependencies,...manifest.devDependencies}))
      if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))result.findings.push({name,version,reason:'Direct dependency is not pinned'});
    // Detect version drift without executing package code. This is not a malware scan.
    for(const [path,p] of Object.entries(lock.packages)){
      if(!path||p.link)continue;
      try{const installed=JSON.parse(await readFile(join(file,'..',path,'package.json'),'utf8'));
        if(installed.version!==p.version)result.findings.push({path,reason:'Installed version differs from lockfile'});
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    results.push({file:relative(root,file).replaceAll('\\','/'),...result});
  }
  if(!results.length)throw Error('No lockfiles found');
  return {checkedAt:new Date().toISOString(),scope:'Project npm lockfiles and installed version metadata; no host forensic or package-code audit',results,passed:results.every(r=>r.findings.length===0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const result=await checkDependencies(root);
  await writeFile(new URL('./dependency-check.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
