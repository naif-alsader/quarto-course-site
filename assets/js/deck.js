// The presentation: one slide at a time, arrow keys step through bullets, build steps
// and quiz answers. Builds are HyperFrames players, made only near the current slide.
(function () {
  'use strict';
  // Interface text, in the deck's language (<html lang="ar"> is the Arabic edition)
  const L = document.documentElement.lang === 'ar'
    ? { answer: 'الإجابة', time: 'انتهى الوقت', noNotes: 'لا ملاحظات لهذه الشريحة.', next: 'التالي', last: 'آخر شريحة', letters: 'أبجدهو' }
    : { answer: 'Answer', time: 'Time', noNotes: 'No notes for this slide.', next: 'Next', last: 'Last slide', letters: 'ABCDEF' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const stage = $('#stage');
  const slides = $$('.slide');
  const N = slides.length;
  const presenter = new URLSearchParams(location.search).has('presenter');
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('qc2-deck') : null;
  let cur = -1;

  // ---- fit the 1920 x 1080 stage into the window ----
  function fit() {
    const vp = $('.viewport').getBoundingClientRect();
    const s = Math.min(vp.width / 1920, (vp.height - 6) / 1080);
    stage.style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', fit);

  // ---- builds ----
  const builds = new Map();
  function buildCtl(slide) {
    if (builds.has(slide)) return builds.get(slide);
    const el = $('.bp', slide);
    const T = JSON.parse(el.dataset.t), D = JSON.parse(el.dataset.d);
    let p = null, k = 0, stopAt = null, playing = false;
    const endOf = i => T[i] + D[i] - 0.06;
    const ready = fn => { if (!p) return; if (p.ready) fn(); else p.addEventListener('ready', fn, { once: true }); };
    const ctl = {
      make() {
        if (p) return;
        p = document.createElement('hyperframes-player');
        p.setAttribute('src', el.dataset.src);
        p.setAttribute('runtime-src', el.dataset.src.replace(/[^/]+$/, '') + 'vendor/hyperframe.runtime.iife.js');
        // no poster: in the room a build starts from its first, empty frame and grows on each click
        el.appendChild(p);
        if (p.shadowRoot) {  // the player's poster has no size of its own; see course.js
          const fix = document.createElement('style');
          fix.textContent = '.hfp-poster { width: 100%; height: 100%; }';
          p.shadowRoot.appendChild(fix);
        }
        p.addEventListener('timeupdate', () => {
          if (stopAt !== null && p.currentTime >= stopAt) { p.pause(); playing = false; stopAt = null; }
        });
      },
      drop() { if (p) { p.remove(); p = null; } },
      enter(dir) {
        ctl.make();
        k = dir < 0 ? T.length : 0;
        ready(() => { p.pause(); p.seek(dir < 0 ? endOf(T.length - 1) : 0); });
      },
      leave() { if (p) { p.pause(); playing = false; stopAt = null; } },
      next() {
        if (!p) return false;
        if (playing) { p.pause(); playing = false; stopAt = null; p.seek(endOf(k - 1)); return true; }
        if (k >= T.length) return false;
        const i = k++;
        ready(() => { p.seek(T[i]); stopAt = endOf(i); playing = true; p.play(); });
        return true;
      },
      prev() {
        if (!p || k === 0) return false;
        p.pause(); playing = false; stopAt = null; k--;
        ready(() => p.seek(k ? endOf(k - 1) : 0));
        return true;
      },
    };
    builds.set(slide, ctl);
    return ctl;
  }

  // ---- quiz ----
  function quizCtl(slide) {
    const box = $('.dopts', slide), why = $('.dwhy', slide);
    const open = box.dataset.answer === undefined;  // the participant edition: no answer to reveal
    const ans = +box.dataset.answer;
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      $$('.dopt', box).forEach(b => b.addEventListener('click', () => {
        if (box.dataset.shown) return;
        $$('.dopt', box).forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
      }));
    }
    return {
      shown: () => open || !!box.dataset.shown,
      reveal() {
        if (open) return;
        box.dataset.shown = '1';
        $$('.dopt', box).forEach((b, i) => {
          if (i === ans) b.classList.add('right');
          else if (b.classList.contains('sel')) b.classList.add('wrong');
        });
        why.prepend(Object.assign(document.createElement('b'), { textContent: L.answer + ' ' + L.letters[ans] + '. ' }));
        why.classList.add('show');
      },
      reset() {
        delete box.dataset.shown;
        $$('.dopt', box).forEach(b => b.classList.remove('sel', 'right', 'wrong'));
        const b = $('b', why); if (b && b.textContent.startsWith(L.answer)) b.remove();
        why.classList.remove('show');
      },
    };
  }

  // ---- try-it timer (T) ----
  let timerId = null;
  function toggleTimer() {
    const el = $('.tbig', slides[cur]); if (!el) return;
    if (timerId) { clearInterval(timerId); timerId = null; return; }
    let left = +el.dataset.min * 60; el.classList.remove('done');
    const tick = () => { el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (left-- <= 0) { clearInterval(timerId); timerId = null; el.textContent = L.time; el.classList.add('done'); } };
    tick(); timerId = setInterval(tick, 1000);
  }

  // ---- the quiz room: each quiz played live inside the deck, when room.py serves it ----
  // Opened anywhere else (GitHub Pages, from disk) /api/host does not answer and nothing changes.
  // A quiz slide goes ready -> open (the clock runs on every screen) -> revealed (how the room
  // voted) and, after a run's last question, the leaderboard. A speed game plays its statements
  // one after another. The state lives in room.py, so the speaker view and the projector agree.
  const RL = document.documentElement.lang === 'ar' ? {
    live: 'المسابقة متصلة', open: 'اضغط → لفتح السؤال للقاعة', start: 'اضغط → لبدء الجولة',
    answered: (a, n) => `جاوب ${a} من ${n}`, fastest: (n, s) => `الأسرع: ${n} في ${s} ث`, joinAt: 'ادخل من',
    inRoom: n => `${n} في القاعة`, board: 'الترتيب', top: (k, n) => `أفضل ${k} من ${n}`, noPoints: 'ما فيه نقاط للحين.',
    statement: (i, n) => `العبارة ${i} من ${n}`, speedLead: (n, s) => `${n} عبارات، ${s} ثوانٍ لكل عبارة. صح أو خطأ؟`,
    nobody: 'ما أحد دخل للحين. خلك أول واحد!', scan: 'أو امسح الرمز',
  } : {
    live: 'Quiz room on', open: 'Press → to open the question to the room', start: 'Press → to start the round',
    answered: (a, n) => `${a} of ${n} answered`, fastest: (n, s) => `Fastest: ${n}, ${s} s`, joinAt: 'Join at',
    inRoom: n => `${n} in the room`, board: 'Leaderboard', top: (k, n) => `Top ${k} of ${n}`, noPoints: 'No points yet.',
    statement: (i, n) => `Statement ${i} of ${n}`, speedLead: (n, s) => `${n} statements, ${s} seconds each. True or false?`,
    nobody: 'Nobody yet. Be the first.', scan: 'or scan the code',
  };
  const R = { on: false, v: null, key: '', end: 0, total: 1, raf: 0, busy: false, chain: null, qrFor: '', qr: '', names: new Set() };
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en');
  const sgn = n => '⁦+' + fmt(n) + '⁩';   // +930 keeps its sign in front in Arabic
  const addr = () => R.v.join.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const RING = 2 * Math.PI * 45;

  async function roomPoll() {
    try {
      const r = await fetch('/api/host', { cache: 'no-store' });
      const v = r.ok ? await r.json() : null;
      if (!v || !v.rounds) throw new Error('no room');
      R.v = v;
    } catch (e) { document.body.classList.toggle('room-lost', R.on); return false; }
    document.body.classList.remove('room-lost');
    if (!R.on) {
      R.on = true;
      document.body.classList.add('room-on');
      $('.hud').appendChild(mk('span', 'rlive', RL.live));
      const sc = document.createElement('script'); sc.src = '/static/qrcode.js'; sc.onload = () => { R.key = ''; roomRender(); };
      document.head.appendChild(sc);
    }
    roomRender();
    return true;
  }
  async function roomPost(op, body = {}) {
    R.busy = true;
    try { await fetch('/api/host/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { /* the next poll shows the room as it is */ }
    R.busy = false;
    await roomPoll();
  }

  const roomKey = s => (s && s.dataset.round && R.v && R.v.rounds.some(r => r.id === s.dataset.round)
    ? { rid: s.dataset.round, qi: +(s.dataset.qi ?? -1), n: +s.dataset.qn, speed: s.classList.contains('k-game') } : null);
  const askedOf = k => R.v.asked[k.rid] || [];
  const unasked = (k, from = 0) => { for (let i = from; i < k.n; i++) if (!askedOf(k).includes(i)) return i; return null; };
  function roomView(s) {
    const k = roomKey(s); if (!k) return null;
    const v = R.v, here = v.round && v.round.id === k.rid;
    const live = here && (k.speed || v.round.qi === k.qi);
    if (live && v.phase === 'question') return 'open';
    if (live && v.phase === 'reveal') return 'revealed';
    if (here && v.phase === 'board' && (k.speed || v.round.qi === k.qi)) return 'board';
    if (k.speed) return askedOf(k).length >= k.n ? 'done' : 'ready';
    return askedOf(k).includes(k.qi) ? 'done' : 'ready';
  }
  function speedStep(k) {
    const nx = unasked(k, R.v.round.qi + 1);
    if (nx === null) roomPost('board'); else roomPost('ask', { id: k.rid, qi: nx });
  }
  // → on a room slide: the room's next step, or false to move on as usual
  function roomNext(s) {
    const k = roomKey(s); if (!k) return false;
    if (R.busy) return true;
    const view = roomView(s);
    if (view === 'ready') { roomPost('ask', { id: k.rid, qi: k.speed ? unasked(k) : k.qi }); return true; }
    if (view === 'open') { roomPost('reveal'); return true; }
    if (view === 'revealed' && k.speed) { speedStep(k); return true; }
    if (view === 'revealed' && k.qi === k.n - 1) { roomPost('board'); return true; }
    if (view === 'board') { show(cur + 1, 1); return true; }   // not the local reveal: the room has answered it
    return false;
  }

  function ring(parent) {
    const el = mk('div', 'rring', `<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45" stroke-dasharray="${RING}"/></svg><span></span>`);
    parent.appendChild(el);
    return el;
  }
  function tick() {
    cancelAnimationFrame(R.raf);
    const el = $('.room .rring', slides[cur]); if (!el) return;
    const left = Math.max(0, (R.end - performance.now()) / 1000);
    el.querySelector('.fg').setAttribute('stroke-dashoffset', String(RING * (1 - left / R.total)));
    el.querySelector('span').textContent = String(Math.ceil(left));
    el.classList.toggle('low', left <= 5);
    if (left > 0) R.raf = requestAnimationFrame(tick);
  }
  const strip = box => box.appendChild(mk('div', 'rstrip', `${RL.joinAt} <b>${esc(addr())}</b> · <span class="rin">${esc(RL.inRoom(R.v.count))}</span>`));

  function leaderboard(box, title) {
    const v = R.v, top = v.top || [];
    const lb = mk('div', 'rlb', `<div class="eb">${esc(title)}</div><h2>${RL.board}</h2>`);
    if (!top.length) { lb.appendChild(mk('p', 'rnone', RL.noPoints)); box.appendChild(lb); return; }
    const rows = mk('div', 'rrows'), step = 70;
    rows.style.height = top.length * step + 'px';
    const before = top.slice().sort((a, b) => (a.was ?? 999) - (b.was ?? 999) || a.rank - b.rank);
    top.forEach((p, i) => {
      const moved = p.was ? p.was - p.rank : 0;
      const row = mk('div', `rrow r${p.rank}`,
        `<span class="rrk">${p.rank}</span><span class="rnm">${esc(p.name)}</span>` +
        `<span class="rmv ${moved > 0 ? 'up' : moved < 0 ? 'down' : ''}">${moved > 0 ? '▲' + moved : moved < 0 ? '▼' + -moved : ''}</span>` +
        `<span class="rgain">${p.last ? sgn(p.last) : ''}</span><span class="rsc">${fmt(p.score - p.last)}</span>`);
      row.style.transform = `translateY(${before.indexOf(p) * step}px)`;
      rows.appendChild(row);
      setTimeout(() => {
        row.style.transform = `translateY(${i * step}px)`;
        const sc = row.querySelector('.rsc'), from = p.score - p.last, t0 = performance.now();
        const up = now => { const e = Math.min(1, (now - t0) / 1100); sc.textContent = fmt(Math.round(from + p.last * (1 - Math.pow(1 - e, 3)))); if (e < 1) requestAnimationFrame(up); };
        if (p.last) requestAnimationFrame(up);
      }, 800);
    });
    lb.appendChild(rows);
    if (v.count > top.length) lb.appendChild(mk('p', 'rmore', RL.top(top.length, v.count)));
    box.appendChild(lb);
  }

  function quizRoom(s, box, view) {
    const v = R.v, q = v.q, ctl = quizCtl(s);
    if (view === 'ready') { ctl.reset(); strip(box); box.appendChild(mk('div', 'rhint', RL.open)); return; }
    if (view === 'open') { ctl.reset(); strip(box); ring(box); box.appendChild(mk('div', 'rcount')); return; }
    if (view === 'board') { leaderboard(box, s.dataset.chapter); return; }
    // revealed: the answer, how the room voted, the fastest
    const optsBox = $('.dopts', s);
    if (optsBox.dataset.answer === undefined) $$('.dopt', s)[q.answer]?.classList.add('right');
    else if (!ctl.shown()) ctl.reveal();
    const total = Math.max(1, q.counts.reduce((a, b) => a + b, 0));
    $$('.dopt', s).forEach((b, i) => {
      const bar = mk('i', 'rbar'); b.prepend(bar); b.appendChild(mk('span', 'rn', String(q.counts[i])));
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = (100 * q.counts[i] / total) + '%'; }));
    });
    ring(box);
    if (q.fastest) box.appendChild(mk('div', 'rhint fast', '⚡ ' + esc(RL.fastest(q.fastest.name, q.fastest.s))));
  }

  function speedRoom(s, box, view, k) {
    const v = R.v, q = v.q;
    if (view === 'board') { leaderboard(box, s.dataset.chapter); return; }
    const panel = mk('div', 'rsp');
    if (view === 'ready') {
      panel.appendChild(mk('p', 'rst', esc(RL.speedLead(k.n - askedOf(k).length, 10))));
      box.append(panel); strip(box); box.appendChild(mk('div', 'rhint', RL.start));
      return;
    }
    panel.appendChild(mk('div', 'rsn', esc(RL.statement(v.round.qi + 1, k.n))));
    panel.appendChild(mk('p', 'rst', q.text));
    if (view === 'revealed') {
      const total = Math.max(1, q.counts.reduce((a, b) => a + b, 0));
      const tf = mk('div', 'rtf');
      q.options.forEach((o, i) => {
        const c = mk('div', 'rtfo' + (i === q.answer ? ' right' : ''), `<i class="rbar"></i><b>${esc(o)}</b><span class="rn">${q.counts[i]}</span>`);
        tf.appendChild(c);
        requestAnimationFrame(() => requestAnimationFrame(() => { c.querySelector('.rbar').style.width = (100 * q.counts[i] / total) + '%'; }));
      });
      panel.appendChild(tf);
      if (q.why) panel.appendChild(mk('p', 'rwhy', q.why));
    }
    box.appendChild(panel);
    ring(box);
    if (view === 'open') box.appendChild(mk('div', 'rcount'));
    else if (q.fastest) box.appendChild(mk('div', 'rhint fast', '⚡ ' + esc(RL.fastest(q.fastest.name, q.fastest.s))));
  }

  function joinRoom(s) {
    let box = $('.rjbox', s);
    const url = R.v.join;
    if (!box || box.dataset.url !== url || (window.qrcode && !box.dataset.qr)) {
      $('.rjoin', s).innerHTML = '';
      box = mk('div', 'rjbox');
      box.dataset.url = url;
      const qr = mk('div', 'rqr');
      if (window.qrcode) { const g = qrcode(0, 'M'); g.addData(url); g.make(); qr.innerHTML = g.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); box.dataset.qr = '1'; }
      const side = mk('div', 'rjr');
      side.append(qr, mk('div', 'rscan', esc(RL.scan)));
      box.append(mk('div', 'rjl', `<div class="rurl">${esc(addr())}</div><div class="rnames"></div><div class="rcnt"></div>`), side);
      $('.rjoin', s).appendChild(box);
      R.names = new Set();
    }
    const names = $('.rnames', box), list = R.v.players.map(p => p.name);
    if (!list.length && !names.childElementCount) names.appendChild(mk('span', 'rnone', esc(RL.nobody)));
    if (list.length) names.querySelector('.rnone')?.remove();
    list.forEach(n => { if (!R.names.has(n)) { R.names.add(n); names.appendChild(mk('span', 'rname', esc(n))); } });
    $('.rcnt', box).textContent = RL.inRoom(R.v.count);
  }

  function roomRender() {
    const s = slides[cur];
    if (!R.on || !s) return;
    $$('.room').forEach(x => { if (x.parentElement !== s) { x.parentElement.className = x.parentElement.className.replace(/ ?rm-\w+/g, ''); x.remove(); } });
    if (s.classList.contains('k-join')) return joinRoom(s);
    const k = roomKey(s);
    if (!k) return;
    const v = R.v, q = v.q, view = roomView(s);
    const key = [cur, view, v.round && v.round.qi, v.phase, q && JSON.stringify(q.counts), view === 'board' ? JSON.stringify(v.top) : '', v.lang].join('|');
    if (key !== R.key || !$(':scope > .room', s)) {
      R.key = key;
      $(':scope > .room', s)?.remove();
      $$('.rbar, .rn', s).forEach(x => x.remove());
      s.className = s.className.replace(/ ?rm-\w+/g, '') + ' rm-' + view;
      if (view !== 'done') {
        const box = mk('div', 'room');
        s.appendChild(box);
        if (k.speed) speedRoom(s, box, view, k); else quizRoom(s, box, view);
      }
    }
    const c = $('.room .rcount', s);
    if (c && q) c.textContent = RL.answered(q.answered, v.here || v.count);
    const inr = $('.room .rin', s);
    if (inr) inr.textContent = RL.inRoom(v.count);
    if (q && (view === 'open' || view === 'revealed')) { R.end = performance.now() + (view === 'open' ? q.left : 0) * 1000; R.total = q.seconds; tick(); }
    // a speed round moves itself on, three seconds after each reveal; only the projector's window drives it
    if (k.speed && view === 'revealed' && !presenter) {
      if (!R.chain || R.chain.qi !== v.round.qi) {
        clearTimeout(R.chain && R.chain.t);
        const qi = v.round.qi;
        R.chain = { qi, t: setTimeout(() => { if (slides[cur] === s && roomView(s) === 'revealed' && R.v.round.qi === qi) speedStep(k); }, 3000) };
      }
    }
  }

  // ---- moving ----
  function show(i, dir = 1, quiet = false) {
    i = Math.max(0, Math.min(N - 1, i));
    if (i === cur) return;
    if (cur >= 0) {
      const old = slides[cur];
      old.classList.remove('on');
      if (old.classList.contains('k-build')) buildCtl(old).leave();
      if (timerId) { clearInterval(timerId); timerId = null; }
    }
    cur = i;
    const s = slides[cur];
    s.classList.add('on');
    $$('.frag', s).forEach(f => f.classList.toggle('vis', dir < 0));
    if (s.classList.contains('k-quiz') && dir > 0) quizCtl(s).reset();
    if (s.classList.contains('k-build')) buildCtl(s).enter(dir);
    // players exist only for this slide and its neighbours
    slides.forEach((x, j) => {
      if (!x.classList.contains('k-build')) return;
      if (Math.abs(j - cur) <= 1) buildCtl(x).make(); else if (builds.has(x)) buildCtl(x).drop();
    });
    $('.sno', s) && ($('.sno', s).textContent = `${cur + 1} / ${N}`);
    $('.sch', s) && ($('.sch', s).textContent = s.dataset.chapter);
    $('.hc').textContent = s.dataset.chapter;
    $('.hn').textContent = `${cur + 1} / ${N}`;
    $('.prog i').style.width = `${(cur + 1) / N * 100}%`;
    $('.dnotes').textContent = s.dataset.notes || L.noNotes;
    if (presenter) {
      const nx = slides[cur + 1];
      $('.pnext').innerHTML = nx ? `${L.next}<b>${nx.dataset.title || nx.dataset.chapter}</b>` : L.last;
      $('.pnotes').textContent = s.dataset.notes || '';
    }
    if (location.hash !== `#/${cur + 1}`) history.replaceState(null, '', `#/${cur + 1}`);
    if (!quiet && chan) chan.postMessage({ a: 'go', i: cur, dir });
    if (R.on) { clearTimeout(R.chain && R.chain.t); R.chain = null; R.key = ''; roomRender(); }
  }

  function next(quiet = false) {
    const s = slides[cur];
    if (R.on && !quiet && roomNext(s)) return;   // the other window follows through the room's state
    const hidden = $$('.frag:not(.vis)', s);
    if (hidden.length) { hidden[0].classList.add('vis'); if (!quiet && chan) chan.postMessage({ a: 'next' }); return; }
    if (s.classList.contains('k-build') && buildCtl(s).next()) { if (!quiet && chan) chan.postMessage({ a: 'next' }); return; }
    if (s.classList.contains('k-quiz')) {
      const q = quizCtl(s);
      if (!q.shown()) { q.reveal(); if (!quiet && chan) chan.postMessage({ a: 'next' }); return; }
    }
    show(cur + 1, 1, quiet);
  }
  function prev(quiet = false) {
    const s = slides[cur];
    const vis = $$('.frag.vis', s);
    if (vis.length) { vis[vis.length - 1].classList.remove('vis'); if (!quiet && chan) chan.postMessage({ a: 'prev' }); return; }
    if (s.classList.contains('k-build') && buildCtl(s).prev()) { if (!quiet && chan) chan.postMessage({ a: 'prev' }); return; }
    show(cur - 1, -1, quiet);
  }

  if (chan) chan.onmessage = e => {
    const m = e.data;
    if (m.a === 'go') show(m.i, m.dir, true);
    else if (m.a === 'next') next(true);
    else if (m.a === 'prev') prev(true);
  };

  // ---- keys and clicks ----
  const typing = e => /INPUT|TEXTAREA/.test(e.target.tagName);
  document.addEventListener('keydown', e => {
    if (typing(e)) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') show(0, 1);
    else if (k === 'End') show(N - 1, -1);
    else if (k === 'm' || k === 'M') $('.dmenu').hidden = !$('.dmenu').hidden;
    else if (k === 'Escape') { $('.dmenu').hidden = true; $('.dnotes').hidden = true; }
    else if (k === 'n' || k === 'N') $('.dnotes').hidden = !$('.dnotes').hidden;
    else if (k === 't' || k === 'T') toggleTimer();
    else if (k === 'f' || k === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); }
    else if ((k === 's' || k === 'S') && !presenter) window.open(location.pathname + '?presenter' + location.hash, 'qc2-speaker', 'width=1400,height=820');
  });
  $$('.dmenu a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); $('.dmenu').hidden = true; show(+a.getAttribute('href').slice(2) - 1, 1);
  }));
  window.addEventListener('hashchange', () => { const m = location.hash.match(/^#\/(\d+)/); if (m) show(+m[1] - 1, 1); });

  // speaker view clock
  if (presenter) {
    document.body.classList.add('presenter');
    const t0 = Date.now();
    setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('.pclock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    fit();
    const m = location.hash.match(/^#\/(\d+)/);
    show(m ? +m[1] - 1 : 0, 1, true);
    roomPoll().then(on => { if (on) setInterval(roomPoll, 700); });   // only when room.py serves the deck
  });
})();
