import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOptions,
  planTiles,
  pdfLayout,
  tileSlices,
  safeFilename,
} from '../extension/lib/geometry.js';

const defaults = {
  scope: 'full',
  paper: 'a4',
  orientation: 'portrait',
  margin: 12,
  footer: true,
  quality: 'balanced',
  hideSticky: true,
  loadImages: true,
  cleanPrint: true,
};

const epsilon = 1e-6;
const near = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)),
    `${message}: expected ${expected}, got ${actual}`);
};

function assertCoverage(tiles, width, height) {
  let totalArea = 0;
  for (const tile of tiles) {
    assert.ok(tile.width > 0 && tile.height > 0, 'Tiles must have positive area');
    assert.ok(tile.x >= 0 && tile.y >= 0, 'Tile origin stays in the document');
    assert.ok(tile.x + tile.width <= width, 'Tile stays inside document width');
    assert.ok(tile.y + tile.height <= height, 'Tile stays inside document height');
    totalArea += tile.width * tile.height;
  }
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      const overlapWidth = Math.min(tiles[i].x + tiles[i].width, tiles[j].x + tiles[j].width)
        - Math.max(tiles[i].x, tiles[j].x);
      const overlapHeight = Math.min(tiles[i].y + tiles[i].height, tiles[j].y + tiles[j].height)
        - Math.max(tiles[i].y, tiles[j].y);
      assert.ok(overlapWidth <= 0 || overlapHeight <= 0, 'Planned tiles never duplicate pixels');
    }
  }
  assert.equal(totalArea, width * height, 'Tiles cover the entire requested area');
}

test('options preserve supported settings and normalize unsupported values', () => {
  assert.deepEqual(normalizeOptions({}), defaults);
  const selected = {
    scope: 'viewport', paper: 'letter', orientation: 'landscape',
    margin: 18, footer: false, quality: 'compact',
    hideSticky: false, loadImages: false, cleanPrint: false,
  };
  assert.deepEqual(normalizeOptions(selected), selected);
  assert.deepEqual(normalizeOptions({
    scope: 'document', paper: 'a3', orientation: 'diagonal', margin: -1,
    footer: undefined, quality: 'ultra',
  }), defaults);
});

test('full-page tiles cover an uneven, horizontally scrolling document exactly once', () => {
  const metrics = { width: 2573, height: 9127, viewportWidth: 1280, viewportHeight: 720 };
  const tiles = planTiles(metrics, defaults);
  assert.equal(tiles.length, 39);
  assertCoverage(tiles, metrics.width, metrics.height);
  for (const tile of tiles) {
    assert.equal(tile.scrollX, Math.min(tile.x, metrics.width - metrics.viewportWidth));
    assert.equal(tile.scrollY, Math.min(tile.y, metrics.height - metrics.viewportHeight));
    assert.ok(tile.x - tile.scrollX + tile.width <= metrics.viewportWidth);
    assert.ok(tile.y - tile.scrollY + tile.height <= metrics.viewportHeight);
  }
  const rows = new Map();
  for (const tile of tiles) {
    if (!rows.has(tile.row)) rows.set(tile.row, []);
    rows.get(tile.row).push(tile);
  }
  for (const row of rows.values()) {
    assert.equal(row.filter(tile => tile.lastInRow).length, 1);
    assert.equal(row.at(-1).lastInRow, true);
  }
});

test('small documents and viewport exports use one unclamped capture at local origin', () => {
  const metrics = { width: 600, height: 400, viewportWidth: 1280, viewportHeight: 720 };
  for (const scope of ['full', 'viewport']) {
    const tiles = planTiles(metrics, { ...defaults, scope });
    assert.equal(tiles.length, 1);
    assertCoverage(tiles, 600, 400);
    assert.equal(tiles[0].scrollX, 0);
    assert.equal(tiles[0].scrollY, 0);
  }
  const visible = planTiles(
    { width: 4000, height: 12000, viewportWidth: 1280, viewportHeight: 720 },
    { ...defaults, scope: 'viewport' },
  );
  assert.equal(visible.length, 1);
  assertCoverage(visible, 1280, 720);
  assert.equal(visible[0].scrollX, 0);
  assert.equal(visible[0].scrollY, 0);
});

test('fractional document sizes round outward and capture viewports round inward', () => {
  const tiles = planTiles(
    { width: 1000.2, height: 701.1, viewportWidth: 500.9, viewportHeight: 350.9 },
    defaults,
  );
  assertCoverage(tiles, 1001, 702);
  assert.equal(tiles.length, 9);
  assert.ok(tiles.every(tile => tile.width <= 500 && tile.height <= 350));
});

test('invalid metrics and oversized captures reject before producing a plan', () => {
  const valid = { width: 1000, height: 1000, viewportWidth: 500, viewportHeight: 500 };
  for (const key of Object.keys(valid)) {
    for (const value of [0, -1, NaN, Infinity, undefined]) {
      assert.throws(() => planTiles({ ...valid, [key]: value }, defaults),
        `Invalid ${key}=${value} must not create a capture`);
    }
  }
  assert.throws(() => planTiles({ ...valid, height: 100001 }, defaults));
  assert.throws(() => planTiles({ width: 8100, height: 100, viewportWidth: 100, viewportHeight: 100 }, defaults));
  assert.equal(planTiles({ width: 8000, height: 100, viewportWidth: 100, viewportHeight: 100 }, defaults).length, 80);
  assert.equal(planTiles({ width: 100, height: 100000, viewportWidth: 100, viewportHeight: 2000 }, defaults).length, 50);
});

