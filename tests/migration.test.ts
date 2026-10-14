// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WorkspaceStore} from '../src/main/workspace';
import {importMigration,migrationSnapshot,searchMigration,type MigrationBundle} from '../src/main/migration';
import {projectContext} from '../src/main/project';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(r=>fs.rmSync(r,{recursive:true,force:true})));
const table=(name:string,id:string,fields:string[],records:Record<string,unknown>[])=>({name,id,primaryFieldId:fields[0],fields:fields.map(name=>({id:name,name,type:'singleLineText'})),records:records.map((fields,i)=>({id:`${id}${i}`,createdTime:'2026-01-01',cellValuesByFieldId:fields}))});
const bundle=():MigrationBundle=>({format:'research-desk-thesis-migration',version:1,baseId:'appSynthetic',capturedAt:'2026-10-14',project:{context:'Confirmed context; no citation style established.',workflow:'Do not edit protected chapters.',state:'Source receipt is not examination.'},tables:[table('Sources','src',['Short Title','Authoritative File URL'],[{'Short Title':'Synthetic book','Authoritative File URL':'https://drive.google.com/drive/folders/folder'}]),table('Evidence','ev',['Evidence Summary','Source','Exact Quotation','Verification Status','Claims Supported or Tested','Relationship to Claim'],[{'Evidence Summary':'Uncertain passage',Source:[{id:'src0'}],'Exact Quotation':'Archive opened in 1847','Verification Status':{name:'Lead'},'Claims Supported or Tested':[{id:'cl0'}],'Relationship to Claim':{name:'Qualifies'}}]),table('Claims','cl',['Claim Statement','Claim Status','Revision Notes','Risks or Cautions','Relevant Chapters'],[{'Claim Statement':'An archive opened','Claim Status':{name:'Developing'},'Revision Notes':'Keep original uncertainty','Risks or Cautions':'Not visually examined'}]),table('Research Queue','rq',['Research Question','Status','Priority'],[{'Research Question':'Verify the passage',Status:{name:'Waiting on source'},Priority:{name:'Critical — blocks revision'}}]),table('Chapters','ch',['Chapter Title'],[]),table('Entities','en',['Entity Name'],[{'Entity Name':'Synthetic author'}]),table('Events and Connections','events',['Event or Connection'],[])]});
async function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'migration-test-'));roots.push(root);const store=new WorkspaceStore();await store.create(root,'Study');return store;}
describe('local project migration',()=>{
 it('preserves originals, raw labels and links, resolves folder members, survives restart and is idempotent',async()=>{
  const store=await setup(),file=path.join(store.root!,'original.txt');fs.writeFileSync(file,'Original source');const imported=await store.importFiles([file],'copy');store.recordDriveImport('drive-file',imported.imported[0].id);
  const data=bundle();data.sourceFileInventory={src0:[{id:'drive-file'}]};const result=importMigration(store,data);expect(result.alreadyImported).toBe(false);
  const state=store.getState();expect(state.claimLinks[0].relationship).toBe('qualifies');expect(state.evidence[0].verificationStatus).toBe('uncertain');expect(state.evidence[0].verificationLabel).toBe('Lead');expect(state.evidence[0].sourceIds).toContain(imported.imported[0].id);expect(state.tasks[0].status).toBe('waiting');expect(searchMigration(store,'Synthetic author').records.some(r=>r.table==='Entities')).toBe(true);
  expect(importMigration(store,data).alreadyImported).toBe(true);expect(fs.readFileSync(file,'utf8')).toBe('Original source');expect(projectContext(store)?.documents.workflow).toBe(data.project.workflow);
  const root=store.root!;store.close();await store.open(root);expect(store.getState().evidence).toHaveLength(1);expect(migrationSnapshot(store)?.bundle.tables).toHaveLength(7);
  expect(()=>importMigration(store,{...data,capturedAt:'changed'})).toThrow('Reconcile');expect(store.getState().evidence).toHaveLength(1);
 });
 it('rolls back the entire import when a later record fails',async()=>{const store=await setup(),data=bundle();data.chats=[{thread:{id:'invalid'},turns:[]}];expect(()=>importMigration(store,data)).toThrow();expect(store.getState().evidence).toHaveLength(0);expect(migrationSnapshot(store)).toBeNull();expect(projectContext(store)).toBeNull();});
 it('retains extra fields and unresolved relationships without silently promoting them',async()=>{const store=await setup(),data=bundle();data.tables[1].records[0].cellValuesByFieldId['Relationship to Claim']={name:'Unresolved'};data.tables[1].records[0].cellValuesByFieldId['Original caveat']='Do not use';importMigration(store,data);expect(store.getState().claimLinks).toHaveLength(0);expect(searchMigration(store,'Do not use').records[0].fields['Original caveat']).toBe('Do not use');});
});

import {MaintenanceService} from '../src/main/maintenance';
it('keeps reviewed migration corrections authoritative without rewriting the import snapshot',async()=>{
 const store=await setup(),data=bundle();data.tables.find(t=>t.name==='Events and Connections')!.records.push({id:'event0',createdTime:'2026-01-01',cellValuesByFieldId:{'Event or Connection':'Inherited uncertain event'}});importMigration(store,data);
 const file=path.join(store.root!,'corrected-source.txt');fs.writeFileSync(file,'Corrected source');const source=(await store.importFiles([file],'copy')).imported[0];
 const service=new MaintenanceService(store),wid=store.info!.id,s=service.snapshot(wid),record=s.records.find(r=>r.kind==='evidence')!;
 const preview=service.preview(wid,s.revision,{record:{...record,values:{...record.values,sourceId:source.id,sourceIds:'',quotation:'Corrected transcription'}},reason:'Original source assignment was incorrect'});service.apply(wid,preview.token);
 const evidence=store.getState().evidence[0];expect(evidence.sourceId).toBe(source.id);expect(evidence.sourceIds).toEqual([source.id]);expect(evidence.verificationLabel).toBeUndefined();expect(evidence.verificationStatus).toBe('uncertain');expect(migrationSnapshot(store)!.bundle).toEqual(data);
 const current=service.read(wid,evidence.id) as any;expect(current.values.quotation).toBe('Corrected transcription');expect(service.snapshot(wid).records.find(r=>r.kind==='chronology')?.values.title).toBe('Inherited uncertain event');
});
