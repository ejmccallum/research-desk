import {atomicWrite} from './portable.js';
import { RevisionService } from './revisions.js';
import { MaintenanceService } from './maintenance.js';
import { IntakeService } from './intake.js';
import crypto from 'node:crypto';
import {AirtableService,airtableSnapshot,searchAirtable,readAirtableRecord} from './airtable.js';
import { ProjectMemoryService, projectSnapshot, suppliedProject, saveProject, changeProjectEntry } from './project.js';
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from './workspace.js';
import { LibraryIndexer, processingBudget } from './indexer.js';
import { ChatService } from './chat-service.js';
import { GoogleDrive } from './google-drive.js';
import { ChatGptAuth } from './chatgpt-auth.js';
import type { BrandConfig, ChatRequest, EvidenceRecord, ImportMode } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readinessRoot=process.env.RESEARCH_DESK_READINESS_ROOT;
const testProfile=readinessRoot?`${readinessRoot}-profile`:process.env.RESEARCH_DESK_TEST_PROFILE;
if(testProfile){if(!path.isAbsolute(testProfile))throw Error('Test profile must be absolute.');app.setPath('userData',testProfile);}
const store = new WorkspaceStore();
let mainWindow: BrowserWindow | null = null;
let indexer:LibraryIndexer;
const chats=new ChatService(store);
store.onBeforeChange=()=>{chats.interrupt();memory.interrupt();intake?.interrupt();revisions?.interrupt();indexer?.interrupt();airtable?.interrupt();};
const defaultBrand: BrandConfig = { appName:'Research Desk', accent:'#d18b47', terminology:{evidence:'Evidence',claim:'Claim',workspace:'Workspace'} };
const settingsPath = () => path.join(app.getPath('userData'),'settings.json');
const readSettings = ():any => { try{return JSON.parse(fs.readFileSync(settingsPath(),'utf8'));}catch{return{};} };
const writeSettings = (value:any) => { fs.mkdirSync(path.dirname(settingsPath()),{recursive:true});atomicWrite(settingsPath(),Buffer.from(JSON.stringify(value,null,2))); };
const getApiKey = () => {const value=readSettings().openAiKey;if(!value)return'';try{return safeStorage.isEncryptionAvailable()?safeStorage.decryptString(Buffer.from(value,'base64')):'';}catch{return'';}};
const drive = new GoogleDrive(readSettings,writeSettings);
const airtableKey=()=>store.info?crypto.createHash('sha256').update(store.info.id+store.info.path).digest('hex'):'';
const airtableToken=()=>{try{const value=readSettings().airtableTokens?.[airtableKey()];return value&&safeStorage.isEncryptionAvailable()?safeStorage.decryptString(Buffer.from(value,'base64')):'';}catch{return '';}};
const airtable=new AirtableService(store,airtableToken,()=>mainWindow?.webContents.send('airtable:changed'));
function airtableWorkspace(id:string){if(store.info?.id!==id)throw new Error('The workspace changed.');}
ipcMain.handle('airtable:status',()=>airtable.status());
ipcMain.handle('airtable:connect',async(_,id:string,token:string,base:string)=>{airtableWorkspace(id);if(airtable.status().busy)throw new Error('Wait for the Airtable operation.');if(!token.trim())throw new Error('Enter a personal access token.');if(!safeStorage.isEncryptionAvailable())throw new Error('Operating-system encryption is unavailable; token was not saved.');const settings=readSettings();settings.airtableTokens={...settings.airtableTokens,[airtableKey()]:safeStorage.encryptString(token.trim()).toString('base64')};writeSettings(settings);return airtable.discover(id,base);});
ipcMain.handle('airtable:discover',(_,id:string,base:string)=>airtable.discover(id,base));
ipcMain.handle('airtable:configure',(_,id:string,base:string,tables:import('../shared/airtable.js').AirtableTable[],mappings:import('../shared/airtable.js').AirtableMapping[],writes:boolean)=>airtable.configure(id,base,tables,mappings,writes));
ipcMain.handle('airtable:disconnect',(_,id:string)=>{airtableWorkspace(id);if(airtable.status().busy)throw new Error('Cancel the current Airtable operation before disconnecting.');const settings=readSettings();delete settings.airtableTokens?.[airtableKey()];writeSettings(settings);mainWindow?.webContents.send('airtable:changed');return airtable.status();});
ipcMain.handle('airtable:refresh',(_,id:string)=>airtable.refresh(id));
ipcMain.handle('airtable:cancel',(_,id:string)=>{airtableWorkspace(id);airtable.cancel();});
ipcMain.handle('airtable:search',(_,id:string,query:string,offset:number)=>{airtableWorkspace(id);return searchAirtable(airtableSnapshot(store),query.slice(0,2000),Math.max(0,Number.isInteger(offset)?offset:0));});
ipcMain.handle('airtable:read',(_,id:string,table:string,record:string)=>{airtableWorkspace(id);return readAirtableRecord(airtableSnapshot(store),table,record);});
ipcMain.handle('airtable:apply',(_,id:string,proposal:string)=>airtable.apply(id,proposal));
ipcMain.handle('airtable:reject',(_,id:string,proposal:string)=>airtable.reject(id,proposal));
chats.airtable=airtable;
const chatGpt = new ChatGptAuth(readSettings,writeSettings);
const aiSettings = () => {const settings=readSettings();const chatGptConnected=chatGpt.status().connected;const keyConfigured=Boolean(getApiKey());const provider=settings.aiProvider==='chatgpt'&&chatGptConnected?'chatgpt':keyConfigured?'api-key':chatGptConnected?'chatgpt':null;return{configured:Boolean(provider),model:provider==='chatgpt'?(settings.chatGptModel||''):(settings.openAiModel||'gpt-5-mini'),provider,chatGptConnected};};

