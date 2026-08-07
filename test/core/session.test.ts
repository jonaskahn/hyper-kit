import { describe, it, expect } from 'vitest';

import { briefCwd, normalizePath, parseOsc7 } from '../../src/core/session';

describe('briefCwd', () => {
  it('handles empty input', () => {
    expect(briefCwd('', '/Users/test')).toBe('');
    expect(briefCwd(null, '/Users/test')).toBe('');
  });

  it('shortens paths under home to ~', () => {
    expect(briefCwd('/Users/test/proj', '/Users/test')).toBe('~/proj');
    expect(briefCwd('/etc', '/Users/test')).toBe('/etc');
  });

  it('collapses long paths to the last three segments', () => {
    const long = '/very/long/path/that/exceeds/twentysix/chars/here';
    expect(briefCwd(long, '/Users/test')).toBe('…/twentysix/chars/here');
  });

  it('shortens Windows paths under USERPROFILE', () => {
    expect(briefCwd('C:\\Users\\test\\proj', 'C:\\Users\\test')).toBe('~/proj');
  });

  it('normalizes backslashes on Windows paths', () => {
    const long = 'C:\\Users\\test\\very\\deep\\project\\tree\\here';
    expect(briefCwd(long, 'C:\\Users\\test')).toBe('~/project/tree/here');
  });

  it('keeps non-home absolute paths intact', () => {
    expect(briefCwd('C:\\Windows\\System32', '')).toBe('C:/Windows/System32');
  });

  it('collapses forward-slashed Windows paths under a backslashed home', () => {
    expect(briefCwd('C:/Users/test/proj', 'C:\\Users\\test')).toBe('~/proj');
  });

  it('matches Windows homes case-insensitively', () => {
    expect(briefCwd('c:/users/test/proj', 'C:\\Users\\Test')).toBe('~/proj');
  });

  it('collapses MSYS (Git Bash) paths to ~', () => {
    expect(briefCwd('/c/Users/test/proj', 'C:\\Users\\test')).toBe('~/proj');
  });

  it('keeps POSIX matching case-sensitive', () => {
    expect(briefCwd('/users/test/proj', '/Users/test')).toBe('/users/test/proj');
  });
});

describe('normalizePath', () => {
  it('leaves POSIX paths unchanged', () => {
    expect(normalizePath('/Users/test/proj')).toBe('/Users/test/proj');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\test\\proj')).toBe('C:/Users/test/proj');
  });

  it('uppercases the Windows drive letter', () => {
    expect(normalizePath('c:/users/test')).toBe('C:/users/test');
  });

  it('converts MSYS drive paths', () => {
    expect(normalizePath('/c/Users/test')).toBe('C:/Users/test');
  });
});

describe('parseOsc7', () => {
  it('parses OSC 7 cwd terminated by BEL', () => {
    expect(parseOsc7('abc\x1b]7;file:///Users/test/a%20b\x07xyz')).toBe('/Users/test/a b');
  });

  it('parses OSC 7 terminated by ST', () => {
    expect(parseOsc7('\x1b]7;file://host/path\x1b\\')).toBe('/path');
  });

  it('returns the last occurrence when several are present', () => {
    expect(parseOsc7('\x1b]7;file:///a\x07\x1b]7;file:///b\x07')).toBe('/b');
  });

  it('falls back to the raw path on decode errors', () => {
    expect(parseOsc7('\x1b]7;file:///bad%zz\x07')).toBe('/bad%zz');
  });

  it('returns null without a match', () => {
    expect(parseOsc7('plain text')).toBeNull();
  });

  it('parses Windows drive-letter paths', () => {
    expect(parseOsc7('\x1b]7;file://C:/Users/test/a%20b\x07')).toBe('C:/Users/test/a b');
  });

  it('parses MSYS (Git Bash) paths into drive form', () => {
    expect(parseOsc7('\x1b]7;file:///c/Users/test\x07')).toBe('C:/Users/test');
  });
});
