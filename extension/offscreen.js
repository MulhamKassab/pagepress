import { tileSlices } from './lib/geometry.js';

let session = null;
const urls = new Set();
function pageCanvas(index) {
  if (!session.canvases.has(index)) {
    const canvas = document.createElement('canvas');
    canvas.width = session.layout.canvasWidth; canvas.height = session.layout.canvasHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Chrome could not allocate a PDF page canvas. Try Compact quality.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    session.canvases.set(index, canvas);
  }
  return session.canvases.get(index);
}
function sourceLabel(url) {
  try { const parsed = new URL(url); return `${parsed.hostname || 'Local file'}${parsed.pathname === '/' ? '' : decodeURIComponent(parsed.pathname)}`; }
  catch { return 'Saved webpage'; }
}
function flush(index) {
  const { pdf, layout, options, meta, canvases } = session;
  const canvas = canvases.get(index);
  if (!canvas) throw new Error('A captured PDF page is missing. Please try again.');
  if (index !== session.flushed) throw new Error('PDF pages arrived out of order. Please try again.');
  if (index > 0) pdf.addPage([layout.pageWidth, layout.pageHeight], options.orientation);
  const quality = { compact: 0.65, balanced: 0.86, high: 0.96 }[options.quality];
  pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', layout.margin, layout.margin, layout.contentWidth, layout.contentHeight, undefined, 'FAST');
  if (options.footer) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(90, 99, 111);
    const y = layout.pageHeight - layout.margin - 2;
    const number = `${index + 1} / ${layout.totalPages}`;
    const date = new Date(meta.date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
    let label = `${sourceLabel(meta.url)} · ${date}`.replace(/[^\x20-\x7e\u00b7]/g, '?');
    const available = layout.contentWidth - 25;
    while (label.length && pdf.getTextWidth(label) > available) label = label.slice(0, -2);
    pdf.text(label, layout.margin, y);
    pdf.text(number, layout.pageWidth - layout.margin, y, { align: 'right' });
  }
  canvas.width = 1; canvas.height = 1; canvases.delete(index); session.flushed++;
}
async function handle(message) {
  if (message.type === 'BEGIN') {
    if (!globalThis.jspdf?.jsPDF) throw new Error('The bundled PDF library is missing. Reinstall webTopdf from the complete ZIP.');
    session = { layout: message.layout, options: message.options, meta: message.meta, canvases: new Map(), flushed: 0, pdf: new globalThis.jspdf.jsPDF({ orientation: message.options.orientation, unit: 'mm', format: [message.layout.pageWidth, message.layout.pageHeight], compress: true }) };
    session.pdf.setProperties({ title: String(message.meta.title || 'Saved webpage'), author: '', creator: 'webTopdf — local webpage export', subject: 'Visual webpage capture' });
    return {};
  }
  if (message.type === 'RELEASE') { URL.revokeObjectURL(message.url); urls.delete(message.url); return {}; }
  if (message.type === 'ABORT') { if (session) for (const canvas of session.canvases.values()) { canvas.width = 1; canvas.height = 1; } session = null; return {}; }
  if (!session) throw new Error('The PDF processing session ended. Please export again.');
  if (message.type === 'TILE') {
    const blob = await (await fetch(message.image)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scaleX = bitmap.width / message.innerWidth, scaleY = bitmap.height / message.innerHeight;
      for (const slice of tileSlices(message.tile, session.layout)) {
        const context = pageCanvas(slice.pageIndex).getContext('2d');
        context.drawImage(bitmap, slice.sourceX * scaleX, slice.sourceY * scaleY, slice.sourceWidth * scaleX, slice.sourceHeight * scaleY, slice.destX, slice.destY, slice.destWidth, slice.destHeight);
      }
      if (message.tile.lastInRow) {
        const completeThrough = message.tile.y + message.tile.height;
        while ((session.flushed + 1) * session.layout.cssPageHeight <= completeThrough + 1e-7 && session.flushed < session.layout.totalPages) flush(session.flushed);
      }
    } finally { bitmap.close(); }
    return { pagesFinished: session.flushed };
  }
  if (message.type === 'FINISH') {
    while (session.flushed < session.layout.totalPages) flush(session.flushed);
    const blob = session.pdf.output('blob');
    const url = URL.createObjectURL(blob); urls.add(url);
    const bytes = blob.size;
    session = null;
    return { url, bytes };
  }
  throw new Error('Unknown PDF processor command.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  handle(message).then((data) => respond({ ok: true, data }), (error) => respond({ ok: false, error: error.message }));
  return true;
});
