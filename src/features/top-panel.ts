/* Top status panel: a compact strip above the terminal area (right of the
   vertical tab bar) holding an 8-bit black-and-white pixel cat pinned at the
   right edge — it runs in place rather than crossing the strip. How fast its
   run-cycle plays back scales with live CPU usage; the numeric value is
   exposed as a hover tooltip only, the cat's pace is the visible signal. At
   near-idle CPU the cat swaps to a curled-up sleeping pose instead of
   running.

   The running cat is a 5-frame filmstrip SVG (see CAT_RUN_FRAMES); CSS
   steps() its translateX one frame-width per step inside a clipped
   viewport, playing the frames back in sequence. The sleep pose is a
   separate single-frame SVG shown in its place. Motion is pure CSS: the
   strip's playback and the body bob both consume --kit-cat-duration (the
   per-frame time, written on the panel by the CPU sampler — higher CPU =
   shorter duration = faster playback). Mirrors bottom-panel.ts's lifecycle
   (init / reload / reattach / dispose via the --kit-top-panel-height /
   --kit-term-top variables). */

import { isRunningCatEnabled, isTopPanelEnabled, readUiConfig } from '../config';
import { CpuMeter } from '../platform/system-info';
import { ATTRIBUTES } from '../platform/dom-selectors';

const CPU_REFRESH_MS = 1000;
export const TOP_PANEL_HEIGHT_PX = 34;

/* the empty titlebar strip above the terminal: kept as the terminal's top
   margin when the panel is off, consumed by the panel when it's on (the
   terminal then sits flush below it, per user preference) */
const TERM_TOP_MARGIN_PX = 28;

/* leg-cycle duration per CPU%: 0% CPU trots at MAX_RUN_MS, 100% sprints at
   MIN_RUN_MS */
const MIN_RUN_MS = 60;
const MAX_RUN_MS = 240;

/* at or below this smoothed CPU%, the cat is treated as idle and swaps to
   the sleeping pose instead of running */
const SLEEP_CPU_THRESHOLD = 1;

/* monochrome running cat, 5 hand-traced frames from RunCat_for_Linux's
   dark_cat_0..4.ico (github.com/Jas0nG/RunCat_for_Linux, resources/cat —
   the "dark" variant is the white-on-transparent glyph meant for dark
   trays, matching this panel). Each frame is a full pose, not a
   swappable-legs composite; the frames play back as a filmstrip. */
const CAT_ROWS_0 = [
  '................................',
  '......................#..##.....',
  '.....................##.###.....',
  '.....................#.####.....',
  '....................#######.....',
  '....................###..#......',
  '...................####..#.##...',
  '..............###############...',
  '............################....',
  '.......####################.....',
  '.....####.###############.......',
  '#######....#############........',
  '#####......#############........',
  '...........########.####........',
  '...........######....###........',
  '...........######....##.........',
  '............##.###...#..........',
  '............##..##..............',
  '.............##.................',
  '..............#.................',
];
const CAT_ROWS_1 = [
  '.........................#.##...',
  '........................#####...',
  '.......................#.####...',
  '.......................#######..',
  '......................####.##.#.',
  '.....................#####.##.#.',
  '...............################.',
  '......######..################..',
  '..###########################...',
  '.####......#################....',
  '...........##################...',
  '.........#####################..',
  '........#############....#####..',
  '.......#########...........##...',
  '......########..................',
  '......##..###...................',
  '.........###....................',
  '.........##.....................',
  '................................',
  '................................',
];
const CAT_ROWS_2 = [
  '................................',
  '................................',
  '..........................#..##.',
  '....#####................##.###.',
  '..##########............##.###..',
  '...#.....####...........#######.',
  '...........#########...####.##..',
  '............###############.##.#',
  '............####################',
  '...........####################.',
  '.........####################...',
  '........######################..',
  '.......#########################',
  '......####.####.........######..',
  '...........###............####..',
  '..........###..............###..',
  '................................',
  '................................',
  '................................',
  '................................',
];
const CAT_ROWS_3 = [
  '................................',
  '................................',
  '....#####.......................',
  '....#######.....................',
  '..........###...................',
  '...........##.............##..#.',
  '............##.##........#.####.',
  '.............######.....#######.',
  '............########...########.',
  '............##############..#...',
  '...........##################..#',
  '...........####################.',
  '...........###################..',
  '...........#################....',
  '...........###.....#########....',
  '............##........########..',
  '............##.........#######..',
  '............##.........###......',
  '........................###.....',
  '.........................##.....',
];
const CAT_ROWS_4 = [
  '................................',
  '................................',
  '................................',
  '.......................##.##....',
  '......................######....',
  '.....................##.###.....',
  '............######..########....',
  '.........###############.###....',
  '.##....#################.##.#...',
  '.############################...',
  '..#####....#################....',
  '...........################.....',
  '............############........',
  '.............##########.........',
  '.............##########.........',
  '.............##########.........',
  '................###.###.........',
  '................##..###.........',
  '.....................##.........',
  '......................#.........',
];
const CAT_RUN_FRAMES = [CAT_ROWS_0, CAT_ROWS_1, CAT_ROWS_2, CAT_ROWS_3, CAT_ROWS_4];

