import type { SourcePassage } from '../shared/types.js';

const stopWords=new Set('a an and are as at be by for from has have how i in is it of on or that the this to was were what when where which who with you your'.split(' '));
export const terms=(text:string)=>text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.filter(word=>!stopWords.has(word))||[];
export function chunkText(text:string):Array<{text:string;paragraph:number}>{
  const chunks:Array<{text:string;paragraph:number}>=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+3000,text.length);
    if(end<text.length){const boundary=text.lastIndexOf(' ',end);if(boundary>start+2400)end=boundary;}
    const value=text.slice(start,end).trim();
    if(value)chunks.push({text:value,paragraph:text.slice(0,start).split(/\n\s*\n/).length});
    if(end===text.length)break;start=Math.max(start+1,end-300);
  }
  return chunks;
}
export function rankPassages(passages:SourcePassage[],query:string,limit=12):SourcePassage[]{
  const queryTerms=[...new Set(terms(query))];
  if(!queryTerms.length)return [];
  const documents=passages.map(p=>terms(p.text));
  const average=documents.reduce((sum,d)=>sum+d.length,0)/Math.max(1,documents.length);
  const frequencies=new Map(queryTerms.map(term=>[term,documents.filter(d=>d.includes(term)).length]));
  return passages.map((passage,index)=>{
    const words=documents[index];let score=0;
    for(const term of queryTerms){const count=words.filter(w=>w===term).length,df=frequencies.get(term)||0;
      if(count)score+=Math.log(1+(documents.length-df+.5)/(df+.5))*(count*2.2)/(count+1.2*(.25+.75*words.length/Math.max(1,average)));
      if(terms(passage.title).includes(term))score+=2;
    }
    return {...passage,score};
  }).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.sourceId.localeCompare(b.sourceId)).slice(0,Math.max(1,limit));
}
