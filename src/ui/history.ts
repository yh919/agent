// Prompt history that survives restarts (Claude Code keeps one per project).
// One JSONL line per submitted prompt: {text, cwd, ts}. Secrets are redacted
// before they touch disk, since prompts often carry pasted tokens/keys.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { apply as redact } from '../redact/index.js';

export const HISTORY_CAP = 500;

export function historyPath(): string {
  return join(homedir(), '.lepus', 'agent', 'history.jsonl');
}

/** This project's prompts, oldest first, capped. Missing/corrupt file → []. */
export function loadHistory(cwd: string, path = historyPath()): string[] {
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    try {
      const e = JSON.parse(line) as { text?: unknown; cwd?: unknown };
      if (e.cwd === cwd && typeof e.text === 'string' && out.at(-1) !== e.text) out.push(e.text);
    } catch {
      /* skip blank/corrupt lines */
    }
  }
  return out.slice(-HISTORY_CAP);
}

/** Append one prompt. Best-effort: history must never break a turn. */
export function appendHistory(text: string, cwd: string, path = historyPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify({ text: redact(text), cwd, ts: Date.now() })}\n`, {
      mode: 0o600,
    });
  } catch {
    /* read-only home etc. */
  }
}

/** Ctrl+R: newest entry at index < `before` containing `query` (case-insensitive). */
export function searchHistory(
  history: string[],
  query: string,
  before = history.length,
): number | null {
  const q = query.toLowerCase();
  for (let i = Math.min(before, history.length) - 1; i >= 0; i -= 1) {
    if ((history[i] ?? '').toLowerCase().includes(q)) return i;
  }
  return null;
}
