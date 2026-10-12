/* Render the reviewed leaderboard model as a self-contained PNG canvas. */
(function (root) {
  'use strict';

  const SCALE = 2;
  const PAD = 32;
  const FONT = '"Segoe UI", Arial, sans-serif';
  const colors = {
    background: '#111416', panel: '#191f23', alternate: '#1d252a',
    header: '#20292f', border: '#343f46', text: '#e8edf0', muted: '#a6b4be',
    accent: '#90d0ff', positive: '#82e5b3', negative: '#ff9b9b',
  };
  const text = value => value == null ? '' : String(value);

  function setFont(ctx, size, weight = 400) {
    ctx.font = `${weight} ${size}px ${FONT}`;
  }

  function wrap(ctx, value, maxWidth) {
    const lines = [];
    for (const paragraph of text(value).split(/\r?\n/)) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = '';
        // Blends and long unbroken labels must fit without clipping or ellipses.
        for (const character of Array.from(word)) {
          if (line && ctx.measureText(line + character).width > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function block(ctx, value, width, options = {}) {
    const size = options.size || 22;
    const weight = options.weight || 400;
    const lineHeight = options.lineHeight || Math.ceil(size * 1.3);
    setFont(ctx, size, weight);
    const lines = text(value) ? wrap(ctx, value, width) : [];
    return { lines, size, weight, lineHeight, color: options.color || colors.text,
      height: lines.length * lineHeight };
  }

  function paintBlock(ctx, layout, x, y, right = false) {
    setFont(ctx, layout.size, layout.weight);
    ctx.fillStyle = layout.color;
    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = 'top';
    layout.lines.forEach((line, index) => ctx.fillText(line, x, y + index * layout.lineHeight));
    return y + layout.height;
  }

  function signColor(value) {
    return Number.isFinite(value) && value > 0 ? colors.positive :
      Number.isFinite(value) && value < 0 ? colors.negative : colors.text;
  }

  function cellLayout(ctx, value, width, options = {}) {
    return { ...block(ctx, value, width, options), gap: options.gap ?? 5 };
  }

  function strategyCell(ctx, cell, width) {
    const entry = cell?.entry;
    if (!entry) return [cellLayout(ctx, cell?.emptyLabel || '\u2014', width, { size: 12, color: colors.muted })];
    return [
      cellLayout(ctx, entry.profitLabel ? `Net ${text(entry.profitLabel)}` : '', width,
        { size: 14, weight: 700, color: signColor(entry.profit), gap: 2 }),
      cellLayout(ctx, entry.roiLabel ? `ROI ${text(entry.roiLabel)}` : '', width,
        { size: 12, weight: 600, color: signColor(Number.isFinite(entry.roi) ? entry.roi : entry.profit), gap: 2 }),
      cellLayout(ctx, [entry.recordLabel, entry.settled == null ? '' : `n=${text(entry.settled)}`].filter(Boolean).join(' \u00b7 '),
        width, { size: 11, color: colors.muted, gap: 3 }),
      cellLayout(ctx, entry.hitLabel, width, { size: 11, gap: 0 }),
    ].filter(item => item.height);
  }

  function cellHeight(items) {
    return items.reduce((height, item, index) => height + item.height + (index < items.length - 1 ? item.gap : 0), 0);
  }

  function paintCell(ctx, items, x, y) {
    for (const item of items) {
      paintBlock(ctx, item, x, y);
      y += item.height + item.gap;
    }
  }

  function drawCard(model, ownerDocument) {
    if (!model || !Array.isArray(model.rows) || !Array.isArray(model.columns)) throw new TypeError('A comparison model with rows and columns is required.');
    if (model.columns.length > 12) throw new RangeError('Choose at most twelve devig columns per image.');
    const doc = ownerDocument || root.document;
    if (!doc || typeof doc.createElement !== 'function') throw new Error('Canvas rendering requires a document.');
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create the share image.');
    const width = Math.max(1200, PAD * 2 + 100 + model.columns.length * 150);
    const contentWidth = width - PAD * 2;
    const columns = [{ width: model.columns.length ? 100 : contentWidth, title: 'Betting book' },
      ...model.columns.map(column => ({ id: column.id, title: column.label ?? column.id,
        width: (contentWidth - 100) / model.columns.length }))];
    const header = [
      block(ctx, model.title || 'Best devigs by book', contentWidth, { size: 26, weight: 700, lineHeight: 32 }),
      block(ctx, model.subtitle, contentWidth, { size: 16, weight: 600, color: colors.accent }),
      block(ctx, model.description, contentWidth, { size: 13, color: colors.muted }),
      block(ctx, model.period, contentWidth, { size: 14 }),
      block(ctx, model.scope, contentWidth, { size: 12, color: colors.muted }),
      block(ctx, model.criteria, contentWidth, { size: 12, color: colors.muted }),
      block(ctx, model.pageLabel, contentWidth, { size: 12, color: colors.accent }),
    ].filter(item => item.height);
    const tableHeaders = columns.map(column => [block(ctx, column.title, column.width - 16, { size: 13, weight: 600 })]);
    const headingHeight = Math.max(...tableHeaders.map(items =>
      items.reduce((height, item) => height + item.height, 0))) + 16;
    const rows = model.rows.map(row => {
      const references = Array.isArray(row.cells) ? row.cells : [];
      const cells = [[
        cellLayout(ctx, row.bookLabel || row.book, columns[0].width - 16, { size: 16, weight: 700, color: colors.accent, gap: 4 }),
        cellLayout(ctx, row.bookName !== row.bookLabel ? row.bookName : '', columns[0].width - 16,
          { size: 11, color: colors.muted }),
      ].filter(item => item.height), ...columns.slice(1).map(column => strategyCell(ctx,
        references.find(cell => cell.reference === column.id), column.width - 16))];
      return { cells, height: Math.max(54, ...cells.map(cell => cellHeight(cell) + 16)) };
    });
    const notes = (Array.isArray(model.footnotes) ? model.footnotes : [])
      .map(note => block(ctx, note, contentWidth - 12, { size: 11, color: colors.muted }))
      .filter(item => item.height);
    const generated = block(ctx, [model.generated, 'evsharps.com'].filter(Boolean).join(' · '), contentWidth, { size: 11, color: colors.muted });
    const empty = rows.length ? null : block(ctx, 'No performers match these filters.', contentWidth - 32,
      { size: 14, color: colors.muted });
    const brandY = 22;
    const headerY = 56;
    const tableY = headerY + header.reduce((height, item) => height + item.height + 3, 0) + 14;
    const tableHeight = headingHeight + (rows.length ? rows.reduce((height, row) => height + row.height, 0) : empty.height + 24);
    const footerY = tableY + tableHeight + 16;
    const footerHeight = notes.reduce((height, item) => height + item.height + 4, 0)
      + (generated.height ? generated.height + 8 : 0);
    const height = Math.ceil(footerY + footerHeight + PAD);

    // Resizing resets the context; all draw state is assigned again below.
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    if (canvas.style) {
      canvas.style.width = `${width}px`;
      canvas.style.height = 'auto';
      canvas.style.maxWidth = '100%';
    }
    canvas.setAttribute?.('aria-label', `${text(model.title || 'Best performers')} - ${text(model.subtitle)} - ${text(model.period)}`);
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, 0, width, 4);
    paintBlock(ctx, block(ctx, '+EV', contentWidth, { size: 20, weight: 800, color: colors.accent }), PAD, brandY);
    setFont(ctx, 20, 800);
    const brandOffset = ctx.measureText('+EV ').width;
    paintBlock(ctx, block(ctx, 'SHARPS', contentWidth, { size: 20, weight: 800 }), PAD + brandOffset, brandY);

    let y = headerY;
    header.forEach(item => { y = paintBlock(ctx, item, PAD, y) + 3; });
    ctx.fillStyle = colors.header;
    ctx.fillRect(PAD, tableY, contentWidth, headingHeight);
    let x = PAD;
    tableHeaders.forEach((items, index) => {
      const column = columns[index];
      let labelY = tableY + 8;
      items.forEach(item => { labelY = paintBlock(ctx, item, x + (column.right ? column.width - 8 : 8), labelY, column.right); });
      x += column.width;
    });
    y = tableY + headingHeight;
    if (empty) {
      ctx.fillStyle = colors.panel;
      ctx.fillRect(PAD, y, contentWidth, empty.height + 24);
      paintBlock(ctx, empty, PAD + 8, y + 12);
    }
    rows.forEach((row, index) => {
      ctx.fillStyle = index % 2 ? colors.alternate : colors.panel;
      ctx.fillRect(PAD, y, contentWidth, row.height);
      ctx.fillStyle = colors.border;
      ctx.fillRect(PAD, y, contentWidth, 1);
      let columnX = PAD;
      row.cells.forEach((items, columnIndex) => {
        const column = columns[columnIndex];
        if (columnIndex) {
          ctx.fillStyle = colors.border;
          ctx.fillRect(columnX, y, 1, row.height);
        }
        paintCell(ctx, items, columnX + 8, y + 8);
        columnX += column.width;
      });
      y += row.height;
    });
    ctx.fillStyle = colors.border;
    ctx.fillRect(PAD, tableY + tableHeight, contentWidth, 1);
    y = footerY;
    notes.forEach(item => {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(PAD + 2, y + 5, 3, 3);
      y = paintBlock(ctx, item, PAD + 12, y) + 4;
    });
    if (generated.height) paintBlock(ctx, generated, PAD, y + 8);
    return canvas;
  }

  const api = { drawCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DevigResultsShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
