// Subscription backends: drive a locally signed-in agent CLI (Claude Code,
// Codex, Gemini CLI) as a plain text model, so PentesterFlow can run on the
// user's Claude / ChatGPT / Google plan instead of an API key.
//
// The CLI's own tools are switched off (or sandboxed read-only in an empty
// dir) — PentesterFlow keeps its tool loop and permission gates. Tools are
// described in the prompt and calls come back as JSON text, parsed with the
// same content-tool-call parser the local backends use.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { ClientEvent, StreamingClient } from './client.js';
import { parseContentToolCalls } from './contentToolCalls.js';
import { newCallID } from './ids.js';
import type { RetryInfo } from './retry.js';
import {
  type ChatRequest,
  type ChatResponse,
  type Message,
  TURN_CONTEXT_MARKER,
  type ToolSpec,
  type Usage,
} from './types.js';

export type CliBackend = 'claude-code' | 'codex' | 'gemini-cli';

export const CLI_BACKENDS: Record<
  CliBackend,
  { bin: string; label: string; login: string; models: string[] }
> = {
  'claude-code': {
    bin: 'claude',
    label: 'Claude account',
    login: 'claude auth login',
    // Aliases track the latest of each tier; fable needs usage credits on most plans.
    models: [
      'sonnet',
      'opus',
      'haiku',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'fable',
    ],
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

/** One non-system message as transcript text. */
export function renderMessage(m: Message): string {
  if (m.role === 'tool') {
    return `<tool_result name="${m.name ?? ''}" id="${m.toolCallID ?? ''}">\n${m.content}\n</tool_result>`;
  }
  if (m.role === 'assistant') {
    const calls = m.toolCalls?.length
      ? `\n${JSON.stringify({ tool_calls: m.toolCalls.map((c) => ({ name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') })) })}`
      : '';
    return `<assistant>\n${m.content}${calls}\n</assistant>`;
  }
  return `<user>\n${m.content}\n</user>`;
}

const CONTINUE = '\n\nContinue as the assistant. Reply with your next message only.';

/** Render the conversation (minus system) as one text transcript. */
export function renderTranscript(messages: Message[]): string {
  return (
    messages
      .filter((m) => m.role !== 'system')
      .map(renderMessage)
      .join('\n\n') + CONTINUE
  );
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
  private readonly cwd = mkdtempSync(join(tmpdir(), 'lepus-cli-'));
  /**
   * Claude Code session reused across calls: only messages it hasn't seen are
   * sent, and the system prompt stays byte-identical so the prompt cache hits.
   * `sent` is the rendered transcript the session already holds.
   */
  private session?: { id: string; base: string; extra: string; sent: string[] };
  /** Model Claude Code fell back to after a safeguard refusal; later calls go
   *  straight there instead of paying for a refused attempt every turn. */
  private fallbackModel = '';

  constructor(
    private readonly backend: CliBackend,
    private readonly modelID: string,
    /** low | medium | high | xhigh | max ('' = CLI default). */
    private readonly effort = '',
  ) {}

  /** For the status line / /model: current reasoning effort ('' = default). */
  getEffort(): string {
    return this.effort;
  }

  name(): string {
    return this.backend;
  }

  model(): string {
    return this.modelID;
  }

  chat(
    req: ChatRequest,
    signal?: AbortSignal,
    onRetry?: (info: RetryInfo) => void,
  ): Promise<ChatResponse> {
    return this.chatStream(req, () => {}, signal, onRetry);
  }

  private argv(system: string, resumeID?: string): string[] {
    const id = this.fallbackModel || this.modelID;
    const m = id && id !== 'default' ? ['--model', id] : [];
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
          '--system-prompt',
          system,
          ...(resumeID ? ['--resume', resumeID] : []),
          ...(this.effort ? ['--effort', this.effort] : []),
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
          // Codex tops out at "high"; xhigh/max map onto it.
          ...(this.effort
            ? [
                '-c',
                `model_reasoning_effort=${['xhigh', 'max'].includes(this.effort) ? 'high' : this.effort}`,
              ]
            : []),
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
    _onRetry?: (info: RetryInfo) => void,
    onEvent?: (ev: ClientEvent) => void,
  ): Promise<ChatResponse> {
    const tools = req.tools ?? [];
    const sys = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const cut = sys.indexOf(TURN_CONTEXT_MARKER);
    const base = (cut >= 0 ? sys.slice(0, cut) : sys) + toolProtocol(tools);
    const extra = cut >= 0 ? sys.slice(cut + TURN_CONTEXT_MARKER.length).trim() : '';
    const blocks = req.messages.filter((m) => m.role !== 'system').map(renderMessage);

    let system: string;
    let stdin: string;
    let resumeID: string | undefined;
    let sessExtra = ''; // turn-context the session holds after this call
    if (this.backend === 'claude-code') {
      // Reuse the session when its system prompt and transcript are a prefix of
      // this request (rewind / compaction / provider swap → fresh session).
      const sess = this.session;
      const reuse =
        sess &&
        sess.base === base &&
        sess.sent.length <= blocks.length &&
        sess.sent.every((b, i) => b === blocks[i]);
      resumeID = reuse ? sess.id : undefined;
      const fresh = reuse ? blocks.slice(sess.sent.length) : blocks;
      const sendExtra = extra && !(reuse && sess.extra === extra);
      sessExtra = sendExtra ? extra : reuse ? sess.extra : '';
      system = base;
      stdin =
        (sendExtra ? `<turn-context>\n${extra}\n</turn-context>\n\n` : '') +
        fresh.join('\n\n') +
        CONTINUE;
    } else {
      // Codex / Gemini CLI: stateless, whole prompt inline every call.
      system = extra ? `${base}\n\n${extra}` : base;
      stdin = `${system}\n\n${blocks.join('\n\n')}${CONTINUE}`;
    }

    // An exported API key would bill the API instead of the signed-in plan.
    const { ANTHROPIC_API_KEY: _apiKey, ...noKey } = process.env;
    const env = this.backend === 'claude-code' ? noKey : process.env;
    const { bin, login } = CLI_BACKENDS[this.backend];
    const child = spawn(bin, this.argv(system, resumeID), {
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
    let sessionID = '';
    let refusal = ''; // explanation when the last message ended in a safety refusal
    // Hold back output that looks like a tool-call JSON reply so raw JSON never flashes in the UI.
    const push = (s: string) => {
      text += s;
      const head = text.trimStart();
      if (head.startsWith('{') || head.startsWith('`') || head.length < 2) return;
      onDelta(text.slice(shown));
      shown = text.length;
    };
    // biome-ignore lint/suspicious/noExplicitAny: loosely-typed CLI JSON events, each field read defensively
    const onLine = (ev: Record<string, any>) => {
      switch (this.backend) {
        case 'claude-code':
          if (typeof ev.session_id === 'string') sessionID = ev.session_id;
          if (ev.type === 'system' && ev.subtype === 'thinking_tokens')
            onEvent?.({ type: 'thinking', tokens: Number(ev.estimated_tokens) || 0 });
          else if (ev.type === 'system' && ev.subtype === 'model_refusal_fallback') {
            if (typeof ev.fallback_model === 'string') this.fallbackModel = ev.fallback_model;
            onEvent?.({ type: 'notice', text: refusalNotice(ev) });
          } else if (ev.type === 'stream_event' && ev.event?.type === 'message_start') refusal = '';
          else if (ev.type === 'stream_event' && ev.event?.delta?.stop_reason === 'refusal')
            refusal = String(ev.event.delta.stop_details?.explanation ?? 'the request was refused');
          if (ev.type === 'rate_limit_event') savePlanUsage(ev.rate_limit_info);
          else if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta')
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
            onLine(JSON.parse(line));
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

    if (signal?.aborted) {
      this.session = undefined; // the CLI may hold a half-written turn
      throw new DOMException('aborted', 'AbortError');
    }
    if ((failure || code !== 0) && resumeID) {
      // Resume failed (session expired / pruned): retry once from scratch.
      this.session = undefined;
      return this.chatStream(req, onDelta, signal, _onRetry, onEvent);
    }
    if (!failure && code === 0 && refusal && !text.trim()) {
      throw new Error(`Claude declined this request: ${refusal}`);
    }
    if (failure || code !== 0) {
      const why = failure || stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`;
      throw new Error(`${this.backend}: ${why} — if signed out, run \`${login}\``);
    }

    const res = this.toResponse(text, tools, usage, onDelta, shown);
    if (this.backend === 'claude-code' && sessionID) {
      this.session = {
        id: sessionID,
        base,
        extra: sessExtra,
        sent: [...blocks, renderMessage(res.message)],
      };
    }
    return res;
  }

  private toResponse(
    text: string,
    tools: ToolSpec[],
    usage: Usage | undefined,
    onDelta: (delta: string) => void,
    shown: number,
  ): ChatResponse {
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

// ---------- Claude plan usage (5-hour / weekly windows) ----------

export interface PlanWindow {
  utilization: number; // 0..1
  resetsAt: number; // unix seconds
}
export interface PlanUsage {
  at: number; // ms, when Claude reported it
  windows: Record<string, PlanWindow>;
}

export function planUsagePath(): string {
  return join(homedir(), '.lepus', 'agent', 'plan-usage.json');
}

/** Claude Code streams a rate_limit_event per request; keep the latest on disk. */
function savePlanUsage(info: unknown, path = planUsagePath()): void {
  const windows = (info as { unifiedWindows?: Record<string, PlanWindow> } | undefined)
    ?.unifiedWindows;
  if (!windows) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ at: Date.now(), windows } satisfies PlanUsage));
  } catch {
    /* best-effort */
  }
}

export function readPlanUsage(path = planUsagePath()): PlanUsage | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PlanUsage;
  } catch {
    return null;
  }
}

/** Human summary for /usage. */
export function formatPlanUsage(u: PlanUsage, now = Date.now()): string {
  const names: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' };
  const bar = (f: number) => {
    const n = Math.round(Math.min(1, Math.max(0, f)) * 20);
    return `${'█'.repeat(n)}${'░'.repeat(20 - n)}`;
  };
  const when = (sec: number) => {
    const mins = Math.max(0, Math.round((sec * 1000 - now) / 60_000));
    return mins < 60
      ? `${mins}m`
      : mins < 2880
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;
  };
  const age = Math.round((now - u.at) / 60_000);
  const lines = Object.entries(u.windows).map(
    ([k, w]) =>
      `  ${(names[k] ?? k).padEnd(8)} ${bar(w.utilization)} ${Math.round(w.utilization * 100)}% used · resets in ${when(w.resetsAt)}`,
  );
  return [`Claude plan usage (reported ${age < 1 ? 'just now' : `${age}m ago`})`, ...lines].join(
    '\n',
  );
}

/** User-facing line for a safety refusal the CLI retried on another model. */
function refusalNotice(ev: Record<string, unknown>): string {
  const cat = typeof ev.api_refusal_category === 'string' ? ev.api_refusal_category : 'safety';
  const from = String(ev.original_model ?? 'the model');
  const to = String(ev.fallback_model ?? 'another model');
  const link = String(ev.api_refusal_explanation ?? '').match(/https:\/\/\S+/)?.[0];
  return `Claude's ${cat} safeguards flagged this request on ${from}; retried on ${to} and staying on it for this chat.${link ? ` For authorized security work: ${link.replace(/[.)]+$/, '')}` : ''}`;
}
