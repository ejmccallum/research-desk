import type {BackupPreflight,BackupResult,RestoreSummary} from './backup.js';
import type { RevisionApi } from './revisions.js';
import type { MaintenanceApi } from './maintenance.js';
import type { IntakeApi as importIntakeApi } from './intake.js';
export type ItemKind = 'manuscript' | 'source' | 'archive' | 'image' | 'note';
export type ImportMode = 'copy' | 'link';

export interface WorkspaceInfo { id: string; name: string; path: string; createdAt: string; schemaVersion: number }
export interface LibraryItem {
  id: string; kind: ItemKind; title: string; fileName: string; mediaType: string; storageMode: ImportMode;
  relativePath: string | null; linkedPath: string | null; checksum: string; size: number; status: string;
  batchId: string | null; extractedText: string | null; extractionStatus: string; createdAt: string; updatedAt: string;
  missing?: boolean; remoteUrl?:string; originUrl?:string; catalogueText?:string; linkedItemIds?:string[];
}
export interface EvidenceRecord {
  id: string; title: string; sourceId: string; locator: string; quotation: string; interpretation: string;
  limitations: string; remoteUrl?:string; originUrl?:string; verificationLabel?:string; sourceIds?:string[]; verificationStatus: 'machine-extracted' | 'visually-checked' | 'uncertain'; createdAt: string; updatedAt: string;
}
export interface ClaimRecord { remoteUrl?:string; id: string; wording: string; assessment: string; reasoning: string; uncertainties: string; manuscriptLocation: string; createdAt: string; updatedAt: string }
export interface ClaimLink { id: string; claimId: string; evidenceId: string; relationship: 'supports' | 'qualifies' | 'contradicts' | 'context'; dependencyGroup: string }
export interface TaskRecord { recordKind?:'protocol'; remoteUrl?:string; id: string; title: string; why: string; impact: string; sources: string; blocker: string; completion: string; status: 'ready' | 'waiting' | 'done'; position: number }
export interface CheckResult { id: string; severity: 'warning' | 'info'; title: string; detail: string; recordId?: string; recordType?: string }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
export type MessageStatus = 'complete' | 'pending' | 'cancelled' | 'failed' | 'interrupted';
export interface ChatMessage { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; contextJson: string; createdAt: string; status?:MessageStatus; error?:string; sources?:SourcePassage[] }
export interface ChatSession { draft:string; scope:'workspace'|'item'|'none'; itemId?:string; evidenceIds:string[] }
export interface LoadedChat { conversation:Conversation; messages:ChatMessage[]; session:ChatSession }
export interface ChatHistory { conversations:Conversation[]; activeId:string|null }
export interface AppState {
  airtable?:{configured:boolean;records:number;refreshedAt:string};
  workspace: WorkspaceInfo | null; items: LibraryItem[]; evidence: EvidenceRecord[]; claims: ClaimRecord[];
  claimLinks: ClaimLink[]; tasks: TaskRecord[]; checks: CheckResult[]; conversations: Conversation[];
}
export interface ImportResult { imported: LibraryItem[]; duplicates: Array<{ name: string; existingId: string }>; batchId: string | null }
export interface IndexedPage { page:number; text:string; method:'text'|'ocr' }
export interface SourcePassage { sourceId:string; itemId:string; title:string; page:number; paragraph:number; locator:string; method:'text'|'ocr'; text:string; score?:number }
export interface IndexCoverage { total:number; ready:number; pending:number; failed:number; unsupported:number; missing:number; current?:string; processedPages?:number; totalPages?:number; failures:Array<{itemId:string;title:string;error:string}> }
export interface PreparationStatus extends IndexCoverage { workspaceId:string|null; enabled:boolean; paused:boolean; phase:'off'|'paused'|'checking'|'preparing'|'ready'|'problems'; unavailable?:Array<{itemId:string;title:string;state:'failed'|'missing'|'unsupported';error:string}> }
export interface DocumentCatalogueEntry { itemId:string; title:string; mediaType:string; state:'pending'|'ready'|'processing'|'failed'|'unsupported'|'missing'; checksum:string; passages:number; pages:number; error:string }
export interface DocumentBatch { itemId:string; checksum:string; sources:SourcePassage[]; offset:number; nextOffset:number|null; total:number; complete:boolean }
export interface ReviewedDocument { itemId:string; title:string; checksum:string; reviewedPassages:number; totalPassages:number; complete:boolean }
export interface ReviewCoverage { documents:ReviewedDocument[]; rounds:number; toolCalls:number; limit?:string; fallback:boolean }
export interface ChatProgress { conversationId:string; delta:string; done?:boolean; error?:string; phase?:string; reset?:boolean; sources?:SourcePassage[]; coverage?:IndexCoverage; review?:ReviewCoverage; partial?:boolean }
export interface ChatResult { conversationId:string; message:ChatMessage; sources:SourcePassage[]; coverage:IndexCoverage; review?:ReviewCoverage; partial:boolean }
export interface ChatRequest { conversationId?: string; currentMessageId?:string; message: string; itemId?: string; selectedText?: string; evidenceIds: string[]; scope?:'workspace'|'item'|'none' }
export interface BrandConfig { appName: string; accent: string; terminology: { evidence: string; claim: string; workspace: string } }
export interface ChatGptModel { slug: string; displayName: string }
export interface ChatGptConnectionStatus { connected: boolean; name?: string; email?: string; models: ChatGptModel[]; selectedModel: string; warning?: string }
export interface AiSettings { configured: boolean; model: string; provider: 'chatgpt' | 'api-key' | null; chatGptConnected: boolean }
export interface ProjectDocuments { context:string; workflow:string; state:string }
export interface ProjectConfiguration { id:string; version:number; documents:ProjectDocuments; createdAt:string }
export interface ProjectEntry { id:string; kind:'progress'|'unknown'|'decision'|'next-step'|'artifact'; status:'proposed'|'approved'|'superseded'; text:string; messageId:string; quotation:string; createdAt:string; supersedes?:string; approval?:{quotation:string;messageId?:string;createdAt:string} }
export interface ProjectJob { id:string; configurationId:string; conversationId:string; userId:string; assistantId:string; status:'pending'|'running'|'failed'|'complete'; error:string }
export interface ProjectSnapshot { workspaceId:string; revision:number; configurations:ProjectConfiguration[]; entries:ProjectEntry[]; jobs:ProjectJob[] }

