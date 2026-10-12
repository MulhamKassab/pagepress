import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { normalizeOptions, planTiles, pdfLayout } from '../extension/lib/geometry.js';

// A valid white 1 × 1 JPEG. Drawing is tracked separately; jsPDF receives real image bytes.
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

const canvases = [];
const bitmaps = [];
const createdURLs = new Map();
const revokedURLs = [];
let listener;
let nextURL = 0;
const previous = {};
const runtimeID = 'pagepress-test-extension';
const metrics = { width: 1500, height: 5500, viewportWidth: 1000, viewportHeight: 800 };
const options = normalizeOptions({});
const meta = { title: 'PagePress PDF integration', url: 'https://example.com/article', date: '2026-10-12T08:00:00.000Z' };

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)),
    `${message}: expected ${expected}, got ${actual}`);
}

function send(message) {
  return new Promise(resolve => {
    assert.equal(listener({ target: 'offscreen', ...message }, { id: runtimeID }, resolve), true,
      'The offscreen listener keeps the response channel open');
  });
}

async function begin() {
  const layout = pdfLayout(metrics, options);
  const result = await send({ type: 'BEGIN', layout, options, meta });
  assert.equal(result.ok, true, result.error);
  return layout;
}

async function capture(tile) {
  const result = await send({
    type: 'TILE', image: jpeg, tile,
    innerWidth: metrics.viewportWidth, innerHeight: metrics.viewportHeight,
  });
  assert.equal(result.ok, true, result.error);
  return result.data;
}

before(async () => {
  for (const key of ['chrome', 'document', 'jspdf', 'createImageBitmap']) previous[key] = globalThis[key];
  previous.createObjectURL = URL.createObjectURL;
  previous.revokeObjectURL = URL.revokeObjectURL;
  globalThis.chrome = {
    runtime: { id: runtimeID, onMessage: { addListener(value) { listener = value; } } },
  };
  globalThis.jspdf = { jsPDF };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, draws: [], encoded: [] };
      const context = {
        fillRect(x, y, width, height) { canvas.background = { x, y, width, height }; },
        drawImage(...args) { canvas.draws.push(args); },
      };
      canvas.getContext = type => { assert.equal(type, '2d'); return context; };
      canvas.toDataURL = (type, quality) => {
        canvas.encoded.push({ type, quality, width: canvas.width, height: canvas.height });
        assert.equal(type, 'image/jpeg');
        return jpeg;
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  globalThis.createImageBitmap = async blob => {
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'image/jpeg');
    const bitmap = { width: 2000, height: 1600, closed: 0, close() { this.closed += 1; } };
    bitmaps.push(bitmap);
    return bitmap;
  };
  URL.createObjectURL = blob => {
    const url = `blob:pagepress-test/${++nextURL}`;
    createdURLs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = url => { revokedURLs.push(url); };
  await import('../extension/offscreen.js');
  assert.equal(typeof listener, 'function');
});

beforeEach(async () => {
  await send({ type: 'ABORT' });
  canvases.length = 0;
  bitmaps.length = 0;
  createdURLs.clear();
  revokedURLs.length = 0;
});

after(async () => {
  await send({ type: 'ABORT' });
  for (const key of ['chrome', 'document', 'jspdf', 'createImageBitmap']) {
    if (previous[key] === undefined) delete globalThis[key];
    else globalThis[key] = previous[key];
  }
  URL.createObjectURL = previous.createObjectURL;
  URL.revokeObjectURL = previous.revokeObjectURL;
});

