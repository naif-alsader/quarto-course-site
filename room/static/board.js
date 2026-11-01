// The projector: the lobby with the join address, each question with its clock, the reveal,
// the leaderboard and the podium. It only reads; the instructor drives it from /host.
(() => {
  'use strict';
  const { h, put, t, fmt } = Room;
  const stage = document.getElementById('stage');
  const offline = document.getElementById('offline');
  const RING = 2 * Math.PI * 45;
  let key = '', shown = new Set(), clock = null, qrFor = '', qrSvg = '';

  const logo = dark => h('img', { src: `static/img/gastat-logo-${dark ? 'white' : 'color'}.png`, alt: 'GASTAT' });
  const foot = (dark, ...extra) => h('div', { class: 'foot' }, h('span', {}, t('brand')), ...extra, logo(dark));
  const address = url => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const qr = url => {
    if (url !== qrFor && window.qrcode) {
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      qrSvg = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); qrFor = url;
    }
    return h('div', { class: 'qr', html: qrSvg });
  };

  // ---- the lobby, and the start of a round ----
  function lobby(v) {
    const intro = v.phase === 'intro' && v.round;
    stage.className = 'stage indigo';
    const names = h('div', { class: 'names', id: 'names' });
    const count = h('div', { class: 'count', id: 'count' });
    const r = v.round;
    put(stage, h('div', { class: 'lobby' },
      h('div', {},
        h('div', { class: 'eyebrow' }, intro ? `${r.eyebrow}${r.kind === 'speed' ? ' · ' + t('speed') : ''}` : t('room')),
        h('h1', {}, intro ? r.title : t('open')),
        h('div', { class: 'rule' }),
        h('p', { class: 'how' }, t('join_at')),
        h('div', { class: 'url' }, address(v.join)),
        intro ? h('div', { class: 'round-next' }, h('span', { class: 'eyebrow' }, t('qs', r.n - r.asked)),
          h('b', {}, r.kind === 'speed' ? t('seconds', 10) + ' · ' + t('speed') : t('q_of', r.asked + 1, r.n))) : null,
        names),
      h('div', { class: 'side' }, qr(v.join), h('div', { class: 'scan' }, t('scan')), count)),
    foot(true));
    shown = new Set();
  }
  function lobbyLive(v) {
    const box = document.getElementById('names'), count = document.getElementById('count');
    if (!box) return;
    count.textContent = t('in_room', v.count);
    if (!v.names.length && !box.childElementCount) box.append(h('span', { class: 'none' }, t('nobody')));
    const now = new Set(v.names);
    if (v.names.length) box.querySelector('.none')?.remove();
    [...box.children].forEach(c => { if (c.dataset.n && !now.has(c.dataset.n)) { c.remove(); shown.delete(c.dataset.n); } });
    v.names.slice().reverse().forEach(n => { if (!shown.has(n)) { shown.add(n); box.append(h('span', { 'data-n': n }, n)); } });
  }

  // ---- a question, and its reveal ----
  function question(v) {
    const q = v.q, r = v.round, rev = v.phase === 'reveal';
    stage.className = 'stage' + (r.kind === 'speed' ? ' speed' : '') + (rev ? ' reveal' : '');
    const ring = h('div', { class: 'timer', id: 'timer' });
    ring.innerHTML = `<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="45"/><circle class="fg" cx="50" cy="50" r="45" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg><span></span>`;
    const opts = h('div', { class: 'opts' + (q.imgs ? ' pics' : '') + ` n${q.options.length}` });
    const total = q.counts ? Math.max(1, q.counts.reduce((a, b) => a + b, 0)) : 1;
    q.options.forEach((o, i) => opts.append(h('div', { class: 'opt' + (rev && i === q.answer ? ' right' : '') },
      h('span', { class: 'bar', 'data-w': rev ? (100 * q.counts[i] / total).toFixed(1) : 0 }),
      h('span', { class: `l o${i}` }, Room.letter(i)),
      q.imgs ? h('img', { src: q.imgs[i], alt: '' }) : null,
      q.imgs && o.length <= 1 ? null : h('span', { class: 'txt', html: o }),   // a picture's text is only its letter
      rev ? h('span', { class: 'n' }, String(q.counts[i])) : null)));
    if (q.imgs) opts.style.gridTemplateColumns = `repeat(${q.options.length}, 1fr)`;
    else if (q.options.length === 3 && r.kind !== 'speed') opts.style.gridTemplateColumns = '1fr';
    const qf = h('div', { class: 'qfoot' });
    if (rev) {
      if (q.why) qf.append(h('div', { class: 'why', html: q.why }));
      if (q.fastest) qf.append(h('div', { class: 'fast' }, '⚡ ' + t('fastest', q.fastest.name, q.fastest.s)));
    } else qf.append(h('span', { class: 'answered', id: 'answered' }));
    put(stage, 
      h('div', { class: 'qhead' }, h('div', { class: 'eyebrow' }, `${r.eyebrow} · `, h('b', {}, t('q_of', r.qi + 1, r.n))), ring),
      h('div', { class: 'qtext', html: q.text }),
      q.code ? h('pre', { class: 'qcode' }, q.code.replace(/\n+$/, '')) : null,
      opts, qf, foot(false));
    clock?.stop();
    const fg = ring.querySelector('.fg'), num = ring.querySelector('span');
    clock = Room.clock((left, tot) => {
      fg.setAttribute('stroke-dashoffset', String(RING * (1 - left / tot)));
      num.textContent = String(Math.ceil(left));
      ring.classList.toggle('low', left <= 5);
    });
    clock.set(rev ? 0 : q.left, q.seconds);
    if (rev) requestAnimationFrame(() => requestAnimationFrame(() =>
      stage.querySelectorAll('.bar').forEach(b => { b.style.width = b.dataset.w + '%'; })));
  }
  function questionLive(v) {
    const a = document.getElementById('answered');
    if (a) a.textContent = t('answered', v.q.answered, v.here || v.count);
    if (v.phase === 'question') clock?.set(v.q.left, v.q.seconds);
  }

  // ---- the leaderboard: everyone starts where they were before the question, then climbs ----
  function board(v) {
    stage.className = 'stage soft';
    const rows = h('div', { class: 'rows' });
    const top = v.top || [];
    const before = top.slice().sort((a, b) => (a.was ?? 999) - (b.was ?? 999) || a.rank - b.rank);
    const step = 6.6;  // vh per row
    top.forEach((p, i) => {
      const moved = p.was ? p.was - p.rank : 0;
      const sc = h('span', { class: 'sc' }, fmt(p.score - p.last));
      const row = h('div', { class: `row r${p.rank}`, style: `transform: translateY(${before.indexOf(p) * step}vh)` },
        h('span', { class: 'rk' }, String(p.rank)),
        h('span', { class: 'nm' }, p.name),
        h('span', { class: 'mv ' + (moved > 0 ? 'up' : moved < 0 ? 'down' : '') }, moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ''),
        p.last ? h('span', { class: 'gain' }, Room.sgn(p.last)) : h('span', { class: 'gain', style: 'visibility:hidden' }, '0'),
        sc);
      rows.append(row);
      setTimeout(() => { row.style.transform = `translateY(${i * step}vh)`; if (p.last) Room.countUp(sc, p.score - p.last, p.score); }, 900);
    });
    put(stage, h('div', { class: 'lb' },
      h('div', { class: 'eyebrow' }, v.round ? v.round.title : t('room')),
      h('h1', {}, t('leaderboard')), h('div', { class: 'rule' })),
      top.length ? rows : h('p', { class: 'empty' }, t('no_points')),
      foot(false, top.length && v.count > top.length ? h('span', {}, t('top', top.length) + ' · ' + t('in_room', v.count)) : null));
  }

  // ---- the podium ----
  function podium(v) {
    stage.className = 'stage indigo';
    const top = (v.top || []).slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean);
    const height = { 1: 34, 2: 25, 3: 18 }, delay = { 3: 0.3, 2: 1.3, 1: 2.4 };
    const steps = h('div', { class: 'steps3' });
    order.forEach(p => {
      const place = top.indexOf(p) + 1, d = `animation-delay:${delay[place]}s`;
      steps.append(h('div', { class: `step p${place}` },
        h('div', { class: 'who', style: d }, p.name),
        h('div', { class: 'pts', style: d }, t('pts', p.score)),
        h('div', { class: 'block', style: `--hgt:${height[place]}vh;${d}` }, String(p.rank))));
    });
    put(stage, h('div', { class: 'podium' },
      h('div', { class: 'eyebrow' }, v.round ? v.round.title : t('room')),
      h('h1', {}, t('podium')), top.length ? steps : h('p', { class: 'empty' }, t('no_points'))), foot(true));
    if (top.length) setTimeout(confetti, 2600);
  }
  function confetti() {
    const box = h('div', { class: 'confetti' });
    const colours = ['#00B050', '#4BD98A', '#E9B949', '#FFFFFF', '#BFB9E8', '#2683C6'];
    for (let i = 0; i < 90; i++) {
      box.append(h('i', { style: `left:${Math.random() * 100}vw;background:${colours[i % colours.length]};` +
        `animation-duration:${2.6 + Math.random() * 2.4}s;animation-delay:${Math.random() * 1.2}s` }));
    }
    put(stage, box);
    setTimeout(() => box.remove(), 6500);
  }

  function render(v) {
    document.body.classList.toggle('lost', !v);
    if (!v) { offline.textContent = t('offline'); return; }
    const langChanged = Room.setLang(v.lang);
    const r = v.round || {};
    const k = [v.lang, v.phase, r.id, r.qi, v.phase === 'board' || v.phase === 'podium' ? JSON.stringify(v.top) : '',
      v.phase === 'intro' ? r.asked : '', v.join].join('|');
    if (k !== key || langChanged) {
      key = k;
      stage.innerHTML = '';
      if (v.phase === 'lobby' || v.phase === 'intro') lobby(v);
      else if ((v.phase === 'question' || v.phase === 'reveal') && v.q) question(v);
      else if (v.phase === 'board') board(v);
      else if (v.phase === 'podium') podium(v);
      else lobby(v);
    }
    if (v.phase === 'lobby' || v.phase === 'intro') lobbyLive(v);
    if (v.q) questionLive(v);
  }

  Room.poll(() => '/api/state', render, 700);
})();
