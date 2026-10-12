/* Render the reviewed leaderboard model as a self-contained PNG canvas. */
(function (root) {
  'use strict';

  const WIDTH = 1200;
  const SCALE = 2;
  const PAD = 44;
  const FONT = '"Segoe UI", Arial, sans-serif';
  const colors = {
    background: '#111416', panel: '#191f23', alternate: '#1d252a',
    header: '#20292f', border: '#343f46', text: '#e8edf0', muted: '#a6b4be',
    accent: '#90d0ff', positive: '#82e5b3', negative: '#ff9b9b',
  };
  const columns = [
    { width: 60, title: '#' },
    { width: 234, title: 'Betting book', detail: 'Market' },
    { width: 306, title: 'Devig', detail: 'Method' },
    { width: 190, title: 'W-L-P', detail: 'Settled / unresolved' },
    { width: 172, title: 'Net units', right: true },
    { width: 150, title: 'ROI', right: true },
  ];
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
    const size = options.size || 24;
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

  function drawCard(model, ownerDocument) {
    if (!model || !Array.isArray(model.rows)) throw new TypeError('A leaderboard model with rows is required.');
    const doc = ownerDocument || root.document;
    if (!doc || typeof doc.createElement !== 'function') throw new Error('Canvas rendering requires a document.');
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not create the share image.');
    const contentWidth = WIDTH - PAD * 2;
    const header = [
      block(ctx, model.title || 'Best performers', contentWidth, { size: 44, weight: 700, lineHeight: 56 }),
      block(ctx, model.subtitle, contentWidth, { size: 26, weight: 600, color: colors.accent }),
      block(ctx, model.period, contentWidth, { size: 24 }),
      block(ctx, model.scope, contentWidth, { size: 22, color: colors.muted }),
      block(ctx, model.criteria, contentWidth, { size: 22, color: colors.muted }),
    ].filter(item => item.height);
    const tableHeaders = columns.map(column => [
      block(ctx, column.title, column.width - 24, { size: 20, weight: 600 }),
      block(ctx, column.detail, column.width - 24, { size: 20, color: colors.muted }),
    ]);
    const headingHeight = Math.max(...tableHeaders.map(items =>
      items.reduce((height, item) => height + item.height, 0))) + 28;
    const rows = model.rows.map((row, index) => {
      const labels = [
        [{ value: row.rank == null ? index + 1 : row.rank, color: colors.muted, size: 22 }],
        [{ value: row.bookLabel, weight: 600 }, { value: row.marketLabel, color: colors.muted, size: 20 }],
        [{ value: row.referenceLabel, weight: 600 }, { value: row.methodLabel, color: colors.muted, size: 20 }],
        [{ value: row.recordLabel, weight: 600, size: 22 },
          { value: row.settled == null ? '' : `${text(row.settled)} settled`, color: colors.muted, size: 20 },
          { value: row.unresolvedLabel, color: colors.muted, size: 20 }],
        [{ value: row.profitLabel, weight: 650, color: signColor(row.profit) }],
        [{ value: row.roiLabel, weight: 650, color: signColor(row.roi) }],
      ];
      const cells = labels.map((items, column) => items.map(item =>
        block(ctx, item.value, columns[column].width - 24, item)).filter(item => item.height));
      const height = Math.max(100, ...cells.map(items =>
        items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * 5 + 36));
      return { cells, height };
    });
    const notes = (Array.isArray(model.footnotes) ? model.footnotes : [])
      .map(note => block(ctx, note, contentWidth - 20, { size: 20, color: colors.muted }))
      .filter(item => item.height);
    const generated = block(ctx, model.generated, contentWidth, { size: 20, color: colors.muted });
    const empty = rows.length ? null : block(ctx, 'No performers match these filters.', contentWidth - 32,
      { size: 24, color: colors.muted });
    const brandY = 38;
    const headerY = 102;
    const tableY = headerY + header.reduce((height, item) => height + item.height + 9, 0) + 25;
    const tableHeight = headingHeight + (rows.length ? rows.reduce((height, row) => height + row.height, 0) : empty.height + 44);
    const footerY = tableY + tableHeight + 30;
    const footerHeight = notes.reduce((height, item) => height + item.height + 11, 0)
      + (generated.height ? generated.height + 16 : 0);
    const height = Math.ceil(footerY + footerHeight + PAD);

    // Resizing resets the context; all draw state is assigned again below.
    canvas.width = WIDTH * SCALE;
    canvas.height = height * SCALE;
    if (canvas.style) {
      canvas.style.width = `${WIDTH}px`;
      canvas.style.height = 'auto';
      canvas.style.maxWidth = '100%';
    }
    canvas.setAttribute?.('aria-label', `${text(model.title || 'Best performers')} — ${text(model.subtitle)} — ${text(model.period)}`);
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, 0, WIDTH, 6);
    paintBlock(ctx, block(ctx, '+EV', contentWidth, { size: 28, weight: 800, color: colors.accent }), PAD, brandY);
    setFont(ctx, 28, 800);
    const brandOffset = ctx.measureText('+EV ').width;
    paintBlock(ctx, block(ctx, 'SHARPS', contentWidth, { size: 28, weight: 800 }), PAD + brandOffset, brandY);

    let y = headerY;
    header.forEach(item => { y = paintBlock(ctx, item, PAD, y) + 9; });
    ctx.fillStyle = colors.header;
    ctx.fillRect(PAD, tableY, contentWidth, headingHeight);
    let x = PAD;
    tableHeaders.forEach((items, index) => {
      const column = columns[index];
      let labelY = tableY + 14;
      items.forEach(item => { labelY = paintBlock(ctx, item, x + (column.right ? column.width - 12 : 12), labelY, column.right); });
      x += column.width;
    });
    y = tableY + headingHeight;
    if (empty) {
      ctx.fillStyle = colors.panel;
      ctx.fillRect(PAD, y, contentWidth, empty.height + 44);
      paintBlock(ctx, empty, PAD + 16, y + 22);
    }
    rows.forEach((row, index) => {
      ctx.fillStyle = index % 2 ? colors.alternate : colors.panel;
      ctx.fillRect(PAD, y, contentWidth, row.height);
      ctx.fillStyle = colors.border;
      ctx.fillRect(PAD, y, contentWidth, 1);
      let columnX = PAD;
      row.cells.forEach((items, columnIndex) => {
        const column = columns[columnIndex];
        let labelY = y + 18;
        items.forEach(item => {
          labelY = paintBlock(ctx, item, columnX + (column.right ? column.width - 12 : 12), labelY, column.right) + 5;
        });
        columnX += column.width;
      });
      y += row.height;
    });
    ctx.fillStyle = colors.border;
    ctx.fillRect(PAD, tableY + tableHeight, contentWidth, 1);
    y = footerY;
    notes.forEach(item => {
      ctx.fillStyle = colors.accent;
      ctx.fillRect(PAD + 2, y + 10, 5, 5);
      y = paintBlock(ctx, item, PAD + 20, y) + 11;
    });
    if (generated.height) paintBlock(ctx, generated, PAD, y + 16);
    return canvas;
  }

  const api = { drawCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DevigResultsShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
