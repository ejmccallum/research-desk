// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { extractDocument } from '../src/main/extraction';
import { WorkspaceStore } from '../src/main/workspace';
import { LibraryIndexer, processingBudget } from '../src/main/indexer';
import { imageFixture,pdfFixture } from './fixtures';
const roots:string[]=[];
const temp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'index-test-'));roots.push(root);return root;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const wait=async(check:()=>boolean)=>{const end=Date.now()+25000;while(!check()){if(Date.now()>end)throw new Error('Indexing timed out.');await new Promise(resolve=>setTimeout(resolve,30));}};
describe('local document indexing',()=>{
  it('shares the ten-minute processing allowance across searches without charging provider time',async()=>{
    let clock=1000;const now=vi.spyOn(Date,'now').mockImplementation(()=>clock),monotonic=vi.spyOn(performance,'now').mockImplementation(()=>clock);
    const allowances:number[]=[];
    const prioritize=vi.fn(async(_query:string,_item:string|undefined,_signal:AbortSignal,deadline:number)=>{allowances.push(deadline-clock);clock+=allowances.length===1?2000:13000;});
    try{const prepare=processingBudget({prioritize}),signal=new AbortController().signal;await prepare('first',undefined,signal);clock+=20000;await prepare('refined',undefined,signal);await prepare('last',undefined,signal);expect(allowances).toEqual([600000,598000,585000]);}
    finally{now.mockRestore();monotonic.mockRestore();}
  });
  it('extracts text PDF pages with stable locations',async()=>{
    const file=path.join(temp(),'source.pdf');fs.writeFileSync(file,pdfFixture());const pages:any[]=[];
    await extractDocument({file,mediaType:'application/pdf',cachedPages:[],cacheDirectory:temp()},event=>{if(event.type==='page')pages.push(event.value);});
    expect(pages[0]).toMatchObject({page:1,method:'text'});expect(pages[0].text).toContain('1847');
  });
  it('recognizes scans and images using bundled English data offline',async()=>{
    const root=temp(),image=path.join(root,'image.png'),pdf=path.join(root,'scan.pdf');fs.writeFileSync(image,imageFixture().toBuffer('image/png'));fs.writeFileSync(pdf,pdfFixture(true));
    for(const [file,mediaType] of [[image,'image/png'],[pdf,'application/pdf']]){const pages:any[]=[];await extractDocument({file,mediaType,cachedPages:[],cacheDirectory:temp()},event=>{if(event.type==='page')pages.push(event.value);});expect(pages[0].method).toBe('ocr');expect(pages[0].text).toContain('1847');}
  },30000);
  it('extracts mixed PDFs per page and reports password-protected PDFs',async()=>{
    const root=temp(),file=path.join(root,'mixed.pdf');fs.writeFileSync(file,pdfFixture(false,true));const pages:any[]=[];
    await extractDocument({file,mediaType:'application/pdf',cachedPages:[],cacheDirectory:temp()},event=>{if(event.type==='page')pages.push(event.value);});expect(pages.map(p=>p.method)).toEqual(['text','ocr']);expect(pages[1].page).toBe(2);
    fs.writeFileSync(file,pdfFixture(false,false,true));await expect(extractDocument({file,mediaType:'application/pdf',cachedPages:[],cacheDirectory:temp()},()=>{})).rejects.toThrow(/password/i);
  },30000);
  it('reuses completed pages and rejects malformed PDFs',async()=>{
    const root=temp(),file=path.join(root,'cached.txt');fs.writeFileSync(file,'A source');const events:any[]=[];await extractDocument({file,mediaType:'text/plain',cachedPages:[],cacheDirectory:temp()},event=>events.push(event));
    const cached:any[]=[];await extractDocument({file,mediaType:'text/plain',cachedChecksum:events.find(e=>e.type==='start').checksum,cachedPages:[{page:1,text:'Cached checkpoint',method:'text'}],cacheDirectory:temp()},event=>cached.push(event));expect(cached.find(e=>e.type==='page').value.text).toBe('Cached checkpoint');
    fs.writeFileSync(file,'not a PDF');await expect(extractDocument({file,mediaType:'application/pdf',cachedPages:[],cacheDirectory:temp()},()=>{})).rejects.toThrow();
  });
  it('resumes persisted checkpoints and retries processing failures',async()=>{
    const root=temp(),store=new WorkspaceStore();await store.create(root,'Recovery');const file=path.join(temp(),'recovery.txt');fs.writeFileSync(file,'Checkpoint content');const result=await store.importFiles([file],'copy'),item=result.imported[0],stat=fs.statSync(store.pathFor(item.id));
    store.startIndex(item.id,item.checksum,stat.size,stat.mtimeMs);store.indexPage(item.id,{page:1,text:'Checkpoint content',method:'text'});store.close();await store.open(root);
    const indexer=new LibraryIndexer(store,temp(),()=>{},pathToFileURL(path.resolve('dist-electron/main/extraction-worker.js')));indexer.start();
    try{await wait(()=>store.coverage().ready===1);expect(store.indexedPages(item.id)).toHaveLength(1);store.finishIndex(item.id,'Retryable failure');expect(store.coverage().failed).toBe(1);indexer.retry(item.id);await wait(()=>store.coverage().ready===1);expect(store.searchLibrary('checkpoint')).toHaveLength(1);}finally{indexer.stop();}
  },30000);
  it('invalidates externally changed linked files before serving stale search results',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'External changes');const file=path.join(temp(),'external.txt');fs.writeFileSync(file,'Original archive passage');const result=await store.importFiles([file],'link'),item=result.imported[0];
    const indexer=new LibraryIndexer(store,temp(),()=>{},pathToFileURL(path.resolve('dist-electron/main/extraction-worker.js')));indexer.start();
    try{await wait(()=>store.coverage().ready===1);fs.writeFileSync(file,'Updated museum passage, different length');expect(store.searchLibrary('archive')).toHaveLength(0);expect(store.coverage().pending).toBe(1);indexer.start();await wait(()=>store.coverage().ready===1);expect(store.searchLibrary('museum')).toHaveLength(1);}finally{indexer.stop();}
  },30000);
  it('discards worker results when an indexed item is removed during processing',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'Removal during OCR');const file=path.join(temp(),'image.png');fs.writeFileSync(file,imageFixture().toBuffer('image/png'));const result=await store.importFiles([file],'copy'),item=result.imported[0];
    let removed=false;const indexer=new LibraryIndexer(store,temp(),status=>{if(status.current&&!removed){removed=true;store.removeItem(item.id);}},pathToFileURL(path.resolve('dist-electron/main/extraction-worker.js')));indexer.start();
    try{await wait(()=>removed);await new Promise(resolve=>setTimeout(resolve,250));expect(store.getState().items).toHaveLength(0);expect(store.indexRecord(item.id)).toBeUndefined();expect(store.indexedPages(item.id)).toHaveLength(0);}finally{indexer.stop();}
  });
  it('indexes imports in a worker, persists search, and removes edited or deleted passages',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'Index');const source=path.join(temp(),'history.txt');fs.writeFileSync(source,'The archive opened in 1847.');const imported=await store.importFiles([source],'copy');const item=imported.imported[0];
    const indexer=new LibraryIndexer(store,temp(),()=>{},pathToFileURL(path.resolve('dist-electron/main/extraction-worker.js')));indexer.start();
    try{
      await wait(()=>store.coverage().ready===1);expect(store.searchLibrary('archive 1847')[0].itemId).toBe(item.id);
      const root=store.root!;store.close();await store.open(root);expect(store.searchLibrary('1847')).toHaveLength(1);
      store.saveText(item.id,'The museum opened in 1920.');expect(store.searchLibrary('1847')).toHaveLength(0);await wait(()=>store.coverage().ready===1);expect(store.searchLibrary('1920')).toHaveLength(1);
      store.removeItem(item.id);expect(store.searchLibrary('1920')).toHaveLength(0);
    }finally{indexer.stop();}
  },30000);
  it('reuses unchanged indexes after restart and does not extract when loading chats',async()=>{
    const store=new WorkspaceStore();await store.create(temp(),'Cached');const file=path.join(temp(),'history.txt');fs.writeFileSync(file,'Archive evidence');const item=(await store.importFiles([file],'copy')).imported[0];
    const indexer=new LibraryIndexer(store,temp(),()=>{},pathToFileURL(path.resolve('dist-electron/main/extraction-worker.js')));indexer.start();
    try {
      await wait(()=>store.coverage().ready===1);store.addMessage('chat','user','Find archive evidence');const start=vi.spyOn(store,'startIndex'),page=vi.spyOn(store,'indexPage');
      const root=store.root!;store.close();await store.open(root);store.loadChat('chat');store.listChats();await indexer.prioritize('history',item.id,new AbortController().signal,Date.now()+1000);await new Promise(resolve=>setTimeout(resolve,250));
      expect(start).not.toHaveBeenCalled();expect(page).not.toHaveBeenCalled();expect(store.searchLibrary('archive')).toHaveLength(1);expect(store.getState().items[0].extractedText).toBeNull();
    }finally{indexer.stop();}
  });
  it('prioritizes matching files, checkpoints preempted work, and bounds waiting with cancellation',async()=>{
    const root=temp(),store=new WorkspaceStore();await store.create(root,'Priority');const sourceRoot=temp();
    // Controlled worker makes queue ordering/deadlines deterministic without relying on OCR speed.
    const worker=path.join(sourceRoot,'controlled-worker.mjs');fs.writeFileSync(worker,`import {parentPort,workerData as job} from 'node:worker_threads';import fs from 'node:fs';import crypto from 'node:crypto';const stat=fs.statSync(job.file),bytes=fs.readFileSync(job.file);parentPort.postMessage({type:'start',checksum:crypto.createHash('sha256').update(bytes).digest('hex'),size:stat.size,mtime:stat.mtimeMs});parentPort.postMessage({type:'page',value:job.cachedPages[0]||{page:1,text:bytes.toString(),method:'text'}});setTimeout(()=>parentPort.postMessage({type:'complete'}),job.file.includes('background')?1000:30);`);
    const target=path.join(sourceRoot,'target.txt'),background=path.join(sourceRoot,'background.txt');fs.writeFileSync(target,'Target archive evidence');fs.writeFileSync(background,'Background checkpoint');
    const items=(await store.importFiles([target,background],'copy')).imported;const targetItem=items.find(item=>item.title==='target')!,backgroundItem=items.find(item=>item.title==='background')!;
    const order:string[]=[];const start=vi.spyOn(store,'startIndex').mockImplementation((...args)=>{order.push(args[0]);WorkspaceStore.prototype.startIndex.call(store,...args);});
    const indexer=new LibraryIndexer(store,temp(),()=>{},pathToFileURL(worker));indexer.start();
    try {
      await wait(()=>store.indexedPages(backgroundItem.id).length===1);
      await indexer.prioritize('target',undefined,new AbortController().signal,Date.now()+1000);
      expect(store.indexRecord(targetItem.id)?.state).toBe('ready');expect(order.slice(0,2)).toEqual([backgroundItem.id,targetItem.id]);expect(store.indexedPages(backgroundItem.id)[0].text).toBe('Background checkpoint');
      const before=Date.now();await indexer.prioritize('background',undefined,new AbortController().signal,Date.now()+40);expect(Date.now()-before).toBeLessThan(300);expect(store.coverage().pending).toBe(1);
      const controller=new AbortController(),waiting=indexer.prioritize('background',undefined,controller.signal,Date.now()+15000);controller.abort();await expect(waiting).rejects.toThrow();
      await wait(()=>store.coverage().ready===2);expect(start).toHaveBeenCalledTimes(3);expect(store.searchLibrary('checkpoint')).toHaveLength(1);
    }finally{indexer.stop();start.mockRestore();}
  });
});
