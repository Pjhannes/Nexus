// src-tauri/src/lib.rs – Nexus Tauri-Shell (Phase 2 der Electron-Abloesung).
//
// Duenne Shell nach Plan R25: die gesamte App-Logik bleibt JavaScript.
// Rust macht hier NUR, was vorher electron/main.js machte:
//
//   1) Datenordner bestimmen (DATA_DIR-KONTINUITAET: exakt der bisherige
//      Electron-userData-Pfad %APPDATA%\Nexus bzw. ~/Library/Application
//      Support/Nexus – Configs/DBs/Piper-Stimmen bleiben ohne Migration).
//   2) Erststart erkennen (keine nexus.config.json) -> Einrichtungs-Wizard.
//   3) UI-Server starten: im Dev laeuft er schon (beforeDevCommand auf :3002),
//      im Release als Node-SIDECAR (gebuendelte node.exe + resources/src).
//   4) Fenster: Haupt (1280x860), Wizard (620x560), Hilfe (640x720).
//   5) Menue (Nexus/Ansicht/Hilfe) + Single-Instance + Autostart + Dialoge.
//   6) Sidecar-Kill beim Beenden (keine Node-Zombies).
//
// Alles Fachliche (Piper, Claude-Connect, Vault-Ops) laeuft seit Phase 1 als
// REST im UI-Server – die Shell ruft nichts davon direkt auf.
//
// WICHTIG (Review-Befund Phase 2): Das Hauptfenster laedt http://localhost:3000
// und ist damit im RELEASE eine "remote" Origin fuer Tauris ACL. App-Commands
// (invoke) sind von remote Origins ohne App-ACL-Manifest NICHT erreichbar –
// deshalb laeuft "Hilfe oeffnen" aus der Haupt-UI ueber ein EVENT (emit ->
// listen_any hier), nicht ueber invoke. Die Wizard-Commands bleiben invoke:
// das Wizard-Fenster laedt wizard.html als App-URL (lokale Origin), dort ist
// invoke erlaubt. capabilities/default.json traegt die localhost-URLs als
// "remote" ein, damit Event-listen und die Titlebar-Drag-Region funktionieren.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

// Debug (= `tauri dev`): Port 3002, Server kommt vom beforeDevCommand,
// Datenordner = Repo-Wurzel (wie Electron-Dev). Release: Port 3000, Sidecar.
const PORT: u16 = if cfg!(debug_assertions) { 3002 } else { 3000 };
// Dev-Identitaet (R25-Audit #45, Electron-Paritaet zu NEXUS_DEV/Nexus-Dev.vbs):
// eigener Name/AUMID unter `tauri dev`, damit die Taskleiste die Dev-Instanz
// nicht mit einer installierten Prod-App gruppiert. Icon bleibt bewusst
// gemeinsam (Phase-2-Review-Entscheidung, dokumentiert bei Commit 3206be3):
// Tauri hat ohne Config-Verdopplung keinen Mechanismus fuer ein zweites Icon,
// und der Nutzen (rein kosmetische Taskleisten-Unterscheidung) steht in
// keinem Verhaeltnis zum Aufwand.
#[cfg(debug_assertions)]
const APP_NAME: &str = "Nexus Dev";
#[cfg(not(debug_assertions))]
const APP_NAME: &str = "Nexus";
#[cfg(debug_assertions)]
const APP_ID: &str = "com.nexusapp.nexus-dev";
#[cfg(not(debug_assertions))]
const APP_ID: &str = "com.nexusapp.nexus";
// Dunkle Fenster-Hintergruende wie Electron (kein weisser Blitz beim Oeffnen).
const BG_DARK: tauri::window::Color = tauri::window::Color(0x07, 0x09, 0x0f, 0xff);
const BG_WIZARD: tauri::window::Color = tauri::window::Color(0x16, 0x15, 0x14, 0xff);

// Dirty-Schutz beim Schliessen (R25-Audit #12). EIN Mutex fuer alle drei
// Felder (Review: zwei getrennte Mutexe waren nicht atomar):
//   pending = wir warten auf die Antwort der Seite auf 'app:close-requested'.
//   acked   = die Seite hat die Anfrage quittiert ('ui:close-ack', erste Zeile
//             ihres Listeners). Unterscheidet "Dialog steht offen" von "Seite
//             ist tot": Doppelklick aufs X darf NIEMALS einen offenen Dialog
//             uebergehen (Review-Fund: sonst stiller Datenverlust bei der
//             ueblichsten Geste), aber eine tote Seite (Fehlerseite, JS-Crash)
//             darf den Nutzer auch nicht einsperren -> ohne Ack schliesst der
//             zweite Versuch hart.
//   quit    = Menue "Beenden": nach bestaetigtem Close ganze App beenden
//             (Electron-role-quit-Paritaet), nicht nur das Hauptfenster.
#[derive(Default)]
struct CloseState {
    pending: bool,
    acked: bool,
    quit: bool,
}

struct Shell {
    child: Mutex<Option<Child>>,
    zoom: Mutex<f64>,
    data_dir: PathBuf,
    close: Mutex<CloseState>,
    // Wartet update_prompt() auf einen Klick im Update-Fenster; siehe dort.
    update_action_tx: Mutex<Option<tauri::async_runtime::Sender<usize>>>,
    // true, sobald update.html seinen 'update:view'-Listener registriert und
    // 'update:ready' gemeldet hat – gegen den emit-vor-listen-Race (siehe
    // create_update_window). Vor jedem Fenster-Aufbau zurueckgesetzt.
    update_ready: Mutex<bool>,
}

// ── Datenordner (Kontinuitaet zum Electron-userData-Pfad!) ────────────────────
fn resolve_data_dir() -> PathBuf {
    // Expliziter Override gewinnt (Tests, Sonderfaelle) – wie src/paths.js.
    if let Ok(d) = std::env::var("NEXUS_DATA_DIR") {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    if cfg!(debug_assertions) {
        // Dev: Repo-Wurzel (CARGO_MANIFEST_DIR = src-tauri/, eins hoch).
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri hat immer einen Parent")
            .to_path_buf();
    }
    // Release: EXAKT der alte Electron-Pfad (app.getPath('userData') mit
    // app.setName("Nexus")) – NICHT Tauris eigener app_data_dir (der waere
    // %APPDATA%\com.nexusapp.nexus und wuerde alle Bestandsdaten "verlieren").
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").expect("APPDATA ist auf Windows immer gesetzt");
        PathBuf::from(appdata).join(APP_NAME)
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").expect("HOME ist auf macOS immer gesetzt");
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_NAME)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".config").join(APP_NAME)
    }
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("nexus.config.json")
}