test('paper orientation, margins, footer, and resolution produce consistent PDF dimensions', () => {
  const metrics = { width: 1280, height: 5120, viewportWidth: 1280, viewportHeight: 720 };
  const portrait = pdfLayout(metrics, defaults);
  const landscape = pdfLayout(metrics, { ...defaults, orientation: 'landscape' });
  near(portrait.pageWidth, landscape.pageHeight, 'Orientation swaps paper width');
  near(portrait.pageHeight, landscape.pageWidth, 'Orientation swaps paper height');
  assert.ok(portrait.pageHeight > portrait.pageWidth);
  assert.ok(portrait.footerHeight > 0);
  near(portrait.contentWidth, portrait.pageWidth - 2 * portrait.margin);
  near(portrait.contentHeight, portrait.pageHeight - 2 * portrait.margin - portrait.footerHeight);
  near(portrait.cssPageHeight, portrait.contentHeight * portrait.width / portrait.contentWidth);
  near(portrait.pixelScale, portrait.canvasWidth / portrait.width);
  assert.equal(portrait.totalPages, Math.ceil(portrait.height / portrait.cssPageHeight));
  assert.equal(portrait.canvasHeight, Math.ceil(portrait.cssPageHeight * portrait.pixelScale));
  const letter = pdfLayout(metrics, { ...defaults, paper: 'letter', margin: 0, footer: false });
  near(letter.pageWidth, 215.9);
  near(letter.pageHeight, 279.4);
  assert.equal(letter.margin, 0);
  assert.equal(letter.footerHeight, 0);
  near(letter.contentWidth, letter.pageWidth);
  near(letter.contentHeight, letter.pageHeight);
  const compact = pdfLayout(metrics, { ...defaults, quality: 'compact' });
  const high = pdfLayout(metrics, { ...defaults, quality: 'high' });
  assert.ok(high.canvasWidth >= portrait.canvasWidth);
  assert.ok(portrait.canvasWidth >= compact.canvasWidth);
});

test('edge captures crop from their clamped viewport without omitting pixels', () => {
  const metrics = { width: 1500, height: 2100, viewportWidth: 1000, viewportHeight: 800 };
  const layout = pdfLayout(metrics, defaults);
  const tile = planTiles(metrics, defaults).at(-1);
  assert.equal(tile.x, 1000);
  assert.equal(tile.y, 1600);
  assert.equal(tile.scrollX, 500);
  assert.equal(tile.scrollY, 1300);
  const slices = tileSlices(tile, layout);
  near(slices.reduce((area, slice) => area + slice.sourceWidth * slice.sourceHeight, 0),
    tile.width * tile.height);
  for (const slice of slices) {
    near(slice.sourceX, tile.x - tile.scrollX);
    assert.ok(slice.sourceY >= tile.y - tile.scrollY);
    assert.ok(slice.sourceX + slice.sourceWidth <= metrics.viewportWidth + epsilon);
    assert.ok(slice.sourceY + slice.sourceHeight <= metrics.viewportHeight + epsilon);
  }
});

test('a capture crossing PDF boundaries divides into complete adjacent page slices', () => {
  const metrics = { width: 1000, height: 6000, viewportWidth: 1000, viewportHeight: 2000 };
  const layout = pdfLayout(metrics, defaults);
  const tile = {
    x: 0, y: layout.cssPageHeight * 0.75, width: 1000,
    height: layout.cssPageHeight * 1.5, scrollX: 0,
    scrollY: layout.cssPageHeight * 0.75, row: 0, lastInRow: true,
  };
  const slices = tileSlices(tile, layout);
  assert.equal(slices.length, 3);
  assert.deepEqual(slices.map(slice => slice.pageIndex), [0, 1, 2]);
  near(slices[0].sourceY, 0);
  for (let index = 1; index < slices.length; index += 1) {
    near(slices[index].sourceY, slices[index - 1].sourceY + slices[index - 1].sourceHeight);
    near(slices[index].destY, 0);
  }
  near(slices.reduce((area, slice) => area + slice.sourceWidth * slice.sourceHeight, 0), tile.width * tile.height);
  for (const slice of slices) {
    near(slice.destX, tile.x * layout.pixelScale);
    near(slice.destWidth, slice.sourceWidth * layout.pixelScale);
    near(slice.destHeight, slice.sourceHeight * layout.pixelScale);
    assert.ok(slice.destY >= 0);
    assert.ok(slice.destY + slice.destHeight <= layout.canvasHeight + epsilon);
  }
});

test('actual capture crop overrides carry through to screenshot source coordinates', () => {
  const metrics = { width: 1500, height: 2100, viewportWidth: 1000, viewportHeight: 800 };
  const layout = pdfLayout(metrics, defaults);
  const tile = { ...planTiles(metrics, defaults).at(-1), cropX: 480, cropY: 290 };
  const slices = tileSlices(tile, layout);
  near(slices[0].sourceX, 480);
  near(slices[0].sourceY, 290);
  near(slices.reduce((sum, slice) => sum + slice.sourceHeight, 0), tile.height);
});

test('export filenames are usable on Windows and have one PDF suffix', () => {
  assert.equal(safeFilename(''), 'PagePress export.pdf');
  assert.equal(safeFilename('   '), 'PagePress export.pdf');
  for (const title of ['A/B\\C:D*E?F"G<H>I|J', 'trailing... ', 'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9']) {
    const filename = safeFilename(title);
    assert.ok(filename.endsWith('.pdf'));
    assert.ok(!/[<>:"/\\|?*\x00-\x1F]/.test(filename));
    assert.ok(!/[. ]$/.test(filename.slice(0, -4)));
    assert.ok(!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename));
  }
  assert.ok(safeFilename('x'.repeat(500)).length <= 150);
  assert.ok(!safeFilename('Report.pdf').endsWith('.pdf.pdf'));
});
