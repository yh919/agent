import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliClient, extractToolCalls } from './cliclient.js';
import type { ToolSpec } from './types.js';

const tool: ToolSpec = {
  type: 'function',
  function: { name: 'http_request', description: 'send', parameters: { type: 'object' } },
};

// Fake `claude` that streams whatever reply is in $FAKE_REPLY as stream-json.
const bin = mkdtempSync(join(tmpdir(), 'fake-claude-'));
writeFileSync(
  join(bin, 'claude'),
  `#!/usr/bin/env node
const t = process.env.FAKE_REPLY, h = Math.ceil(t.length / 2);
for (const p of [t.slice(0, h), t.slice(h)])
  console.log(JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: p } } }));
console.log(JSON.stringify({ type: 'result', is_error: false, usage: { input_tokens: 3, output_tokens: 5 } }));
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
