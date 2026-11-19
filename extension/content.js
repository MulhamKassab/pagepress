(() => {
  if (globalThis.__PAGEPRESS_CONTENT__) return;
  globalThis.__PAGEPRESS_CONTENT__ = true;
  const hidden = new Map();
  const sticky = new Map();
  let capture = null, selecting = false, overlay = null, printStyle = null, watchdog = null;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const snapshot = (element, property) => ({ value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
  const restoreProperty = (element, property, original) => { if (original.value) element.style.setProperty(property, original.value, original.priority); else element.style.removeProperty(property); };
  // Same behaviour as t() in lib/i18n.js (a classic script cannot import it).
  const t = (key, fallback, substitutions = []) => {
    const values = (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
    try { const message = globalThis.chrome?.i18n?.getMessage?.(key, values); if (message) return message; } catch { /* use the English text */ }
    return String(fallback).replace(/\$(\d)/g, (match, index) => (values[index - 1] ?? match));
  };
  // Horizontal scrolling in right-to-left boxes runs from 0 (right edge) to a negative
  // maximum. The capture plan uses a left-to-right x (0 = left edge), so convert here.
  const isRtl = (element) => { try { return getComputedStyle(element).direction === 'rtl'; } catch { return false; } };
  const maxScrollX = (element) => Math.max(0, element.scrollWidth - element.clientWidth);
  // The element that scrolls during a capture: the page, or an inner panel (WT-01).
  const metrics = () => {
    const root = document.documentElement, body = document.body, panel = capture?.scroller || null;
    const base = panel
      ? { width: Math.max(panel.scrollWidth, panel.clientWidth), height: Math.max(panel.scrollHeight, panel.clientHeight), viewportWidth: panel.clientWidth, viewportHeight: panel.clientHeight }
      : { width: Math.max(root.scrollWidth, body?.scrollWidth || 0, root.clientWidth), height: Math.max(root.scrollHeight, body?.scrollHeight || 0, root.clientHeight), viewportWidth: root.clientWidth, viewportHeight: root.clientHeight };
    const box = panel || root, rtl = isRtl(box);
    const nativeX = panel ? panel.scrollLeft : scrollX, nativeY = panel ? panel.scrollTop : scrollY;
    let originX = 0, originY = 0;
    if (panel) { const rect = panel.getBoundingClientRect(); originX = rect.left + panel.clientLeft; originY = rect.top + panel.clientTop; }
    // A right-to-left page puts its vertical scrollbar on the left of the screenshot.
    else if (rtl) originX = Math.max(0, innerWidth - root.clientWidth);
    return { ...base, innerWidth, innerHeight, devicePixelRatio, title: document.title, url: location.href, scrollX: rtl ? nativeX + maxScrollX(box) : nativeX, scrollY: nativeY, rtl, originX, originY };
  };
  // Scroll the page (or the inner panel) to a left-to-right x and a y.
  function scrollView(x, y) {
    const panel = capture?.scroller || null, box = panel || document.documentElement;
    const left = isRtl(box) ? x - maxScrollX(box) : x;
    if (panel) panel.scrollTo({ left, top: y, behavior: 'instant' });
    else window.scrollTo({ left, top: y, behavior: 'instant' });
  }
  // Pages whose content scrolls inside a panel (body fixed at 100vh) have a document
  // that is only one screen tall. Find the main panel; refuse when it cannot be captured.
  function findScroller() {
    const root = document.documentElement, probe = metrics();
    if (probe.height > probe.viewportHeight + 4) return null;
    const viewportArea = probe.viewportWidth * probe.viewportHeight;
    let best = null;
    for (const element of [document.body, ...document.querySelectorAll('body *')]) {
      if (!element || element === root || element.dataset?.pagepress) continue;
      const computed = getComputedStyle(element);
      if (!/(auto|scroll|overlay)/.test(computed.overflowY) || computed.display === 'none' || computed.visibility === 'hidden') continue;
      const extra = element.scrollHeight - element.clientHeight, area = element.clientWidth * element.clientHeight;
      if (extra < Math.max(100, element.clientHeight * 0.25) || area < viewportArea * 0.3) continue;
      if (!best || area > best.area || (area === best.area && extra > best.extra)) best = { element, area, extra };
    }
    if (!best) return null;
    const rect = best.element.getBoundingClientRect();
    if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) {
      throw new Error(t('errorScrollPanel', 'This page scrolls inside a panel that webTopdf can’t capture in one piece. Use Current view or Print instead.'));
    }
    return best.element;
  }
  function announce() { chrome.runtime.sendMessage({ target: 'background', type: 'SELECTION_CHANGED', count: hidden.size, selecting }).catch(() => {}); }
  function endSelection() {
    selecting = false;
    document.removeEventListener('mousemove', hover, true);
    document.removeEventListener('click', pick, true);
    document.removeEventListener('keydown', escape, true);
    overlay?.remove(); overlay = null;
    announce();
  }
  function hover(event) {
    if (!overlay || event.target === document.documentElement || event.target === document.body) { if (overlay) overlay.style.display = 'none'; return; }
    const rect = event.target.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function pick(event) {
    if (event.target === document.documentElement || event.target === document.body) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!hidden.has(event.target)) hidden.set(event.target, snapshot(event.target, 'display'));
    event.target.style.setProperty('display', 'none', 'important');
    if (overlay) overlay.style.display = 'none';
    announce();
  }
  function escape(event) { if (event.key === 'Escape') { event.preventDefault(); endSelection(); } }
  function select() {
    if (capture) throw new Error('Wait for the current export to finish.');
    endSelection(); selecting = true;
    overlay = document.createElement('div'); overlay.dataset.pagepress = 'selection';
    Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #4c75ee', background: 'rgba(76,117,238,.13)', boxSizing: 'border-box', display: 'none' });
    document.documentElement.append(overlay);
    document.addEventListener('mousemove', hover, true); document.addEventListener('click', pick, true); document.addEventListener('keydown', escape, true);
    announce(); return { count: hidden.size, selecting: true };
  }
  function undo() {
    const entries = [...hidden.entries()], last = entries.at(-1);
    if (last) { restoreProperty(last[0], 'display', last[1]); hidden.delete(last[0]); }
    announce(); return { count: hidden.size };
  }
  function resetHidden() { for (const [element, original] of hidden) restoreProperty(element, 'display', original); hidden.clear(); announce(); }
  function refreshWatchdog() {
    clearTimeout(watchdog); watchdog = setTimeout(() => restore(true), 90000);
  }
  function restore(reset = true) {
    clearTimeout(watchdog); watchdog = null;
    endSelection();
    for (const [element, original] of sticky) restoreProperty(element, 'visibility', original);
    sticky.clear();
    printStyle?.remove(); printStyle = null;
    if (capture) {
      capture.style.remove();
      for (const [element, property, original] of capture.changed) restoreProperty(element, property, original);
      for (const [element, attribute, original] of capture.attributes || []) { if (original === null) element.removeAttribute(attribute); else element.setAttribute(attribute, original); }
      for (const [element, open] of capture.details) element.open = open;
      window.scrollTo({ left: capture.x, top: capture.y, behavior: 'instant' });
      capture.scroller?.scrollTo({ left: capture.scrollerX, top: capture.scrollerY, behavior: 'instant' });
      capture = null;
    }
    if (reset) resetHidden();
    return { restored: true, count: hidden.size };
  }
  async function begin(options) {
    if (capture) restore(false);
    endSelection();
    const style = document.createElement('style');
    style.dataset.pagepress = 'capture';
    style.textContent = 'html { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; } * { animation-play-state: paused !important; transition: none !important; scroll-snap-align: none !important; }';
    capture = { x: scrollX, y: scrollY, style, changed: [], details: [] };
    document.documentElement.append(style); refreshWatchdog();
    // Sticky content belongs to the document. Keep every heading in its original
    // flow, including headings below the first viewport, while removing stickiness.
    if (options.hideSticky && options.scope === 'full') for (const element of document.querySelectorAll('body *')) {
      if (getComputedStyle(element).position !== 'sticky') continue;
      for (const property of ['position', 'top', 'right', 'bottom', 'left']) {
        capture.changed.push([element, property, snapshot(element, property)]);
        element.style.setProperty(property, property === 'position' ? 'relative' : 'auto', 'important');
      }
    }
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, pause(1500)]);
    if (options.scope === 'full') {
      const panel = findScroller();
      if (panel) {
        capture.scroller = panel; capture.scrollerX = panel.scrollLeft; capture.scrollerY = panel.scrollTop;
        for (const property of ['scroll-behavior', 'overflow-anchor']) {
          capture.changed.push([panel, property, snapshot(panel, property)]);
          panel.style.setProperty(property, property === 'scroll-behavior' ? 'auto' : 'none', 'important');
        }
      }
    }
    if (options.loadImages && options.scope === 'full') {
      const initial = metrics();
      const steps = Math.min(16, Math.ceil(initial.height / initial.viewportHeight));
      for (let step = 0; step < steps; step++) {
        if (!capture) throw new Error('Capture preparation was canceled.');
        scrollView(0, Math.min(step * initial.viewportHeight, initial.height - initial.viewportHeight));
        await pause(150);
      }
      window.scrollTo({ top: capture.y, left: capture.x, behavior: 'instant' });
      capture.scroller?.scrollTo({ left: capture.scrollerX, top: capture.scrollerY, behavior: 'instant' });
      await pause(200);
    }
    const visibleImages = [...document.images].filter((image) => { const rect = image.getBoundingClientRect(); return !image.complete && rect.top < innerHeight && rect.bottom > 0; });
    if (visibleImages.length) await Promise.race([Promise.allSettled(visibleImages.map((image) => image.decode())), pause(1000)]);
    const result = metrics();
    if (options.scope === 'viewport') { result.width = result.viewportWidth; result.height = result.viewportHeight; }
    result.scroller = !!capture.scroller;
    return result;
  }
  function hideFixed() {
    for (const element of document.querySelectorAll('body *')) {
      if (element.dataset.pagepress || sticky.has(element)) continue;
      const computed = getComputedStyle(element);
      if (computed.position === 'fixed' && computed.visibility !== 'hidden' && computed.display !== 'none') {
        sticky.set(element, snapshot(element, 'visibility'));
        element.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }
  async function move(message) {
    if (!capture) throw new Error('The page capture session ended. Please export again.');
    refreshWatchdog();
    if (message.hideSticky) hideFixed();
    if (message.scope !== 'viewport') scrollView(message.x, message.y);
    await pause(180);
    // A header that only turns fixed because of this scroll must be hidden too.
    if (message.hideSticky) hideFixed();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const current = metrics();
    return { ...current, x: current.scrollX, y: current.scrollY };
  }
  function print(options) {
    if (capture) restore(false);
    endSelection();
    const style = document.createElement('style');
    capture = { x: scrollX, y: scrollY, style, changed: [], details: [], attributes: [] };
    printStyle = style;
    const size = options.paper === 'letter' ? 'letter' : 'A4';
    style.textContent = `@page { size: ${size} ${options.orientation}; margin: ${options.margin}mm; } @media print { ${options.cleanPrint ? 'html, body { height: auto !important; overflow: visible !important; } [data-pagepress-unclip], main, article, section { height: auto !important; max-height: none !important; overflow: visible !important; } [data-pagepress-unclip] { -webkit-line-clamp: unset !important; line-clamp: unset !important; text-overflow: clip !important; } [data-pagepress-static] { position: static !important; } nav, [role="navigation"], .cookie-banner, .cookie-consent { display: none !important; }' : ''} * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.documentElement.append(style);
    if (options.cleanPrint) {
      for (const details of document.querySelectorAll('details')) { capture.details.push([details, details.open]); details.open = true; }
      for (const element of document.querySelectorAll('body *')) {
        const computed = getComputedStyle(element);
        if (/(auto|scroll|hidden|clip)/.test(`${computed.overflowX} ${computed.overflowY}`) && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)) {
          capture.attributes.push([element, 'data-pagepress-unclip', element.getAttribute('data-pagepress-unclip')]); element.setAttribute('data-pagepress-unclip', '');
        }
        if (computed.position === 'fixed' || computed.position === 'sticky') { capture.attributes.push([element, 'data-pagepress-static', element.getAttribute('data-pagepress-static')]); element.setAttribute('data-pagepress-static', ''); }
      }
    }
    refreshWatchdog();
    window.addEventListener('afterprint', () => restore(true), { once: true });
    setTimeout(() => { try { window.print(); } catch { restore(true); } }, 120);
    return { printing: true };
  }
  window.addEventListener('pagehide', () => restore(true));
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.target !== 'content') return;
    const operations = { PREPARE: () => begin(message.options), MOVE: () => move(message), RESTORE: () => restore(message.reset !== false), SELECT: select, UNDO: undo, RESET: () => { endSelection(); resetHidden(); return { count: 0 }; }, PRINT: () => print(message.options), METRICS: metrics, ALIVE: () => ({ capturing: !!capture }) };
    const operation = operations[message.type];
    if (!operation) return;
    Promise.resolve().then(operation).then((data) => respond({ ok: true, data }), (error) => respond({ ok: false, error: error.message }));
    return true;
  });
})();
