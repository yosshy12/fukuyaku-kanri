@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\.codex-static-server.ps1" -Port 4176
pause
