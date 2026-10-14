import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectSetup } from '../src/renderer/ProjectSetup';
import type { ProjectSnapshot } from '../src/shared/types';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('reviews supplied setup before adoption, restores versions and exposes provenance and corrections',async()=>{
  const data:ProjectSnapshot={workspaceId:'w',revision:0,configurations:[],jobs:[],entries:[]};
  const docs={context:'Initial handoff; title unknown',workflow:'Distinguish facts and proposals',state:'No approved thesis decisions'};
  const api={getProject:vi.fn(async()=>data),onProjectChanged:()=>()=>{},suppliedProject:vi.fn(async()=>docs),saveProject:vi.fn(async()=>({...data,revision:1,configurations:[{id:'v1',version:1,createdAt:'2026-01-01',documents:docs}],entries:[{id:'entry',kind:'decision',status:'proposed',text:'Use APA',messageId:'u1',quotation:'Could we use APA?',createdAt:'2026-01-01'}]})),changeProjectEntry:vi.fn(async()=>({...data,revision:2})),importProjectMarkdown:vi.fn(async()=> 'Imported context')};window.researchDesk=api as any;
  render(<ProjectSetup workspaceId="w"/>);await screen.findByText('No project configured');fireEvent.click(screen.getByRole('button',{name:'Use supplied Thesis setup'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'Project configuration'})).toHaveValue(docs.context));expect(api.saveProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Save and adopt configuration'}));await screen.findByText('Configuration v1');expect(api.saveProject).toHaveBeenCalledWith(docs,'w',0);
  fireEvent.click(screen.getByRole('button',{name:'Open Project memory'}));expect(screen.getByText('Could we use APA?')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Approve'}));await waitFor(()=>expect(api.changeProjectEntry).toHaveBeenCalledWith('entry','approved','Use APA','w',1));
});
