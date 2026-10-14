import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import type { IndexedPage } from '../shared/types.js';
const require=createRequire(import.meta.url);
export interface ExtractionJob {file:string;mediaType:string;cachedChecksum?:string;cachedPages:IndexedPage[];cacheDirectory:string}
export async function extractDocument(job:ExtractionJob,emit:(event:any)=>void){
  const bytes=fs.readFileSync(job.file),stat=fs.statSync(job.file);
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  emit({type:'start',checksum,size:bytes.length,mtime:stat.mtimeMs});
  const cached=checksum===job.cachedChecksum?new Map(job.cachedPages.map(page=>[page.page,page])):new Map<number,IndexedPage>();
  let ocr:Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>|undefined;
  const recognize=async(image:Buffer)=>{
    if(!ocr){
      const {createWorker}=await import('tesseract.js');
      const languagePath=path.dirname(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'));
      fs.mkdirSync(job.cacheDirectory,{recursive:true});
      ocr=await createWorker('eng',1,{langPath:languagePath,workerPath:require.resolve('tesseract.js/src/worker-script/node/index.js'),corePath:path.dirname(require.resolve('tesseract.js-core/package.json')),cachePath:job.cacheDirectory,gzip:true,logger:event=>{if(event.status==='recognizing text')emit({type:'progress',progress:event.progress});}});
    }
    const result=await ocr.recognize(image);return result.data.text.trim();
  };
  const page=async(number:number,getText:()=>Promise<IndexedPage>)=>{const result=cached.get(number)||await getText();emit({type:'page',value:result});};
  try{
    if(job.mediaType.startsWith('text/'))await page(1,async()=>({page:1,text:bytes.toString('utf8'),method:'text'}));
    else if(job.mediaType.includes('wordprocessingml'))await page(1,async()=>({page:1,text:(await mammoth.extractRawText({buffer:bytes})).value,method:'text'}));
    else if(job.mediaType.startsWith('image/'))await page(1,async()=>({page:1,text:await recognize(bytes),method:'ocr'}));
    else if(job.mediaType==='application/pdf'){
      const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
      const resourcePath=path.dirname(require.resolve('pdfjs-dist/package.json'));
      const loadingTask=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,standardFontDataUrl:path.join(resourcePath,'standard_fonts/'),cMapUrl:path.join(resourcePath,'cmaps/'),cMapPacked:true});
      try{
        const pdf=await loadingTask.promise;
        emit({type:'total',pages:pdf.numPages});
        for(let number=1;number<=pdf.numPages;number++)await page(number,async()=>{
          const pdfPage=await pdf.getPage(number),content=await pdfPage.getTextContent();
          const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
          const usable=(text.match(/[\p{L}\p{N}]/gu)||[]).length>=30;
          if(usable)return {page:number,text,method:'text'};
          const {createCanvas}=await import('@napi-rs/canvas');
          const base=pdfPage.getViewport({scale:1}),scale=Math.min(2,Math.sqrt(16_000_000/(base.width*base.height)));
          const viewport=pdfPage.getViewport({scale}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await pdfPage.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport}).promise;
          const recognized=await recognize(canvas.toBuffer('image/png'));pdfPage.cleanup();
          return {page:number,text:recognized||text,method:'ocr'};
        });
      }finally{await loadingTask.destroy();}
    }else throw new Error('This file format is not supported for text extraction.');
    const after=fs.statSync(job.file);
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('The file changed during processing. Retry to index the latest version.');
    emit({type:'complete'});
  }finally{await ocr?.terminate();}
}
