import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Welcome } from '../src/renderer/App';

describe('workspace creation',()=>{
  it('passes the visible workspace name to the creation flow',()=>{
    const create=vi.fn();
    render(<Welcome appName="Research Desk" onCreate={create} onOpen={()=>{}} onImport={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Workspace name'),{target:{value:'Archive study'}});
    fireEvent.click(screen.getByRole('button',{name:'Create workspace'}));
    expect(create).toHaveBeenCalledWith('Archive study');
  });
});
