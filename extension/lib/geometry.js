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
    if (!Number.isFinite(metrics[key]) || metrics[key] <= 0) throw new Error('This page has no usable capture area.');
  }
  const vw = Math.floor(metrics.viewportWidth), vh = Math.floor(metrics.viewportHeight);
  if (!vw || !vh) throw new Error('The browser viewport is too small to capture.');
  const width = options.scope === 'viewport' ? Math.min(Math.ceil(metrics.width), vw) : Math.ceil(metrics.width);
  const height = options.scope === 'viewport' ? Math.min(Math.ceil(metrics.height), vh) : Math.ceil(metrics.height);
  if (height > MAX_HEIGHT) throw new Error('This page is too long to capture safely. Choose Current view, or export a smaller section.');
  return { width, height, vw, vh };
}

export function planTiles(metrics, input = {}) {
  const options = normalizeOptions(input);
  const { width, height, vw, vh } = dimensions(metrics, options);
  const columns = Math.ceil(width / vw), rows = Math.ceil(height / vh);
  if (columns * rows > MAX_TILES) throw new Error(`This page needs more than ${MAX_TILES} captures. Choose Current view, zoom out, or use Print mode.`);
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
  const deviceScale = Math.max(1, Math.min(3, metrics.devicePixelRatio || 1));
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

export function safeFilename(title = '') {
  let base = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.pdf$/i, '').replace(/[. ]+$/g, '').slice(0, 140).trim();
  if (!base) base = 'webTopdf export';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `webTopdf ${base}`;
  return `${base}.pdf`;
}
