// A participant's screen: join with a name, answer each question, see what it earned.
// The answer arrives only with the reveal, so nothing here can give it away early.
(() => {
  'use strict';
  const { h, put, t, fmt } = Room;
  const main = document.getElementById('main'), meBox = document.getElementById('me');
  const offline = document.getElementById('offline');
  const KEY = 'quiz-room:t';
  const store = {   // remembers who you are across a reload; a private window may refuse
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* kept for this visit */ } },
  };
  let token = store.get(), key = '', mine = null, late = false, badges = null, clock = null, last = null;

  const stats = me => h('div', { class: 'stats' },
    h('div', {}, h('small', {}, t('your_place')), h('b', {}, String(me.rank)), h('em', {}, t('of', me.of))),
    h('div', {}, h('small', {}, t('your_score')), h('b', {}, fmt(me.score)),
      me.gain ? h('em', { class: 'gain' }, t('this_round', me.gain)) : null));
  const myBadges = me => (me.badges.length ? h('div', {}, h('small', { class: 'hint' }, t('badges_title')),
    h('div', { class: 'mybadges' }, me.badges.map(b => Room.badge(b)))) : null);

  function join(v) {
    const input = h('input', { type: 'text', id: 'name', maxlength: '24', autocomplete: 'nickname', dir: 'auto' });
    const err = h('p', { class: 'err' });
    const go = async e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { err.textContent = t('bad_name'); return; }
      const r = await Room.api('/api/join', { t: token, name }).catch(() => ({ status: 0 }));
      if (r.status === 200) { token = r.t; store.set(token); key = ''; tick(); }
      else err.textContent = r.error === 'taken' ? t('taken') : r.status ? t('bad_name') : t('offline');
    };
    put(main, h('form', { class: 'card', onsubmit: go },
      h('div', { class: 'eyebrow' }, t('room')), h('h1', {}, t('join_title')), h('p', { class: 'lead' }, t('join_lead')),
      h('label', { for: 'name' }, t('name')), input, h('p', { class: 'hint' }, t('name_hint')),
      h('button', { class: 'big-btn', type: 'submit' }, t('join')), err));
    setTimeout(() => input.focus(), 50);
  }

  function waiting(v) {
    const me = v.me;
    put(main, h('div', { class: 'card wait' }, h('span', { class: 'dot' }),
      h('h2', {}, t('hello', me.name)), h('p', {}, t('eyes'))), stats(me), myBadges(me));
  }

  function question(v) {
    const q = v.q, r = v.round;
    const bar = h('div', { class: 'pbar' }, h('i'));
    const opts = h('div', { class: 'popts' });
    q.options.forEach((o, i) => opts.append(h('button', { class: 'popt', type: 'button', onclick: () => send(i) },
      h('span', { class: `l o${i}` }, Room.letter(i)),
      q.imgs ? h('img', { src: q.imgs[i], alt: '' }) : null,
      q.imgs && o.length <= 1 ? null : h('span', { html: o }))));
    put(main, h('div', { class: 'eyebrow' }, t('q_of', r.qi + 1, r.n)), bar,
      h('div', { class: 'pq', html: q.text }),
      q.code ? h('pre', { class: 'pq-code' }, q.code.replace(/\n+$/, '')) : null, opts);
    clock?.stop();
    clock = Room.clock((left, total) => { bar.firstChild.style.width = (100 * left / total) + '%'; bar.classList.toggle('low', left <= 5); });
    clock.set(q.left, q.seconds);
  }

  async function send(i) {
    if (mine !== null) return;
    mine = i; key = ''; render(last);   // show it locked at once; the server has the last word
    const r = await Room.api('/api/answer', { t: token, i }).catch(() => ({ status: 0 }));
    if (r.status === 409 && r.error === 'late') { late = true; mine = null; }
    else if (r.status === 403) { token = null; store.set(null); }
    else if (r.status !== 200 && r.error !== 'once') mine = null;   // try again
    key = ''; render(last);
  }

  function locked(v) {
    const i = v.me.choice ?? mine;
    put(main, h('div', { class: 'card wait' },
      late ? h('h2', {}, t('late')) : [h('span', { class: 'dot' }), h('h2', {}, t('locked')),
        h('div', { class: 'popt sel', style: 'margin:14px auto 10px;max-width:420px;pointer-events:none' },
          h('span', { class: `l o${i}` }, Room.letter(i)), h('span', { html: v.q.options[i] })),
        h('p', {}, t('wait_others'))]));
  }

  function reveal(v) {
    const me = v.me, res = me.result, q = v.q;
    const ok = res.ok, none = me.choice === null || me.choice === undefined;
    put(main, h('div', { class: 'result ' + (ok ? 'ok' : 'no') },
      h('div', { class: 'mark' }, ok ? '✓' : none ? '–' : '✗'),
      h('h2', {}, ok ? t('right') : none ? t('none') : t('wrong')),
      ok ? h('div', { class: 'gain' }, Room.sgn(res.pts)) : null,
      ok && res.bonus ? h('small', {}, t('bonus', res.bonus)) : null,
      ok && me.streak > 1 ? h('small', {}, t('streak', me.streak)) : null,
      res.fastest ? h('div', { class: 'fastme' }, '⚡ ' + t('fastest_you')) : null),
      h('div', { class: 'pwhy' }, h('b', {}, t('answer_was', Room.letter(q.answer))),
        h('span', { html: q.options[q.answer] }), q.why ? h('p', { html: q.why, style: 'margin:8px 0 0;color:var(--grey)' }) : null),
      stats(me));
  }

  function standing(v) {
    const me = v.me;
    put(main, h('div', { class: 'card wait' }, h('div', { class: 'eyebrow' }, v.phase === 'podium' ? t('round_over') : t('leaderboard')),
      h('h2', { style: 'font-size:56px;font-family:var(--mono)' }, String(me.rank)), h('p', {}, t('of', me.of))),
    stats(me), myBadges(me));
  }

  function toast(b) {
    const el = h('div', { class: 'toast' }, h('b', {}, t('new_badge')), Room.badge(b));
    document.body.append(el);
    setTimeout(() => el.remove(), 4200);
  }

  function render(v) {
    if (!v) return;
    last = v;
    Room.setLang(v.lang);
    const me = v.me, r = v.round || {};
    if (token && !me && v.status === 200) { token = null; store.set(null); }  // removed, or a new leaderboard
    if (v.phase !== 'question') { mine = null; late = false; }
    meBox.innerHTML = '';
    if (me) meBox.append(h('span', {}, me.name), h('span', { class: 'pt' }, fmt(me.score)));
    if (me) {
      if (badges) me.badges.filter(b => !badges.includes(b)).forEach(toast);
      badges = me.badges.slice();
    }
    const answered = me && (me.choice !== null && me.choice !== undefined || mine !== null || late);
    const k = me ? [v.lang, me.name, v.phase, r.id, r.qi, answered, me.score, me.rank, me.badges.length].join('|')
      : 'join|' + v.lang;   // the form stays put while the room moves on, so a half-typed name survives
    if (k === key) return;
    key = k;
    main.innerHTML = '';
    if (!me) return join(v);
    if (v.phase === 'question' && v.q) return answered ? locked(v) : question(v);
    if (v.phase === 'reveal' && v.q && me.result) return reveal(v);
    if (v.phase === 'board' || v.phase === 'podium') return standing(v);
    waiting(v);
  }

  const tick = () => Room.api('/api/state' + (token ? '?t=' + encodeURIComponent(token) : ''))
    .then(v => { document.body.classList.remove('lost'); render(v); })
    .catch(() => { document.body.classList.add('lost'); offline.textContent = t('offline'); });
  tick();
  setInterval(tick, 700);
})();
