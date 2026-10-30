// The presentation: one slide at a time, arrow keys step through bullets, build steps
// and quiz answers. Builds are HyperFrames players, made only near the current slide.
(function () {
  'use strict';
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
        why.prepend(Object.assign(document.createElement('b'), { textContent: 'Answer ' + 'ABCDEF'[ans] + '. ' }));
        why.classList.add('show');
      },
      reset() {
        delete box.dataset.shown;
        $$('.dopt', box).forEach(b => b.classList.remove('sel', 'right', 'wrong'));
        const b = $('b', why); if (b && b.textContent.startsWith('Answer')) b.remove();
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
      if (left-- <= 0) { clearInterval(timerId); timerId = null; el.textContent = 'Time'; el.classList.add('done'); } };
    tick(); timerId = setInterval(tick, 1000);
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
    $('.dnotes').textContent = s.dataset.notes || 'No notes for this slide.';
    if (presenter) {
      const nx = slides[cur + 1];
      $('.pnext').innerHTML = nx ? `Next<b>${nx.dataset.title || nx.dataset.chapter}</b>` : 'Last slide';
      $('.pnotes').textContent = s.dataset.notes || '';
    }
    if (location.hash !== `#/${cur + 1}`) history.replaceState(null, '', `#/${cur + 1}`);
    if (!quiet && chan) chan.postMessage({ a: 'go', i: cur, dir });
  }

  function next(quiet = false) {
    const s = slides[cur];
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
  });
})();
