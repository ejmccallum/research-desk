import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/main/workspace';

const roots:string[]=[];
const temp=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),'research-desk-test-'));roots.push(value);return value;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe('workspace persistence',()=>{
  it('reopens imports and does not multiply exact duplicates',async()=>{
    const root=temp(),sourceRoot=temp(),source=path.join(sourceRoot,'source.txt');fs.writeFileSync(source,'A synthetic source.');
    const store=new WorkspaceStore();await store.create(root,'Synthetic study');
    const first=await store.importFiles([source],'copy');const second=await store.importFiles([source],'copy');
    expect(first.imported).toHaveLength(1);expect(second.imported).toHaveLength(0);expect(second.duplicates).toHaveLength(1);
    store.close();const reopened=new WorkspaceStore();const state=await reopened.open(root);
    expect(state.items).toHaveLength(1);expect((await reopened.readItem(state.items[0].id)).text).toBe('A synthetic source.');
  });

  it('resolves evidence to an exact source and locator',async()=>{
    const root=temp(),sourceRoot=temp(),source=path.join(sourceRoot,'source.md');fs.writeFileSync(source,'Quoted passage');
    const store=new WorkspaceStore();await store.create(root,'Evidence test');const imported=await store.importFiles([source],'copy');
    const state=store.createEvidence({sourceId:imported.imported[0].id,title:'Synthetic passage',locator:'p. 12',quotation:'Quoted passage'});
    expect(state.evidence[0].sourceId).toBe(state.items[0].id);expect(state.evidence[0].locator).toBe('p. 12');expect(state.checks.some((x:{title:string})=>x.title.includes('locator'))).toBe(false);
  });

  it('removes library entries durably while retaining original files, copies and evidence',async()=>{
    const root=temp(),sources=temp(),source=path.join(sources,'remove.txt');fs.writeFileSync(source,'Retain this source');
    const store=new WorkspaceStore();await store.create(root,'Removal');const result=await store.importFiles([source],'copy');const item=result.imported[0];const copy=store.pathFor(item.id);
    store.createEvidence({sourceId:item.id,title:'Retained quotation',locator:'line 1',quotation:'Retain this source'});
    store.recordDriveImport('remote-source',item.id);
    const state=store.removeItem(item.id);expect(state.items).toHaveLength(0);expect(state.evidence).toHaveLength(1);expect(state.checks.some(x=>x.title==='Evidence source removed from library')).toBe(true);
    expect(fs.existsSync(copy)).toBe(true);expect(fs.existsSync(source)).toBe(true);
    store.close();await store.open(root);expect(store.getState().items).toHaveLength(0);expect(store.hasDriveImport('remote-source')).toBe(true);
  });
  it('removes a linked file without deleting the external original',async()=>{
    const root=temp(),source=path.join(temp(),'linked.txt');fs.writeFileSync(source,'External original');const store=new WorkspaceStore();await store.create(root,'Links');const result=await store.importFiles([source],'link');store.removeItem(result.imported[0].id);expect(fs.readFileSync(source,'utf8')).toBe('External original');
  });

  it('exports and imports a versioned integrity-checked archive without settings',async()=>{
    const root=temp(),sourceRoot=temp(),source=path.join(sourceRoot,'note.txt'),archive=path.join(temp(),'backup.researchdesk'),restored=temp();fs.writeFileSync(source,'Portable research');
    const store=new WorkspaceStore();await store.create(root,'Portable test');await store.importFiles([source],'copy');await store.exportTo(archive);
    const imported=new WorkspaceStore();const state=await imported.importFrom(archive,restored);
    expect(state.workspace?.name).toBe('Portable test');expect(state.items).toHaveLength(1);expect(fs.readFileSync(imported.pathFor(state.items[0].id),'utf8')).toBe('Portable research');
    const bytes=fs.readFileSync(archive);expect(bytes.includes(Buffer.from('openAiKey'))).toBe(false);
  });
});
