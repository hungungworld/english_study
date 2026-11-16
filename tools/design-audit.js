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
      ['.tabs a,.tv-seg button', 40, 1],
      ['.tabs button,.filters-right select,[data-board-author]', 32, 1],
      ['.pr-group a,.pr-group button', 32, 1],
      ['.hero > button,.pr-head > button', 36, 1],
      ['button[data-scrap-reset],button[data-prefs-reset],button[data-reset-filters]:not(.tv-pill *):not(.tv-link),button[data-remove-word],button[data-more],button[data-reload],button[data-refresh],button[data-edit-word],button[data-delete-word]', 36, 1],  // Compact tier
      ['.scroll-glow', 96, 1],                             // home scroll cue (DESIGN.md 6-8): a tall soft light, not a regular button
      ['.tv-about-btn', 34, 1],                            // inside the 36px Explore pill (1px border each side)
      ['.chip,.tv-chip', 36, 1],
      ['nav.pager button', 44, 1],
      ['a.home-primary,button.home-ghost', 44, 1],
      ['.tag,.tv-pill', 24, 1],
      ['input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select', 44, 1],
      ['.top nav a,.tv-dock a,.tv-dock button', 44, 1],
      ['[data-close],.tv-close', 44, 1],
      ['button:not(.tv-card):not(.tv-pill button)', 44, 1],
    ],
    sansFonts: ['"Helvetica Neue"', 'Helvetica', 'Arial'],
    serifFonts: ['"Noto Serif KR"', '"Times New Roman"', 'Georgia', '"Instrument Serif"'],
    colors: [                                             // DESIGN.md 2.1 as r,g,b
      [17, 17, 17], [239, 236, 230], [243, 241, 236], [58, 56, 50], [241, 239, 233], [251, 250, 246], [255, 255, 255],
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
    const modal = [...document.querySelectorAll('dialog[open],.pp-prefs:not([hidden])')].pop();
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
        const h1Range = el.matches('.hero h1,.pr-head h1') && fs >= 32 && fs <= 48;
        if (fs < 12) add('font-min-12', el, fs + 'px');
        else if (!isDisplay(el) && !h1Range && !floating && !SPEC.fontSizes.some(f => near(fs, f, .5))) add('font-ladder', el, fs + 'px');
        const w = parseInt(s.fontWeight);
        if (!SPEC.weights.includes(w)) add('font-weight', el, String(w));
        const fam = s.fontFamily;
        const ok = SPEC.sansFonts.concat(SPEC.serifFonts).some(f => fam.startsWith(f));
        if (!ok) add('font-family', el, fam.slice(0, 40));
      }

      if (hasText && !inMedia(el) && el.getClientRects().length && s.visibility !== 'hidden') {
        // 글자와 실제 바탕(겹친 반투명 층 포함)의 대비 4.5:1 (큰 글자 3:1). 흰 바탕에 종이색 글자 같은 실수를 잡는다.
        const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        const lum = c => .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b);
        const layers = [];
        for (let n = el; n; n = n.parentElement) { const b = rgb(getComputedStyle(n).backgroundColor); if (b && b.a > 0) { layers.push(b); if (b.a >= 1) break; } }
        let base = document.body.classList.contains('media-mode') ? { r: 11, g: 9, b: 7 } : { r: 241, g: 239, b: 233 };
        for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; }
        const fg = rgb(s.color);
        if (fg) {
          const l1 = lum(fg), l2 = lum(base), ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
          const large = px(s.fontSize) >= 24 || (px(s.fontSize) >= 19 && parseInt(s.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5) && !el.disabled) add('contrast', el, ratio.toFixed(1) + ':1');
        }
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

    // 글자 중요도: 홈 포스터에는 글자 색이 3단계 이상 보여야 한다 (DESIGN.md 2.2.1)
    const poster = document.querySelector('.home-paper');
    if (poster && !modal) {
      const tones = new Set();
      for (const el of [...poster.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length)) tones.add(getComputedStyle(el).color);
      if (tones.size < 3) add('text-hierarchy', poster, '글자 색이 ' + tones.size + '단계뿐');
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
    const inter = all.filter(e => e.matches('button,a[href],input:not([type=hidden]),select,textarea') && !inMedia(e) && !e.closest('.pp-vert,.sr-only'));
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
      const a = inter[i], b = inter[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.closest('.tv-wordbar') !== b.closest('.tv-wordbar')) continue;   // the sticky word bar floats above the scrolling article
      if (a.parentElement === b.parentElement && a.parentElement.matches('.tabs,.tv-seg,.tv-dock')) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const dx = Math.max(ra.left - rb.right, rb.left - ra.right), dy = Math.max(ra.top - rb.bottom, rb.top - ra.bottom);
      let kind = null, gap = 0;
      if (dx < 0 && dy < 0) { kind = 'overlap'; gap = Math.round(Math.min(-dx, -dy)); }
      else if (dx < 0 && dy >= 0 && dy < SPEC.minGap - .5) { kind = 'vertical-gap'; gap = Math.round(dy); }
      else if (dy < 0 && dx >= 0 && dx < SPEC.minGap - .5) { kind = 'horizontal-gap'; gap = Math.round(dx); }
      if (kind) add('spacing-' + kind, a, 'with ' + desc(b) + ' = ' + gap + 'px (min ' + SPEC.minGap + ')');
    }

    // selected state: a pressed segment, chip or tab must look different from an unpressed sibling (DESIGN.md 10)
    const looks = el => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.fontWeight, c.borderBottomColor, c.borderBottomWidth, c.textDecorationLine].join('|'); };
    for (const group of new Set(all.filter(e => e.matches('[aria-pressed=true]') && !inMedia(e)).map(e => e.parentElement))) {
      const kids = [...group.children].filter(k => k.hasAttribute('aria-pressed'));
      const on = kids.find(k => k.getAttribute('aria-pressed') === 'true'), off = kids.find(k => k.getAttribute('aria-pressed') === 'false');
      if (on && off && looks(on) === looks(off)) add('selected-state', on, 'looks the same as an unselected sibling');
    }
    for (const input of all.filter(e => e.matches('.chip-radio input:checked'))) {
      const label = input.closest('.chip-radio'), other = [...label.parentElement.querySelectorAll('.chip-radio input:not(:checked)')][0];
      if (other && looks(input.nextElementSibling) === looks(other.nextElementSibling)) add('selected-state', input.nextElementSibling, 'checked chip looks the same as an unchecked one');
    }

    // text stacked right above a control: DESIGN.md 5 wants at least 16px between a line of text and the button, link-button or field under it
    const stackControls = all.filter(e => e.matches('button,a.tv-out,a.home-primary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea') && !inMedia(e) && !e.closest('.tv-pill,.pp-vert,.tabs,.tv-seg,.pr-group,.chip-radio,.pager,.tv-dock,.top,.tv-sheet-row,.scrap-topics,.tv-topics,.pp-prefs-topics,.week-dots,.tag-options'));
    const stackText = all.filter(e => !inMedia(e) && !e.closest('button,a,label,legend,option,.pr-group,.sr-only') && !e.matches('label,legend,b,.pp-k,.sr-only') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    for (const c of stackControls) {
      const rc = c.getBoundingClientRect();
      for (const t of stackText) {
        if (t.contains(c) || c.contains(t)) continue;
        if (t.closest('.tv-wordbar') !== c.closest('.tv-wordbar')) continue;
        const rt = t.getBoundingClientRect();
        const overlap = Math.min(rt.right, rc.right) - Math.max(rt.left, rc.left);
        const gap = rc.top - rt.bottom;
        if (overlap > 8 && gap >= -1 && gap < 15.5) add('text-control-gap', c, Math.round(gap) + 'px under "' + t.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '" (min 16)');
      }
    }

    // text blocks that collide
    const texts = all.filter(e => !inMedia(e) && !e.matches('button,a,option,select,textarea,input,.tv-intro h1,.tv-summary') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.closest('.tv-wordbar') !== b.closest('.tv-wordbar')) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) add('text-overlap', a, 'with ' + desc(b));
    }

    // line breaks: a last line holding one short word, or a line ending in a function word, reads badly (see DESIGN.md 2.6)
    const WEAK = new Set(['a','an','the','and','or','of','to','in','on','for','with','at','by','from','as','is','are','&','·','–','—','not','your','our','this','that','my','its']);
    const lineWords = el => {
      const words = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const re = /\S+/g; let m;
        while ((m = re.exec(n.textContent))) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          const b = r.getClientRects()[0]; if (b && b.width) words.push({w: m[0], top: Math.round(b.top)});
        }
      }
      const lines = [];
      for (const w of words) { const last = lines[lines.length - 1]; if (last && Math.abs(last.top - w.top) < 6) last.words.push(w.w); else lines.push({top: w.top, words: [w.w]}); }
      return lines.map(l => l.words);
    };
    // .tv-article holds article text (The Guardian) that we cannot reword, so its line breaks are left to text-wrap: pretty.
    for (const el of all.filter(e => !inMedia(e) && !e.closest('.sr-only,.tv-article') && !e.matches('.sr-only,option,select,textarea,input') && !e.querySelector('br') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))) {
      const lines = lineWords(el);
      if (lines.length < 2) continue;
      const last = lines[lines.length - 1];
      if (last.length === 1 && last[0].replace(/\W/g, '').length <= 9) add('line-orphan', el, '"' + last[0] + '" alone on the last line');
      for (const line of lines.slice(0, -1)) {
        const raw = line[line.length - 1];
        if (/[.,;:!?)"”’]$/.test(raw)) continue;           // a word that closes a sentence, clause or quote may end a line
        const end = raw.toLowerCase();
        if (WEAK.has(end)) { add('line-weak-end', el, 'line ends with "' + line[line.length - 1] + '" → ' + lines.map(l => l.join(' ')).join(' / ').slice(0, 90)); break; }
      }
    }

    // text that spills out of its box
    for (const el of all.filter(e => e.matches('button,.tag,.tv-pill,.chip,.tv-chip,.tabs a'))) {
      if (!inMedia(el) && !el.matches('.pp-gear') && el.scrollWidth > el.clientWidth + 1) add('text-clipped', el, 'scrollWidth ' + el.scrollWidth + ' > ' + el.clientWidth);
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
