import type { ReactNode } from 'react';

export type SidebarTool =
  | 'files'
  | 'members'
  | 'chat'
  | 'terminal'
  | 'whiteboard'
  | 'recordings';

interface Item {
  id: SidebarTool;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  badge?: ReactNode;
}

const ITEMS: Item[] = [
  { id: 'files', label: 'Files', icon: <FilesIcon />, shortcut: '1' },
  { id: 'members', label: 'People', icon: <PeopleIcon />, shortcut: '2' },
  { id: 'chat', label: 'Chat', icon: <ChatIcon />, shortcut: '3' },
  { id: 'terminal', label: 'Terminal', icon: <TerminalIcon />, shortcut: '4' },
  { id: 'whiteboard', label: 'Whiteboard', icon: <BoardIcon />, shortcut: '5' },
  { id: 'recordings', label: 'Recordings', icon: <RecordIcon />, shortcut: '6' },
];

interface Props {
  active: SidebarTool | null;
  onSelect: (t: SidebarTool | null) => void;
  /** Optional badges keyed by tool, e.g. unread chat count, live recording dot. */
  badges?: Partial<Record<SidebarTool, ReactNode>>;
  /** Bottom area: playback link, share button. */
  footer?: ReactNode;
}

// Thin left rail that opens the panel for the selected tool. Click an already-
// active icon to collapse the panel (icon-rail-only mode). Keyboard 1-7 jumps
// to the matching tool when not in an input/editor.
export function PadSidebar({ active, onSelect, badges, footer }: Props) {
  return (
    <nav
      aria-label="Pad sidebar"
      className="flex flex-col items-center justify-between py-2 border-r border-line bg-page select-none"
      style={{ width: 56 }}
    >
      <ul className="flex flex-col gap-1">
        {ITEMS.map((it) => {
          const on = active === it.id;
          return (
            <li key={it.id}>
              <button
                onClick={() => onSelect(on ? null : it.id)}
                aria-pressed={on}
                aria-label={it.label}
                title={`${it.label}${it.shortcut ? ` (${it.shortcut})` : ''}`}
                className={`relative inline-flex items-center justify-center size-10 rounded-md transition-colors ${
                  on
                    ? 'bg-accent/15 text-accent'
                    : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                {it.icon}
                {badges?.[it.id] && (
                  <span className="absolute -top-0.5 -right-0.5">{badges[it.id]}</span>
                )}
                {on && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-sm bg-accent"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {footer && <div className="flex flex-col gap-1">{footer}</div>}
    </nav>
  );
}

function FilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
function BoardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}
function RecordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}