// Windows-APIs (u. a. Tauris resource_dir()/document_dir()) liefern oft
// \\?\-Extended-Length-Pfade. Fuer die eigene Rust-Seite unproblematisch,
// aber als Kommandozeilen-Argument an node.exe fuehrt das Praefix zu
// Fehlparsing beim Modul-Resolving (siehe ensure_server). Ohne \\?\
// funktionieren dieselben Pfade unter der ueblichen MAX_PATH-Grenze weiterhin
// einwandfrei -> einfach abstreifen. Sonderfall \\?\UNC\server\share\... ist
// KEIN normaler Pfad nach dem Stripping (das waere "UNC\server\share\..."),
// sondern muss zu \\server\share\... werden (Review-Befund).
fn strip_verbatim_prefix(p: &Path) -> PathBuf {
    let Some(s) = p.to_str() else { return p.to_path_buf() };
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

#[cfg(test)]
mod strip_verbatim_prefix_tests {
    use super::strip_verbatim_prefix;
    use std::path::{Path, PathBuf};

    #[test]
    fn strips_plain_verbatim_prefix() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\C:\Users\pjhan\AppData\Local\Nexus")),
            PathBuf::from(r"C:\Users\pjhan\AppData\Local\Nexus")
        );
    }

    #[test]
    fn rewrites_unc_verbatim_prefix_to_plain_unc() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\UNC\server\share\Nexus")),
            PathBuf::from(r"\\server\share\Nexus")
        );
    }

    #[test]
    fn leaves_non_verbatim_paths_unchanged() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"C:\Users\pjhan\AppData\Local\Nexus")),
            PathBuf::from(r"C:\Users\pjhan\AppData\Local\Nexus")
        );
    }
}

// ── Server-Lebenszyklus ───────────────────────────────────────────────────────
fn port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn wait_for_port(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if port_open(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(format!("Timeout: Port {port} nicht bereit"))
}

// Startet den UI-Server, falls er nicht schon laeuft. Debug: beforeDevCommand
// hat ihn gestartet -> nur warten. Release: Node-Sidecar spawnen.
fn ensure_server(app: &AppHandle) -> Result<(), String> {
    if port_open(PORT) {
        return Ok(());
    }
    if cfg!(debug_assertions) {
        // Dev-Server kommt vom beforeDevCommand – nur (laenger) warten.
        return wait_for_port(PORT, Duration::from_secs(20));
    }
    let shell = app.state::<Shell>();
    {
        let guard = shell.child.lock().unwrap();
        if guard.is_some() {
            // Schon gespawnt, Port noch nicht offen -> unten warten.
            drop(guard);
            return wait_for_port(PORT, Duration::from_secs(15));
        }
    }
    // Gebuendelte Node-Binary liegt (externalBin) neben der App-Exe als "node".
    let exe_dir = strip_verbatim_prefix(
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Exe ohne Parent-Ordner")?,
    );
    let node = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    // strip_verbatim_prefix: resource_dir() liefert unter Windows einen
    // \\?\-Extended-Length-Pfad. Node.js (>= 22, verifiziert mit v24.16.0)
    // crasht beim Aufloesen des Hauptmoduls darauf mit "EISDIR: lstat 'C:'"
    // (Modul-Resolving parst das \\?\-Praefix falsch) – live reproduziert beim
    // ersten Tauri-Installtest. Fuer Pfade unter MAX_PATH ist der Praefix
    // ohnehin unnoetig, also vor der Weitergabe an node.exe abstreifen.
    let ui_server = strip_verbatim_prefix(&app.path().resource_dir().map_err(|e| e.to_string())?)
        .join("src")
        .join("ui-server.js");
    if !node.exists() {
        return Err(format!("Node-Sidecar fehlt: {}", node.display()));
    }
    if !ui_server.exists() {
        return Err(format!("ui-server.js fehlt: {}", ui_server.display()));
    }
    // Sidecar-Ausgabe in eine eigene Logdatei statt ins Nichts – sonst ist ein
    // crashender ui-server im Release unsichtbar (Lehre aus dem v0.5.1-Vorfall:
    // stille Startfehler muessen diagnostizierbar sein).
    let side_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(shell.data_dir.join("nexus-sidecar.log"))
        .ok();
    let (out, err) = match side_log {
        Some(f) => {
            let clone = f.try_clone().ok();
            (
                Stdio::from(f),
                clone.map(Stdio::from).unwrap_or_else(Stdio::null),
            )
        }
        None => (Stdio::null(), Stdio::null()),
    };
    let mut cmd = Command::new(&node);
    cmd.arg(&ui_server)
        .env("NEXUS_PORT", PORT.to_string())
        .env("NEXUS_DATA_DIR", &shell.data_dir)
        // Marker fuer den Sidecar: "du laeufst unter der gepackten Tauri-Shell".
        // Nur damit fuehrt ui-server.js die Claude-Config-Auto-Migration aus
        // (Phase 3) – npm run ui / Dev schreiben nie ungefragt an der Config.
        .env("NEXUS_SHELL", "tauri")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: kein Konsolen-Blitzer
    }
    let child = cmd.spawn().map_err(|e| format!("Sidecar-Start fehlgeschlagen: {e}"))?;
    *shell.child.lock().unwrap() = Some(child);
    wait_for_port(PORT, Duration::from_secs(15))
}

