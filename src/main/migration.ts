import crypto from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import type { LibraryItem, EvidenceRecord, TaskRecord } from '../shared/types.js';
import { projectSnapshot } from './project.js';

export interface MigrationTable {id:string;name:string;primaryFieldId:string;fields:Array<{id:string;name:string;type:string;options?:{linkedTableId?:string}}>;records:Array<{id:string;createdTime:string;cellValuesByFieldId:Record<string,unknown>}>}
export interface MigrationBundle {format:string;version:number;baseId:string;capturedAt:string;tables:MigrationTable[];project:{context:string;workflow:string;state:string};chats?:any[];documents?:any[];sourceFileInventory?:Record<string,Array<{id:string}>>}
interface MigrationSnapshot {digest:string;bundle:MigrationBundle;sourceFiles:Record<string,string[]>;warnings:string[]}
const key='research-migration';
export function migrationSnapshot(store:WorkspaceStore):MigrationSnapshot|null {const result=store.db?.exec('SELECT value FROM project_data WHERE key=?',[key]);return result?.length?JSON.parse(String(result[0].values[0][0])):null;}
const valueText=(v:unknown):string=>typeof v==='string'?v:typeof v==='number'?String(v):v&&typeof v==='object'&&!Array.isArray(v)&&'name' in v?String(v.name):v==null?'':JSON.stringify(v);
const refs=(v:unknown):string[]=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x&&typeof x==='object'&&'id' in x?String(x.id):'').filter(Boolean):[];
function get(table:MigrationTable,record:MigrationTable['records'][number],name:string){return record.cellValuesByFieldId[table.fields.find(f=>f.name===name)?.id||''];}
export const migratedId=(bundle:MigrationBundle,table:string,record:string)=>`migrated:${bundle.baseId}:${table}:${record}`;
export function migrationSources(store:WorkspaceStore):LibraryItem[] {
  const snapshot=migrationSnapshot(store);if(!snapshot)return [];
  const {bundle}=snapshot,table=bundle.tables.find(t=>t.name==='Sources');if(!table)return [];
  return table.records.map(r=>({id:migratedId(bundle,table.id,r.id),kind:'source',title:valueText(get(table,r,'Short Title'))||valueText(get(table,r,'Full Title')),fileName:'',mediaType:'text/plain',storageMode:'copy',relativePath:null,linkedPath:null,checksum:'',size:0,status:'catalogued',batchId:null,extractedText:null,extractionStatus:'catalogue-only',createdAt:r.createdTime,updatedAt:bundle.capturedAt,originUrl:`https://airtable.com/${bundle.baseId}/${table.id}/${r.id}`,catalogueText:recordView(bundle,table,r).text,linkedItemIds:snapshot.sourceFiles[r.id]||[]}));
}
export function migrationEvidence(store:WorkspaceStore,evidence:EvidenceRecord[]):EvidenceRecord[] {
  const snapshot=migrationSnapshot(store);if(!snapshot)return evidence;
  const {bundle}=snapshot,table=bundle.tables.find(t=>t.name==='Evidence'),source=bundle.tables.find(t=>t.name==='Sources');
  return evidence.map(e=>{const r=table?.records.find(r=>migratedId(bundle,table.id,r.id)===e.id);if(!r||!table||!source)return e;return {...e,originUrl:`https://airtable.com/${bundle.baseId}/${table.id}/${r.id}`,verificationLabel:valueText(get(table,r,'Verification Status')),sourceIds:[...new Set(refs(get(table,r,'Source')).flatMap(id=>[migratedId(bundle,source.id,id),...(snapshot.sourceFiles[id]||[])]))]};});
}
export function migrationTasks(store:WorkspaceStore,tasks:TaskRecord[]):TaskRecord[] {
  const snapshot=migrationSnapshot(store),table=snapshot?.bundle.tables.find(t=>t.name==='Research Queue');
  return tasks.map(task=>{const r=table?.records.find(r=>migratedId(snapshot!.bundle,table.id,r.id)===task.id);return r&&table&&!valueText(get(table,r,'Status'))?{...task,status:'waiting',recordKind:'protocol'}:task;});
}
function recordView(bundle:MigrationBundle,table:MigrationTable,r:MigrationTable['records'][number]) {
  return {snapshot:true,id:migratedId(bundle,table.id,r.id),table:table.name,url:`https://airtable.com/${bundle.baseId}/${table.id}/${r.id}`,capturedAt:bundle.capturedAt,text:table.fields.map(f=>`${f.name}: ${valueText(r.cellValuesByFieldId[f.id])}`).join('\n'),fields:r.cellValuesByFieldId};
}
export function searchMigration(store:WorkspaceStore,query:string,offset=0) {
  const snapshot=migrationSnapshot(store);if(!snapshot)return {records:[],nextOffset:null,total:0};
  const words=query.toLowerCase().split(/\s+/).filter(Boolean),all=snapshot.bundle.tables.flatMap(t=>t.records.map(r=>recordView(snapshot.bundle,t,r))).filter(r=>!words.length||words.some(w=>(r.text+' '+JSON.stringify(r.fields)).toLowerCase().includes(w)));
  return {records:all.slice(offset,offset+8),total:all.length,nextOffset:offset+8<all.length?offset+8:null};
}
export function readMigration(store:WorkspaceStore,id:string){const snapshot=migrationSnapshot(store);for(const t of snapshot?.bundle.tables||[])for(const r of t.records)if(migratedId(snapshot!.bundle,t.id,r.id)===id){const view=recordView(snapshot!.bundle,t,r);const localTable:Record<string,string>={'Evidence':'evidence','Claims':'claims','Research Queue':'tasks'};const name=localTable[t.name];return {...view,snapshot:true,localCurrent:name?store.db?.exec(`SELECT * FROM ${name} WHERE id=?`,[view.id])[0]:undefined};}throw new Error('Migrated record unavailable.');}

