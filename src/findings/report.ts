// Aggregate findings report generation. Pure rendering functions (no I/O)
// so /report can turn everything Store.list() returns into either a
// human-readable Markdown writeup (grouped by severity, full repro detail)
// or a SARIF 2.1.0 log for ingestion into CI/security dashboards.

import { render as renderFinding } from './store.js';
import type { Finding, Severity } from './store.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const map = new Map<Severity, Finding[]>();
  for (const sev of SEVERITY_ORDER) map.set(sev, []);
  for (const f of findings) map.get(f.severity)?.push(f);
  return map;
}

export function renderMarkdownReport(findings: Finding[]): string {
  const lines: string[] = [];
  lines.push('# Findings Report', '');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total findings: ${findings.length}`, '');

  if (findings.length === 0) {
    lines.push('No findings recorded yet.');
    return lines.join('\n');
  }

  const grouped = groupBySeverity(findings);
  lines.push(
    `Severity breakdown: ${SEVERITY_ORDER.map((s) => `${s}: ${grouped.get(s)?.length ?? 0}`).join(' · ')}`,
    '',
  );

  for (const sev of SEVERITY_ORDER) {
    const group = grouped.get(sev) ?? [];
    if (group.length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${group.length})`, '', '---', '');
    for (const f of group) {
      // Demote the per-finding heading a level so it nests under its
      // severity section instead of competing with the report title.
      lines.push(renderFinding(f).replace(/^# /, '### '), '');
    }
  }
  return lines.join('\n');
}

// ---------- HTML (client-ready, self-contained, print-to-PDF) ----------

/** Minimal HTML-escape for text interpolated into the report. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Indicative CVSS v3.1 band per severity, shown as context (not a computed vector). */
const SEVERITY_CVSS: Record<Severity, string> = {
  critical: '9.0–10.0',
  high: '7.0–8.9',
  medium: '4.0–6.9',
  low: '0.1–3.9',
  info: 'N/A',
};

function anchorId(slug: string, i: number): string {
  const base = (slug || 'finding').replace(/[^a-z0-9-]/gi, '-');
  return `f-${i}-${base}`;
}

function renderFindingHtml(f: Finding, i: number): string {
  const id = anchorId(f.slug, i);
  const rows: string[] = [
    `<tr><th>Severity</th><td><span class="badge sev-${f.severity}">${f.severity.toUpperCase()}</span> <span class="muted">CVSS ${SEVERITY_CVSS[f.severity]}</span></td></tr>`,
    `<tr><th>URL</th><td><code>${esc(f.url)}</code></td></tr>`,
  ];
  if (f.method) rows.push(`<tr><th>Method</th><td><code>${esc(f.method)}</code></td></tr>`);
  if (f.parameter)
    rows.push(`<tr><th>Parameter</th><td><code>${esc(f.parameter)}</code></td></tr>`);
  rows.push(`<tr><th>Reported</th><td>${esc(f.createdAt)}</td></tr>`);

  const blocks: string[] = [
    `<section class="finding" id="${id}">`,
    `<h3><span class="badge sev-${f.severity}">${f.severity.toUpperCase()}</span> ${esc(f.title)}</h3>`,
    `<table class="meta">${rows.join('')}</table>`,
    `<h4>Impact</h4><p>${esc(f.impact).replace(/\n/g, '<br>')}</p>`,
  ];
  if (f.payload) blocks.push(`<h4>Payload</h4><pre>${esc(f.payload)}</pre>`);
  if (f.responseExcerpt)
    blocks.push(`<h4>Response excerpt</h4><pre>${esc(f.responseExcerpt)}</pre>`);
  if (f.curl) blocks.push(`<h4>Reproduce</h4><pre>${esc(f.curl)}</pre>`);
  if (f.remediation)
    blocks.push(`<h4>Remediation</h4><p>${esc(f.remediation).replace(/\n/g, '<br>')}</p>`);
  blocks.push('</section>');
  return blocks.join('\n');
}

