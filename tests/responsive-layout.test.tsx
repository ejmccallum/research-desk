import { describe, expect, it } from 'vitest';
import { panelLayout } from '../src/renderer/App';

describe('responsive panel docking',()=>{
  it.each([
    [1440,true,true], [1024,true,false], [860,true,false],
    [640,false,false], [480,false,false],
  ])('allocates content space at %ipx',(width,leftDocked,rightDocked)=>{
    expect(panelLayout(width,280,340,true,true)).toEqual({leftDocked,rightDocked});
  });
  it('accounts for resized panels and preserves the content minimum',()=>{
    expect(panelLayout(1200,480,520,true,true)).toEqual({leftDocked:true,rightDocked:false});
    expect(panelLayout(1000,480,520,true,true)).toEqual({leftDocked:false,rightDocked:false});
  });
  it('uses space freed by manually closed panels',()=>{
    expect(panelLayout(900,280,340,false,true)).toEqual({leftDocked:true,rightDocked:true});
    expect(panelLayout(640,280,340,false,false)).toEqual({leftDocked:true,rightDocked:true});
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { App } from '../src/renderer/App';
vi.mock('../src/renderer/Assistant',()=>({AssistantWithModelPicker:()=> <div className="assistant"><textarea aria-label="Question"/></div>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function mount(width:number){
  Object.defineProperty(window,'innerWidth',{value:width,writable:true,configurable:true});
  window.researchDesk={getState:async()=>({workspace:{id:'w',name:'Study'},items:[],evidence:[],claims:[],claimLinks:[],tasks:[],checks:[],conversations:[]}),getBrand:async()=>({appName:'Research Desk',accent:'#d18b47',terminology:{}})} as any;
  const result=render(<App/>);await screen.findByLabelText('Toggle library');return result;
}
it('switches overlays, dismisses by Escape and backdrop, and restores focus',async()=>{
  await mount(480);
  const library=screen.getByLabelText('Toggle library');library.focus();fireEvent.click(library);
  expect(screen.getByRole('dialog',{name:'Library panel'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Close library'})).toHaveFocus();
  fireEvent.keyDown(window,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(library).toHaveFocus();
  fireEvent.click(library);fireEvent.click(screen.getByLabelText('Toggle assistant'));
  expect(screen.queryByRole('dialog',{name:'Library panel'})).toBeNull();expect(screen.getByRole('dialog',{name:'Assistant panel'})).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Close panel'));expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens navigation in an overlay and restores desktop preferences after resizing',async()=>{
  const {container}=await mount(1440);
  fireEvent.click(screen.getByLabelText('Toggle library'));
  window.innerWidth=480;fireEvent(window,new Event('resize'));
  fireEvent.click(screen.getByLabelText('Library'));expect(screen.getByRole('dialog',{name:'Library panel'})).toBeInTheDocument();
  window.innerWidth=1440;fireEvent(window,new Event('resize'));
  expect(screen.queryByRole('dialog')).toBeNull();expect(container.querySelector('.sidebar.left')).toHaveAttribute('hidden');
  expect(screen.getByLabelText('Toggle assistant')).toHaveAttribute('aria-expanded','true');
});

it('clears document tabs when switching workspaces',async()=>{
  let changed:()=>void=()=>{};
  const item={id:'fixture',title:'Synthetic source',kind:'image',mediaType:'image/png',storageMode:'copy',fileName:'fixture.png',updatedAt:''};
  let current:any={workspace:{id:'first',name:'Test workspace'},items:[item],evidence:[],claims:[],claimLinks:[],tasks:[],checks:[],conversations:[]};
  window.researchDesk={getState:async()=>current,getBrand:async()=>({appName:'Research Desk',accent:'#d18b47',terminology:{}}),onAirtableChanged:(fn:()=>void)=>{changed=fn;return()=>{};},readItem:async()=>({item,url:'data:image/png;base64,'})} as any;
  const {act,waitFor}=await import('@testing-library/react');const {container}=render(<App/>);await act(async()=>{});fireEvent.click(await screen.findByRole('button',{name:/^Synthetic source$/}));await screen.findByAltText('Synthetic source');
  current={...current,workspace:{id:'second',name:'Thesis'},items:[]};
  await act(async()=>changed());
  await waitFor(()=>expect(container.querySelector('.tabs')!.textContent).not.toContain('Synthetic source'));
  expect(screen.queryByAltText('Synthetic source')).toBeNull();
});