/* curled, closed-eyed sleeping pose, shown instead of the run frames once
   CPU settles at/below SLEEP_CPU_THRESHOLD */
const CAT_SLEEP_ROWS = [
  '.......########.........',
  '....###############.....',
  '..####################..',
  '.######################.',
  '.######################.',
  '...##################...',
  '....#####......#####....',
];

/* the RunCat frames are native icon resolution (32x20) — 1px/unit keeps
   them crisp at their intended size; the hand-drawn sleep pose is coarser
   and drawn at 2px/unit */
const RUN_PIXEL = 1;
const SLEEP_PIXEL = 2;

function spriteSvg(
  rows: string[],
  palette: Record<string, string>,
  pixel: number,
  cls: string,
): string {
  const width = rows[0].length * pixel;
  const height = rows.length * pixel;
  const rects: string[] = [];
  rows.forEach((row, y) => {
    Array.from(row).forEach((ch, x) => {
      const fill = palette[ch];
      if (fill) {
        rects.push(
          `<rect x="${x * pixel}" y="${y * pixel}" width="${pixel}" height="${pixel}" fill="${fill}"/>`,
        );
      }
    });
  });
  return (
    `<svg class="${cls}" viewBox="0 0 ${width} ${height}" ` +
    'shape-rendering="crispEdges" aria-hidden="true">' +
    rects.join('') +
    '</svg>'
  );
}

/* lays frames left-to-right into one filmstrip SVG; CSS steps() the strip's
   translateX across it, one frame-width per step, to play it back */
function filmstripSvg(
  frames: string[][],
  palette: Record<string, string>,
  pixel: number,
  cls: string,
): { svg: string; frameWidth: number; frameHeight: number } {
  const frameWidth = frames[0][0].length * pixel;
  const frameHeight = frames[0].length * pixel;
  const rects: string[] = [];
  frames.forEach((rows, i) => {
    const xOffset = i * frameWidth;
    rows.forEach((row, y) => {
      Array.from(row).forEach((ch, x) => {
        const fill = palette[ch];
        if (fill) {
          rects.push(
            `<rect x="${xOffset + x * pixel}" y="${y * pixel}" width="${pixel}" height="${pixel}" fill="${fill}"/>`,
          );
        }
      });
    });
  });
  const svg =
    `<svg class="${cls}" viewBox="0 0 ${frameWidth * frames.length} ${frameHeight}" ` +
    'shape-rendering="crispEdges" aria-hidden="true">' +
    rects.join('') +
    '</svg>';
  return { svg, frameWidth, frameHeight };
}

const CAT_STRIP = filmstripSvg(CAT_RUN_FRAMES, { '#': '#ffffff' }, RUN_PIXEL, 'kit-dino-strip-svg');
const CAT_SVG_SLEEP = spriteSvg(CAT_SLEEP_ROWS, { '#': '#ffffff' }, SLEEP_PIXEL, 'kit-dino-sprite');

let panelEl: HTMLElement | null = null;
let cpuMeter: CpuMeter | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
/* exponentially smoothed so the pace eases toward the load instead of
   stuttering on single-sample spikes */
let smoothedCpu: number | null = null;

/* the run-cycle is stepped from JS, one frame per timeout, instead of a CSS
   animation driven live by --kit-cat-duration: a CSS animation's duration
   rescales an already-in-flight animation the instant the variable changes,
   which made the strip jump to an unrelated frame mid-stride every time CPU
   ticked. A plain setTimeout chain reads the current pace only when
   scheduling the *next* step, so a pace change never cuts short the frame
   already on screen — it always finishes at its own pace first. */
let frameIndex = 0;
let frameDurationMs = MAX_RUN_MS;
let frameTimer: ReturnType<typeof setTimeout> | null = null;

function setCatVisible(visible: boolean): void {
  if (!panelEl) {
    return;
  }
  const catEl = panelEl.querySelector<HTMLElement>('.kit-dino');
  if (catEl) {
    catEl.style.display = visible ? '' : 'none';
  }
}

function stopCat(): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (frameTimer !== null) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
  cpuMeter = null;
  smoothedCpu = null;
  frameIndex = 0;
  frameDurationMs = MAX_RUN_MS;
  setCatVisible(false);
}

/* starts the CPU meter + run-cycle; idempotent so a config reload with the
   cat still enabled never stacks a second sampler on top */
