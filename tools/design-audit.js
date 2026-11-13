/* tools/design-audit.js — checks the page that is currently open against /DESIGN.md.
 *
 * Usage (browser console, or Claude through the browser tool, on http://127.0.0.1:8000 or http://localhost:8000):
 *   paste this file, then:   designAudit.run()            -> { summary, violations }
 *                             designAudit.run({verbose:true})   -> also lists every group
 * It looks at what is visible right now, so open each page / dialog / sheet and run it again.
 * When a modal dialog is open only that dialog is checked.
 *
 * Keep the constants below in sync with DESIGN.md (sections 2, 5 and 6).
 */
(() => {
  const SPEC = {
    fontSizes: [12, 14, 16, 20, 24, 32, 40, 48],          // DESIGN.md 2.2 (+ clamp ranges and display roles below)
    weights: [400, 500, 700, 900],
    radii: ['0px', '2px'],
    minGap: 8,                                            // DESIGN.md 5
    heights: [                                            // DESIGN.md 2.5  [selector, expected px, tolerance]
      ['.tabs a,.tabs button,.tv-seg button', 40, 1],
      ['.chip,.tv-chip', 36, 1],
      ['nav.pager button', 44, 1],
      ['a.home-primary,button.home-ghost', 52, 1],
      ['.tag,.tv-pill', 24, 1],
      ['input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select', 44, 1],
      ['.top nav a,.tv-dock a,.tv-dock button', 44, 1],
      ['[data-close],.tv-close', 44, 1],
      ['button:not(.tv-card):not(.tv-pill button)', 44, 1],
    ],
    sansFonts: ['"Helvetica Neue"', 'Helvetica', 'Arial'],
    serifFonts: ['"Noto Serif KR"', '"Times New Roman"', 'Georgia', '"Instrument Serif"'],
    colors: [                                             // DESIGN.md 2.1 as r,g,b
      [17, 17, 17], [58, 56, 50], [241, 239, 233], [251, 250, 246], [255, 255, 255],
      [92, 88, 80], [212, 208, 196], [11, 9, 7], [20, 16, 12], [184, 180, 168], [0, 0, 0],
    ],
  };
  // DESIGN.md section 6: places that may differ (photos, media cards, display type, floating label)
  const MEDIA = '.globe-world,.pile-screen,.pp-strip,.tv-grid .tv-card,.tv-results .tv-card,.tv-pile,.news-screen,.video-screen,.tv-screen,iframe,img,.pp-strip a';
  const DISPLAY = '.home-copy h1,.pp-title,.pp-dates,.pp-words div';

  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const desc = e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '') + ' "' + (e.getAttribute('aria-label') || e.textContent || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 12) + '"';
  const px = v => parseFloat(v);
  const rgb = c => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const near = (a, b, t = 2) => Math.abs(a - b) <= t;

  function scope() {
    const modal = [...document.querySelectorAll('dialog[open]')].pop();
    const root = modal || document.body;
    const all = [...root.querySelectorAll('*')].filter(vis).filter(e => !e.closest('[hidden]'));
    return { root, modal, all };
  }

  function run(opts = {}) {
    const { all, modal } = scope();
    const v = [];
    const add = (rule, el, detail) => v.push({ rule, el: desc(el), detail });
    const inMedia = e => !!e.closest(MEDIA);
    const isDisplay = e => !!e.closest(DISPLAY);

    for (const el of all) {
      const s = getComputedStyle(el);
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

      if (hasText && !inMedia(el)) {
        const fs = px(s.fontSize);
        const floating = el.matches('.tv-intro h1');
        const h1Range = el.matches('.hero h1') && fs >= 32 && fs <= 48;
        if (fs < 12) add('font-min-12', el, fs + 'px');
        else if (!isDisplay(el) && !h1Range && !floating && !SPEC.fontSizes.some(f => near(fs, f, .5))) add('font-ladder', el, fs + 'px');
        const w = parseInt(s.fontWeight);
        if (!SPEC.weights.includes(w)) add('font-weight', el, String(w));
        const fam = s.fontFamily;
        const ok = SPEC.sansFonts.concat(SPEC.serifFonts).some(f => fam.startsWith(f));
        if (!ok) add('font-family', el, fam.slice(0, 40));
      }

      if (!inMedia(el)) {
        const br = s.borderTopLeftRadius;
        if (px(br) > 0 && !SPEC.radii.includes(br)) add('radius', el, br);
        const c = rgb(s.color), b = rgb(s.backgroundColor), bc = rgb(s.borderTopColor);
        for (const [kind, col] of [['text', c], ['background', b], ['border', s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none' ? bc : null]]) {
          if (!col || col.a === 0) continue;
          if (!SPEC.colors.some(k => near(k[0], col.r, 1) && near(k[1], col.g, 1) && near(k[2], col.b, 1))) add('color', el, kind + ' rgb(' + col.r + ',' + col.g + ',' + col.b + ')');
        }
      }
    }

    // control heights
    for (const [sel, want, tol] of SPEC.heights) {
      const seen = new Set();
      for (const el of all.filter(e => e.matches(sel))) {
        if (inMedia(el) || seen.has(el)) continue;
        seen.add(el);
        // a more specific kind earlier in the list owns the element
        const owner = SPEC.heights.find(([s2]) => el.matches(s2));
        if (owner && owner[0] !== sel) continue;
        const h = el.getBoundingClientRect().height;
        if (!near(h, want, tol)) add('control-height', el, Math.round(h) + 'px (want ' + want + ')');
      }
    }

    // textarea minimum
    for (const el of all.filter(e => e.matches('textarea'))) if (el.getBoundingClientRect().height < 111) add('control-height', el, 'textarea under 112px');

    // spacing: interactive neighbours must not touch or overlap
    const inter = all.filter(e => e.matches('button,a[href],input:not([type=hidden]),select,textarea') && !inMedia(e) && !e.closest('.pp-vert'));
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
      const a = inter[i], b = inter[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.parentElement === b.parentElement && a.parentElement.matches('.tabs,.tv-seg')) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const dx = Math.max(ra.left - rb.right, rb.left - ra.right), dy = Math.max(ra.top - rb.bottom, rb.top - ra.bottom);
      let kind = null, gap = 0;
      if (dx < 0 && dy < 0) { kind = 'overlap'; gap = Math.round(Math.min(-dx, -dy)); }
      else if (dx < 0 && dy >= 0 && dy < SPEC.minGap - .5) { kind = 'vertical-gap'; gap = Math.round(dy); }
      else if (dy < 0 && dx >= 0 && dx < SPEC.minGap - .5) { kind = 'horizontal-gap'; gap = Math.round(dx); }
      if (kind) add('spacing-' + kind, a, 'with ' + desc(b) + ' = ' + gap + 'px (min ' + SPEC.minGap + ')');
    }

    // text blocks that collide
    const texts = all.filter(e => !inMedia(e) && !e.matches('button,a,option,select,textarea,input,.tv-intro h1,.tv-summary') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) add('text-overlap', a, 'with ' + desc(b));
    }

    // text that spills out of its box
    for (const el of all.filter(e => e.matches('button,.tag,.tv-pill,.chip,.tv-chip,.tabs a'))) {
      if (!inMedia(el) && el.scrollWidth > el.clientWidth + 1) add('text-clipped', el, 'scrollWidth ' + el.scrollWidth + ' > ' + el.clientWidth);
    }

    // group
    const by = {};
    for (const x of v) { const k = x.rule + ' | ' + x.detail.replace(/with .* = /, ''); (by[k] = by[k] || { n: 0, sample: x.el + ' ' + x.detail }).n++; }
    const summary = { page: location.hash || '#', modal: modal ? (modal.id || 'dialog') : null, checkedElements: all.length, violations: v.length };
    const groups = Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([k, o]) => o.n + '×  ' + k + '   e.g. ' + o.sample);
    return opts.verbose ? { summary, groups, violations: v } : { summary, groups: groups.slice(0, 25) };
  }

  window.designAudit = { run, SPEC };
})();
