import type { ClaimLink, ProjectConfiguration } from './types.js';
export interface Delivery {id:string; name:string; state:'more-files-coming'|'complete'|'reopened'; itemIds:string[]; createdAt:string}
export interface SourceGroup {id:string; deliveryId:string; title:string; author:string; edition:string; archiveReference:string; catalogueId:string; uncertainty:string; extent:'complete-work'|'excerpt'|'unknown'; expectedPages:string; itemIds:string[]; confirmed:boolean}
export interface IntakePage {id:string; groupId:string; itemId:string; checksum:string; page:number; kind:'page'|'section'; order:number; label:string; rawText:string; correction:string|null; extraction:'text'|'ocr'|'failed'; error:string; notes:string; issue:'none'|'missing'|'duplicate'|'illegible'; citation:string}
export interface ReviewEvent {id:string; pageId:string; checksum:string; fingerprint:string; kind:'text-reviewed'|'ai-visual'|'human-verified'|'citation-ready'; actor:'human'|'ai'; at:string; detail:string}
export interface AssessmentFinding {pageId:string; text:string; visual:boolean; textReviewed:boolean}
export interface AssessmentProposal {id:string; kind:'evidence'|'task'|'relationship'; pageId:string; title:string; quotation:string; interpretation:string; limitations:string; claimId:string; relationship:ClaimLink['relationship']; acceptedId?:string}
export interface AssessmentJob { ledgerStale?:boolean;id:string; deliveryId:string; groupIds:string[]; status:'running'|'paused'|'failed'|'complete'|'cancelled'; error:string; createdAt:string; model:string; provider:string; configuration:ProjectConfiguration|null; ledger:{claims:unknown[]; evidence:unknown[]; claimLinks:unknown[]}; groups:SourceGroup[]; pages:IntakePage[]; fingerprint:string; findings:AssessmentFinding[]; report:string; proposals:AssessmentProposal[]; sections?:Array<{offset:number;report:string}>; stale?:boolean; partial?:boolean}
export interface IntakeSnapshot {workspaceId:string; revision:number; deliveries:Delivery[]; groups:SourceGroup[]; pages:IntakePage[]; events:ReviewEvent[]; jobs:AssessmentJob[]; reviewStatus?:Record<string,string[]>}
export type IntakeCommand = {type:'create';name:string}|{type:'delivery';id:string;name:string;state:Delivery['state']}|{type:'attach';id:string;itemIds:string[]}|{type:'group';group:SourceGroup}|{type:'page';page:IntakePage}|{type:'review';pageId:string;kind:'text-reviewed'|'human-verified'|'citation-ready'}|{type:'accept';jobId:string;proposalIds:string[]};
export interface IntakeApi {
 getIntake(workspaceId:string):Promise<IntakeSnapshot>;
 changeIntake(workspaceId:string,revision:number,command:IntakeCommand):Promise<IntakeSnapshot>;
 inventoryIntake(workspaceId:string,revision:number,groupId:string):Promise<IntakeSnapshot>;
 renderIntakePage(workspaceId:string,pageId:string):Promise<string|null>;
 startAssessment(workspaceId:string,revision:number,deliveryId:string,groupIds:string[],expectedModel:string,expectedProvider:string):Promise<IntakeSnapshot>;
 controlAssessment(workspaceId:string,revision:number,jobId:string,action:'pause'|'resume'|'cancel'|'retry'):Promise<IntakeSnapshot>;
 onIntakeChanged(callback:()=>void):()=>void;
}
