@echo off
title AI Image Studio Mobile Suite
echo =======================================================
echo    AI Image Studio - Mobile Backend Launcher
echo =======================================================
echo.
echo [1/2] Launching Cloudflare Tunnel in a new window...
echo Please copy the https://...trycloudflare.com URL from the new window.
echo.
start "Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:8000"

echo [2/2] Launching FastAPI Backend Server...
echo Loading models and listening on port 8000...
echo.
.\venv\Scripts\python.exe server.py

pause
