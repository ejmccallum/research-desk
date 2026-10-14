import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AssistantWithModelPicker, Reply } from '../src/renderer/Assistant';
import type { AppState, ChatMessage, ChatSession, LoadedChat, SourcePassage } from '../src/shared/types';
const state:AppState={workspace:{id:'workspace',name:'Study',path:'/tmp/test',createdAt:'',schemaVersion:1},items:[],evidence:[],claims:[],claimLinks:[],tasks:[],checks:[],conversations:[]};
const coverage={total:0,ready:0,pending:0,failed:0,unsupported:0,missing:0,failures:[]};
const source:SourcePassage={sourceId:'item:1:0',itemId:'item',title:'History',page:1,paragraph:1,locator:'Page 1',method:'ocr',text:'Archive evidence'};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const preparationApi={getPreparation:async()=>({workspaceId:'workspace',enabled:false,paused:false,phase:'off',...coverage}),onPreparationProgress:()=>()=>{}};
function setup(){const chat=vi.fn((_request:unknown)=>new Promise<any>(()=>{}));window.researchDesk={...preparationApi,listChats:vi.fn(async()=>({conversations:[],activeId:null})),saveChatSession:vi.fn(async()=>{}),flushChatSession:vi.fn(),activateChat:vi.fn(async()=>{}),getAiSettings:async()=>({configured:true,model:'test',provider:'api-key',chatGptConnected:false}),getChatGptStatus:async()=>({connected:false,models:[],selectedModel:''}),getIndexCoverage:async()=>coverage,onIndexProgress:()=>()=>{},onChatChunk:()=>()=>{},cancelChat:vi.fn(async()=>{}),chat} as any;render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);return chat;}
describe('assistant interaction',()=>{
  it('sends on Enter without automatic document access and prevents overlapping sends',async()=>{
    const chat=setup();const input=screen.getByRole('textbox',{name:'Research question'});await waitFor(()=>expect(input).not.toBeDisabled());fireEvent.change(input,{target:{value:'Find archive evidence'}});fireEvent.keyDown(input,{key:'Enter'});expect(chat).toHaveBeenCalledTimes(1);expect(chat.mock.calls[0][0]).toMatchObject({scope:'none',message:'Find archive evidence'});fireEvent.change(input,{target:{value:'Second message'}});fireEvent.keyDown(input,{key:'Enter'});expect(chat).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Cancel'})).toBeInTheDocument();
  });
  it('keeps Shift+Enter and composition input from sending',async()=>{
    const chat=setup();const input=screen.getByRole('textbox',{name:'Research question'});await waitFor(()=>expect(input).not.toBeDisabled());fireEvent.change(input,{target:{value:'Question'}});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',keyCode:229});expect(chat).not.toHaveBeenCalled();expect(screen.getByText('Enter to send · Shift+Enter for newline')).toBeInTheDocument();
  });
  it('renders compact Markdown, preserves code formatting, and opens only verified citations',()=>{
    const open=vi.fn();const {container}=render(<Reply content={'A **bold** answer.\n\n[History](source:item%3A1%3A0)\n\n[Fake](source:unknown)\n\n```text\nline one\n\nline three\n```\n\n\n<script>alert(1)</script>'} sources={[source]} openSource={open}/>);expect(container.querySelector('strong')?.textContent).toBe('bold');fireEvent.click(screen.getByRole('button',{name:'History'}));expect(open).toHaveBeenCalledWith(source);expect(screen.queryByRole('button',{name:'Fake'})).toBeNull();expect(container.querySelector('script')).toBeNull();expect(container.querySelector('pre')?.textContent).toContain('line one\n\nline three');
  });
});

