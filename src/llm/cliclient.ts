// Subscription backends: drive a locally signed-in agent CLI (Claude Code,
// Codex, Gemini CLI) as a plain text model, so PentesterFlow can run on the
// user's Claude / ChatGPT / Google plan instead of an API key.
//
// The CLI's own tools are switched off (or sandboxed read-only in an empty
// dir) — PentesterFlow keeps its tool loop and permission gates. Tools are
// described in the prompt and calls come back as JSON text, parsed with the
// same content-tool-call parser the local backends use.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { StreamingClient } from './client.js';
import { parseContentToolCalls } from './contentToolCalls.js';
import { newCallID } from './ids.js';
import type { ChatRequest, ChatResponse, Message, ToolSpec, Usage } from './types.js';

export type CliBackend = 'claude-code' | 'codex' | 'gemini-cli';

export const CLI_BACKENDS: Record<
  CliBackend,
  { bin: string; label: string; login: string; models: string[] }
> = {
  'claude-code': {
    bin: 'claude',
    label: 'Claude account',
    login: 'claude auth login',
    models: ['sonnet', 'opus', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  codex: { bin: 'codex', label: 'ChatGPT account', login: 'codex login', models: [] },
  'gemini-cli': { bin: 'gemini', label: 'Google account', login: 'gemini', models: [] },
};

export function isCliBackend(b: string): b is CliBackend {
  return b in CLI_BACKENDS;
}

/** Is the backend's CLI on PATH? (Signed-in state is only known on first call.) */
export function cliInstalled(b: CliBackend): boolean {
  const { bin } = CLI_BACKENDS[b];
  return (process.env.PATH ?? '').split(delimiter).some((d) => d && existsSync(join(d, bin)));
}

function toolProtocol(tools: ToolSpec[]): string {
  if (!tools.length) return '';
  const list = tools
    .map(
      (t) =>
        `- ${t.function.name}: ${t.function.description}\n  parameters: ${JSON.stringify(t.function.parameters)}`,
    )
    .join('\n');
  return `\n\n# Tools\nYou cannot run anything yourself; the host runs these tools for you:\n${list}\n\nTo call tools, reply with ONLY this JSON and nothing else (no prose, no code fence):\n{"tool_calls":[{"name":"<tool>","arguments":{...}}]}\nResults come back as <tool_result> blocks. When no tool is needed, reply in plain text.`;
}

/** Render the conversation (minus system) as one text transcript. */
export function renderTranscript(messages: Message[]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push(
        `<tool_result name="${m.name ?? ''}" id="${m.toolCallID ?? ''}">\n${m.content}\n</tool_result>`,
      );
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls?.length
        ? `\n${JSON.stringify({ tool_calls: m.toolCalls.map((c) => ({ name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') })) })}`
        : '';
      out.push(`<assistant>\n${m.content}${calls}\n</assistant>`);
    } else {
      out.push(`<user>\n${m.content}\n</user>`);
    }
  }
  return `${out.join('\n\n')}\n\nContinue as the assistant. Reply with your next message only.`;
}

