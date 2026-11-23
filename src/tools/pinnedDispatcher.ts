// Pinned undici dispatcher factory — part of the H2 (DNS-rebinding SSRF) fix.
//
// The network tools (http, web_fetch) resolve a request host exactly once in
// the private-host gate (privateHost.ts) and then build a one-shot dispatcher
// here that PINS those resolved addresses on the connection via a custom
// `lookup`. undici therefore cannot re-resolve the hostname to a different IP
// between the gate's decision and the actual connect, which is the TOCTOU the
// original gate was blind to.
//
// This preserves capability: an internal/metadata host the operator approved is
// still reached (we connect to the exact vetted IP). It only removes the silent
// swap to a never-prompted address. `rejectUnauthorized` is caller-controlled:
// the http tool keeps TLS verification off (pentest convention); web_fetch keeps
// it on.

import type { LookupAddress } from 'node:dns';
import { Agent } from 'undici';
import { pinnedLookup } from './privateHost.js';

export interface PinnedAgentOptions {
  addresses: LookupAddress[];
  rejectUnauthorized: boolean;
  timeoutMs: number;
}

/**
 * Create a per-request undici Agent that connects only to `addresses`. The
 * caller MUST `await agent.close()` when the request completes (use a
 * try/finally) so sockets are not leaked. Returns null when there is nothing to
 * pin (literal-IP host or unresolved host) — the caller then uses its shared
 * dispatcher, which is safe because a literal IP involves no DNS re-resolution.
 */
export function pinnedAgent(opts: PinnedAgentOptions): Agent | null {
  if (opts.addresses.length === 0) return null;
  return new Agent({
    connect: {
      rejectUnauthorized: opts.rejectUnauthorized,
      lookup: pinnedLookup(opts.addresses),
    },
    headersTimeout: opts.timeoutMs,
    bodyTimeout: opts.timeoutMs,
  });
}
