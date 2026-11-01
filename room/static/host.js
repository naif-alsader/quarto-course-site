// The instructor's controls: pick a round, open each question, reveal it, show the board,
// and award the points the room earns outside the quiz. Opens on the laptop that runs room.py.
(() => {
  'use strict';
  const { h, put, t, fmt } = Room;
  const top = document.getElementById('top'), left = document.getElementById('left'), right = document.getElementById('right');
  const offline = document.getElementById('offline');
  let key = '', last = null, armed = null, clock = null;

  const act = async (op, body = {}) => {
    armed = null;
    await Room.api('/api/host/' + op, body).catch(() => null);
    refresh();
  };
  // a button that needs a second click within three seconds: removing a player, a new leaderboard, a replay
  const confirmBtn = (id, label, onGo, cls = 'btn warn') => h('button', {
    class: cls + (armed === id ? ' armed' : ''), type: 'button',
    onclick: () => {
      if (armed === id) return onGo();
      armed = id; key = ''; render(last);
      setTimeout(() => { if (armed === id) { armed = null; key = ''; render(last); } }, 3000);
    } }, armed === id ? t('sure') : label);
  const btn = (label, op, body, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: () => act(op, body) }, label);
  const seg = (items, cur, fn) => h('div', { class: 'seg' }, items.map(([val, label]) =>
    h('button', { type: 'button', class: val === cur ? 'on' : '', onclick: () => fn(val) }, label)));

  function header(v) {
    top.append(h('h1', {}, t('controls')),
      h('span', {}, t('join_link'), ' ', h('span', { class: 'join' }, v.join)),
      h('a', { class: 'btn primary', href: '/board', target: '_blank' }, t('board_link')),
      h('span', { class: 'sp' }),
      h('span', { class: 'note' }, t('per_q')),
      seg([[null, t('as_set')], [10, '10'], [20, '20'], [30, '30'], [45, '45']], v.override, n => act('seconds', { n })),
      h('span', { class: 'note' }, t('lang')),
      seg([['ar', 'عربي'], ['en', 'English']], v.lang, l => act('lang', { lang: l })));
  }

  function now(v) {
    const r = v.round, q = v.q, k = v.key;
    const more = r && r.asked < r.n;
    const box = h('div', { class: 'panel now' }, h('h2', {}, t('now')), h('span', { class: 'ph' }, t('phase')[v.phase]));
    if (!r) { box.append(h('p', { class: 'note' }, t('pick_round'))); return box; }
    box.append(h('div', { class: 'eyebrow', style: 'margin-top:12px' }, r.eyebrow + (r.kind === 'speed' ? ' · ' + t('speed') : '')),
      h('h3', {}, r.title),
      h('div', { class: 'note' }, v.phase === 'intro' || !k ? t('qs', r.n) + ` · ${r.asked}/${r.n}` : t('q_of', r.qi + 1, r.n)));
    if (k && v.phase !== 'intro' && v.phase !== 'podium') {
      const list = h('ol');
      k.options.forEach((o, i) => list.append(h('li', { class: i === k.answer ? 'key' : '' },
        h('span', { class: `l o${i}` }, Room.letter(i)), h('span', { html: o }),
        q && q.counts ? h('span', { class: 'c' }, String(q.counts[i])) : i === k.answer ? h('span', { class: 'c' }, '✓') : null)));
      put(box, h('div', { class: 'qt', html: k.text }),
        k.code ? h('pre', { class: 'pq-code' }, k.code.replace(/\n+$/, '')) : null, list,
        k.why ? h('p', { class: 'why', html: k.why }) : null);
    }
    const acts = h('div', { class: 'acts' });
    const next = more ? btn(v.phase === 'intro' ? t('open_q', r.qi + 1) : t('next_q'), 'next', {}, 'btn go')
      : btn(t('to_podium'), 'podium', {}, 'btn go');
    if (v.phase === 'intro' || v.phase === 'lobby') acts.append(more ? next : h('span', { class: 'note' }, t('round_done')));
    else if (v.phase === 'question') acts.append(btn(t('reveal'), 'reveal', {}, 'btn go'), h('span', { class: 'live', id: 'live' }));
    else if (v.phase === 'reveal') acts.append(btn(t('show_board'), 'board', {}, 'btn go'), more ? btn(t('next_q'), 'next') : btn(t('to_podium'), 'podium'));
    else if (v.phase === 'board') acts.append(next);
    else if (v.phase === 'podium') acts.append(btn(t('to_lobby'), 'lobby', {}, 'btn go'));
    if (v.phase !== 'question') {
      acts.append(h('span', { class: 'sp', style: 'flex:1' }));
      if (v.phase !== 'lobby') acts.append(btn(t('to_lobby'), 'lobby'));
      if (v.phase !== 'board') acts.append(btn(t('show_board'), 'board'));
      if (v.phase !== 'podium') acts.append(btn(t('to_podium'), 'podium'));
    }
    box.append(acts);
    if (!more && v.phase === 'board') box.append(h('p', { class: 'note' }, t('round_done')));
    return box;
  }

  function players(v) {
    const box = h('div', { class: 'panel' }, h('h2', {}, t('players', v.players.length)));
    if (!v.players.length) { box.append(h('p', { class: 'note' }, t('no_players'))); return box; }
    const body = h('tbody');
    v.players.forEach(p => body.append(h('tr', {},
      h('td', { class: 'mono' }, String(p.rank)),
      h('td', { class: 'nm' }, h('span', { class: 'here' + (p.here ? '' : ' off'), title: p.here ? '' : t('away') }), p.name,
        v.phase === 'question' && p.in ? h('span', { class: 'in' }, ' ✓') : null),
      h('td', { class: 'mono' }, fmt(p.score)),
      h('td', { class: 'note' }, t('right_of', p.right, p.answered), p.streak > 1 ? ` · ${p.streak}×` : ''),
      h('td', {}, p.badges.map(b => Room.badge(b, false))),
      h('td', { class: 'acts' },
        btn(t('done_btn'), 'award', { pid: p.pid, kind: 'done' }), ' ',
        btn(t('show_btn'), 'award', { pid: p.pid, kind: 'show' }), ' ',
        confirmBtn('kick:' + p.pid, t('remove'), () => act('kick', { pid: p.pid }))))));
    box.append(h('table', { class: 'players' }, body));
    return box;
  }

  function rounds(v) {
    const box = h('div', { class: 'panel rounds' }, h('h2', {}, t('rounds')));
    let day = 0;
    v.rounds.forEach(r => {
      if (r.day !== day) { day = r.day; box.append(h('div', { class: 'day' }, t('day', day))); }
      const full = r.asked >= r.n, cur = v.round && v.round.id === r.id;
      const inner = [h('span', {}, h('span', { class: 'k' }, r.eyebrow), r.title,
        r.kind === 'speed' ? h('span', { class: 'zap' }, t('speed')) : null), h('span', { class: 'p' }, `${r.asked}/${r.n}`)];
      if (full) {
        const b = confirmBtn('again:' + r.id, '', () => act('round', { id: r.id, again: true }), 'rbtn full' + (cur ? ' cur' : ''));
        b.textContent = '';
        b.append(...(armed === 'again:' + r.id ? [h('span', {}, t('again'))] : inner));
        box.append(b);
      } else box.append(h('button', { class: 'rbtn' + (cur ? ' cur' : ''), type: 'button', onclick: () => act('round', { id: r.id }) }, ...inner));
    });
    return box;
  }

  function render(v) {
    if (!v) { document.body.classList.add('lost'); offline.textContent = t('offline'); return; }
    if (v.status === 403) { document.body.innerHTML = ''; document.body.append(h('p', { style: 'padding:40px' }, 'The controls open on the laptop that runs room.py.')); return; }
    document.body.classList.remove('lost');
    last = v;
    const langChanged = Room.setLang(v.lang);
    const k = JSON.stringify([v.phase, v.round, v.key, v.q && v.q.counts, v.q && v.q.answered, v.players, v.rounds, v.override, v.lang, armed]);
    if (k !== key || langChanged) {
      key = k;
      [top, left, right].forEach(x => { x.innerHTML = ''; });
      header(v);
      left.append(now(v), players(v));
      right.append(rounds(v), h('div', { class: 'panel' },
        confirmBtn('reset', t('reset'), () => act('reset', { confirm: 'reset' })), h('p', { class: 'note' }, t('reset_note'))));
    }
    const live = document.getElementById('live');
    if (live && v.q) {
      clock?.stop();
      clock = Room.clock(s => { live.textContent = `${t('left', Math.ceil(s))} · ${t('answered', v.q.answered, v.here || v.players.length)}`; });
      clock.set(v.q.left, v.q.seconds);
    }
  }

  const refresh = () => Room.api('/api/host').then(render).catch(() => render(null));
  refresh();
  setInterval(refresh, 1000);
})();