function savedChats(){
  const conversations=['Chronology','Funding','Manuscript','Older topic'].map((title,index)=>({id:'chat'+index,title,createdAt:'2026-01-01',updatedAt:'2026-01-02'}));
  const messages:ChatMessage[]=[{id:'u',conversationId:'chat0',role:'user',content:'When did the archive open?',contextJson:'{}',createdAt:''},{id:'a',conversationId:'chat0',role:'assistant',content:'In 1847. [History](source:item%3A1%3A0)',contextJson:JSON.stringify({sources:[source]}),createdAt:'',status:'complete'}];
  const session:ChatSession={draft:'Continue this chronology',scope:'item',itemId:'item',evidenceIds:['missing-evidence']};
  const chats=conversations.map((conversation,index):LoadedChat=>({conversation,messages:index===0?messages:[],session:index===0?session:{draft:'',scope:'workspace',evidenceIds:[]}}));
  const api={getAiSettings:async()=>({configured:true,model:'test',provider:'api-key',chatGptConnected:false}),getChatGptStatus:async()=>({connected:false,models:[],selectedModel:''}),getIndexCoverage:async()=>({...coverage,total:20,pending:20}),onIndexProgress:()=>()=>{},onChatChunk:()=>()=>{},cancelChat:vi.fn(async()=>{}),chat:vi.fn(async()=>({message:messages[1],sources:[source],coverage,partial:false})),listChats:vi.fn(async(query='')=>({conversations:conversations.filter(chat=>!query||chat.title.toLowerCase().includes(query.toLowerCase())),activeId:'chat0'})),loadChat:vi.fn(async(id:string)=>chats.find(chat=>chat.conversation.id===id)!),activateChat:vi.fn(async()=>{}),saveChatSession:vi.fn(async()=>{}),flushChatSession:vi.fn(),renameChat:vi.fn(async(_id:string,title:string)=>({...conversations[0],title})),retryIndex:vi.fn(async()=>{})};
  window.researchDesk={...preparationApi,...api} as any;return {api,chats};
}
describe('chat history sidebar',()=>{
  it('opens the last chat during indexing and restores its transcript, draft and unavailable context',async()=>{
    const {api}=savedChats(),restore=vi.fn();render(<AssistantWithModelPicker state={state} restoreDocument={restore} openSource={()=>{}}/>);
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Research question'})).toHaveValue('Continue this chronology'));
    expect(screen.getByRole('combobox',{name:'SEARCH SCOPE'})).toHaveValue('item');expect(restore).toHaveBeenCalledWith('item');expect(screen.getByText('When did the archive open?')).toBeInTheDocument();expect(screen.getByText('Evidence unavailable')).toBeInTheDocument();expect(screen.getByRole('button',{name:'History (unavailable)'})).toBeDisabled();expect(screen.getByRole('button',{name:'Prepare workspace documents'})).toBeInTheDocument();expect(api.retryIndex).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Chronology'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Funding'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Manuscript'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Older topic'})).toBeNull();
  });
  it('searches all historical chats, switches conversations and creates an empty new chat',async()=>{
    const {api}=savedChats();render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'New chat'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'All chats ▾'}));fireEvent.change(screen.getByRole('textbox',{name:'Search chats'}),{target:{value:'Older'}});
    await waitFor(()=>expect(api.listChats).toHaveBeenCalledWith('Older'));fireEvent.click(await screen.findByRole('button',{name:/Older topic/}));await waitFor(()=>expect(api.activateChat).toHaveBeenCalledWith('chat3','workspace'));expect(screen.getByRole('textbox',{name:'Research question'})).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'New chat'}));await waitFor(()=>expect(api.activateChat).toHaveBeenCalledWith(null,'workspace'));expect(screen.getByText('New chat',{selector:'strong'})).toBeInTheDocument();expect(screen.queryByText('When did the archive open?')).toBeNull();
  });
  it('saves drafts after debounce, flushes before closing, and renames chats',async()=>{
    const {api}=savedChats();render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);const input=screen.getByRole('textbox',{name:'Research question'});
    await waitFor(()=>expect(input).toHaveValue('Continue this chronology'));fireEvent.change(input,{target:{value:'Unfinished work'}});
    await waitFor(()=>expect(api.saveChatSession).toHaveBeenCalledWith('chat0',expect.objectContaining({draft:'Unfinished work',scope:'item',evidenceIds:['missing-evidence']}),'workspace'));
    fireEvent.change(input,{target:{value:'Latest unsaved draft'}});document.dispatchEvent(new Event('research-desk:flush-chat'));expect(api.flushChatSession).toHaveBeenCalledWith('chat0',expect.objectContaining({draft:'Latest unsaved draft'}),'workspace');
    fireEvent.click(screen.getByRole('button',{name:'Rename'}));fireEvent.change(screen.getByRole('textbox',{name:'Chat title'}),{target:{value:'A focused research piece'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(screen.getByText('A focused research piece',{selector:'strong'})).toBeInTheDocument());
  });
  it('shows interrupted replies with their saved text and lets the researcher retry',async()=>{
    const {chats}=savedChats();chats[0].messages[1]={...chats[0].messages[1],status:'interrupted',error:'App closed'};render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Retry question'})).toBeEnabled());expect(screen.getByText('interrupted reply · App closed')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retry question'}));expect(screen.getByRole('textbox',{name:'Research question'})).toHaveValue('When did the archive open?');
  });
  it('keeps missing working-document references when restoring closes the previously open document',async()=>{
    savedChats();
    function Harness(){const [current,setCurrent]=useState<string|undefined>('previous-document');return <AssistantWithModelPicker state={state} currentItemId={current} restoreDocument={()=>setCurrent(undefined)} openSource={()=>{}}/>;}
    render(<Harness/>);await waitFor(()=>expect(screen.getByRole('textbox',{name:'Research question'})).toHaveValue('Continue this chronology'));
    expect(screen.getByText('This chat’s working document is unavailable.')).toBeInTheDocument();fireEvent.change(screen.getByRole('textbox',{name:'Research question'}),{target:{value:'Continue working'}});
    await waitFor(()=>expect(window.researchDesk.saveChatSession).toHaveBeenCalledWith('chat0',expect.objectContaining({itemId:'item'}),'workspace'));
  });
  it('prevents chat switching while a response is running',async()=>{
    const {api,chats}=savedChats();chats[0].session={draft:'Question',scope:'workspace',evidenceIds:[]};api.chat=vi.fn(()=>new Promise<any>(()=>{}));render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);const input=screen.getByRole('textbox',{name:'Research question'});await waitFor(()=>expect(input).toHaveValue('Question'));fireEvent.keyDown(input,{key:'Enter'});
    expect(screen.getByRole('button',{name:'New chat'})).toBeDisabled();expect(screen.getByRole('button',{name:'Funding'})).toBeDisabled();expect(screen.getByText('Finish or cancel the reply to switch chats.')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(api.cancelChat).toHaveBeenCalledWith('chat0');
  });
});

it('defaults fresh prepared chats to the whole workspace and preserves an explicit no-access selection',async()=>{
  const {api}=savedChats();const preparedStatus={...coverage,workspaceId:'workspace',enabled:true,paused:false,phase:'ready'};
  window.researchDesk={...preparationApi,...api,listChats:async()=>({conversations:[],activeId:null}),getPreparation:async()=>preparedStatus} as any;
  render(<AssistantWithModelPicker state={state} openSource={()=>{}}/>);const scope=screen.getByRole('combobox',{name:'SEARCH SCOPE'});await waitFor(()=>expect(scope).toHaveValue('workspace'));
  fireEvent.change(scope,{target:{value:'none'}});expect(scope).toHaveValue('none');fireEvent.click(screen.getByRole('button',{name:'New chat'}));await waitFor(()=>expect(scope).toHaveValue('workspace'));
});
