@echo off
setlocal
title Nexus – Entwickler-Start (Tauri)
cd /d "%~dp0"

if not exist "node_modules" (
    echo [Nexus] node_modules fehlt. Bitte einmalig ausfuehren:
    echo     npm install
    pause
    exit /b 1
)

rem NEXUS_DEV wird von scripts/dev-tauri.mjs ohnehin gesetzt (falls hier nicht
rem vorhanden); hier explizit, damit auch ein direkter Blick auf die Umgebung
rem sofort zeigt, dass dies die Dev-Identitaet ist (Claude-Key "nexus-dev").
set NEXUS_DEV=1

echo [Nexus] Starte Tauri-Dev (Rust-Compile beim ersten Mal / nach Aenderungen
echo         an src-tauri kann einen Moment dauern - Fenster bewusst sichtbar,
echo         damit Fehler/Fortschritt zu sehen sind)...
echo.
call npm run tauri:dev

pause
