import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { terms } from './search.js';
import type { WorkspaceStore } from './workspace.js';
import type { PreparationStatus } from '../shared/types.js';

/** Provider time does not consume the question's additional-processing allowance. */
export function processingBudget(indexer:Pick<LibraryIndexer,'prioritize'>,waitMs=600000) {
  let remaining=waitMs;
  return async(query:string,itemId:string|undefined,signal:AbortSignal,onlyItem=false)=>{
    const start=performance.now();
    try {await indexer.prioritize(query,itemId,signal,Date.now()+remaining,onlyItem);}
    finally {remaining=Math.max(0,remaining-Math.max(0,performance.now()-start));}
  };
}

export class LibraryIndexer {
  private worker?:Worker;
  private running=false;
  private scheduled?:ReturnType<typeof setTimeout>;
  private stopped=false;
  private checking=false;
  private lastNotification=0;
  private requested=false;
  private active?:{itemId:string;title:string;pages:number;total:number;generation:number;checksum:string;epoch:number};
  private priorities=new Set<string>();
  private priorityGeneration=-1;
  private pauseActive?:()=>void;
  private interval:ReturnType<typeof setInterval>;
  constructor(private store:WorkspaceStore,private cacheDirectory:string,private notify:(status:PreparationStatus)=>void,private workerFile=new URL('./extraction-worker.js',import.meta.url)){
    store.onLibraryChange=()=>{if(this.active){const item=store.libraryItems().find(item=>item.id===this.active?.itemId);if(store.generation!==this.active.generation||item?.checksum!==this.active.checksum||(store.indexEpoch.get(this.active.itemId)||0)!==this.active.epoch)void this.worker?.terminate();}this.schedule();};
    this.interval=setInterval(()=>this.schedule(),45000);this.interval.unref();
  }
  async prioritize(query:string,itemId:string|undefined,signal:AbortSignal,deadline:number,onlyItem=false) {
    signal.throwIfAborted();if(!this.enabled()||Date.now()>=deadline)return;const generation=this.store.generation;
    if(this.priorityGeneration!==generation){this.priorities.clear();this.priorityGeneration=generation;}
    const queryTerms=new Set(terms(query));
    const candidates=this.store.libraryItems().filter(item=>!item.missing&&(item.id===itemId||!onlyItem&&terms(item.title).some(term=>queryTerms.has(term)))).filter(item=>{
      const record=this.store.indexRecord(item.id);
      if(record?.state==='unsupported')return false;
      if(!record||!['ready','failed'].includes(record.state))return true;
      try{const stat=fs.statSync(this.store.pathFor(item.id));return record.size!==stat.size||record.mtime!==stat.mtimeMs;}catch{return false;}
    }).map(item=>item.id);
    if(!candidates.length)return;
    for(const id of candidates)this.priorities.add(id);
    if(this.active&&!this.priorities.has(this.active.itemId))this.pauseActive?.();
    this.schedule();
    await new Promise<void>((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>finish(signal.reason||new Error('Response cancelled.'));
      const check=()=>{
        if(signal.aborted){abort();return;}
        if(this.stopped||!this.enabled()){finish();return;}
        if(this.store.generation!==generation){finish(new Error('The workspace changed.'));return;}
        const items=this.store.libraryItems();
        const pending=candidates.some(id=>{const item=items.find(item=>item.id===id),record=this.store.indexRecord(id);if(!item||item.missing||record?.state==='unsupported')return false;if(!record||!['ready','failed'].includes(record.state))return true;try{const stat=fs.statSync(this.store.pathFor(id));return stat.size!==record.size||stat.mtimeMs!==record.mtime;}catch{return false;}});
        if(!pending||Date.now()>=deadline){finish();return;}
        timer=setTimeout(check,100);
      };
      signal.addEventListener('abort',abort,{once:true});check();
    });
  }
  private enabled(){const setting=this.store.preparation();return Boolean(this.store.info&&setting.enabled&&!setting.paused&&!this.stopped);}
  status():PreparationStatus{const active=this.active?.generation===this.store.generation?this.active:undefined;const setting=this.store.preparation(),coverage=this.store.coverage();const unavailable=this.store.libraryItems().flatMap(item=>{const record=this.store.indexRecord(item.id),state=item.missing?'missing':record?.state;return ['missing','failed','unsupported'].includes(state)?[{itemId:item.id,title:item.title,state:state as 'missing'|'failed'|'unsupported',error:state==='missing'?'Local file not found; relink it from the library.':record?.error||'Unsupported format.'}]:[];});return {...coverage,unavailable,workspaceId:this.store.info?.id||null,...setting,phase:!setting.enabled?'off':setting.paused?'paused':active?'preparing':this.checking?'checking':coverage.pending?'preparing':coverage.failed||coverage.missing||coverage.unsupported?'problems':'ready',...(active?{current:active.title,processedPages:active.pages,totalPages:active.total}:{})};}
  private publish(force=true){if(force||Date.now()-this.lastNotification>=250){this.lastNotification=Date.now();this.notify(this.status());}}
  start(){this.store.setPreparation(true,false);this.schedule();this.notify(this.status());return this.status();}
  pause(){this.store.setPreparation(true,true);this.interrupt();this.notify(this.status());return this.status();}
  interrupt(){if(this.scheduled)clearTimeout(this.scheduled);this.pauseActive?.();}
  schedule(){if(!this.enabled()){if(this.active)this.pauseActive?.();this.notify(this.status());return;}this.requested=true;if(this.scheduled)clearTimeout(this.scheduled);this.scheduled=setTimeout(()=>void this.run(),100);}
  retry(itemId?:string){this.store.retryIndex(itemId);return this.start();}
  stop(){this.stopped=true;clearInterval(this.interval);this.interrupt();void this.worker?.terminate();}
  private async run(){
    if(this.running||!this.enabled())return;this.running=true;this.requested=false;
    try{
      this.checking=true;this.notify(this.status());
      const generationAtStart=this.store.generation,seen=new Set<string>();
      while(this.store.generation===generationAtStart&&this.enabled()){
        const item=this.store.libraryItems().filter(item=>!seen.has(item.id)).sort((a,b)=>Number(this.priorities.has(b.id))-Number(this.priorities.has(a.id)))[0];
        if(!item)break;seen.add(item.id);
        if(this.stopped||!this.store.info)break;
        if(item.missing){this.priorities.delete(item.id);continue;}
        const supported=item.mediaType.startsWith('text/')||item.mediaType.startsWith('image/')||item.mediaType==='application/pdf'||item.mediaType.includes('wordprocessingml');
        const record=this.store.indexRecord(item.id);
        if(!supported){if(record?.state!=='unsupported')this.store.indexUnsupported(item.id);this.priorities.delete(item.id);continue;}
        let file:string,stat:fs.Stats;try{file=this.store.pathFor(item.id);stat=fs.statSync(file);}catch{continue;}
        if(record&&['ready','failed'].includes(record.state)&&record.size===stat.size&&record.mtime===stat.mtimeMs){this.priorities.delete(item.id);continue;}
        const generation=this.store.generation,expectedChecksum=item.checksum,epoch=this.store.indexEpoch.get(item.id)||0;
        const valid=()=>!this.stopped&&this.store.generation===generation&&(this.store.indexEpoch.get(item.id)||0)===epoch&&this.store.itemChecksum(item.id)===expectedChecksum;
        this.checking=false;this.active={itemId:item.id,title:item.title,pages:0,total:0,generation,checksum:expectedChecksum,epoch};this.notify(this.status());
        await new Promise<void>(resolve=>{
          const worker=new Worker(this.workerFile,{workerData:{file,mediaType:item.mediaType,cachedChecksum:record?.checksum,cachedPages:this.store.indexedPages(item.id),cacheDirectory:this.cacheDirectory}});this.worker=worker;
          let terminal=false,paused=false;
          this.pauseActive=()=>{if(terminal)return;paused=true;terminal=true;void worker.terminate();};
          const failed=(error:string)=>{if(!terminal&&valid()){if(!this.store.indexRecord(item.id))this.store.startIndex(item.id,expectedChecksum,stat.size,stat.mtimeMs);this.store.finishIndex(item.id,error);}terminal=true;};
          worker.on('message',event=>{
            if(terminal)return;
            if(!valid()){terminal=true;void worker.terminate();return;}
            try{
              if(event.type==='start')this.store.startIndex(item.id,event.checksum,event.size,event.mtime);
              else if(event.type==='total'&&this.active)this.active.total=event.pages;
              else if(event.type==='page'){this.store.indexPage(item.id,event.value);if(this.active)this.active.pages=event.value.page;}
              else if(event.type==='complete'){this.store.finishIndex(item.id);terminal=true;}
              else if(event.type==='failed')failed(event.error);
              this.publish(event.type!=='progress');
            }catch(error){failed(error instanceof Error?error.message:String(error));void worker.terminate();}
          });
          worker.on('error',error=>failed(error instanceof Error?error.message:String(error)));worker.on('exit',()=>{if(!terminal)failed('Document processing stopped unexpectedly. Retry this file.');if(paused)seen.delete(item.id);else this.priorities.delete(item.id);resolve();});
        });
        this.worker=undefined;this.active=undefined;this.pauseActive=undefined;
      }
    }finally{this.running=false;this.checking=false;this.active=undefined;this.notify(this.status());if(this.requested)this.schedule();}
  }
}
