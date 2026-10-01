export type ItemKind = 'manuscript' | 'source' | 'archive' | 'image' | 'note';
export type ImportMode = 'copy' | 'link';

export interface WorkspaceInfo { id: string; name: string; path: string; createdAt: string; schemaVersion: number }
export interface LibraryItem {
  id: string; kind: ItemKind; title: string; fileName: string; mediaType: string; storageMode: ImportMode;
  relativePath: string | null; linkedPath: string | null; checksum: string; size: number; status: string;
  batchId: string | null; extractedText: string | null; extractionStatus: string; createdAt: string; updatedAt: string;
  missing?: boolean;
}
export interface EvidenceRecord {
  id: string; title: string; sourceId: string; locator: string; quotation: string; interpretation: string;
  limitations: string; verificationStatus: 'machine-extracted' | 'visually-checked' | 'uncertain'; createdAt: string; updatedAt: string;
}
export interface ClaimRecord { id: string; wording: string; assessment: string; reasoning: string; uncertainties: string; manuscriptLocation: string; createdAt: string; updatedAt: string }
export interface ClaimLink { id: string; claimId: string; evidenceId: string; relationship: 'supports' | 'qualifies' | 'contradicts' | 'context'; dependencyGroup: string }
export interface TaskRecord { id: string; title: string; why: string; impact: string; sources: string; blocker: string; completion: string; status: 'ready' | 'waiting' | 'done'; position: number }
export interface CheckResult { id: string; severity: 'warning' | 'info'; title: string; detail: string; recordId?: string; recordType?: string }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
export interface ChatMessage { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; contextJson: string; createdAt: string }
export interface AppState {
  workspace: WorkspaceInfo | null; items: LibraryItem[]; evidence: EvidenceRecord[]; claims: ClaimRecord[];
  claimLinks: ClaimLink[]; tasks: TaskRecord[]; checks: CheckResult[]; conversations: Conversation[];
}
export interface ImportResult { imported: LibraryItem[]; duplicates: Array<{ name: string; existingId: string }>; batchId: string | null }
export interface ChatRequest { conversationId?: string; message: string; itemId?: string; selectedText?: string; evidenceIds: string[] }
export interface BrandConfig { appName: string; accent: string; terminology: { evidence: string; claim: string; workspace: string } }
export interface ChatGptModel { slug: string; displayName: string }
export interface ChatGptConnectionStatus { connected: boolean; name?: string; email?: string; models: ChatGptModel[]; selectedModel: string; warning?: string }
export interface AiSettings { configured: boolean; model: string; provider: 'chatgpt' | 'api-key' | null; chatGptConnected: boolean }

export interface ResearchDeskApi {
  getState(): Promise<AppState>; createWorkspace(name?: string): Promise<AppState | null>; openWorkspace(): Promise<AppState | null>;
  renameWorkspace(name: string): Promise<AppState>; closeWorkspace(): Promise<AppState>; importFiles(mode: ImportMode, paths?: string[]): Promise<ImportResult | null>;
  readItem(id: string): Promise<{ item: LibraryItem; url?: string; text?: string; html?: string; error?: string }>;
  saveText(id: string, text: string): Promise<void>; revealItem(id: string): Promise<void>; openInSystem(id: string): Promise<void>; relinkItem(id: string): Promise<AppState | null>;
  getDroppedPaths(files: File[]): string[];
  createEvidence(data: Partial<EvidenceRecord> & { sourceId: string }): Promise<AppState>; updateEvidence(data: EvidenceRecord): Promise<AppState>;
  createClaim(data: Partial<ClaimRecord>): Promise<AppState>; linkEvidence(claimId: string, evidenceId: string, relationship: ClaimLink['relationship']): Promise<AppState>;
  createTask(data: Partial<TaskRecord>): Promise<AppState>; reorderTasks(ids: string[]): Promise<AppState>;
  exportWorkspace(): Promise<string | null>; importWorkspace(): Promise<AppState | null>;
  getBrand(): Promise<BrandConfig>; setBrand(brand: BrandConfig): Promise<BrandConfig>;
  getAiSettings(): Promise<AiSettings>; saveAiSettings(apiKey: string, model: string): Promise<AiSettings>;
  getChatGptStatus(): Promise<ChatGptConnectionStatus>; connectChatGpt(): Promise<ChatGptConnectionStatus>; disconnectChatGpt(): Promise<ChatGptConnectionStatus>;
  setChatGptModel(slug: string): Promise<ChatGptConnectionStatus>; refreshChatGptModels(): Promise<ChatGptConnectionStatus>;
  chat(request: ChatRequest): Promise<{ conversationId: string; message: ChatMessage }>;
  onChatChunk(callback: (event: { conversationId: string; delta: string; done?: boolean; error?: string }) => void): () => void;
  cancelChat(conversationId: string): Promise<void>; openExternal(url: string): Promise<void>;
}
