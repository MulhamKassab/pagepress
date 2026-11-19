(() => {
  // Keyed on the extension and its version: after an update the old copy no longer blocks the new one.
  // (The background script also pings us and clears this key when the old listener is dead.)
  const guardKey = (() => { try { return `${chrome.runtime.id}:${chrome.runtime.getManifest().version}`; } catch { return 'unversioned'; } })();
  if (globalThis.__PAGEPRESS_CONTENT__ === guardKey) return;
  globalThis.__PAGEPRESS_CONTENT__ = guardKey;
  const hidden = new Map();
  const sticky = new Map();
  let capture = null, selecting = false, overlay = null, hint = null, focusEl = null, printStyle = null, watchdog = null;
  let observer = null, fixedList = null, domChanged = true;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const snapshot = (element, property) => ({ value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
  const restoreProperty = (element, property, original) => { if (original.value) element.style.setProperty(property, original.value, original.priority); else element.style.removeProperty(property); };
  // Same behaviour as t() in lib/i18n.js (a classic script cannot import it).
  const t = (key, fallback, substitutions = []) => {
    const values = (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
    try { const message = globalThis.chrome?.i18n?.getMessage?.(key, values); if (message) return message; } catch { /* use the English text */ }
    return String(fallback).replace(/\$(\d)/g, (match, index) => (values[index - 1] ?? match));
  };
  // Every element of the page, including those inside open shadow roots (web components).
  function allElements() {
    const found = [];
    const visit = (scope, selector) => {
      for (const element of scope.querySelectorAll(selector)) {
        found.push(element);
        if (element.shadowRoot) { observer?.observe(element.shadowRoot, watchOptions); visit(element.shadowRoot, '*'); }
      }
    };
    visit(document, 'body *');
    return found;
  }
  // Fixed elements are collected once and re-checked cheaply; a full re-scan only happens
  // when the page's structure or classes changed (a header turning fixed on scroll).
  const watchOptions = { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] };
  function watchDom() {
    domChanged = true; fixedList = null;
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((records) => { if (records.some((record) => !(record.attributeName === 'style' && sticky.has(record.target)))) domChanged = true; });
    observer.observe(document.documentElement, watchOptions);
  }
  function unwatchDom() { observer?.disconnect(); observer = null; fixedList = null; }
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
    document.removeEventListener('keydown', keyboard, true);
    overlay?.remove(); overlay = null;
    hint?.remove(); hint = null; focusEl = null;
    announce();
  }
  const selectable = (element) => !!element && element !== document.documentElement && element !== document.body && !element.dataset?.pagepress;
  const describe = (element) => `${String(element.tagName || 'element').toLowerCase()}${element.id ? `#${element.id}` : ''}`;
  function outline(element) {
    if (!overlay) return;
    if (!selectable(element)) { overlay.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function hover(event) { focusEl = selectable(event.target) ? event.target : null; outline(focusEl); }
  function hideElement(element) {
    if (!hidden.has(element)) hidden.set(element, snapshot(element, 'display'));
    element.style.setProperty('display', 'none', 'important');
    if (overlay) overlay.style.display = 'none';
    announce();
  }
  function pick(event) {
    if (!selectable(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    hideElement(event.target); focusEl = null;
  }
  // Keyboard picking: Tab / Shift+Tab walk the page, the arrow keys go to the parent (up), first
  // child (down) and previous / next sibling (left / right), Enter hides, Escape stops.
  function visibleElements() {
    return [...document.querySelectorAll('body *')].filter((element) => { const rect = element.getBoundingClientRect(); return selectable(element) && rect.width > 0 && rect.height > 0; });
  }
  function keyboard(event) {
    if (event.key === 'Escape') { event.preventDefault(); endSelection(); return; }
    let next;
    if (event.key === 'Enter') {
      if (!focusEl) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const list = visibleElements(), index = list.indexOf(focusEl), target = list[index + 1] || list[index - 1] || null;
      hideElement(focusEl); focusEl = target; outline(target); setHint(target);
      return;
    }
    if (event.key === 'Tab') {
      const list = visibleElements(); if (!list.length) return;
      const index = list.indexOf(focusEl), delta = event.shiftKey ? -1 : 1;
      next = index < 0 ? (delta > 0 ? list[0] : list.at(-1)) : list[(index + delta + list.length) % list.length];
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (!focusEl) next = visibleElements()[0];
      else next = { ArrowUp: focusEl.parentElement, ArrowDown: focusEl.firstElementChild, ArrowLeft: focusEl.previousElementSibling, ArrowRight: focusEl.nextElementSibling }[event.key];
      if (!selectable(next)) next = focusEl;
    } else return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!selectable(next)) return;
    focusEl = next; next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); outline(next); setHint(next);
  }
  function setHint(element) {
    if (!hint) return;
    hint.textContent = t('pickHint', 'Pick & hide: click an element, or press Tab and the arrow keys to move the outline, Enter to hide it, Escape to stop.') + (element ? ` ${t('pickSelected', 'Selected: $1', describe(element))}` : '');
  }
  function select() {
    if (capture) throw new Error(t('errorWait', 'Wait for the current export to finish.'));
    endSelection(); selecting = true;
    overlay = document.createElement('div'); overlay.dataset.pagepress = 'selection';
    Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #4c75ee', background: 'rgba(76,117,238,.13)', boxSizing: 'border-box', display: 'none' });
    document.documentElement.append(overlay);
    hint = document.createElement('div'); hint.dataset.pagepress = 'hint';
    hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite');
    Object.assign(hint.style, { position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)', maxWidth: '90vw', padding: '9px 14px', borderRadius: '8px', background: '#17202e', color: '#fff', font: '14px/1.4 system-ui, sans-serif', zIndex: '2147483647', pointerEvents: 'none', boxShadow: '0 4px 18px rgba(0,0,0,.35)' });
    document.documentElement.append(hint); setHint(null);
    document.addEventListener('mousemove', hover, true); document.addEventListener('click', pick, true); document.addEventListener('keydown', keyboard, true);
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
    sticky.clear(); unwatchDom();
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
    if (document.contentType === 'application/pdf' || (document.body?.children?.length === 1 && document.querySelector?.('embed[type="application/pdf"]'))) {
      throw new Error(t('errorIsPdf', 'This page is a PDF file. Use the PDF viewer’s download button to save it.'));
    }
    if (capture) restore(false);
    endSelection();
    const style = document.createElement('style');
    style.dataset.pagepress = 'capture';
    style.textContent = 'html { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; } * { animation-play-state: paused !important; transition: none !important; scroll-snap-align: none !important; }';
    capture = { x: scrollX, y: scrollY, style, changed: [], details: [] };
    document.documentElement.append(style); refreshWatchdog();
    // Sticky content belongs to the document. Keep every heading in its original
    // flow, including headings below the first viewport, while removing stickiness.
    watchDom();
    if (options.hideSticky && options.scope === 'full') for (const element of allElements()) {
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
      // Ask the browser to load native lazy images now (restored afterwards), then walk the whole page.
      capture.attributes = capture.attributes || [];
      for (const image of document.images) {
        if (image.getAttribute?.('loading') === 'lazy') { capture.attributes.push([image, 'loading', 'lazy']); image.setAttribute('loading', 'eager'); }
      }
      const initial = metrics(), started = Date.now();
      const steps = Math.ceil(initial.height / initial.viewportHeight);
      for (let step = 0; step < steps && Date.now() - started < 15000; step++) {
        if (!capture) throw new Error(t('errorPrepCanceled', 'Capture preparation was canceled.'));
        scrollView(0, Math.min(step * initial.viewportHeight, initial.height - initial.viewportHeight));
        await pause(150);
      }
      window.scrollTo({ top: capture.y, left: capture.x, behavior: 'instant' });
      capture.scroller?.scrollTo({ left: capture.scrollerX, top: capture.scrollerY, behavior: 'instant' });
      await settleImages(3000, false);
      await pause(200);
    }
    await settleImages(1000, true);
    capture.anchor = pickAnchor();
    const result = metrics();
    if (options.scope === 'viewport') { result.width = result.viewportWidth; result.height = result.viewportHeight; }
    result.scroller = !!capture.scroller;
    return result;
  }
  function hideFixed() {
    if (domChanged || !fixedList) {
      fixedList = allElements().filter((element) => !element.dataset?.pagepress && getComputedStyle(element).position === 'fixed');
      domChanged = false;
    }
    for (const element of fixedList) {
      if (sticky.has(element)) continue;
      const computed = getComputedStyle(element);
      if (computed.position === 'fixed' && computed.visibility !== 'hidden' && computed.display !== 'none') {
        sticky.set(element, snapshot(element, 'visibility'));
        element.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }
  // Wait (up to `limit` ms) for images that are still loading: only those in view, or all of them.
  async function settleImages(limit, onlyVisible) {
    const panel = capture?.scroller, bounds = panel ? panel.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      const pending = [...document.images].filter((image) => {
        if (image.complete) return false;
        if (!onlyVisible) return true;
        const rect = image.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
      });
      if (!pending.length) return;
      await Promise.race([Promise.allSettled(pending.map((image) => image.decode())), pause(Math.max(1, Math.min(400, deadline - Date.now())))]);
    }
  }
  // An element near the middle of the first screen. How far it moves tells how far the page's
  // content moved (a header leaving the flow, content inserted above) as we scroll.
  function documentY(element) {
    const rect = element.getBoundingClientRect(), panel = capture?.scroller;
    if (panel) return rect.top - panel.getBoundingClientRect().top - panel.clientTop + panel.scrollTop;
    return rect.top + scrollY;
  }
  function pickAnchor() {
    try {
      const panel = capture?.scroller, box = panel ? panel.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      let element = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
      if (!element || element === document.documentElement || element === document.body || (panel && !panel.contains(element))) return null;
      if (element.getBoundingClientRect().height > box.height * 0.6) return null;
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') return null;
      }
      return { element, y: documentY(element) };
    } catch { return null; }
  }
  const anchorShift = () => (capture?.anchor?.element?.isConnected ? documentY(capture.anchor.element) - capture.anchor.y : null);
  async function move(message) {
    if (!capture) throw new Error(t('errorSessionEnded', 'The page capture session ended. Please export again.'));
    refreshWatchdog();
    if (message.hideSticky) hideFixed();
    if (message.scope !== 'viewport') scrollView(message.x, message.y);
    await pause(180);
    // A header that only turns fixed because of this scroll must be hidden too.
    if (message.hideSticky) hideFixed();
    // Images that start loading as they come into view must be finished before the screenshot.
    if (message.scope !== 'viewport') await settleImages(1500, true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const current = metrics();
    return { ...current, x: current.scrollX, y: current.scrollY, anchorShift: anchorShift() };
  }
  function print(options) {
    if (capture) restore(false);
    endSelection();
    const style = document.createElement('style');
    capture = { x: scrollX, y: scrollY, style, changed: [], details: [], attributes: [] };
    printStyle = style;
    const size = options.paper === 'letter' ? 'letter' : 'A4';
    style.textContent = `@page { size: ${size} ${options.orientation}; margin: ${options.margin}mm; } @media print { ${options.cleanPrint ? 'html, body { height: auto !important; overflow: visible !important; } [data-pagepress-unclip], main, article, section { height: auto !important; max-height: none !important; overflow: visible !important; } [data-pagepress-unclip] { -webkit-line-clamp: unset !important; line-clamp: unset !important; text-overflow: clip !important; } [data-pagepress-static] { position: static !important; } [data-pagepress-hide], .cookie-banner, .cookie-consent { display: none !important; }' : ''} * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`;
    document.documentElement.append(style);
    if (options.cleanPrint) {
      for (const details of document.querySelectorAll('details')) { capture.details.push([details, details.open]); details.open = true; }
      for (const element of allElements()) {
        const computed = getComputedStyle(element);
        // Site navigation goes; a table of contents or breadcrumbs inside the article stays.
        if (element.matches?.('nav, [role="navigation"]') && !element.closest?.('article, main, [role="main"]')) { capture.attributes.push([element, 'data-pagepress-hide', element.getAttribute('data-pagepress-hide')]); element.setAttribute('data-pagepress-hide', ''); }
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
