import { revisionLedgerRecords, revisionData } from './revision-data.js';
import crypto from 'node:crypto';
import type { WorkspaceStore } from './workspace.js';
import { migrationSnapshot, migratedId, searchMigration, readMigration } from './migration.js';
import { maintenanceFields, referenceIds, type MaintenanceRecord, type MaintenanceSnapshot, type MaintenanceDraft, type MaintenancePreview, type MaintenanceChange, type MaintenanceFlag, type MaintenanceKind } from '../shared/maintenance.js';
interface Saved { records:MaintenanceRecord[]; history:MaintenanceChange[]; flags:MaintenanceFlag[] }
const empty=():Saved=>({records:[],history:[],flags:[]});
export function maintenanceData(store:WorkspaceStore):Saved {const result=store.db?.exec("SELECT value FROM project_data WHERE key='maintenance'");return result?.length?JSON.parse(String(result[0].values[0][0])):empty();}
export function maintenanceChecks(store:WorkspaceStore){return maintenanceData(store).flags.filter(f=>!f.resolvedAt).map(f=>({id:f.id,severity:'warning' as const,title:'Correction needs review',detail:f.message,recordId:f.recordId}));}
const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tables={evidence:'evidence',claim:'claims',relationship:'claim_links',task:'tasks'};
const columns:Record<string,string>={sourceId:'source_id',verificationStatus:'verification_status',manuscriptLocation:'manuscript_location',claimId:'claim_id',evidenceId:'evidence_id',dependencyGroup:'dependency_group'};
export class MaintenanceService {
 private previews=new Map<string,{workspaceId:string;generation:number;revision:string;draft:MaintenanceDraft;preview:MaintenancePreview}>();
 constructor(private store:WorkspaceStore){}
 snapshot(workspaceId:string):MaintenanceSnapshot {
  if(!this.store.db||this.store.info?.id!==workspaceId)throw new Error('The workspace changed. Reopen the editor.');
  const state=this.store.getState(),data=maintenanceData(this.store),records:MaintenanceRecord[]=[];
  for(const [kind,list] of Object.entries({evidence:state.evidence,claim:state.claims,relationship:state.claimLinks,task:state.tasks}))for(const item of list){
   const values:Record<string,string>={};for(const f of maintenanceFields[kind as MaintenanceKind]){const value=(item as any)[f.key];values[f.key]=Array.isArray(value)?value.join('\n'):String(value??'');}
   if(kind==='evidence')values.verificationStatus=(item as any).verificationStatus;
   const saved=data.records.find(r=>r.id===item.id);records.push({id:item.id,kind:kind as MaintenanceKind,values:{...values,...Object.fromEntries(maintenanceFields[kind as MaintenanceKind].filter(f=>f.multiple).map(f=>[f.key,saved?.values[f.key]??values[f.key]]))},archived:saved?.archived||false,readOnly:item.id.startsWith('airtable:')||(item as any).recordKind==='protocol',provenance:(item as any).originUrl||saved?.provenance});
  }
  records.push(...data.records.filter(r=>!records.some(x=>x.id===r.id)));
  const migration=migrationSnapshot(this.store),table=migration?.bundle.tables.find(t=>/events.*connections/i.test(t.name));
  if(migration&&table)for(const row of table.records){const id=migratedId(migration.bundle,table.id,row.id);if(records.some(r=>r.id===id))continue;const named=Object.fromEntries(table.fields.map(f=>[f.name,row.cellValuesByFieldId[f.id]]));const title=String(row.cellValuesByFieldId[table.primaryFieldId]||'Imported event');records.push({id,kind:'chronology',values:{title,date:'',description:JSON.stringify(named,null,2),sourceIds:'',evidenceIds:'',claimIds:'',uncertainties:'Inherited event. Confirm date and explicit links before relying on it.'},archived:false,provenance:`Airtable migration ${migration.bundle.capturedAt}; ${id}`});}
  return {workspaceId,revision:digest({manuscriptRevision:revisionData(this.store).revision,records,flags:data.flags,history:data.history,ledger:[state.evidence,state.claims,state.claimLinks,state.tasks],items:state.items.map(i=>[i.id,i.checksum])}),records,flags:data.flags,history:data.history};
 }
 read(workspaceId:string,id:string){const s=this.snapshot(workspaceId),record=s.records.find(r=>r.id===id);if(!record){const revision=revisionLedgerRecords(this.store).find(r=>r.id===id);return revision||readMigration(this.store,id);}return {...record,authority:'Current local ledger; research data, not original documentary verification',reviewFlags:s.flags.filter(f=>f.recordId===id&&!f.resolvedAt),lastChange:s.history.filter(h=>h.after.id===id).at(-1)||null};}
 search(workspaceId:string,query:string,offset=0){const s=this.snapshot(workspaceId),words=query.toLowerCase().split(/\s+/).filter(Boolean);const records:unknown[]=s.records.filter(r=>!words.length||words.some(w=>JSON.stringify(r).toLowerCase().includes(w))).map(r=>({...r,reviewFlags:s.flags.filter(f=>f.recordId===r.id&&!f.resolvedAt)}));records.push(...revisionLedgerRecords(this.store).filter(r=>!words.length||words.some(w=>JSON.stringify(r).toLowerCase().includes(w))));let next:number|null=0;while(next!==null){const page=searchMigration(this.store,query,next);records.push(...page.records.filter(r=>!s.records.some(local=>local.id===r.id)));next=page.nextOffset;}return {records:records.slice(offset,offset+8),total:records.length,nextOffset:offset+8<records.length?offset+8:null,notice:'Current local records supersede inherited snapshots. Archived records and unresolved correction flags must be qualified.'};}
 preview(workspaceId:string,revision:string,draft:MaintenanceDraft):MaintenancePreview {
  const s=this.snapshot(workspaceId);if(s.revision!==revision)throw new Error('Records changed. Reload and review your changes again.');
  const input=draft?.record;if(!input||!Object.hasOwn(maintenanceFields,input.kind)||typeof input.id!=='string'||!input.id||input.id.length>300||typeof input.archived!=='boolean')throw new Error('Invalid record.');
  const before=s.records.find(r=>r.id===input.id)||null;if(before?.kind&&before.kind!==input.kind)throw new Error('Record type cannot change.');
  if(before?.readOnly||input.id.startsWith('airtable:'))throw new Error('This inherited protocol or remote record is read-only here.');
  if(!before&&!input.id.startsWith('local:'))throw new Error('New records require a local identifier.');
  if(typeof draft.reason!=='string'||!draft.reason.trim()||draft.reason.length>4000)throw new Error('Explain the reason for this change.');
  const values:Record<string,string>={};const items=this.store.getState().items;
  for(const f of maintenanceFields[input.kind]){const v=input.values?.[f.key]??'';if(typeof v!=='string'||v.length>100000)throw new Error(`Invalid ${f.label}.`);values[f.key]=v.trim();if(f.required&&!values[f.key])throw new Error(`${f.label} is required.`);if(f.options&&!f.options.includes(v))throw new Error(`Invalid ${f.label}.`);
   if(f.ref)for(const id of f.multiple?referenceIds(v):v?[v]:[]){const valid=f.ref==='source'?items.some(i=>i.id===id):s.records.some(r=>r.id===id&&r.kind===f.ref&&!r.archived&&!r.readOnly);if(!valid)throw new Error(`${f.label} references an unavailable record.`);}
  }
  const warnings:string[]=[];
  if(input.kind==='evidence'){const changed=!before||['quotation','locator','sourceId','sourceIds'].some(k=>before.values[k]!==values[k]);values.verificationStatus=changed?'uncertain':before.values.verificationStatus||'uncertain';if(changed)warnings.push('Quotation or source details changed: evidence verification is reset to uncertain. Citation readiness must be confirmed separately in Intake.');}
  const after:MaintenanceRecord={id:input.id,kind:input.kind,values,archived:input.archived,provenance:before?.provenance};
  if(input.kind==='dependency'&&!after.archived){if(values.sourceId===values.dependsOn)throw new Error('A source cannot depend on itself.');const edges=s.records.filter(r=>r.kind==='dependency'&&!r.archived&&r.id!==after.id).concat(after);const visit=(id:string,seen=new Set<string>()):boolean=>{if(seen.has(id))return true;const next=new Set(seen).add(id);return edges.filter(r=>r.values.sourceId===id).some(r=>visit(r.values.dependsOn,next));};if(visit(values.sourceId))throw new Error('This dependency creates a cycle.');}
  if(['relationship','dependency'].includes(after.kind)&&!after.archived&&s.records.some(r=>r.id!==after.id&&r.kind===after.kind&&!r.archived&&(after.kind==='relationship'?r.values.claimId===values.claimId&&r.values.evidenceId===values.evidenceId:r.values.sourceId===values.sourceId&&r.values.dependsOn===values.dependsOn)))throw new Error('This connection already exists. Edit the existing connection.');
  const resolve=draft.resolveFlagIds||[];if(!Array.isArray(resolve)||resolve.some(id=>!s.flags.some(f=>f.id===id&&f.recordId===after.id&&!f.resolvedAt)))throw new Error('Review flags changed. Reload the editor.');
  const changed=!before||JSON.stringify(before.values)!==JSON.stringify(after.values)||before.archived!==after.archived;
  if(!changed&&!resolve.length)throw new Error('No changes to review.');
  const affected=new Set<string>();if(changed){affected.add(after.id);if(after.kind==='dependency'){affected.add(values.sourceId);if(before)affected.add(before.values.sourceId);}if(after.kind==='relationship'){affected.add(values.claimId);if(before)affected.add(before.values.claimId);}
   let size=-1;while(size!==affected.size){size=affected.size;for(const r of s.records.filter(r=>!r.archived)){const refs=maintenanceFields[r.kind].filter(f=>f.ref).flatMap(f=>referenceIds(r.values[f.key]||''));if(refs.some(id=>affected.has(id))){affected.add(r.id);if(r.kind==='relationship')affected.add(r.values.claimId);if(r.kind==='dependency')affected.add(r.values.sourceId);}}}
   affected.delete(after.id);
  }
  if(after.archived)warnings.push('Archiving retains history and linked records. Dependent records must be reviewed.');
  if(changed&&after.kind!=='task')warnings.push('Existing assessment reports retain their original ledger snapshot and will be marked stale. Manuscripts are unchanged.');
  const preview={token:crypto.randomUUID(),before,after,affected:[...affected].filter(id=>s.records.some(r=>r.id===id)),warnings,reason:draft.reason.trim()};
  if(this.previews.size>50)this.previews.clear();this.previews.set(preview.token,{workspaceId,generation:this.store.generation,revision,draft:{...draft,record:after},preview});return preview;
 }
 apply(workspaceId:string,token:string):MaintenanceSnapshot {
  const p=this.previews.get(token);if(!p||p.workspaceId!==workspaceId||p.generation!==this.store.generation)throw new Error('Preview expired. Review this change again.');
  const s=this.snapshot(workspaceId);if(s.revision!==p.revision)throw new Error('Records changed after preview. Reload and review again.');
  const {after,before,affected,reason}=p.preview,data=maintenanceData(this.store),at=new Date().toISOString(),changeId=crypto.randomUUID();
  const changed=!before||JSON.stringify(before.values)!==JSON.stringify(after.values)||before.archived!==after.archived;
  const db=this.store.db!;db.run('BEGIN');try{
   if(after.kind in tables){const table=tables[after.kind as keyof typeof tables];const exists=db.exec(`SELECT id FROM ${table} WHERE id=?`,[after.id]).length>0;
    if(after.kind==='relationship'&&after.archived)db.run('DELETE FROM claim_links WHERE id=?',[after.id]);
    else{const fields=maintenanceFields[after.kind].filter(f=>!f.multiple).map(f=>f.key);if(after.kind==='evidence')fields.push('verificationStatus');const cols=fields.map(k=>columns[k]||k),vals=fields.map(k=>after.values[k]);if(exists)db.run(`UPDATE ${table} SET ${cols.map(k=>`${k}=?`).join(',')}${['evidence','claim'].includes(after.kind)?',updated_at=?':''} WHERE id=?`,[...vals,...(['evidence','claim'].includes(after.kind)?[at]:[]),after.id]);else{if(['evidence','claim'].includes(after.kind)){cols.push('created_at','updated_at');vals.push(at,at);}if(after.kind==='task'){cols.push('position');vals.push(String(s.records.filter(r=>r.kind==='task').length));}db.run(`INSERT INTO ${table} (id,${cols.join(',')}) VALUES (${['id',...cols].map(()=>'?').join(',')})`,[after.id,...vals]);}}
   }
   data.records=data.records.filter(r=>r.id!==after.id).concat(after);
   if(changed)for(const id of affected)data.flags.push({id:crypto.randomUUID(),recordId:id,changeId,message:`Review dependency on corrected ${after.kind}: ${after.values.title||after.values.wording||after.values.relationship||after.id}. ${reason}`});
   for(const flag of data.flags)if(p.draft.resolveFlagIds?.includes(flag.id)){flag.resolvedAt=at;flag.resolution=reason;}
   data.history.push({id:changeId,at,actor:'human',reason,before,after,affected});
   db.run("INSERT OR REPLACE INTO project_data VALUES ('maintenance',?)",[JSON.stringify(data)]);
   db.run('INSERT INTO history VALUES (?,?,?,?,?,?,?)',[changeId,'reviewed-local-change',after.kind,after.id,JSON.stringify(before),JSON.stringify(after),at]);
   if(changed&&after.kind!=='task'){const result=db.exec('SELECT value FROM intake_state WHERE id=1');if(result.length){const intake=JSON.parse(String(result[0].values[0][0]));for(const job of intake.jobs)job.ledgerStale=true;intake.revision++;db.run('UPDATE intake_state SET value=? WHERE id=1',[JSON.stringify(intake)]);}}
   db.run('COMMIT');this.store.save();this.previews.delete(token);
  }catch(error){try{db.run('ROLLBACK');}catch{}throw error;}
  return this.snapshot(workspaceId);
 }
}
