import {it,expect,vi,afterEach} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {Intake} from '../src/renderer/Intake';
afterEach(cleanup);
const state={workspace:{id:'workspace'},items:[],claims:[]} as any;
it('keeps delivery completion separate from assessment start and discloses provider scope',async()=>{
 const snapshot={workspaceId:'workspace',revision:1,deliveries:[{id:'d',name:'Archive packet',state:'complete',itemIds:[]}],groups:[{id:'g',deliveryId:'d',title:'Book',edition:'1941',confirmed:true,itemIds:[],extent:'excerpt',expectedPages:'12–14'}],pages:[],events:[],jobs:[]};
 const start=vi.fn().mockResolvedValue(snapshot);window.researchDesk={getIntake:async()=>snapshot,onIntakeChanged:()=>()=>{},getAiSettings:async()=>({provider:'api-key',model:'test-model',configured:true}),startAssessment:start} as any;
 render(<Intake state={state} refresh={()=>{}} onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:/Archive packet/}));
 expect(start).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox',{name:/Book/}));fireEvent.click(screen.getByRole('button',{name:'Preview assessment'}));
 expect(await screen.findByText(/Provider: api-key/)).toBeInTheDocument();expect(screen.getByText(/Selected source images/)).toBeInTheDocument();expect(start).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Start assessment'}));expect(start).toHaveBeenCalledWith('workspace',1,'d',['g'],'test-model','api-key');
});
it('shows current review status separately from historical events',async()=>{
 const p={id:'p',groupId:'g',itemId:'i',page:1,kind:'page',order:0,label:'12',rawText:'Original',correction:null,extraction:'ocr',issue:'none',notes:'',citation:'',checksum:'sha'};
 const snapshot={workspaceId:'workspace',revision:1,deliveries:[{id:'d',name:'Packet',state:'complete',itemIds:['i']}],groups:[{id:'g',deliveryId:'d',title:'Book',itemIds:['i']}],pages:[p],events:[{id:'old',pageId:'p',kind:'citation-ready',actor:'human',at:'2026-01-01',detail:'Old confirmation'}],reviewStatus:{p:[]},jobs:[]};
 window.researchDesk={getIntake:async()=>snapshot,onIntakeChanged:()=>()=>{},renderIntakePage:async()=>null} as any;render(<Intake state={state} refresh={()=>{}} onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:/Packet/}));fireEvent.click(screen.getByRole('button',{name:/1\. .*page 1/}));expect(await screen.findByText('Current confirmations: none')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm citation readiness'})).toBeDisabled();
});
