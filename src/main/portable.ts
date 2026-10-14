import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import type {Database} from 'sql.js';
import type {BackupPreflight,BackupResult} from '../shared/backup.js';
export const digest=(b:Uint8Array)=>crypto.createHash('sha256').update(b).digest('hex');
export function atomicWrite(file:string,bytes:Uint8Array){
 const temporary=`${file}.${crypto.randomUUID()}.tmp`;let fd:number|undefined;
 try{fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
export function portablePath(value:string){
 if(typeof value!=='string')throw Error('Unsafe archive path.');
 const normalized=value.replace(/\\/g,'/').normalize('NFC');
 if(!normalized||normalized.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error(`Unsafe archive path: ${value}`);
 return normalized;
}
export function dbRows(db:Database,sql:string):any[]{const s=db.prepare(sql),out:any[]=[];try{while(s.step())out.push(s.getAsObject());return out;}finally{s.free();}}
export function backupPreflight(db:Database,root:string):BackupPreflight{
 const result:BackupPreflight={included:[],convertedLinks:[],missing:[],changed:[]};
 for(const item of dbRows(db,'SELECT * FROM items')){const file=item.storage_mode==='copy'?path.join(root,portablePath(item.relative_path)):item.linked_path;try{const bytes=fs.readFileSync(file);result.included.push(item.id);if(digest(bytes)!==item.checksum)result.changed.push(item.id);if(item.storage_mode!=='copy')result.convertedLinks.push(item.id);}catch{result.missing.push(item.id);}}
 return result;
}
export async function writeBackup(db:Database,root:string,target:string):Promise<BackupResult>{
 const resolved=path.resolve(target);if(resolved===path.resolve(root)||resolved===path.resolve(root,'workspace.sqlite')||resolved.startsWith(path.resolve(root,'files')+path.sep)||dbRows(db,'SELECT * FROM items').some(i=>i.linked_path&&path.resolve(i.linked_path)===resolved))throw Error('A backup cannot overwrite workspace data or source files.');
 const result=backupPreflight(db,root);if(result.missing.length||result.changed.length)throw Error(`Backup blocked: ${result.missing.length} missing and ${result.changed.length} changed source files. Relink or review changed files first. IDs: ${[...result.missing,...result.changed].join(', ')}`);
 const zip=new JSZip(),files:Array<{path:string;sha256:string;size:number}>=[],names=new Set<string>();
 const add=(name:string,bytes:Buffer)=>{name=portablePath(name);const key=name.toLowerCase();if(names.has(key))throw Error(`Portable filename collision: ${name}`);names.add(key);zip.file(name,bytes);files.push({path:name,sha256:digest(bytes),size:bytes.length});};
 const provenance:Array<{id:string;originalPath:string}>=[];
 // The caller supplies an isolated SQLite snapshot. All reads happen before the first await.
 for(const item of dbRows(db,'SELECT * FROM items')){
  if(item.storage_mode==='copy'){const name=portablePath(item.relative_path);db.run('UPDATE items SET relative_path=? WHERE id=?',[name,item.id]);}
  else{const bytes=fs.readFileSync(item.linked_path);if(digest(bytes)!==item.checksum)throw Error('Source changed during backup.');const name=`files/${item.id}-${path.basename(item.linked_path).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'_')}`;add(name,bytes);provenance.push({id:item.id,originalPath:item.linked_path});db.run("UPDATE items SET storage_mode='copy',relative_path=?,linked_path=NULL WHERE id=?",[name,item.id]);}
 }
 const visit=(dir:string,prefix:string)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Managed files must not be symbolic links.');const file=path.join(dir,entry.name),name=`${prefix}/${entry.name}`;if(entry.isDirectory())visit(file,name);else if(entry.isFile())add(name,fs.readFileSync(file));}};
 if(fs.existsSync(path.join(root,'files')))visit(path.join(root,'files'),'files');
 for(const item of dbRows(db,'SELECT * FROM items')){if(!files.some(f=>f.path===item.relative_path&&f.sha256===item.checksum))throw Error(`Source changed or missing during backup: ${item.id}`);}
 if(provenance.length)db.run("INSERT INTO history VALUES (?,?,?,?,?,?,?)",[crypto.randomUUID(),'portable-copy','workspace','backup',JSON.stringify(provenance),null,new Date().toISOString()]);
 add('workspace.sqlite',Buffer.from(db.export()));zip.file('manifest.json',JSON.stringify({format:'research-desk-workspace',version:1,exportedAt:new Date().toISOString(),files,convertedLinks:provenance}));
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});atomicWrite(target,bytes);return {...result,path:target,sha256:digest(bytes)};
}
export async function readBackup(archive:string){
 const zip=await JSZip.loadAsync(fs.readFileSync(archive)),manifestEntry=zip.file('manifest.json');if(!manifestEntry)throw Error('Archive has no manifest.');const manifest=JSON.parse(await manifestEntry.async('string'));
 if(manifest.format!=='research-desk-workspace'||manifest.version!==1||!Array.isArray(manifest.files))throw Error('Unsupported workspace archive version.');
 const entries=new Map<string,Buffer>(),names=new Set<string>();
 for(const entry of manifest.files){const name=portablePath(entry.path);if(name!=='workspace.sqlite'&&!name.startsWith('files/'))throw Error('Unexpected archive payload.');if(names.has(name.toLowerCase()))throw Error('Portable filename collision.');names.add(name.toLowerCase());const file=zip.file(entry.path)||zip.file(name);if(!file)throw Error(`Archive is missing ${name}.`);const bytes=await file.async('nodebuffer');if(bytes.length!==entry.size||digest(bytes)!==entry.sha256)throw Error(`Integrity check failed for ${name}.`);entries.set(name,bytes);}
 if(!entries.has('workspace.sqlite'))throw Error('Archive has no workspace database.');
 return {manifest,entries};
}
