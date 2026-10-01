import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs, { Database } from 'sql.js';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import type { AppState, CheckResult, ClaimLink, ClaimRecord, EvidenceRecord, ImportMode, ImportResult, ItemKind, LibraryItem, TaskRecord, WorkspaceInfo } from '../shared/types.js';

const SCHEMA_VERSION = 1;
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
let sqlPromise: ReturnType<typeof initSqlJs> | undefined;
const getSql = () => sqlPromise ??= initSqlJs({ locateFile: () => wasmPath });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = (data: Uint8Array | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'untitled';

const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,kind TEXT,title TEXT,file_name TEXT,media_type TEXT,storage_mode TEXT,relative_path TEXT,linked_path TEXT,checksum TEXT,size INTEGER,status TEXT,batch_id TEXT,extracted_text TEXT,extraction_status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,label TEXT,state TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,title TEXT,source_id TEXT,locator TEXT,quotation TEXT,interpretation TEXT,limitations TEXT,verification_status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,wording TEXT,assessment TEXT,reasoning TEXT,uncertainties TEXT,manuscript_location TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS claim_links(id TEXT PRIMARY KEY,claim_id TEXT,evidence_id TEXT,relationship TEXT,dependency_group TEXT);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,why TEXT,impact TEXT,sources TEXT,blocker TEXT,completion TEXT,status TEXT,position INTEGER);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,context_json TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,action TEXT,record_type TEXT,record_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_checksum ON items(checksum);
`;

function rows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql); stmt.bind(params as any[]); const output: T[] = [];
  while (stmt.step()) output.push(stmt.getAsObject() as T); stmt.free(); return output;
}
function run(db: Database, sql: string, params: unknown[] = []) { db.run(sql, params as any[]); }
function mime(file: string) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.md':'text/markdown','.txt':'text/plain' } as Record<string,string>)[ext] ?? 'application/octet-stream';
}
function kindFor(file: string): ItemKind { const ext = path.extname(file).toLowerCase(); return ['.png','.jpg','.jpeg','.gif','.webp'].includes(ext) ? 'image' : ['.md','.txt','.docx'].includes(ext) ? 'manuscript' : 'source'; }

export class WorkspaceStore {
  db: Database | null = null;
  root: string | null = null;
  info: WorkspaceInfo | null = null;

  async create(root: string, name: string) {
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(path.join(root, 'files'), { recursive: true });
    this.root = root; this.db = new (await getSql()).Database(); this.db.run(schema);
    this.info = { id: id(), name: name.trim() || 'Untitled research', path: root, createdAt: now(), schemaVersion: SCHEMA_VERSION };
    for (const [key, value] of Object.entries({ id: this.info.id, name: this.info.name, createdAt: this.info.createdAt, schemaVersion: String(SCHEMA_VERSION) })) run(this.db, 'INSERT OR REPLACE INTO meta VALUES (?,?)', [key,value]);
    this.save(); return this.getState();
  }
  async open(root: string) {
    const dbPath = path.join(root, 'workspace.sqlite'); if (!fs.existsSync(dbPath)) throw new Error('This folder does not contain a Research Desk workspace.');
    this.root = root; this.db = new (await getSql()).Database(fs.readFileSync(dbPath)); this.db.run(schema);
    const meta = Object.fromEntries(rows<{key:string,value:string}>(this.db, 'SELECT key,value FROM meta').map(x => [x.key,x.value]));
    this.info = { id: meta.id, name: meta.name, path: root, createdAt: meta.createdAt, schemaVersion: Number(meta.schemaVersion || 1) }; return this.getState();
  }
  close() { this.db?.close(); this.db = null; this.root = null; this.info = null; }
  private ready(): asserts this is this & { db: Database; root: string; info: WorkspaceInfo } { if (!this.db || !this.root || !this.info) throw new Error('Open or create a workspace first.'); }
  private save() { this.ready(); const temp = path.join(this.root, 'workspace.sqlite.tmp'); fs.writeFileSync(temp, Buffer.from(this.db.export())); fs.renameSync(temp, path.join(this.root, 'workspace.sqlite')); }
  rename(name: string) { this.ready(); this.info.name = name.trim() || this.info.name; run(this.db, 'INSERT OR REPLACE INTO meta VALUES (?,?)',['name',this.info.name]); this.save(); return this.getState(); }
  getState(): AppState {
    if (!this.db || !this.info) return { workspace:null,items:[],evidence:[],claims:[],claimLinks:[],tasks:[],checks:[],conversations:[] };
    const items = rows<any>(this.db,'SELECT * FROM items ORDER BY created_at DESC').map((x):LibraryItem => ({ id:x.id,kind:x.kind,title:x.title,fileName:x.file_name,mediaType:x.media_type,storageMode:x.storage_mode,relativePath:x.relative_path,linkedPath:x.linked_path,checksum:x.checksum,size:x.size,status:x.status,batchId:x.batch_id,extractedText:x.extracted_text,extractionStatus:x.extraction_status,createdAt:x.created_at,updatedAt:x.updated_at,missing:!fs.existsSync(this.pathForRaw(x)) }));
    const evidence = rows<any>(this.db,'SELECT * FROM evidence ORDER BY updated_at DESC').map(x=>({id:x.id,title:x.title,sourceId:x.source_id,locator:x.locator,quotation:x.quotation,interpretation:x.interpretation,limitations:x.limitations,verificationStatus:x.verification_status,createdAt:x.created_at,updatedAt:x.updated_at}));
    const claims = rows<any>(this.db,'SELECT * FROM claims ORDER BY updated_at DESC').map(x=>({id:x.id,wording:x.wording,assessment:x.assessment,reasoning:x.reasoning,uncertainties:x.uncertainties,manuscriptLocation:x.manuscript_location,createdAt:x.created_at,updatedAt:x.updated_at}));
    const claimLinks = rows<any>(this.db,'SELECT * FROM claim_links').map(x=>({id:x.id,claimId:x.claim_id,evidenceId:x.evidence_id,relationship:x.relationship,dependencyGroup:x.dependency_group}));
    const tasks = rows<any>(this.db,'SELECT * FROM tasks ORDER BY position').map(x=>({id:x.id,title:x.title,why:x.why,impact:x.impact,sources:x.sources,blocker:x.blocker,completion:x.completion,status:x.status,position:x.position}));
    const conversations = rows<any>(this.db,'SELECT * FROM conversations ORDER BY updated_at DESC').map(x=>({id:x.id,title:x.title,createdAt:x.created_at,updatedAt:x.updated_at}));
    return { workspace:{...this.info}, items, evidence, claims, claimLinks, tasks, checks:this.checks(items,evidence,claims,claimLinks,tasks), conversations };
  }
  private pathForRaw(item: any) { this.ready(); return item.storage_mode === 'copy' ? path.resolve(this.root, item.relative_path || '') : item.linked_path || ''; }
  pathFor(idValue: string) { this.ready(); const item=rows<any>(this.db,'SELECT * FROM items WHERE id=?',[idValue])[0]; if(!item) throw new Error('Item not found.'); const result=this.pathForRaw(item); if(!fs.existsSync(result)) throw new Error('The source file is missing. Relink it from the library.'); return result; }
  async importFiles(paths: string[], mode: ImportMode): Promise<ImportResult> {
    this.ready(); const imported: LibraryItem[]=[]; const duplicates:Array<{name:string;existingId:string}>=[]; const batchId=paths.length?id():null; if(batchId){run(this.db,'INSERT INTO batches VALUES (?,?,?,?,?)',[batchId,`Import ${new Date().toLocaleDateString()}`,'more-files-coming',now(),now()]);this.save();}
    for(const sourcePath of paths){ const stat=fs.statSync(sourcePath); if(!stat.isFile()) continue; const bytes=fs.readFileSync(sourcePath); const checksum=hash(bytes); const existing=rows<any>(this.db,'SELECT id FROM items WHERE checksum=?',[checksum])[0]; if(existing){duplicates.push({name:path.basename(sourcePath),existingId:existing.id});continue;}
      const itemId=id(), fileName=safeName(path.basename(sourcePath)); let relativePath:string|null=null, linkedPath:string|null=null;
      if(mode==='copy'){ relativePath=path.join('files',`${itemId}-${fileName}`); fs.copyFileSync(sourcePath,path.join(this.root,relativePath)); } else linkedPath=path.resolve(sourcePath);
      const created=now(), mediaType=mime(sourcePath); let extractedText:string|null=null, extractionStatus='not-supported';
      if(mediaType==='text/plain'||mediaType==='text/markdown'){ extractedText=bytes.toString('utf8'); extractionStatus='machine-extracted'; }
      else if(mediaType.includes('wordprocessingml')){ try{ extractedText=(await mammoth.extractRawText({buffer:bytes})).value; extractionStatus='machine-extracted'; }catch{ extractionStatus='failed'; } }
      run(this.db,'INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[itemId,kindFor(sourcePath),path.basename(sourcePath,path.extname(sourcePath)),fileName,mediaType,mode,relativePath,linkedPath,checksum,stat.size,'received',batchId,extractedText,extractionStatus,created,created]);
      this.save(); // Per-file checkpoint: completed imports survive interruption; retry is checksum-idempotent.
    }
    this.save(); const state=this.getState(); for(const x of state.items) if(paths.some(p=>path.basename(p)===x.fileName)&&!duplicates.some(d=>d.existingId===x.id)) imported.push(x); return {imported,duplicates,batchId};
  }
  async readItem(idValue:string){ this.ready(); const item=this.getState().items.find(x=>x.id===idValue); if(!item) throw new Error('Item not found.'); const file=this.pathFor(idValue); if(item.mediaType.includes('wordprocessingml')){ const result=await mammoth.convertToHtml({path:file}); return {item,html:result.value}; } if(item.mediaType.startsWith('text/')) return {item,text:fs.readFileSync(file,'utf8')}; return {item}; }
  saveText(idValue:string,text:string){this.ready();const item=this.getState().items.find(x=>x.id===idValue);if(!item||!item.mediaType.startsWith('text/'))throw new Error('Only plain text and Markdown files can be edited.');const file=this.pathFor(idValue);fs.writeFileSync(file,text,'utf8');const bytes=fs.readFileSync(file);run(this.db,'UPDATE items SET checksum=?,size=?,extracted_text=?,updated_at=? WHERE id=?',[hash(bytes),bytes.length,text,now(),idValue]);this.save();}
  relink(idValue:string,newPath:string){this.ready();const item=this.getState().items.find(x=>x.id===idValue);if(!item)throw new Error('Item not found.');const bytes=fs.readFileSync(newPath);if(hash(bytes)!==item.checksum)throw new Error('The selected file does not match the original checksum.');run(this.db,'UPDATE items SET linked_path=?,updated_at=? WHERE id=?',[path.resolve(newPath),now(),idValue]);this.save();return this.getState();}
  createEvidence(data:Partial<EvidenceRecord>&{sourceId:string}){this.ready();const t=now(),value={id:id(),title:data.title||'Untitled evidence',sourceId:data.sourceId,locator:data.locator||'',quotation:data.quotation||'',interpretation:data.interpretation||'',limitations:data.limitations||'',verificationStatus:data.verificationStatus||'machine-extracted',createdAt:t,updatedAt:t};run(this.db,'INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?)',[value.id,value.title,value.sourceId,value.locator,value.quotation,value.interpretation,value.limitations,value.verificationStatus,t,t]);this.history('create','evidence',value.id,null,value);this.save();return this.getState();}
  updateEvidence(value:EvidenceRecord){this.ready();const before=rows<any>(this.db,'SELECT * FROM evidence WHERE id=?',[value.id])[0];run(this.db,'UPDATE evidence SET title=?,source_id=?,locator=?,quotation=?,interpretation=?,limitations=?,verification_status=?,updated_at=? WHERE id=?',[value.title,value.sourceId,value.locator,value.quotation,value.interpretation,value.limitations,value.verificationStatus,now(),value.id]);this.history('update','evidence',value.id,before,value);this.save();return this.getState();}
  createClaim(data:Partial<ClaimRecord>){this.ready();const t=now(),value={id:id(),wording:data.wording||'Untitled claim',assessment:data.assessment||'Needs assessment',reasoning:data.reasoning||'',uncertainties:data.uncertainties||'',manuscriptLocation:data.manuscriptLocation||'',createdAt:t,updatedAt:t};run(this.db,'INSERT INTO claims VALUES (?,?,?,?,?,?,?,?)',[value.id,value.wording,value.assessment,value.reasoning,value.uncertainties,value.manuscriptLocation,t,t]);this.history('create','claim',value.id,null,value);this.save();return this.getState();}
  linkEvidence(claimId:string,evidenceId:string,relationship:ClaimLink['relationship']){this.ready();run(this.db,'INSERT INTO claim_links VALUES (?,?,?,?,?)',[id(),claimId,evidenceId,relationship,'']);this.save();return this.getState();}
  createTask(data:Partial<TaskRecord>){this.ready();const max=rows<any>(this.db,'SELECT MAX(position) value FROM tasks')[0]?.value??-1;run(this.db,'INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',[id(),data.title||'New action',data.why||'',data.impact||'',data.sources||'',data.blocker||'',data.completion||'',data.status||'ready',max+1]);this.save();return this.getState();}
  reorderTasks(ids:string[]){this.ready();ids.forEach((value,index)=>run(this.db!,'UPDATE tasks SET position=? WHERE id=?',[index,value]));this.save();return this.getState();}
  messages(conversationId:string){this.ready();return rows<any>(this.db,'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at',[conversationId]).map(x=>({id:x.id,conversationId:x.conversation_id,role:x.role,content:x.content,contextJson:x.context_json,createdAt:x.created_at}));}
  addMessage(conversationId:string|undefined,role:'user'|'assistant',content:string,contextJson='{}'){this.ready();let cid=conversationId;const exists=cid?rows<any>(this.db,'SELECT id FROM conversations WHERE id=?',[cid])[0]:null;if(!cid||!exists){cid=cid||id();const t=now();run(this.db,'INSERT INTO conversations VALUES (?,?,?,?)',[cid,content.slice(0,60)||'Conversation',t,t]);}const message={id:id(),conversationId:cid,role,content,contextJson,createdAt:now()};run(this.db,'INSERT INTO messages VALUES (?,?,?,?,?,?)',[message.id,cid,role,content,contextJson,message.createdAt]);run(this.db,'UPDATE conversations SET updated_at=? WHERE id=?',[now(),cid]);this.save();return message;}
  private history(action:string,type:string,recordId:string,before:unknown,after:unknown){run(this.db!,'INSERT INTO history VALUES (?,?,?,?,?,?,?)',[id(),action,type,recordId,JSON.stringify(before),JSON.stringify(after),now()]);}
  private checks(items:LibraryItem[],evidence:EvidenceRecord[],claims:ClaimRecord[],links:ClaimLink[],tasks:TaskRecord[]):CheckResult[]{const out:CheckResult[]=[];for(const x of items.filter(x=>x.missing))out.push({id:`broken-${x.id}`,severity:'warning',title:'Broken local file link',detail:`${x.title} cannot be found. Use Relink to locate the original.`,recordId:x.id,recordType:'item'});for(const x of evidence.filter(x=>!x.locator.trim()))out.push({id:`locator-${x.id}`,severity:'warning',title:'Evidence needs a precise locator',detail:x.title,recordId:x.id,recordType:'evidence'});for(const x of claims.filter(x=>!links.some(l=>l.claimId===x.id)))out.push({id:`claim-${x.id}`,severity:'info',title:'Claim has no evidence relationship',detail:x.wording,recordId:x.id,recordType:'claim'});for(const x of tasks.filter(x=>x.status==='ready'&&!x.completion.trim()))out.push({id:`task-${x.id}`,severity:'info',title:'Active task lacks a completion criterion',detail:x.title,recordId:x.id,recordType:'task'});return out;}
  async exportTo(target:string){this.ready();this.save();const zip=new JSZip();const manifest:any={format:'research-desk-workspace',version:1,exportedAt:now(),workspace:{id:this.info.id,name:this.info.name,createdAt:this.info.createdAt},files:[]};const add=(archivePath:string,bytes:Buffer)=>{zip.file(archivePath,bytes);manifest.files.push({path:archivePath,sha256:hash(bytes),size:bytes.length});};add('workspace.sqlite',fs.readFileSync(path.join(this.root,'workspace.sqlite')));const dir=path.join(this.root,'files');if(fs.existsSync(dir))for(const file of fs.readdirSync(dir)){const full=path.join(dir,file);if(fs.statSync(full).isFile())add(`files/${file}`,fs.readFileSync(full));}zip.file('manifest.json',JSON.stringify(manifest,null,2));fs.writeFileSync(target,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));}
  async importFrom(archive:string,targetRoot:string){const zip=await JSZip.loadAsync(fs.readFileSync(archive));const manifestFile=zip.file('manifest.json');if(!manifestFile)throw new Error('Archive has no manifest.');const manifest=JSON.parse(await manifestFile.async('string'));if(manifest.format!=='research-desk-workspace'||manifest.version!==1)throw new Error('Unsupported workspace archive version.');fs.mkdirSync(targetRoot,{recursive:true});for(const entry of manifest.files){if(typeof entry.path!=='string'||entry.path.includes('..')||path.isAbsolute(entry.path))throw new Error('Unsafe archive path.');const file=zip.file(entry.path);if(!file)throw new Error(`Archive is missing ${entry.path}.`);const bytes=Buffer.from(await file.async('uint8array'));if(hash(bytes)!==entry.sha256)throw new Error(`Integrity check failed for ${entry.path}.`);const output=path.resolve(targetRoot,entry.path);if(!output.startsWith(path.resolve(targetRoot)+path.sep))throw new Error('Unsafe archive path.');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}return this.open(targetRoot);}
}
