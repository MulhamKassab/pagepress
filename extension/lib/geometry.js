import { t } from './i18n.js';

export const MAX_TILES = 80;
export const MAX_HEIGHT = 100000;

export function normalizeOptions(input = {}) {
  return {
    scope: ['full', 'viewport'].includes(input.scope) ? input.scope : 'full',
    paper: ['a4', 'letter'].includes(input.paper) ? input.paper : 'a4',
    orientation: ['portrait', 'landscape'].includes(input.orientation) ? input.orientation : 'portrait',
    margin: [0, 8, 12, 18].includes(Number(input.margin)) ? Number(input.margin) : 12,
    footer: input.footer !== false,
    quality: ['high', 'balanced', 'compact'].includes(input.quality) ? input.quality : 'balanced',
    hideSticky: input.hideSticky !== false,
    loadImages: input.loadImages !== false,
    cleanPrint: input.cleanPrint !== false,
  };
}

function dimensions(metrics, options) {
  for (const key of ['width', 'height', 'viewportWidth', 'viewportHeight']) {
    if (!Number.isFinite(metrics[key]) || metrics[key] <= 0) throw new Error(t('errorNoArea', 'This page has no usable capture area.'));
  }
  const vw = Math.floor(metrics.viewportWidth), vh = Math.floor(metrics.viewportHeight);
  if (!vw || !vh) throw new Error(t('errorViewportSmall', 'The browser viewport is too small to capture.'));
  const width = options.scope === 'viewport' ? Math.min(Math.ceil(metrics.width), vw) : Math.ceil(metrics.width);
  const height = options.scope === 'viewport' ? Math.min(Math.ceil(metrics.height), vh) : Math.ceil(metrics.height);
  if (height > MAX_HEIGHT) throw new Error(t('errorTooLong', 'This page is too long to capture safely. Choose Current view, or export a smaller section.'));
  return { width, height, vw, vh };
}

export function planTiles(metrics, input = {}) {
  const options = normalizeOptions(input);
  const { width, height, vw, vh } = dimensions(metrics, options);
  const columns = Math.ceil(width / vw), rows = Math.ceil(height / vh);
  if (columns * rows > MAX_TILES) throw new Error(t('errorTooManyTiles', 'This page needs more than $1 captures. Choose Current view, zoom out, or use Print mode.', MAX_TILES));
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * vw, y = row * vh;
      tiles.push({ x, y, width: Math.min(vw, width - x), height: Math.min(vh, height - y), scrollX: Math.min(x, Math.max(0, width - vw)), scrollY: Math.min(y, Math.max(0, height - vh)), row, lastInRow: column === columns - 1 });
    }
  }
  return tiles;
}

export function pdfLayout(metrics, input = {}) {
  const options = normalizeOptions(input);
  const { width, height } = dimensions(metrics, options);
  let [pageWidth, pageHeight] = options.paper === 'letter' ? [215.9, 279.4] : [210, 297];
  if (options.orientation === 'landscape') [pageWidth, pageHeight] = [pageHeight, pageWidth];
  const margin = options.margin, footerHeight = options.footer ? 9 : 0;
  const contentWidth = pageWidth - margin * 2, contentHeight = pageHeight - margin * 2 - footerHeight;
  const cssPageHeight = width * contentHeight / contentWidth;
  const maximumWidth = { compact: 1200, balanced: 1800, high: 2400 }[options.quality];
  // Above 2x the extra sharpness costs a lot of memory for little visible gain.
  const deviceScale = Math.max(1, Math.min(2, metrics.devicePixelRatio || 1));
  const canvasWidth = Math.max(1, Math.round(Math.min(maximumWidth, width * deviceScale)));
  const pixelScale = canvasWidth / width;
  return { pageWidth, pageHeight, margin, footerHeight, contentWidth, contentHeight, cssPageHeight, totalPages: Math.ceil(height / cssPageHeight), width, height, pixelScale, canvasWidth, canvasHeight: Math.ceil(cssPageHeight * pixelScale) };
}

