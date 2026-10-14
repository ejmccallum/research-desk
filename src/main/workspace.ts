import {atomicWrite,portablePath,backupPreflight,writeBackup,readBackup,dbRows,digest} from './portable.js';
import type {RestoreSummary} from '../shared/backup.js';
import { maintenanceData, maintenanceChecks } from './maintenance.js';
import { migrationSnapshot, migrationSources, migrationEvidence, migrationTasks } from './migration.js';
import {projectAirtable,airtableSnapshot} from './airtable.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs, { Database } from 'sql.js';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { contextSources, emptySession, parseContext, parseSession } from '../shared/chat.js';
import { chunkText, rankPassages } from './search.js';
import type { DocumentBatch, DocumentCatalogueEntry, ChatMessage, ChatSession, Conversation, LoadedChat, MessageStatus, IndexedPage, IndexCoverage, SourcePassage, AppState, CheckResult, ClaimLink, ClaimRecord, EvidenceRecord, ImportMode, ImportResult, ItemKind, LibraryItem, TaskRecord, WorkspaceInfo } from '../shared/types.js';

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
CREATE TABLE IF NOT EXISTS intake_state(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,kind TEXT,title TEXT,file_name TEXT,media_type TEXT,storage_mode TEXT,relative_path TEXT,linked_path TEXT,checksum TEXT,size INTEGER,status TEXT,batch_id TEXT,extracted_text TEXT,extraction_status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,label TEXT,state TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,title TEXT,source_id TEXT,locator TEXT,quotation TEXT,interpretation TEXT,limitations TEXT,verification_status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,wording TEXT,assessment TEXT,reasoning TEXT,uncertainties TEXT,manuscript_location TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS claim_links(id TEXT PRIMARY KEY,claim_id TEXT,evidence_id TEXT,relationship TEXT,dependency_group TEXT);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,why TEXT,impact TEXT,sources TEXT,blocker TEXT,completion TEXT,status TEXT,position INTEGER);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,context_json TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS chat_sessions(conversation_id TEXT PRIMARY KEY,session_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_state(message_id TEXT PRIMARY KEY,status TEXT NOT NULL,error TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,action TEXT,record_type TEXT,record_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_checksum ON items(checksum);
CREATE TABLE IF NOT EXISTS document_index(item_id TEXT PRIMARY KEY,checksum TEXT,state TEXT,error TEXT,size INTEGER,mtime REAL);
CREATE TABLE IF NOT EXISTS document_pages(item_id TEXT,page INTEGER,text TEXT,method TEXT,PRIMARY KEY(item_id,page));
CREATE TABLE IF NOT EXISTS document_chunks(id TEXT PRIMARY KEY,item_id TEXT,page INTEGER,paragraph INTEGER,text TEXT,method TEXT);
CREATE INDEX IF NOT EXISTS idx_chunks_item ON document_chunks(item_id);
CREATE TABLE IF NOT EXISTS drive_imports(file_id TEXT PRIMARY KEY,item_id TEXT);
CREATE TABLE IF NOT EXISTS airtable_data(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_data(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`;

function rows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql); stmt.bind(params as any[]); const output: T[] = [];
  while (stmt.step()) output.push(stmt.getAsObject() as T); stmt.free(); return output;
}
function chatMessage(x:any):ChatMessage {return {id:x.id,conversationId:x.conversation_id,role:x.role,content:x.content,contextJson:x.context_json,createdAt:x.created_at,status:x.status,error:x.error,sources:contextSources(x.context_json)};}
function run(db: Database, sql: string, params: unknown[] = []) { db.run(sql, params as any[]); }
function mime(file: string) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.md':'text/markdown','.txt':'text/plain' } as Record<string,string>)[ext] ?? 'application/octet-stream';
}
function kindFor(file: string): ItemKind { const ext = path.extname(file).toLowerCase(); return ['.png','.jpg','.jpeg','.gif','.webp'].includes(ext) ? 'image' : ['.md','.txt','.docx'].includes(ext) ? 'manuscript' : 'source'; }

export class WorkspaceStore {
  onLibraryChange?:()=>void;
  onBeforeChange?:()=>void;
  lastRestore:RestoreSummary|null=null;
  generation=0;
  indexEpoch=new Map<string,number>();
  db: Database | null = null;
  root: string | null = null;
  info: WorkspaceInfo | null = null;

  async create(root: string, name: string) {
    fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(path.join(root, 'files'), { recursive: true });
    const sql=await getSql();this.onBeforeChange?.();this.db?.close();
    this.root = root; this.db = new sql.Database(); this.db.run(schema);
    this.info = { id: id(), name: name.trim() || 'Untitled research', path: root, createdAt: now(), schemaVersion: SCHEMA_VERSION };
    for (const [key, value] of Object.entries({ id: this.info.id, name: this.info.name, createdAt: this.info.createdAt, schemaVersion: String(SCHEMA_VERSION) })) run(this.db, 'INSERT OR REPLACE INTO meta VALUES (?,?)', [key,value]);
    this.generation++;this.save();this.onLibraryChange?.(); return this.getState();
  }
  async open(root: string) {
    const dbPath = path.join(root, 'workspace.sqlite'); if (!fs.existsSync(dbPath)) throw new Error('This folder does not contain a Research Desk workspace.');
    const sql=await getSql(),database=new sql.Database(fs.readFileSync(dbPath));database.run(schema);
    this.onBeforeChange?.();this.db?.close();this.root=root;this.db=database;
    run(this.db,"UPDATE message_state SET status='interrupted',error='The app closed before this reply finished.' WHERE status='pending'");
    const intake=rows<{value:string}>(this.db,'SELECT value FROM intake_state WHERE id=1')[0];
    if(intake){const data=JSON.parse(intake.value);for(const job of data.jobs)if(job.status==='running'){job.status='paused';job.error='Interrupted by app restart. Resume explicitly.';}run(this.db,'UPDATE intake_state SET value=? WHERE id=1',[JSON.stringify(data)]);}
    const savedRevisions=rows<{value:string}>(this.db,"SELECT value FROM project_data WHERE key='manuscript-revisions'")[0];
    if(savedRevisions){const data=JSON.parse(savedRevisions.value);for(const job of data.jobs)if(job.status==='running'){job.status='interrupted';job.error='Interrupted by restart. Review inputs and retry explicitly.';}data.revision++;run(this.db,"UPDATE project_data SET value=? WHERE key='manuscript-revisions'",[JSON.stringify(data)]);}
    const savedProject=rows<{value:string}>(this.db,"SELECT value FROM project_data WHERE key='snapshot'")[0];
    if(savedProject){const data=JSON.parse(savedProject.value);for(const job of data.jobs)if(job.status==='running'){job.status='failed';job.error='Interrupted by app restart. Retry this update.';}run(this.db,"UPDATE project_data SET value=? WHERE key='snapshot'",[JSON.stringify(data)]);}
    const meta = Object.fromEntries(rows<{key:string,value:string}>(this.db, 'SELECT key,value FROM meta').map(x => [x.key,x.value]));
    this.info = { id: meta.id, name: meta.name, path: root, createdAt: meta.createdAt, schemaVersion: Number(meta.schemaVersion || 1) };this.generation++;this.save();this.onLibraryChange?.(); return this.getState();
  }
  close() { this.onBeforeChange?.();this.generation++;this.db?.close(); this.db = null; this.root = null; this.info = null;this.onLibraryChange?.(); }
  removeItem(idValue:string) {
    this.ready();
    const item=this.getState().items.find(x=>x.id===idValue);
    if(!item)throw new Error('Item not found.');
    if(item.remoteUrl)throw new Error('Airtable records are managed through Airtable settings and selected tables.');
    this.history('remove','item',idValue,item,null);
    run(this.db,'DELETE FROM items WHERE id=?',[idValue]);this.indexEpoch.set(idValue,(this.indexEpoch.get(idValue)||0)+1);this.clearIndex(idValue);
    this.save();this.onLibraryChange?.();return this.getState();
  }
  hasDriveImport(fileId:string){this.ready();return rows(this.db,'SELECT file_id FROM drive_imports WHERE file_id=?',[fileId]).length>0;}
  recordDriveImport(fileId:string,itemId:string){this.ready();run(this.db,'INSERT OR REPLACE INTO drive_imports VALUES (?,?)',[fileId,itemId]);this.save();}
  private clearIndex(itemId:string){
    this.ready();for(const table of ['document_chunks','document_pages','document_index'])run(this.db,`DELETE FROM ${table} WHERE item_id=?`,[itemId]);
  }
  preparation(){if(!this.db)return {enabled:false,paused:false};const value=rows<{value:string}>(this.db,"SELECT value FROM meta WHERE key='preparation'")[0];try{return value?JSON.parse(value.value) as {enabled:boolean;paused:boolean}:{enabled:false,paused:false};}catch{return {enabled:false,paused:false};}}
  setPreparation(enabled:boolean,paused:boolean){this.ready();run(this.db,"INSERT OR REPLACE INTO meta VALUES ('preparation',?)",[JSON.stringify({enabled,paused})]);this.save();this.onLibraryChange?.();}
  retryIndex(itemId?:string){this.ready();for(const item of this.libraryItems().filter(item=>itemId?item.id===itemId:this.indexRecord(item.id)?.state==='failed')){const record=this.indexRecord(item.id);if(record?.state!=='failed')continue;this.indexEpoch.set(item.id,(this.indexEpoch.get(item.id)||0)+1);run(this.db,"UPDATE document_index SET state='processing',error='' WHERE item_id=?",[item.id]);}this.save();this.onLibraryChange?.();}
  itemChecksum(itemId:string){if(!this.db)return undefined;return rows<{checksum:string}>(this.db,'SELECT checksum FROM items WHERE id=?',[itemId])[0]?.checksum;}
  indexRecord(itemId:string){this.ready();return rows<any>(this.db,'SELECT * FROM document_index WHERE item_id=?',[itemId])[0];}
  indexedPages(itemId:string):IndexedPage[]{this.ready();return rows<IndexedPage>(this.db,'SELECT page,text,method FROM document_pages WHERE item_id=? ORDER BY page',[itemId]);}
  startIndex(itemId:string,checksum:string,size:number,mtime:number){
    this.ready();const previous=this.indexRecord(itemId);if(previous?.checksum!==checksum)this.clearIndex(itemId);
    run(this.db,'INSERT OR REPLACE INTO document_index VALUES (?,?,?,?,?,?)',[itemId,checksum,'processing','',size,mtime]);this.save();
  }
  indexPage(itemId:string,value:IndexedPage){
    this.ready();run(this.db,'INSERT OR REPLACE INTO document_pages VALUES (?,?,?,?)',[itemId,value.page,value.text,value.method]);
    run(this.db,'DELETE FROM document_chunks WHERE item_id=? AND page=?',[itemId,value.page]);
    for(const [index,chunk] of chunkText(value.text).entries())run(this.db,'INSERT INTO document_chunks VALUES (?,?,?,?,?,?)',[`${itemId}:${value.page}:${index}`,itemId,value.page,chunk.paragraph,chunk.text,value.method]);
    this.save();
  }
  finishIndex(itemId:string,error?:string){
    this.ready();const pages=this.indexedPages(itemId),text=pages.map(p=>p.text).join('\n\n');
    run(this.db,'UPDATE document_index SET state=?,error=? WHERE item_id=?',[error?'failed':'ready',error||'',itemId]);
    run(this.db,'UPDATE items SET extracted_text=?,extraction_status=? WHERE id=?',[text,error?'failed':pages.some(p=>p.method==='ocr')?'ocr-extracted':'machine-extracted',itemId]);this.save();
  }
  indexUnsupported(itemId:string){this.ready();run(this.db,'INSERT OR REPLACE INTO document_index VALUES (?,?,?,?,?,?)',[itemId,'','unsupported','This format is not supported.',0,0]);this.save();}
  invalidateIndex(itemId:string){this.ready();this.clearIndex(itemId);this.save();}
  coverage(itemId?:string):IndexCoverage{
    const items=this.libraryItems().filter(item=>!itemId||item.id===itemId);
    const result:IndexCoverage={total:items.length,ready:0,pending:0,failed:0,unsupported:0,missing:0,failures:[]};
    for(const item of items){const record=this.indexRecord(item.id);if(item.missing){result.missing++;continue;}
      if(record?.state==='ready'){try{const stat=fs.statSync(this.pathFor(item.id));if(record.size===stat.size&&record.mtime===stat.mtimeMs)result.ready++;else result.pending++;}catch{result.missing++;}}else if(record?.state==='unsupported')result.unsupported++;else if(record?.state==='failed'){result.failed++;result.failures.push({itemId:item.id,title:item.title,error:record.error});}else result.pending++;
    }return result;
  }
  passages(itemId?:string):SourcePassage[]{
    this.ready();const current=new Map<string,boolean>();return rows<any>(this.db,`SELECT c.*,i.title,i.media_type,d.size AS indexed_size,d.mtime AS indexed_mtime FROM document_chunks c JOIN items i ON i.id=c.item_id JOIN document_index d ON d.item_id=i.id WHERE d.state IN ('ready','processing')${itemId?' AND i.id=?':''}`,itemId?[itemId]:[]).filter(row=>{if(!current.has(row.item_id)){try{const stat=fs.statSync(this.pathFor(row.item_id));current.set(row.item_id,stat.size===row.indexed_size&&stat.mtimeMs===row.indexed_mtime);}catch{current.set(row.item_id,false);}}return current.get(row.item_id);}).map(row=>({sourceId:row.id,itemId:row.item_id,title:row.title,page:row.page,paragraph:row.paragraph,method:row.method,text:row.text,locator:row.media_type==='application/pdf'?`Page ${row.page}`:row.media_type.startsWith('image/')?'Image text':`Paragraph ${row.paragraph}`}));
  }
  searchLibrary(query:string,itemId?:string,limit=12,offset=0){const passages=this.passages(itemId);const found=query.trim()?rankPassages(passages,query,passages.length):passages.filter((p,index)=>passages.findIndex(other=>other.itemId===p.itemId)===index);return found.slice(Math.max(0,offset),Math.max(0,offset)+Math.min(20,limit));}
  readSource(sourceId:string,itemId?:string){const passages=this.passages(itemId),index=passages.findIndex(p=>p.sourceId===sourceId);if(index<0)throw new Error('This source is no longer available in the search scope.');const selected=passages[index];return passages.filter(p=>p.itemId===selected.itemId&&p.page===selected.page&&Math.abs(Number(p.sourceId.split(':').at(-1))-Number(selected.sourceId.split(':').at(-1)))<=1);}
  documentCatalogue(query='',itemId?:string,offset=0,limit=30):DocumentCatalogueEntry[]{
    const words=query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.libraryItems().filter(item=>(!itemId||item.id===itemId)&&(!words.length||words.some(word=>item.title.toLowerCase().includes(word)))).slice(Math.max(0,offset),Math.max(0,offset)+Math.min(50,limit)).map(item=>{
      const record=this.indexRecord(item.id);let state:DocumentCatalogueEntry['state']=item.missing?'missing':record?.state||'pending';
      if(record&&!item.missing&&state!=='unsupported'){try{const stat=fs.statSync(this.pathFor(item.id));if(stat.size!==record.size||stat.mtimeMs!==record.mtime)state='pending';}catch{state='missing';}}
      const count=rows<{passages:number;pages:number}>(this.db!, 'SELECT COUNT(*) AS passages,COUNT(DISTINCT page) AS pages FROM document_chunks WHERE item_id=?',[item.id])[0];
      return {itemId:item.id,title:item.title,mediaType:item.mediaType,state,checksum:record?.checksum||item.checksum,passages:count.passages,pages:count.pages,error:record?.error||''};
    });
  }
  sourceVersion(itemId:string):string|null{
    const exists=this.itemChecksum(itemId),record=this.indexRecord(itemId);if(!exists||!record||!['ready','processing'].includes(record.state))return null;
    try{const stat=fs.statSync(this.pathFor(itemId));return stat.size===record.size&&stat.mtimeMs===record.mtime?record.checksum:null;}catch{return null;}
  }
  readDocument(documentId:string,offset=0,limit=8,scopeId?:string):DocumentBatch{
    if(scopeId&&scopeId!==documentId)throw new Error('This document is outside the search scope.');
    if(!Number.isInteger(offset)||offset<0)throw new Error('Invalid document offset.');
    const item=this.libraryItems().find(item=>item.id===documentId);if(!item||item.missing)throw new Error('This document is unavailable.');
    const sources=this.passages(documentId).sort((a,b)=>a.page-b.page||Number(a.sourceId.split(':').at(-1))-Number(b.sourceId.split(':').at(-1))),record=this.indexRecord(documentId);
    const batch=sources.slice(offset,offset+Math.max(1,Math.min(8,limit))),next=offset+batch.length;
    return {itemId:documentId,checksum:record?.checksum||item.checksum,sources:batch,offset,nextOffset:next<sources.length?next:null,total:sources.length,complete:record?.state==='ready'&&this.coverage(documentId).ready===1};
  }
  private ready(): asserts this is this & { db: Database; root: string; info: WorkspaceInfo } { if (!this.db || !this.root || !this.info) throw new Error('Open or create a workspace first.'); }
  save() { this.ready(); atomicWrite(path.join(this.root,'workspace.sqlite'),Buffer.from(this.db.export())); }
  rename(name: string) { this.ready(); this.info.name = name.trim() || this.info.name; run(this.db, 'INSERT OR REPLACE INTO meta VALUES (?,?)',['name',this.info.name]); this.save(); return this.getState(); }
  libraryItems():LibraryItem[] {
    if(!this.db||!this.info)return [];
    return rows<any>(this.db,'SELECT id,kind,title,file_name,media_type,storage_mode,relative_path,linked_path,checksum,size,status,batch_id,NULL AS extracted_text,extraction_status,created_at,updated_at FROM items ORDER BY created_at DESC,rowid DESC').map((x):LibraryItem => ({ id:x.id,kind:x.kind,title:x.title,fileName:x.file_name,mediaType:x.media_type,storageMode:x.storage_mode,relativePath:x.relative_path,linkedPath:x.linked_path,checksum:x.checksum,size:x.size,status:x.status,batchId:x.batch_id,extractedText:x.extracted_text,extractionStatus:x.extraction_status,createdAt:x.created_at,updatedAt:x.updated_at,missing:!fs.existsSync(this.pathForRaw(x)) }));
  }
  getState(): AppState {
    if (!this.db || !this.info) return { workspace:null,items:[],evidence:[],claims:[],claimLinks:[],tasks:[],checks:[],conversations:[] };
    const remote=projectAirtable(this);
    const migrated=migrationSnapshot(this);
    if(migrated){const prefix=`airtable:${migrated.bundle.baseId}:`;remote.items=remote.items.filter(x=>!x.id.startsWith(prefix));remote.evidence=remote.evidence.filter(x=>!x.id.startsWith(prefix));remote.claims=remote.claims.filter(x=>!x.id.startsWith(prefix));remote.claimLinks=remote.claimLinks.filter(x=>!x.claimId.startsWith(prefix));remote.tasks=remote.tasks.filter(x=>!x.id.startsWith(prefix));}
    const items = [...this.libraryItems(),...migrationSources(this),...remote.items];
    const evidence = rows<any>(this.db,'SELECT * FROM evidence ORDER BY updated_at DESC').map(x=>({id:x.id,title:x.title,sourceId:x.source_id,locator:x.locator,quotation:x.quotation,interpretation:x.interpretation,limitations:x.limitations,verificationStatus:x.verification_status,createdAt:x.created_at,updatedAt:x.updated_at}));
    const claims = rows<any>(this.db,'SELECT * FROM claims ORDER BY updated_at DESC').map(x=>({id:x.id,wording:x.wording,assessment:x.assessment,reasoning:x.reasoning,uncertainties:x.uncertainties,manuscriptLocation:x.manuscript_location,createdAt:x.created_at,updatedAt:x.updated_at}));
    const claimLinks = rows<any>(this.db,'SELECT * FROM claim_links').map(x=>({id:x.id,claimId:x.claim_id,evidenceId:x.evidence_id,relationship:x.relationship,dependencyGroup:x.dependency_group}));
    const tasks = rows<any>(this.db,'SELECT * FROM tasks ORDER BY position').map(x=>({id:x.id,title:x.title,why:x.why,impact:x.impact,sources:x.sources,blocker:x.blocker,completion:x.completion,status:x.status,position:x.position}));
    const conversations = rows<any>(this.db,'SELECT * FROM conversations ORDER BY updated_at DESC').map(x=>({id:x.id,title:x.title,createdAt:x.created_at,updatedAt:x.updated_at}));
    evidence.push(...remote.evidence);claims.push(...remote.claims);claimLinks.push(...remote.claimLinks);tasks.push(...remote.tasks);
    const catalogue=airtableSnapshot(this);
    const maintenance=maintenanceData(this),archived=new Set(maintenance.records.filter(r=>r.archived).map(r=>r.id));
    const visible=<T extends {id:string}>(records:T[])=>records.filter(r=>!archived.has(r.id));
    const maintainedEvidence=migrationEvidence(this,evidence).map(e=>{const record=maintenance.records.find(r=>r.id===e.id);return record?{...e,sourceIds:[...new Set([e.sourceId,...(record.values.sourceIds||'').split('\n').filter(Boolean)])],verificationLabel:undefined}:e;});
    return { airtable:{configured:catalogue.mappings.length>0,records:catalogue.records.length,refreshedAt:catalogue.refreshedAt},workspace:{...this.info}, items, evidence:visible(maintainedEvidence), claims:visible(claims), claimLinks:visible(claimLinks), tasks:visible(migrationTasks(this,tasks)), checks:[...this.checks(items,visible(evidence),visible(claims),visible(claimLinks),visible(tasks)),...maintenanceChecks(this)], conversations };
  }
  private pathForRaw(item: any) { this.ready(); return item.storage_mode === 'copy' ? path.resolve(this.root, portablePath(item.relative_path || '')) : item.linked_path || ''; }
  pathFor(idValue: string) { this.ready(); const item=rows<any>(this.db,'SELECT * FROM items WHERE id=?',[idValue])[0]; if(!item) throw new Error('Item not found.'); const result=this.pathForRaw(item); if(!fs.existsSync(result)) throw new Error('The source file is missing. Relink it from the library.'); return result; }
  async importFiles(paths: string[], mode: ImportMode): Promise<ImportResult> {
    this.ready(); const imported: LibraryItem[]=[]; const duplicates:Array<{name:string;existingId:string}>=[]; const batchId=paths.length?id():null; if(batchId){run(this.db,'INSERT INTO batches VALUES (?,?,?,?,?)',[batchId,`Import ${new Date().toLocaleDateString()}`,'more-files-coming',now(),now()]);this.save();}
    for(const sourcePath of paths){ const stat=fs.statSync(sourcePath); if(!stat.isFile()) continue; const bytes=fs.readFileSync(sourcePath); const checksum=hash(bytes); const existing=rows<any>(this.db,'SELECT id FROM items WHERE checksum=?',[checksum])[0]; if(existing){duplicates.push({name:path.basename(sourcePath),existingId:existing.id});continue;}
      const itemId=id(), fileName=safeName(path.basename(sourcePath)); let relativePath:string|null=null, linkedPath:string|null=null;
      if(mode==='copy'){ relativePath=`files/${itemId}-${fileName}`; fs.copyFileSync(sourcePath,path.join(this.root,relativePath)); } else linkedPath=path.resolve(sourcePath);
      const created=now(), mediaType=mime(sourcePath); let extractedText:string|null=null, extractionStatus='not-supported';
      if(mediaType==='text/plain'||mediaType==='text/markdown'){ extractedText=bytes.toString('utf8'); extractionStatus='machine-extracted'; }
      else if(mediaType.includes('wordprocessingml')||mediaType==='application/pdf'||mediaType.startsWith('image/'))extractionStatus='pending';
      run(this.db,'INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[itemId,kindFor(sourcePath),path.basename(sourcePath,path.extname(sourcePath)),fileName,mediaType,mode,relativePath,linkedPath,checksum,stat.size,'received',batchId,extractedText,extractionStatus,created,created]);
      this.save(); // Per-file checkpoint: completed imports survive interruption; retry is checksum-idempotent.
    }
    this.save();this.onLibraryChange?.(); const state=this.getState(); for(const x of state.items) if(paths.some(p=>path.basename(p)===x.fileName)&&!duplicates.some(d=>d.existingId===x.id)) imported.push(x); return {imported,duplicates,batchId};
  }
  async readItem(idValue:string){ this.ready(); const item=this.getState().items.find(x=>x.id===idValue); if(!item) throw new Error('Item not found.'); if(item.catalogueText)return {item,text:item.catalogueText}; if(item.remoteUrl)return {item,text:'Airtable catalogue entry. The original document has not been downloaded. Open the record in Airtable to review its source links.'}; const file=this.pathFor(idValue); if(item.mediaType.includes('wordprocessingml')){ const result=await mammoth.convertToHtml({path:file}); return {item,html:result.value}; } if(item.mediaType.startsWith('text/')) return {item,text:fs.readFileSync(file,'utf8')}; return {item}; }
  saveText(idValue:string,text:string){this.ready();const item=this.getState().items.find(x=>x.id===idValue);if(!item||!item.mediaType.startsWith('text/'))throw new Error('Only plain text and Markdown files can be edited.');const file=this.pathFor(idValue);fs.writeFileSync(file,text,'utf8');const bytes=fs.readFileSync(file);run(this.db,'UPDATE items SET checksum=?,size=?,extracted_text=?,updated_at=? WHERE id=?',[hash(bytes),bytes.length,text,now(),idValue]);this.indexEpoch.set(idValue,(this.indexEpoch.get(idValue)||0)+1);this.clearIndex(idValue);this.save();this.onLibraryChange?.();}
  relink(idValue:string,newPath:string){this.ready();const item=this.getState().items.find(x=>x.id===idValue);if(!item)throw new Error('Item not found.');const bytes=fs.readFileSync(newPath);if(hash(bytes)!==item.checksum)throw new Error('The selected file does not match the original checksum.');run(this.db,'UPDATE items SET linked_path=?,updated_at=? WHERE id=?',[path.resolve(newPath),now(),idValue]);this.indexEpoch.set(idValue,(this.indexEpoch.get(idValue)||0)+1);this.clearIndex(idValue);this.save();this.onLibraryChange?.();return this.getState();}
  createEvidence(data:Partial<EvidenceRecord>&{sourceId:string}){this.ready();const t=now(),value={id:id(),title:data.title||'Untitled evidence',sourceId:data.sourceId,locator:data.locator||'',quotation:data.quotation||'',interpretation:data.interpretation||'',limitations:data.limitations||'',verificationStatus:data.verificationStatus||'machine-extracted',createdAt:t,updatedAt:t};run(this.db,'INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?)',[value.id,value.title,value.sourceId,value.locator,value.quotation,value.interpretation,value.limitations,value.verificationStatus,t,t]);this.history('create','evidence',value.id,null,value);this.save();return this.getState();}
  updateEvidence(value:EvidenceRecord){this.ready();if(value.id.startsWith('airtable:'))throw new Error('Use a reviewed Airtable proposal to change this record.');const before=rows<any>(this.db,'SELECT * FROM evidence WHERE id=?',[value.id])[0];run(this.db,'UPDATE evidence SET title=?,source_id=?,locator=?,quotation=?,interpretation=?,limitations=?,verification_status=?,updated_at=? WHERE id=?',[value.title,value.sourceId,value.locator,value.quotation,value.interpretation,value.limitations,value.verificationStatus,now(),value.id]);this.history('update','evidence',value.id,before,value);this.save();return this.getState();}
  createClaim(data:Partial<ClaimRecord>){this.ready();const t=now(),value={id:id(),wording:data.wording||'Untitled claim',assessment:data.assessment||'Needs assessment',reasoning:data.reasoning||'',uncertainties:data.uncertainties||'',manuscriptLocation:data.manuscriptLocation||'',createdAt:t,updatedAt:t};run(this.db,'INSERT INTO claims VALUES (?,?,?,?,?,?,?,?)',[value.id,value.wording,value.assessment,value.reasoning,value.uncertainties,value.manuscriptLocation,t,t]);this.history('create','claim',value.id,null,value);this.save();return this.getState();}
  linkEvidence(claimId:string,evidenceId:string,relationship:ClaimLink['relationship']){this.ready();if(claimId.startsWith('airtable:')||evidenceId.startsWith('airtable:'))throw new Error('Use a reviewed Airtable proposal to change these relationships.');run(this.db,'INSERT INTO claim_links VALUES (?,?,?,?,?)',[id(),claimId,evidenceId,relationship,'']);this.save();return this.getState();}
  createTask(data:Partial<TaskRecord>){this.ready();const max=rows<any>(this.db,'SELECT MAX(position) value FROM tasks')[0]?.value??-1;run(this.db,'INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',[id(),data.title||'New action',data.why||'',data.impact||'',data.sources||'',data.blocker||'',data.completion||'',data.status||'ready',max+1]);this.save();return this.getState();}
  reorderTasks(ids:string[]){this.ready();ids.forEach((value,index)=>run(this.db!,'UPDATE tasks SET position=? WHERE id=?',[index,value]));this.save();return this.getState();}
  listChats(query='') {
    this.ready();
    const conversations=rows<any>(this.db,`SELECT c.* FROM conversations c WHERE ?='' OR instr(lower(c.title),lower(?))>0 OR EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND instr(lower(m.content),lower(?))>0) ORDER BY c.updated_at DESC,c.rowid DESC`,[query,query,query]).map((x):Conversation=>({id:x.id,title:x.title,createdAt:x.created_at,updatedAt:x.updated_at}));
    const active=rows<any>(this.db,"SELECT value FROM meta WHERE key='activeChat'")[0];
    return {conversations,activeId:active?active.value||null:conversations[0]?.id||null};
  }
  private ensureChat(cid:string,title='Untitled chat') {
    this.ready();if(!rows(this.db,'SELECT id FROM conversations WHERE id=?',[cid]).length){const t=now();run(this.db,'INSERT INTO conversations VALUES (?,?,?,?)',[cid,title,t,t]);}
  }
  activateChat(cid:string|null,workspaceId:string) {
    this.ready();if(workspaceId!==this.info.id)throw new Error('The workspace changed.');
    const value=cid&&rows(this.db,'SELECT id FROM conversations WHERE id=?',[cid]).length?cid:'';
    if(rows<any>(this.db,"SELECT value FROM meta WHERE key='activeChat'")[0]?.value===value)return;
    run(this.db,"INSERT OR REPLACE INTO meta VALUES ('activeChat',?)",[value]);this.save();
  }
  saveChatSession(cid:string,session:ChatSession,workspaceId:string) {
    this.ready();if(workspaceId!==this.info.id)throw new Error('The workspace changed.');
    const safe=parseSession(JSON.stringify(session));
    const exists=rows(this.db,'SELECT id FROM conversations WHERE id=?',[cid]).length;
    if(!exists&&!safe.draft.trim())return;
    const json=JSON.stringify(safe);if(rows<any>(this.db,'SELECT session_json FROM chat_sessions WHERE conversation_id=?',[cid])[0]?.session_json===json)return;
    this.ensureChat(cid);run(this.db,'INSERT OR REPLACE INTO chat_sessions VALUES (?,?)',[cid,json]);
    run(this.db,'UPDATE conversations SET updated_at=? WHERE id=?',[now(),cid]);this.save();
  }
  renameChat(cid:string,title:string):Conversation {
    this.ready();if(!title.trim())throw new Error('Enter a chat title.');
    if(!rows(this.db,'SELECT id FROM conversations WHERE id=?',[cid]).length)throw new Error('Chat not found.');
    run(this.db,'UPDATE conversations SET title=?,updated_at=? WHERE id=?',[title.trim().slice(0,120),now(),cid]);this.save();return this.loadChat(cid).conversation;
  }
  loadChat(cid:string):LoadedChat {
    this.ready();const conversation=this.listChats().conversations.find(chat=>chat.id===cid);if(!conversation)throw new Error('Chat not found.');
    const messages=this.messages(cid),saved=rows<any>(this.db,'SELECT session_json FROM chat_sessions WHERE conversation_id=?',[cid])[0];
    let session=emptySession();
    if(saved)session=parseSession(saved.session_json);
    else {const context=parseContext(messages.at(-1)?.contextJson||'{}');session={...session,scope:context.scope==='item'?'item':'workspace',itemId:context.selectedDocument?.id,evidenceIds:Array.isArray(context.evidenceIds)?context.evidenceIds.filter((id:unknown)=>typeof id==='string'):Array.isArray(context.evidence)?context.evidence.map((e:any)=>e.id||rows<any>(this.db!,'SELECT id FROM evidence WHERE title=? AND quotation=?',[e.title||'',e.quotation||''])[0]?.id).filter((id:unknown)=>typeof id==='string'):[]};}
    return {conversation,messages,session};
  }
  messages(conversationId:string,includeContext=true):ChatMessage[] {
    this.ready();return rows<any>(this.db,`SELECT m.id,m.conversation_id,m.role,m.content,m.created_at,${includeContext?'m.context_json':"'{}' AS context_json"},COALESCE(s.status,'complete') AS status,COALESCE(s.error,'') AS error FROM messages m LEFT JOIN message_state s ON s.message_id=m.id WHERE conversation_id=? ORDER BY m.created_at,m.rowid`,[conversationId]).map(chatMessage);
  }
  addMessage(conversationId:string|undefined,role:'user'|'assistant',content:string,contextJson='{}',status:MessageStatus='complete'):ChatMessage {
    this.ready();const cid=conversationId||id();this.ensureChat(cid,content.slice(0,60)||'Untitled chat');
    if(role==='user'&&!rows(this.db,'SELECT id FROM messages WHERE conversation_id=?',[cid]).length)run(this.db,"UPDATE conversations SET title=? WHERE id=? AND title='Untitled chat'",[content.slice(0,60),cid]);
    const message:ChatMessage={id:id(),conversationId:cid,role,content,contextJson,createdAt:now(),status,error:'',sources:contextSources(contextJson)};
    run(this.db,'INSERT INTO messages VALUES (?,?,?,?,?,?)',[message.id,cid,role,content,contextJson,message.createdAt]);
    run(this.db,'INSERT INTO message_state VALUES (?,?,?)',[message.id,status,'']);
    run(this.db,'UPDATE conversations SET updated_at=? WHERE id=?',[now(),cid]);this.save();return message;
  }
  updateMessage(messageId:string,content:string,contextJson:string,status:MessageStatus,error=''):ChatMessage {
    this.ready();const existing=rows<any>(this.db,'SELECT conversation_id FROM messages WHERE id=?',[messageId])[0];if(!existing)throw new Error('Message not found.');
    run(this.db,'UPDATE messages SET content=?,context_json=? WHERE id=?',[content,contextJson,messageId]);
    run(this.db,'INSERT OR REPLACE INTO message_state VALUES (?,?,?)',[messageId,status,error]);
    run(this.db,'UPDATE conversations SET updated_at=? WHERE id=?',[now(),existing.conversation_id]);this.save();return chatMessage(rows<any>(this.db,"SELECT m.*,s.status,s.error FROM messages m JOIN message_state s ON s.message_id=m.id WHERE m.id=?",[messageId])[0]);
  }

  private history(action:string,type:string,recordId:string,before:unknown,after:unknown){run(this.db!,'INSERT INTO history VALUES (?,?,?,?,?,?,?)',[id(),action,type,recordId,JSON.stringify(before),JSON.stringify(after),now()]);}
  private checks(items:LibraryItem[],evidence:EvidenceRecord[],claims:ClaimRecord[],links:ClaimLink[],tasks:TaskRecord[]):CheckResult[]{const out:CheckResult[]=[];for(const x of evidence.filter(x=>!items.some(item=>item.id===x.sourceId)))out.push({id:`removed-source-${x.id}`,severity:'warning',title:'Evidence source removed from library',detail:`${x.title}: the quotation is retained, but its source is no longer in the library.`,recordId:x.id,recordType:'evidence'});for(const x of items.filter(x=>x.missing))out.push({id:`broken-${x.id}`,severity:'warning',title:'Broken local file link',detail:`${x.title} cannot be found. Use Relink to locate the original.`,recordId:x.id,recordType:'item'});for(const x of evidence.filter(x=>!x.locator.trim()))out.push({id:`locator-${x.id}`,severity:'warning',title:'Evidence needs a precise locator',detail:x.title,recordId:x.id,recordType:'evidence'});for(const x of claims.filter(x=>!links.some(l=>l.claimId===x.id)))out.push({id:`claim-${x.id}`,severity:'info',title:'Claim has no evidence relationship',detail:x.wording,recordId:x.id,recordType:'claim'});for(const x of tasks.filter(x=>x.status==='ready'&&!x.completion.trim()))out.push({id:`task-${x.id}`,severity:'info',title:'Active task lacks a completion criterion',detail:x.title,recordId:x.id,recordType:'task'});return out;}
  backupPreflight(){this.ready();return backupPreflight(this.db,this.root);}
  async exportTo(target:string){
    this.ready();this.save();const generation=this.generation,sql=await getSql();this.ready();if(generation!==this.generation)throw Error('Workspace changed during backup.');
    const snapshot=new sql.Database(this.db.export()),root=this.root;
    try{return await writeBackup(snapshot,root,target);}finally{snapshot.close();}
  }
  async importFrom(archive:string,targetRoot:string){
    const target=path.resolve(targetRoot);
    const empty=()=>{if(fs.existsSync(target)&&(!fs.lstatSync(target).isDirectory()||fs.lstatSync(target).isSymbolicLink()||fs.readdirSync(target).length))throw Error('Restore requires an empty destination folder.');};empty();
    const {manifest,entries}=await readBackup(archive),sql=await getSql(),database=new sql.Database(entries.get('workspace.sqlite'));
    try{
      if(dbRows(database,'PRAGMA integrity_check')[0]?.integrity_check!=='ok')throw Error('Workspace database failed integrity validation.');
      const meta=Object.fromEntries(dbRows(database,'SELECT key,value FROM meta').map(x=>[x.key,x.value]));
      if(!meta.id||!meta.name||!meta.createdAt||Number(meta.schemaVersion)!==SCHEMA_VERSION)throw Error('Invalid or unsupported workspace database.');
      for(const table of ['items','evidence','claims','claim_links','tasks','conversations','messages','history'])dbRows(database,`SELECT * FROM ${table} LIMIT 0`);
      for(const item of dbRows(database,'SELECT * FROM items'))if(item.storage_mode==='copy'){
        const name=portablePath(item.relative_path),bytes=entries.get(name);if(!name.startsWith('files/')||!bytes||digest(bytes)!==item.checksum)throw Error(`Missing or changed managed source: ${item.id}`);
        database.run('UPDATE items SET relative_path=? WHERE id=?',[name,item.id]);
      }
      const tables=dbRows(database,"SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name);
      if(tables.includes('project_data')){const saved=dbRows(database,"SELECT value FROM project_data WHERE key='manuscript-revisions'")[0];if(saved){const revisions=JSON.parse(saved.value);for(const draft of revisions.drafts){const name=portablePath(draft.snapshotPath),bytes=entries.get(name);if(!name.startsWith('files/')||!bytes||digest(bytes)!==draft.checksum)throw Error('Missing or changed immutable manuscript snapshot.');draft.snapshotPath=name;}database.run("UPDATE project_data SET value=? WHERE key='manuscript-revisions'",[JSON.stringify(revisions)]);}}
      entries.set('workspace.sqlite',Buffer.from(database.export()));
    }finally{database.close();}
    fs.mkdirSync(path.dirname(target),{recursive:true});const stage=fs.mkdtempSync(path.join(path.dirname(target),'.research-desk-restore-'));
    try{
      for(const [name,bytes] of entries){const output=path.join(stage,name);fs.mkdirSync(path.dirname(output),{recursive:true});atomicWrite(output,bytes);}
      // Reopen and validate all derived state before publishing or switching the live workspace.
      const check=new WorkspaceStore();try{await check.open(stage);check.getState();}finally{check.close();}
      empty();if(fs.existsSync(target))fs.rmdirSync(target);fs.renameSync(stage,target);
    }finally{fs.rmSync(stage,{recursive:true,force:true});}
    await this.open(target);
    for(const item of this.libraryItems().filter(item=>item.storageMode==='copy'&&item.relativePath)){
      const entry=manifest.files.find((file:any)=>portablePath(file.path)===portablePath(item.relativePath!)),record=this.indexRecord(item.id);
      if(entry&&record?.checksum===entry.sha256){const stat=fs.statSync(this.pathFor(item.id));run(this.db!,'UPDATE document_index SET size=?,mtime=? WHERE item_id=?',[stat.size,stat.mtimeMs,item.id]);}
    }
    this.lastRestore={verifiedFiles:entries.size,convertedLinks:(manifest.convertedLinks||[]).map((x:any)=>x.id),unavailableLinks:this.libraryItems().filter(x=>x.storageMode==='link'&&x.missing).map(x=>x.id)};
    this.save();return this.getState();
  }
}
