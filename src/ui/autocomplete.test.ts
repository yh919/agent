import { describe, expect, it } from 'vitest';
import { computeAutocomplete } from './autocomplete.js';

describe('computeAutocomplete', () => {
  it('returns null when cursor is not at the end of input', () => {
    const res = computeAutocomplete('/mode', 2);
    expect(res).toBeNull();
  });

  it('returns null when input is empty', () => {
    const res = computeAutocomplete('', 0);
    expect(res).toBeNull();
  });

  it('completes slash commands', () => {
    const res = computeAutocomplete('/rep', 4);
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('/report ');
    expect(res?.ghostText).toBe('ort ');
  });

  it('suggests trailing space when exact command requires args', () => {
    const res = computeAutocomplete('/report', 7);
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('/report ');
    expect(res?.ghostText).toBe(' ');
  });

  it('completes slash command arguments', () => {
    const res = computeAutocomplete('/mode aut', 9);
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('/mode auto-safe');
    expect(res?.ghostText).toBe('o-safe');
  });

  it('suggests default first argument for /report', () => {
    const res = computeAutocomplete('/report ', 8);
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('/report html');
    expect(res?.ghostText).toBe('html');
  });

  it('completes session rename arguments', () => {
    const res = computeAutocomplete('/session rename st', 18, {
      sessionNames: ['staging-test-1', 'prod-audit'],
    });
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('/session rename staging-test-1');
    expect(res?.ghostText).toBe('aging-test-1');
  });

  it('completes prompt from history (most recent match)', () => {
    const res = computeAutocomplete('test tar', 8, {
      history: ['test target for sqli', 'test target for xss and csrf'],
    });
    expect(res).not.toBeNull();
    expect(res?.fullValue).toBe('test target for xss and csrf');
    expect(res?.ghostText).toBe('get for xss and csrf');
  });

  it('falls back to security prompt templates', () => {
    const res = computeAutocomplete('check for file', 14);
    expect(res).not.toBeNull();
    expect(res?.fullValue).toContain('check for file upload bypasses (Upload2Shell)');
  });
});

