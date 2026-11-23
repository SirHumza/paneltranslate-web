// The padded OCR box is both the edit boundary and the maximum layout area.
// A clean perimeter is required before any replacement touches the output.
function measureArea(region, source) {
  if (!Array.isArray(region.box) || region.box.length !== 4 || !region.box.every(Number.isFinite)) return null;
  const [x, y, w, h] = region.box;
  if (w < 5 || h < 5 || x < 0 || y < 0 || x + w > source.width || y + h > source.height) return null;
  const pad = Math.max(3, Math.min(9, Math.ceil(h * 0.12)));
  const left = Math.floor(x) - pad, top = Math.floor(y) - pad;
  const width = Math.ceil(x + w) + pad - left, height = Math.ceil(y + h) + pad - top;
  if (left < 0 || top < 0 || left + width > source.width || top + height > source.height || width * height > 2_000_000) return null;
  return {left, top, width, height, pad};
}

function inspectPaper(pixels, area, text) {
  const {width, height, pad} = area;
  const {data} = pixels;
  const paper = [0, 1, 2].map(channel => {
    const corners = [0, width - 1, width * (height - 1), width * height - 1];
    return corners.map(pos => data[pos * 4 + channel]).sort((a, b) => a - b)[1];
  });
  if (Math.min(...paper) < 220 || Math.max(...paper) - Math.min(...paper) > 18) return null;

  const ink = new Uint8Array(width * height);
  let dark = 0;
  for (let pos = 0; pos < ink.length; pos++) {
    const offset = pos * 4, x = pos % width, y = Math.floor(pos / width);
    const rgb = data.subarray(offset, offset + 3);
    if (data[offset + 3] !== 255 || Math.max(...rgb) - Math.min(...rgb) > 24) return null;
    const difference = Math.max(...paper.map((value, channel) => Math.abs(value - rgb[channel])));
    const margin = Math.min(x, y, width - 1 - x, height - 1 - y);
    if (margin < pad - 1 && difference > 5) return null;
    ink[pos] = difference > 4 ? 1 : 0;
    if (difference > 55) dark++;
  }
  if (dark < 3 || dark > ink.length * 0.42) return null;

  // Long connected marks or an implausibly large component can be a bubble
  // outline, illustration, or underline. Keep those areas for manual review.
  const seen = new Uint8Array(ink.length), stack = new Int32Array(ink.length);
  let components = 0;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 1, count = 0, xmin = width, xmax = 0, ymin = height, ymax = 0;
    stack[0] = start;
    seen[start] = 1;
    while (top) {
      const pos = stack[--top], x = pos % width, y = Math.floor(pos / width);
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      count++;
      for (const step of [-width, width, -1, 1]) {
        const next = pos + step;
        if (next >= 0 && next < ink.length && !seen[next] && ink[next]) {
          seen[next] = 1;
          stack[top++] = next;
        }
      }
    }
    const span = xmax - xmin + 1, rise = ymax - ymin + 1;
    if (span > Math.max(12, rise * 4) || rise > Math.max(18, span * 12)) return null;
    if (count >= 3) components++;
  }
  if (components < Math.min(3, Array.from(text.trim()).length)) return null;
  return {paper, ink};
}

function fit(ctx, text, area) {
  const availableWidth = area.width - 4, availableHeight = area.height - 4;
  const words = text.trim().split(/\s+/u);
  for (let size = Math.min(64, Math.floor(availableHeight)); size >= 11; size--) {
    ctx.font = '600 ' + size + 'px Arial, sans-serif';
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > availableWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    const metrics = lines.map(value => ctx.measureText(value));
    if (metrics.some(m => m.width > availableWidth || m.actualBoundingBoxLeft + m.actualBoundingBoxRight > availableWidth)) continue;
    const ascent = Math.ceil(Math.max(...metrics.map(m => m.actualBoundingBoxAscent)));
    const descent = Math.ceil(Math.max(...metrics.map(m => m.actualBoundingBoxDescent)));
    const spacing = Math.max(ascent + descent + 2, Math.ceil(size * 1.1));
    const height = ascent + descent + (lines.length - 1) * spacing;
    if (height <= availableHeight) return {lines, size, ascent, spacing, height};
  }
  return null;
}

export function renderPage(sourceCanvas, regions) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(sourceCanvas, 0, 0);
  const issues = [], rendered = [];
  const areas = regions.map(region => measureArea(region, canvas));
  for (const [index, region] of regions.entries()) {
    const id = region.id ?? index + 1;
    const warn = (code, message) => issues.push({index, id, code, message});
    if (region.enabled === false) continue;
    const translation = String(region.translation || '').trim();
    if (!translation || !String(region.text || '').trim()) {
      warn('missing-text', 'Source text and translation are both required.');
      continue;
    }
    if (translation === region.text.trim()) continue;
    const area = areas[index];
    if (!area) {
      warn('unsafe-bounds', 'The text region has insufficient surrounding space or exceeds the safe edit size.');
      continue;
    }
    const {left, top, width, height} = area;
    if (areas.some((a,i) => i !== index && a && a.left < left+width && a.left+a.width > left && a.top < top+height && a.top+a.height > top)) {
      warn('overlap', 'Two lettering areas overlap.');
      continue;
    }
    const pixels = ctx.getImageData(left, top, width, height);
    const background = inspectPaper(pixels, area, region.text);
    if (!background) {
      warn('unsafe-background', 'Lettering could not be isolated on uniform light paper.');
      continue;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const layout = fit(ctx, translation, area);
    if (!layout) {
      warn('overflow', 'The full translation exceeds the available lettering area.');
      continue;
    }
    for (let p = 0; p < background.ink.length; p++) {
      if (background.ink[p]) pixels.data.set(background.paper, p * 4);
    }
    ctx.putImageData(pixels, left, top);
    const baseline = top + (height - layout.height) / 2 + layout.ascent;
    ctx.fillStyle = '#151515';
    layout.lines.forEach((line, n) => ctx.fillText(line, left + width / 2, baseline + n * layout.spacing));
    rendered.push({index, id, box:[left, top, width, height], fontSize:layout.size, lines:layout.lines});
  }
  return {canvas, issues, rendered};
}
