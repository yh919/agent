// Text for the /usage, /context and /export commands.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscriptEntry } from './state.js';
import { stripControlSequences } from './toolResultFormat.js';

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function formatSessionUsage(u: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  calls: number;
}): string {
  const cached = u.cachedInputTokens ? ` (${k(u.cachedInputTokens)} cached)` : '';
  return `This session: ↑${k(u.inputTokens)}${cached} ↓${k(u.outputTokens)} tokens · ${u.calls} model calls`;
}

export function formatContext(b: {
  system: number;
  tools: number;
  conversation: number;
  threshold: number;
}): string {
  const used = b.system + b.tools + b.conversation;
  const pct = (n: number) => (b.threshold > 0 ? `${Math.round((n / b.threshold) * 100)}%` : '—');
  const row = (name: string, n: number) => `  ${name.padEnd(13)} ${k(n).padStart(6)}  ${pct(n)}`;
  return [
    `Context ~${k(used)} of ${b.threshold > 0 ? `${k(b.threshold)} (auto-compacts there)` : 'no auto-compact limit'}`,
    row('system prompt', b.system),
    row('tool schemas', b.tools),
    row('conversation', b.conversation),
    b.threshold > 0 ? `  free         ${k(Math.max(0, b.threshold - used)).padStart(6)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** /export: transcript → markdown file in the project dir; returns the path. */
export function exportTranscript(
  entries: TranscriptEntry[],
  dir: string,
  now = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(dir, `lepus-transcript-${stamp}.md`);
  const body = entries
    .map((e) => {
      const text = stripControlSequences(e.fullText ?? e.text ?? '');
      if (e.kind === 'user') return `## You\n\n${text}`;
      if (e.kind === 'assistant') return `## Lepus\n\n${text}`;
      if (e.kind === 'tool-call' || e.kind === 'tool-result') return `\`\`\`\n${text}\n\`\`\``;
      return text ? `> ${text.replace(/\n/g, '\n> ')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  writeFileSync(path, `# Lepus transcript · ${now.toISOString()}\n\n${body}\n`, { mode: 0o600 });
  return path;
}
