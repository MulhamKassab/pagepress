import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

function harness(config = {}) {
  class Style {
    values = new Map();
    getPropertyValue(name) { return this.values.get(name)?.value || ''; }
    getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
    setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
    removeProperty(name) { this.values.delete(name); }
  }
  const element = (position, top = 0) => ({ style: new Style(), dataset: {}, position, top, attributes: new Map(), getBoundingClientRect() { return { top: this.top, bottom: this.top + 50, left: 0, right: 800, width: 800, height: 50 }; }, getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }, setAttribute(name, value) { this.attributes.set(name, value); }, removeAttribute(name) { this.attributes.delete(name); }, remove() { this.removed = true; } });
  const heading = element('sticky', 1100), toolbar = element('fixed', 0), paragraph = element('static', 1200);
  heading.style.setProperty('top', '24px', 'important');
  const root = Object.assign(element('static'), { scrollWidth: 800, scrollHeight: 1600, clientWidth: 800, clientHeight: 600, ...(config.root || {}), append(node) { this.children.push(node); }, children: [] });
  const body = Object.assign(element('static'), { scrollWidth: 800, scrollHeight: 1600 });
  const events = new Map(), windowEvents = new Map(), timers = new Map();
  let handler, timerId = 0;
  const context = {
    console, Promise, URL,
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 275,
    location: { href: 'https://example.com/article' },
    chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener(listener) { handler = listener; } } } },
    document: { documentElement: root, body, title: 'Article', images: [], createElement: () => element('static'), querySelectorAll: (selector) => selector === 'body *' ? [heading, toolbar, paragraph, ...(config.elements || [])] : [], addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); } },
    getComputedStyle: (node) => ({ position: node.style.getPropertyValue('position') || node.position, display: node.style.getPropertyValue('display') || 'block', visibility: node.style.getPropertyValue('visibility') || 'visible', overflowX: 'visible', overflowY: node.overflowY || 'visible', direction: node.direction || (node === root && config.rtl ? 'rtl' : 'ltr') }),
    setTimeout: (fn, ms) => { const id = ++timerId; if (ms < 90000) timers.set(id, setTimeout(fn, 0)); return id; },
    clearTimeout: (id) => { if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); } },
    requestAnimationFrame: (fn) => fn(),
  };
  context.window = { scrollTo: ({ left, top }) => { const min = config.rtl ? -(root.scrollWidth - root.clientWidth) : 0; context.scrollX = Math.min(0 + (config.rtl ? 0 : Infinity), Math.max(min, left)); context.scrollY = top; }, addEventListener: (name, fn) => windowEvents.set(name, fn), print() {} };
  vm.runInNewContext(source, context);
  const message = (type, values = {}) => new Promise((resolve) => handler({ target: 'content', type, ...values }, {}, resolve));
  return { context, heading, toolbar, paragraph, root, body, events, message, element };
}

test('sticky content below the first view remains in flow and visible on later captures', async () => {
  const page = harness();
  const prepare = await page.message('PREPARE', { options: { hideSticky: true, loadImages: false, scope: 'full' } });
  assert.equal(prepare.ok, true);
  assert.equal(page.heading.style.getPropertyValue('position'), 'relative');
  assert.equal(page.heading.style.getPropertyValue('top'), 'auto');
  assert.equal(page.heading.style.getPropertyPriority('position'), 'important');
  assert.equal(page.heading.style.getPropertyValue('visibility'), '');
  const moved = await page.message('MOVE', { x: 0, y: 1000, hideSticky: true, scope: 'full' });
  assert.equal(moved.ok, true);
  assert.equal(page.heading.style.getPropertyValue('visibility'), '', 'a later sticky heading must never disappear');
  assert.equal(page.toolbar.style.getPropertyValue('visibility'), 'hidden', 'fixed overlays disappear after their first capture');
  await page.message('RESTORE');
  assert.equal(page.heading.style.getPropertyValue('position'), '');
  assert.equal(page.heading.style.getPropertyValue('top'), '24px');
  assert.equal(page.heading.style.getPropertyPriority('top'), 'important');
  assert.equal(page.toolbar.style.getPropertyValue('visibility'), '');
  assert.equal(page.context.scrollY, 275, 'the original scroll position is restored');
  assert.ok(page.root.children.every((style) => style.removed));
});

