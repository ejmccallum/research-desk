import { projectContext } from './project.js';
import crypto from 'node:crypto';
import type { ChatProgress, ChatRequest, ChatResult, MessageStatus } from '../shared/types.js';
import type { WorkspaceStore } from './workspace.js';
import { runResearchChat } from './research-chat.js';

function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||new Error('Response cancelled.'));};
    operation.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}

/** Owns durable turns independently of the renderer and checkpoints before workspace changes. */
export class ChatService {
  private active=new Map<string,{controller:AbortController;checkpoint:(status:MessageStatus,error?:string)=>void}>();
  airtable?:import('./airtable.js').AirtableService;
  onCompleted?:(conversationId:string,userId:string,assistantId:string,configurationId:string)=>void;
  constructor(private store:WorkspaceStore,private run:(options:Parameters<typeof runResearchChat>[0])=>Promise<{content:string;context:Record<string,unknown>;sources:import('../shared/types.js').SourcePassage[];coverage:import('../shared/types.js').IndexCoverage;partial:boolean}>=runResearchChat) {}
  isBusy(id:string){return this.active.has(id);}
  cancel(id:string){this.active.get(id)?.controller.abort();}
  interrupt(){for(const turn of this.active.values()){turn.checkpoint('interrupted','The workspace or app closed before this reply finished.');turn.controller.abort();}this.active.clear();}
  async send(request:ChatRequest,credentials:()=>Promise<{model:string;key:string}>,emit:(event:ChatProgress)=>void,prepare?:Parameters<typeof runResearchChat>[0]['prepare']):Promise<ChatResult> {
    if(!request.message?.trim())throw new Error('Enter a question first.');
    if(!this.store.info)throw new Error('Open a workspace first.');
    const conversationId=request.conversationId||crypto.randomUUID();
    if(this.isBusy(conversationId))throw new Error('A response is already running in this conversation.');
    const generation=this.store.generation,controller=new AbortController(),workspaceId=this.store.info.id;
    const project=projectContext(this.store);
    const context={project,scope:request.scope||'workspace',selectedDocument:request.itemId?{id:request.itemId}:null,evidenceIds:request.evidenceIds,sources:[]};
    const user=this.store.addMessage(conversationId,'user',request.message,JSON.stringify(context));
    this.store.saveChatSession(conversationId,{draft:'',scope:request.scope||'workspace',itemId:request.itemId,evidenceIds:request.evidenceIds},workspaceId);
    this.store.activateChat(conversationId,workspaceId);
    const assistant=this.store.addMessage(conversationId,'assistant','',JSON.stringify(context),'pending');
    let text='',metadata:Record<string,unknown>=context,lastCheckpoint=Date.now(),terminal=false,dirty=false;
    const valid=()=>{controller.signal.throwIfAborted();if(this.store.generation!==generation)throw new Error('The workspace changed. This response was discarded.');};
    const checkpoint=(status:MessageStatus,error='')=>{
      if(terminal||this.store.generation!==generation)return;
      const message=this.store.updateMessage(assistant.id,text.trimEnd(),JSON.stringify(metadata),status,error);
      lastCheckpoint=Date.now();dirty=false;if(status!=='pending')terminal=true;return message;
    };
    this.active.set(conversationId,{controller,checkpoint});
    const timer=setInterval(()=>{if(dirty&&!terminal)checkpoint('pending');},1000);timer.unref();
    const progress=(event:Omit<ChatProgress,'conversationId'>)=>{
      valid();if(event.reset)text='';text+=event.delta;
      for(const key of ['sources','coverage','review','partial'] as const)if(event[key]!==undefined)metadata[key]=event[key];
      dirty=true;
      if(Date.now()-lastCheckpoint>=1000)checkpoint('pending');
      emit({conversationId,...event});
    };
    try {
      const {model,key}=await abortable(credentials(),controller.signal);valid();
      const result=await abortable(this.run({store:this.store,request:{...request,conversationId,currentMessageId:user.id},model,key,signal:controller.signal,emit:progress,prepare,project,airtable:this.airtable}),controller.signal);valid();
      text=result.content;metadata={...result.context,project};const message=checkpoint('complete')!;
      emit({conversationId,delta:'',done:true,sources:result.sources,coverage:result.coverage,review:metadata.review as import('../shared/types.js').ReviewCoverage|undefined,partial:result.partial});
      if(project)try{this.onCompleted?.(conversationId,user.id,assistant.id,project.configurationId);}catch{/* Memory failures never fail a completed reply. */}
      return {conversationId,message,sources:result.sources,coverage:result.coverage,review:metadata.review as import('../shared/types.js').ReviewCoverage|undefined,partial:result.partial};
    } catch(error) {
      const message=controller.signal.aborted?'Response cancelled.':error instanceof Error?error.message:String(error);
      checkpoint(controller.signal.aborted?'cancelled':'failed',message);
      emit({conversationId,delta:'',done:true,error:message});throw new Error(message);
    } finally {clearInterval(timer);if(this.active.get(conversationId)?.controller===controller)this.active.delete(conversationId);}
  }
}
