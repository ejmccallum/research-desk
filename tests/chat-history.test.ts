// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStore } from '../src/main/workspace';
import { ChatService } from '../src/main/chat-service';
import { runResearchChat } from '../src/main/research-chat';
import { contextSources } from '../src/shared/chat';
const roots:string[]=[];
const temp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-history-'));roots.push(root);return root;};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const request={conversationId:'chat',message:'Investigate the archive',scope:'workspace' as const,evidenceIds:['evidence']};
const credentials=async()=>({key:'test',model:'test'});
const coverage={total:0,ready:0,pending:0,failed:0,unsupported:0,missing:0,failures:[]};
const result={content:'A completed answer.',sources:[],coverage,partial:false,context:{conversationHistory:[],scope:'workspace' as const,selectedDocument:null,selectedText:null,evidence:[],sources:[],coverage,partial:false}};
async function workspace(){const store=new WorkspaceStore();await store.create(temp(),'History');return store;}
describe('durable workspace chats',()=>{
  it('recovers legacy messages, citations, attachments and stable same-timestamp ordering',async()=>{
    const store=await workspace(),root=store.root!;
    const file=path.join(temp(),'source.txt');fs.writeFileSync(file,'Original text');const item=(await store.importFiles([file],'copy')).imported[0];
    const evidence=store.createEvidence({sourceId:item.id,title:'Quote',quotation:'Original text'}).evidence[0];
    const source={sourceId:'source:1',itemId:item.id,title:'Source',text:'Original text',page:1,paragraph:1,locator:'Paragraph 1',method:'text'};
    store.db!.run('INSERT INTO conversations VALUES (?,?,?,?)',['legacy','Old research','same','same']);
    for(const [id,role,content] of [['u','user','Original question'],['a','assistant','[Source](source:source%3A1)']])store.db!.run('INSERT INTO messages VALUES (?,?,?,?,?,?)',[id,'legacy',role,content,JSON.stringify({selectedDocument:{id:item.id},scope:'item',sources:[source],evidence:[{title:evidence.title,quotation:evidence.quotation}]}),'same']);
    store.rename('Save legacy data');store.close();await store.open(root);
    expect(store.listChats().activeId).toBe('legacy');
    const loaded=store.loadChat('legacy');expect(loaded.messages.map(message=>message.id)).toEqual(['u','a']);expect(loaded.messages[1].status).toBe('complete');expect(loaded.messages[1].sources).toEqual([source]);expect(loaded.session).toMatchObject({itemId:item.id,scope:'item',evidenceIds:[evidence.id]});
    expect(contextSources('{bad json')).toEqual([]);expect(contextSources('{"sources":[{"sourceId":"fake"}]}')).toEqual([]);
  });
  it('persists drafts and active chat, searches message content, renames and includes chats in archives',async()=>{
    const store=await workspace(),root=store.root!,workspaceId=store.info!.id;
    store.saveChatSession('empty',{draft:'',scope:'workspace',evidenceIds:[]},workspaceId);store.activateChat('empty',workspaceId);expect(store.listChats().conversations).toHaveLength(0);expect(store.listChats().activeId).toBeNull();
    const session={draft:'A question to finish later',scope:'item' as const,itemId:'removed-file',evidenceIds:['removed-evidence']};
    store.saveChatSession('draft',session,workspaceId);store.activateChat('draft',workspaceId);store.renameChat('draft','Archive chronology');store.addMessage('draft','user','Look for the zeppelin records');
    store.close();await store.open(root);expect(store.loadChat('draft').session).toEqual(session);expect(store.listChats('zeppelin').conversations[0].title).toBe('Archive chronology');expect(store.listChats('CHRONOLOGY').conversations).toHaveLength(1);
    const archive=path.join(temp(),'history.researchdesk');await store.exportTo(archive);const restored=new WorkspaceStore();await restored.importFrom(archive,temp());expect(restored.loadChat('draft').session).toEqual(session);expect(restored.listChats().activeId).toBe('draft');
    const another=new WorkspaceStore();await another.create(temp(),'Separate');expect(another.listChats().conversations).toEqual([]);expect(()=>another.saveChatSession('draft',session,workspaceId)).toThrow('workspace changed');
  });
  it('saves questions before credentials, preserves failures and retries with a new turn',async()=>{
    const store=await workspace(),service=new ChatService(store,vi.fn(async()=>result));
    await expect(service.send(request,async()=>{expect(store.messages('chat')[0].content).toBe(request.message);throw new Error('Quota exhausted');},()=>{})).rejects.toThrow('Quota exhausted');
    expect(store.messages('chat')[1]).toMatchObject({status:'failed',error:'Quota exhausted'});
    await service.send(request,credentials,()=>{});expect(store.messages('chat')).toHaveLength(4);expect(store.messages('chat')[3].status).toBe('complete');expect(store.loadChat('chat').session.draft).toBe('');
  });
  it('keeps partial replies on cancellation and blocks overlapping sends',async()=>{
    const store=await workspace();
    const run:typeof runResearchChat=async({emit,signal})=>{emit({delta:'Partial answer'});await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return result;};
    const service=new ChatService(store,run),turn=service.send(request,credentials,()=>{});await vi.waitFor(()=>expect(service.isBusy('chat')).toBe(true));
    await expect(service.send(request,credentials,()=>{})).rejects.toThrow('already running');service.cancel('chat');await expect(turn).rejects.toThrow('cancelled');expect(store.messages('chat')[1]).toMatchObject({content:'Partial answer',status:'cancelled'});
  });
  it('cancels immediately while provider credentials are still loading',async()=>{
    const store=await workspace(),service=new ChatService(store,vi.fn(async()=>result));
    const turn=service.send(request,()=>new Promise(()=>{}),()=>{});service.cancel('chat');await expect(turn).rejects.toThrow('cancelled');expect(service.isBusy('chat')).toBe(false);expect(store.messages('chat')[1].status).toBe('cancelled');
  });
  it('checkpoints a quiet stream even when the provider sends no further deltas',async()=>{
    const store=await workspace();vi.useFakeTimers();
    const service=new ChatService(store,async({emit,signal})=>{emit({delta:'Saved during a pause'});await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return result;});
    const turn=service.send(request,credentials,()=>{});await vi.advanceTimersByTimeAsync(1000);expect(store.messages('chat')[1]).toMatchObject({content:'Saved during a pause',status:'pending'});service.cancel('chat');await expect(turn).rejects.toThrow('cancelled');
  });
  it('checkpoints streaming text, recovers an unexpected restart and guards workspace changes',async()=>{
    const store=await workspace(),root=store.root!;let clock=0;vi.spyOn(Date,'now').mockImplementation(()=>clock);
    const service=new ChatService(store,async({emit,signal})=>{clock=1500;emit({delta:'Checkpointed text'});await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return result;});
    const turn=service.send(request,credentials,()=>{});await vi.waitFor(()=>expect(store.messages('chat')[1].content).toBe('Checkpointed text'));
    const recovered=new WorkspaceStore();await recovered.open(root);expect(recovered.messages('chat')[1]).toMatchObject({content:'Checkpointed text',status:'interrupted'});
    store.onBeforeChange=()=>service.interrupt();await store.create(temp(),'Another workspace');await expect(turn).rejects.toThrow('cancelled');expect(store.listChats().conversations).toEqual([]);
    const original=new WorkspaceStore();await original.open(root);expect(original.messages('chat')[1].status).toBe('interrupted');
  });
  it('supplies relevant older chat context and does not duplicate a saved current question',async()=>{
    const store=await workspace();store.addMessage('chat','user','The manuscript project is called Zephyr.');store.addMessage('chat','assistant','We will work on Zephyr.');for(let i=0;i<14;i++)store.addMessage('chat',i%2?'assistant':'user','Other conversation turn '+i);
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const body=JSON.parse(options.body);expect(body.input.filter((item:any)=>item.role==='user'&&item.content.includes('Continue Zephyr'))).toHaveLength(1);expect(body.input.at(-1).content).toContain('The manuscript project is called Zephyr');expect(body.instructions).toContain('not verified documentary evidence');return new Response('data: {"type":"response.output_text.delta","delta":"Continue the manuscript."}\n\ndata: {"type":"response.completed","response":{"output":[]}}\n\n');}));
    const service=new ChatService(store);await service.send({...request,message:'Continue Zephyr'},credentials,()=>{});expect(store.messages('chat').at(-1)?.status).toBe('complete');
  });
});