/** Tool calls from reply text: the whole reply, else the trailing {"tool_calls"…} object. */
export function extractToolCalls(text: string, known: Set<string>) {
  const whole = parseContentToolCalls(text, known);
  if (whole.length) return whole;
  const i = text.indexOf('{"tool_calls"');
  return i >= 0 ? parseContentToolCalls(text.slice(i).replace(/```\s*$/, ''), known) : [];
}

export class CliClient implements StreamingClient {
  // Empty scratch dir: CLIs that keep read-only tools see nothing of the user's tree.
  private readonly cwd = mkdtempSync(join(tmpdir(), 'pentesterflow-cli-'));

  constructor(
    private readonly backend: CliBackend,
    private readonly modelID: string,
  ) {}

  name(): string {
    return this.backend;
  }

  model(): string {
    return this.modelID;
  }

  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    return this.chatStream(req, () => {}, signal);
  }

  private argv(system: string): string[] {
    const m = this.modelID && this.modelID !== 'default' ? ['--model', this.modelID] : [];
    switch (this.backend) {
      case 'claude-code':
        return [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--tools',
          '',
          '--strict-mcp-config',
          '--setting-sources',
          '',
          '--no-session-persistence',
          '--system-prompt',
          system,
          ...m,
        ];
      case 'codex':
        return [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          '-s',
          'read-only',
          '-C',
          this.cwd,
          ...m,
          '-',
        ];
      case 'gemini-cli':
        return ['-p', '', '-o', 'stream-json', '--approval-mode', 'plan', ...m];
    }
  }

  async chatStream(
    req: ChatRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const tools = req.tools ?? [];
    const system =
      req.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n') + toolProtocol(tools);
    const transcript = renderTranscript(req.messages);
    // Only Claude Code takes a separate system prompt; the others get it inline.
    const stdin = this.backend === 'claude-code' ? transcript : `${system}\n\n${transcript}`;

    // An exported API key would bill the API instead of the signed-in plan.
    const { ANTHROPIC_API_KEY: _apiKey, ...noKey } = process.env;
    const env = this.backend === 'claude-code' ? noKey : process.env;
    const { bin, login } = CLI_BACKENDS[this.backend];
    const child = spawn(bin, this.argv(system), {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const kill = () => child.kill();
    signal?.addEventListener('abort', kill, { once: true });

    let text = '';
    let shown = 0; // chars of `text` already sent to onDelta
    let usage: Usage | undefined;
    let failure = '';
    let stderr = '';
    // Hold back output that looks like a tool-call JSON reply so raw JSON never flashes in the UI.
    const push = (s: string) => {
      text += s;
      const head = text.trimStart();
      if (head.startsWith('{') || head.startsWith('`') || head.length < 2) return;
      onDelta(text.slice(shown));
      shown = text.length;
    };
    // biome-ignore lint/suspicious/noExplicitAny: loosely-typed CLI JSON events, each field read defensively
    const onEvent = (ev: Record<string, any>) => {
      switch (this.backend) {
        case 'claude-code':
          if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta')
            push(ev.event.delta.text);
          else if (ev.type === 'result') {
            const u = ev.usage ?? {};
            usage = {
              inputTokens:
                (u.input_tokens ?? 0) +
                (u.cache_read_input_tokens ?? 0) +
                (u.cache_creation_input_tokens ?? 0),
              outputTokens: u.output_tokens ?? 0,
              cachedInputTokens: u.cache_read_input_tokens,
            };
            if (ev.is_error) failure = String(ev.result ?? 'Claude Code error');
          }
          break;
        case 'codex':
          if (ev.type === 'item.completed' && ev.item?.type === 'agent_message')
            push(ev.item.text ?? '');
          else if (ev.type === 'turn.completed' && ev.usage)
            usage = {
              inputTokens: ev.usage.input_tokens ?? 0,
              outputTokens: ev.usage.output_tokens ?? 0,
              cachedInputTokens: ev.usage.cached_input_tokens,
            };
          else if (ev.type === 'turn.failed') failure = ev.error?.message ?? 'Codex turn failed';
          break;
        case 'gemini-cli':
          if (ev.type === 'message' && ev.role === 'assistant') push(ev.content ?? '');
          else if (ev.type === 'result' && ev.stats)
            usage = {
              inputTokens: ev.stats.input_tokens ?? 0,
              outputTokens: ev.stats.output_tokens ?? 0,
            };
          else if (ev.type === 'error') failure = ev.message ?? 'Gemini CLI error';
          break;
      }
    };

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', (e) =>
        reject(
          new Error(
            `could not start \`${bin}\` (${e.message}) — install it and sign in with \`${login}\``,
          ),
        ),
      );
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
          if (!line.startsWith('{')) continue;
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* non-JSON noise */
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      child.on('close', resolve);
      child.stdin.end(stdin);
    }).finally(() => signal?.removeEventListener('abort', kill));

    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (failure || code !== 0) {
      const why = failure || stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`;
      throw new Error(`${this.backend}: ${why} — if signed out, run \`${login}\``);
    }

    const calls = extractToolCalls(text, new Set(tools.map((t) => t.function.name)));
    if (calls.length) {
      return {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: calls.map((c) => ({
            id: newCallID(),
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        },
        finishReason: 'tool_calls',
        usage,
      };
    }
    if (shown < text.length) onDelta(text.slice(shown)); // held-back text that wasn't a tool call
    return { message: { role: 'assistant', content: text.trim() }, finishReason: 'stop', usage };
  }
}
