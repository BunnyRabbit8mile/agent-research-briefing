@echo off
set NODE_OPTIONS=--use-system-ca
echo === arXiv Daily Briefing (scheduled at 13:00) ===
node arxiv_feishu_briefing.js
echo.
echo === Watchdog: checking for errors ===
node watchdog.js
echo.
echo === Done ===