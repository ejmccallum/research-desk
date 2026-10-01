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

  it('exports and imports a versioned integrity-checked archive without settings',async()=>{
    const root=temp(),sourceRoot=temp(),source=path.join(sourceRoot,'note.txt'),archive=path.join(temp(),'backup.researchdesk'),restored=temp();fs.writeFileSync(source,'Portable research');
    const store=new WorkspaceStore();await store.create(root,'Portable test');await store.importFiles([source],'copy');await store.exportTo(archive);
    const imported=new WorkspaceStore();const state=await imported.importFrom(archive,restored);
    expect(state.workspace?.name).toBe('Portable test');expect(state.items).toHaveLength(1);expect(fs.readFileSync(imported.pathFor(state.items[0].id),'utf8')).toBe('Portable research');
    const bytes=fs.readFileSync(archive);expect(bytes.includes(Buffer.from('openAiKey'))).toBe(false);
  });
});
