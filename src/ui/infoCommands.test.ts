import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPlanUsage } from '../llm/cliclient.js';
import { exportTranscript, formatContext } from './infoCommands.js';

describe('info commands', () => {
  it('formats plan windows with percent and reset time', () => {
    const now = 1_000_000_000_000;
    const out = formatPlanUsage(
      { at: now, windows: { five_hour: { utilization: 0.55, resetsAt: now / 1000 + 2 * 3600 } } },
      now,
    );
    expect(out).toContain('5-hour');
    expect(out).toContain('55% used · resets in 2h');
  });

  it('breaks down context against the compact threshold', () => {
    const out = formatContext({
      system: 10_000,
      tools: 5_000,
      conversation: 15_000,
      threshold: 150_000,
    });
    expect(out).toContain('Context ~30k of 150k');
    expect(out).toMatch(/conversation\s+15k\s+10%/);
  });

  it('exports the transcript as markdown without ANSI codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    const path = exportTranscript(
      [
        { kind: 'user', text: 'scan it' },
        { kind: 'assistant', text: 'done' },
        { kind: 'tool-result', text: '\u001b[32mok\u001b[0m' },
      ],
      dir,
    );
    const md = readFileSync(path, 'utf8');
    expect(md).toContain('## You\n\nscan it');
    expect(md).toContain('## Lepus\n\ndone');
    expect(md).not.toContain('\u001b[');
  });
});
