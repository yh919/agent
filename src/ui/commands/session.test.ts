import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../agent/agent.js';
import type { Client } from '../../llm/client.js';
import { AlwaysAllow } from '../../permission/permission.js';
import { Store } from '../../session/store.js';
import { newRegistry } from '../../skills/registry.js';
import { Target } from '../../target/target.js';
import { Registry as ToolRegistry } from '../../tools/registry.js';
import type { Action } from '../state.js';
import { handleSlash } from './index.js';

let tmp = '';
let store: Store;
let agent: Agent;
let dispatched: Action[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pf-cmd-session-'));
  store = Store.newWithID(tmp, 'test-session-id');
  agent = new Agent({
    client: {
      name: () => 'stub',
      model: () => 'stub',
      chat: async () => ({
        message: { role: 'assistant', content: 'stub' },
        finishReason: 'stop',
      }),
    } as Client,
    tools: new ToolRegistry(),
    skills: newRegistry(),
    target: new Target(),
    prompter: new AlwaysAllow(),
    store,
  });
  dispatched = [];
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeDeps() {
  return {
    exit: vi.fn(),
    clearScreen: vi.fn(),
    yolo: false,
    applyYolo: vi.fn(),
    compactMode: false,
    applyCompactMode: vi.fn(),
    readConfig: () => ({
      backend: 'ollama' as const,
      baseURL: '',
      apiKey: '',
      model: 'stub',
    }),
    applyProvider: vi.fn(),
    promptSecret: vi.fn(),
    persistDisabledSkills: vi.fn(),
    onSkillCreated: vi.fn(),
    runAgentTurn: vi.fn(),
    runAgentCompact: vi.fn(),
    startBurpBridge: vi.fn(),
    generateFindingsReport: vi.fn(),
  };
}

describe('/rename command', () => {
  it('prints usage when no argument is given', () => {
    const handled = handleSlash(agent, '/rename', (a) => dispatched.push(a), makeDeps());
    expect(handled).toBe(true);
    const entry = dispatched.find((d) => d.type === 'append' && d.entry.kind === 'system');
    expect(entry).toBeDefined();
    if (entry && entry.type === 'append') {
      expect(entry.entry.text).toContain('usage: /rename <new-name>');
    }
  });

  it('renames the session when an argument is provided', async () => {
    await store.save([{ role: 'user', content: 'test message' }], null);
    const handled = handleSlash(
      agent,
      '/rename Web Auth Assessment',
      (a) => dispatched.push(a),
      makeDeps(),
    );
    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    expect(agent.getSessionName()).toBe('Web Auth Assessment');
    expect(agent.getSessionID()).toBe('web-auth-assessment');

    const entry = dispatched.find((d) => d.type === 'append' && d.entry.kind === 'system');
    expect(entry).toBeDefined();
    if (entry && entry.type === 'append') {
      expect(entry.entry.text).toContain('session renamed to "Web Auth Assessment"');
    }
  });
});

describe('/session command', () => {
  it('delegates /session rename to handleRename', async () => {
    await store.save([{ role: 'user', content: 'test message' }], null);
    const handled = handleSlash(
      agent,
      '/session rename Scope Alpha',
      (a) => dispatched.push(a),
      makeDeps(),
    );
    expect(handled).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    expect(agent.getSessionName()).toBe('Scope Alpha');
    expect(agent.getSessionID()).toBe('scope-alpha');
  });

  it('shows session details on bare /session', () => {
    const handled = handleSlash(agent, '/session', (a) => dispatched.push(a), makeDeps());
    expect(handled).toBe(true);
    const entry = dispatched.find((d) => d.type === 'append' && d.entry.kind === 'system');
    expect(entry).toBeDefined();
    if (entry && entry.type === 'append') {
      expect(entry.entry.text).toContain('Session:');
      expect(entry.entry.text).toContain('/rename <name>');
    }
  });
});
