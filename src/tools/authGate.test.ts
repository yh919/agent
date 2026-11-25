import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationStore } from '../authorization/store.js';
import { type Prompter, TieredPrompter } from '../permission/permission.js';
import { gateAuthorization } from './authGate.js';

let dir: string;
let store: AuthorizationStore;
const url = new URL('https://App.Example.com/api/orders/1');
const signal = new AbortController().signal;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lepus-authgate-'));
  store = new AuthorizationStore({ cwd: dir });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gateAuthorization', () => {
  it('is a no-op without a store', async () => {
    const ask = vi.fn();
    expect(await gateAuthorization({ ask }, url, signal, 'http', undefined)).toBe('');
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once per host, records the acknowledgment, then stays quiet', async () => {
    const ask = vi.fn().mockResolvedValue('allow-once');
    const p: Prompter = { ask };

    const note = await gateAuthorization(p, url, signal, 'http', store);
    expect(note).toMatch(/acknowledged and recorded/);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'authorization', noSessionCache: true }),
      signal,
    );
    const rec = store.get('app.example.com');
    expect(rec?.status).toBe('acknowledged');
    expect(rec?.tool).toBe('http');
    expect(rec?.url).toBe(url.href);

    // Second request to the same host: no prompt, no note.
    expect(await gateAuthorization(p, url, signal, 'http', store)).toBe('');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('blocks and records nothing when the operator denies', async () => {
    const p: Prompter = { ask: vi.fn().mockResolvedValue('deny') };
    await expect(gateAuthorization(p, url, signal, 'http', store)).rejects.toThrow(
      /not authorized to test app\.example\.com/,
    );
    expect(store.list()).toEqual([]);
  });

  it('lets YOLO through but records it as not operator-acknowledged', async () => {
    const inner = { ask: vi.fn() };
    const yolo = new TieredPrompter(inner, 'yolo');

    const note = await gateAuthorization(yolo, url, signal, 'http', store);
    expect(note).toMatch(/auto-approved by YOLO/);
    expect(inner.ask).not.toHaveBeenCalled(); // YOLO never reaches the human
    expect(store.get('app.example.com')?.status).toBe('auto-approved-yolo');
    expect(store.isAcknowledged('app.example.com')).toBe(false);

    // Still in YOLO: quiet on repeat requests.
    expect(await gateAuthorization(yolo, url, signal, 'http', store)).toBe('');

    // Leaving YOLO: the operator is asked for a real acknowledgment.
    inner.ask.mockResolvedValue('allow-once');
    yolo.setMode('ask');
    expect(await gateAuthorization(yolo, url, signal, 'http', store)).toMatch(/acknowledged/);
    expect(inner.ask).toHaveBeenCalledTimes(1);
    expect(store.isAcknowledged('app.example.com')).toBe(true);
  });

  it('is not auto-approved by auto-safe mode', async () => {
    const inner = { ask: vi.fn().mockResolvedValue('deny') };
    const autoSafe = new TieredPrompter(inner, 'auto-safe');
    await expect(gateAuthorization(autoSafe, url, signal, 'http', store)).rejects.toThrow();
    expect(inner.ask).toHaveBeenCalledTimes(1);
  });
});
