// The `?` panel: every keyboard shortcut the prompt understands.
import type { AskRequest } from './askBridge.js';

const SHORTCUTS: Array<[group: string, keys: string, what: string]> = [
  ['Prompt', 'Enter', 'send'],
  ['Prompt', 'Shift+Enter · \\+Enter · Ctrl+J', 'new line'],
  ['Prompt', '↑ / ↓', 'history (this project, kept across sessions)'],
  ['Prompt', 'Ctrl+R', 'search history'],
  ['Prompt', '! command', 'run a shell command now, output goes to context'],
  ['Prompt', '# note · #! note', 'remember for this project · for you'],
  ['Prompt', '@path', 'mention a file'],
  ['Prompt', '/', 'commands'],
  ['Editing', 'Ctrl+A / Ctrl+E', 'line start / end'],
  ['Editing', 'Alt+B / Alt+F · Alt+← →', 'word back / forward'],
  ['Editing', 'Ctrl+W · Ctrl+U · Ctrl+K', 'delete word · to line start · to line end'],
  ['Control', 'Shift+Tab', 'cycle mode: ask → auto-safe → plan (yolo only via /yolo)'],
  ['Control', 'Esc', 'stop the running turn · clear the draft'],
  ['Control', 'Esc Esc', 'edit and resend an earlier message'],
  ['Control', 'Ctrl+C', 'stop · clear · press twice to exit'],
  ['View', 'Ctrl+O', 'expand tool output'],
  ['View', 'Ctrl+F', 'filter transcript'],
  ['View', 'PgUp / PgDn · wheel · End', 'scroll · jump to latest'],
];

export function shortcutsPanel(close: () => void): AskRequest {
  return {
    question: {
      header: 'Shortcuts',
      question: 'Keyboard shortcuts',
      footer: '↑↓ scroll · Enter or Esc close',
      options: SHORTCUTS.map(([group, keys, what]) => ({
        group,
        label: keys,
        description: what,
      })),
    },
    resolve: close,
    reject: close,
  };
}