fn kill_sidecar(app: &AppHandle) {
    if let Some(shell) = app.try_state::<Shell>() {
        // Lock nur zum Herausnehmen halten, NICHT waehrend kill()+wait()
        // (Review): sonst blockiert ein paralleler RunEvent::Exit-Pfad kurz auf
        // .lock(). take() ist idempotent -> der zweite Aufrufer bekommt None.
        let child = shell.child.lock().unwrap().take();
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ── Autostart-Altlast der Electron-Generation migrieren (R25-Audit #39) ───────
// Der Electron-Wizard registrierte Autostart als HKCU-Run-Wert
// "com.nexusapp.nexus" auf ...\Programs\Nexus\Nexus.exe. Bleibt der stehen,
// startet beim Login weiter die ALTE Electron-App, besetzt Port 3000, und
// diese App zeigt dann kommentarlos deren (alten) Server. Einmalig beim Start
// der gepackten Tauri-App: Altlast entfernen und die Autostart-Absicht des
// Nutzers auf die neue App uebertragen. Fremde/unerwartete Eintraege bleiben
// unangetastet (Pfad-Signatur der Electron-Installation wird geprueft).
#[cfg(windows)]
fn migrate_electron_autostart(app: &AppHandle) {
    use std::os::windows::process::CommandExt;
    const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "com.nexusapp.nexus";
    // reg.exe absolut (Review-Haertung): per-user-Installationen liegen in
    // schreibbaren Ordnern – kein PATH-/App-Dir-Lookup fuer Systemtools.
    let reg = std::env::var("SystemRoot")
        .map(|r| format!(r"{r}\System32\reg.exe"))
        .unwrap_or_else(|_| "reg.exe".into());
    let out = match Command::new(&reg)
        .args(["query", KEY, "/v", NAME])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return, // kein Alt-Eintrag -> nichts zu tun
    };
    let data = String::from_utf8_lossy(&out.stdout).to_lowercase();
    if !data.contains(r"\programs\nexus\nexus.exe") {
        return; // zeigt nicht auf die Electron-Installation -> nicht anfassen
    }
    let _ = Command::new(&reg)
        .args(["delete", KEY, "/v", NAME, "/f"])
        .creation_flags(0x0800_0000)
        .output();
    let _ = app.autolaunch().enable(); // Absicht uebertragen: Autostart war AN
    log::info!("Autostart-Altlast migriert: Run-Wert '{NAME}' (Electron) entfernt, Tauri-Autostart aktiviert.");
}

// ── Fenster ───────────────────────────────────────────────────────────────────
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
        return Ok(());
    }
    // Frisches Fenster -> etwaige Reste des Dirty-Schutz-Zustands verwerfen
    // (z. B. macOS-Reopen nach bestaetigtem Close).
    *app.state::<Shell>().close.lock().unwrap() = CloseState::default();
    let url: tauri::Url = format!("http://localhost:{PORT}").parse().unwrap();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title(APP_NAME)
        .inner_size(1280.0, 860.0)
        .background_color(BG_DARK)
        // Paritaet zu Electron/Chromium (Live-Befund erster Tauri-Installtest):
        // 1) Tauris OS-Drag-Drop-Handler faengt ALLE HTML5-Drag-Events ab ->
        //    Tab-Reorder (R4), Themen-Kacheln, Notiz-in-Ordner-Verschieben und
        //    Datei-Upload-Drop (R15) waren tot. Abschalten uebergibt Drag&Drop
        //    nativ an die WebView (wie Chromium) – wir nutzen Tauris eigene
        //    Drop-Events nirgends.
        .disable_drag_drop_handler()
        // 2) WebView2 hat Browser-Zoom per Default AUS (IsZoomControlEnabled) ->
        //    Strg+Mausrad/Trackpad-Pinch kam nie in der Seite an; der Notiz-
        //    Zoom-Handler (index.html onNoteWheel, erwartet wheel+ctrlKey wie
        //    unter Chromium) blieb stumm. Electron hatte das implizit an.
        .zoom_hotkeys_enabled(true)
        // 3) Edge-Formular-Autofill aus (Electron/Chromium: aus) – R25-Audit #4.
        .general_autofill_enabled(false)
        .build()?;
    set_app_menu(app)?;
    Ok(())
}

fn create_wizard_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("wizard") {
        let _ = w.set_focus();
        return Ok(());
    }
    // WebviewUrl::App: Release aus dem gebuendelten frontendDist (../public),
    // Dev vom Dev-Server (beide enthalten dieselbe wizard.html). Lokale Origin
    // -> die wizard_* invoke-Commands sind hier erlaubt (siehe Kopfkommentar).
    WebviewWindowBuilder::new(app, "wizard", WebviewUrl::App("wizard.html".into()))
        .title(format!("{APP_NAME} – Einrichtung"))
        .inner_size(620.0, 560.0)
        .resizable(false)
        .background_color(BG_WIZARD)
        .general_autofill_enabled(false) // kein Edge-Autofill im Pfad-Feld
        .build()?;
    Ok(())
}

fn create_help_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("help") {
        let _ = w.set_focus();
        return Ok(());
    }
    // Wie Electron: ueber den UI-Server laden (gleiche Origin wie das Haupt-
    // fenster -> help.html teilt den localStorage und uebernimmt das Theme).
    // Laeuft der Server (noch) nicht, faellt es wie Electron auf die lokale
    // Datei zurueck (ungethemt, aber funktionsfaehig).
    let url = if port_open(PORT) {
        let u: tauri::Url = format!("http://localhost:{PORT}/help.html").parse().unwrap();
        WebviewUrl::External(u)
    } else {
        WebviewUrl::App("help.html".into())
    };
    let mut b = WebviewWindowBuilder::new(app, "help", url)
        .title(format!("{APP_NAME} – Einrichtung & Anbindung"))
        .inner_size(640.0, 720.0)
        .background_color(BG_DARK)
        .zoom_hotkeys_enabled(true); // wie Hauptfenster (Electron-Paritaet)
    // Electron-Paritaet (parent: mainWindow): schwebt ueber dem Hauptfenster
    // statt dahinter zu rutschen. Ohne Hauptfenster (Wizard-Pfad) ohne Parent.
    if let Some(main) = app.get_webview_window("main") {
        b = b.parent(&main)?;
    }
    let w = b.build()?;
    let _ = w.remove_menu(); // Hilfe-Fenster ohne Menueleiste (wie Electron setMenu(null))
    Ok(())
}

