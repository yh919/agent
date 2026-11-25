// Engagement authorization gate for active test traffic. Mirrors scopeGate.ts
// and privateHost.ts: same call shape, noSessionCache prompt, throws on deny.
//
// The first time a tool sends active traffic to a host that has no operator
// acknowledgment on record, the operator must confirm they are authorized to
// test it. The answer is persisted (authorization/store.ts), so each host is
// asked about once per engagement — not on every request.
//
// Why a separate gate (and not /scope): the `scope` tool needs no permission,
// so the model can add hosts to scope on its own. Authorization has to come
// from the human, so it is asked through the Prompter and recorded.
//
// Capability-preserving, like every gate: YOLO still auto-approves. Those
// approvals are recorded as `auto-approved-yolo` — never as an operator
// acknowledgment — so the audit trail stays honest and leaving YOLO re-prompts.

import { type AuthorizationStore, normalizeHost } from '../authorization/store.js';
import type { Prompter } from '../permission/permission.js';

/** Duck-typed check for the TieredPrompter's YOLO mode. */
function isYolo(p: Prompter): boolean {
  const maybe = p as Prompter & { isYolo?: () => boolean };
  return typeof maybe.isYolo === 'function' && maybe.isYolo() === true;
}

/**
 * Returns '' when no gate applies (no store, or the host is already
 * acknowledged / already auto-approved under the current YOLO session).
 * Otherwise prompts, records the decision, and returns a short note for the
 * tool output. Throws when the operator denies.
 */
export async function gateAuthorization(
  p: Prompter,
  parsed: URL,
  signal: AbortSignal,
  toolName: string,
  store: AuthorizationStore | undefined,
): Promise<string> {
  if (!store) return '';
  const host = normalizeHost(parsed.hostname);
  const existing = store.get(host);
  if (existing?.status === 'acknowledged') return '';
  const yolo = isYolo(p);
  // Already auto-approved under YOLO and still in YOLO: nothing new to ask or log.
  if (yolo && existing?.status === 'auto-approved-yolo') return '';

  const decision = await p.ask(
    {
      tool: 'authorization',
      summary: `authorization: confirm you are authorized to test ${host}`,
      detail: `host: ${host}\nfirst request: ${parsed.href}\n\nLepus is about to send active test traffic to this host for the first time in this engagement. Approve only if you have explicit permission to test it (signed scope / rules of engagement / bug bounty program scope). Your answer is recorded in .lepus/agent/authorizations.json and included in /report, and you will not be asked again for this host.`,
      noSessionCache: true,
    },
    signal,
  );
  if (decision === 'deny') {
    throw new Error(
      `not authorized to test ${host} — request blocked. Approve the authorization prompt only for hosts you have explicit permission to test.`,
    );
  }

  await store.record({
    host,
    status: yolo ? 'auto-approved-yolo' : 'acknowledged',
    at: new Date().toISOString(),
    tool: toolName,
    url: parsed.href,
  });
  return yolo
    ? `authorization for ${host} auto-approved by YOLO mode (recorded as not operator-acknowledged)`
    : `authorization to test ${host} acknowledged and recorded`;
}
