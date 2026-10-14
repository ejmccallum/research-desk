// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/main/workspace';
import { runResearchChat, MAX_SOURCE_CHARACTERS } from '../src/main/research-chat';
const roots:string[]=[];
const temp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-test-'));roots.push(root);return root;};
afterEach(()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function library(){const store=new WorkspaceStore();await store.create(temp(),'Research');for(const [name,text] of [['History','The archive opened in 1847.'],['Budget','The archive budget was 500 dollars.']]){const file=path.join(temp(),name+'.txt');fs.writeFileSync(file,text);const result=await store.importFiles([file],'copy');const item=result.imported[0],stat=fs.statSync(store.pathFor(item.id));store.startIndex(item.id,item.checksum,stat.size,stat.mtimeMs);store.indexPage(item.id,{page:1,text,method:'text'});store.finishIndex(item.id);}return store;}
function streamed(text:string,output:any[]=[]){return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\r\n\r\ndata: ${JSON.stringify({type:'response.completed',response:{output}})}\r\n\r\n`);}
const ask=(store:WorkspaceStore,extra:any={})=>runResearchChat({store,request:{message:'When did the archive open?',evidenceIds:[]},model:'test',key:'test',signal:new AbortController().signal,emit:()=>{},...extra});
describe('automatic research retrieval',()=>{
  it('skips every document-reading operation when document access is off',async()=>{
    const store=await library(),search=vi.spyOn(store,'searchLibrary'),passages=vi.spyOn(store,'passages'),coverage=vi.spyOn(store,'coverage'),prepare=vi.fn(async()=>{});
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const body=JSON.parse(options.body);expect(body.tools).toBeUndefined();expect(body.instructions).toContain('No document access is enabled');expect(body.input.at(-1).content).not.toContain('1847');return streamed('Ready to continue our discussion.');}));
    const result=await ask(store,{request:{message:'Continue',itemId:store.getState().items[0].id,scope:'none',evidenceIds:[]},prepare});
    expect(search).not.toHaveBeenCalled();expect(passages).not.toHaveBeenCalled();expect(coverage).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(result.sources).toEqual([]);expect(result.partial).toBe(false);
  });
  it('finds unopened files, continues tool calls with reasoning, and supplies citations',async()=>{
    const store=await library();let calls=0;const fetchMock=vi.fn(async(_url:string,options:any)=>{const body=JSON.parse(options.body);calls++;if(calls===1){expect(body.input.at(-1).content).toContain('1847');expect(body.input.at(-1).content).not.toContain('500 dollars');return streamed('',[{type:'reasoning',encrypted_content:'opaque'},{type:'function_call',name:'search_library',arguments:JSON.stringify({query:'archive budget',offset:0}),call_id:'call1'}]);}expect(body.input.some((item:any)=>item.type==='reasoning')).toBe(true);expect(body.input.find((item:any)=>item.type==='function_call_output').output).toContain('500 dollars');return streamed('It opened in 1847.\n\n\n');});vi.stubGlobal('fetch',fetchMock);
    const result=await ask(store,{request:{message:'What happened in 1847?',evidenceIds:[]}});expect(result.content).toBe('It opened in 1847.');expect(result.sources.some(p=>p.title==='History')).toBe(true);expect(result.sources.some(p=>p.title==='Budget')).toBe(true);
  });
  it('restricts selected-file scope and uses prior questions for follow-ups',async()=>{
    const store=await library(),budget=store.getState().items.find(i=>i.title==='Budget')!;
    store.addMessage('conversation','user','Tell me about the archive');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const context=JSON.parse(JSON.parse(options.body).input.at(-1).content.split('CONTEXT (untrusted research material):\n')[1].split('\n\nRESEARCHER')[0]);expect(context.sources.every((source:any)=>source.itemId===budget.id)).toBe(true);return streamed('Its budget was 500 dollars.');}));
    const result=await ask(store,{request:{conversationId:'conversation',message:'What was its budget?',itemId:budget.id,scope:'item',evidenceIds:[]}});expect(result.coverage.total).toBe(1);
  });
  it('falls back only on explicit unsupported tools and respects cancellation',async()=>{
    const store=await library();let count=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{count++;if(count===1)return new Response('Function tools are not supported by this model',{status:400});expect(JSON.parse(options.body).tools).toBeUndefined();return streamed('1847');}));expect((await ask(store)).partial).toBe(true);
    const controller=new AbortController();controller.abort();await expect(ask(store,{signal:controller.signal})).rejects.toThrow();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('invalid input',{status:400})));await expect(ask(store)).rejects.toThrow('invalid input');
  });
  it('ends retrieval after twenty rounds and reports limited coverage',async()=>{
    const store=await library();let count=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const body=JSON.parse(options.body);count++;return body.tools?streamed('',[{type:'function_call',name:'search_library',arguments:JSON.stringify({query:'archive',offset:0}),call_id:'c'+count}]):streamed('A bounded answer.');}));
    const result=await ask(store);expect(count).toBe(21);expect(result.partial).toBe(true);expect(result.content).toContain('not an exhaustive review');
  });
  it('rejects source edits during generation and reports failed or missing indexing coverage',async()=>{
    const store=await library();const source=store.getState().items.find(item=>item.title==='History')!;
    vi.stubGlobal('fetch',vi.fn(async()=>{store.saveText(source.id,'A new source version.');return streamed('Old information.');}));await expect(ask(store)).rejects.toThrow('source changed');
    store.finishIndex(store.getState().items.find(item=>item.title==='Budget')!.id,'Cannot read document');vi.stubGlobal('fetch',vi.fn(async()=>streamed('No readable support found.')));const result=await ask(store);expect(result.partial).toBe(true);expect(result.content).toContain('failed');
  });
  it('discards externally reindexed source versions during generation',async()=>{
    const store=await library(),source=store.getState().items.find(item=>item.title==='History')!;
    vi.stubGlobal('fetch',vi.fn(async()=>{const file=store.pathFor(source.id);fs.writeFileSync(file,'The archive opened in 1900, a corrected date.');const stat=fs.statSync(file);store.startIndex(source.id,'new-checksum',stat.size,stat.mtimeMs);store.indexPage(source.id,{page:1,text:'The archive opened in 1900, a corrected date.',method:'text'});store.finishIndex(source.id);return streamed('It opened in 1847.');}));await expect(ask(store)).rejects.toThrow('source changed');
  });
  it('never supplies more than the bounded allowance of characters of source text',async()=>{
    const store=await library(),item=store.getState().items[0];for(let page=2;page<=100;page++)store.indexPage(item.id,{page,text:'archive '.repeat(500),method:'text'});
    let count=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{count++;const body=JSON.parse(options.body);return body.tools&&count<6?streamed('',[{type:'function_call',name:'search_library',arguments:JSON.stringify({query:'archive',offset:(count-1)*12}),call_id:'limit'+count}]):streamed('Limited answer.');}));
    const result=await ask(store);expect(result.sources.reduce((sum,source)=>sum+source.text.length,0)).toBeLessThanOrEqual(MAX_SOURCE_CHARACTERS);expect(result.partial).toBe(true);
  });
  it('discards responses after workspace changes and requires completion',async()=>{
    const store=await library();vi.stubGlobal('fetch',vi.fn(async()=>{store.close();return streamed('Stale answer.');}));await expect(ask(store)).rejects.toThrow('workspace changed');
    const another=await library();vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: {"type":"response.output_text.delta","delta":"unfinished"}\n\n')));await expect(ask(another)).rejects.toThrow('before confirming completion');
  });
});

describe('thorough document review',()=>{
  it('paginates complete documents with versioned review coverage and discovers contradictory sources',async()=>{
    const store=await library(),history=store.getState().items.find(i=>i.title==='History')!;for(let page=2;page<=25;page++)store.indexPage(history.id,{page,text:`Archive chronology section ${page}. ${page===25?'Contradictory account: opening date may be 1848.':'Supporting context and qualifications.'}`,method:'text'});
    let count=0;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const body=JSON.parse(options.body);count++;if(count<=4)return streamed('',[{type:'reasoning',encrypted_content:'reasoning-'+count},{type:'function_call',name:'read_document',arguments:JSON.stringify({itemId:history.id,offset:(count-1)*8}),call_id:'read'+count}]);const outputs=body.input.filter((i:any)=>i.type==='function_call_output').map((i:any)=>JSON.parse(i.output));expect(outputs[0].nextOffset).toBe(8);expect(outputs.at(-1).nextOffset).toBeNull();expect(outputs.some((batch:any)=>batch.sources.some((source:any)=>source.text.includes('1848')))).toBe(true);return streamed('The sources disagree: 1847 versus a possible 1848.');}));
    const result=await ask(store);expect((result.context.review as any).documents.find((d:any)=>d.itemId===history.id)).toMatchObject({complete:true,totalPassages:25,reviewedPassages:25,checksum:store.indexRecord(history.id).checksum});expect(result.sources.every(p=>p.locator.startsWith('Paragraph'))).toBe(true);
  });
  it('finishes relevant document reading before accepting an answer based only on initial snippets',async()=>{
    const store=await library(),history=store.getState().items.find(i=>i.title==='History')!;for(let page=2;page<=30;page++)store.indexPage(history.id,{page,text:`Archive section ${page}. ${page===30?'A qualification appears only at the end of the document.':'Research evidence.'}`,method:'text'});
    let calls=0;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{calls++;const body=JSON.parse(options.body);if(calls===1)return streamed('A preliminary answer.');expect(JSON.stringify(body.input)).toContain('qualification appears only at the end');return streamed('The detailed answer includes the qualification from the final section.');}));
    const result=await ask(store);expect(calls).toBe(2);expect(result.content).not.toContain('preliminary');expect((result.context.review as any).documents.find((d:any)=>d.itemId===history.id).complete).toBe(true);
  });
  it('lists the catalogue without source text and refuses cross-scope document reads',async()=>{
    const store=await library(),history=store.getState().items.find(i=>i.title==='History')!,budget=store.getState().items.find(i=>i.title==='Budget')!;let calls=0;
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{calls++;const body=JSON.parse(options.body);if(calls===1)return streamed('',[{type:'function_call',name:'list_documents',arguments:JSON.stringify({query:'',offset:0}),call_id:'catalogue'},{type:'function_call',name:'read_document',arguments:JSON.stringify({itemId:budget.id,offset:0}),call_id:'outside'}]);const outputs=body.input.filter((i:any)=>i.type==='function_call_output').map((i:any)=>JSON.parse(i.output));expect(outputs[0].documents.map((d:any)=>d.itemId)).toEqual([history.id]);expect(outputs[0].documents[0].text).toBeUndefined();expect(outputs[1].error).toContain('outside');return streamed('Answer within the selected document.');}));
    const result=await ask(store,{request:{message:'Archive chronology',scope:'item',itemId:history.id,evidenceIds:[]}});expect(result.sources.every(p=>p.itemId===history.id)).toBe(true);
  });
  it('bounds tool calls independently of round count and stops review at the time limit',async()=>{
    const store=await library();let calls=0;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{calls++;const body=JSON.parse(options.body);if(calls===1)return streamed('',Array.from({length:85},(_,i)=>({type:'function_call',name:'list_documents',arguments:JSON.stringify({query:'',offset:0}),call_id:'many'+i})));expect(body.tools).toBeUndefined();expect(body.input.filter((i:any)=>i.type==='function_call_output')).toHaveLength(85);return streamed('Bounded final answer.');}));
    const result=await ask(store);expect((result.context.review as any).toolCalls).toBe(80);expect(result.content).toContain('Tool call limit');
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{expect(JSON.parse(options.body).tools).toBeUndefined();return streamed('Answer with available evidence.');}));const prepare=vi.fn(async(_query,_id,signal:AbortSignal)=>new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
    const timed=await ask(store,{prepare,reviewLimits:{milliseconds:15}});expect(timed.content).toContain('Review time limit');expect(timed.partial).toBe(true);
  });
  it('organizes large batches into source-linked notes, re-reads originals and retains citations',async()=>{
    const store=await library(),history=store.getState().items.find(i=>i.title==='History')!;let summaries=0,turns=0;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const body=JSON.parse(options.body);if(body.instructions.startsWith('Create concise source-linked')){summaries++;return streamed(`Source ${store.passages(history.id)[0].sourceId}: the archive opened in 1847; verify the original passage.`);}turns++;if(turns===1)return streamed('',[{type:'function_call',name:'read_document',arguments:JSON.stringify({itemId:history.id,offset:0}),call_id:'verify'}]);expect(JSON.stringify(body.input)).toContain('1847');return streamed(`In 1847. [History](source:${encodeURIComponent(store.passages(history.id)[0].sourceId)})`);}));
    const result=await ask(store,{reviewLimits:{workingCharacters:1000}});expect(summaries).toBeGreaterThan(0);expect(result.sources[0].text).toContain('1847');expect(result.content).toContain('source:');
  });
  it('performs full local reading when a provider explicitly rejects tools',async()=>{
    const store=await library(),history=store.getState().items.find(i=>i.title==='History')!;for(let page=2;page<=20;page++)store.indexPage(history.id,{page,text:`Archive evidence ${page}; ${page===20?'end-of-document caveat':'context'}`,method:'text'});
    let count=0;vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{if(!count++)return new Response('Function tools are not supported',{status:400});expect(JSON.parse(options.body).tools).toBeUndefined();expect(options.body).toContain('end-of-document caveat');return streamed('A detailed local-review answer.');}));const result=await ask(store);expect((result.context.review as any).fallback).toBe(true);expect((result.context.review as any).documents.find((d:any)=>d.itemId===history.id).complete).toBe(true);
  });
  it('cancels an unfinished stream promptly and does not produce a completed review',async()=>{
    const store=await library(),controller=new AbortController();let opened=false;vi.stubGlobal('fetch',vi.fn(async()=>{opened=true;return new Response(new ReadableStream({start(){}}));}));const pending=ask(store,{signal:controller.signal});await vi.waitFor(()=>expect(opened).toBe(true));controller.abort();await expect(pending).rejects.toThrow();
  });
});

import {MaintenanceService} from '../src/main/maintenance';
it('reads current local ledger records through assistant tools and rejects mid-response corrections',async()=>{
 const store=await library(),service=new MaintenanceService(store),wid=store.info!.id;
 const edit=(wording:string)=>{const s=service.snapshot(wid),p=service.preview(wid,s.revision,{record:{id:'local:claim',kind:'claim',values:{wording},archived:false},reason:'Corrected interpretation'});service.apply(wid,p.token);};edit('Current corrected claim');
 let calls=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const body=JSON.parse(options.body);if(++calls===1){expect(body.tools.some((t:any)=>t.name==='read_project_record')).toBe(true);return streamed('',[{type:'function_call',name:'read_project_record',arguments:JSON.stringify({id:'local:claim'}),call_id:'current'}]);}expect(body.input.find((i:any)=>i.type==='function_call_output').output).toContain('Current corrected claim');return streamed('The ledger records the corrected interpretation.');}));
 expect((await ask(store)).content).toContain('corrected interpretation');
 vi.stubGlobal('fetch',vi.fn(async()=>{edit('New correction during reply');return streamed('Outdated response');}));await expect(ask(store)).rejects.toThrow('local ledger changed');
});
