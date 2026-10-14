import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';
const [executable,mode='local',outputArg]=process.argv.slice(2);if(!executable)throw Error('Usage: node scripts/readiness.mjs <packaged executable> [local|exchange] [output directory]');
const output=path.resolve(outputArg||fs.mkdtempSync(path.join(os.tmpdir(),'research-desk-readiness-')));fs.mkdirSync(output,{recursive:true});
async function run(root,phase,kill=false){
 const env={...process.env,RESEARCH_DESK_READINESS_ROOT:root,RESEARCH_DESK_READINESS_PHASE:phase};delete env.VITE_DEV_SERVER_URL;delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.resolve(executable),[],{cwd:os.tmpdir(),env,stdio:['ignore','pipe','pipe']});const log=fs.createWriteStream(path.join(output,`${path.basename(root)}-${phase}.log`));child.stdout.pipe(log);child.stderr.pipe(log);let killed=false;
 const timer=setTimeout(()=>{child.kill('SIGKILL');},180000);
 const poll=kill?setInterval(()=>{if(fs.existsSync(path.join(root,'crash-ready'))){killed=true;child.kill('SIGKILL');}},100):undefined;
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code)=>{clearTimeout(timer);clearInterval(poll);log.end();if((kill&&killed)||code===0)resolve();else reject(Error(`${phase} failed (${code}). ${fs.existsSync(path.join(root,'failure.txt'))?fs.readFileSync(path.join(root,'failure.txt'),'utf8'): 'Inspect '+output}`));});});
}
const target=path.join(output,'restored');
if(mode==='local'){
 const fresh=path.join(output,'fresh');await run(fresh,'create');fs.mkdirSync(target);for(const f of ['readiness-marker','baseline.json','exchange.researchdesk'])fs.copyFileSync(path.join(fresh,f),path.join(target,f));
}else if(mode==='exchange'){
 fs.mkdirSync(target);for(const f of ['readiness-marker','baseline.json','exchange.researchdesk'])fs.copyFileSync(path.join(output,f),path.join(target,f));
}else throw Error('Unknown mode');
await run(target,'restore');await run(target,'crash',true);await run(target,'recover');
for(const [from,to] of [['roundtrip.researchdesk','exchange.researchdesk'],['baseline.json','baseline.json'],['readiness-marker','readiness-marker']])fs.copyFileSync(path.join(target,from),path.join(output,to));
console.log(`Packaged readiness checks passed. Results: ${output}`);
