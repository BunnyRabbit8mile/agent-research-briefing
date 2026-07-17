@echo off
set NODE_OPTIONS=--use-system-ca
echo === arXiv Daily Briefing (scheduled at 13:00) ===
D:\nvm\v26.3.1\node.exe C:\Users\hotsa\Documents\agent-research-daily-report\arxiv_feishu_briefing.js
echo.
echo === Watchdog: checking for errors ===
D:\nvm\v26.3.1\node.exe C:\Users\hotsa\Documents\agent-research-daily-report\watchdog.js
echo.
echo === Done ===