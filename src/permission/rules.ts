// Project permission rules: "Yes, and don't ask again for … in this project"
// (Claude Code style). Stored in ./.lepus/agent/permissions.json.
//
// Rule forms:
//   shell:<program>        any *single, plain* command starting with <program>
//   <tool> <cacheKey>      that exact target (HTTP origin, file path, MCP args)
//
// Shell prefix rules never match chained / substituted / redirected commands,
// so an allowed `curl` can't smuggle `curl x; rm -rf ~`. Interpreters and
// command wrappers can't get a prefix rule at all (their "prefix" says
// nothing about what runs).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Request } from './permission.js';

const SHELL_TOOLS = new Set(['shell', 'BashTool']);
/** Anything that chains, substitutes, redirects or spans lines. */
const UNSAFE_SHELL = /[;&|`$<>\n\r\\]/;
/** Programs whose first word doesn't bound what they execute. */
const NO_PREFIX_RULE = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'pwsh',
  'powershell',
  'cmd',
  'python',
  'python2',
  'python3',
  'node',
  'deno',
  'bun',
  'perl',
  'ruby',
  'php',
  'lua',
  'sudo',
  'doas',
  'su',
  'env',
  'xargs',
  'eval',
  'exec',
  'nohup',
  'timeout',
  'watch',
  'time',
  'nice',
  'find',
  'awk',
  'sed',
  'ssh',
  'docker',
  'kubectl',
  'git',
  'npx',
  'npm',
]);

export function rulesPath(cwd: string): string {
  return join(cwd, '.lepus', 'agent', 'permissions.json');
}

/** The rule "always allow" would create for this request, or null if none is safe. */
export function ruleFor(req: Request): string | null {
  if (SHELL_TOOLS.has(req.tool)) {
    const cmd = (req.cacheKey ?? '').trim();
    if (!cmd || UNSAFE_SHELL.test(cmd)) return null;
    // Bare program names only: a path (./x.sh, /tmp/curl) is a different
    // binary each time, so it never gets — or matches — a prefix rule.
    const program = cmd.split(/\s+/)[0] ?? '';
    if (!/^[\w.+-]+$/.test(program) || NO_PREFIX_RULE.has(program)) return null;
    return `shell:${program}`;
  }
  return req.cacheKey ? `${req.tool} ${req.cacheKey}` : null;
}

/** Does any rule allow this request? */
export function matches(rules: readonly string[], req: Request): boolean {
  if (SHELL_TOOLS.has(req.tool)) {
    const cmd = (req.cacheKey ?? '').trim();
    if (!cmd || UNSAFE_SHELL.test(cmd)) return false;
    const program = cmd.split(/\s+/)[0] ?? '';
    return /^[\w.+-]+$/.test(program) && rules.includes(`shell:${program}`);
  }
  return !!req.cacheKey && rules.includes(`${req.tool} ${req.cacheKey}`);
}

export class ProjectRules {
  constructor(private readonly path: string) {}

  list(): string[] {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { allow?: unknown };
      return Array.isArray(raw.allow) ? raw.allow.filter((r) => typeof r === 'string') : [];
    } catch {
      return [];
    }
  }

  add(rule: string): void {
    const rules = this.list();
    if (!rules.includes(rule)) this.save([...rules, rule]);
  }

  remove(rule: string): void {
    this.save(this.list().filter((r) => r !== rule));
  }

  private save(allow: string[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ allow }, null, 2)}\n`, { mode: 0o600 });
  }
}
