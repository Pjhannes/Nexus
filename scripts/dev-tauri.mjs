// Startet den Nexus-UI-Dev-Server fuer den Tauri-Spike (Phase 0) auf einem
// eigenen Port (3002), getrennt von Prod (3000) und dem alten Electron-Dev (3001).
// Wird von src-tauri/tauri.conf.json als "beforeDevCommand" aufgerufen -- die
// Tauri-CLI startet dieses Skript und wartet, bis devUrl erreichbar ist.
process.env.NEXUS_PORT = process.env.NEXUS_PORT || '3002';
// Dev-Identitaet wie beim Electron-Dev-Starter (Nexus-Dev.vbs): der Connect-
// Button schreibt dadurch den Claude-Key "nexus-dev" statt den Prod-Key
// "nexus" zu ueberschreiben (src/ui-server.js liest NEXUS_DEV fuer mcpKey).
process.env.NEXUS_DEV = process.env.NEXUS_DEV || '1';
await import('../src/ui-server.js');
