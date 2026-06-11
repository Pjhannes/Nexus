@echo off
title Nexus – Server-Neustart
cd /d D:\Nexus

echo.
echo [Nexus] Stoppe UI-Server auf Port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [Nexus] Starte UI-Server neu...
start "Nexus UI-Server" cmd /k "cd /d D:\Nexus && node src/ui-server.js"

echo.
echo  UI-Server laeuft auf http://localhost:3000
echo  MCP-Server (search, query etc.): Claude Desktop neu starten.
echo.
pause
