// Lepus design tokens for the TUI (brand rules: Lepus brand/BRAND.md).
//
//   brand  (Lepus Red #FF0A0A)   — logo, prompt, modal borders, primary chrome
//   focus  (Signal Red #FF5C5C)  — red text/selection on dark (readable 6.4:1)
//   muted  (gray)                — secondary text, footers, idle borders
//
// Keep this module free of React so tests and non-UI code can import tokens.

const LEPUS_RED = '#FF0A0A';
const SIGNAL_RED = '#FF5C5C';

export const theme = {
  /** Product / user accent — Lepus Red. */
  brand: LEPUS_RED,
  /** Focus / selection — active menus, modal frames. Signal Red reads better as text. */
  focus: SIGNAL_RED,
  /** Primary readable text. */
  text: '#FFFFFF' as const,
  /** Secondary / dim copy. */
  muted: '#A0A0A0' as const,
  success: 'green' as const,
  warning: 'yellow' as const,
  error: 'red' as const,
  /** YOLO / SuperMode badge (amber, degrades under 16-color). */
  superMode: '#ff8700',

  border: {
    brand: LEPUS_RED,
    focus: SIGNAL_RED,
    idle: 'gray' as const,
  },

  glyphs: {
    /** Brand mark on the home banner (Grok uses diamond-ish marks). */
    brand: '◆',
    /** Selected row caret in menus. */
    caret: '›',
    /** User prompt prefix. */
    prompt: '❯',
    /** End-of-line cursor. */
    cursor: '▌',
    /** Directory in @file picker. */
    dir: '▸',
    /** File in @file picker. */
    file: '·',
    /** Tool call bullet (transcript). */
    tool: '◆',
    /** Tool result rail. */
    result: '⎿',
  },
} as const;

export type Theme = typeof theme;