test('disabled sticky cleanup preserves site positioning and selected element styles restore', async () => {
  const page = harness();
  page.paragraph.style.setProperty('display', 'flex', 'important');
  await page.message('SELECT');
  let prevented = false;
  page.events.get('click')({ target: page.paragraph, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  assert.equal(page.paragraph.style.getPropertyValue('display'), 'none');
  await page.message('PREPARE', { options: { hideSticky: false, loadImages: false, scope: 'full' } });
  assert.equal(page.heading.style.getPropertyValue('position'), '');
  assert.equal(page.heading.style.getPropertyValue('top'), '24px');
  assert.equal(page.events.has('click'), false, 'selection listeners stop during capture');
  await page.message('RESTORE', { reset: true });
  assert.equal(page.paragraph.style.getPropertyValue('display'), 'flex');
  assert.equal(page.paragraph.style.getPropertyPriority('display'), 'important');
});

test('current view preserves sticky positioning at an existing scroll position', async () => {
  const page = harness();
  const result = await page.message('PREPARE', { options: { hideSticky: true, loadImages: false, scope: 'viewport' } });
  assert.equal(result.ok, true);
  assert.equal(page.context.scrollY, 275);
  assert.equal(page.heading.style.getPropertyValue('position'), '');
  assert.equal(page.heading.style.getPropertyValue('top'), '24px');
  assert.equal(result.data.height, 600);
  await page.message('RESTORE');
});

test('right-to-left pages scroll to negative native positions but report left-to-right x', async () => {
  const page = harness({ rtl: true, root: { scrollWidth: 1800, clientWidth: 1000 } });
  page.context.scrollX = 0;
  const prepare = await page.message('PREPARE', { options: { hideSticky: false, loadImages: false, scope: 'full' } });
  assert.equal(prepare.ok, true, prepare.error);
  assert.equal(prepare.data.rtl, true);
  assert.equal(prepare.data.scrollX, 800, 'the initial right edge is x = 800 in the left-to-right plan');
  const left = await page.message('MOVE', { x: 0, y: 0, hideSticky: false, scope: 'full' });
  assert.equal(page.context.scrollX, -800, 'plan x 0 is the left edge of the page');
  assert.equal(left.data.x, 0);
  const right = await page.message('MOVE', { x: 800, y: 0, hideSticky: false, scope: 'full' });
  assert.equal(page.context.scrollX, 0);
  assert.equal(right.data.x, 800);
  assert.equal((await page.message('METRICS')).data.scrollX, 800);
  await page.message('RESTORE');
  assert.equal(page.context.scrollX, 0, 'the original native position is restored');
});

test('a left-to-right page keeps its scroll positions unchanged', async () => {
  const page = harness({ root: { scrollWidth: 1800, clientWidth: 1000 } });
  const prepare = await page.message('PREPARE', { options: { hideSticky: false, loadImages: false, scope: 'full' } });
  assert.equal(prepare.data.rtl, false);
  const moved = await page.message('MOVE', { x: 800, y: 0, hideSticky: false, scope: 'full' });
  assert.equal(page.context.scrollX, 800);
  assert.equal(moved.data.x, 800);
});

function panelPage(overrides = {}) {
  const page = harness({ root: { scrollHeight: 600, clientHeight: 600 }, elements: [] });
  const scrolls = [];
  const panel = Object.assign(page.element('static'), { overflowY: 'auto', scrollWidth: 700, clientWidth: 700, scrollHeight: 4000, clientHeight: 500, scrollTop: 0, scrollLeft: 0, clientLeft: 0, clientTop: 0,
    getBoundingClientRect() { return { left: 100, top: 60, right: 780, bottom: 560, width: 680, height: 500 }; },
    scrollTo({ left, top }) { scrolls.push([left, top]); this.scrollLeft = left; this.scrollTop = top; }, ...overrides });
  page.body.scrollHeight = 600;
  const original = page.context.document.querySelectorAll;
  page.context.document.querySelectorAll = (selector) => [...original(selector), ...(selector === 'body *' ? [panel] : [])];
  return { ...page, panel, scrolls };
}

test('content that scrolls inside a panel is captured through that panel', async () => {
  const page = panelPage();
  const prepare = await page.message('PREPARE', { options: { hideSticky: true, loadImages: false, scope: 'full' } });
  assert.equal(prepare.ok, true, prepare.error);
  assert.equal(prepare.data.scroller, true);
  assert.deepEqual([prepare.data.width, prepare.data.height, prepare.data.viewportWidth, prepare.data.viewportHeight], [700, 4000, 700, 500]);
  assert.deepEqual([prepare.data.originX, prepare.data.originY], [100, 60], 'where the panel sits in the screenshot');
  const moved = await page.message('MOVE', { x: 0, y: 1500, hideSticky: true, scope: 'full' });
  assert.equal(page.panel.scrollTop, 1500);
  assert.equal(moved.data.y, 1500);
  assert.equal(page.context.scrollY, 275, 'the page itself does not move');
  await page.message('RESTORE');
  assert.equal(page.panel.scrollTop, 0, 'the panel returns to its original position');
  assert.equal(page.panel.style.getPropertyValue('scroll-behavior'), '');
});

test('a panel that cannot be captured in one piece is refused instead of exporting one screen', async () => {
  const page = panelPage({ getBoundingClientRect() { return { left: 100, top: 60, right: 780, bottom: 1400, width: 680, height: 1340 }; } });
  const prepare = await page.message('PREPARE', { options: { hideSticky: true, loadImages: false, scope: 'full' } });
  assert.equal(prepare.ok, false);
  assert.match(prepare.error, /Current view or Print/);
});

test('a small scrollable box on an otherwise one-screen page is not treated as the page', async () => {
  const page = panelPage({ clientHeight: 100, scrollHeight: 150, clientWidth: 100, scrollWidth: 100 });
  const prepare = await page.message('PREPARE', { options: { hideSticky: true, loadImages: false, scope: 'full' } });
  assert.equal(prepare.ok, true, prepare.error);
  assert.equal(prepare.data.scroller, false);
});

const prepareOptions = { hideSticky: true, loadImages: false, scope: 'full' };

test('a PDF shown by the browser is refused with a clear message instead of a one-screen screenshot', async () => {
  const page = harness();
  page.context.document.contentType = 'application/pdf';
  const prepare = await page.message('PREPARE', { options: prepareOptions });
  assert.equal(prepare.ok, false);
  assert.match(prepare.error, /PDF file.*download button/);
});

test('fixed elements inside shadow roots are hidden like ordinary ones and restored afterwards', async () => {
  const page = harness({ elements: [] });
  const shadowFixed = page.element('fixed');
  const host = Object.assign(page.element('static'), { shadowRoot: { querySelectorAll: (selector) => (selector === '*' ? [shadowFixed] : []) } });
  const original = page.context.document.querySelectorAll;
  page.context.document.querySelectorAll = (selector) => [...original(selector), ...(selector === 'body *' ? [host] : [])];
  await page.message('PREPARE', { options: prepareOptions });
  await page.message('MOVE', { x: 0, y: 1000, hideSticky: true, scope: 'full' });
  assert.equal(shadowFixed.style.getPropertyValue('visibility'), 'hidden');
  await page.message('RESTORE');
  assert.equal(shadowFixed.style.getPropertyValue('visibility'), '');
});

test('fixed elements are collected once and re-scanned only after the page changed', async () => {
  const page = harness();
  let trigger;
  page.context.MutationObserver = class { constructor(callback) { trigger = callback; } observe() {} disconnect() {} };
  const calls = [];
  const original = page.context.getComputedStyle;
  page.context.getComputedStyle = (node) => { calls.push(node); return original(node); };
  await page.message('PREPARE', { options: prepareOptions });
  await page.message('MOVE', { x: 0, y: 600, hideSticky: true, scope: 'full' });
  assert.ok(calls.includes(page.paragraph), 'the first move scans everything');
  calls.length = 0;
  await page.message('MOVE', { x: 0, y: 1000, hideSticky: true, scope: 'full' });
  assert.ok(!calls.includes(page.paragraph) && !calls.includes(page.heading), 'later moves only re-check known fixed elements');
  trigger([{ attributeName: 'class', target: page.paragraph }]);
  calls.length = 0;
  await page.message('MOVE', { x: 0, y: 1000, hideSticky: true, scope: 'full' });
  assert.ok(calls.includes(page.paragraph), 'a class change on the page triggers a new scan');
  await page.message('RESTORE');
});

test('keyboard picking: Tab and arrows move the outline, Enter hides, Escape stops, and a hint bar explains it', async () => {
  const page = harness();
  const created = [];
  const createElement = page.context.document.createElement;
  page.context.document.createElement = (tag) => { const node = createElement(tag); created.push(node); return node; };
  page.heading.nextElementSibling = page.toolbar;
  await page.message('SELECT');
  const [overlay, hint] = created;
  assert.match(hint.textContent, /Tab and the arrow keys.*Enter.*Escape/);
  assert.equal(hint.attributes.get('role'), 'status');
  assert.equal(hint.dataset.pagepress, 'hint');
  const press = (key, extra = {}) => { let prevented = false; page.events.get('keydown')({ key, preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...extra }); return prevented; };
  assert.equal(press('Tab'), true);
  assert.equal(overlay.style.display, 'block', 'the first Tab outlines the first element');
  assert.match(hint.textContent, /Selected: /);
  assert.equal(press('ArrowRight'), true);
  assert.equal(press('Enter'), true);
  assert.equal(page.toolbar.style.getPropertyValue('display'), 'none', 'the outlined element was hidden');
  assert.equal(page.heading.style.getPropertyValue('display'), '');
  assert.equal(press('Escape'), true);
  assert.equal(hint.removed, true);
  assert.equal(overlay.removed, true);
  assert.equal(page.events.has('keydown'), false, 'the keyboard handler is removed');
  const undone = await page.message('UNDO');
  assert.equal(undone.data.count, 0);
  assert.equal(page.toolbar.style.getPropertyValue('display'), '');
});

test('clean print hides site navigation but keeps navigation inside the article', async () => {
  const page = harness({ elements: [] });
  const site = Object.assign(page.element('static'), { matches: () => true, closest: () => null });
  const inArticle = Object.assign(page.element('static'), { matches: () => true, closest: () => ({}) });
  const original = page.context.document.querySelectorAll;
  page.context.document.querySelectorAll = (selector) => [...original(selector), ...(selector === 'body *' ? [site, inArticle] : [])];
  const printed = await page.message('PRINT', { options: { cleanPrint: true, paper: 'a4', orientation: 'portrait', margin: 12 } });
  assert.equal(printed.ok, true, printed.error);
  assert.equal(site.getAttribute('data-pagepress-hide'), '');
  assert.equal(inArticle.getAttribute('data-pagepress-hide'), null, 'a table of contents inside the article is kept');
  await page.message('RESTORE');
  assert.equal(site.getAttribute('data-pagepress-hide'), null);
});

test('images that start loading as they scroll into view are awaited before the screenshot', async () => {
  const page = harness();
  const image = Object.assign(page.element('static'), { complete: false, async decode() { await new Promise((resolve) => setTimeout(resolve, 40)); image.complete = true; } });
  await page.message('PREPARE', { options: { ...prepareOptions, loadImages: false } });
  page.context.document.images.push(image);
  await page.message('MOVE', { x: 0, y: 600, hideSticky: false, scope: 'full' });
  assert.equal(image.complete, true);
});

test('native lazy images are switched to eager while loading images, then put back', async () => {
  const page = harness();
  const image = Object.assign(page.element('static'), { complete: true });
  image.setAttribute('loading', 'lazy');
  page.context.document.images.push(image);
  await page.message('PREPARE', { options: { ...prepareOptions, loadImages: true } });
  assert.equal(image.getAttribute('loading'), 'eager');
  await page.message('RESTORE');
  assert.equal(image.getAttribute('loading'), 'lazy');
});

test('an anchor near the middle of the first screen reports how far the page content moved', async () => {
  const page = harness();
  let moved = 0;
  const anchor = Object.assign(page.element('static'), { isConnected: true, parentElement: null, getBoundingClientRect() { return { left: 0, right: 800, width: 800, height: 50, top: 300 - page.context.scrollY + moved, bottom: 350 }; } });
  page.context.document.elementFromPoint = () => anchor;
  await page.message('PREPARE', { options: prepareOptions });
  const steady = await page.message('MOVE', { x: 0, y: 1000, hideSticky: false, scope: 'full' });
  assert.equal(steady.data.anchorShift, 0);
  moved = -80;
  const shifted = await page.message('MOVE', { x: 0, y: 920, hideSticky: false, scope: 'full' });
  assert.equal(shifted.data.anchorShift, -80);
  anchor.isConnected = false;
  assert.equal((await page.message('MOVE', { x: 0, y: 920, hideSticky: false, scope: 'full' })).data.anchorShift, null);
});

test('a new extension version replaces a stale copy of the script; the same version does not register twice', async () => {
  const page = harness();
  const registered = [];
  page.context.chrome.runtime.onMessage.addListener = (listener) => registered.push(listener);
  page.context.chrome.runtime.id = 'webtopdf-test';
  page.context.chrome.runtime.getManifest = () => ({ version: '1.2.0' });
  vm.runInContext(source, page.context);
  assert.equal(registered.length, 1);
  vm.runInContext(source, page.context);
  assert.equal(registered.length, 1, 'same version: already installed');
  page.context.chrome.runtime.getManifest = () => ({ version: '1.2.1' });
  vm.runInContext(source, page.context);
  assert.equal(registered.length, 2, 'new version: install again');
});