const REPORT_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:0}
.wrap{max-width:860px;margin:0 auto;padding:48px 32px}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid #eee}
h3{font-size:17px;margin:0 0 12px}
h4{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:18px 0 6px}
.muted{color:#888;font-size:13px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f4f4f5;padding:1px 5px;border-radius:4px;word-break:break-all}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f7f7f8;border:1px solid #ececef;border-radius:8px;padding:12px 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;color:#fff;padding:2px 8px;border-radius:999px;vertical-align:middle}
.sev-critical{background:#7f1d1d}.sev-high{background:#dc2626}.sev-medium{background:#d97706}.sev-low{background:#2563eb}.sev-info{background:#6b7280}
table.summary{border-collapse:collapse;width:100%;margin:12px 0}
table.summary th,table.summary td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;font-size:14px}
table.meta{border-collapse:collapse;margin:4px 0 8px}
table.meta th{text-align:left;color:#666;font-weight:600;padding:3px 14px 3px 0;vertical-align:top;white-space:nowrap}
table.meta td{padding:3px 0;vertical-align:top}
.finding{padding:20px 0;border-top:1px solid #eee}
ol.toc{padding-left:20px}ol.toc li{margin:3px 0}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
.foot{margin-top:48px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:12px}
@media print{.wrap{max-width:none;padding:0}.finding{break-inside:avoid}h2{break-after:avoid}pre{white-space:pre-wrap}a{color:#1a1a1a}}
`;

export function renderHtmlReport(findings: Finding[], opts: { target?: string } = {}): string {
  const grouped = groupBySeverity(findings);
  const generated = new Date().toISOString();
  const summaryRows = SEVERITY_ORDER.map(
    (s) =>
      `<tr><td><span class="badge sev-${s}">${s.toUpperCase()}</span></td><td>${grouped.get(s)?.length ?? 0}</td><td class="muted">CVSS ${SEVERITY_CVSS[s]}</td></tr>`,
  ).join('');

  const toc = findings
    .map((f, i) => `<li><a href="#${anchorId(f.slug, i)}">${esc(f.title)}</a></li>`)
    .join('');

  const body: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const group = grouped.get(sev) ?? [];
    if (group.length === 0) continue;
    body.push(`<h2>${sev.toUpperCase()} (${group.length})</h2>`);
    for (const f of group) {
      // Preserve a stable global index for anchor ids.
      body.push(renderFindingHtml(f, findings.indexOf(f)));
    }
  }

  const targetLine = opts.target ? `<p class="muted">Target: ${esc(opts.target)}</p>` : '';
  const empty = findings.length === 0 ? '<p>No findings recorded yet.</p>' : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Security Findings Report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<h1>Security Findings Report</h1>
${targetLine}
<p class="muted">Generated ${esc(generated)} · ${findings.length} finding${findings.length === 1 ? '' : 's'} · Prepared with Lepus</p>

<h2>Executive summary</h2>
<table class="summary">
<thead><tr><th>Severity</th><th>Count</th><th>Indicative CVSS</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table>
${empty}
${
  findings.length > 0
    ? `<h2>Contents</h2>
<ol class="toc">${toc}</ol>
${body.join('\n')}`
    : ''
}
<p class="foot">Confidential — for the authorized recipient only. Each finding was recorded after reproduction with request/response evidence.</p>
</div>
</body>
</html>
`;
}

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

function ruleId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 64);
  return slug || 'finding';
}

export function renderSarifReport(findings: Finding[]): string {
  const rules = new Map<string, { title: string; severity: Severity }>();
  for (const f of findings) {
    const id = ruleId(f.title);
    if (!rules.has(id)) rules.set(id, { title: f.title, severity: f.severity });
  }

  const sarif = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'lepus',
            rules: [...rules.entries()].map(([id, r]) => ({
              id,
              name: r.title,
              shortDescription: { text: r.title },
              defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
            })),
          },
        },
        results: findings.map((f) => ({
          ruleId: ruleId(f.title),
          level: SARIF_LEVEL[f.severity],
          message: { text: f.impact },
          locations: [{ physicalLocation: { artifactLocation: { uri: f.url } } }],
          properties: {
            severity: f.severity,
            method: f.method,
            parameter: f.parameter,
            reportedAt: f.createdAt,
          },
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
