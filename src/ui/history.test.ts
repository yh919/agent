import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendHistory, loadHistory, searchHistory } from './history.js';

describe('prompt history', () => {
  it('persists per project, redacts secrets, and searches newest-first', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hist-')), 'h.jsonl');
    appendHistory('scan /api for idor', '/a', file);
    appendHistory('other project', '/b', file);
    appendHistory('use key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '/a', file);
    appendHistory('scan /admin', '/a', file);

    const h = loadHistory('/a', file);
    expect(h).toHaveLength(3);
    expect(h).not.toContain('other project');
    expect(readFileSync(file, 'utf8')).not.toContain('AAAAAAAAAAAAAAAAAAAA');

    expect(searchHistory(h, 'SCAN')).toBe(2); // newest match first, case-insensitive
    expect(searchHistory(h, 'scan', 2)).toBe(0); // Ctrl+R again → older
    expect(searchHistory(h, 'nope')).toBeNull();
    expect(loadHistory('/a', join(tmpdir(), 'missing-hist.jsonl'))).toEqual([]);
  });
});