export function tileSlices(tile, layout) {
  const slices = [];
  let position = tile.y;
  const bottom = tile.y + tile.height;
  while (position < bottom - 1e-7) {
    const pageIndex = Math.floor((position + 1e-7) / layout.cssPageHeight);
    const pageTop = pageIndex * layout.cssPageHeight;
    const end = Math.min(bottom, pageTop + layout.cssPageHeight);
    const height = end - position;
    slices.push({ pageIndex, sourceX: tile.cropX ?? tile.x - tile.scrollX, sourceY: (tile.cropY ?? tile.y - tile.scrollY) + position - tile.y, sourceWidth: tile.width, sourceHeight: height, destX: tile.x * layout.pixelScale, destY: (position - pageTop) * layout.pixelScale, destWidth: tile.width * layout.pixelScale, destHeight: height * layout.pixelScale });
    position = end;
  }
  return slices;
}

// --- Adaptive capture helpers (pure; used by background.js and unit-tested) ---

// A page may change height while it is scrolled (a header turning position:fixed,
// lazy content). Differences up to this many CSS pixels are rounding noise.
export const LAYOUT_TOLERANCE = 2;

// How far the content moved up, as a negative number of CSS pixels, when the
// page got shorter than planned. 0 when it did not shrink.
export function layoutShift(plannedHeight, currentHeight) {
  const delta = Math.round(currentHeight) - Math.round(plannedHeight);
  return delta < -LAYOUT_TOLERANCE ? delta : 0;
}

// How many CSS pixels the page grew beyond the plan. 0 when it did not grow.
export function layoutGrowth(plannedHeight, currentHeight) {
  const delta = Math.round(currentHeight) - Math.round(plannedHeight);
  return delta > LAYOUT_TOLERANCE ? delta : 0;
}

// The shift to apply to the remaining tiles after a move. Prefer the position of an
// anchor element near the middle of the first screen (it also catches content inserted
// above the current position); fall back to the change in page height.
export function observedShift(plannedHeight, moved) {
  if (Number.isFinite(moved.anchorShift)) return Math.abs(moved.anchorShift) > LAYOUT_TOLERANCE ? Math.round(moved.anchorShift) : 0;
  return layoutShift(plannedHeight, moved.height);
}

// Rough memory the finished PDF needs (compressed page images), in bytes.
export function estimatePdfBytes(layout, input = {}) {
  const options = normalizeOptions(input);
  const perPixel = { compact: 0.12, balanced: 0.3, high: 0.6 }[options.quality];
  return Math.round(layout.totalPages * layout.canvasWidth * layout.canvasHeight * perPixel);
}
export const MAX_ESTIMATED_BYTES = 200 * 1024 * 1024;
// Below this the page is drawn at under half its natural size (very wide pages).
export const MIN_READABLE_SCALE = 0.5;

// Where to scroll for a planned tile once the layout has shifted.
export function shiftedScrollY(tile, shift) {
  return Math.max(0, tile.scrollY + (shift || 0));
}

// Where, inside the visible area, a tile's pixels are. `moved` holds the real
// scroll position (left-to-right x) after moving.
export function tileCrop(tile, shift, moved, viewportWidth, viewportHeight) {
  const cropX = tile.x - moved.x, cropY = tile.y + (shift || 0) - moved.y;
  const ok = cropX >= -1 && cropY >= -1 && cropX + tile.width <= viewportWidth + 1 && cropY + tile.height <= viewportHeight + 1;
  return { cropX, cropY, ok };
}

// Right-to-left documents scroll from 0 (right edge) to a negative maximum
// (left edge). Plans use a left-to-right "visual" x where 0 is the left edge,
// so the PDF's image order matches what the reader sees.
export function toNativeScrollX(visualX, rtl, maxScroll) {
  return rtl ? visualX - Math.max(0, maxScroll) : visualX;
}
export function toVisualScrollX(nativeX, rtl, maxScroll) {
  return rtl ? nativeX + Math.max(0, maxScroll) : nativeX;
}

export function safeFilename(title = '') {
  let base = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.pdf$/i, '').replace(/[. ]+$/g, '').slice(0, 140).trim();
  if (!base) base = 'webTopdf export';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `webTopdf ${base}`;
  return `${base}.pdf`;
}
