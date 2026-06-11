# Nexus Setup – einmal ausfuehren, dann fertig
# Ausfuehren: Rechtsklick auf setup.ps1 -> "Mit PowerShell ausfuehren"
# ODER im Terminal: powershell -ExecutionPolicy Bypass -File D:\Nexus\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "  NEXUS SETUP" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# ── 1. npm install ────────────────────────────────────────────────────────────
Write-Host "[1/4] npm install..." -ForegroundColor Yellow
Set-Location "D:\Nexus"
npm install
Write-Host "      OK" -ForegroundColor Green

# ── 2. Vault-Ordner anlegen ───────────────────────────────────────────────────
Write-Host "[2/4] Vault-Zielordner anlegen..." -ForegroundColor Yellow
$dest = "D:\Knowledge-base\knowledge-base"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Write-Host "      OK: $dest" -ForegroundColor Green

# ── 3. Vault kopieren ─────────────────────────────────────────────────────────
Write-Host "[3/4] Vault kopieren (kann etwas dauern)..." -ForegroundColor Yellow
$src = "C:\Users\pjhan\Documents\knowledge-base"
if (Test-Path $src) {
    # robocopy: schnell, zeigt Fortschritt, ueberspringt unveraenderte Dateien
    robocopy $src $dest /E /MT:8 /NP /NFL /NDL /NC /NS
    Write-Host "      OK: Vault kopiert nach $dest" -ForegroundColor Green
} else {
    Write-Host "      WARNUNG: $src nicht gefunden – Ordner manuell nach $dest kopieren!" -ForegroundColor Red
}

# ── 4. markitdown installieren ────────────────────────────────────────────────
Write-Host "[4/4] markitdown installieren..." -ForegroundColor Yellow
$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    try { $v = & $cmd --version 2>&1; if ($v -match "Python") { $python = $cmd; break } } catch {}
}
if ($python) {
    & $python -m pip install markitdown --quiet
    Write-Host "      OK: markitdown installiert (via $python)" -ForegroundColor Green
} else {
    Write-Host "      WARNUNG: Python nicht gefunden!" -ForegroundColor Red
    Write-Host "      -> https://www.python.org/downloads/ installieren, dann:" -ForegroundColor Red
    Write-Host "         pip install markitdown" -ForegroundColor Red
}

# ── Fertig ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "  SETUP ABGESCHLOSSEN" -ForegroundColor Green
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Nexus UI starten:" -ForegroundColor White
Write-Host "   node D:\Nexus\src\ui-server.js" -ForegroundColor Yellow
Write-Host ""
Write-Host "Dann im Browser: http://localhost:3000" -ForegroundColor White
Write-Host ""

$open = Read-Host "UI jetzt starten? (j/n)"
if ($open -eq "j" -or $open -eq "J") {
    Write-Host "Starte UI... (Fenster offen lassen!)" -ForegroundColor Cyan
    Start-Process "node" -ArgumentList "D:\Nexus\src\ui-server.js" -NoNewWindow
    Start-Sleep 2
    Start-Process "http://localhost:3000"
}
