import type { ReactNode } from 'react';

export type StudyIconKind = 'books' | 'checklist' | 'arguments' | 'tray' | 'seal' | 'quill' | 'gears' | 'open-book' | 'archive' | 'photograph' | 'notebook' | 'evidence';

/** Decorative miniatures; the containing button supplies the accessible name. */
export function StudyIcon({kind, size = 26}: {kind: StudyIconKind; size?: number}) {
  const paper = 'var(--icon-paper)', ink = 'var(--icon-ink)', brass = 'var(--icon-brass)', leather = 'var(--icon-leather)', wood = 'var(--icon-wood)';
  const sheet = <path d="M7 3h16v24H7z" fill={paper}/>;
  const writing = <path d="M11 9h8m-8 5h8m-8 5h6" stroke={ink} opacity=".65"/>;
  const seal = <><path d="m21 22-3 8 5-2 4 1-2-8" fill={leather}/><circle cx="23" cy="21" r="5" fill={leather}/><circle cx="23" cy="21" r="3" stroke={brass} fill="none"/><path d="m21.5 21 1 1 2-3" stroke={brass}/></>;
  const feather = <><path d="M14 27C17 14 19 5 29 2c1 10-3 16-11 19" fill={paper}/><path d="M13 29 28 4m-9 13 6-1m-3-5 5-1" stroke={brass}/></>;
  let art: ReactNode;
  switch(kind) {
    case 'books': art = <>{[4,12,21].map((x,i)=><g key={x} transform={`rotate(${i===2?-7:0} ${x+3} 25)`}><rect x={x} y={i===1?4:7} width="7" height={i===1?23:20} rx="1.5" fill={i===1?wood:leather}/><path d={`M${x+1} 11h5m-5 11h5`} stroke={brass}/><path d={`M${x+3} 14v5`} stroke={brass} opacity=".7"/></g>)}</>; break;
    case 'checklist': art = <>{sheet}{[9,15,21].map(y=><g key={y}><path d={`m9 ${y} 1.5 1.5 2-3`} stroke={leather}/><path d={`M15 ${y}h5`} stroke={ink}/></g>)}</>; break;
    case 'arguments': art = <><path d="M2 5h12v21H2zm16 0h12v21H18z" fill={paper}/><path d="M5 10h6m-6 5h6m10-5h6m-6 5h6" stroke={ink}/><path d="M13 21h6" stroke={brass} strokeWidth="3"/><rect x="9" y="18" width="8" height="6" rx="3" stroke={brass} fill="none"/><rect x="15" y="18" width="8" height="6" rx="3" stroke={brass} fill="none"/></>; break;
    case 'tray': art = <><path d="M5 8h21v13H5z" fill={wood}/><path d="M8 4h17v19H8z" fill={paper}/><path d="M11 9h10m-10 4h10" stroke={ink}/><path d="M3 17h26l-2 11H5z" fill={wood}/><path d="M4 19h24" stroke={brass}/><rect x="12" y="22" width="8" height="3" rx=".5" fill={brass}/></>; break;
    case 'seal': case 'evidence': art = <>{sheet}{writing}{seal}</>; break;
    case 'quill': art = <><path d="M3 10h18v18H3z" fill={paper}/><path d="M6 15h9m-9 5h6m-6 4h5" stroke={ink}/>{feather}</>; break;
    case 'gears': art = <>{[[12,14,8],[24,24,5]].map(([x,y,r])=><g key={x}><path d={`M${x-r} ${y}h${r*2}M${x} ${y-r}v${r*2}`} stroke={brass} strokeWidth="5"/><path d={`M${x-r*.7} ${y-r*.7}l${r*1.4} ${r*1.4}m0 ${-r*1.4}l${-r*1.4} ${r*1.4}`} stroke={brass} strokeWidth="5"/><circle cx={x} cy={y} r={r*.75} fill={wood} stroke={brass} strokeWidth="3"/><circle cx={x} cy={y} r={r*.25} fill={ink}/></g>)}</>; break;
    case 'open-book': art = <><path d="M2 7q7-3 14 1 7-4 14-1v21q-7-3-14 0-7-3-14 0z" fill={leather}/><path d="M4 5q6-2 12 2 6-4 12-2v20q-6-2-12 1-6-3-12-1z" fill={paper}/><path d="M16 7v19m-9-15 6 1m-6 4 6 1m6-5 6-1m-6 6 6-1" stroke={ink}/></>; break;
    case 'archive': art = <><path d="M5 7h22v21H5z" fill={wood}/><path d="M7 3h18v13H7z" fill={paper}/><path d="M11 7h10m-10 4h7" stroke={ink}/><path d="M3 14h26v5H3z" fill={leather}/><path d="M5 19h22" stroke={brass}/><rect x="12" y="22" width="8" height="3" fill={brass}/></>; break;
    case 'photograph': art = <><path d="M3 3h26v26H3z" fill={wood}/><path d="M5 5h22v22H5z" fill={brass}/><path d="M7 7h18v18H7z" fill={paper}/><circle cx="20" cy="12" r="2" fill={brass}/><path d="m7 23 6-10 5 8 3-5 4 7z" fill={wood}/></>; break;
    case 'notebook': art = <><rect x="5" y="3" width="22" height="26" rx="2" fill={leather}/><path d="M9 4v24" stroke={brass}/><path d="M12 7h11v16H12z" fill={paper}/><path d="m14 11 6-1m-6 5 7-1m-7 5 4-1" stroke={ink}/><path d="M22 23v8l-2-2-2 2v-8" fill={brass}/></>; break;
  }
  return <svg className="study-icon" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={ink} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false">{art}</svg>;
}
