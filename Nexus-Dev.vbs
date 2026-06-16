' Nexus-Dev.vbs – startet die Nexus-Entwickler-Version OHNE sichtbares CMD-Fenster.
'
' Doppelklick (oder eine Verknuepfung darauf) startet die App aus dem Quellcode
' ("npm run app" = Electron) im Hintergrund. Ersetzt start-app.bat, das ein
' schwarzes Konsolenfenster offen liess.
'
' Voraussetzung (einmalig nach dem Klonen / nach Dependency-Aenderungen):
'   im Projektordner einmal  npm install  ausfuehren.
' Danach reicht ein Doppelklick auf diese Datei.
'
' Tipp: Rechtsklick auf die Datei -> "Verknuepfung erstellen", die Verknuepfung
' umbenennen in "Nexus (Dev)" und ihr ueber Eigenschaften -> Anderes Symbol das
' build\icon.ico zuweisen. Die Verknuepfung laesst sich an Taskleiste/Start anheften.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' Arbeitsverzeichnis = Ordner dieser .vbs (das Projektverzeichnis)
projDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = projDir

If Not fso.FolderExists(fso.BuildPath(projDir, "node_modules")) Then
  MsgBox "node_modules fehlt." & vbCrLf & vbCrLf & _
         "Bitte einmalig im Projektordner ausfuehren:" & vbCrLf & _
         "    npm install", vbExclamation, "Nexus – Entwickler-Start"
  WScript.Quit 1
End If

' NEXUS_DEV=1 => eigene Identitaet "Nexus Dev" (Port 3001, Claude-Key nexus-dev), damit die
' Dev-Version parallel zur installierten "Nexus"-App laufen kann - beide auf demselben Vault.
sh.Environment("PROCESS")("NEXUS_DEV") = "1"

' 0 = unsichtbares Fenster, False = nicht auf Beenden warten.
sh.Run "cmd /c npm run app", 0, False
