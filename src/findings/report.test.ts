import { describe, expect, it } from 'vitest';
import { renderHtmlReport, renderMarkdownReport, renderSarifReport } from './report.js';
import type { Finding } from './store.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    title: 'Reflected XSS in search',
    severity: 'high',
    url: 'https://example.com/search?q=x',
    parameter: 'q',
    impact: 'Attacker can execute arbitrary JS in a victim session.',
    createdAt: '2026-01-01T00:00:00.000Z',
    slug: 'reflected-xss-in-search',
    ...overrides,
  };
}

describe('renderMarkdownReport', () => {
  it('reports zero findings without throwing', () => {
    const out = renderMarkdownReport([]);
    expect(out).toContain('Total findings: 0');
    expect(out).toContain('No findings recorded yet.');
  });

  it('groups findings by severity section and includes full repro detail', () => {
    const out = renderMarkdownReport([
      finding({ severity: 'critical', title: 'SQLi in login' }),
      finding({ severity: 'high', curl: 'curl https://example.com' }),
    ]);
    expect(out).toContain('## CRITICAL (1)');
    expect(out).toContain('## HIGH (1)');
    expect(out).toContain('### SQLi in login');
    expect(out).toContain('### Reflected XSS in search');
    expect(out).toContain('curl https://example.com');
    // Critical section must appear before high in the output.
    expect(out.indexOf('CRITICAL')).toBeLessThan(out.indexOf('## HIGH'));
  });
});

describe('renderSarifReport', () => {
  it('produces valid SARIF 2.1.0 JSON with one result per finding', () => {
    const parsed = JSON.parse(
      renderSarifReport([finding(), finding({ severity: 'low', title: 'Verbose error' })]),
    );
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0].results).toHaveLength(2);
    expect(parsed.runs[0].results[0].level).toBe('error');
    expect(parsed.runs[0].results[1].level).toBe('note');
    expect(parsed.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'https://example.com/search?q=x',
    );
  });

  it('deduplicates rules by title so repeated finding types share one rule id', () => {
    const parsed = JSON.parse(
      renderSarifReport([finding(), finding({ url: 'https://example.com/other' })]),
    );
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(1);
    expect(parsed.runs[0].results).toHaveLength(2);
  });
});

describe('renderHtmlReport', () => {
  it('produces a self-contained HTML document with an executive summary', () => {
    const out = renderHtmlReport([finding()]);
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<style>'); // CSS is inlined, no external assets
    expect(out).not.toMatch(/<link[^>]+href=|<script[^>]+src=/); // nothing fetched
    expect(out).toContain('Executive summary');
    expect(out).toContain('Security Findings Report');
    expect(out).toContain('Reflected XSS in search');
  });

  it('renders an empty report without throwing', () => {
    const out = renderHtmlReport([]);
    expect(out).toContain('No findings recorded yet.');
    expect(out).toContain('0 findings');
  });

  it('escapes HTML in finding fields to prevent markup injection in the report', () => {
    const out = renderHtmlReport([
      finding({ title: '<img src=x onerror=alert(1)>', impact: 'a & b < c' }),
    ]);
    expect(out).not.toContain('<img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('a &amp; b &lt; c');
  });

  it('includes a reproduce block and remediation when present', () => {
    const out = renderHtmlReport([
      finding({ curl: 'curl https://example.com -H "X: 1"', remediation: 'Encode output.' }),
    ]);
    expect(out).toContain('Reproduce');
    expect(out).toContain('curl https://example.com');
    expect(out).toContain('Remediation');
    expect(out).toContain('Encode output.');
  });

  it('shows a target line when provided', () => {
    const out = renderHtmlReport([finding()], { target: 'https://app.example.com' });
    expect(out).toContain('Target: https://app.example.com');
  });
});

describe('authorization record in reports', () => {
  const auths = [
    {
      host: 'app.example.com',
      status: 'acknowledged' as const,
      at: '2026-11-25T10:00:00.000Z',
      tool: 'http',
      url: 'https://app.example.com/api',
    },
    {
      host: 'lab.example.com',
      status: 'auto-approved-yolo' as const,
      at: '2026-11-25T11:00:00.000Z',
      tool: 'http',
      url: 'https://lab.example.com/<x>',
    },
  ];

  it('renders a Markdown table, even with no findings yet', () => {
    const out = renderMarkdownReport([], { authorizations: auths });
    expect(out).toContain('## Authorization record');
    expect(out).toContain('| app.example.com | Acknowledged by operator |');
    expect(out).toContain('NOT operator-acknowledged');
  });

  it('renders an escaped HTML table', () => {
    const out = renderHtmlReport([finding()], { authorizations: auths });
    expect(out).toContain('<h2>Authorization record</h2>');
    expect(out).toContain('Acknowledged by operator');
    expect(out).toContain('https://lab.example.com/&lt;x&gt;');
    expect(out).not.toContain('https://lab.example.com/<x>');
  });

  it('omits the section when there is no record', () => {
    expect(renderMarkdownReport([finding()])).not.toContain('Authorization record');
    expect(renderHtmlReport([finding()])).not.toContain('Authorization record');
  });
});