// ── Menue (Paritaet zu electron/main.js buildMenu) ────────────────────────────
// Accelerators explizit gesetzt: Electrons Menue-"roles" brachten sie gratis
// mit; Tauri-Items ohne Accelerator haetten Ctrl+R/F11/Ctrl+0... verloren.
// ("Hart neu laden" entfaellt bewusst: der UI-Server liefert HTML eh mit
// no-store, und WebView2 kennt Ctrl+Shift+R nativ.)
fn set_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let connect_item = MenuItem::with_id(app, "menu_connect", "Mit Claude Desktop verbinden", true, None::<&str>)?;
    let help_item = MenuItem::with_id(app, "menu_help", "Einrichtung & Usage-Key…", true, None::<&str>)?;
    let vault_item = MenuItem::with_id(app, "menu_vault", "Vault-Ordner oeffnen", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    // Eigenes Item statt PredefinedMenuItem::quit: laeuft durch den
    // Dirty-Schutz (app:close-requested) statt hart zu beenden.
    let quit_item = MenuItem::with_id(app, "menu_quit", "Beenden", true, None::<&str>)?;

    // macOS-Paritaet zu electron/main.js buildMenu (R25-Audit #23): dort ist
    // das erste Menue zwingend das fette App-Menue mit Ueber-Dialog + Aus-
    // blenden-Rollen; auf Windows/Linux bleibt es das schlanke "Nexus"-Menue.
    #[cfg(target_os = "macos")]
    let nexus_menu = {
        let about = PredefinedMenuItem::about(
            app,
            Some("Ueber Nexus"),
            Some(
                tauri::menu::AboutMetadataBuilder::new()
                    .name(Some(APP_NAME))
                    .version(Some(app.package_info().version.to_string()))
                    .build(),
            ),
        )?;
        let sep0 = PredefinedMenuItem::separator(app)?;
        let sep2 = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, Some("Nexus ausblenden"))?;
        let hide_others = PredefinedMenuItem::hide_others(app, Some("Andere ausblenden"))?;
        let show_all = PredefinedMenuItem::show_all(app, Some("Alle einblenden"))?;
        Submenu::with_items(
            app,
            "Nexus",
            true,
            &[
                &about, &sep0, &connect_item, &help_item, &vault_item, &sep1,
                &hide, &hide_others, &show_all, &sep2, &quit_item,
            ],
        )?
    };
    #[cfg(not(target_os = "macos"))]
    let nexus_menu = Submenu::with_items(
        app,
        "Nexus",
        true,
        &[&connect_item, &help_item, &vault_item, &sep1, &quit_item],
    )?;

    // Vollbild-Accelerator plattformueblich (R25-Audit #22): Electron nutzte
    // F11 auf Windows/Linux, Ctrl+Cmd+F auf macOS.
    #[cfg(target_os = "macos")]
    let fullscreen_accel = Some("Cmd+Ctrl+F");
    #[cfg(not(target_os = "macos"))]
    let fullscreen_accel = Some("F11");

    let view_menu = Submenu::with_items(
        app,
        "Ansicht",
        true,
        &[
            // Ohne Accelerator (Review): Strg+R/F5 handhabt WebView2 nativ –
            // ein Menue-Accelerator dazu wuerde doppelt neu laden.
            &MenuItem::with_id(app, "menu_reload", "Neu laden", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_devtools", "Entwicklerwerkzeuge", true, Some("CmdOrCtrl+Shift+I"))?,
            &PredefinedMenuItem::separator(app)?,
            // Zoom OHNE Accelerators (R25-Audit #20/21): Strg+0/=/− handhabt
            // seit zoom_hotkeys_enabled(true) WebView2 selbst (echte Chromium-
            // Zoomstufen inkl. Numpad-Plus auf DE-Layout) – Menue-Accelerators
            // dazu wuerden doppelt zoomen. Menue-Klick bleibt als Fallback.
            &MenuItem::with_id(app, "menu_zoom_reset", "Zoom zuruecksetzen", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_zoom_in", "Vergroessern", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_zoom_out", "Verkleinern", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "menu_fullscreen", "Vollbild", true, fullscreen_accel)?,
        ],
    )?;
    let help_menu = Submenu::with_items(
        app,
        "Hilfe",
        true,
        &[
            &MenuItem::with_id(app, "menu_help2", "Einrichtung & Usage-Key…", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_connect2", "Mit Claude Desktop verbinden", true, None::<&str>)?,
        ],
    )?;
    let menu = Menu::with_items(app, &[&nexus_menu, &view_menu, &help_menu])?;
    app.set_menu(menu)?;
    Ok(())
}

fn apply_zoom(app: &AppHandle, factor: f64) {
    if let Some(w) = app.get_webview_window("main") {
        let shell = app.state::<Shell>();
        let mut z = shell.zoom.lock().unwrap();
        *z = if factor <= 0.0 { 1.0 } else { (*z * factor).clamp(0.3, 3.0) };
        let _ = w.set_zoom(*z);
    }
}

fn open_vault_folder(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let cfg_file = config_path(&shell.data_dir);
    let target: Option<String> = std::fs::read_to_string(&cfg_file)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|cfg| {
            let active = cfg.get("activeVault").and_then(|v| v.as_str()).map(String::from);
            let vaults = cfg.get("vaults").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let found = vaults
                .iter()
                .find(|v| v.get("name").and_then(|n| n.as_str()) == active.as_deref())
                .or_else(|| vaults.first());
            found
                .and_then(|v| v.get("path").and_then(|p| p.as_str()).map(String::from))
                .or_else(|| cfg.get("vaultsRoot").and_then(|p| p.as_str()).map(String::from))
        });
    match target {
        Some(path) => {
            let _ = app.opener().open_path(path, None::<&str>);
        }
        None => {
            app.dialog()
                .message("Vault-Ordner nicht gefunden")
                .title(APP_NAME)
                .show(|_| {});
        }
    }
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        // Verbinden laeuft ueber die bestehende REST-Route + UI-Toast: das
        // Hauptfenster hoert auf dieses Event und ruft connectClaudeFromSettings().
        "menu_connect" | "menu_connect2" => {
            let _ = app.emit_to("main", "menu:connect-claude", ());
        }
        "menu_help" | "menu_help2" => {
            let _ = create_help_window(app);
        }
        "menu_vault" => open_vault_folder(app),
        "menu_reload" => {
            // reload() statt eval (R25-Audit #18 + Review): eval ist genau
            // dann tot, wenn man es braucht (Edge-Fehlerseite nach Server-
            // Ausfall, haengendes JS). reload() retryt auch die Fehlerseite,
            // pusht keinen History-Eintrag und respektiert beforeunload.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.reload();
            }
        }
        "menu_devtools" => {
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
        }
        "menu_zoom_reset" => apply_zoom(app, 0.0),
        "menu_zoom_in" => apply_zoom(app, 1.1),
        "menu_zoom_out" => apply_zoom(app, 1.0 / 1.1),
        "menu_quit" => {
            // Wie der X-Klick durch den Dirty-Schutz. Ohne Hauptfenster direkt
            // beenden; bei offener Rueckfrage (acked) Fenster fokussieren und
            // die Absicht auf "ganz beenden" hochstufen; nur bei toter Seite
            // (pending ohne ack) hart raus.
            let Some(w) = app.get_webview_window("main") else {
                app.exit(0);
                return;
            };
            let shell = app.state::<Shell>();
            let mut st = shell.close.lock().unwrap();
            if st.pending && !st.acked {
                app.exit(0); // Seite antwortet nicht -> nicht einsperren
            } else if st.pending && st.acked {
                st.quit = true; // Dialog steht offen -> Antwort abwarten
                let _ = w.set_focus();
            } else {
                *st = CloseState { pending: true, acked: false, quit: true };
                let _ = app.emit_to("main", "app:close-requested", ());
            }
        }
        "menu_fullscreen" => {
            if let Some(w) = app.get_webview_window("main") {
                let fs = w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(!fs);
            }
        }
        _ => {}
    }
}

