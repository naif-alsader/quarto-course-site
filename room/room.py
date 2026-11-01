#!/usr/bin/env python3
"""The quiz room: the course's quizzes as live rounds, with a leaderboard on the projector.

It runs on the instructor's laptop with Python 3.8 or later and nothing else: no internet,
no packages. Participants join from a laptop or a phone on the same network.

    python3 room.py              start the room, or carry on with the last one, on port 8080
                                 (in the course folder it also serves the deck: see /deck below)
    python3 room.py --port 9000  another port
    python3 room.py --fresh      start over with an empty leaderboard

    http://localhost:8080/deck   the instructor's deck, with each quiz played live in it (this laptop only)
    http://localhost:8080/host   the instructor's controls (from this laptop only)
    http://localhost:8080/board  the projector
    http://<this laptop>:8080/   where participants join; the board shows the address and a QR code

The scores are kept in room-state.json beside this file, so one leaderboard runs through
all three days and survives a restart. questions.json holds the answers and is read only
here: no answer reaches a participant's screen before the reveal.
"""
import argparse
import json
import mimetypes
import os
import re
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf"}
PAGES = {"/": "play.html", "/board": "board.html", "/host": "host.html"}

POINTS = 500                  # a right answer earns 500, plus up to 500 more for speed
STREAK_STEP, STREAK_MAX = 50, 250   # and 50 for each answer in a row after the first, up to 250
GRACE = 0.6                   # seconds: an answer sent as the clock hits zero still counts
LAG = 1.5                     # seconds: the most a slow screen is allowed to have started late
AWARDS = {"done": 500, "show": 300}  # the instructor's buttons: a passed done test, work shown to the room
TOP = 10                      # rows on the board; everyone sees their own rank on their screen
SEEN = 30                     # seconds: a player who has not asked for the state since is away


def now():
    return time.time()


def blank(lang="ar"):
    return {"lang": lang, "players": {}, "tokens": {}, "phase": "lobby", "round": None, "qi": 0,
            "opened": 0.0, "seconds": 20, "override": None, "answers": {}, "prev": {}, "gain": {},
            "asked": {}, "qseen": {}, "fastest": None, "seq": 0}