test('wide-page captures assemble into a real three-page PDF and release resources', async () => {
  const layout = await begin();
  assert.equal(layout.totalPages, 3);
  const tiles = planTiles(metrics, options);
  assert.equal(tiles.length, 14);
  let previousFinished = 0;
  for (const tile of tiles) {
    const response = await capture(tile);
    assert.ok(response.pagesFinished >= previousFinished, 'Completed page count only increases');
    previousFinished = response.pagesFinished;
  }
  const result = await send({ type: 'FINISH' });
  assert.equal(result.ok, true, result.error);
  const blob = createdURLs.get(result.data.url);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(result.data.bytes, blob.size);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const pdf = bytes.toString('latin1');
  assert.match(pdf, /^%PDF-1\.[0-9]/);
  assert.match(pdf, /%%EOF\s*$/);
  assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 3, 'The PDF contains three page dictionaries');
  assert.match(pdf, /\/Count 3\b/);
  assert.match(pdf, /\/Title \(PagePress PDF integration\)/);
  assert.match(pdf, /\/Subject \(Visual webpage capture\)/);
  assert.ok(pdf.includes('/Subtype /Image'), 'Actual image data is embedded in the PDF');
  assert.equal(canvases.length, 3);
  assert.equal(bitmaps.length, tiles.length);
  assert.ok(bitmaps.every(bitmap => bitmap.closed === 1), 'Every decoded screenshot is closed once');
  assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1), 'Flushed canvases release their raster allocation');
  assert.ok(canvases.every(canvas => canvas.encoded.length === 1), 'Each PDF page is encoded once');

  const draws = canvases.flatMap(canvas => canvas.draws);
  let sourceArea = 0;
  let destinationArea = 0;
  for (const [bitmap, sx, sy, sw, sh, dx, dy, dw, dh] of draws) {
    assert.ok(sx >= 0 && sy >= -1e-6, 'Source crop starts inside the captured screen');
    assert.ok(sx + sw <= bitmap.width + 1e-6 && sy + sh <= bitmap.height + 1e-6,
      'Clamped-edge crops stay inside the captured screen');
    assert.ok(dx >= 0 && dy >= -1e-6);
    assert.ok(dx + dw <= layout.canvasWidth + 1e-6);
    assert.ok(dy + dh <= layout.canvasHeight + 1e-6);
    sourceArea += sw * sh;
    destinationArea += dw * dh;
  }
  near(sourceArea / 4, metrics.width * metrics.height, 'Retina source crops cover all document pixels once');
  near(destinationArea, metrics.width * metrics.height * layout.pixelScale ** 2,
    'PDF page draws preserve the complete document area');
  assert.ok(draws.some(([, sx]) => sx === 1000), 'The final horizontal tile uses the cropped clamped screenshot');

  const release = await send({ type: 'RELEASE', url: result.data.url });
  assert.equal(release.ok, true, release.error);
  assert.deepEqual(revokedURLs, [result.data.url]);
  const lateCapture = await send({ type: 'TILE', image: jpeg, tile: tiles[0], innerWidth: 1000, innerHeight: 800 });
  assert.equal(lateCapture.ok, false);
  assert.match(lateCapture.error, /session ended/i);
  assert.equal(bitmaps.length, tiles.length, 'An ended session never decodes another screenshot');
});

test('finishing incomplete capture reports a missing page without publishing a PDF', async () => {
  await begin();
  await capture(planTiles(metrics, options)[0]);
  const result = await send({ type: 'FINISH' });
  assert.equal(result.ok, false);
  assert.match(result.error, /page is missing/i);
  assert.equal(createdURLs.size, 0, 'Partial exports never produce a download URL');
  assert.ok(bitmaps.every(bitmap => bitmap.closed === 1));
});

test('abort frees pending page canvases and prevents additional capture work', async () => {
  await begin();
  await capture(planTiles(metrics, options)[0]);
  assert.equal(canvases.length, 1);
  assert.ok(canvases[0].width > 1 && canvases[0].height > 1);
  const aborted = await send({ type: 'ABORT' });
  assert.equal(aborted.ok, true, aborted.error);
  assert.equal(canvases[0].width, 1);
  assert.equal(canvases[0].height, 1);
  const finished = await send({ type: 'FINISH' });
  assert.equal(finished.ok, false);
  assert.match(finished.error, /session ended/i);
  assert.equal(createdURLs.size, 0);
});

test('the offscreen processor ignores messages outside its extension and target', () => {
  let responded = false;
  const respond = () => { responded = true; };
  assert.equal(listener({ target: 'offscreen', type: 'BEGIN' }, { id: 'another-extension' }, respond), undefined);
  assert.equal(listener({ target: 'popup', type: 'BEGIN' }, { id: runtimeID }, respond), undefined);
  assert.equal(responded, false);
});
