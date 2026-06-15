# Nexus – Anweisungen für Claude (jede Session)

1. **ZUERST `STATUS.md` lesen** – einzige Quelle der Wahrheit über Fortschritt und nächste Schritte. Dann dort weitermachen, wo die letzte Session aufgehört hat.
2. **Am Ende jedes Arbeitsblocks `STATUS.md` aktualisieren** (Erledigt abhaken, Nächste Schritte fortschreiben, Usage-Log-Zeile ergänzen). Ohne das ist die Session für Paul wertlos.
3. Sprache: **JavaScript/Node (ESM), KEIN Rust, KEIN TypeScript-Build-Schritt.** Entscheidung vom 2026-06-10 – nicht erneut diskutieren, Begründung steht in STATUS.md.
4. Design-Prinzip aller MCP-Tools: **maximale Information pro Token** – Snippets statt Volldateien, Abschnitts-Reads, harte Limits mit Pagination.
5. Tests laufen in der Sandbox unter `/tmp` mit eigener Kopie + eigenem `npm install` (Linux). **Niemals node_modules aus der Sandbox nach D:\Nexus schreiben** – Paul installiert auf Windows selbst via `npm install`.
6. Code-Stil: kleine Module, pure functions in `src/tools.js` (testbar ohne MCP-Transport), keine unnötigen Dependencies (aktuell nur: @modelcontextprotocol/sdk, better-sqlite3, yaml).
7. Pauls Arbeitsregeln gelten weiterhin (sichtbare Todo-Liste, Verifikation am Ende, Konversationsarchiv im Vault, Usage-Tracking). **Nexus-adaptierte Quelle der Wahrheit (R12, Session 31):** generisches Scaffold in `D:\Nexus\rules\` (`Arbeitsweise.md` + `Session-Start.md` + `Mein-Setup.template.md`), Live-Kopie im Vault unter `_System/Arbeitsweise-Nexus.md` / `Session-Start-Nexus.md` + persönliches Overlay `_System/Mein-Setup.md`. Obsidian-Mechanik (Dataview, `app.vault`-JS-Snippets, `.obsidian/graph.json`) ist dort durch Nexus-MCP-Äquivalente ersetzt. Die Original-`_System/Arbeitsweise.md` im Vault bleibt unangetastet, bis Paul den Wechsel freigibt.
