@echo off
title Nexus – App-Start
cd /d D:\Nexus

echo.
echo [Nexus] Stoppe laufenden Server auf Port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [Nexus] npm install...
call npm install
if errorlevel 1 (
    echo [Nexus] FEHLER bei npm install. Abbruch.
    pause
    exit /b 1
)

echo [Nexus] Starte App (npm run app)...
call npm run app

pause
