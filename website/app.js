'use strict';

(() => {
  const form = document.querySelector('#export-form');
  const preview = document.querySelector('#demo-canvas');
  if (!form || !preview) return;
  const status = document.querySelector('#demo-status');
  const download = document.querySelector('#download-demo');
  let sample = 'article';
  let currentRender;
  const colors = { ink: '#26392c', muted: '#73816b', paper: '#fffefa', blue: '#365fff' };
  const sampleData = {
    article: { filename: 'PagePress-Sunday-Notes', address: 'fieldnotes.example/sunday-notes', source: 'fieldnotes.example/sunday-notes · PagePress sample' },
    menu: { filename: 'PagePress-Neighborhood-Menu', address: 'thetable.example/menu', source: 'thetable.example/menu · PagePress sample' }
  };

  function settings() {
    const data = new FormData(form);
    return { capture: data.get('capture'), paper: data.get('paper'), orientation: data.get('orientation'), margin: Number(data.get('margin')), scale: Number(data.get('scale')), hideNav: data.has('hideNav'), images: data.has('images'), source: data.has('source') };
  }

  function wrap(ctx, content, width) {
    const lines = [];
    for (const paragraph of content.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; }
        else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  function paragraph(ctx, content, x, y, width, size = 17, leading = 29, color = colors.muted, family = 'Arial', weight = 'normal') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrap(ctx, content, width);
    lines.forEach((line, i) => ctx.fillText(line, x, y + leading * i));
    return y + leading * lines.length;
  }

  // Sample pages are deliberately laid out in blocks. Unlike an arbitrary tab
  // screenshot, these known blocks can be kept together at a paper boundary.
  function textBlock(ctx, blocks, content, x, y, width, size = 17, leading = 29, color = colors.muted, family = 'Arial', weight = 'normal', keepNext = false) {
    const nextY = paragraph(ctx, content, x, y, width, size, leading, color, family, weight);
    const lines = wrap(ctx, content, width);
    const metrics = lines.map(value => ctx.measureText(value));
    const ascent = Math.max(size * .8, ...metrics.map(value => value.actualBoundingBoxAscent || 0));
    const descent = Math.max(size * .22, ...metrics.map(value => value.actualBoundingBoxDescent || 0));
    blocks.push({ top: Math.floor(y - ascent - 3), bottom: Math.ceil(nextY - leading + descent + 3), keepNext });
    return nextY;
  }

  function line(ctx, x1, y1, x2, y2, color = '#dce2d5') {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function landscape(ctx, x, y, w, h) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#dce5bc'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f7edbd'; ctx.beginPath(); ctx.arc(x + w * .74, y + h * .29, h * .16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b5c488'; ctx.beginPath(); ctx.moveTo(x - 20, y + h * .8); ctx.bezierCurveTo(x + w * .2, y + h * .22, x + w * .65, y + h * .96, x + w + 10, y + h * .45); ctx.lineTo(x + w + 10, y + h); ctx.lineTo(x - 20, y + h); ctx.fill();
    ctx.fillStyle = '#8da16c'; ctx.beginPath(); ctx.moveTo(x - 10, y + h); ctx.bezierCurveTo(x + w * .22, y + h * .55, x + w * .6, y + h * .58, x + w + 10, y + h * .94); ctx.lineTo(x + w + 10, y + h + 10); ctx.lineTo(x - 10, y + h + 10); ctx.fill();
    ctx.strokeStyle = '#4e6340'; ctx.lineWidth = 3;
    for (const [px, ph, tilt] of [[.09, .39, -.06], [.18, .30, .05], [.13, .23, -.03]]) {
      const base = x + w * px; const top = y + h * (1 - ph);
      ctx.beginPath(); ctx.moveTo(base, y + h); ctx.quadraticCurveTo(base + w * tilt, top + h * .15, base + w * tilt, top); ctx.stroke();
      ctx.fillStyle = '#4e6340';
      for (let j = 0; j < 3; j++) { const py = top + h * .06 + j * h * .08; ctx.beginPath(); ctx.ellipse(base + w * tilt + (j % 2 ? 11 : -10), py, 14, 5, j % 2 ? -.5 : .6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#415035'; ctx.font = '10px Arial'; ctx.fillText('THE WEEKEND EDIT / A LITTLE ROOM TO BREATHE', x + 19, y + 25);
    ctx.restore();
  }

  function menuIllustration(ctx, x, y, w, h) {
    ctx.fillStyle = '#e8e5d6'; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-.08);
    ctx.fillStyle = '#d7d6bd'; ctx.beginPath(); ctx.ellipse(0, 16, w * .20, h * .35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffefa'; ctx.beginPath(); ctx.ellipse(0, 4, w * .20, h * .35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#dedfcd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 4, w * .17, h * .30, 0, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 7; i++) { const angle = i * .87; const px = Math.cos(angle) * 47; const py = Math.sin(angle) * 27; ctx.fillStyle = i % 2 ? '#789664' : '#95ab72'; ctx.beginPath(); ctx.ellipse(px, py, 27, 10, angle, 0, Math.PI * 2); ctx.fill(); }
    for (const [px, py] of [[-20, -10], [35, 18], [18, -34], [-48, 18]]) { ctx.fillStyle = '#c97856'; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#efd4b2'; ctx.beginPath(); ctx.arc(px - 2, py - 2, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    line(ctx, x + w * .17, y + h * .23, x + w * .16, y + h * .79, '#8c947c');
    line(ctx, x + w * .83, y + h * .23, x + w * .84, y + h * .79, '#8c947c');
    ctx.fillStyle = '#58624d'; ctx.font = '10px Arial'; ctx.fillText('A GOOD TABLE. A LITTLE TIME.', x + 19, y + 25);
  }

  function renderArticle(ctx, opt, blocks) {
    const s = opt.scale, x = 54, w = 612;
    let y = 43;
    if (!opt.hideNav) { ctx.fillStyle = colors.ink; ctx.font = 'bold 13px Arial'; ctx.fillText('FIELD NOTES', x, y); ctx.font = '11px Arial'; ctx.fillText('Stories     Places     About', 487, y); line(ctx, x, y + 23, 666, y + 23); y += 73; }
    ctx.fillStyle = colors.muted; ctx.font = '11px Arial'; ctx.fillText('ISSUE 08     /     SLOW LIVING', x, y); y += 70 * s;
    y = paragraph(ctx, 'A little room for the everyday.', x, y, w, 56 * s, 61 * s, colors.ink, 'Georgia'); y += 9;
    y = paragraph(ctx, 'Good things have a way of hiding in plain sight. A morning walk. A shared table. A page worth returning to.', x, y, w - 50, 19 * s, 30 * s); y += 20;
    ctx.fillStyle = '#9aA58f'; ctx.font = '10px Arial'; ctx.fillText('WORDS BY THE FIELD NOTES TEAM  ·  5 MIN READ', x, y); y += 30;
    blocks.push({ top: 0, bottom: Math.ceil(y - 24) });
    if (opt.images) { landscape(ctx, x, y, w, 252); blocks.push({ top: Math.floor(y), bottom: Math.ceil(y + 252) }); y += 276; }
    y = textBlock(ctx, blocks, 'Sometimes the best part of a weekend is the part you didn’t plan. A turn down a quieter street. The smell of something baking. A conversation that carries on long after the cups are empty.', x, y + 10, w, 17 * s, 29 * s); y += 21;
    y = textBlock(ctx, blocks, 'We spend so much time collecting places to go and things to do that we can forget to notice what is already here. So this Sunday, we tried a smaller list: walk a little, cook something simple, leave room for whatever happens next.', x, y, w, 17 * s, 29 * s); y += 31;
    const calloutTop = y - 10;
    const calloutHeight = 130 * s;
    ctx.fillStyle = '#eaf0d8'; ctx.fillRect(x, calloutTop, w, calloutHeight);
    paragraph(ctx, '“The everyday is a good place to start.”', x + 27, y + 34 * s, w - 54, 29 * s, 36 * s, colors.ink, 'Georgia');
    blocks.push({ top: Math.floor(calloutTop), bottom: Math.ceil(calloutTop + calloutHeight) });
    y = calloutTop + calloutHeight + 52 * s;
    y = textBlock(ctx, blocks, 'A table with room for one more', x, y, w, 29 * s, 36 * s, colors.ink, 'Georgia', 'normal', true); y += 11;
    y = textBlock(ctx, blocks, 'Lunch was bread, tomatoes, herbs from a windowsill, and whatever was left in the fridge. Nothing especially remarkable on its own. But given a little care, it became the sort of meal we wanted to remember.', x, y, w, 17 * s, 29 * s); y += 21;
    y = textBlock(ctx, blocks, 'This is what keeping a page can be, too. A way to notice something useful and give it a place. Not everything needs to become a project. Some things are simply worth holding onto.', x, y, w, 17 * s, 29 * s, colors.muted, 'Arial', 'normal', true); y += 28;
    const footerTop = y - 1;
    line(ctx, x, y, 666, y); y += 31;
    ctx.fillStyle = colors.muted; ctx.font = '10px Arial'; ctx.fillText('FIELD NOTES  /  SMALL STORIES, WELL KEPT.', x, y);
    blocks.push({ top: Math.floor(footerTop), bottom: Math.ceil(y + 6) });
    return y + 40;
  }

  function renderMenu(ctx, opt, blocks) {
    const s = opt.scale, x = 54, w = 612;
    let y = 43;
    if (!opt.hideNav) { ctx.fillStyle = colors.ink; ctx.font = 'bold 13px Arial'; ctx.fillText('THE TABLE', x, y); ctx.font = '11px Arial'; ctx.fillText('Menu      Our story      Visit', 483, y); line(ctx, x, y + 23, 666, y + 23); y += 73; }
    ctx.fillStyle = colors.muted; ctx.font = '11px Arial'; ctx.fillText('THE NEIGHBORHOOD KITCHEN', x, y); y += 76 * s;
    y = paragraph(ctx, 'Good food.\nGood company.', x, y, w, 56 * s, 61 * s, colors.ink, 'Georgia'); y += 8;
    y = paragraph(ctx, 'A seasonal menu for slow lunches and easy evenings. Everything is a little better shared.', x, y, w - 80, 18 * s, 29 * s); y += 26;
    blocks.push({ top: 0, bottom: Math.ceil(y - 35 * s + 10) });
    if (opt.images) { menuIllustration(ctx, x, y, w, 245); blocks.push({ top: Math.floor(y), bottom: Math.ceil(y + 245) }); y += 280; }
    const groups = [
      { title: 'Start at the table', items: [['Garden salad', '36', 'Leafy greens, roasted tomatoes, lemon dressing.'], ['Warm sourdough', '22', 'Fresh from the oven, with whipped herb butter.'], ['Roasted carrot soup', '32', 'Ginger, coconut, toasted seeds, and a little warmth.']] },
      { title: 'Stay a little longer', items: [['The neighborhood bowl', '52', 'Herbed grains, charred vegetables, hummus, and greens.'], ['Lemon roast chicken', '68', 'Golden potatoes, tender greens, and pan-roasted lemon.'], ['Wild mushroom pasta', '58', 'Creamy mushrooms, fresh thyme, aged parmesan.']] },
      { title: 'Something sweet', items: [['Olive oil cake', '28', 'A slice of the good stuff. Citrus cream on the side.'], ['Seasonal fruit & yogurt', '24', 'Local honey, toasted oats, and whatever is in season.']] }
    ];
    for (const group of groups) {
      y = textBlock(ctx, blocks, group.title, x, y, w, 29 * s, 36 * s, colors.ink, 'Georgia', 'normal', true); y += 13;
      for (const [name, price, desc] of group.items) {
        const itemTop = Math.floor(y - 19 * s - 3);
        ctx.fillStyle = colors.ink; ctx.font = `bold ${17 * s}px Arial`; ctx.fillText(name, x, y); ctx.textAlign = 'right'; ctx.font = `${16 * s}px Arial`; ctx.fillText(price, 666, y); ctx.textAlign = 'left';
        y = paragraph(ctx, desc, x, y + 24 * s, w - 70, 14 * s, 23 * s);
        blocks.push({ top: itemTop, bottom: Math.ceil(y - 23 * s + 7 * s), keepNext: group === groups[groups.length - 1] });
        y += 23;
      }
      line(ctx, x, y - 5, 666, y - 5);
      blocks[blocks.length - 1].bottom = Math.ceil(y - 4);
      y += 34;
    }
    y = textBlock(ctx, blocks, 'SAMPLE MENU · PRICES IN AED\nThis is fictional demo content. Ask your restaurant about dietary needs.', x, y, w, 10, 18);
    return y + 35;
  }

  function pageDimensions(opt) {
    let dimensions = opt.paper === 'letter' ? [215.9, 279.4] : [210, 297];
    if (opt.orientation === 'landscape') dimensions.reverse();
    return { width: dimensions[0], height: dimensions[1] };
  }

  function atomicBlocks(blocks) {
    const merged = [];
    for (const block of blocks) {
      const previous = merged[merged.length - 1];
      if (previous && (previous.keepNext || previous.bottom > block.top)) {
        previous.bottom = Math.max(previous.bottom, block.bottom);
        previous.keepNext = Boolean(block.keepNext);
      } else merged.push({ ...block });
    }
    return merged;
  }

  function safeCut(blocks, start, limit) {
    const crossing = blocks.find(block => block.top < limit && block.bottom > limit);
    if (!crossing || crossing.top <= start) return Math.floor(limit);
    const preceding = blocks.filter(block => block.bottom <= crossing.top).at(-1);
    return Math.floor((Math.max(start, preceding?.bottom || start) + crossing.top) / 2);
  }

  function paginate(blocks, height, capacity) {
    const slices = [];
    let sourceY = 0;
    while (sourceY < height) {
      const inset = slices.length ? 32 : 0;
      const limit = sourceY + capacity - inset;
      const end = height <= limit ? height : safeCut(blocks, sourceY, limit);
      // Every controlled block fits even the smallest paper option. The fallback
      // guarantees progress if a future sample introduces a larger block.
      const safeEnd = Math.max(sourceY + 1, Math.min(height, end));
      slices.push({ sourceY, height: safeEnd - sourceY, inset });
      sourceY = safeEnd;
    }
    return slices;
  }

  function compose(opt) {
    const master = document.createElement('canvas'); master.width = 720; master.height = 2800;
    const ctx = master.getContext('2d'); ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, master.width, master.height);
    const blocks = [];
    const drawnHeight = sample === 'article' ? renderArticle(ctx, opt, blocks) : renderMenu(ctx, opt, blocks);
    const intactBlocks = atomicBlocks(blocks);
    const height = Math.ceil(opt.capture === 'viewport' && drawnHeight > 820 ? safeCut(intactBlocks, 0, 820) : drawnHeight);
    const content = document.createElement('canvas'); content.width = 720; content.height = Math.ceil(height);
    content.getContext('2d').drawImage(master, 0, 0);
    const paper = pageDimensions(opt);
    const printableWidth = paper.width - opt.margin * 2;
    const printableHeight = paper.height - opt.margin * 2 - (opt.source ? 10 : 0);
    const pixelsPerMm = content.width / printableWidth;
    const sliceHeight = Math.floor(printableHeight * pixelsPerMm);
    const slices = paginate(intactBlocks, content.height, sliceHeight);
    const pages = slices.length;
    return { content, opt, paper, printableWidth, printableHeight, pixelsPerMm, sliceHeight, slices, pages };
  }

  function paintPreview(render) {
    const { content, opt, paper, slices, printableWidth, pages } = render;
    preview.width = 720; preview.height = Math.round(720 * paper.height / paper.width);
    const ctx = preview.getContext('2d'); const ratio = preview.width / paper.width;
    ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, preview.width, preview.height);
    const sourceHeight = slices[0].height;
    ctx.drawImage(content, 0, 0, content.width, sourceHeight, opt.margin * ratio, opt.margin * ratio, printableWidth * ratio, sourceHeight / render.pixelsPerMm * ratio);
    if (opt.source) {
      ctx.fillStyle = '#86907e'; ctx.font = `${6.5 * ratio * .3528}px Arial`;
      ctx.fillText(sampleData[sample].source, (opt.margin || 5) * ratio, preview.height - (opt.margin + 3) * ratio);
      ctx.textAlign = 'right'; ctx.fillText(`1 / ${pages}`, preview.width - (opt.margin || 5) * ratio, preview.height - (opt.margin + 3) * ratio); ctx.textAlign = 'left';
    }
    preview.setAttribute('aria-label', `First of ${pages} ${opt.paper === 'a4' ? 'A4' : 'Letter'} ${opt.orientation} PDF ${pages === 1 ? 'page' : 'pages'}, previewing ${sample === 'article' ? 'Sunday notes article' : 'neighborhood menu'}`);
    document.querySelector('#preview-paper-label').textContent = `${opt.paper === 'a4' ? 'A4' : 'Letter'} · ${opt.orientation === 'portrait' ? 'Portrait' : 'Landscape'}`;
    document.querySelector('#preview-count-label').textContent = `${pages} ${pages === 1 ? 'page' : 'pages'}`;
    document.querySelector('#sample-address').textContent = sampleData[sample].address;
  }

  function update() { currentRender = compose(settings()); paintPreview(currentRender); status.classList.remove('error'); status.textContent = 'No upload. No waiting in a queue.'; }

  document.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => {
    sample = button.dataset.sample;
    document.querySelectorAll('[data-sample]').forEach(other => { const active = other === button; other.classList.toggle('active', active); other.setAttribute('aria-pressed', String(active)); });
    update();
  }));
  form.addEventListener('change', update);
  form.addEventListener('submit', async event => {
    event.preventDefault(); download.disabled = true; status.classList.remove('error'); status.textContent = 'Preparing your PDF on this device…';
    try {
      if (!window.jspdf?.jsPDF) throw new Error('The PDF library did not load. Please reload this page and try again.');
      await new Promise(resolve => requestAnimationFrame(resolve));
      const render = compose(settings()); const { content, opt, paper, slices, pages, pixelsPerMm, printableWidth } = render;
      const pdf = new window.jspdf.jsPDF({ orientation: opt.orientation, unit: 'mm', format: opt.paper, compress: true });
      pdf.setProperties({ title: sample === 'article' ? 'PagePress — Sunday Notes sample' : 'PagePress — Neighborhood Menu sample', author: 'PagePress by Mulham Kassab', creator: 'PagePress local demo', subject: 'A controlled, image-based PDF sample generated in your browser' });
      for (let index = 0; index < pages; index++) {
        if (index) pdf.addPage();
        pdf.setFillColor(255, 254, 250); pdf.rect(0, 0, paper.width, paper.height, 'F');
        const { sourceY, height, inset } = slices[index];
        const slice = document.createElement('canvas'); slice.width = content.width; slice.height = height;
        slice.getContext('2d').drawImage(content, 0, sourceY, content.width, height, 0, 0, content.width, height);
        pdf.addImage(slice.toDataURL('image/jpeg', .94), 'JPEG', opt.margin, opt.margin + inset / pixelsPerMm, printableWidth, height / pixelsPerMm, `page-${index}`, 'FAST');
        if (opt.source) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(115, 128, 107); pdf.text(sampleData[sample].source, opt.margin || 5, paper.height - opt.margin - 3); pdf.text(`${index + 1} / ${pages}`, paper.width - (opt.margin || 5), paper.height - opt.margin - 3, { align: 'right' }); }
      }
      pdf.save(`${sampleData[sample].filename}.pdf`);
      status.textContent = `Saved your ${pages}-page sample. A good page, kept.`;
    } catch (error) { status.classList.add('error'); status.textContent = error.message || 'The PDF could not be created. Please try again.'; }
    finally { download.disabled = false; }
  });
  update();
})();
