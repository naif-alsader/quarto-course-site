// Quarto, step by step: builds, quizzes and games. No network, no framework.
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach(c => el.append(c && c.nodeType ? c : document.createTextNode(c ?? '')));
    return el;
  };
  const page = document.body.dataset.page || 'home';

  // Progress lives in this browser only. Private windows may refuse storage.
  const store = {
    get(k) { try { return localStorage.getItem('qc2:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('qc2:' + k, v); } catch (e) { /* not saved */ } },
  };
  const markDone = what => store.set(`done:${page}:${what}`, '1');

  // deterministic shuffle, so a game looks the same for everyone in the room
  const seeded = str => {
    let a = 0; for (const c of str) a = (a * 31 + c.charCodeAt(0)) | 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const shuffle = (arr, key) => {
    const r = seeded(key), out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    if (out.length > 1 && out.every((x, i) => x === arr[i])) out.push(out.shift());
    return out;
  };
  const data = el => JSON.parse(el.querySelector('script[type="application/json"]').textContent);

  // ---- builds: a HyperFrames player plus clickable steps ----
  function initBuild(el) {
    const p = $('hyperframes-player', el);
    // The player's poster rule sets `inset: 0` but no size, so the image shows at
    // its natural 1280 px and is cropped on any narrower player. Size it to fit.
    if (p.shadowRoot) {
      const fix = document.createElement('style');
      fix.textContent = '.hfp-poster { width: 100%; height: 100%; }';
      p.shadowRoot.appendChild(fix);
    }
    const items = $$('.steps li', el);
    const T = items.map(li => +li.dataset.t), D = items.map(li => +li.dataset.d);
    let stopAt = null, cur = 0;
    const whenReady = fn => (p.ready ? fn() : p.addEventListener('ready', fn, { once: true }));
    const show = () => {
      const t = p.currentTime || 0;
      let k = 0; T.forEach((x, i) => { if (t >= x - 0.02) k = i; });
      cur = k;
      items.forEach((li, i) => {
        li.classList.toggle('on', i === k);
        if (i <= k && t > 0.3) li.classList.add('seen');
      });
      if (k === items.length - 1 && t >= T[k] + 1.6) markDone('build:' + el.dataset.build);
    };
    p.addEventListener('timeupdate', () => {
      if (stopAt !== null && p.currentTime >= stopAt) { p.pause(); stopAt = null; }
      show();
    });
    const go = k => whenReady(() => {
      k = Math.max(0, Math.min(items.length - 1, k));
      p.pause(); p.seek(T[k]); stopAt = T[k] + D[k] - 0.08; p.play(); cur = k; show();
    });
    items.forEach((li, i) => $('button', li).addEventListener('click', () => go(i)));
    const act = (name, fn) => { const b = $(`[data-act="${name}"]`, el); if (b) b.addEventListener('click', fn); };
    act('prev', () => go(cur - 1));
    act('step', () => go(cur));
    act('next', () => go((p.currentTime || 0) < 0.3 ? 0 : cur + 1));
    act('all', () => whenReady(() => { stopAt = null; p.pause(); p.seek(0); p.play(); }));
  }

  // ---- copy buttons and the try-it timer ----
  function initCopy(btn) {
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('pre').innerText;
      try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
      catch (e) { btn.textContent = 'Select and copy'; }
      setTimeout(() => (btn.textContent = 'Copy'), 1800);
    });
  }
  function initTimer(btn) {
    const out = btn.parentElement.querySelector('.timer');
    let id = null;
    btn.addEventListener('click', () => {
      if (id) { clearInterval(id); id = null; btn.textContent = 'Start timer'; return; }
      let left = +btn.dataset.min * 60;
      const tick = () => { out.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left-- <= 0) { clearInterval(id); id = null; out.textContent = 'Time'; btn.textContent = 'Start timer'; } };
      tick(); id = setInterval(tick, 1000); btn.textContent = 'Stop';
    });
  }

  // ---- quiz: one click per question, then the reason ----
  // The participant edition has no answers in the page: a click only marks your choice.
  function initQuiz(el) {
    const qs = data(el), key = el.dataset.id;
    const open = qs.every(q => q.answer === undefined);
    let answered = 0, right = 0;
    const scoreBox = open
      ? h('div', { class: 'score' }, h('span', {}, 'Pick an answer for each question. The instructor goes through them in the room.'))
      : h('div', { class: 'score' }, h('span', { class: 'big' }, `0/${qs.length}`), h('span', {}, 'Answer each question once.'));
    qs.forEach((q, n) => {
      const box = h('div', { class: 'q' });
      box.append(h('div', { class: 'qn' }, `Question ${n + 1} of ${qs.length}`), h('div', { class: 'qt', html: q.q }));
      if (q.code) box.append(h('div', { class: 'codebox' }, h('pre', {}, q.code)));
      const opts = h('div', { class: 'opts' + (q.options.some(o => o.img) ? ' pics' : '') });
      const why = h('div', { class: 'why', html: q.why || '' });
      q.options.forEach((o, i) => {
        const b = h('button', { class: 'opt', type: 'button' });
        if (o.img) b.append(h('img', { src: o.img, alt: o.alt || '' }));
        b.append(h('span', { html: o.text ?? o }));
        b.addEventListener('click', () => {
          if (open) { [...opts.children].forEach(x => x.classList.toggle('sel', x === b)); return; }
          if (box.dataset.done) return;
          box.dataset.done = '1'; answered++;
          const ok = i === q.answer; if (ok) right++;
          b.classList.add(ok ? 'right' : 'wrong');
          opts.children[q.answer].classList.add('right');
          why.prepend(h('b', {}, ok ? 'Right. ' : 'Not quite. '));
          why.classList.add('show');
          scoreBox.firstChild.textContent = `${right}/${qs.length}`;
          if (answered === qs.length) {
            scoreBox.lastChild.textContent = right === qs.length ? 'All right. Well done.' : 'Read the reasons for the ones you missed.';
            const best = +(store.get(`quiz:${key}`) || 0);
            if (right > best) store.set(`quiz:${key}`, right);
            markDone('quiz:' + key);
          }
        });
        opts.append(b);
      });
      box.append(opts, why);
      el.append(box);
    });
    el.append(scoreBox);
  }

  // ---- games ----
  const games = {
    // tap the items in the right order
    order(el, g) {
      const pool = h('div', { class: 'chips' }), slots = h('div', { class: 'slots' });
      const res = h('div', { class: 'result' });
      const picked = [];
      const items = shuffle(g.items, g.title);
      const draw = () => {
        slots.innerHTML = '';
        if (!picked.length) slots.append(h('span', { class: 'note' }, 'Tap the cards below in order.'));
        picked.forEach((it, i) => {
          if (i) slots.append(h('span', { class: 'arrow' }, '→'));
          slots.append(h('button', { class: 'chip', type: 'button', onclick: () => { picked.splice(i, 1); draw(); } }, it));
        });
        $$('.chip', pool).forEach(c => c.classList.toggle('used', picked.includes(c.dataset.v)));
      };
      items.forEach(it => pool.append(h('button', { class: 'chip', type: 'button', 'data-v': it,
        onclick: () => { if (!picked.includes(it)) { picked.push(it); draw(); res.textContent = ''; } } }, it)));
      const check = h('button', { class: 'btn primary', type: 'button', onclick: () => {
        if (picked.length < g.items.length) { res.className = 'result no'; res.textContent = `Place all ${g.items.length} cards first.`; return; }
        const chips = $$('.chip', slots);
        let ok = 0; picked.forEach((it, i) => { const good = it === g.items[i]; ok += good; chips[i].classList.add(good ? 'right' : 'wrong'); });
        if (ok === g.items.length) { res.className = 'result ok'; res.innerHTML = g.win || 'Correct order.'; markDone('game'); }
        else { res.className = 'result no'; res.textContent = `${ok} of ${g.items.length} in the right place. Tap a card to take it back.`; }
      } }, 'Check');
      const reset = h('button', { class: 'btn', type: 'button', onclick: () => { picked.length = 0; draw(); res.textContent = ''; } }, 'Reset');
      el.append(slots, pool, h('div', { class: 'tools', style: 'padding:14px 0 0' }, check, reset), res);
      draw();
    },

    // tap a left card, then its partner on the right
    match(el, g) {
      const left = h('div', { class: 'col' }), right = h('div', { class: 'col' });
      const res = h('div', { class: 'result' });
      let sel = null, done = 0, miss = 0;
      const mono = g.mono === 'left' ? [true, false] : g.mono === 'both' ? [true, true] : [false, false];
      g.pairs.forEach(([a], i) => left.append(h('button', { class: 'chip' + (mono[0] ? ' mono' : ''), type: 'button', 'data-i': i,
        onclick: e => { if (e.currentTarget.disabled) return; $$('.chip', left).forEach(c => c.classList.remove('sel')); e.currentTarget.classList.add('sel'); sel = i; } }, a)));
      shuffle(g.pairs.map((p, i) => i), g.title).forEach(i => right.append(h('button', { class: 'chip' + (mono[1] ? ' mono' : ''), type: 'button',
        onclick: e => {
          const b = e.currentTarget; if (b.disabled) return;
          if (sel === null) { res.className = 'result'; res.textContent = 'Pick a card on the left first.'; return; }
          const lb = $(`[data-i="${sel}"]`, left);
          if (sel === i) {
            [b, lb].forEach(x => { x.classList.remove('sel'); x.classList.add('right'); x.disabled = true; });
            sel = null; done++;
            if (done === g.pairs.length) { res.className = 'result ok'; res.textContent = miss ? `All matched, with ${miss} wrong ${miss === 1 ? 'try' : 'tries'}.` : 'All matched, no mistakes.'; markDone('game'); }
          } else {
            miss++; b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 500);
          }
        } }, g.pairs[i][1])));
      el.append(h('div', { class: 'match' }, left, right), res);
    },

    // click the line that breaks the render
    bug(el, g) {
      const box = h('div', { class: 'buglines' }), res = h('div', { class: 'result' });
      const bad = new Set(g.bad); let found = 0;
      g.code.replace(/\n+$/, '').split('\n').forEach((line, i) => {
        const n = i + 1;
        box.append(h('button', { type: 'button', onclick: e => {
          const b = e.currentTarget; if (b.dataset.done) return;
          if (bad.has(n)) {
            b.dataset.done = '1'; b.classList.add('right'); found++;
            if (found === bad.size) { res.className = 'result ok'; res.innerHTML = g.why; markDone('game'); }
            else { res.className = 'result'; res.textContent = `Found ${found} of ${bad.size}. Keep looking.`; }
          } else { b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 600); }
        } }, h('span', { class: 'no' }, String(n)), line || ' '));
      });
      el.append(box, res);
    },

    // true or false against the clock
    speed(el, g) {
      const card = h('div', { class: 'card' }, `${g.items.length} statements, ${g.seconds} seconds. True or false?`);
      const bar = h('div', { class: 'bar' }, h('i', {}));
      const res = h('div', { class: 'result' }), review = h('ol', { class: 'review' });
      const tf = h('div', { class: 'tf' });
      let i = 0, score = 0, timer = null, left = 0, wrong = [];
      const items = shuffle(g.items, g.title);
      const end = () => {
        clearInterval(timer); timer = null; tf.innerHTML = '';
        card.textContent = `Score: ${score} of ${items.length}`;
        res.className = 'result ' + (score === items.length ? 'ok' : 'no');
        res.textContent = score === items.length ? 'Perfect round.' : 'The ones you missed:';
        review.innerHTML = '';
        wrong.forEach(w => review.append(h('li', { html: `${w.s} <b>${w.a ? 'True' : 'False'}</b>. ${w.why || ''}` })));
        tf.append(h('button', { type: 'button', onclick: start }, 'Play again'));
        if (score >= Math.ceil(items.length * 0.8)) markDone('game');
      };
      const next = () => { if (i >= items.length) return end(); card.innerHTML = items[i].s; };
      const answer = a => { if (!timer) return; const it = items[i]; if (a === it.a) score++; else wrong.push(it); i++; next(); };
      function start() {
        i = 0; score = 0; wrong = []; left = g.seconds; res.textContent = ''; review.innerHTML = '';
        tf.innerHTML = '';
        tf.append(h('button', { type: 'button', onclick: () => answer(true) }, 'True'), h('button', { type: 'button', onclick: () => answer(false) }, 'False'));
        bar.firstChild.style.width = '100%'; next();
        timer = setInterval(() => { left -= 0.1; bar.firstChild.style.width = Math.max(0, left / g.seconds * 100) + '%'; if (left <= 0) end(); }, 100);
      }
      tf.append(h('button', { type: 'button', onclick: start }, 'Start'));
      el.append(bar, card, tf, res, review);
    },

    // type the missing piece
    fill(el, g) {
      const box = h('div', { class: 'codebox fill' }); const pre = h('pre');
      const inputs = [];
      g.code.split(/(\[\[[^\]]+\]\])/).forEach(part => {
        const m = part.match(/^\[\[(.+)\]\]$/);
        if (m) {
          const ok = m[1].split('|').map(s => s.trim());  // code is case-sensitive
          const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'missing code' });
          inp.style.width = Math.max(5, ok[0].length + 1) + 'ch';
          inp.dataset.ok = JSON.stringify(ok); inputs.push(inp); pre.append(inp);
        } else pre.append(part);
      });
      box.append(pre);
      const res = h('div', { class: 'result' });
      const check = h('button', { class: 'btn primary', type: 'button', onclick: () => {
        let good = 0;
        inputs.forEach(inp => { const ok = JSON.parse(inp.dataset.ok).includes(inp.value.trim());
          inp.classList.toggle('right', ok); inp.classList.toggle('wrong', !ok); good += ok; });
        if (good === inputs.length) { res.className = 'result ok'; res.innerHTML = g.why; markDone('game'); }
        else { res.className = 'result no'; res.textContent = `${good} of ${inputs.length} right.`; }
      } }, 'Check');
      const show = h('button', { class: 'btn', type: 'button', onclick: () => {
        inputs.forEach(inp => { inp.value = JSON.parse(inp.dataset.ok)[0]; inp.classList.add('right'); });
        res.className = 'result'; res.innerHTML = g.why;
      } }, 'Show answer');
      el.append(box, h('div', { class: 'tools', style: 'padding:12px 0 0' }, check, show), res);
    },
  };

  // ---- lab checklist ----
  function initChecklist(ul) {
    $$('input', ul).forEach(inp => {
      const k = `lab:${page}:${inp.value}`;
      if (store.get(k)) { inp.checked = true; inp.parentElement.classList.add('done'); }
      inp.addEventListener('change', () => {
        store.set(k, inp.checked ? '1' : ''); inp.parentElement.classList.toggle('done', inp.checked);
        if ($$('input', ul).every(x => x.checked)) markDone('lab');
      });
    });
  }

  // ---- home: ticks for finished pages ----
  function initTicks() {
    $$('[data-tick]').forEach(a => {
      const id = a.dataset.tick;
      let any = false;
      try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith(`qc2:done:${id}:`)) any = true; } catch (e) { /* no storage */ }
      if (any) a.append(h('span', { class: 'tick', title: 'You have started this' }, '✓'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $$('.build').forEach(initBuild);
    $$('.copy').forEach(initCopy);
    $$('.timer-btn').forEach(initTimer);
    $$('.quiz').forEach(initQuiz);
    $$('.game').forEach(el => { const g = data(el); const body = $('.gbody', el); games[g.type](body, g); });
    $$('.checklist').forEach(initChecklist);
    initTicks();
  });
})();
