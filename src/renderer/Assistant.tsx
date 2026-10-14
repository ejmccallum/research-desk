import { PreparationPanel } from './PreparationPanel';
import { useEffect, useRef, useState } from 'react';
import { Bot, File, MessageSquare, RotateCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { AiSettings, AppState, ChatGptConnectionStatus, ChatMessage, ChatSession, Conversation, IndexCoverage, SourcePassage } from '../shared/types';
import { contextSources } from '../shared/chat';

function friendlyError(value:unknown){const raw=value instanceof Error?value.message:String(value);if(/subscription_sharing_usage_limit|Subscription Sharing usage limit/.test(raw))return 'ChatGPT usage limit reached. Wait for the limit to reset or switch to an API key.';return raw.replace(/^Error invoking remote method '[^']+': Error: /,'');}
export function Reply({content,sources,openSource,available=()=>true}:{content:string;sources:SourcePassage[];openSource:(source:SourcePassage)=>void;available?:(source:SourcePassage)=>boolean}){
  return <div className="reply-markdown"><ReactMarkdown skipHtml urlTransform={url=>url.startsWith('source:')||url.startsWith('https://')?url:''} components={{a:({href,children})=>{
    if(href?.startsWith('source:')){let id='';try{id=decodeURIComponent(href.slice(7));}catch{}const source=sources.find(p=>p.sourceId===id);return source?<button className="source-citation" disabled={!available(source)} title={!available(source)?'Source unavailable':undefined} onClick={()=>openSource(source)}>{children}{!available(source)?' (unavailable)':''}</button>:<span>{children}</span>;}
    return href?<a href={href} onClick={event=>{event.preventDefault();void window.researchDesk.openExternal(href);}}>{children}</a>:<span>{children}</span>;
  }}}>{content.trimEnd()}</ReactMarkdown></div>;
}
const emptyCoverage:IndexCoverage={total:0,ready:0,pending:0,failed:0,unsupported:0,missing:0,failures:[]};
export function AssistantWithModelPicker({state,currentItemId,openSource,restoreDocument}:{state:AppState;currentItemId?:string;openSource:(source:SourcePassage)=>void;restoreDocument?:(id?:string)=>void}){
  const [settings,setSettings]=useState<AiSettings>({configured:false,model:'',provider:null,chatGptConnected:false});
  const [chatGpt,setChatGpt]=useState<ChatGptConnectionStatus>({connected:false,models:[],selectedModel:''});
  const [text,setText]=useState(''),[attached,setAttached]=useState<string[]>([]),[scope,setScope]=useState<'none'|'item'|'workspace'>('none');
  const [messages,setMessages]=useState<ChatMessage[]>([]),[stream,setStream]=useState(''),[sources,setSources]=useState<SourcePassage[]>([]),[coverage,setCoverage]=useState(emptyCoverage),[phase,setPhase]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[changingModel,setChangingModel]=useState(false);
  const [history,setHistory]=useState<Conversation[]>([]),[matches,setMatches]=useState<Conversation[]>([]),[historyQuery,setHistoryQuery]=useState(''),[allOpen,setAllOpen]=useState(false),[title,setTitle]=useState('New chat'),[renaming,setRenaming]=useState(false),[renameText,setRenameText]=useState(''),[loading,setLoading]=useState(true),[sessionItem,setSessionItem]=useState<string>();
  const prepared=useRef(false),scopeChosen=useRef(false);
  const previousItem=useRef(currentItemId),restoringDocument=useRef(false);
  const hydrated=useRef(false),loadVersion=useRef(0),saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),savedSnapshot=useRef(''),searchVersion=useRef(0);
  const session=useRef<ChatSession>({draft:'',scope:'none',evidenceIds:[]});
  const latestState=useRef(state);latestState.current=state;
  const restore=useRef(restoreDocument);restore.current=restoreDocument;
  const conversation=useRef<string>(crypto.randomUUID()),sending=useRef(false),mounted=useRef(true),messagesElement=useRef<HTMLDivElement>(null),followScroll=useRef(true);
  const loadProvider=async()=>{const [ai,account]=await Promise.all([window.researchDesk.getAiSettings(),window.researchDesk.getChatGptStatus()]);if(mounted.current){setSettings(ai);setChatGpt(account);}};
  const refreshHistory=async()=>{const result=await window.researchDesk.listChats();if(mounted.current)setHistory(result.conversations);return result;};
  const updateSession=()=>{session.current={draft:text,scope,itemId:currentItemId||sessionItem,evidenceIds:attached};};
  updateSession();
  const persist=async()=>{
    if(!hydrated.current||!state.workspace)return;
    clearTimeout(saveTimer.current);const id=conversation.current,value={...session.current,evidenceIds:[...session.current.evidenceIds]},snapshot=JSON.stringify(value);
    if(snapshot===savedSnapshot.current)return;
    await window.researchDesk.saveChatSession(id,value,state.workspace.id);
    if(mounted.current&&hydrated.current&&id===conversation.current&&(value.draft.trim()||history.some(chat=>chat.id===id)||messages.length))await window.researchDesk.activateChat(id,state.workspace.id);
    if(id===conversation.current){savedSnapshot.current=snapshot;await refreshHistory();}
  };
  const load=async(id:string)=>{
    const version=++loadVersion.current;hydrated.current=false;setLoading(true);
    try {
      const chat=await window.researchDesk.loadChat(id);
      if(!mounted.current||version!==loadVersion.current)return;
      await window.researchDesk.activateChat(id,state.workspace!.id);
      if(!mounted.current||version!==loadVersion.current)return;
      conversation.current=id;setTitle(chat.conversation.title);setMessages(chat.messages.map(message=>({...message,sources:contextSources(message.contextJson)})));
      setText(chat.session.draft);setScope(chat.session.scope);setAttached(chat.session.evidenceIds);setSessionItem(chat.session.itemId);session.current=chat.session;savedSnapshot.current=JSON.stringify(chat.session);
      restoringDocument.current=Boolean(restore.current);restore.current?.(chat.session.itemId);setStream('');setSources([]);setError('');setAllOpen(false);setRenaming(false);followScroll.current=true;
    } catch(reason){if(mounted.current&&version===loadVersion.current)setError(friendlyError(reason));}
    finally {if(mounted.current&&version===loadVersion.current){hydrated.current=true;setLoading(false);}}
  };
  const switchChat=async(id?:string)=>{
    if(sending.current||loading)return;
    clearTimeout(saveTimer.current);setLoading(true);
    try {
      await persist();
      if(id){await load(id);return;}
      await window.researchDesk.activateChat(null,state.workspace!.id);
      loadVersion.current++;conversation.current=crypto.randomUUID();setTitle('New chat');setText('');setScope(prepared.current?'workspace':'none');scopeChosen.current=false;setAttached([]);setMessages([]);setStream('');setSources([]);setError('');setSessionItem(currentItemId);setAllOpen(false);setRenaming(false);
      session.current={draft:'',scope:prepared.current?'workspace':'none',itemId:currentItemId,evidenceIds:[]};savedSnapshot.current=JSON.stringify(session.current);
    } catch(reason){setError(friendlyError(reason));}finally {if(mounted.current)setLoading(false);}
  };
  useEffect(()=>{
    mounted.current=true;void loadProvider().catch(e=>setError(friendlyError(e)));
    void Promise.all([refreshHistory(),window.researchDesk.getPreparation()]).then(([result,preparation])=>{prepared.current=preparation.enabled||!!state.airtable?.configured;if(!result.activeId){setScope(prepared.current?'workspace':'none');session.current={...session.current,scope:prepared.current?'workspace':'none'};}if(!mounted.current)return;if(result.activeId)return load(result.activeId);savedSnapshot.current=JSON.stringify(session.current);hydrated.current=true;setLoading(false);}).catch(e=>{setError(friendlyError(e));hydrated.current=true;setLoading(false);});
    void window.researchDesk.getIndexCoverage().then(value=>{if(mounted.current)setCoverage(value);}).catch(e=>setError(friendlyError(e)));
    const removeIndex=window.researchDesk.onIndexProgress(value=>{if(mounted.current)setCoverage(value);});
    const removeChat=window.researchDesk.onChatChunk(event=>{if(event.conversationId!==conversation.current||!sending.current)return;if(event.reset)setStream('');if(event.delta)setStream(value=>value+event.delta);if(event.phase)setPhase(event.phase);if(event.sources)setSources(event.sources);if(event.coverage)setCoverage(event.coverage);if(event.error)setError(friendlyError(event.error));});
    const flush=()=>{if(!hydrated.current||!latestState.current.workspace)return;clearTimeout(saveTimer.current);const snapshot=JSON.stringify(session.current);if(snapshot!==savedSnapshot.current){try{window.researchDesk.flushChatSession(conversation.current,session.current,latestState.current.workspace.id);savedSnapshot.current=snapshot;}catch(reason){setError(friendlyError(reason));}}};
    document.addEventListener('research-desk:flush-chat',flush);window.addEventListener('beforeunload',flush);
    return ()=>{flush();mounted.current=false;hydrated.current=false;loadVersion.current++;searchVersion.current++;clearTimeout(saveTimer.current);document.removeEventListener('research-desk:flush-chat',flush);window.removeEventListener('beforeunload',flush);removeIndex();removeChat();if(sending.current)void window.researchDesk.cancelChat(conversation.current);};
  },[]);
  useEffect(()=>{if(!!state.airtable?.configured){prepared.current=true;if(hydrated.current&&!scopeChosen.current&&!messages.length&&!history.some(chat=>chat.id===conversation.current))setScope('workspace');}},[state.airtable?.configured]);
  useEffect(()=>{if(loading||!hydrated.current)return;saveTimer.current=setTimeout(()=>void persist().catch(reason=>setError(friendlyError(reason))),350);return ()=>clearTimeout(saveTimer.current);},[text,scope,attached,currentItemId,sessionItem,loading]);
  useEffect(()=>{if(!loading){if(restoringDocument.current)restoringDocument.current=false;else if(previousItem.current!==currentItemId)setSessionItem(currentItemId);}previousItem.current=currentItemId;},[currentItemId,loading]);
  useEffect(()=>{if(!allOpen)return;const version=++searchVersion.current;const timer=setTimeout(()=>void window.researchDesk.listChats(historyQuery).then(result=>{if(mounted.current&&version===searchVersion.current)setMatches(result.conversations);}).catch(reason=>setError(friendlyError(reason))),150);return ()=>{clearTimeout(timer);searchVersion.current++;};},[historyQuery,allOpen,history]);
  useEffect(()=>{const element=messagesElement.current;if(element&&followScroll.current)element.scrollTop=element.scrollHeight;},[messages,stream,phase,error]);
  const changeModel=async(model:string)=>{setChangingModel(true);setError('');try{if(settings.provider==='chatgpt')setChatGpt(await window.researchDesk.setChatGptModel(model));else await window.researchDesk.saveAiSettings('',model);await loadProvider();}catch(reason){setError(friendlyError(reason));}finally{setChangingModel(false);}};
  const send=async()=>{
    if(sending.current||loading||changingModel||!settings.configured||!text.trim())return;
    if(scope==='item'&&!currentItemId){setError('Open a document to use Open file only.');return;}
    sending.current=true;setBusy(true);clearTimeout(saveTimer.current);const prompt=text.trim(),id=conversation.current;setText('');session.current={...session.current,draft:''};savedSnapshot.current='';setStream('');setSources([]);setError('');setPhase('Searching library');followScroll.current=true;
    setMessages(value=>[...value,{id:crypto.randomUUID(),conversationId:id,role:'user',content:prompt,contextJson:'{}',createdAt:new Date().toISOString(),sources:[]}]);
    try{
      await window.researchDesk.chat({conversationId:id,message:prompt,itemId:currentItemId,evidenceIds:attached.filter(id=>state.evidence.some(e=>e.id===id)),scope});
    }catch(reason){if(mounted.current&&conversation.current===id)setError(friendlyError(reason));}
    finally {
      if(mounted.current&&conversation.current===id){
        try{const chat=await window.researchDesk.loadChat(id);if(mounted.current&&conversation.current===id){setMessages(chat.messages);setTitle(chat.conversation.title);await refreshHistory();}}catch(reason){if(mounted.current)setError(friendlyError(reason));}
        if(mounted.current){setStream('');setSources([]);setBusy(false);setPhase('');}
      }
      sending.current=false;
    }
  };
  const available=(source:SourcePassage)=>state.items.some(item=>item.id===source.itemId&&!item.missing);
  const apiModels=Array.from(new Set([settings.model,'gpt-5-mini','gpt-5','gpt-4.1'].filter(Boolean)));
  return <div className="assistant">
    <div className="side-heading"><span>Research assistant</span><Bot size={17}/></div>
    <div className="chat-history">
      <div className="chat-history-heading"><strong title={title}>{title}</strong><button disabled={busy||loading} onClick={()=>void switchChat()}>New chat</button></div>
      {renaming?<form className="chat-rename" onSubmit={event=>{event.preventDefault();void window.researchDesk.renameChat(conversation.current,renameText).then(chat=>{setTitle(chat.title);setRenaming(false);return refreshHistory();}).catch(reason=>setError(friendlyError(reason)));}}><input autoFocus aria-label="Chat title" value={renameText} onChange={event=>setRenameText(event.target.value)}/><button disabled={!renameText.trim()}>Save</button><button type="button" onClick={()=>setRenaming(false)}>Cancel</button></form>:history.some(chat=>chat.id===conversation.current)&&<button className="chat-rename-button" disabled={busy||loading} onClick={()=>{setRenameText(title);setRenaming(true);}}>Rename</button>}
      <div className="recent-chats">{history.slice(0,3).map(chat=><button key={chat.id} className={chat.id===conversation.current?'active':''} disabled={busy||loading} title={chat.title} onClick={()=>void switchChat(chat.id)}>{chat.title}</button>)}</div>
      <button className="all-chats-toggle" aria-expanded={allOpen} disabled={busy||loading} onClick={()=>{setMatches(history);setAllOpen(value=>!value);}}>All chats ▾</button>
      {allOpen&&<div className="all-chats"><input aria-label="Search chats" placeholder="Search titles and messages…" value={historyQuery} onChange={event=>setHistoryQuery(event.target.value)}/><div>{matches.map(chat=><button key={chat.id} onClick={()=>void switchChat(chat.id)}><span>{chat.title}</span><small>{new Date(chat.updatedAt).toLocaleDateString()}</small></button>)}{!matches.length&&<p>No saved chats found.</p>}</div></div>}
      {busy&&<small>Finish or cancel the reply to switch chats.</small>}{loading&&<small role="status">Opening chat…</small>}
    </div>
    {settings.configured&&<div className="provider-strip model-picker"><span>{settings.provider==='chatgpt'?'Using ChatGPT plan':'Using OpenAI API'}</span><select aria-label="Assistant model" value={settings.model} disabled={busy||changingModel} onChange={event=>void changeModel(event.target.value)}>{settings.provider==='chatgpt'?chatGpt.models.map(model=><option key={model.slug} value={model.slug}>{model.displayName}</option>):apiModels.map(model=><option key={model} value={model}>{model}</option>)}</select>{settings.provider==='chatgpt'&&<button aria-label="Refresh available models" disabled={busy||changingModel} onClick={async()=>{setChangingModel(true);try{setChatGpt(await window.researchDesk.refreshChatGptModels());await loadProvider();}catch(e){setError(friendlyError(e));}finally{setChangingModel(false);}}}><RotateCw size={13}/></button>}</div>}
    {!settings.configured&&<div className="setup-state"><Bot size={30}/><h3>Connect an AI provider</h3><small>Open Settings → Personal ChatGPT, or add an API key.</small></div>}
    <div className="context">{state.airtable?.configured&&<p className="fineprint">Airtable: {state.airtable.records} cached records{state.airtable.refreshedAt?` · refreshed ${new Date(state.airtable.refreshedAt).toLocaleString()}`:" · not yet refreshed"}. Manage refresh and proposals in Settings.</p>}<label className="eyebrow" htmlFor="search-scope">SEARCH SCOPE</label><select id="search-scope" value={scope} disabled={busy||loading} onChange={event=>{scopeChosen.current=true;setScope(event.target.value as 'none'|'item'|'workspace');}}><option value="workspace">Entire workspace</option><option value="none">No document access</option><option value="item" disabled={!currentItemId}>Open file only</option></select>{sessionItem&&!state.items.some(item=>item.id===sessionItem&&!item.missing)&&<p className="fineprint">This chat’s working document is unavailable.</p>}{currentItemId&&<span className="chip"><File size={12}/>{state.items.find(item=>item.id===currentItemId)?.title}</span>}
      {state.workspace&&<PreparationPanel workspaceId={state.workspace.id} compact onChange={status=>{prepared.current=status.enabled||!!state.airtable?.configured;if(status.enabled&&!scopeChosen.current&&!messages.length&&!history.some(chat=>chat.id===conversation.current))setScope('workspace');}}/>}
      {attached.map(id=><span className="chip" key={id}>{state.evidence.find(item=>item.id===id)?.title||'Evidence unavailable'}<button disabled={busy} onClick={()=>setAttached(value=>value.filter(item=>item!==id))}>×</button></span>)}<select aria-label="Attach evidence" disabled={busy||loading} value="" onChange={event=>setAttached(value=>value.includes(event.target.value)?value:[...value,event.target.value])}><option value="">Attach evidence…</option>{state.evidence.filter(item=>!attached.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><p className="fineprint">Relevant source passages are sent to your AI provider for thorough review.</p>
    </div>
    <div className="messages" ref={messagesElement} onScroll={()=>{const element=messagesElement.current;if(element)followScroll.current=element.scrollHeight-element.scrollTop-element.clientHeight<60;}}>{messages.map((message,index)=><div className={`message ${message.role}`} key={index}><strong>{message.role==='user'?'You':'Assistant'}</strong>{message.role==='assistant'&&<><ConfigurationReference context={message.contextJson}/><ReviewReference context={message.contextJson}/></>}{message.role==='assistant'?<Reply content={message.content} sources={message.sources||[]} openSource={openSource} available={available}/>:<p>{message.content}</p>}{message.role==='assistant'&&message.status&&message.status!=='complete'&&<div className="reply-status"><span>{message.status==='pending'?'Reply in progress':`${message.status} reply`}{message.error?` · ${message.error}`:''}</span><button disabled={busy||loading} onClick={()=>setText(messages.slice(0,index).filter(previous=>previous.role==='user').at(-1)?.content||'')}>Retry question</button></div>}{(message.sources||[]).length>0&&<details className="reply-sources"><summary>Sources read ({(message.sources||[]).length})</summary>{(message.sources||[]).map(source=><button key={source.sourceId} disabled={!available(source)} onClick={()=>openSource(source)}>{source.title} · {source.locator}{source.method==='ocr'?' · OCR':''}{!available(source)?' · unavailable':''}</button>)}</details>}</div>)}{stream&&<div className="message assistant"><strong>Assistant</strong><Reply content={stream} sources={sources} openSource={openSource} available={available}/></div>}{busy&&<p className="chat-phase" role="status">{phase||'Working…'}</p>}{error&&<div className="error-message" role="alert">{error}</div>}</div>
    <div className="composer"><textarea aria-label="Research question" value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();void send();}}} placeholder={settings.configured?'Ask about your library…':'Connect ChatGPT or configure an API key'} disabled={!settings.configured||loading}/><div><span>Enter to send · Shift+Enter for newline</span>{busy?<button onClick={()=>void window.researchDesk.cancelChat(conversation.current).catch(e=>setError(friendlyError(e)))}>Cancel</button>:<button className="primary" disabled={!settings.configured||loading||changingModel||!text.trim()} onClick={()=>void send()}><MessageSquare size={15}/>Send</button>}</div></div>
  </div>;
}

function ConfigurationReference({context}:{context:string}){try{const project=JSON.parse(context).project;return project?<small className="fineprint">Project setup v{project.version} · memory revision {project.memoryRevision}</small>:null;}catch{return null;}}

function ReviewReference({context}:{context:string}){try{const review=JSON.parse(context).review;return review?.documents?.length?<details className="reply-sources"><summary>Document review ({review.documents.length})</summary>{review.documents.map((document:any)=><p key={document.itemId}>{document.title} · {document.complete?'complete text review':`${document.reviewedPassages}/${document.totalPassages} passages reviewed`}<small> · version {document.checksum.slice(0,10)}</small></p>)}{review.limit&&<p>{review.limit}</p>}{review.fallback&&<p>Bounded local review; provider tools unavailable.</p>}</details>:null;}catch{return null;}}
