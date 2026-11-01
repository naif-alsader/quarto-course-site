# The quiz room

The course's quizzes played live inside the deck, with a leaderboard. One file of Python 3.8
or later and nothing else: no packages, no internet.

## Start

This folder sits inside the published course. On the laptop you present from, double-click
`start-course.command` (Mac) or `start-course.bat` (Windows) at the top of the course folder:
it starts the room and opens the deck in the browser. Or, in the course folder:

```
python3 room/room.py --open
```

Always start the course this way. Opened straight from the folder (a `file://` address), the
pages and slides show but the animated builds stay blank: their player has to load each build's
frames, which a browser allows only from a server. The builds then say so.

It prints the addresses (8080, or the next free port when 8080 is busy):

| Address | Where it opens |
|---|---|
| `http://localhost:8080/deck` | the deck, with every quiz played live in it: present from here |
| `http://localhost:8080/host` | the controls: points for done tests and shown work, the players, a new leaderboard |
| `http://<this laptop>:8080/` | where participants answer; the deck's join slides show it with a QR code |
| `http://localhost:8080/board` | a projector screen of its own, for running a quiz without the deck |

The deck and the controls open on this laptop only. Participants need to be on the same
network as the laptop. If the network keeps devices apart, share your phone's hotspot and
join everyone to it. On a Mac, allow the incoming connection when the firewall asks. If the
join address is wrong, pass the right one: `python3 room/room.py --ip 10.0.0.5`. Another
port: `--port 9000`. Outside the course folder, point it at the course: `--site <folder>`.

## In the deck

- Each day starts on a **join slide**: the address, a QR code, and the names as people join.
  Joining once lasts the three days.
- On a **quiz slide**, → opens the question to the room: the clock runs on every screen and
  the slide counts the answers. The question closes itself when the time is up or everyone has
  answered; → closes it early. The slide then shows the answer, how the room voted and the
  fastest right answer. → moves on.
- After a quiz's **last question**, → shows the leaderboard on the same slide: everyone starts
  where they were before the question and climbs.
- A **speed game** plays itself: → starts it, each statement opens for ten seconds, and the
  next follows three seconds after each reveal. It ends on the leaderboard.
- Moving on while a question is still open scores it first. A question already asked shows
  as an ordinary quiz slide.
- Opened anywhere else (GitHub Pages, from disk) the deck is the ordinary deck.

## Points

- A right answer: 500, and up to 500 more for speed. Each player's clock starts when the
  question reaches their screen, so a slow connection costs nothing.
- Each right answer in a row after the first: 50 more, up to 250.
- From the players list: **+500** for a passed done test, **+300** for work shown to the room.
- Badges: first right answer, three, five and ten in a row, fastest right answer, a perfect
  round, a passed done test, work shown to the room.

The board shows the top ten; everyone sees their own rank on their own screen.

## Keeping the scores

The scores are saved in `room-state.json` beside `room.py` after every change. Close the room
(Ctrl+C) at the end of a day and start it again the next morning to carry on with the same
leaderboard. `python3 room.py --fresh`, or **Start a new leaderboard** in the controls, starts
over. Names and answers never leave the laptop.

`questions.json` holds the questions and their answers in English and Arabic. It is read only
by `room.py`: no answer reaches a participant's screen before the reveal. Switch the room's
language in the controls.

---

## بالعربي

مسابقة مباشرة من أسئلة الدورة، والترتيب على شاشة القاعة. تحتاج Python 3.8 أو أحدث وبس.

1. شغّل `python3 room.py`، وافتح لوحة التحكم `http://localhost:8080/host` على جهازك، وشاشة العرض `/board` على البروجكتر.
2. المشاركون يدخلون من العنوان أو رمز QR اللي على الشاشة، وهم على نفس الشبكة. ولو الشبكة تفصل الأجهزة، شارك نقطة اتصال جوالك.
3. اختر الجولة، وافتح السؤال، واكشف الإجابة، واعرض الترتيب، وكمّل.
4. النقاط تنحفظ في `room-state.json`. سكّر المسابقة آخر اليوم وشغّلها بكرة، وتكمل من مكانك.