function startCat(meter?: CpuMeter): void {
  if (refreshTimer !== null || cpuMeter !== null) {
    return;
  }
  cpuMeter = meter ?? new CpuMeter();
  setCatVisible(true);
  refreshCpu();
  refreshTimer = setInterval(refreshCpu, CPU_REFRESH_MS);
  frameTimer = setTimeout(advanceFrame, frameDurationMs);
}

export function getTopPanelEl(): HTMLElement | null {
  return panelEl;
}

/* pure mapping, exported for tests: cpu 0..100 -> run-cycle ms (500..2000) */
export function durationFor(cpu: number): number {
  const clamped = Math.min(100, Math.max(0, cpu));
  return Math.round(MAX_RUN_MS - ((MAX_RUN_MS - MIN_RUN_MS) * clamped) / 100);
}

function buildTopPanel(): HTMLElement {
  if (panelEl) {
    return panelEl;
  }
  const panel = document.createElement('div');
  panel.setAttribute(ATTRIBUTES.topPanel, '');
  panel.innerHTML =
    '<div class="kit-dino">' +
    '<div class="kit-dino-cat" data-cat-state="run">' +
    `<div class="kit-dino-bob"><div class="kit-dino-strip">${CAT_STRIP.svg}</div></div>` +
    `<div class="kit-dino-sleep">${CAT_SVG_SLEEP}</div>` +
    '</div>' +
    '</div>';
  document.body.appendChild(panel);
  panelEl = panel;
  return panel;
}

export function reattachTopPanel(): void {
  if (panelEl && !panelEl.isConnected) {
    document.body.appendChild(panelEl);
  }
}

function setPanelVisible(visible: boolean): void {
  document.documentElement.style.setProperty(
    '--kit-top-panel-height',
    visible ? TOP_PANEL_HEIGHT_PX + 'px' : '0px',
  );
  /* enabled: the panel replaces the titlebar strip, so the terminal gets no
     top margin beyond the panel itself; disabled: restore the strip */
  document.documentElement.style.setProperty(
    '--kit-term-top',
    visible ? TOP_PANEL_HEIGHT_PX + 2 + 'px' : TERM_TOP_MARGIN_PX + 'px',
  );
  if (panelEl) {
    panelEl.style.display = visible ? '' : 'none';
  }
}

function applyCpu(cpu: number): void {
  if (!panelEl) {
    return;
  }
  smoothedCpu = smoothedCpu === null ? cpu : smoothedCpu * 0.65 + cpu * 0.35;
  frameDurationMs = durationFor(smoothedCpu);
  panelEl.style.setProperty('--kit-cat-duration', frameDurationMs + 'ms');
  panelEl.title = 'CPU ' + Math.round(smoothedCpu) + '%';
  const catEl = panelEl.querySelector<HTMLElement>('.kit-dino-cat');
  if (catEl) {
    catEl.dataset.catState = smoothedCpu <= SLEEP_CPU_THRESHOLD ? 'sleep' : 'run';
  }
}

/* advances the filmstrip by exactly one frame, then reschedules itself using
   whatever pace is current *at that moment* — never the pace that was
   current when this tick was originally scheduled */
function advanceFrame(): void {
  if (panelEl) {
    const catEl = panelEl.querySelector<HTMLElement>('.kit-dino-cat');
    if (catEl?.dataset.catState !== 'sleep') {
      frameIndex = (frameIndex + 1) % CAT_RUN_FRAMES.length;
      const stripSvg = panelEl.querySelector<HTMLElement>('.kit-dino-strip-svg');
      if (stripSvg) {
        stripSvg.style.transform = `translateX(${-frameIndex * CAT_STRIP.frameWidth}px)`;
      }
    }
  }
  frameTimer = setTimeout(advanceFrame, frameDurationMs);
}

function refreshCpu(): void {
  if (!panelEl || !cpuMeter) {
    return;
  }
  const cpu = cpuMeter.sample();
  if (cpu !== null) {
    applyCpu(cpu);
  }
}

function disposeTopPanel(): void {
  stopCat();
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  setPanelVisible(false);
}

/* the meter is injectable for tests; production always uses the real one */
export function initTopPanel(meter?: CpuMeter): () => void {
  readUiConfig();
  if (!isTopPanelEnabled()) {
    return () => undefined;
  }
  buildTopPanel();
  setPanelVisible(true);
  if (isRunningCatEnabled()) {
    startCat(meter);
  } else {
    setCatVisible(false);
  }
  return disposeTopPanel;
}

export function reloadTopPanel(): void {
  readUiConfig();
  setPanelVisible(isTopPanelEnabled());
  if (!isTopPanelEnabled()) {
    stopCat();
    return;
  }
  if (!panelEl) {
    initTopPanel();
    return;
  }
  if (isRunningCatEnabled()) {
    startCat();
  } else {
    stopCat();
  }
}
