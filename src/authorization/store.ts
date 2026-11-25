// Engagement authorization record. Before Lepus sends active test traffic to a
// host for the first time, the operator confirms they are authorized to test it
// (see tools/authGate.ts). Each answer is persisted here, per engagement
// (project-local, like engagement.md), so:
//
//   • the operator is asked once per host per engagement — not on every request;
//   • there is a durable, human-readable record of what was acknowledged, when,
//     and how — which /report includes as evidence for the client deliverable.
//
// File: <cwd>/.lepus/agent/authorizations.json (mode 0o600, atomic writes).
//
// Two statuses are recorded:
//   acknowledged         — the operator explicitly confirmed authorization.
//   auto-approved-yolo   — YOLO mode auto-approved the prompt; the request went
//                          through (capability-preserving), but this is NOT an
//                          operator acknowledgment. Leaving YOLO re-prompts.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicWriteFile } from '../persist/atomicFile.js';

export type AuthorizationStatus = 'acknowledged' | 'auto-approved-yolo';

export interface AuthorizationEntry {
  /** Normalized hostname (lowercase, no brackets / trailing dot). */
  host: string;
  status: AuthorizationStatus;
  /** ISO timestamp of the decision. */
  at: string;
  /** Tool whose request triggered the prompt (e.g. "http"). */
  tool: string;
  /** The first request URL that triggered the prompt, for context. */
  url: string;
}

interface FileShape {
  version: 1;
  entries: AuthorizationEntry[];
}

/** Normalize a hostname so `App.Example.com.` and `app.example.com` match. */
export function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export interface AuthorizationStoreOptions {
  cwd?: string;
}

export class AuthorizationStore {
  readonly path: string;
  // Serializes writes so two concurrent first-requests can't lose an entry.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: AuthorizationStoreOptions = {}) {
    this.path = join(resolve(opts.cwd ?? process.cwd()), '.lepus', 'agent', 'authorizations.json');
  }

  /** All recorded entries, oldest first. A missing or corrupt file reads as empty. */
  list(): AuthorizationEntry[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>;
      if (!Array.isArray(parsed.entries)) return [];
      return parsed.entries
        .filter(
          (e): e is AuthorizationEntry =>
            !!e &&
            typeof e.host === 'string' &&
            (e.status === 'acknowledged' || e.status === 'auto-approved-yolo') &&
            typeof e.at === 'string',
        )
        .sort((a, b) => a.at.localeCompare(b.at));
    } catch {
      return [];
    }
  }

  get(host: string): AuthorizationEntry | undefined {
    const h = normalizeHost(host);
    return this.list().find((e) => e.host === h);
  }

  /** True only when the operator explicitly acknowledged this host. */
  isAcknowledged(host: string): boolean {
    return this.get(host)?.status === 'acknowledged';
  }

  /**
   * Upsert the entry for `entry.host`. An operator acknowledgment always
   * replaces a YOLO auto-approval; a YOLO auto-approval never downgrades an
   * existing acknowledgment.
   */
  async record(entry: AuthorizationEntry): Promise<void> {
    const run = this.queue.then(() => this.recordLocked(entry));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async recordLocked(entry: AuthorizationEntry): Promise<void> {
    const normalized: AuthorizationEntry = { ...entry, host: normalizeHost(entry.host) };
    const entries = this.list();
    const idx = entries.findIndex((e) => e.host === normalized.host);
    if (idx >= 0) {
      const existing = entries[idx] as AuthorizationEntry;
      if (existing.status === 'acknowledged' && normalized.status !== 'acknowledged') return;
      if (existing.status === normalized.status) return; // nothing new to record
      entries[idx] = normalized;
    } else {
      entries.push(normalized);
    }
    const out: FileShape = { version: 1, entries };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    await atomicWriteFile(this.path, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  }
}
