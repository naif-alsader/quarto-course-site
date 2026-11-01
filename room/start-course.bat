@echo off
rem Double-click to start the course on Windows: the quiz room serves the deck and opens it.
rem Keep this window open while you teach; close it to stop.
cd /d "%~dp0"
where python >nul 2>nul && (python room\room.py --open) || (py room\room.py --open)
pause