// ── Auto-Update (Phase 4; Paritaet zu electron/updater.js, Windows-Pfad) ──────
// Wie Electron: NUR in der gepackten App, Pruefung ~3 s nach dem Start, und es
// passiert nichts ungefragt – erst Frage vor dem Download, dann Frage vor dem
// Neustart. Anders als Electron laeuft die Installation danach IN-APP (Tauri-
// Updater wendet das signierte NSIS-Paket direkt an, minisign-verifiziert) –
// kein manuelles Installer-Herunterladen mehr, genau wie von Paul gewuenscht.
// V1 mit nativen Dialogen; das gestylte update.html-Fenster ist ein dokumen-
// tierter Feinschliff (Fortschrittsanzeige), kein Funktionsverlust.
fn schedule_update_check(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return; // Dev: keine Releases/Signatur -> wie Electron nichts tun
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        // Eigener Thread + block_on: die Dialoge duerfen hier blockieren, ohne
        // den Main-Thread oder die async-Runtime-Worker aufzuhalten.
        if let Err(e) = tauri::async_runtime::block_on(run_update_check(&handle)) {
            log::warn!("Update-Check fehlgeschlagen: {e}");
        }
    });
}

// ── Update-Fenster: eigenes, gestyltes Fenster statt nativer Dialoge ──────────
// Electron-Paritaet (electron/update-window.js + public/update.html, Studio-
// Dunkel+Amber). Rust <-> JS laeuft wie der Dirty-Schutz oben ueber Events
// statt invoke: 'update:view' {view:'prompt'|'progress',...} raus,
// 'update:action' (geklickter Button-Index) rein.
fn create_update_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("update") {
        let _ = w.set_focus();
        return Ok(w); // existiert schon -> Seite laengst bereit
    }
    *app.state::<Shell>().update_ready.lock().unwrap() = false;
    let mut b = WebviewWindowBuilder::new(app, "update", WebviewUrl::App("update.html".into()))
        .title("Nexus Update")
        .inner_size(460.0, 270.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .decorations(false) // rahmenlos wie das Electron-Original
        .background_color(BG_WIZARD);
    if let Some(main) = app.get_webview_window("main") {
        b = b.parent(&main)?;
    }
    let win = b.build()?;
    // Auf 'update:ready' der Seite warten, BEVOR der Aufrufer den ersten Prompt
    // emittiert (R25-Audit: Tauri puffert Events nicht -> emit-vor-listen wuerde
    // die erste Frage verlieren). Fallback nach 5 s, falls die Seite nie meldet.
    // Laeuft auf dem dedizierten Update-Check-Thread (schedule_update_check) ->
    // blockierendes Warten ist hier unkritisch; der Ready-Listener feuert auf
    // dem Event-Thread und setzt das Flag.
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if *app.state::<Shell>().update_ready.lock().unwrap() {
            break;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    Ok(win)
}

fn close_update_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("update") {
        let _ = w.close();
    }
}

// Zeigt eine Frage im Update-Fenster und wartet auf den Klick (Button-Index).
// usize::MAX = Fenster/App-Fehler statt eines echten Klicks (fail-safe: wird
// wie "letzter Button" = Abbrechen behandelt).
async fn update_prompt(app: &AppHandle, title: &str, message: String, detail: String, buttons: &[&str]) -> usize {
    // Fenster schon weg (Nutzer hat es waehrend des Downloads geschlossen)?
    // Nicht ins Leere emittieren + ewig auf eine Antwort warten (R25-Audit),
    // sondern wie "Abbrechen" behandeln.
    if app.get_webview_window("update").is_none() {
        return buttons.len().saturating_sub(1);
    }
    let (tx, mut rx) = tauri::async_runtime::channel::<usize>(1);
    *app.state::<Shell>().update_action_tx.lock().unwrap() = Some(tx);
    let _ = app.emit_to(
        "update",
        "update:view",
        serde_json::json!({ "view": "prompt", "title": title, "message": message, "detail": detail, "buttons": buttons }),
    );
    rx.recv().await.unwrap_or(buttons.len().saturating_sub(1))
}

fn update_progress(app: &AppHandle, percent: u32, label: &str) {
    let _ = app.emit_to(
        "update",
        "update:view",
        serde_json::json!({ "view": "progress", "percent": percent, "label": label }),
    );
}

