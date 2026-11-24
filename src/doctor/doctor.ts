// `lepus doctor` — preflight diagnostics. Answers "why doesn't it work?" before
// the operator is mid-engagement: is the runtime new enough, is a backend and
// model configured, is a key present where one is needed, can we reach the LLM,
// are the external pentest tools on PATH, and is the data dir writable.
//
// The check logic here is PURE and unit-tested: each function takes already-
// gathered facts and returns a structured Check. The CLI (cli/index.ts) does
// the impure gathering (spawn `which`, probe the LLM, stat the data dir) and
// feeds the facts in, then prints formatReport(). This split keeps the
// decision table testable without a network or a filesystem.

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  /** Short stable label shown at the start of the line. */
  name: string;
  status: CheckStatus;
  /** One-line human-readable result. */
  detail: string;
  /** Optional remediation hint shown under a warn/fail. */
  fix?: string;
}

/** Backends that run locally and need no API key. */
export const LOCAL_BACKENDS: ReadonlySet<string> = new Set(['ollama', 'lmstudio']);

/** Env var(s) that supply a key for each hosted backend, mirroring cli/index.ts. */
export const BACKEND_KEY_ENV: Readonly<Record<string, readonly string[]>> = {
  openai: ['OPENAI_API_KEY'],
  kimi: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  naraya: ['NARAYA_API_KEY'],
  dahl: ['DAHL_API_KEY'],
};

/** External CLIs. `required: true` → missing is a failure; otherwise advisory. */
export interface ToolSpec {
  name: string;
  required: boolean;
  why: string;
}

export const EXTERNAL_TOOLS: readonly ToolSpec[] = [
  { name: 'curl', required: true, why: 'curl-first reproducible requests + shell PoCs' },
  { name: 'git', required: false, why: 'cloning targets, diffing, evidence versioning' },
  { name: 'nmap', required: false, why: 'port/service discovery during recon' },
  { name: 'nuclei', required: false, why: 'templated vulnerability scanning' },
  { name: 'httpx', required: false, why: 'fast HTTP probing of host lists' },
  { name: 'ffuf', required: false, why: 'content/parameter fuzzing' },
  { name: 'subfinder', required: false, why: 'passive subdomain enumeration' },
  { name: 'sqlmap', required: false, why: 'SQL injection confirmation' },
  { name: 'jq', required: false, why: 'slicing JSON responses in shell PoCs' },
];

/** Minimum Node major the project supports (package.json engines: >=20). */
export const MIN_NODE_MAJOR = 20;

export function checkNodeVersion(version: string): Check {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  if (!Number.isFinite(major)) {
    return {
      name: 'runtime',
      status: 'warn',
      detail: `could not parse Node version "${version}"`,
    };
  }
  if (major < MIN_NODE_MAJOR) {
    return {
      name: 'runtime',
      status: 'fail',
      detail: `Node ${version} is below the required ${MIN_NODE_MAJOR}`,
      fix: `install Node ${MIN_NODE_MAJOR}+ (nvm install ${MIN_NODE_MAJOR}) and re-run`,
    };
  }
  return { name: 'runtime', status: 'ok', detail: `Node ${version}` };
}

export interface ConfigFacts {
  loaded: boolean;
  path: string;
  /** Present when the config file existed but failed to parse/validate. */
  error?: string;
}

export function checkConfig(facts: ConfigFacts): Check {
  if (facts.error) {
    return {
      name: 'config',
      status: 'warn',
      detail: `config at ${facts.path} was invalid (${facts.error}); defaults in use`,
      fix: 'fix or delete the file, or reconfigure with /provider in the TUI',
    };
  }
  return {
    name: 'config',
    status: 'ok',
    detail: facts.loaded ? `loaded ${facts.path}` : `no config yet (defaults); ${facts.path}`,
  };
}

export interface BackendFacts {
  backend: string;
  model: string;
  /** True for subscription-CLI backends (claude-code, codex, gemini-cli). */
  isCliBackend: boolean;
}

export function checkBackend(facts: BackendFacts): Check {
  const backend = facts.backend || 'ollama';
  if (!facts.model && !facts.isCliBackend) {
    return {
      name: 'backend',
      status: 'warn',
      detail: `backend "${backend}" has no model set`,
      fix: 'pass --model, or pick one with /model in the TUI',
    };
  }
  const model = facts.model || '(backend default)';
  return { name: 'backend', status: 'ok', detail: `${backend} · ${model}` };
}

export interface ApiKeyFacts {
  backend: string;
  isCliBackend: boolean;
  /** cfg.api_key after the CLI's env merge, or '' if none. */
  hasConfiguredKey: boolean;
  /** process.env snapshot (names → values), used to spot an unmerged key. */
  env: Record<string, string | undefined>;
}

