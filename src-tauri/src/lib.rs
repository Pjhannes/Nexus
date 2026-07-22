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
use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

// Debug (= `tauri dev`): Port 3002, Server kommt vom beforeDevCommand,
// Datenordner = Repo-Wurzel (wie Electron-Dev). Release: Port 3000, Sidecar.
const PORT: u16 = if cfg!(debug_assertions) { 3002 } else { 3000 };
const APP_NAME: &str = "Nexus";
// Dunkle Fenster-Hintergruende wie Electron (kein weisser Blitz beim Oeffnen).
const BG_DARK: tauri::window::Color = tauri::window::Color(0x07, 0x09, 0x0f, 0xff);
const BG_WIZARD: tauri::window::Color = tauri::window::Color(0x16, 0x15, 0x14, 0xff);

struct Shell {
    child: Mutex<Option<Child>>,
    zoom: Mutex<f64>,
    data_dir: PathBuf,
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
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Exe ohne Parent-Ordner")?
        .to_path_buf();
    let node = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let ui_server = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
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
        if let Some(mut child) = shell.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ── Fenster ───────────────────────────────────────────────────────────────────
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
        return Ok(());
    }
    let url: tauri::Url = format!("http://localhost:{PORT}").parse().unwrap();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title(APP_NAME)
        .inner_size(1280.0, 860.0)
        .background_color(BG_DARK)
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
    let w = WebviewWindowBuilder::new(app, "help", url)
        .title(format!("{APP_NAME} – Einrichtung & Anbindung"))
        .inner_size(640.0, 720.0)
        .background_color(BG_DARK)
        .build()?;
    let _ = w.remove_menu(); // Hilfe-Fenster ohne Menueleiste (wie Electron setMenu(null))
    Ok(())
}

// ── Menue (Paritaet zu electron/main.js buildMenu) ────────────────────────────
// Accelerators explizit gesetzt: Electrons Menue-"roles" brachten sie gratis
// mit; Tauri-Items ohne Accelerator haetten Ctrl+R/F11/Ctrl+0... verloren.
// ("Hart neu laden" entfaellt bewusst: der UI-Server liefert HTML eh mit
// no-store, und WebView2 kennt Ctrl+Shift+R nativ.)
fn set_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let nexus_menu = Submenu::with_items(
        app,
        "Nexus",
        true,
        &[
            &MenuItem::with_id(app, "menu_connect", "Mit Claude Desktop verbinden", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_help", "Einrichtung & Usage-Key…", true, None::<&str>)?,
            &MenuItem::with_id(app, "menu_vault", "Vault-Ordner oeffnen", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Beenden"))?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "Ansicht",
        true,
        &[
            &MenuItem::with_id(app, "menu_reload", "Neu laden", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "menu_devtools", "Entwicklerwerkzeuge", true, Some("CmdOrCtrl+Shift+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "menu_zoom_reset", "Zoom zuruecksetzen", true, Some("CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "menu_zoom_in", "Vergroessern", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "menu_zoom_out", "Verkleinern", true, Some("CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "menu_fullscreen", "Vollbild", true, Some("F11"))?,
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
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("window.location.reload()");
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
        "menu_fullscreen" => {
            if let Some(w) = app.get_webview_window("main") {
                let fs = w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(!fs);
            }
        }
        _ => {}
    }
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
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
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
        None => app
            .path()
            .document_dir()
            .map_err(|e| e.to_string())?
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

// ── Einstieg ──────────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![
            wizard_default_vault_path,
            wizard_browse,
            wizard_finish
        ])
        .setup(|app| {
            let data_dir = resolve_data_dir();
            let _ = std::fs::create_dir_all(&data_dir);
            // Logging IMMER (auch Release!) in <DATA_DIR>/nexus.log – dieselbe
            // Datei wie bei Electron. Lehre aus v0.5.1: eine gepackte App, die
            // stumm stirbt, ist nicht diagnostizierbar. Debug zusaetzlich stdout.
            {
                let mut lb = tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
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
            });
            app.on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()));

            // "Hilfe oeffnen" aus der Haupt-UI: Event statt invoke (remote Origin,
            // siehe Kopfkommentar). index.html emittiert 'ui:open-help'.
            let help_handle = app.handle().clone();
            app.listen_any("ui:open-help", move |_| {
                let _ = create_help_window(&help_handle);
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
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::Exit => kill_sidecar(app_handle),
        // macOS: Klick aufs Dock-Icon ohne offene Fenster -> Hauptfenster neu
        // (Electron-Paritaet app.on('activate'); die Enum-Variante existiert
        // nur auf macOS, daher cfg-gated).
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if app_handle.get_webview_window("main").is_none()
                && app_handle.get_webview_window("wizard").is_none()
            {
                let _ = create_main_window(app_handle);
            }
        }
        _ => {}
    });
}
