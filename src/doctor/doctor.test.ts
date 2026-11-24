import { describe, expect, it } from 'vitest';
import {
  type Check,
  checkApiKey,
  checkBackend,
  checkConfig,
  checkDataDir,
  checkExternalTools,
  checkNodeVersion,
  checkProvider,
  formatReport,
  summarize,
} from './doctor.js';

describe('checkNodeVersion', () => {
  it('passes on a supported major', () => {
    expect(checkNodeVersion('v20.11.0').status).toBe('ok');
    expect(checkNodeVersion('v22.0.0').status).toBe('ok');
  });
  it('fails below the minimum', () => {
    const c = checkNodeVersion('v18.19.0');
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/install Node/);
  });
  it('warns on an unparseable version', () => {
    expect(checkNodeVersion('weird').status).toBe('warn');
  });
});

describe('checkConfig', () => {
  it('reports a clean load', () => {
    expect(checkConfig({ loaded: true, path: '/x/config.json' }).status).toBe('ok');
  });
  it('warns when the file was invalid', () => {
    const c = checkConfig({ loaded: true, path: '/x/config.json', error: 'bad json' });
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/invalid/);
  });
});

describe('checkBackend', () => {
  it('is ok with a model set', () => {
    expect(
      checkBackend({ backend: 'ollama', model: 'qwen3:14b', isCliBackend: false }).status,
    ).toBe('ok');
  });
  it('warns on a non-CLI backend with no model', () => {
    expect(checkBackend({ backend: 'openai', model: '', isCliBackend: false }).status).toBe('warn');
  });
  it('is ok for a CLI backend with no model (uses its default)', () => {
    expect(checkBackend({ backend: 'claude-code', model: '', isCliBackend: true }).status).toBe(
      'ok',
    );
  });
});

describe('checkApiKey', () => {
  const noEnv: Record<string, string | undefined> = {};
  it('needs no key for local backends', () => {
    expect(
      checkApiKey({ backend: 'ollama', isCliBackend: false, hasConfiguredKey: false, env: noEnv })
        .status,
    ).toBe('ok');
  });
  it('needs no key for CLI backends', () => {
    expect(
      checkApiKey({ backend: 'codex', isCliBackend: true, hasConfiguredKey: false, env: noEnv })
        .status,
    ).toBe('ok');
  });
  it('fails a hosted backend with no key anywhere', () => {
    const c = checkApiKey({
      backend: 'anthropic',
      isCliBackend: false,
      hasConfiguredKey: false,
      env: noEnv,
    });
    expect(c.status).toBe('fail');
    expect(c.fix).toMatch(/ANTHROPIC_API_KEY/);
  });
  it('accepts a hosted backend key found only in the environment', () => {
    const c = checkApiKey({
      backend: 'groq',
      isCliBackend: false,
      hasConfiguredKey: false,
      env: { GROQ_API_KEY: 'sk-xxx' },
    });
    expect(c.status).toBe('ok');
    expect(c.detail).toMatch(/\$GROQ_API_KEY/);
  });
  it('warns (not fails) for an unknown/open openai-compat endpoint', () => {
    expect(
      checkApiKey({
        backend: 'openai-compat',
        isCliBackend: false,
        hasConfiguredKey: false,
        env: noEnv,
      }).status,
    ).toBe('warn');
  });
});

describe('checkProvider', () => {
  it('fails when unreachable', () => {
    expect(checkProvider({ reached: false, toolSupport: 'unknown' }).status).toBe('fail');
  });
  it('warns when reachable but no tool call', () => {
    expect(checkProvider({ reached: true, toolSupport: 'no' }).status).toBe('warn');
  });
  it('is ok when tool calling works', () => {
    expect(checkProvider({ reached: true, toolSupport: 'yes' }).status).toBe('ok');
  });
});

describe('checkExternalTools', () => {
  it('fails on a missing required tool (curl) and warns on missing optional', () => {
    const checks = checkExternalTools({ curl: false, nmap: false });
    const curl = checks.find((c) => c.name === 'tool:curl');
    const nmap = checks.find((c) => c.name === 'tool:nmap');
    expect(curl?.status).toBe('fail');
    expect(nmap?.status).toBe('warn');
  });
  it('is ok when a tool is present', () => {
    const checks = checkExternalTools({ curl: true });
    expect(checks.find((c) => c.name === 'tool:curl')?.status).toBe('ok');
  });
});

describe('checkDataDir', () => {
  it('fails when not writable', () => {
    expect(checkDataDir({ writable: false, path: '/x' }).status).toBe('fail');
  });
});

describe('summarize + formatReport', () => {
  const ok: Check = { name: 'a', status: 'ok', detail: 'fine' };
  const warn: Check = { name: 'b', status: 'warn', detail: 'hmm', fix: 'do x' };
  const fail: Check = { name: 'c', status: 'fail', detail: 'nope', fix: 'do y' };

  it('exit code 0 when only ok/warn, 1 on any fail', () => {
    expect(summarize([ok, warn]).exitCode).toBe(0);
    expect(summarize([ok, warn]).worst).toBe('warn');
    expect(summarize([ok, warn, fail]).exitCode).toBe(1);
    expect(summarize([ok, warn, fail]).worst).toBe('fail');
  });

  it('renders fixes only for non-ok checks and a result line', () => {
    const out = formatReport([ok, warn, fail]);
    expect(out).toContain('↳ do x');
    expect(out).toContain('↳ do y');
    expect(out).toContain('result: FAIL');
    // ok checks carry no fix line
    expect(out).not.toContain('fine\n      ↳');
  });

  it('reports a clean OK result when everything passes', () => {
    expect(formatReport([ok])).toContain('result: OK — ready to run.');
  });
});