async fn run_update_check(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        log::info!("Updater: keine neue Version");
        return Ok(());
    };
    let current = app.package_info().version.to_string();
    create_update_window(app).map_err(|e| e.to_string())?;
    let idx = update_prompt(
        app,
        "Update verfügbar",
        format!("Version {} ist verfügbar.", update.version),
        format!("Installiert: {current}.\n\nJetzt herunterladen und installieren? Deine Daten bleiben erhalten."),
        &["Herunterladen & installieren", "Später"],
    )
    .await;
    if idx != 0 {
        close_update_window(app);
        return Ok(());
    }
    log::info!("Updater: lade Version {} ...", update.version);
    update_progress(app, 0, "Wird heruntergeladen…");
    let mut downloaded: u64 = 0;
    let progress_handle = app.clone();
    // Download und Install BEWUSST getrennt (R25-Audit #4, live reproduziert):
    // Der kombinierte download_and_install() laesst unseren Node-Sidecar bis in
    // den Installer hinein am Leben. Tauri beendet fuer den NSIS-Install nur
    // app.exe selbst – das fremd benannte node.exe-Kind bleibt und sperrt sich
    // selbst -> "Fehler beim Ueberschreiben der Datei ...\node.exe". Deshalb:
    // erst laden, dann Sidecar killen, dann installieren.
    let bytes = match update
        .download(
            move |chunk_length, content_length| {
                downloaded += chunk_length as u64;
                let pct = content_length
                    .filter(|&total| total > 0)
                    .map(|total| ((downloaded as f64 / total as f64) * 100.0).round() as u32)
                    .unwrap_or(0)
                    .min(100);
                update_progress(&progress_handle, pct, "Wird heruntergeladen…");
            },
            || log::info!("Updater: Download fertig"),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => {
            close_update_window(app);
            return Err(e.to_string());
        }
    };
    // Sidecar beenden, BEVOR der Installer die Dateien anfasst (node.exe frei).
    update_progress(app, 100, "Wird installiert…");
    log::info!("Updater: beende Node-Sidecar vor der Installation");
    kill_sidecar(app);
    if let Err(e) = update.install(bytes) {
        log::error!("Updater: Installation fehlgeschlagen: {e}");
        // Der Sidecar ist bereits tot -> das Hauptfenster (localhost:3000) hat
        // kein Backend mehr. Nutzer nicht stumm mit totem Fenster sitzen lassen
        // (Review-Fund): informieren + Neustart anbieten (relauncht die noch
        // installierte bisherige Version, respawnt den Sidecar).
        let idx = update_prompt(
            app,
            "Update fehlgeschlagen",
            "Die Installation konnte nicht abgeschlossen werden.".into(),
            "Nexus muss neu gestartet werden, um weiterzuarbeiten.".into(),
            &["Neu starten", "Später"],
        )
        .await;
        close_update_window(app);
        if idx == 0 {
            app.restart();
        }
        return Err(e.to_string());
    }
    // Auf Windows beendet der Updater die App fuer den Installer i. d. R. selbst;
    // falls nicht (andere Plattformen), bieten wir den Neustart an, ueber
    // dasselbe Fenster (noch offen von der ersten Frage).
    let restart_idx = update_prompt(
        app,
        "Update bereit",
        "Das Update wurde installiert.".into(),
        "Jetzt neu starten?".into(),
        &["Neu starten", "Später"],
    )
    .await;
    close_update_window(app);
    if restart_idx == 0 {
        app.restart();
    }
    Ok(())
}

// ── Wizard-Commands (Ersatz fuer die wizard:* Electron-IPC-Handler) ───────────
// Nur vom Wizard-Fenster aufgerufen (lokale App-URL -> invoke erlaubt).
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WizardOpts {
    vaults_root: Option<String>,
    autostart: Option<bool>,
    launch_now: Option<bool>,
    show_guide: Option<bool>,
}

#[tauri::command]
fn wizard_default_vault_path(app: AppHandle) -> Result<String, String> {
    let docs = strip_verbatim_prefix(&app.path().document_dir().map_err(|e| e.to_string())?);
    Ok(docs.join("Nexus Vaults").to_string_lossy().into_owned())
}

#[tauri::command]
async fn wizard_browse(app: AppHandle) -> Result<Option<String>, String> {
    // blocking_pick_folder ist ok: async Commands laufen NICHT auf dem Main-Thread.
    // parent = Wizard-Fenster, damit der Dialog modal davor liegt (wie Electron).
    let mut dlg = app.dialog().file();
    if let Some(w) = app.get_webview_window("wizard") {
        dlg = dlg.set_parent(&w);
    }
    let picked = dlg.blocking_pick_folder();
    Ok(picked.and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

// Erst-Config exakt wie electron/main.js seedConfig() – gleiche Felder/Defaults.
fn seed_config(app: &AppHandle, vaults_root: Option<&str>) -> Result<(), String> {
    let shell = app.state::<Shell>();
    let root: PathBuf = match vaults_root.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => PathBuf::from(s),
        None => strip_verbatim_prefix(&app.path().document_dir().map_err(|e| e.to_string())?)
            .join("Nexus Vaults"),
    };
    let vault_path = root.join("knowledge-base");
    std::fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&shell.data_dir).map_err(|e| e.to_string())?;
    let seed = serde_json::json!({
        "_comment": "Beim ersten Start ueber den Einrichtungs-Assistenten erzeugt. Keine vorbefuellten Inhalte.",
        "vaultsRoot": root.to_string_lossy(),
        "activeVault": "knowledge-base",
        "vaults": [
            { "name": "knowledge-base", "path": vault_path.to_string_lossy(), "dbPath": ".nexus/knowledge-base.db" }
        ],
        "ui": { "port": PORT, "autoOpen": false },
        "ignore": [".obsidian", ".trash", ".nexus", "node_modules"]
    });
    std::fs::write(
        config_path(&shell.data_dir),
        serde_json::to_string_pretty(&seed).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn wizard_finish(app: AppHandle, opts: WizardOpts) -> Result<serde_json::Value, String> {
    // Re-Run ohne echte Erst-Config -> nichts ueberschreiben (wie Electron).
    {
        let shell = app.state::<Shell>();
        if !config_path(&shell.data_dir).exists() {
            seed_config(&app, opts.vaults_root.as_deref())?;
        }
    }
    let autostart = opts.autostart.unwrap_or(false);
    let al = app.autolaunch();
    let r = if autostart { al.enable() } else { al.disable() };
    if let Err(e) = r {
        log::warn!("Autostart setzen fehlgeschlagen: {e}");
    }

    let launch = opts.launch_now.unwrap_or(true);
    let guide = opts.show_guide.unwrap_or(false);

    if launch {
        ensure_server(&app)?;
        create_main_window(&app).map_err(|e| e.to_string())?;
        schedule_update_check(&app);
    }
    if guide {
        if let Err(e) = ensure_server(&app) {
            log::warn!("Server fuer Hilfe-Fenster: {e}");
        }
        let _ = create_help_window(&app);
    }
    if let Some(w) = app.get_webview_window("wizard") {
        let _ = w.close();
    }
    if !launch && !guide {
        app.exit(0);
    }
    Ok(serde_json::json!({ "ok": true }))
}

// Taskleisten-Identitaet/-Gruppierung (Phase-2-Review-TODO, "Kosmetik"): explizit
// setzen statt uns auf einen unbestaetigten Tauri-Default zu verlassen – exakt der
// Wert, den auch der NSIS-Installer als AppUserModelID auf die Verknuepfung
// schreibt (identifier aus tauri.conf.json). Greift unabhaengig davon, ob die App
// ueber die Verknuepfung, per Doppelklick auf die exe oder aus `tauri dev` startet.
#[cfg(windows)]
fn set_taskbar_identity() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_ID)) };
}
#[cfg(not(windows))]
fn set_taskbar_identity() {}

