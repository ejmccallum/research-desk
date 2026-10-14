export type MaintenanceKind = 'evidence'|'claim'|'relationship'|'dependency'|'chronology'|'task';
export interface MaintenanceRecord { id:string; kind:MaintenanceKind; values:Record<string,string>; archived:boolean; readOnly?:boolean; provenance?:string }
export interface MaintenanceFlag { id:string; recordId:string; changeId:string; message:string; resolvedAt?:string; resolution?:string }
export interface MaintenanceChange { id:string; at:string; actor:string; reason:string; before:MaintenanceRecord|null; after:MaintenanceRecord; affected:string[] }
export interface MaintenanceSnapshot { workspaceId:string; revision:string; records:MaintenanceRecord[]; flags:MaintenanceFlag[]; history:MaintenanceChange[] }
export interface MaintenanceDraft { record:MaintenanceRecord; reason:string; resolveFlagIds?:string[] }
export interface MaintenancePreview { token:string; before:MaintenanceRecord|null; after:MaintenanceRecord; affected:string[]; warnings:string[]; reason:string }
export interface MaintenanceApi {
 getMaintenance(workspaceId:string):Promise<MaintenanceSnapshot>;
 previewMaintenance(workspaceId:string,revision:string,draft:MaintenanceDraft):Promise<MaintenancePreview>;
 applyMaintenance(workspaceId:string,token:string):Promise<MaintenanceSnapshot>;
}
export interface MaintenanceField {key:string;label:string;ref?:MaintenanceKind|'source';multiple?:boolean;options?:string[];required?:boolean}
export const maintenanceLabels:Record<MaintenanceKind,string>={evidence:'Evidence',claim:'Claims',relationship:'Claim relationships',dependency:'Source dependencies',chronology:'Chronology',task:'Tasks'};
export const maintenanceFields:Record<MaintenanceKind,MaintenanceField[]>={
 evidence:[{key:'title',label:'Title',required:true},{key:'sourceId',label:'Primary source',ref:'source',required:true},{key:'sourceIds',label:'Additional sources',ref:'source',multiple:true},{key:'locator',label:'Exact locator'},{key:'quotation',label:'Quotation'},{key:'interpretation',label:'Interpretation'},{key:'limitations',label:'Limitations'}],
 claim:[{key:'wording',label:'Claim wording',required:true},{key:'assessment',label:'Assessment'},{key:'reasoning',label:'Reasoning'},{key:'uncertainties',label:'Uncertainties'},{key:'manuscriptLocation',label:'Manuscript location (reference only)'}],
 relationship:[{key:'claimId',label:'Claim',ref:'claim',required:true},{key:'evidenceId',label:'Evidence',ref:'evidence',required:true},{key:'relationship',label:'Relationship',options:['supports','qualifies','contradicts','context'],required:true},{key:'dependencyGroup',label:'Shared dependency group'}],
 dependency:[{key:'sourceId',label:'Dependent source',ref:'source',required:true},{key:'dependsOn',label:'Depends on source',ref:'source',required:true},{key:'relationship',label:'Dependency',options:['derived from','shared underlying source','possible dependency'],required:true},{key:'rationale',label:'Rationale and uncertainty',required:true}],
 chronology:[{key:'title',label:'Event',required:true},{key:'date',label:'Date or range (retain uncertainty)'},{key:'description',label:'Description'},{key:'sourceIds',label:'Sources',ref:'source',multiple:true},{key:'evidenceIds',label:'Evidence',ref:'evidence',multiple:true},{key:'claimIds',label:'Claims',ref:'claim',multiple:true},{key:'uncertainties',label:'Uncertainties'}],
 task:[{key:'title',label:'Title',required:true},{key:'why',label:'Why it matters'},{key:'impact',label:'Could change'},{key:'sources',label:'Source notes'},{key:'sourceIds',label:'Linked sources',ref:'source',multiple:true},{key:'evidenceIds',label:'Linked evidence',ref:'evidence',multiple:true},{key:'claimIds',label:'Linked claims',ref:'claim',multiple:true},{key:'eventIds',label:'Linked events',ref:'chronology',multiple:true},{key:'blocker',label:'Blocker'},{key:'completion',label:'Done when',required:true},{key:'status',label:'Status',options:['ready','waiting','done'],required:true}]
};
export const referenceIds=(value:string)=>value.split('\n').map(s=>s.trim()).filter(Boolean);
export const maintenanceTitle=(r:MaintenanceRecord)=>r.values.title||r.values.wording||r.values.relationship||r.id;
