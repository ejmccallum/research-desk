import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {Maintenance} from '../src/renderer/Maintenance';
afterEach(cleanup);
it('requires preview then explicit apply and lets Escape return to editing',async()=>{
 const record={id:'local:claim',kind:'claim',archived:false,values:{wording:'Original argument',assessment:'Needs review',reasoning:'',uncertainties:'',manuscriptLocation:''}};
 const snapshot={workspaceId:'w',revision:'v1',records:[record],flags:[],history:[]};const apply=vi.fn().mockResolvedValue({...snapshot,revision:'v2'}),preview=vi.fn().mockImplementation(async(_id,_revision,draft)=>({token:'reviewed',before:record,after:draft.record,affected:[],warnings:[],reason:draft.reason}));
 window.researchDesk={getMaintenance:async()=>snapshot,previewMaintenance:preview,applyMaintenance:apply} as any;
 render(<Maintenance state={{workspace:{id:'w'},items:[]} as any} refresh={()=>{}} onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Claims'}));fireEvent.click(screen.getByRole('button',{name:'Original argument'}));
 fireEvent.change(screen.getByLabelText('Claim wording'),{target:{value:'Corrected argument'}});fireEvent.change(screen.getByLabelText('Reason for change or review'),{target:{value:'New source contradicts wording'}});
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));const confirm=await screen.findByRole('button',{name:'Apply reviewed change'});expect(confirm).toHaveFocus();expect(apply).not.toHaveBeenCalled();expect(screen.getByText('Corrected argument',{selector:'td'})).toBeInTheDocument();
 fireEvent.keyDown(confirm,{key:'Escape'});expect(screen.queryByRole('button',{name:'Apply reviewed change'})).toBeNull();expect(screen.getByLabelText('Claim wording')).toHaveValue('Corrected argument');
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));fireEvent.click(await screen.findByRole('button',{name:'Apply reviewed change'}));expect(apply).toHaveBeenCalledWith('w','reviewed');await screen.findByText('Select a record to inspect or correct it.');
});
it('keeps a failed apply visible and offers reload without dropping the draft',async()=>{
 const r={id:'local:c',kind:'claim',archived:false,values:{wording:'Claim'}};const s={workspaceId:'w',revision:'r',records:[r],flags:[],history:[]};window.researchDesk={getMaintenance:async()=>s,previewMaintenance:async()=>({token:'t',before:r,after:r,affected:[],warnings:[],reason:'Reason'}),applyMaintenance:async()=>{throw Error('Records changed after preview');}} as any;
 render(<Maintenance state={{workspace:{id:'w'},items:[]} as any} refresh={()=>{}} onClose={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'Claims'}));fireEvent.click(screen.getByRole('button',{name:/^Claim$/}));fireEvent.change(screen.getByLabelText('Reason for change or review'),{target:{value:'Reason'}});fireEvent.click(screen.getByRole('button',{name:'Review changes'}));fireEvent.click(await screen.findByRole('button',{name:'Apply reviewed change'}));expect(await screen.findByRole('alert')).toHaveTextContent('Records changed');expect(screen.getByLabelText('Claim wording')).toHaveValue('Claim');
});