export interface ResearchDeskApi extends importIntakeApi, MaintenanceApi, RevisionApi {
  getAirtable():Promise<import('./airtable.js').AirtableStatus>;
  connectAirtable(workspaceId:string,token:string,base:string):Promise<{baseId:string;tables:import('./airtable.js').AirtableTable[];suggested:import('./airtable.js').AirtableMapping[]}>;
  discoverAirtable(workspaceId:string,base:string):Promise<{baseId:string;tables:import('./airtable.js').AirtableTable[];suggested:import('./airtable.js').AirtableMapping[]}>;
  configureAirtable(workspaceId:string,base:string,tables:import('./airtable.js').AirtableTable[],mappings:import('./airtable.js').AirtableMapping[],writes:boolean):Promise<import('./airtable.js').AirtableStatus>;
  disconnectAirtable(workspaceId:string):Promise<import('./airtable.js').AirtableStatus>;
  refreshAirtable(workspaceId:string):Promise<import('./airtable.js').AirtableStatus>;
  cancelAirtable(workspaceId:string):Promise<void>;
  searchAirtable(workspaceId:string,query:string,offset:number):Promise<unknown>;
  readAirtable(workspaceId:string,tableId:string,recordId:string):Promise<import('./airtable.js').AirtableRecordView>;
  applyAirtableProposal(workspaceId:string,id:string):Promise<import('./airtable.js').AirtableStatus>;
  rejectAirtableProposal(workspaceId:string,id:string):Promise<import('./airtable.js').AirtableStatus>;
  onAirtableChanged(callback:()=>void):()=>void;
  getProject():Promise<ProjectSnapshot>;
  suppliedProject():Promise<ProjectDocuments>;
  importProjectMarkdown(workspaceId:string):Promise<string|null>;
  saveProject(documents:ProjectDocuments,workspaceId:string,revision:number):Promise<ProjectSnapshot>;
  changeProjectEntry(id:string,status:ProjectEntry['status'],text:string,workspaceId:string,revision:number):Promise<ProjectSnapshot>;
  retryProjectNotes(workspaceId:string):Promise<void>;
  onProjectChanged(callback:()=>void):()=>void;
  getState(): Promise<AppState>; createWorkspace(name?: string): Promise<AppState | null>; openWorkspace(): Promise<AppState | null>;
  renameWorkspace(name: string): Promise<AppState>; closeWorkspace(): Promise<AppState>; importFiles(mode: ImportMode, paths?: string[]): Promise<ImportResult | null>;
  removeItem(id: string): Promise<AppState | null>;
  getDriveStatus(): Promise<{configured:boolean;connected:boolean}>;
  configureDrive(): Promise<{configured:boolean;connected:boolean} | null>;
  connectDrive(): Promise<{configured:boolean;connected:boolean}>;
  disconnectDrive(): Promise<{configured:boolean;connected:boolean}>;
  importDrive(): Promise<{imported:number;skipped:number;errors:string[]}>;
  readItem(id: string): Promise<{ item: LibraryItem; url?: string; text?: string; html?: string; error?: string }>;
  saveText(id: string, text: string): Promise<void>; revealItem(id: string): Promise<void>; openInSystem(id: string): Promise<void>; relinkItem(id: string): Promise<AppState | null>;
  getDroppedPaths(files: File[]): string[];
  createEvidence(data: Partial<EvidenceRecord> & { sourceId: string }): Promise<AppState>; updateEvidence(data: EvidenceRecord): Promise<AppState>;
  createClaim(data: Partial<ClaimRecord>): Promise<AppState>; linkEvidence(claimId: string, evidenceId: string, relationship: ClaimLink['relationship']): Promise<AppState>;
  createTask(data: Partial<TaskRecord>): Promise<AppState>; reorderTasks(ids: string[]): Promise<AppState>;
  backupPreflight(): Promise<BackupPreflight>; restoreSummary(): Promise<RestoreSummary|null>; exportWorkspace(): Promise<BackupResult | null>; importWorkspace(): Promise<AppState | null>;
  getBrand(): Promise<BrandConfig>; setBrand(brand: BrandConfig): Promise<BrandConfig>;
  getAiSettings(): Promise<AiSettings>; saveAiSettings(apiKey: string, model: string): Promise<AiSettings>;
  getChatGptStatus(): Promise<ChatGptConnectionStatus>; connectChatGpt(): Promise<ChatGptConnectionStatus>; disconnectChatGpt(): Promise<ChatGptConnectionStatus>;
  setChatGptModel(slug: string): Promise<ChatGptConnectionStatus>; refreshChatGptModels(): Promise<ChatGptConnectionStatus>;
  getIndexCoverage(): Promise<IndexCoverage>;
  getPreparation():Promise<PreparationStatus>;
  prepareWorkspace(workspaceId:string):Promise<PreparationStatus>;
  cancelPreparation(workspaceId:string):Promise<PreparationStatus>;
  resumePreparation(workspaceId:string):Promise<PreparationStatus>;
  retryPreparation(workspaceId:string,itemId?:string):Promise<PreparationStatus>;
  onPreparationProgress(callback:(status:PreparationStatus)=>void):()=>void;
  retryIndex(itemId?:string): Promise<void>;
  onIndexProgress(callback:(coverage:IndexCoverage)=>void):()=>void;
  listChats(query?:string):Promise<ChatHistory>;
  loadChat(id:string):Promise<LoadedChat>;
  saveChatSession(id:string,session:ChatSession,workspaceId:string):Promise<void>;
  flushChatSession(id:string,session:ChatSession,workspaceId:string):void;
  activateChat(id:string|null,workspaceId:string):Promise<void>;
  renameChat(id:string,title:string):Promise<Conversation>;
  chat(request: ChatRequest): Promise<ChatResult>;
  onChatChunk(callback: (event: ChatProgress) => void): () => void;
  cancelChat(conversationId: string): Promise<void>; openExternal(url: string): Promise<void>;
}