const credentials=async()=>{const currentAi=aiSettings();if(!currentAi.configured)throw new Error('No AI provider is connected.');return {model:currentAi.model,key:currentAi.provider==='chatgpt'?await chatGpt.accessToken():getApiKey()};};
const memory=new ProjectMemoryService(store,credentials,()=>mainWindow?.webContents.send('project:changed'));
const intake=new IntakeService(store,credentials,aiSettings,()=>mainWindow?.webContents.send('intake:changed'));
const maintenance=new MaintenanceService(store);
ipcMain.handle('maintenance:get',(_,id)=>maintenance.snapshot(id));
ipcMain.handle('maintenance:preview',(_,id,revision,draft)=>maintenance.preview(id,revision,draft));
ipcMain.handle('maintenance:apply',(_,id,token)=>{const result=maintenance.apply(id,token);mainWindow?.webContents.send('intake:changed');return result;});
const revisions=new RevisionService(store,credentials,aiSettings,()=>mainWindow?.webContents.send('revisions:changed'));
ipcMain.handle('revisions:get',(_,id)=>revisions.snapshot(id));
ipcMain.handle('revisions:register',(_,id,revision,itemId)=>revisions.register(id,revision,itemId));
ipcMain.handle('revisions:save',(_,id,revision,input,previousId)=>revisions.edit(id,revision,input,previousId));
ipcMain.handle('revisions:review',(_,id,revision,pid,decision,note,citation,editorial)=>revisions.review(id,revision,pid,decision,note,citation,editorial));
ipcMain.handle('revisions:preview-ai',(_,id,revision,input,instruction)=>revisions.aiPreview(id,revision,input,instruction));
ipcMain.handle('revisions:start-ai',(_,id,token)=>revisions.startAi(id,token));
ipcMain.handle('revisions:cancel-ai',(_,id,jobId)=>revisions.cancel(id,jobId));
ipcMain.handle('revisions:export',async(_,id,revision,ids)=>{const generation=store.generation;revisions.exportSelection(id,revision,ids);const result=await dialog.showSaveDialog(mainWindow!,{title:'Export reviewed revision packet',defaultPath:'Reviewed manuscript revisions.docx',filters:[{name:'Word revision packet',extensions:['docx']}]});if(result.canceled||!result.filePath)return null;if(generation!==store.generation)throw Error('Workspace changed.');return revisions.export(id,revision,ids,result.filePath);});
ipcMain.handle('intake:get',(_,id)=>intake.snapshot(id));
ipcMain.handle('intake:change',(_,id,revision,command)=>intake.change(id,revision,command));
ipcMain.handle('intake:inventory',(_,id,revision,groupId)=>intake.inventory(id,revision,groupId));
ipcMain.handle('intake:image',(_,id,pageId)=>intake.image(id,pageId));
ipcMain.handle('intake:start',(_,id,revision,deliveryId,groupIds,model,provider)=>intake.start(id,revision,deliveryId,groupIds,model,provider));
ipcMain.handle('intake:control',(_,id,revision,jobId,action)=>intake.control(id,revision,jobId,action));
chats.onCompleted=(...args)=>memory.enqueue(...args);
ipcMain.handle('project:get',()=>projectSnapshot(store));
ipcMain.handle('project:supplied',()=>suppliedProject());
ipcMain.handle('project:save',(_:unknown,documents:import('../shared/types.js').ProjectDocuments,workspaceId:string,revision:number)=>{const data=saveProject(store,documents,workspaceId,revision);mainWindow?.webContents.send('project:changed');return data;});
ipcMain.handle('project:entry',(_:unknown,id:string,status:import('../shared/types.js').ProjectEntry['status'],text:string,workspaceId:string,revision:number)=>{const data=changeProjectEntry(store,id,status,text,workspaceId,revision);mainWindow?.webContents.send('project:changed');return data;});
ipcMain.handle('project:retry',(_:unknown,workspaceId:string)=>memory.retry(workspaceId));
ipcMain.handle('project:import',async(_:unknown,workspaceId:string)=>{const generation=store.generation;if(store.info?.id!==workspaceId)throw new Error('The workspace changed.');const result=await dialog.showOpenDialog(mainWindow!,{title:'Import project configuration Markdown',properties:['openFile'],filters:[{name:'Markdown',extensions:['md','txt']}]});if(store.generation!==generation)throw new Error('The workspace changed.');if(result.canceled)return null;const file=result.filePaths[0];if(fs.statSync(file).size>80000)throw new Error('Setup document is too large.');return fs.readFileSync(file,'utf8');});

