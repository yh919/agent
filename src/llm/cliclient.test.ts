import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliClient, extractToolCalls } from './cliclient.js';
import type { ClientEvent } from './client.js';
import { type Message, TURN_CONTEXT_MARKER, type ToolSpec } from './types.js';

const tool: ToolSpec = {
  type: 'function',
  function: { name: 'http_request', description: 'send', parameters: { type: 'object' } },
};

// Fake `claude` that streams whatever reply is in $FAKE_REPLY as stream-json.
const bin = mkdtempSync(join(tmpdir(), 'fake-claude-'));
writeFileSync(
  join(bin, 'claude'),
  `#!/usr/bin/env node
const fs = require('node:fs');
// Record argv + stdin so tests can check what was sent.
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin: fs.readFileSync(0, 'utf8') }) + '\\n');
for (const l of (process.env.FAKE_EVENTS || '').split('\\n').filter(Boolean)) console.log(l);
const t = process.env.FAKE_REPLY, h = Math.ceil(t.length / 2);
for (const p of [t.slice(0, h), t.slice(h)])
  console.log(JSON.stringify({ type: 'stream_event', session_id: 'sess-1', event: { delta: { type: 'text_delta', text: p } } }));
console.log(JSON.stringify({ type: 'result', session_id: 'sess-1', is_error: false, usage: { input_tokens: 3, output_tokens: 5 } }));
`,
);
chmodSync(join(bin, 'claude'), 0o755);
const oldPath = process.env.PATH;
beforeAll(() => {
  process.env.PATH = `${bin}${delimiter}${oldPath}`;
});
afterAll(() => {
  process.env.PATH = oldPath;
});

const run = async (reply: string) => {
  process.env.FAKE_REPLY = reply;
  let streamed = '';
  const res = await new CliClient('claude-code', 'default').chatStream(
    { model: 'default', messages: [{ role: 'user', content: 'go' }], tools: [tool] },
    (d) => {
      streamed += d;
    },
  );
  return { res, streamed };
};

describe('CliClient (claude-code)', () => {
  it('streams plain text and reports usage', async () => {
    const { res, streamed } = await run('hello there');
    expect(streamed).toBe('hello there');
    expect(res.message.content).toBe('hello there');
    expect(res.usage?.outputTokens).toBe(5);
  });

  it('turns a JSON reply into tool calls without streaming the JSON', async () => {
    const { res, streamed } = await run(
      '{"tool_calls":[{"name":"http_request","arguments":{"url":"https://x"}}]}',
    );
    expect(streamed).toBe('');
    expect(res.finishReason).toBe('tool_calls');
    expect(res.message.toolCalls?.[0]?.function.name).toBe('http_request');
  });

  it('finds a trailing tool call after prose and ignores unknown tools', () => {
    const known = new Set(['http_request']);
    expect(
      extractToolCalls('Sure.\n{"tool_calls":[{"name":"http_request","arguments":{}}]}', known),
    ).toHaveLength(1);
    expect(extractToolCalls('{"tool_calls":[{"name":"rm","arguments":{}}]}', known)).toHaveLength(
      0,
    );
  });
});

describe('CliClient session reuse (claude-code)', () => {
  it('resumes with only new messages, re-sends turn context only when it changes, restarts on rewind', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'fake-log-')), 'calls.jsonl');
    process.env.FAKE_LOG = log;
    process.env.FAKE_REPLY = 'ok';
    const c = new CliClient('claude-code', 'default');
    const sys = (extra: string): Message => ({
      role: 'system',
      content: `BASE${TURN_CONTEXT_MARKER}${extra}`,
    });
    const m1: Message[] = [sys('route A'), { role: 'user', content: 'first question' }];
    const r1 = await c.chat({ model: 'default', messages: m1 });
    const m2 = [...m1, r1.message, { role: 'user' as const, content: 'second question' }];
    const r2 = await c.chat({ model: 'default', messages: m2 });
    const m3 = [
      sys('route B'),
      ...m2.slice(1),
      r2.message,
      { role: 'user' as const, content: 'third' },
    ];
    await c.chat({ model: 'default', messages: m3 });
    // Rewind: history no longer extends what the session holds.
    await c.chat({
      model: 'default',
      messages: [sys('route B'), { role: 'user', content: 'edited first' }],
    });
    process.env.FAKE_LOG = '';

    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l)) as Array<{ argv: string[]; stdin: string }>;
    const sysArg = (a: string[]) => a[a.indexOf('--system-prompt') + 1];
    expect(calls.map((c) => c.argv.includes('--resume'))).toEqual([false, true, true, false]);
    expect(calls.every((c) => sysArg(c.argv) === 'BASE')).toBe(true); // stable → cacheable
    expect(calls[0]?.stdin).toContain('<turn-context>\nroute A');
    expect(calls[1]?.stdin).not.toContain('first question');
    expect(calls[1]?.stdin).toContain('second question');
    expect(calls[1]?.stdin).not.toContain('turn-context'); // unchanged → not re-sent
    expect(calls[2]?.stdin).toContain('route B');
    expect(calls[3]?.stdin).toContain('edited first');
  });
});

describe('CliClient side events (claude-code)', () => {
  const ev = (o: object) => JSON.stringify(o);
  const fallback = ev({
    type: 'system',
    subtype: 'model_refusal_fallback',
    original_model: 'claude-sonnet-5-5',
    fallback_model: 'claude-sonnet-5',
    api_refusal_category: 'cyber',
    api_refusal_explanation: 'Flagged. Apply: https://support.claude.com/cvp.',
  });
  const thinking = ev({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 1200 });
  const refused = [
    ev({ type: 'stream_event', event: { type: 'message_start' } }),
    ev({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: {
          stop_reason: 'refusal',
          stop_details: { explanation: 'Cyber safeguards flagged this.' },
        },
      },
    }),
  ].join('\n');

  it('reports thinking tokens and safeguard fallbacks as client events', async () => {
    process.env.FAKE_EVENTS = [thinking, fallback].join('\n');
    process.env.FAKE_REPLY = 'answer';
    const seen: ClientEvent[] = [];
    await new CliClient('claude-code', 'default').chatStream(
      { model: 'default', messages: [{ role: 'user', content: 'q' }] },
      () => {},
      undefined,
      undefined,
      (e) => seen.push(e),
    );
    process.env.FAKE_EVENTS = '';
    expect(seen[0]).toEqual({ type: 'thinking', tokens: 1200 });
    expect(seen[1]?.type === 'notice' && seen[1].text).toContain('retried on claude-sonnet-5');
    expect(seen[1]?.type === 'notice' && seen[1].text).toContain('https://support.claude.com/cvp');
  });

  it('turns a refusal with no text into a clear error', async () => {
    process.env.FAKE_EVENTS = refused;
    process.env.FAKE_REPLY = '';
    await expect(
      new CliClient('claude-code', 'default').chat({
        model: 'default',
        messages: [{ role: 'user', content: 'q' }],
      }),
    ).rejects.toThrow('Claude declined this request: Cyber safeguards flagged this.');
    process.env.FAKE_EVENTS = '';
  });
});
