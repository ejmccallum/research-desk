import type { ChatSession, SourcePassage } from './types.js';

export const emptySession = ():ChatSession => ({draft:'',scope:'none',evidenceIds:[]});
export function parseContext(json:string):Record<string,any> {
  try { const value=JSON.parse(json);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; }
}
export function parseSession(json:string):ChatSession {
  const value=parseContext(json);
  return {draft:typeof value.draft==='string'?value.draft:'',scope:value.scope==='item'?'item':value.scope==='workspace'?'workspace':'none',itemId:typeof value.itemId==='string'?value.itemId:undefined,evidenceIds:Array.isArray(value.evidenceIds)?value.evidenceIds.filter((id:unknown)=>typeof id==='string'):[]};
}
export function contextSources(json:string):SourcePassage[] {
  const value=parseContext(json);
  return Array.isArray(value.sources)?value.sources.filter((source:any)=>source&&typeof source.sourceId==='string'&&typeof source.itemId==='string'&&typeof source.title==='string'&&typeof source.locator==='string'&&typeof source.text==='string'&&Number.isFinite(source.page)&&Number.isFinite(source.paragraph)&&['text','ocr'].includes(source.method)):[];
}
