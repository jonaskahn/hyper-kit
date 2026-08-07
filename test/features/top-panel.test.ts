import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { applyConfig } from '../../src/config';
import {
  durationFor,
  getTopPanelEl,
  initTopPanel,
  reloadTopPanel,
  TOP_PANEL_HEIGHT_PX,
} from '../../src/features/top-panel';
import { CpuMeter } from '../../src/platform/system-info';

let dispose: (() => void) | null = null;

function mountPanel(meter?: CpuMeter): void {
  dispose = initTopPanel(meter);
}

beforeEach(() => {
  document.body.innerHTML = '<div class="header_header"></div>';
  applyConfig(null);
  (window as any).config = undefined;
  vi.useRealTimers();
});

afterEach(() => {
  if (dispose) {
    dispose();
    dispose = null;
  }
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('top panel', () => {
  it('builds the runner strip by default and consumes the top margin', () => {
    mountPanel();
    const panel = getTopPanelEl()!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.kit-dino')).not.toBeNull();
    expect(panel.querySelector('.kit-dino-strip .kit-dino-strip-svg')).not.toBeNull();
    expect(panel.querySelector('.kit-dino-sleep .kit-dino-sprite')).not.toBeNull();
    expect(panel.querySelectorAll('.kit-dino-obstacle').length).toBe(0);
    // pinned at the right edge by default, not mid-run-across-the-strip
    expect(panel.querySelector<HTMLElement>('.kit-dino-cat')!.dataset.catState).toBe('run');
    expect(document.documentElement.style.getPropertyValue('--kit-top-panel-height')).toBe(
      TOP_PANEL_HEIGHT_PX + 'px',
    );
    // enabled: the panel replaces the titlebar strip, terminal sits flush
    expect(document.documentElement.style.getPropertyValue('--kit-term-top')).toBe(
      TOP_PANEL_HEIGHT_PX + 2 + 'px',
    );
  });

  it('does not build a panel when topPanel is disabled', () => {
    (window as any).config = { getConfig: () => ({ hyperKit: { topPanel: false } }) };
    applyConfig({ hyperKit: { topPanel: false } });
    mountPanel();
    expect(getTopPanelEl()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--kit-top-panel-height')).not.toBe(
      TOP_PANEL_HEIGHT_PX + 'px',
    );
  });

  it('maps cpu usage to the run-cycle duration', () => {
    expect(durationFor(0)).toBe(240);
    expect(durationFor(50)).toBe(150);
    expect(durationFor(100)).toBe(60);
    expect(durationFor(-10)).toBe(240);
    expect(durationFor(150)).toBe(60);
  });

  it('sets the cat run duration from the cpu sample', () => {
    vi.useFakeTimers();
    // each read is a fresh tick: +1000 total, +600 idle -> steady 40% busy
    let totalTicks = 0;
    let idleTicks = 0;
    mountPanel(
      new CpuMeter(() => {
        totalTicks += 1000;
        idleTicks += 600;
        return { total: totalTicks, idle: idleTicks };
      }),
    );
    // the first sample only primes the meter, so let two intervals elapse
    vi.advanceTimersByTime(2000);
    const panel = getTopPanelEl()!;
    expect(panel.style.getPropertyValue('--kit-cat-duration')).toBe('168ms');
    expect(panel.title).toBe('CPU 40%');
    expect(panel.querySelector<HTMLElement>('.kit-dino-cat')!.dataset.catState).toBe('run');
  });

  it('finishes the frame already on screen at its own pace before a cpu-driven speed change applies', () => {
    vi.useFakeTimers();
    // steady 50% busy until switched to near-saturated mid-test; cpu is
    // constant from the very first sample, so smoothedCpu (and therefore
    // the frame pace) settles immediately, with no convergence transient
    let idleShare = 0.5;
    let totalTicks = 0;
    let idleTicks = 0;
    mountPanel(
      new CpuMeter(() => {
        totalTicks += 1000;
        idleTicks += 1000 * idleShare;
        return { total: totalTicks, idle: idleTicks };
      }),
    );
    const panel = getTopPanelEl()!;
    const strip = panel.querySelector<HTMLElement>('.kit-dino-strip-svg')!;

    // let several steady-state cpu samples land so the frame pace has
    // definitely converged to durationFor(50)
    vi.advanceTimersByTime(4000);

    // walk forward 1ms at a time to land exactly on the next frame-tick
    // boundary, whatever phase the timer chain happens to be at
    const beforeTick = strip.style.transform;
    const upperBoundMs = durationFor(0); // >= any real pace, by construction
    let waited = 0;
    while (strip.style.transform === beforeTick && waited < upperBoundMs) {
      vi.advanceTimersByTime(1);
      waited += 1;
    }
    expect(waited).toBeLessThan(upperBoundMs); // sanity: it did tick

    // cpu spikes right as this frame starts its run
    idleShare = 0.02;
    const onScreen = strip.style.transform;
    const pace = durationFor(50); // the pace that was active when this tick was scheduled

    vi.advanceTimersByTime(pace - 1);
    expect(strip.style.transform).toBe(onScreen); // not cut short by the spike
    vi.advanceTimersByTime(1);
    expect(strip.style.transform).not.toBe(onScreen); // advances at its own, un-cut pace
  });

  it('falls asleep once cpu settles at or below the sleep threshold', () => {
    vi.useFakeTimers();
    // fully idle: no busy ticks at all -> 0% cpu
    let totalTicks = 0;
    let idleTicks = 0;
    mountPanel(
      new CpuMeter(() => {
        totalTicks += 1000;
        idleTicks += 1000;
        return { total: totalTicks, idle: idleTicks };
      }),
    );
    vi.advanceTimersByTime(2000);
    const panel = getTopPanelEl()!;
    expect(panel.title).toBe('CPU 0%');
    expect(panel.querySelector<HTMLElement>('.kit-dino-cat')!.dataset.catState).toBe('sleep');
  });

  it('stays awake once cpu rises above the sleep threshold', () => {
    vi.useFakeTimers();
    // 2% busy, just over the <=1 sleep threshold
    let totalTicks = 0;
    let idleTicks = 0;
    mountPanel(
      new CpuMeter(() => {
        totalTicks += 1000;
        idleTicks += 980;
        return { total: totalTicks, idle: idleTicks };
      }),
    );
    vi.advanceTimersByTime(2000);
    const panel = getTopPanelEl()!;
    expect(panel.title).toBe('CPU 2%');
    expect(panel.querySelector<HTMLElement>('.kit-dino-cat')!.dataset.catState).toBe('run');
  });

  it('dispose removes the panel, resets the height and restores the top margin', () => {
    mountPanel();
    dispose!();
    dispose = null;
    expect(document.querySelector('[data-kit-tab-top-panel]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--kit-top-panel-height')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--kit-term-top')).toBe('28px');
  });

  it('reload hides the panel when the config disables it', () => {
    mountPanel();
    (window as any).config = { getConfig: () => ({ hyperKit: { topPanel: false } }) };
    reloadTopPanel();
    expect(getTopPanelEl()!.style.display).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--kit-top-panel-height')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--kit-term-top')).toBe('28px');
  });

  it('keeps the strip but hides the cat when runningCat is off', () => {
    (window as any).config = {
      getConfig: () => ({ hyperKit: { topPanel: { enabled: true, runningCat: false } } }),
    };
    applyConfig({ hyperKit: { topPanel: { enabled: true, runningCat: false } } });
    mountPanel();
    const panel = getTopPanelEl()!;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('--kit-top-panel-height')).toBe(
      TOP_PANEL_HEIGHT_PX + 'px',
    );
    const cat = panel.querySelector<HTMLElement>('.kit-dino')!;
    expect(cat.style.display).toBe('none');
  });

  it('reload shows the cat again once runningCat comes back on', () => {
    (window as any).config = {
      getConfig: () => ({ hyperKit: { topPanel: { enabled: true, runningCat: false } } }),
    };
    applyConfig({ hyperKit: { topPanel: { enabled: true, runningCat: false } } });
    mountPanel();
    (window as any).config = {
      getConfig: () => ({ hyperKit: { topPanel: { enabled: true, runningCat: true } } }),
    };
    reloadTopPanel();
    const cat = getTopPanelEl()!.querySelector<HTMLElement>('.kit-dino')!;
    expect(cat.style.display).toBe('');
  });
});