/** Additive, provenance-preserving one-time import. A changed bundle requires reconciliation. */
export function importMigration(store:WorkspaceStore,bundle:MigrationBundle) {
  if(!store.db||!store.info)throw new Error('Open a workspace first.');
  if(bundle?.format!=='research-desk-thesis-migration'||bundle.version!==1||!/^app[A-Za-z0-9]+$/.test(bundle.baseId)||!Array.isArray(bundle.tables)||!bundle.project)throw new Error('Invalid migration bundle.');
  for(const document of Object.values(bundle.project))if(typeof document!=='string'||document.length>20000)throw new Error('Invalid project document.');
  const ids=new Set<string>();for(const t of bundle.tables){if(!t.id||!t.name||!Array.isArray(t.records)||!Array.isArray(t.fields))throw new Error('Invalid migration table.');for(const r of t.records){if(!r.id||!r.cellValuesByFieldId||ids.has(r.id))throw new Error('Duplicate or invalid record.');ids.add(r.id);}}
  const digest=crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex'),previous=migrationSnapshot(store);
  if(previous){if(previous.digest===digest)return {alreadyImported:true,records:ids.size,warnings:previous.warnings};throw new Error('A migration already exists. Reconcile changed records before importing another snapshot.');}
  const table=(name:string)=>{const t=bundle.tables.find(t=>t.name===name);if(!t)throw new Error(`Missing ${name} table.`);return t;};
  const sources=table('Sources'),evidence=table('Evidence'),claims=table('Claims'),tasks=table('Research Queue');
  const warnings:string[]=[],sourceFiles:Record<string,string[]>={};
  for(const t of bundle.tables)for(const r of t.records)for(const f of t.fields.filter(f=>f.type==='multipleRecordLinks'))for(const id of refs(r.cellValuesByFieldId[f.id]))if(!bundle.tables.find(target=>target.id===f.options?.linkedTableId)?.records.some(r=>r.id===id))warnings.push(`${t.name}/${r.id}/${f.name}: unresolved ${id}`);
  for(const r of sources.records){const url=valueText(get(sources,r,'Authoritative File URL')),driveId=url.match(/\/(?:d|folders)\/([^/?]+)/)?.[1];const fileIds=[...(driveId?[driveId]:[]),...(bundle.sourceFileInventory?.[r.id]||[]).map(f=>f.id)];sourceFiles[r.id]=[...new Set(fileIds.flatMap(id=>store.db!.exec('SELECT item_id FROM drive_imports WHERE file_id=?',[id])[0]?.values.map(v=>String(v[0]))||[]))];}
  const stamp=new Date().toISOString();
  store.db.run('BEGIN');
  try {
    for(const r of evidence.records){const sourceIds=refs(get(evidence,r,'Source')),id=migratedId(bundle,evidence.id,r.id),status=valueText(get(evidence,r,'Verification Status'));
      const verification=['Page verified','Citation-ready'].includes(status)?'visually-checked':status==='Transcribed'?'machine-extracted':'uncertain';
      store.db.run('INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?)',[id,valueText(get(evidence,r,'Evidence Summary')),sourceIds[0]?migratedId(bundle,sources.id,sourceIds[0]):'',valueText(get(evidence,r,'Page or Location')),valueText(get(evidence,r,'Exact Quotation')),valueText(get(evidence,r,'Paraphrase or Analysis')),valueText(get(evidence,r,'Research Notes')),verification,r.createdTime,stamp]);
      const relationship=valueText(get(evidence,r,'Relationship to Claim')),role:Record<string,string>={Supports:'supports',Qualifies:'qualifies',Contradicts:'contradicts','Context only':'context'};
      for(const claimId of refs(get(evidence,r,'Claims Supported or Tested')))if(claims.records.some(c=>c.id===claimId)&&role[relationship])store.db.run('INSERT INTO claim_links VALUES (?,?,?,?,?)',[`${id}:${claimId}`,migratedId(bundle,claims.id,claimId),id,role[relationship],'']);
      if(sourceIds.length!==1)warnings.push(`${id}: ${sourceIds.length} source links; all preserved in provenance.`);
      if(refs(get(evidence,r,'Claims Supported or Tested')).length>1)warnings.push(`${id}: imported global relationship; review per-claim interpretation.`);
    }
    for(const r of claims.records)store.db.run('INSERT INTO claims VALUES (?,?,?,?,?,?,?,?)',[migratedId(bundle,claims.id,r.id),valueText(get(claims,r,'Claim Statement')),valueText(get(claims,r,'Claim Status')),valueText(get(claims,r,'Revision Notes')),valueText(get(claims,r,'Risks or Cautions')),refs(get(claims,r,'Relevant Chapters')).map(id=>valueText(get(table('Chapters'),table('Chapters').records.find(r=>r.id===id)!, 'Chapter Title'))).join(', '),r.createdTime,stamp]);
    const priority=(r:MigrationTable['records'][number])=>{const rank=['Critical — blocks revision','High — strengthens core argument','Medium — useful if efficient','Low — optional'].indexOf(valueText(get(tasks,r,'Priority')));return rank<0?4:rank;};
    const ordered=[...tasks.records].sort((a,b)=>priority(a)-priority(b)||valueText(get(tasks,a,'Task ID')).localeCompare(valueText(get(tasks,b,'Task ID'))));
    const position=Number(store.db.exec('SELECT COALESCE(MAX(position),-1)+1 FROM tasks')[0].values[0][0]);
    ordered.forEach((r,i)=>{const status=valueText(get(tasks,r,'Status'));store.db!.run('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',[migratedId(bundle,tasks.id,r.id),valueText(get(tasks,r,'Research Question')),valueText(get(tasks,r,'Why It Matters')),refs(get(tasks,r,'Related Claims')).map(id=>migratedId(bundle,claims.id,id)).join(', '),refs(get(tasks,r,'Related Sources')).map(id=>migratedId(bundle,sources.id,id)).join(', '),status==='Waiting on source'?valueText(get(tasks,r,'Target Person Event or Archive')):'','',status==='Completed'||status==='Closed — unnecessary'?'done':status==='Waiting on source'||!status?'waiting':'ready',position+i]);});
    for(const chat of bundle.chats||[]){const cid=`imported-chat:${chat.thread.id}`,turns=[...chat.turns].reverse(),first=chat.thread.createdAt;store.db.run('INSERT INTO conversations VALUES (?,?,?,?)',[cid,`Imported · ${chat.thread.title}`,new Date(first*1000).toISOString(),new Date(chat.thread.updatedAt*1000).toISOString()]);
      for(const turn of turns)for(const item of turn.items||[]){const role=item.type==='userMessage'?'user':item.type==='agentMessage'?'assistant':null;if(!role)continue;const content=role==='user'?(item.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'):item.text;const mid=`imported-message:${item.id}`;store.db.run('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?)',[mid,cid,role,content||'',JSON.stringify({imported:true,originUrl:`https://chatgpt.com/c/${chat.thread.id}`,historicalDiscussion:true,verification:'Untrusted discussion; not independent source verification'}),new Date((turn.startedAt||first)*1000).toISOString()]);}
    }
    store.db.run('INSERT INTO project_data VALUES (?,?)',[key,JSON.stringify({digest,bundle,sourceFiles,warnings})]);
    const snapshot=projectSnapshot(store); // Configuration is versioned; old memory is retained.
    store.db.run('INSERT OR REPLACE INTO project_data VALUES (?,?)',['snapshot',JSON.stringify({...snapshot,revision:snapshot.revision+1,configurations:[...snapshot.configurations,{id:crypto.randomUUID(),version:snapshot.configurations.length+1,documents:bundle.project,createdAt:stamp}]})]);
    store.db.run('INSERT INTO history VALUES (?,?,?,?,?,?,?)',[crypto.randomUUID(),'migration-import','migration',digest,null,JSON.stringify({records:ids.size,capturedAt:bundle.capturedAt,warnings}),stamp]);
    store.db.run('COMMIT');store.save();
    return {alreadyImported:false,records:ids.size,warnings};
  }catch(error){store.db.run('ROLLBACK');throw error;}
}