class Room:
    def __init__(self, questions, state_file, fresh, join_url):
        self.lock = threading.Lock()
        self.rounds = {r["id"]: r for r in questions["rounds"]}
        self.order = [r["id"] for r in questions["rounds"]]
        self.file = state_file
        self.join = join_url
        self.s = blank()
        if state_file.exists() and not fresh:
            self.s.update(json.loads(state_file.read_text()))
        self.seen = {}  # pid -> last poll; not saved: after a restart everyone is fresh

    # ---- saving ----
    def save(self):
        self.s["seq"] += 1
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.s, ensure_ascii=False))
        os.replace(tmp, self.file)  # a crash mid-write never leaves half a leaderboard

    # ---- the ranking ----
    def ranking(self):
        ps = sorted(self.s["players"].items(), key=lambda kv: (-kv[1]["score"], kv[1]["name"].lower()))
        ranks, last, r = {}, None, 0
        for i, (pid, p) in enumerate(ps):
            if p["score"] != last:
                r, last = i + 1, p["score"]
            ranks[pid] = r   # equal scores share a rank: 1, 2, 2, 4
        return ps, ranks

    def question(self):
        r = self.rounds.get(self.s["round"])
        if not r:
            return None, None
        return r, (r["questions"][self.s["qi"]] if self.s["qi"] < len(r["questions"]) else None)

    def seconds(self, q):
        return self.s["override"] or q.get("seconds", 20)

    # ---- the clock: a question closes itself when time is up or everyone has answered ----
    def tick(self):
        if self.s["phase"] != "question":
            return
        r, q = self.question()
        left = self.s["opened"] + self.s["seconds"] - now()
        here = [pid for pid in self.s["players"] if now() - self.seen.get(pid, 0) < SEEN]
        if left <= -GRACE or (here and all(pid in self.s["answers"] for pid in here)):
            self.reveal()

    def reveal(self):
        r, q = self.question()
        if not q or self.s["phase"] != "question":
            return
        fastest = None
        for pid, p in self.s["players"].items():
            a = self.s["answers"].get(pid)
            if a and a["ok"]:
                p["streak"] += 1
                bonus = min(STREAK_STEP * (p["streak"] - 1), STREAK_MAX)
                a["pts"] += bonus
                a["bonus"] = bonus
                p["score"] += a["pts"]
                p["right"] += 1
                p["rr"][r["id"]] = p["rr"].get(r["id"], 0) + 1
                self.s["gain"][pid] = self.s["gain"].get(pid, 0) + a["pts"]
                self.badge(p, "first")
                for n in (3, 5, 10):
                    if p["streak"] >= n:
                        self.badge(p, f"streak{n}")
                p["best"] = max(p["best"], p["streak"])
                if fastest is None or a["ms"] < self.s["answers"][fastest]["ms"]:
                    fastest = pid
            else:
                p["streak"] = 0
            if a:
                p["answered"] += 1
        if fastest:
            self.badge(self.s["players"][fastest], "fastest")
        self.s["fastest"] = fastest
        asked = self.s["asked"].setdefault(r["id"], [])
        if self.s["qi"] not in asked:
            asked.append(self.s["qi"])
        if len(asked) == len(r["questions"]):  # the round is over: who got every question right?
            for p in self.s["players"].values():
                if p["rr"].get(r["id"], 0) == len(r["questions"]):
                    self.badge(p, "perfect")
        self.s["phase"] = "reveal"
        self.save()

    @staticmethod
    def badge(p, b):
        if b not in p["badges"]:
            p["badges"].append(b)

    # ---- participants ----
    def player_for(self, token):
        pid = self.s["tokens"].get(token or "")
        return pid if pid in self.s["players"] else None

    def join_room(self, token, name):
        name = re.sub(r"\s+", " ", str(name or "")).strip()
        name = re.sub(r"[\x00-\x1f\x7f<>]", "", name)[:24]
        if not name:
            return 400, {"error": "name"}
        pid = self.player_for(token)
        if any(p["name"].casefold() == name.casefold() for k, p in self.s["players"].items() if k != pid):
            return 409, {"error": "taken"}
        if pid:
            self.s["players"][pid]["name"] = name
        else:
            pid = "p" + secrets.token_hex(4)
            token = secrets.token_urlsafe(18)
            self.s["tokens"][token] = pid
            self.s["players"][pid] = {"name": name, "score": 0, "streak": 0, "best": 0, "right": 0,
                                      "answered": 0, "badges": [], "rr": {}, "awards": [], "joined": now()}
            print(f"  joined: {name}  ({len(self.s['players'])} in the room)", flush=True)
        self.seen[pid] = now()
        self.save()
        return 200, {"t": token, "pid": pid}

    def answer(self, token, choice):
        pid = self.player_for(token)
        if not pid:
            return 403, {"error": "who"}
        r, q = self.question()
        if self.s["phase"] != "question" or not q:
            return 409, {"error": "closed"}
        if pid in self.s["answers"]:
            return 409, {"error": "once"}
        if now() - self.s["opened"] > self.s["seconds"] + GRACE:
            return 409, {"error": "late"}
        # the clock starts when this player's screen first had the question, so a slow poll costs
        # nothing; but no later than LAG after it opened, so waiting to look buys nothing either
        start = min(self.s["qseen"].get(pid, self.s["opened"]), self.s["opened"] + LAG)
        ms = int((now() - start) * 1000)
        if ms > (self.s["seconds"] + GRACE) * 1000:
            return 409, {"error": "late"}
        if not isinstance(choice, int) or not 0 <= choice < len(q["options"]["en"]):
            return 400, {"error": "choice"}
        ok = choice == q["answer"]
        speed = max(0.0, 1 - ms / (self.s["seconds"] * 1000))
        pts = int(round((POINTS + POINTS * speed) / 10) * 10) if ok else 0
        self.s["answers"][pid] = {"i": choice, "ms": ms, "ok": ok, "pts": pts}
        self.seen[pid] = now()
        self.save()
        self.tick()
        return 200, {"ok": True}

    # ---- what each screen sees ----
    def public(self, token=None):
        """The state for the board and the players. Holds no answer until the reveal."""
        s, lang = self.s, self.s["lang"]
        pid = self.player_for(token)
        if pid:
            self.seen[pid] = now()
            if s["phase"] == "question":
                s["qseen"].setdefault(pid, now())
        self.tick()
        ps, ranks = self.ranking()
        here = sum(1 for k in s["players"] if now() - self.seen.get(k, 0) < SEEN)
        v = {"phase": s["phase"], "lang": lang, "seq": s["seq"], "join": self.join, "count": len(ps), "here": here}
        r, q = self.question()
        if r:
            v["round"] = {"id": r["id"], "kind": r["kind"], "title": r["title"][lang], "eyebrow": r["eyebrow"][lang],
                          "n": len(r["questions"]), "qi": s["qi"], "asked": len(s["asked"].get(r["id"], []))}
        if s["phase"] in ("lobby", "intro"):
            v["names"] = [p["name"] for _, p in sorted(ps, key=lambda kv: -kv[1]["joined"])][:60]
        if q and s["phase"] in ("question", "reveal"):
            v["q"] = {"text": q["q"][lang], "code": q.get("code"), "options": q["options"][lang], "imgs": q.get("imgs"),
                      "seconds": s["seconds"], "left": max(0.0, s["opened"] + s["seconds"] - now()),
                      "answered": len(s["answers"]), "kind": r["kind"]}
            if s["phase"] == "reveal":
                counts = [0] * len(q["options"]["en"])
                for a in s["answers"].values():
                    counts[a["i"]] += 1
                v["q"].update(answer=q["answer"], why=q["why"][lang], counts=counts)
                f = s["fastest"]
                if f in s["players"]:
                    v["q"]["fastest"] = {"name": s["players"][f]["name"], "s": round(s["answers"][f]["ms"] / 1000, 1)}
        if s["phase"] in ("board", "podium"):
            # `was` is the rank before the last question and `last` what it earned, so the board can show the climb
            last = lambda k: s["answers"][k]["pts"] if k in s["answers"] and s["answers"][k]["ok"] else 0  # noqa: E731
            v["top"] = [{"pid": k, "name": p["name"], "score": p["score"], "rank": ranks[k],
                         "was": s["prev"].get(k), "last": last(k)} for k, p in ps[:TOP]]
        if pid:
            p = s["players"][pid]
            me = {"name": p["name"], "score": p["score"], "rank": ranks[pid], "of": len(ps), "streak": p["streak"],
                  "badges": p["badges"], "best": p["best"], "gain": s["gain"].get(pid, 0)}
            a = s["answers"].get(pid)
            if s["phase"] == "question":
                me["choice"] = a["i"] if a else None
            elif s["phase"] == "reveal" and q:
                me["choice"] = a["i"] if a else None
                me["result"] = {"ok": bool(a and a["ok"]), "pts": a["pts"] if a else 0,
                                "bonus": a.get("bonus", 0) if a else 0, "fastest": s["fastest"] == pid}
            v["me"] = me
        return v

    def host_view(self):
        s = self.s
        v = self.public()
        ps, ranks = self.ranking()
        v["players"] = [{"pid": k, "name": p["name"], "score": p["score"], "rank": ranks[k], "right": p["right"],
                         "answered": p["answered"], "streak": p["streak"], "badges": p["badges"],
                         "here": now() - self.seen.get(k, 0) < SEEN, "in": k in s["answers"]} for k, p in ps]
        v["rounds"] = [{"id": rid, "day": self.rounds[rid]["day"], "kind": self.rounds[rid]["kind"],
                        "title": self.rounds[rid]["title"][s["lang"]], "eyebrow": self.rounds[rid]["eyebrow"][s["lang"]],
                        "n": len(self.rounds[rid]["questions"]), "asked": len(s["asked"].get(rid, []))} for rid in self.order]
        v["override"] = s["override"]
        v["asked"] = s["asked"]
        r, q = self.question()
        if q:  # the instructor sees the answer before the room does
            v["key"] = {"text": q["q"][s["lang"]], "options": q["options"][s["lang"]], "answer": q["answer"],
                        "why": q["why"][s["lang"]], "code": q.get("code"), "seconds": self.seconds(q)}
        return v

    # ---- the instructor's controls ----
    def host(self, op, body):
        try:
            return self.control(op, body)
        except (KeyError, TypeError, ValueError):
            return 400, {"error": "op"}

    def control(self, op, body):
        s = self.s
        if op == "lang" and body.get("lang") in ("ar", "en"):
            s["lang"] = body["lang"]
        elif op == "round" and body.get("id") in self.rounds:
            rid = body["id"]
            asked = s["asked"].get(rid, [])
            if body.get("again"):  # play a finished round again: its points count again
                asked = s["asked"][rid] = []
                for p in s["players"].values():
                    p["rr"].pop(rid, None)
            n = len(self.rounds[rid]["questions"])
            # a round stopped half way carries on at its first unasked question
            qi = next((i for i in range(n) if i not in asked), n)
            s.update(round=rid, qi=qi, phase="intro", answers={}, gain={}, fastest=None)
        elif op == "next":  # the current question if it has not been asked yet, else the one after it
            if s["phase"] == "question":
                self.reveal()
            r = self.rounds.get(s["round"])
            if not r:
                return 409, {"error": "no round"}
            asked = s["asked"].get(r["id"], [])
            qi = s["qi"] + 1 if s["qi"] in asked else s["qi"]
            while qi in asked:
                qi += 1
            if qi >= len(r["questions"]):
                s.update(qi=len(r["questions"]), phase="podium")
            else:
                _, ranks = self.ranking()
                s.update(qi=qi, phase="question", answers={}, qseen={}, fastest=None, opened=now(), prev=ranks)
                s["seconds"] = self.seconds(r["questions"][qi])
        elif op == "ask":  # the deck opens one question: its own slide's
            r = self.rounds.get(body.get("id"))
            qi = int(body.get("qi", 0))
            if not r or not 0 <= qi < len(r["questions"]):
                return 400, {"error": "question"}
            if s["round"] == r["id"] and s["qi"] == qi and s["phase"] in ("question", "reveal"):
                return 200, {"ok": True}  # already open: a second key press, or the other window
            if s["phase"] == "question":  # moving on before the clock ran out: score that one first
                self.reveal()
            asked = s["asked"].setdefault(r["id"], [])
            if qi in asked and not body.get("again"):
                return 409, {"error": "asked"}
            if qi in asked:  # asked again on purpose: its points count again
                asked.remove(qi)
            if s["round"] != r["id"]:
                s["gain"] = {}
            _, ranks = self.ranking()
            s.update(round=r["id"], qi=qi, phase="question", answers={}, qseen={}, fastest=None, opened=now(), prev=ranks)
            s["seconds"] = self.seconds(r["questions"][qi])
        elif op == "reveal":
            self.reveal()
            return 200, {"ok": True}
        elif op in ("board", "podium", "lobby", "intro"):
            if op == "intro" and not s["round"]:
                return 409, {"error": "no round"}
            s["phase"] = op
        elif op == "seconds":
            s["override"] = int(body["n"]) if body.get("n") else None
        elif op == "award" and body.get("pid") in s["players"]:
            p = s["players"][body["pid"]]
            kind = body.get("kind")
            pts = AWARDS.get(kind, int(body.get("pts") or 0))
            p["score"] += pts
            p["awards"].append({"kind": kind, "pts": pts, "t": now()})
            if kind in AWARDS:
                self.badge(p, kind)
        elif op == "kick" and body.get("pid") in s["players"]:
            pid = body["pid"]
            del s["players"][pid]
            s["tokens"] = {t: k for t, k in s["tokens"].items() if k != pid}
            s["answers"].pop(pid, None)
        elif op == "reset" and body.get("confirm") == "reset":
            self.s = blank(s["lang"])
            self.seen = {}
        else:
            return 400, {"error": "op"}
        self.save()
        return 200, {"ok": True}


