import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlwaysDeny } from '../permission/permission.js';
import type { Prompter } from '../permission/permission.js';
import { WebFetchTool, WebSearchTool, clearWebCache } from './web.js';

// web_fetch now routes through undici with a pinned dispatcher (H2 fix), so we
// mock undici's fetch rather than the global one. web_search still uses the
// global fetch, so its tests stub that below.
const undiciFetchMock = vi.hoisted(() => vi.fn());
vi.mock('undici', () => ({
  Agent: class Agent {
    async close(): Promise<void> {}
  },
  fetch: undiciFetchMock,
}));

// Keep DNS resolution deterministic and offline: any name resolves to a public
// IP so the private-host gate does not prompt for ordinary public fetches, and
// the resolved address is what web_fetch pins on the connection.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const prompter = {} as Prompter;

afterEach(() => {
  vi.unstubAllGlobals();
  undiciFetchMock.mockReset();
  // Clear cross-test cache state so each case exercises the cold network path.
  clearWebCache();
});

describe('WebFetchTool', () => {
  it('returns readable text for successful fetches', async () => {
    undiciFetchMock.mockResolvedValue(
      new Response('<html><body><h1>Hello</h1><script>x()</script></body></html>'),
    );

    const out = await new WebFetchTool().run(
      { url: 'https://example.com' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('URL: https://example.com');
    expect(out).toContain('Status: 200');
    expect(out).toContain('Hello');
    expect(out).not.toContain('<h1>');
    expect(out).not.toContain('x()');
  });

  it('explains HackerOne platform DNS failures with a public program URL hint', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND platform.hackerone.com'), {
      code: 'ENOTFOUND',
      hostname: 'platform.hackerone.com',
    });
    undiciFetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed', { cause });
    });

    const out = await new WebFetchTool().run(
      { url: 'https://platform.hackerone.com/hackerone/policy_scopes' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('ERROR: fetch failed');
    expect(out).toContain('Code: ENOTFOUND');
    expect(out).toContain('platform.hackerone.com is not a public HackerOne program host');
    expect(out).toContain('https://hackerone.com/hackerone');
  });

  it('rethrows when the caller aborts the request', async () => {
    const ctl = new AbortController();
    ctl.abort();
    undiciFetchMock.mockImplementation(async () => {
      throw new Error('aborted');
    });

    await expect(
      new WebFetchTool().run({ url: 'https://example.com' }, ctl.signal, prompter),
    ).rejects.toThrow('aborted');
  });

  it('prompts before fetching private or local URLs', async () => {
    await expect(
      new WebFetchTool().run(
        { url: 'http://127.0.0.1:3000/status' },
        new AbortController().signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/private\/internal URL denied/);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('does not automatically follow redirects', async () => {
    undiciFetchMock.mockResolvedValue(
      new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    );

    await new WebFetchTool().run(
      { url: 'https://example.com/redirect' },
      new AbortController().signal,
      prompter,
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://example.com/redirect',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('pins the gate-resolved address on the connection (H2)', async () => {
    undiciFetchMock.mockResolvedValue(new Response('<p>ok</p>'));

    await new WebFetchTool().run(
      { url: 'https://example.com/path' },
      new AbortController().signal,
      prompter,
    );

    // A public host still resolves to an address, so the fetch is pinned via a
    // per-request dispatcher rather than left to re-resolve.
    const call = undiciFetchMock.mock.calls[0];
    expect(call?.[1]).toHaveProperty('dispatcher');
  });

  it('prompts before fetching IPv4-mapped IPv6 private URLs', async () => {
    await expect(
      new WebFetchTool().run(
        { url: 'http://[::ffff:169.254.169.254]/latest/meta-data/' },
        new AbortController().signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/private\/internal URL denied/);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-HTTP URL schemes', async () => {
    await expect(
      new WebFetchTool().run({ url: 'file:///etc/passwd' }, new AbortController().signal, prompter),
    ).rejects.toThrow(/unsupported URL scheme/);
  });

  it('serves a second fetch of the same URL from cache without re-hitting the network', async () => {
    undiciFetchMock.mockResolvedValue(new Response('<p>cached body</p>'));

    const first = await new WebFetchTool().run(
      { url: 'https://example.com/advisory' },
      new AbortController().signal,
      prompter,
    );
    const second = await new WebFetchTool().run(
      { url: 'https://example.com/advisory' },
      new AbortController().signal,
      prompter,
    );

    expect(second).toBe(first);
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed fetches', async () => {
    undiciFetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    await new WebFetchTool().run(
      { url: 'https://example.com/down' },
      new AbortController().signal,
      prompter,
    );
    await new WebFetchTool().run(
      { url: 'https://example.com/down' },
      new AbortController().signal,
      prompter,
    );
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('WebSearchTool', () => {
  it('parses structured DuckDuckGo results', async () => {
    const html = `
      <a class="result__a" href="https://cve.example/CVE-1">Title One</a>
      <a class="result__snippet">Snippet one</a>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html)),
    );

    const out = await new WebSearchTool().run(
      { query: 'CVE-1' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('Title One');
    expect(out).toContain('https://cve.example/CVE-1');
    expect(out).toContain('Snippet one');
  });

  it('falls back to raw anchor extraction when the structured markup changes', async () => {
    // No result__a / result__snippet classes, but real links are present.
    const html = `
      <div><a href="/internal">nav</a></div>
      <a href="https://example.org/post">Interesting Post</a>
      <a href="https://example.org/other">Another Result</a>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html)),
    );

    const out = await new WebSearchTool().run(
      { query: 'anything' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('degraded results');
    expect(out).toContain('https://example.org/post');
    expect(out).toContain('Interesting Post');
    // Relative nav anchors are dropped.
    expect(out).not.toContain('/internal');
  });

  it('returns a structured failure instead of throwing when the search fetch fails', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND html.duckduckgo.com'), {
      code: 'ENOTFOUND',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );

    const out = await new WebSearchTool().run(
      { query: 'whatever' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('ERROR: fetch failed');
    expect(out).toContain('Code: ENOTFOUND');
  });
});
