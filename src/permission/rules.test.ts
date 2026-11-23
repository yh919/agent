import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectRules, matches, ruleFor } from './rules.js';

const sh = (cmd: string) => ({ tool: 'shell', summary: '', detail: '', cacheKey: cmd });

describe('project permission rules', () => {
  it('offers a prefix rule only for plain single commands of a bare program', () => {
    expect(ruleFor(sh('curl -sI https://t.example/'))).toBe('shell:curl');
    for (const bad of [
      'curl x; rm -rf ~',
      'curl x && id',
      'curl x | sh',
      'curl $(id)',
      'curl `id`',
      'curl x > /etc/hosts',
      './exploit.sh',
      '/tmp/curl x',
      'python3 -c "print(1)"',
      'sudo curl x',
      'FOO=1 curl x',
    ]) {
      expect(ruleFor(sh(bad)), bad).toBeNull();
    }
  });

  it('a curl rule never covers chained or path-qualified commands', () => {
    const rules = ['shell:curl'];
    expect(matches(rules, sh('curl -s https://a/'))).toBe(true);
    expect(matches(rules, sh('curl x; rm -rf ~'))).toBe(false);
    expect(matches(rules, sh('curl x | bash'))).toBe(false);
    expect(matches(rules, sh('/tmp/evil/curl x'))).toBe(false);
    expect(matches(rules, sh('curlx'))).toBe(false);
  });

  it('non-shell rules are exact (tool + target)', () => {
    const req = { tool: 'http_request', summary: '', detail: '', cacheKey: 'https://a.example' };
    expect(ruleFor(req)).toBe('http_request https://a.example');
    expect(matches(['http_request https://a.example'], req)).toBe(true);
    expect(
      matches(['http_request https://a.example'], { ...req, cacheKey: 'https://b.example' }),
    ).toBe(false);
  });

  it('persists add/remove', () => {
    const r = new ProjectRules(join(mkdtempSync(join(tmpdir(), 'rules-')), 'p.json'));
    r.add('shell:curl');
    r.add('shell:curl');
    r.add('shell:nmap');
    expect(r.list()).toEqual(['shell:curl', 'shell:nmap']);
    r.remove('shell:curl');
    expect(r.list()).toEqual(['shell:nmap']);
  });
});