export function checkApiKey(facts: ApiKeyFacts): Check {
  const backend = facts.backend || 'ollama';
  if (LOCAL_BACKENDS.has(backend)) {
    return { name: 'api-key', status: 'ok', detail: `${backend} is local — no key needed` };
  }
  if (facts.isCliBackend) {
    return {
      name: 'api-key',
      status: 'ok',
      detail: `${backend} uses its own CLI auth — no key needed`,
    };
  }
  if (facts.hasConfiguredKey) {
    return { name: 'api-key', status: 'ok', detail: `${backend} key configured` };
  }
  const envVars = BACKEND_KEY_ENV[backend];
  if (envVars) {
    const present = envVars.find((v) => (facts.env[v] ?? '').trim() !== '');
    if (present) {
      return { name: 'api-key', status: 'ok', detail: `${backend} key from $${present}` };
    }
    return {
      name: 'api-key',
      status: 'fail',
      detail: `${backend} needs an API key and none is set`,
      fix: `export ${envVars.join(' or ')}, pass --api-key, or set it with /provider`,
    };
  }
  // openai-compat and custom gateways: a key is often but not always required.
  return {
    name: 'api-key',
    status: 'warn',
    detail: `no key configured for "${backend}" (ok if your endpoint is open)`,
    fix: 'set one with --api-key or /provider if the endpoint rejects anonymous calls',
  };
}

/** Map a probe outcome to a provider-reachability check. */
export function checkProvider(probe: {
  reached: boolean;
  toolSupport: 'yes' | 'no' | 'unknown';
  detail?: string;
}): Check {
  if (!probe.reached) {
    return {
      name: 'llm',
      status: 'fail',
      detail: `could not reach the LLM backend${probe.detail ? ` (${probe.detail})` : ''}`,
      fix: 'check the backend is running / base-url and key are correct, then re-run doctor',
    };
  }
  if (probe.toolSupport === 'no') {
    return {
      name: 'llm',
      status: 'warn',
      detail: 'backend reachable but the model did not emit a tool call',
      fix: 'pick a tool-calling model — the agent loop needs function calls, not prose',
    };
  }
  if (probe.toolSupport === 'unknown') {
    return {
      name: 'llm',
      status: 'warn',
      detail: 'could not verify the LLM (backend offline/slow, or tool support unknown)',
      fix: 'start/point to the backend and re-run; if it is up, the model may not tool-call',
    };
  }
  return { name: 'llm', status: 'ok', detail: 'backend reachable; model emits tool calls' };
}

export function checkExternalTools(found: Record<string, boolean>): Check[] {
  return EXTERNAL_TOOLS.map((t) => {
    const present = found[t.name] === true;
    if (present) return { name: `tool:${t.name}`, status: 'ok' as const, detail: 'found on PATH' };
    if (t.required) {
      return {
        name: `tool:${t.name}`,
        status: 'fail' as const,
        detail: `missing — needed for ${t.why}`,
        fix: `install ${t.name} and ensure it is on PATH`,
      };
    }
    return {
      name: `tool:${t.name}`,
      status: 'warn' as const,
      detail: `not found — ${t.why} unavailable`,
      fix: `optional: install ${t.name} to enable ${t.why}`,
    };
  });
}

export function checkDataDir(facts: { writable: boolean; path: string }): Check {
  if (facts.writable) {
    return { name: 'data-dir', status: 'ok', detail: `writable: ${facts.path}` };
  }
  return {
    name: 'data-dir',
    status: 'fail',
    detail: `cannot write to ${facts.path}`,
    fix: 'fix directory permissions (sessions, findings, and learning are persisted here)',
  };
}

/** Worst status across all checks and the matching process exit code. */
export function summarize(checks: readonly Check[]): { worst: CheckStatus; exitCode: number } {
  let worst: CheckStatus = 'ok';
  for (const c of checks) {
    if (c.status === 'fail') {
      worst = 'fail';
      break;
    }
    if (c.status === 'warn') worst = 'warn';
  }
  return { worst, exitCode: worst === 'fail' ? 1 : 0 };
}

const ICON: Record<CheckStatus, string> = { ok: '✔', warn: '!', fail: '✘' };

/** Render the report as plain text (no ANSI; the caller can colorize). */
export function formatReport(checks: readonly Check[]): string {
  const lines: string[] = ['lepus doctor', ''];
  for (const c of checks) {
    lines.push(`  ${ICON[c.status]} ${c.name}: ${c.detail}`);
    if (c.fix && c.status !== 'ok') lines.push(`      ↳ ${c.fix}`);
  }
  const { worst } = summarize(checks);
  lines.push('');
  if (worst === 'fail') lines.push('result: FAIL — fix the ✘ items above before running.');
  else if (worst === 'warn') lines.push('result: OK with warnings — the ! items are worth a look.');
  else lines.push('result: OK — ready to run.');
  return `${lines.join('\n')}\n`;
}
