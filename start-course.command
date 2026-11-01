#!/bin/bash
# Double-click to start the course on a Mac: the quiz room serves the deck and opens it in the
# browser. Keep this window open while you teach; close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
python3 room/room.py --open
