import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

function harness() {
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
  const root = Object.assign(element('static'), { scrollWidth: 800, scrollHeight: 1600, clientWidth: 800, clientHeight: 600, append(node) { this.children.push(node); }, children: [] });
  const body = Object.assign(element('static'), { scrollWidth: 800, scrollHeight: 1600 });
  const events = new Map(), windowEvents = new Map(), timers = new Map();
  let handler, timerId = 0;
  const context = {
    console, Promise, URL,
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 275,
    location: { href: 'https://example.com/article' },
    chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener(listener) { handler = listener; } } } },
    document: { documentElement: root, body, title: 'Article', images: [], createElement: () => element('static'), querySelectorAll: (selector) => selector === 'body *' ? [heading, toolbar, paragraph] : [], addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); } },
    getComputedStyle: (node) => ({ position: node.style.getPropertyValue('position') || node.position, display: node.style.getPropertyValue('display') || 'block', visibility: node.style.getPropertyValue('visibility') || 'visible', overflowX: 'visible', overflowY: 'visible' }),
    setTimeout: (fn, ms) => { const id = ++timerId; if (ms < 90000) timers.set(id, setTimeout(fn, 0)); return id; },
    clearTimeout: (id) => { if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); } },
    requestAnimationFrame: (fn) => fn(),
  };
  context.window = { scrollTo: ({ left, top }) => { context.scrollX = left; context.scrollY = top; }, addEventListener: (name, fn) => windowEvents.set(name, fn), print() {} };
  vm.runInNewContext(source, context);
  const message = (type, values = {}) => new Promise((resolve) => handler({ target: 'content', type, ...values }, {}, resolve));
  return { context, heading, toolbar, paragraph, root, events, message };
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
