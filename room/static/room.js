// The quiz room's shared pieces: the interface text in both languages, a DOM helper, the poll.
// No framework and no network beyond the laptop that runs room.py.
const Room = (() => {
  'use strict';
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;   // only ever the course's own question text
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach(c => el.append(c && c.nodeType ? c : document.createTextNode(c ?? '')));
    return el;
  };

  // append, skipping the empty slots that optional parts leave (Element.append would print "null")
  const put = (el, ...kids) => el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  const fmt = n => Number(n || 0).toLocaleString('en');   // Latin digits in both editions, as on the course pages
  // a signed number keeps its sign in front in Arabic too: +930, never 930+
  const sgn = n => '\u2066+' + fmt(n) + '\u2069';
  const qs = n => (n >= 3 && n <= 10 ? `${n} أسئلة` : `${n} سؤالًا`);

  const S = {
    en: {
      brand: 'Quarto, step by step', room: 'Quiz room',
      pts: n => `${fmt(n)} points`, q_of: (i, n) => `Question ${i} of ${n}`, speed: 'Speed round',
      offline: 'Lost the room. Trying again…', day: n => `Day ${n}`, seconds: s => `${s} s`,
      // the participant's screen
      join_title: 'Join the quiz', join_lead: 'You answer here. The questions and the leaderboard are on the projector.',
      name: 'Your name on the board', name_hint: 'A first name or a nickname, up to 24 letters.', join: 'Join',
      taken: 'That name is taken. Try another.', bad_name: 'Write a name first.',
      hello: n => `You’re in, ${n}`, eyes: 'Eyes on the projector: each question opens there and here at the same moment.',
      locked: 'Locked in', wait_others: 'Waiting for the others…', late: 'Time is up for this one.',
      right: 'Right!', wrong: 'Not this time', none: 'No answer', answer_was: l => `The answer: ${l}`,
      streak: n => `${n} in a row`, bonus: n => `including ${sgn(n)} for the streak`,
      fastest_you: 'The fastest right answer in the room', your_place: 'Your place', of: n => `of ${n}`,
      your_score: 'Your points', this_round: n => `${sgn(n)} this round`, badges_title: 'Your badges',
      new_badge: 'New badge', round_over: 'Round over',
      // the projector
      open: 'The room is open', join_at: 'Join on your laptop or phone', scan: 'or scan the code',
      in_room: n => `${n} in the room`, nobody: 'Nobody yet. Be the first.', qs: n => `${n} questions`,
      answered: (a, n) => `${a} of ${n} answered`, fastest: (n, s) => `Fastest: ${n}, ${s} s`,
      leaderboard: 'Leaderboard', top: n => `Top ${n}`, podium: 'The podium', no_points: 'No points yet.',
      // the controls
      controls: 'Quiz room: the controls', board_link: 'Open the projector screen', join_link: 'Participants join at',
      rounds: 'Rounds', again: 'Play it again?', now: 'On the screen now',
      phase: { lobby: 'The lobby', intro: 'Round about to start', question: 'Question open', reveal: 'Answer shown',
        board: 'Leaderboard', podium: 'Podium' },
      pick_round: 'Pick a round from the list to start.', open_q: i => `Open question ${i}`, reveal: 'Show the answer',
      show_board: 'Show the leaderboard', next_q: 'Next question', to_podium: 'The podium', to_lobby: 'Back to the lobby',
      answer: 'Answer', per_q: 'Time per question', as_set: 'As set', players: n => `Players (${n})`, away: 'away',
      done_btn: '+500 done test', show_btn: '+300 showed work', remove: 'Remove', sure: 'Sure?',
      reset: 'Start a new leaderboard', reset_note: 'Clears every player and every score; every round can be played again.',
      right_of: (r, a) => `${r} of ${a} right`, left: s => `${s} s left`, no_players: 'Nobody has joined yet.',
      round_done: 'Round finished. Show the podium, or pick the next round.', lang: 'Language',
    },
    ar: {
      brand: 'Quarto خطوة بخطوة', room: 'المسابقة',
      pts: n => `${fmt(n)} نقطة`, q_of: (i, n) => `السؤال ${i} من ${n}`, speed: 'جولة السرعة',
      offline: 'انقطع الاتصال بالقاعة، نحاول مرة ثانية…', day: n => `اليوم ${n}`, seconds: s => `${s} ث`,
      join_title: 'ادخل المسابقة', join_lead: 'تجاوب من هنا، والأسئلة والترتيب على شاشة القاعة.',
      name: 'اسمك اللي يطلع على الشاشة', name_hint: 'اسمك الأول أو لقب، إلى 24 حرف.', join: 'ادخل',
      taken: 'الاسم هذا مأخوذ، جرّب اسم ثاني.', bad_name: 'اكتب اسمك أول.',
      hello: n => `أهلًا ${n}! تم دخولك`, eyes: 'خلّ عينك على شاشة القاعة: السؤال يفتح هناك وهنا بنفس اللحظة.',
      locked: 'تم تثبيت إجابتك', wait_others: 'ننتظر الباقين…', late: 'خلص وقت هالسؤال.',
      right: 'صح!', wrong: 'مو هالمرة', none: 'بدون إجابة', answer_was: l => `الإجابة: ${l}`,
      streak: n => `${n} صح على التوالي`, bonus: n => `منها ${sgn(n)} مكافأة التتابع`,
      fastest_you: 'أسرع إجابة صح في القاعة', your_place: 'ترتيبك', of: n => `من ${n}`,
      your_score: 'نقاطك', this_round: n => `${sgn(n)} في هالجولة`, badges_title: 'أوسمتك',
      new_badge: 'وسام جديد', round_over: 'انتهت الجولة',
      open: 'القاعة مفتوحة', join_at: 'ادخل من جهازك أو جوالك', scan: 'أو امسح الرمز',
      in_room: n => `${n} في القاعة`, nobody: 'ما أحد دخل للحين. خلك أول واحد!', qs,
      answered: (a, n) => `جاوب ${a} من ${n}`, fastest: (n, s) => `الأسرع: ${n} في ${s} ث`,
      leaderboard: 'الترتيب', top: n => `أفضل ${n}`, podium: 'منصة التتويج', no_points: 'ما فيه نقاط للحين.',
      controls: 'المسابقة: لوحة التحكم', board_link: 'افتح شاشة العرض', join_link: 'المشاركون يدخلون من',
      rounds: 'الجولات', again: 'تعيدها؟', now: 'على الشاشة الحين',
      phase: { lobby: 'شاشة الدخول', intro: 'بداية الجولة', question: 'السؤال مفتوح', reveal: 'الإجابة ظاهرة',
        board: 'الترتيب', podium: 'منصة التتويج' },
      pick_round: 'اختر جولة من القائمة عشان تبدأ.', open_q: i => `افتح السؤال ${i}`, reveal: 'اكشف الإجابة',
      show_board: 'اعرض الترتيب', next_q: 'السؤال التالي', to_podium: 'منصة التتويج', to_lobby: 'ارجع لشاشة الدخول',
      answer: 'الإجابة', per_q: 'وقت كل سؤال', as_set: 'حسب السؤال', players: n => `المشاركون (${n})`, away: 'غير متصل',
      done_btn: '+500 اختبار الإنجاز', show_btn: '+300 عرض الشغل', remove: 'احذف', sure: 'متأكد؟',
      reset: 'ابدأ ترتيب جديد', reset_note: 'يمسح كل المشاركين وكل النقاط، وترجع كل الجولات من جديد.',
      right_of: (r, a) => `${r} صح من ${a}`, left: s => `باقي ${s} ث`, no_players: 'ما دخل أحد للحين.',
      round_done: 'خلصت الجولة. اعرض منصة التتويج، أو اختر الجولة الجاية.', lang: 'اللغة',
    },
  };

  // badges: a mark for the chip, then the name in each language
  const BADGES = {
    first: ['★', 'First right answer', 'أول إجابة صح'],
    streak3: ['3×', 'Three in a row', 'ثلاث صح على التوالي'],
    streak5: ['5×', 'Five in a row', 'خمس صح على التوالي'],
    streak10: ['10×', 'Ten in a row', 'عشر صح على التوالي'],
    fastest: ['⚡', 'Fastest right answer', 'أسرع إجابة صح'],
    perfect: ['◆', 'A perfect round', 'جولة كاملة بلا غلطة'],
    done: ['✓', 'Passed a done test', 'اجتياز اختبار الإنجاز'],
    show: ['▲', 'Work shown to the room', 'عرض الشغل أمام القاعة'],
  };
  const LETTERS = { en: 'ABCDEF', ar: 'أبجدهو' };

  let lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const t = (k, ...a) => { const v = S[lang][k]; return typeof v === 'function' ? v(...a) : v; };
  const setLang = l => {
    if (!S[l]) return false;
    const changed = l !== lang;
    lang = l;
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    return changed;
  };

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return Object.assign({ status: r.status }, j);
  }

  // ask for the state every `ms`; `fn(state)` on success, `fn(null)` when the room cannot be reached
  function poll(path, fn, ms) {
    let busy = false;
    const go = async () => {
      if (busy) return;
      busy = true;
      try { fn(await api(path())); } catch (e) { fn(null); }
      busy = false;
    };
    go();
    return setInterval(go, ms);
  }

  // a countdown that runs between polls, re-set by each one
  function clock(onTick) {
    let end = 0, total = 1, raf = 0;
    const frame = () => { const left = Math.max(0, (end - performance.now()) / 1000); onTick(left, total); if (left > 0) raf = requestAnimationFrame(frame); };
    return {
      set(left, seconds) { end = performance.now() + left * 1000; total = seconds; cancelAnimationFrame(raf); frame(); },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  const badge = (b, withName = true) => {
    const [mark, en, ar] = BADGES[b] || ['•', b, b];
    return h('span', { class: 'badge b-' + b, title: lang === 'ar' ? ar : en },
      h('i', {}, mark), withName ? h('span', {}, lang === 'ar' ? ar : en) : null);
  };
  const badgeName = b => (BADGES[b] ? BADGES[b][lang === 'ar' ? 2 : 1] : b);

  // count a number up to its new value
  function countUp(el, from, to, ms = 1100) {
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return { h, put, t, fmt, sgn, setLang, lang: () => lang, api, poll, clock, badge, badgeName, countUp,
    letter: i => LETTERS[lang][i] || String(i + 1) };
})();
