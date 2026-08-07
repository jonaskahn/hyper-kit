import { describe, it, expect } from 'vitest';

import { MEDIA_REMOTE_SWIFT, parseRemoteLine } from '../../src/platform/media-remote';

describe('parseRemoteLine', () => {
  it('parses a playing session line', () => {
    expect(
      parseRemoteLine('Chrome\tChandelier\tSia\ttrue\tfile:///tmp/hyper-kit-cover-remote.jpg'),
    ).toEqual({
      app: 'Chrome',
      title: 'Chandelier',
      artist: 'Sia',
      playing: true,
      artUrl: 'file:///tmp/hyper-kit-cover-remote.jpg',
    });
  });

  it('parses a paused session with no artwork', () => {
    expect(parseRemoteLine('Safari\tPodcast Episode\tSome Show\tfalse\t')).toEqual({
      app: 'Safari',
      title: 'Podcast Episode',
      artist: 'Some Show',
      playing: false,
      artUrl: null,
    });
  });

  it('returns null for empty or malformed output', () => {
    expect(parseRemoteLine(null)).toBeNull();
    expect(parseRemoteLine('')).toBeNull();
    expect(parseRemoteLine('Chrome\tTitle\ttrue\t')).toBeNull();
  });
});

describe('MEDIA_REMOTE_SWIFT', () => {
  it('uses the system Now Playing API without touching the page', () => {
    expect(MEDIA_REMOTE_SWIFT).toContain('import MediaRemote');
    expect(MEDIA_REMOTE_SWIFT).toContain('MRMediaRemoteGetNowPlayingInfo');
    expect(MEDIA_REMOTE_SWIFT).toContain('MRMediaRemoteSendCommand');
    expect(MEDIA_REMOTE_SWIFT).not.toContain('document.querySelector');
  });

  it('derives playing state from playback rate and the is-playing callback', () => {
    expect(MEDIA_REMOTE_SWIFT).toContain('MRMediaRemoteGetNowPlayingApplicationIsPlaying');
    expect(MEDIA_REMOTE_SWIFT).toContain('let playing = isPlaying || rate > 0');
  });

  it('writes artwork to the shared cover temp file', () => {
    expect(MEDIA_REMOTE_SWIFT).toContain('/tmp/hyper-kit-cover-remote.jpg');
  });
});
