; src-tauri/nsis/hooks.nsh – NSIS-Hooks fuer den Nexus-Installer (tauri.conf.json: installerHooks).
;
; Problem (bei jedem Update seit R25): "Fehler beim Ueberschreiben der Datei ...\node.exe".
; Tauri beendet vor dem Install nur app.exe. Die gebuendelte node.exe wird aber auch von
; Prozessen gehalten, die NICHT der App gehoeren: Claude Desktop (und Cowork/Claude Code)
; starten daraus den MCP-Server (src/server.js) – pro Session eine Instanz – und halten
; ihn, solange sie laufen. Den eigenen UI-Sidecar killt die App schon selbst (lib.rs,
; Updater-Pfad); der manuelle Installer-Lauf und die fremden MCP-Instanzen blieben offen.
;
; Loesung: Vor dem Kopieren (und vor dem Deinstallieren) ALLE Prozesse beenden, deren
; Executable exakt "$INSTDIR\node.exe" ist – gezielt ueber den Pfad, NICHT "alle node.exe"
; (Pauls eigene Node-Projekte, Dev-Server aus D:\Nexus etc. laufen weiter). Danach kurz
; warten, bis das Datei-Handle frei ist (max. 25 x 200 ms).
;
; WICHTIG (Lehre aus v1.2.6): Der NSIS-Installer ist 32-bit und startet damit die 32-bit-
; PowerShell. Dort liefert Get-Process fuer 64-bit-Prozesse KEINEN .Path (Zugriff auf
; Module eines 64-bit-Prozesses verboten) -> der Pfadfilter traf nichts, nichts wurde
; beendet. Deshalb Win32_Process (WMI/CIM): ExecutablePath ist bitness-unabhaengig lesbar,
; Stop-Process -Id beendet auch 64-bit-Prozesse aus der 32-bit-Shell.
;
; Folge fuer Claude Desktop: der nexus-MCP-Server ist bis zum Neustart von Claude Desktop
; getrennt – das war er nach einem Update ohnehin (alter Code im Speicher).
;
; NSIS-Schreibweise: Backtick-Strings erlauben " und ' innen; $$ = literales $ fuer
; PowerShell-Variablen; $INSTDIR wird von NSIS eingesetzt. Im PowerShell-Teil bewusst
; KEINE doppelten Anfuehrungszeichen (die begrenzen -Command).

!macro _NEXUS_KILL_NODE
  DetailPrint "Beende laufende Nexus-Node-Prozesse (MCP-Server, UI-Sidecar) ..."
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$x='$INSTDIR\node.exe'; for($$i=0;$$i -lt 25;$$i++){ $$p=@(Get-CimInstance Win32_Process | Where-Object { $$_.Name -ieq 'node.exe' -and $$_.ExecutablePath -ieq $$x }); if($$p.Count -eq 0){break}; $$p | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 200 }"`
  Pop $0
  DetailPrint "Nexus-Node-Prozesse beendet (PowerShell-Exit $0)."
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro _NEXUS_KILL_NODE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _NEXUS_KILL_NODE
!macroend
