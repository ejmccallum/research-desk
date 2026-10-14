export type AirtableRole='sources'|'evidence'|'claims'|'tasks';
export interface AirtableField {id:string;name:string;type:string;options?:{linkedTableId?:string;choices?:Array<{name:string}>}}
export interface AirtableTable {id:string;name:string;primaryFieldId:string;fields:AirtableField[]}
export interface AirtableMapping {role:AirtableRole;tableId:string;fields:Record<string,string>;values?:Record<string,Record<string,string>>}
export interface AirtableRecord {id:string;tableId:string;createdTime:string;fields:Record<string,unknown>}
export interface AirtableProposal {id:string;tableId:string;recordId?:string;fields:Record<string,unknown>;before:Record<string,unknown>;reason:string;messageId:string;conversationId?:string;quotation?:string;createdAt:string;status:'proposed'|'applying'|'applied'|'failed'|'conflict'|'uncertain'|'rejected';error:string}
export interface AirtableSnapshot {baseId:string;tables:AirtableTable[];mappings:AirtableMapping[];records:AirtableRecord[];proposals:AirtableProposal[];refreshedAt:string;revision:number;writes:boolean}
export interface AirtableStatus extends AirtableSnapshot {workspaceId:string|null;connected:boolean;busy:boolean;progress:string;error:string}
export interface AirtableRecordView extends AirtableRecord {tableName:string;fieldNames:Record<string,string>;role:AirtableRole;url:string;linkedRecords:Array<{tableId:string;recordId:string;title:string;url:string;available:boolean}>}
export const AIRTABLE_FIELDS:Record<AirtableRole,string[]>={sources:['title','url','notes'],evidence:['title','sources','locator','quotation','interpretation','limitations','verificationStatus','supports','challenges'],claims:['wording','assessment','reasoning','uncertainties','manuscriptLocation','supports','challenges','qualifies','context'],tasks:['title','why','impact','sources','blocker','completion','status','evidence','claims']};