def make_handler(room, site):
    class Handler(BaseHTTPRequestHandler):
        server_version = "QuizRoom/1"

        def log_message(self, *args):  # the room polls every second; keep the terminal for joins
            pass

        def local(self):
            return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

        def send(self, code, body, ctype="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            if u.path == "/api/state":
                with room.lock:
                    return self.send(200, room.public(qs.get("t", [None])[0]))
            if u.path == "/api/host":
                if not self.local():
                    return self.send(403, {"error": "host"})
                with room.lock:
                    return self.send(200, room.host_view())
            if u.path == "/deck" or u.path.startswith("/course/"):
                return self.course(u.path)
            if u.path in PAGES:
                if u.path == "/host" and not self.local():
                    return self.send(403, b"The controls open on the instructor's laptop only.", "text/plain; charset=utf-8")
                f = STATIC / PAGES[u.path]
            elif u.path.startswith("/static/"):
                f = (STATIC / u.path[len("/static/"):]).resolve()
                if STATIC not in f.parents or not f.is_file():
                    return self.send(404, b"not found", "text/plain")
            else:
                return self.send(404, b"not found", "text/plain")
            self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"))

        def course(self, path):
            """The course itself, for the instructor's laptop only: its instructor edition has the answers."""
            if not self.local():
                return self.send(403, b"The course opens on the instructor's laptop only.", "text/plain; charset=utf-8")
            if not site:
                return self.send(404, b"No course folder: start room.py inside the course, or pass --site.", "text/plain; charset=utf-8")
            if path == "/deck":  # the instructor's deck, in the room's language
                sub = "" if room.s["lang"] == "en" else room.s["lang"] + "/"
                for d in (f"instructor/{sub}", sub):
                    if (site / d / "deck.html").exists():
                        self.send_response(302)
                        self.send_header("Location", f"/course/{d}deck.html")
                        self.end_headers()
                        return
                return self.send(404, b"No deck in the course folder.", "text/plain")
            f = (site / unquote(path[len("/course/"):])).resolve()
            if f.is_dir():
                f = f / "index.html"
            if (site != f and site not in f.parents) or not f.is_file():
                return self.send(404, b"not found", "text/plain")
            self.send(200, f.read_bytes(), TYPES.get(f.suffix) or mimetypes.guess_type(f.name)[0] or "application/octet-stream")

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4096:
                return self.send(413, {"error": "size"})
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self.send(400, {"error": "json"})
            u = urlparse(self.path)
            with room.lock:
                if u.path == "/api/join":
                    return self.send(*room.join_room(body.get("t"), body.get("name")))
                if u.path == "/api/answer":
                    return self.send(*room.answer(body.get("t"), body.get("i")))
                if u.path.startswith("/api/host/"):
                    if not self.local():
                        return self.send(403, {"error": "host"})
                    return self.send(*room.host(u.path[len("/api/host/"):], body))
            self.send(404, {"error": "path"})

    return Handler


def lan_addresses():
    """This laptop's addresses on the room's network, the likeliest first. No packet is sent."""
    found = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        found.append(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    found = [a for a in dict.fromkeys(found) if not a.startswith("127.")]
    return found or ["127.0.0.1"]


def main():
    ap = argparse.ArgumentParser(description="The course's quiz room.")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--ip", help="the address to show on the board, when the first guess is wrong")
    ap.add_argument("--url", help="the whole join address to show, e.g. for pictures of the room")
    ap.add_argument("--state", default=str(HERE / "room-state.json"), help="where the scores are kept")
    ap.add_argument("--fresh", action="store_true", help="start with an empty leaderboard")
    ap.add_argument("--site", help="the course folder whose deck plays the quiz (found by itself inside the course)")
    a = ap.parse_args()
    ips = lan_addresses()
    ip = a.ip or ips[0]
    join = a.url or (f"http://{ip}:{a.port}/" if a.port != 80 else f"http://{ip}/")
    room = Room(json.loads((HERE / "questions.json").read_text()), Path(a.state), a.fresh, join)
    # the course this room sits in: the published site (room/ beside index.html), or v2/site in the source
    site = Path(a.site).resolve() if a.site else next(
        (d for d in (HERE.parent, HERE.parent / "site") if (d / "index.html").exists()), None)
    srv = ThreadingHTTPServer(("0.0.0.0", a.port), make_handler(room, site))
    srv.daemon_threads = True
    n = len(room.s["players"])
    print(f"""
  The quiz room is open{f', carrying on with {n} players' if n else ''}.

    the deck   http://localhost:{a.port}/deck{'' if site else '   (no course folder found: pass --site)'}
    controls   http://localhost:{a.port}/host
    projector  http://localhost:{a.port}/board
    join       {join}{'''
    (other addresses of this laptop: ''' + ', '.join(ips[1:]) + ')' if len(ips) > 1 else ''}

  Scores are saved in {a.state}. Ctrl+C closes the room; start it again to carry on.
""", flush=True)
    try:
        srv.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\n  The room is closed. The scores are saved.")


if __name__ == "__main__":
    main()
