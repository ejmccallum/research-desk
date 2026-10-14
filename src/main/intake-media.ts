import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Worker} from 'node:worker_threads';
import type {IndexedPage} from '../shared/types.js';
const require=createRequire(import.meta.url);
export function inventoryFile(file:string,mediaType:string,cacheDirectory:string,signal:AbortSignal,workerUrl=new URL('./extraction-worker.js',import.meta.url)):Promise<IndexedPage[]> {
 return new Promise((resolve,reject)=>{
  const worker=new Worker(workerUrl,{workerData:{file,mediaType,cacheDirectory,cachedPages:[]}}),pages:IndexedPage[]=[];
  let settled=false;const finish=(error?:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(pages);};
  const abort=()=>finish(new Error('Inventory interrupted.'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
  worker.on('message',e=>{if(e.type==='page')pages.push(e.value);if(e.type==='complete')finish();if(e.type==='failed')finish(new Error(e.error));});worker.on('error',finish);worker.on('exit',()=>{if(!settled)finish(new Error('Extraction worker exited before completion.'));});
 });
}
export async function renderPage(file:string,mediaType:string,page:number):Promise<string|null>{
 if(!mediaType.startsWith('image/')&&mediaType!=='application/pdf')return null;
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 if(mediaType.startsWith('image/')){const img=await loadImage(fs.readFileSync(file));const scale=Math.min(1,2000/Math.max(img.width,img.height));const canvas=createCanvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale)));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return 'data:image/png;base64,'+canvas.toBuffer('image/png').toString('base64');}
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const resources=path.dirname(require.resolve('pdfjs-dist/package.json'));
 const task=getDocument({data:new Uint8Array(fs.readFileSync(file)),useSystemFonts:true,standardFontDataUrl:path.join(resources,'standard_fonts/'),cMapUrl:path.join(resources,'cmaps/'),cMapPacked:true});
 try{const pdf=await task.promise,p=await pdf.getPage(page),base=p.getViewport({scale:1}),viewport=p.getViewport({scale:Math.min(2,2000/Math.max(base.width,base.height))}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await p.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport}).promise;return 'data:image/png;base64,'+canvas.toBuffer('image/png').toString('base64');}finally{await task.destroy();}
}