// ── Einstieg ──────────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    set_taskbar_identity();
    let mut builder = tauri::Builder::default();
    // Single-Instance nur im RELEASE und als ERSTES Plugin (Doku): Zweitstart
    // fokussiert das bestehende Fenster statt EADDRINUSE. Im Debug bewusst NICHT:
    // der Lock haengt am identifier (com.nexusapp.nexus) – mit Plugin wuerde
    // `tauri dev` neben einer laufenden Tauri-Installation sofort beendet
    // (Dev/Prod-Parallelbetrieb wie bei Electron bleibt so erhalten).
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            for label in ["main", "wizard", "help"] {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                    break;
                }
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            wizard_default_vault_path,
            wizard_browse,
            wizard_finish
        ])
        .on_page_load(|webview, _payload| {
            // Reload/Navigation im Hauptfenster verwirft eine haengende Close-
            // Anfrage (Review-Fund: Ctrl+R bei offener Rueckfrage strandete
            // pending=true -> der naechste X-Klick haette hart geschlossen).
            if webview.label() == "main" {
                *webview.state::<Shell>().close.lock().unwrap() = CloseState::default();
            }
        })
        .on_window_event(|window, event| {
            // Dirty-Schutz beim Schliessen (R25-Audit #12, Electron-Paritaet):
            // Tauri wuerde das Hauptfenster sonst OHNE beforeunload zerstoeren –
            // ungespeicherte Editor-Aenderungen waeren kommentarlos weg. Ablauf:
            // Close anhalten -> 'app:close-requested' an die Seite -> die prueft
            // isDirty()/fragt nach -> 'ui:close-confirmed'/'-cancelled' zurueck.
            // Haengt die Seite (Fehlerseite, JS tot), schliesst der ZWEITE
            // X-Klick hart – niemand wird eingesperrt. Nur "main": Wizard/Hilfe
            // haben keinen Editor-Zustand.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let shell = window.state::<Shell>();
                    let mut st = shell.close.lock().unwrap();
                    if st.pending && !st.acked {
                        return; // Seite tot (nie quittiert) -> Schliessen durchlassen
                    }
                    if st.pending && st.acked {
                        // Rueckfrage steht offen (z. B. Doppelklick aufs X) ->
                        // NICHT hart schliessen, nur den Dialog nach vorne holen.
                        api.prevent_close();
                        let _ = window.set_focus();
                        return;
                    }
                    st.pending = true;
                    st.acked = false;
                    api.prevent_close();
                    let _ = window.emit_to("main", "app:close-requested", ());
                }
            }
            // Selbst-Review-Fund (Update-Fenster-Bridge, s. run_update_check):
            // schliesst der Nutzer das Update-Fenster per [X] statt einen
            // Button zu klicken, feuert nie 'update:action' -> ohne dieses
            // Aufraeumen wuerde update_prompt()s rx.recv().await fuer immer
            // haengen (der Sender bleibt in Shell.update_action_tx liegen)
            // und der Update-Check-Hintergrund-Thread waere dauerhaft
            // blockiert. Sender einfach droppen (nicht senden) -> recv()
            // liefert sauber None, update_prompt() faellt auf den
            // "letzter Button" = Abbrechen-Fallback zurueck. Kein
            // prevent_close noetig, das Fenster soll ja wirklich zugehen.
            if window.label() == "update" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let shell = window.state::<Shell>();
                    let _ = shell.update_action_tx.lock().unwrap().take();
                }
            }
        })
        .setup(|app| {
            let data_dir = resolve_data_dir();
            let _ = std::fs::create_dir_all(&data_dir);
            // Logging IMMER (auch Release!) in <DATA_DIR>/nexus.log – dieselbe
            // Datei wie bei Electron. Lehre aus v0.5.1: eine gepackte App, die
            // stumm stirbt, ist nicht diagnostizierbar. Debug zusaetzlich stdout.
            {
                let mut lb = tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    // Plugin-Default waeren winzige 40 kB (R25-Audit #46) –
                    // Electron rotierte nie. 5 MB halten Wochen an Historie.
                    .max_file_size(5_000_000)
                    .clear_targets()
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Folder {
                            path: data_dir.clone(),
                            file_name: Some("nexus".into()),
                        },
                    ));
                if cfg!(debug_assertions) {
                    lb = lb.target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ));
                }
                app.handle().plugin(lb.build())?;
            }
            log::info!("DATA_DIR: {}", data_dir.display());
            app.manage(Shell {
                child: Mutex::new(None),
                zoom: Mutex::new(1.0),
                data_dir: data_dir.clone(),
                close: Mutex::new(CloseState::default()),
                update_action_tx: Mutex::new(None),
                update_ready: Mutex::new(false),
            });
            app.on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()));

            // Nur gepackt (Release): Alt-Autostart der Electron-Installation
            // uebernehmen. Dev fasst die Registry nie an.
            #[cfg(windows)]
            if !cfg!(debug_assertions) {
                migrate_electron_autostart(app.handle());
            }

            // "Hilfe oeffnen" aus der Haupt-UI: Event statt invoke (remote Origin,
            // siehe Kopfkommentar). index.html emittiert 'ui:open-help'.
            let help_handle = app.handle().clone();
            app.listen_any("ui:open-help", move |_| {
                let _ = create_help_window(&help_handle);
            });

            // Antworten der Seite auf den Dirty-Schutz (siehe on_window_event):
            // ack -> Anfrage kam an (unterscheidet offene Rueckfrage von toter
            // Seite); bestaetigt -> Fenster wirklich zerstoeren (destroy loest
            // KEIN erneutes CloseRequested aus), bei Menue-Beenden ganz raus.
            // WICHTIG (Review): confirmed nur honorieren, wenn wirklich eine
            // Close-Anfrage laeuft – sonst koennte beliebiger Seiten-Code das
            // Fenster jederzeit wegreissen.
            let ack_handle = app.handle().clone();
            app.listen_any("ui:close-ack", move |_| {
                let shell = ack_handle.state::<Shell>();
                let mut st = shell.close.lock().unwrap();
                if st.pending {
                    st.acked = true;
                }
            });
            let close_handle = app.handle().clone();
            app.listen_any("ui:close-confirmed", move |_| {
                let quit = {
                    let shell = close_handle.state::<Shell>();
                    let mut st = shell.close.lock().unwrap();
                    if !st.pending {
                        return; // nie angefragt -> ignorieren
                    }
                    let q = st.quit;
                    *st = CloseState::default();
                    q
                };
                if let Some(w) = close_handle.get_webview_window("main") {
                    let _ = w.destroy();
                }
                if quit {
                    close_handle.exit(0);
                }
            });
            let cancel_handle = app.handle().clone();
            app.listen_any("ui:close-cancelled", move |_| {
                let shell = cancel_handle.state::<Shell>();
                *shell.close.lock().unwrap() = CloseState::default();
            });

            // Klick im Update-Fenster (siehe update_prompt): an den wartenden
            // Channel weiterreichen, falls gerade eine Frage offen ist.
            let update_action_handle = app.handle().clone();
            app.listen_any("update:action", move |event| {
                if let Ok(idx) = event.payload().parse::<usize>() {
                    let shell = update_action_handle.state::<Shell>();
                    let tx = shell.update_action_tx.lock().unwrap().take();
                    if let Some(tx) = tx {
                        let _ = tx.try_send(idx);
                    }
                }
            });

            // update.html meldet, sobald sein 'update:view'-Listener steht ->
            // create_update_window wartet darauf (emit-vor-listen-Race).
            let update_ready_handle = app.handle().clone();
            app.listen_any("update:ready", move |_| {
                *update_ready_handle.state::<Shell>().update_ready.lock().unwrap() = true;
            });

            // Zoom-Buchfuehrung angleichen (Review): Strg+Rad/Strg+± zoomen
            // nativ an apply_zoom vorbei und tauri 2.11 hat keinen Getter –
            // die Seite meldet den echten Faktor ueber devicePixelRatio.
            let zoom_handle = app.handle().clone();
            app.listen_any("ui:zoom-level", move |event| {
                if let Ok(z) = event.payload().parse::<f64>() {
                    if z.is_finite() && (0.1..=10.0).contains(&z) {
                        *zoom_handle.state::<Shell>().zoom.lock().unwrap() = z;
                    }
                }
            });

            let first_run = !config_path(&data_dir).exists()
                || std::env::var("NEXUS_FORCE_WIZARD").as_deref() == Ok("1");
            let handle = app.handle().clone();
            if first_run {
                create_wizard_window(&handle)?;
            } else {
                // Wie Electron: erst Server bereit, dann Fenster (kein weisses Fenster).
                if let Err(e) = ensure_server(&handle) {
                    // Sichtbar scheitern statt stiller Panik: loggen + Dialog + Exit.
                    log::error!("Start fehlgeschlagen: {e}");
                    handle
                        .dialog()
                        .message(format!(
                            "Nexus konnte den internen Server nicht starten:\n\n{e}\n\nDetails: {}",
                            data_dir.join("nexus.log").display()
                        ))
                        .title(format!("{APP_NAME} – Start fehlgeschlagen"))
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    std::process::exit(1);
                }
                create_main_window(&handle)?;
                schedule_update_check(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => kill_sidecar(app_handle),
        // macOS-Paritaet zu electron/main.js: window-all-closed quittet dort
        // NUR non-darwin (R25-Audit #13). Ohne das wuerde Tauri die App beim
        // letzten Fenster beenden -> der Reopen-Pfad unten waere toter Code,
        // die App verschwaende komplett statt im Dock liegenzubleiben.
        // NUR nutzer-initiiertes Beenden (Cmd+Q, code=None) abfangen, damit die
        // App im Dock bleibt. Programmatisches app.exit()/restart() (code=Some,
        // z. B. wizard_finish "nicht starten" oder Updater-Neustart) NICHT
        // verschlucken (R25-Audit: sonst fenster-/menueloser Zombie bzw. Update
        // ohne Neustart).
        #[cfg(target_os = "macos")]
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        // macOS: Klick aufs Dock-Icon ohne offene Fenster -> Hauptfenster neu
        // (Electron-Paritaet app.on('activate'); die Enum-Variante existiert
        // nur auf macOS, daher cfg-gated). has_visible_windows kommt direkt
        // von NSApplication (R25-Audit #14: praeziser als eine Handliste
        // einzelner Fensternamen, deckt Hilfe-Fenster automatisch mit ab).
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                let _ = create_main_window(app_handle);
            }
        }
        _ => {}
    });
}
