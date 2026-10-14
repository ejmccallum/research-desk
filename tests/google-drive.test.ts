import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('electron',()=>({safeStorage:{isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()},shell:{openExternal:vi.fn()}}));
import { GoogleDrive } from '../src/main/google-drive';
import { WorkspaceStore } from '../src/main/workspace';
const roots:string[]=[];
const temp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'drive-test-'));roots.push(root);return root;};
afterEach(()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('Drive import',()=>{
  it('paginates, exports Docs, reports failures, and skips removed files on subsequent imports',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'Drive');let settings:any={driveTokens:Buffer.from(JSON.stringify({access_token:'token',expires_at:Date.now()+3600000})).toString('base64')};
    const drive=new GoogleDrive(()=>settings,value=>{settings=value;});
    const fetchMock=vi.fn(async(input:string)=>{
      const url=new URL(input);
      if(url.pathname.endsWith('/files'))return new Response(JSON.stringify(url.searchParams.get('pageToken')?{files:[{id:'bad',name:'Failure.pdf',mimeType:'application/pdf'},{id:'unsupported',name:'Movie.mov',mimeType:'video/quicktime'}]}:{nextPageToken:'page2',files:[{id:'doc',name:'Google document',mimeType:'application/vnd.google-apps.document'}]}));
      if(url.pathname.includes('/doc/export')){expect(url.searchParams.get('mimeType')).toContain('wordprocessingml');return new Response('mock DOCX');}
      return new Response('',{status:403});
    });vi.stubGlobal('fetch',fetchMock);
    const first=await drive.importAll(store);expect(first.imported).toBe(1);expect(first.skipped).toBe(1);expect(first.errors).toHaveLength(1);expect(store.getState().items[0].fileName).toBe('Google document.docx');
    store.removeItem(store.getState().items[0].id);const second=await drive.importAll(store);expect(second.imported).toBe(0);expect(second.skipped).toBe(2);expect(fetchMock.mock.calls.filter(([url])=>url.includes('/doc/export'))).toHaveLength(1);
  });
  it('refreshes expired tokens before accessing files',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'Refresh');let settings:any={driveClient:Buffer.from(JSON.stringify({client_id:'client',client_secret:'secret'})).toString('base64'),driveTokens:Buffer.from(JSON.stringify({access_token:'old',refresh_token:'refresh',expires_at:0})).toString('base64')};
    const drive=new GoogleDrive(()=>settings,value=>{settings=value;});vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{if(url.includes('/token'))return new Response(JSON.stringify({access_token:'new',expires_in:3600}));expect(options.headers.Authorization).toBe('Bearer new');return new Response(JSON.stringify({files:[]}));}));
    await drive.importAll(store);expect(JSON.parse(Buffer.from(settings.driveTokens,'base64').toString()).refresh_token).toBe('refresh');
  });
});
