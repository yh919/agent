import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { pinnedLookup, privateHostReason, resolvePrivateHost } from './privateHost.js';

describe('privateHostReason', () => {
  it('flags compressed loopback and unspecified IPv6', async () => {
    expect(await privateHostReason('::1')).toBe('loopback IPv6');
    expect(await privateHostReason('::')).toBe('unspecified IPv6');
  });

  it('flags fully expanded loopback (was a silent gate bypass)', async () => {
    expect(await privateHostReason('0:0:0:0:0:0:0:1')).toBe('loopback IPv6');
    expect(await privateHostReason('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(
      'loopback IPv6',
    );
  });

  it('flags expanded IPv4-mapped private addresses', async () => {
    expect(await privateHostReason('0:0:0:0:0:ffff:127.0.0.1')).toMatch(/loopback/i);
    expect(await privateHostReason('0:0:0:0:0:ffff:a9fe:a9fe')).toMatch(/link-local|metadata/i);
    expect(await privateHostReason('::ffff:127.0.0.1')).toMatch(/loopback/i);
    expect(await privateHostReason('::ffff:a9fe:a9fe')).toMatch(/link-local|metadata/i);
  });

  it('flags expanded unique-local and link-local', async () => {
    expect(await privateHostReason('fc00:0:0:0:0:0:0:1')).toBe('unique-local IPv6');
    expect(await privateHostReason('fe80:0:0:0:0:0:0:1')).toBe('link-local IPv6');
  });

  it('does not flag public IPv6', async () => {
    expect(await privateHostReason('2001:4860:4860::8888')).toBe('');
    expect(await privateHostReason('2606:4700:4700::1111')).toBe('');
  });

  it('still flags classic private IPv4', async () => {
    expect(await privateHostReason('127.0.0.1')).toBe('loopback IPv4');
    expect(await privateHostReason('169.254.169.254')).toMatch(/metadata|link-local/i);
    expect(await privateHostReason('10.0.0.1')).toMatch(/RFC1918/i);
  });
});

describe('resolvePrivateHost (H2 one-shot resolve + pin)', () => {
  it('classifies a literal private IP with nothing to pin', async () => {
    const r = await resolvePrivateHost('127.0.0.1');
    expect(r.reason).toBe('loopback IPv4');
    expect(r.addresses).toEqual([]);
  });

  it('treats localhost as local with nothing to pin', async () => {
    const r = await resolvePrivateHost('localhost');
    expect(r.reason).toBe('localhost name');
    expect(r.addresses).toEqual([]);
  });

  it('returns no reason and nothing to pin for a non-resolving name', async () => {
    // .invalid is reserved to never resolve (RFC 2606).
    const r = await resolvePrivateHost('nope.invalid');
    expect(r.reason).toBe('');
    expect(r.addresses).toEqual([]);
  });
});

describe('pinnedLookup', () => {
  const addrs: LookupAddress[] = [
    { address: '203.0.113.7', family: 4 },
    { address: '203.0.113.8', family: 4 },
  ];

  it('returns the full pinned set for an { all: true } lookup, ignoring the hostname', () => {
    const lookup = pinnedLookup(addrs);
    let got: unknown;
    lookup('whatever-the-attacker-rebinds-to.example', { all: true }, (err, address) => {
      expect(err).toBeNull();
      got = address;
    });
    expect(got).toEqual(addrs);
  });

  it('returns the first address and family for a non-all lookup', () => {
    const lookup = pinnedLookup(addrs);
    let gotAddr: unknown;
    let gotFamily: unknown;
    lookup('host', {}, (err, address, family) => {
      expect(err).toBeNull();
      gotAddr = address;
      gotFamily = family;
    });
    expect(gotAddr).toBe('203.0.113.7');
    expect(gotFamily).toBe(4);
  });

  it('errors when there is nothing vetted to connect to', () => {
    const lookup = pinnedLookup([]);
    let gotErr: NodeJS.ErrnoException | null = null;
    lookup('host', { all: true }, (err) => {
      gotErr = err;
    });
    expect(gotErr).not.toBeNull();
    expect((gotErr as unknown as NodeJS.ErrnoException)?.code).toBe('ENOTFOUND');
  });
});
