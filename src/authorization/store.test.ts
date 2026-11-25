import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthorizationEntry, AuthorizationStore, normalizeHost } from './store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lepus-auth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<AuthorizationEntry> = {}): AuthorizationEntry {
  return {
    host: 'app.example.com',
    status: 'acknowledged',
    at: '2026-11-25T10:00:00.000Z',
    tool: 'http',
    url: 'https://app.example.com/api',
    ...overrides,
  };
}

describe('normalizeHost', () => {
  it('lowercases and strips brackets / trailing dot', () => {
    expect(normalizeHost('App.Example.COM.')).toBe('app.example.com');
    expect(normalizeHost('[::1]')).toBe('::1');
  });
});

describe('AuthorizationStore', () => {
  it('starts empty and writes the file under .lepus/agent with mode 0600', async () => {
    const store = new AuthorizationStore({ cwd: dir });
    expect(store.list()).toEqual([]);
    expect(store.isAcknowledged('app.example.com')).toBe(false);

    await store.record(entry());

    expect(store.path).toBe(join(dir, '.lepus', 'agent', 'authorizations.json'));
    expect(store.isAcknowledged('APP.example.com.')).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(store.path).mode & 0o777).toBe(0o600);
    }
  });

  it('never lets a YOLO auto-approval downgrade an operator acknowledgment', async () => {
    const store = new AuthorizationStore({ cwd: dir });
    await store.record(entry());
    await store.record(entry({ status: 'auto-approved-yolo', at: '2026-11-25T11:00:00.000Z' }));
    expect(store.get('app.example.com')?.status).toBe('acknowledged');
    expect(store.list()).toHaveLength(1);
  });

  it('upgrades a YOLO auto-approval when the operator later acknowledges', async () => {
    const store = new AuthorizationStore({ cwd: dir });
    await store.record(entry({ status: 'auto-approved-yolo' }));
    expect(store.isAcknowledged('app.example.com')).toBe(false);
    await store.record(entry({ at: '2026-11-25T12:00:00.000Z' }));
    expect(store.isAcknowledged('app.example.com')).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it('keeps one entry per host across concurrent records', async () => {
    const store = new AuthorizationStore({ cwd: dir });
    await Promise.all([
      store.record(entry({ host: 'a.example.com' })),
      store.record(entry({ host: 'b.example.com' })),
      store.record(entry({ host: 'a.example.com' })),
    ]);
    expect(store.list().map((e) => e.host)).toEqual(
      expect.arrayContaining(['a.example.com', 'b.example.com']),
    );
    expect(store.list()).toHaveLength(2);
  });

  it('reads a corrupt or malformed file as empty instead of throwing', () => {
    const store = new AuthorizationStore({ cwd: dir });
    mkdirSync(dirname(store.path), { recursive: true });
    writeFileSync(store.path, '{not json');
    expect(store.list()).toEqual([]);
    writeFileSync(store.path, JSON.stringify({ version: 1, entries: [{ host: 1 }] }));
    expect(store.list()).toEqual([]);
  });
});