protocol.registerSchemesAsPrivileged([{scheme:'research-file',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);

function createWindow(){
  mainWindow=new BrowserWindow({width:1440,height:900,minWidth:480,minHeight:360,backgroundColor:'#181818',title:'Research Desk',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))void shell.openExternal(url);return{action:'deny'};});
  mainWindow.webContents.on('will-navigate',(event,url)=>{const current=mainWindow?.webContents.getURL();if(url!==current){event.preventDefault();if(url.startsWith('https://'))void shell.openExternal(url);}});
  const dev=process.env.VITE_DEV_SERVER_URL;if(dev)void mainWindow.loadURL(dev);else void mainWindow.loadFile(path.join(__dirname,'../../dist/index.html'));
}

function pickWorkspace(defaultName='Research Desk Workspace'){return dialog.showOpenDialog(mainWindow!,{title:'Choose a folder for the workspace',properties:['openDirectory','createDirectory'],buttonLabel:'Use this folder',defaultPath:path.join(app.getPath('documents'),defaultName)});}

app.whenReady().then(async()=>{
  if(readinessRoot){try{const {readiness}=await import('./readiness.js');await readiness(readinessRoot,process.env.RESEARCH_DESK_READINESS_PHASE||'create');app.exit(0);}catch(error){fs.mkdirSync(readinessRoot,{recursive:true});fs.writeFileSync(path.join(readinessRoot,'failure.txt'),String(error instanceof Error?error.stack:error));app.exit(1);}return;}
  indexer=new LibraryIndexer(store,path.join(app.getPath('userData'),'ocr-cache'),coverage=>mainWindow?.webContents.send('index:progress',coverage));
  let lastAirtableGeneration=-1;
  const libraryChanged=store.onLibraryChange;store.onLibraryChange=()=>{libraryChanged?.();memory.resume();if(store.info&&airtableSnapshot(store).mappings.length&&lastAirtableGeneration!==store.generation){lastAirtableGeneration=store.generation;airtable.recover();if(airtable.status().connected)void airtable.refresh(store.info.id).catch(()=>{});}};
  protocol.handle('research-file',async request=>{try{const url=new URL(request.url);const itemId=url.hostname;const file=store.pathFor(itemId);return new Response(fs.readFileSync(file),{headers:{'Content-Type':url.searchParams.get('type')||'application/octet-stream','Content-Disposition':'inline'}});}catch(error){return new Response(String(error),{status:404});}});
  createWindow(); app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('before-quit',()=>{indexer?.stop();chats.interrupt();memory.interrupt();airtable.interrupt();intake.interrupt();revisions.interrupt();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

ipcMain.handle('workspace:get-state',()=>store.getState());
ipcMain.handle('workspace:create',async(_:unknown,name='Untitled research')=>{if(drive.isBusy())throw new Error('Wait for the Google Drive operation to finish before changing workspaces.');const result=await pickWorkspace(name);if(result.canceled)return null;const root=result.filePaths[0];if(fs.existsSync(path.join(root,'workspace.sqlite'))){const choice=await dialog.showMessageBox(mainWindow!,{type:'question',message:'A workspace already exists here.',detail:'Open the existing workspace instead?',buttons:['Open','Cancel'],defaultId:0,cancelId:1});return choice.response===0?store.open(root):null;}return store.create(root,name);});
ipcMain.handle('workspace:open',async()=>{if(drive.isBusy())throw new Error('Wait for the Google Drive operation to finish before changing workspaces.');const result=await dialog.showOpenDialog(mainWindow!,{title:'Open Research Desk workspace',properties:['openDirectory']});return result.canceled?null:store.open(result.filePaths[0]);});
ipcMain.handle('workspace:rename',(_:unknown,name:string)=>store.rename(name));
ipcMain.handle('workspace:close',()=>{if(drive.isBusy())throw new Error('Wait for the Google Drive operation to finish before closing the workspace.');store.close();return store.getState();});
ipcMain.handle('workspace:import-files',async(_:unknown,mode:ImportMode,provided?:string[])=>{let paths=provided;if(!paths?.length){const result=await dialog.showOpenDialog(mainWindow!,{title:'Import research files',properties:['openFile','multiSelections'],filters:[{name:'Research files',extensions:['pdf','png','jpg','jpeg','gif','webp','docx','md','txt']},{name:'All files',extensions:['*']} ]});if(result.canceled)return null;paths=result.filePaths;}return store.importFiles(paths,mode);});
ipcMain.handle('drive:status',()=>drive.status());
ipcMain.handle('drive:configure',async()=>{const result=await dialog.showOpenDialog(mainWindow!,{title:'Load Google desktop OAuth client',properties:['openFile'],filters:[{name:'Google OAuth JSON',extensions:['json']}]});return result.canceled?null:drive.configure(result.filePaths[0]);});
ipcMain.handle('drive:connect',()=>drive.connect());
ipcMain.handle('drive:disconnect',()=>drive.disconnect());
ipcMain.handle('drive:import',()=>drive.importAll(store));
ipcMain.handle('item:remove',async(_:unknown,id:string)=>{const item=store.getState().items.find(x=>x.id===id);if(!item)throw new Error('Item not found.');const result=await dialog.showMessageBox(mainWindow!,{type:'question',message:`Remove “${item.title}” from the library?`,detail:'The file will disappear from the sidebar. Original files, workspace copies, and saved evidence are retained. Previously imported Drive files will stay removed on repeat imports.',buttons:['Cancel','Remove from library'],defaultId:0,cancelId:0});return result.response===1?store.removeItem(id):null;});
ipcMain.handle('item:read' ,async(_:unknown,id:string)=>{const result:any=await store.readItem(id);if(!result.text&&!result.html)result.url=`research-file://${id}/document?type=${encodeURIComponent(result.item.mediaType)}`;return result;});
ipcMain.handle('item:save-text',(_:unknown,id:string,text:string)=>store.saveText(id,text));
ipcMain.handle('item:reveal',(_:unknown,id:string)=>shell.showItemInFolder(store.pathFor(id)));
ipcMain.handle('item:open-system',async(_:unknown,id:string)=>{const error=await shell.openPath(store.pathFor(id));if(error)throw new Error(error);});
ipcMain.handle('item:relink',async(_:unknown,id:string)=>{const result=await dialog.showOpenDialog(mainWindow!,{title:'Relink source file',properties:['openFile']});return result.canceled?null:store.relink(id,result.filePaths[0]);});
ipcMain.handle('evidence:create',(_:unknown,data:any)=>store.createEvidence(data));
ipcMain.handle('evidence:update',(_:unknown,data:EvidenceRecord)=>store.updateEvidence(data));
ipcMain.handle('claim:create',(_:unknown,data:any)=>store.createClaim(data));
ipcMain.handle('claim:link',(_:unknown,claimId:string,evidenceId:string,relationship:any)=>store.linkEvidence(claimId,evidenceId,relationship));
ipcMain.handle('task:create',(_:unknown,data:any)=>store.createTask(data));
ipcMain.handle('task:reorder',(_:unknown,ids:string[])=>store.reorderTasks(ids));
ipcMain.handle('workspace:backup-preflight',()=>store.backupPreflight());
ipcMain.handle('workspace:restore-summary',()=>store.lastRestore);
ipcMain.handle('workspace:export',async()=>{if(!store.info)return null;const generation=store.generation;const result=await dialog.showSaveDialog(mainWindow!,{title:'Export portable workspace',defaultPath:`${store.info.name}.researchdesk`,filters:[{name:'Research Desk archive',extensions:['researchdesk']}]});if(result.canceled||!result.filePath)return null;if(generation!==store.generation)throw Error('Workspace changed. Choose the backup again.');return store.exportTo(result.filePath);});
ipcMain.handle('workspace:import',async()=>{if(drive.isBusy())throw new Error('Wait for the Google Drive operation to finish before changing workspaces.');const archive=await dialog.showOpenDialog(mainWindow!,{title:'Import portable workspace',properties:['openFile'],filters:[{name:'Research Desk archive',extensions:['researchdesk']}]});if(archive.canceled)return null;const target=await pickWorkspace('Imported Research Workspace');if(target.canceled)return null;const restored=await store.importFrom(archive.filePaths[0],target.filePaths[0]);const summary=store.lastRestore!;await dialog.showMessageBox(mainWindow!,{type:'info',title:'Workspace restored',message:`Verified ${summary.verifiedFiles} files.`,detail:`${summary.convertedLinks.length} external sources included as copies. ${summary.unavailableLinks.length} legacy external links need relinking. Provider credentials are not included; reconnect providers in Settings.`});return restored;});
ipcMain.handle('settings:brand-get',()=>readSettings().brand||defaultBrand);
ipcMain.handle('settings:brand-set',(_:unknown,brand:BrandConfig)=>{const settings=readSettings();settings.brand=brand;writeSettings(settings);mainWindow?.setTitle(brand.appName);return brand;});
ipcMain.handle('settings:ai-get',()=>aiSettings());
ipcMain.handle('settings:ai-save',(_:unknown,apiKey:string,model:string)=>{if(apiKey&&!safeStorage.isEncryptionAvailable())throw new Error('Operating-system encryption is not available, so the API key was not saved.');const settings=readSettings();if(apiKey){settings.openAiKey=safeStorage.encryptString(apiKey).toString('base64');settings.aiProvider='api-key';}settings.openAiModel=model;writeSettings(settings);return aiSettings();});
ipcMain.handle('chatgpt:status',()=>chatGpt.status());
ipcMain.handle('chatgpt:connect',()=>chatGpt.connect());
ipcMain.handle('chatgpt:disconnect',()=>chatGpt.disconnect());
ipcMain.handle('chatgpt:model-set',(_:unknown,slug:string)=>chatGpt.setModel(slug));
ipcMain.handle('chatgpt:models-refresh',async()=>{await chatGpt.refreshModels();return chatGpt.status();});
ipcMain.handle('external:open',(_:unknown,url:string)=>{if(!url.startsWith('https://'))throw new Error('Only HTTPS links can be opened.');return shell.openExternal(url);});
ipcMain.handle('index:coverage',()=>indexer.status());
ipcMain.handle('index:retry',(_:unknown,itemId?:string)=>indexer.retry(itemId));
ipcMain.handle('preparation:status',()=>indexer.status());
function preparationWorkspace(workspaceId:string){if(store.info?.id!==workspaceId)throw new Error('The workspace changed.');}
ipcMain.handle('preparation:start',(_:unknown,workspaceId:string)=>{preparationWorkspace(workspaceId);return indexer.start();});
ipcMain.handle('preparation:cancel',(_:unknown,workspaceId:string)=>{preparationWorkspace(workspaceId);return indexer.pause();});
ipcMain.handle('preparation:resume',(_:unknown,workspaceId:string)=>{preparationWorkspace(workspaceId);return indexer.start();});
ipcMain.handle('preparation:retry',(_:unknown,workspaceId:string,itemId?:string)=>{preparationWorkspace(workspaceId);return indexer.retry(itemId);});
ipcMain.handle('chat:list',(_:unknown,query?:string)=>store.listChats(query));
ipcMain.handle('chat:load',(_:unknown,id:string)=>{if(chats.isBusy(id))throw new Error('Finish or cancel the reply before opening this chat.');return store.loadChat(id);});
ipcMain.on('chat:flush-session',(event,id:string,session:import('../shared/types.js').ChatSession,workspaceId:string)=>{try{store.saveChatSession(id,session,workspaceId);store.activateChat(id,workspaceId);event.returnValue='';}catch(error){event.returnValue=String(error);}});
ipcMain.handle('chat:session',(_:unknown,id:string,session:import('../shared/types.js').ChatSession,workspaceId:string)=>store.saveChatSession(id,session,workspaceId));
ipcMain.handle('chat:activate',(_:unknown,id:string|null,workspaceId:string)=>{if(store.listChats().activeId!==id&&store.listChats().conversations.some(chat=>chats.isBusy(chat.id)))throw new Error('Finish or cancel the reply before switching chats.');store.activateChat(id,workspaceId);});
ipcMain.handle('chat:rename',(_:unknown,id:string,title:string)=>store.renameChat(id,title));
ipcMain.handle('chat:cancel',(_:unknown,id:string)=>chats.cancel(id));
ipcMain.handle('chat:send',(_:unknown,request:ChatRequest)=>{
  return chats.send({...request,scope:request.scope==='item'?'item':request.scope==='workspace'||request.scope===undefined&&(store.preparation().enabled||airtableSnapshot(store).mappings.length)?'workspace':'none'},async()=>{
    const currentAi=aiSettings();if(!currentAi.configured)throw new Error('No AI provider is connected. Open Settings to connect ChatGPT or add an API key.');
    return {model:currentAi.model,key:currentAi.provider==='chatgpt'?await chatGpt.accessToken():getApiKey()};
  },event=>mainWindow?.webContents.send('chat:chunk',event),processingBudget(indexer,600000));
});
