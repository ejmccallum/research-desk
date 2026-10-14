export type RevisionOperation='replace'|'delete'|'insert-before'|'insert-after';
export interface ManuscriptDraft {id:string;itemId:string;title:string;checksum:string;fileName:string;snapshotPath:string;extractionVersion:1;text:string;createdAt:string}
export interface RevisionCitation {evidenceId:string;sourceId:string;support:string;locator:string;sourceIdentity:string;details:string;pageId?:string}
export interface RevisionInput {draftId:string;start:number;end:number;operation:RevisionOperation;replacement:string;reason:string;classification:'editorial'|'substantive';chapter:string;authorizeChapter3:boolean;evidenceIds:string[];claimIds:string[];citations:RevisionCitation[]}
export interface RevisionPins {configuration:string;ledger:string;sources:Record<string,string>}
export interface RevisionProposal {id:string;rootId:string;version:number;input:RevisionInput;anchor:{text:string;prefix:string;suffix:string;paragraph:number};pins:RevisionPins;author:string;createdAt:string;status:'pending'|'approved'|'rejected'|'superseded';stale?:string[];review?:{at:string;actor:'human';note:string;citationConfirmed:boolean;editorialConfirmed:boolean};evidenceSnapshot:unknown[]}
export interface RevisionEvent {id:string;proposalId:string;at:string;action:string;note:string}
export interface RevisionJob {id:string;status:'running'|'interrupted'|'failed'|'cancelled'|'complete';input:RevisionInput;instruction:string;payload:string;model:string;provider:string;pins:RevisionPins;error:string;createdAt:string;proposalId?:string}
export interface RevisionExport {id:string;draftId:string;proposalIds:string[];at:string;checksum:string;fileName:string}
export interface RevisionSnapshot {workspaceId:string;revision:number;drafts:ManuscriptDraft[];proposals:RevisionProposal[];events:RevisionEvent[];jobs:RevisionJob[];exports:RevisionExport[]}
export interface RevisionAiPreview {token:string;model:string;provider:string;payload:string;characters:number}
export interface RevisionApi {
 getRevisions(workspaceId:string):Promise<RevisionSnapshot>;
 registerDraft(workspaceId:string,revision:number,itemId:string):Promise<RevisionSnapshot>;
 saveRevision(workspaceId:string,revision:number,input:RevisionInput,previousId?:string):Promise<RevisionSnapshot>;
 reviewRevision(workspaceId:string,revision:number,proposalId:string,decision:'approved'|'rejected',note:string,citationConfirmed:boolean,editorialConfirmed:boolean):Promise<RevisionSnapshot>;
 previewRevisionAi(workspaceId:string,revision:number,input:RevisionInput,instruction:string):Promise<RevisionAiPreview>;
 startRevisionAi(workspaceId:string,token:string):Promise<RevisionSnapshot>;
 cancelRevisionAi(workspaceId:string,jobId:string):Promise<RevisionSnapshot>;
 exportRevisions(workspaceId:string,revision:number,proposalIds:string[]):Promise<{snapshot:RevisionSnapshot;path:string}|null>;
 onRevisionsChanged(callback:()=>void):()=>void;
}
export function revisionParagraph(text:string,offset:number){return text.slice(0,offset).split(/\n\s*\n/).length;}
export function exactRevisionMatches(text:string,quote:string):Array<{start:number;end:number}>{const out:Array<{start:number;end:number}>=[];if(!quote)return out;let from=0;while(from<=text.length){const start=text.indexOf(quote,from);if(start<0)break;out.push({start,end:start+quote.length});from=start+1;}return out;}
export function revisionsConflict(a:RevisionInput,b:RevisionInput){if(a.draftId!==b.draftId)return false;const insertion=(x:RevisionInput)=>x.operation.startsWith('insert-');const point=(x:RevisionInput)=>x.operation==='insert-before'?x.start:x.end;if(insertion(a)&&insertion(b))return point(a)===point(b);if(insertion(a))return point(a)>=b.start&&point(a)<=b.end;if(insertion(b))return point(b)>=a.start&&point(b)<=a.end;return a.start<b.end&&b.start<a.end;}
