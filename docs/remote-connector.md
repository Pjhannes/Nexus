# Nexus als Remote-Connector

`src/mcp-http.js` stellt die Tools von Nexus über HTTP bereit, damit Claude (Web, Mobil,
Desktop) einen Vault als **Custom Connector** nutzen kann. Der Einstieg ist optional und
eigenständig: Die Desktop-App und der UI-Server starten ihn nie.

**Standard ist nur lesen.** Schreiben (`NEXUS_MCP_LEVELS`) und Download-Links
(`NEXUS_MCP_DOWNLOAD_SECRET`) werden einzeln eingeschaltet.

```
Claude ──HTTPS──► Reverse-Proxy ──HTTP──► node src/mcp-http.js ──► Vault
                                              │
                        prüft das Bearer-Token gegen die JWKS des Autorisierungsservers
```

Alle Beispiele verwenden Platzhalter (`example.com`, `<…>`). Eigene Werte gehören in die
Umgebung des Prozesses, nicht ins Repository.

## Was der Server tut

| Route | Verhalten |
|---|---|
| `POST /mcp` | MCP über Streamable HTTP, zustandslos, Antwort als JSON. Braucht ein gültiges Bearer-Token. |
| `GET`, `DELETE` (und alles andere) auf `/mcp` | `405` |
| `GET /.well-known/oauth-protected-resource` und `…/oauth-protected-resource/mcp` | Öffentliche Metadaten (RFC 9728): `resource`, `authorization_servers`, `bearer_methods_supported`, optional `scopes_supported` |
| `GET /dl/<token>/<name>` | Nur mit `NEXUS_MCP_DOWNLOAD_SECRET`: liefert die Datei aus einem Download-Link (siehe „Download-Links“). Ohne Bearer-Token – der signierte Token im Pfad ist die Berechtigung. |
| `GET /healthz` | `200` mit `{"status":"ok"}` – ohne Token, von der Host-Allowlist ausgenommen, ohne Angaben zu Vaults, Version oder Konfiguration. Bei `NEXUS_MCP_ENABLED=0`: `503`. |
| alles andere | `404` |

## Stufen

Welche Tools es gibt, bestimmt `NEXUS_MCP_LEVELS`. Ein Tool, das zu keiner eingeschalteten Stufe
gehört, wird nicht registriert – es steht nicht in `tools/list` und ist nicht aufrufbar.

| Stufe | Tools |
|---|---|
| `read` (immer) | `search`, `outline`, `read_note`, `read_bild`, `backlinks`, `list_notes`, `query`, `dataview`, `lern_status`, `list_vaults`, `list_trash` |
| `write` | `write_note`, `append_to_section`, `patch`, `write_karten`, `write_vortrag`, `karten_gliedern`, `create_folder`, `move`, `restore`, `capture`, `vault_check` (nur Trockenlauf) |
| `admin` | `delete`, `reindex`; `vault_check` schreibt seinen Bericht in den Vault |

Zusätzlich gelten für den Remote-Zugriff feste Regeln, unabhängig von der Stufe:

- `delete` verschiebt in den Papierkorb. Endgültiges Löschen (`permanent`) ist gesperrt.
- Unter `_System` wird nichts gelöscht und nichts herausverschoben (Umbenennen innerhalb geht).
- Versteckte Pfade (ein Segment beginnt mit `.`: `.trash`, `.stignore`, `.stfolder`, `.git`, …)
  sind nicht schreibbar, nicht verschiebbar und nicht löschbar – auch nicht in den Papierkorb.
  Aus dem Papierkorb holt `restore` zurück, aber nur an ein Ziel, das nicht versteckt ist.
- Nur freigegebene Vaults (`NEXUS_MCP_ALLOWED_VAULTS`) sind erreichbar.

**Kollisionsschutz:** `write_note`, `patch` und `append_to_section` nehmen `expected_hash` an – den
Hash des Stands, auf dem die Änderung beruht (`hash` aus `outline`, aus `read_note` mit
`hash: true` oder aus dem letzten Schreib-Ergebnis). Wurde die Notiz inzwischen geändert, etwa auf
einem anderen Gerät, schlägt der Aufruf fehl und nennt den aktuellen Hash; geschrieben wird nichts.

Der Vault muss für Schreibstufen beschreibbar eingehängt sein. `capture` legt Notizen im Ordner
aus `capture.folder` der `nexus.config.json` ab (Standard `_Eingang`); der Dateiname enthält die
Ortszeit des Servers – im Container die Zeitzone setzen (`TZ`).

**Token-Prüfung** (lokal, ohne Rückfrage beim Aussteller): JWT mit `alg` RS256 und `typ` `at+jwt`,
Signatur gegen die JWKS (mit Cache), `iss` zeichengenau, `aud` enthält die Ressourcen-URL, `exp`,
`nbf`. Scopes werden aus dem Claim `scp` (Array) gelesen. Danach muss `sub` in der Allowlist stehen.

| Fall | Antwort |
|---|---|
| Token fehlt oder ist ungültig | `401` mit `WWW-Authenticate: Bearer resource_metadata="…"` (mit `NEXUS_MCP_SCOPES_SUPPORTED` zusätzlich `scope="…"`) |
| Token gültig, `sub` nicht freigegeben | `403` |
| JWKS nicht erreichbar | `503` (der Client behält sein Token) |
| falscher `Host`-Header oder fremder `Origin` | `403` |
| Body über 2 MB | `413` |

Ein beim Aussteller widerrufenes Token bleibt hier bis zu seinem `exp` gültig. Kurze Laufzeit für
Access-Tokens wählen; zum sofortigen Sperren dient der Kill-Switch.

## Start

```bash
npm run mcp:http        # = node src/mcp-http.js
```

Ohne vollständige Konfiguration beendet sich der Prozess mit Exit-Code 1 und nennt die fehlenden
Variablen. Vaults und Index-Ablage kommen wie bei den anderen Einstiegen aus `nexus.config.json`
im Datenordner (`NEXUS_DATA_DIR`).

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `NEXUS_MCP_RESOURCE_URL` | ja | – | Öffentliche Adresse des Endpunkts inkl. Pfad, z. B. `https://mcp.example.com/mcp`. Exakt so wird sie im Connector-Dialog eingetragen; zugleich der erwartete `aud`-Wert. Nur `https` (Ausnahme: `localhost`/`127.0.0.1`). |
| `NEXUS_MCP_ISSUER` | ja | – | Autorisierungsserver, z. B. `https://auth.example.com`. Muss zeichengenau dem `iss` im Token entsprechen (auch beim Schrägstrich am Ende). |
| `NEXUS_MCP_JWKS_URI` | ja | – | Adresse der öffentlichen Schlüssel des Issuers, z. B. `https://auth.example.com/jwks.json` (steht als `jwks_uri` in dessen Discovery-Dokument). |
| `NEXUS_MCP_ALLOWED_SUBS` | ja | – | Erlaubte Benutzer als `sub`-Werte, kommagetrennt. Fehlt die Liste, startet der Server nicht. |
| `NEXUS_MCP_ALLOWED_VAULTS` | nein | *(keiner)* | Freigegebene Vault-Namen aus `nexus.config.json`, kommagetrennt. Ohne Angabe ist kein Vault erreichbar. |
| `NEXUS_MCP_LEVELS` | nein | `read` | Freigegebene Stufen, kommagetrennt: `read` (gilt immer), `write`, `admin`. Welche Tools dazugehören, steht unter „Stufen“. Unbekannte Werte verhindern den Start. |
| `NEXUS_MCP_AUDIT_LOG` | bei `write`/`admin` | – | Absoluter Pfad der Audit-Datei (JSON-Zeilen), außerhalb der Vaults. Pflicht, sobald `NEXUS_MCP_LEVELS` eine Schreibstufe enthält; ist die Datei nicht beschreibbar, startet der Server nicht bzw. lehnt Änderungen ab. |
| `NEXUS_MCP_DOWNLOAD_SECRET` | nein | *(aus)* | Schaltet Download-Links ein (Tool `datei_link`, Route `/dl/…`). Zufälliges Geheimnis, mindestens 32 Zeichen, z. B. aus `openssl rand -base64 48`. Wer es kennt, kann Links für jede Datei der freigegebenen Vaults erzeugen. |
| `NEXUS_MCP_DOWNLOAD_TTL_S` | nein | `300` | Gültigkeit eines Download-Links in Sekunden (30 bis 3600). |
| `NEXUS_MCP_DOWNLOAD_MAX_BYTES` | nein | `52428800` | Größte Datei, für die ein Link erzeugt und ausgeliefert wird (1024 bis 1073741824). |
| `NEXUS_MCP_DOWNLOAD_BASE_URL` | nein | Ursprung der Ressourcen-URL | Öffentliche Basis-Adresse der Download-Links, z. B. `https://mcp.example.com`. Ihr Host zählt automatisch zu den erlaubten Hosts. |
| `NEXUS_MCP_ALLOWED_HOSTS` | nein | Host aus der Ressourcen-URL | Erlaubte `Host`-Header, kommagetrennt (mit Port, falls nicht Standard). |
| `NEXUS_MCP_ALLOWED_ORIGINS` | nein | *(nur der eigene)* | Zusätzlich erlaubte `Origin`-Werte, z. B. für ein Prüfwerkzeug im Browser. |
| `NEXUS_MCP_MAX_RESPONSE_BYTES` | nein | `524288` | Größenlimit je Tool-Antwort (1024 bis 16777216). Größere Antworten werden zu einem Tool-Fehler mit Hinweis, wie der Aufruf enger zu fassen ist. Bilder aus `read_bild` zählen mit. |
| `NEXUS_MCP_SCOPES_SUPPORTED` | nein | *(leer)* | Scopes, die der Client bei der Anmeldung anfragen soll (Komma oder Leerzeichen), z. B. `openid offline_access`. Erscheinen als `scopes_supported` in den Metadaten und als `scope="…"` in der 401-Challenge. Leer: beide Angaben fehlen. Reiner Hinweis an den Client – geprüft wird damit nichts. |
| `NEXUS_MCP_REQUIRED_SCOPES` | nein | *(keine)* | Scopes, die im Claim `scp` stehen müssen; sonst `403 insufficient_scope`. Zählen automatisch zu den angebotenen Scopes. |
| `NEXUS_MCP_PORT` | nein | `3100` | Port. |
| `NEXUS_MCP_BIND` | nein | `127.0.0.1` | Bind-Adresse. Im Container `0.0.0.0`. |
| `NEXUS_MCP_ENABLED` | nein | `1` | Kill-Switch: `0` → der Prozess läuft weiter, öffnet keinen Vault und beantwortet alles mit `503`. |
| `NEXUS_DATA_DIR` | nein | App-Ordner | Datenordner mit `nexus.config.json` und dem Suchindex (wie bei den anderen Einstiegen). Muss beschreibbar sein. |

## Aufruf-Log

Eine JSON-Zeile je Anfrage auf **stdout** (Diagnose und Startmeldungen gehen auf stderr):

```json
{"zeit":"2026-01-01T12:00:00.000Z","sub":"<sub>","methode":"tools/call","tool":"read_note","vault":null,"pfad":"Ordner/Notiz.md","ergebnis":"ok","status":200,"ms":4}
```

`ergebnis` ist `ok`, `tool_fehler`, `zu_gross`, `tool_abgelehnt`, `aufruf_fehler`, ein Grund der
Token-Prüfung (`kein_token`, `ERR_JWT_EXPIRED:exp`, `sub_nicht_erlaubt`, …), `host_abgelehnt`,
`origin_abgelehnt` oder `body_zu_gross`; bei Downloads (`tool: download`) außerdem `link_form`,
`link_signatur`, `link_abgelaufen`, `datei_fehlt`. Nicht im Log: Suchbegriffe, Abfragen, Notiztext, Token,
Header. Abrufe der Metadaten werden nicht protokolliert.

## Audit-Log

Sobald `NEXUS_MCP_LEVELS` eine Schreibstufe enthält, ist `NEXUS_MCP_AUDIT_LOG` Pflicht. Jeder Aufruf
eines ändernden Tools schreibt eine JSON-Zeile – auch abgelehnte Aufrufe:

```json
{"zeit":"2026-01-01T12:00:00.000Z","sub":"<sub>","client":"<client-id>","tool":"patch","vault":"<vault-name>","pfad":"Ordner/Notiz.md","ergebnis":"ok","hashVorher":"sha256:…","hash":"sha256:…"}
```

`nach` nennt bei `move` das Ziel und bei `delete` den Pfad im Papierkorb, `fehler` den Grund einer
Ablehnung. Inhalte (Notiztext, Patches) stehen nicht im Log. Download-Links und Abrufe stehen als
`datei_link` und `download` darin.

Die Datei liegt außerhalb der Vaults; ein Pfad in einem Vault verhindert den Start. Ist sie nicht
beschreibbar, startet der Server nicht bzw. lehnt Änderungen ab, bevor etwas geschrieben wird.
Rotation ist Aufgabe des Betriebs (z. B. `logrotate` mit `copytruncate`).

## Download-Links

Ein Tool-Ergebnis ist Text im Kontext des Modells; eine Datei von mehreren MB kommt so nicht beim
Nutzer an. Mit `NEXUS_MCP_DOWNLOAD_SECRET` gibt es das Tool `datei_link { path, vault? }`. Es
liefert `url`, `bytes` und `gueltigBis`; den Link öffnet der Nutzer im Browser.

- Der Link gilt `NEXUS_MCP_DOWNLOAD_TTL_S` Sekunden und nur für diese eine Datei. Innerhalb der
  Laufzeit kann er mehrfach abgerufen werden; widerrufen lässt er sich nur durch ein neues Geheimnis.
- Der Token ist signiert (HMAC-SHA256), nicht verschlüsselt: Vault-Name und Pfad sind darin lesbar.
- Bei jedem Abruf wird neu geprüft: Signatur, Ablauf, Vault freigegeben, Pfad im Vault (auch über
  Symlinks), Größe. Dateien in versteckten Ordnern (`.trash`, `.nexus`, …) werden nie ausgeliefert.
- Ausgeliefert wird immer als Anhang mit `application/octet-stream` – eine HTML-Datei aus dem Vault
  wird unter dieser Adresse nicht ausgeführt.
- Antworten: `200` Datei · `404` Link ungültig oder Datei nicht (mehr) verfügbar · `410` Link abgelaufen.

Wer das Geheimnis kennt, kann Links für jede Datei der freigegebenen Vaults erzeugen: wie ein
Passwort behandeln, nicht ins Repository. Der Link selbst ist bis zum Ablauf ein Inhaberausweis –
zusätzlich kann der Proxy vor `/dl/*` eine Anmeldung verlangen (Beispiel unten).

## Beispiel: Container

Das Image ist dasselbe wie für den UI-Server, nur mit anderem Startbefehl. Für den reinen
Lesezugriff wird der Vault schreibgeschützt eingehängt (`:ro`); der Datenordner braucht
Schreibrechte für den Index. Die auskommentierten Zeilen schalten Schreiben und Download-Links ein.

```yaml
services:
  nexus-mcp:
    image: <nexus-image>
    command: ["node", "src/mcp-http.js"]
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 256m
    environment:
      NEXUS_DATA_DIR: /data
      NEXUS_MCP_BIND: 0.0.0.0
      NEXUS_MCP_RESOURCE_URL: https://mcp.example.com/mcp
      NEXUS_MCP_ISSUER: https://auth.example.com
      NEXUS_MCP_JWKS_URI: https://auth.example.com/jwks.json
      NEXUS_MCP_ALLOWED_SUBS: <sub-des-erlaubten-benutzers>
      NEXUS_MCP_ALLOWED_VAULTS: <vault-name>
      # Schreiben: Vault unten ohne ":ro" einhängen, Audit-Volume dazu
      # TZ: Europe/Berlin
      # NEXUS_MCP_LEVELS: write
      # NEXUS_MCP_AUDIT_LOG: /audit/audit.jsonl
      # Download-Links
      # NEXUS_MCP_DOWNLOAD_SECRET: <zufaelliges-geheimnis-mind-32-zeichen>
    volumes:
      - <pfad-zum-vault>:/vault:ro
      - nexus_mcp_data:/data
      # - nexus_mcp_audit:/audit
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
    networks: [proxy]          # kein veröffentlichter Port – nur der Reverse-Proxy erreicht :3100

volumes:
  nexus_mcp_data:
  # nexus_mcp_audit:
networks:
  proxy:
    external: true
```

`/data/nexus.config.json` nennt den Vault unter seinem Pfad im Container:

```json
{
  "activeVault": "<vault-name>",
  "vaults": [{ "name": "<vault-name>", "path": "/vault" }],
  "ignore": [".obsidian", ".trash", ".nexus"]
}
```

Der Container muss die `NEXUS_MCP_JWKS_URI` erreichen können (ausgehend, HTTPS). Schreibt der
Prozess in den Vault, müssen Benutzer und Gruppe im Container zu den Dateirechten des Vaults passen
(`user:` im Compose), sonst gehören neue Notizen dem falschen Benutzer.

## Beispiel: Reverse-Proxy (Caddy)

Der Proxy terminiert TLS, lässt die Metadaten öffentlich und `/mcp` nur aus den Netzen zu, aus
denen der Connector-Dienst anfragt. Den aktuellen Adressbereich nennt die Anthropic-Dokumentation
(„IP addresses“); `203.0.113.0/24` ist hier ein Platzhalter.

```caddyfile
mcp.example.com {
	handle /.well-known/oauth-protected-resource* {
		reverse_proxy nexus-mcp:3100
	}

	@mcp path /mcp
	handle @mcp {
		@fremd not remote_ip 203.0.113.0/24
		respond @fremd 403
		reverse_proxy nexus-mcp:3100
	}

	# Nur mit Download-Links: der Browser des Nutzers ruft von überall ab.
	# Optional eine Anmeldung davor (hier als Beispiel forward_auth).
	handle /dl/* {
		# forward_auth <auth-dienst>:<port> { uri /api/authz/forward-auth }
		reverse_proxy nexus-mcp:3100
	}

	respond 404
}
```

`/healthz` wird in diesem Beispiel nicht nach außen gereicht (fällt unter `respond 404`); es ist
für den Healthcheck im Container gedacht.

Der Proxy muss den ursprünglichen `Host`-Header durchreichen (Caddy tut das standardmäßig) –
sonst weist die Host-Allowlist jede Anfrage ab. Die Adressfilterung ist nur eine zusätzliche
Schicht: Der Bereich gehört allen Kunden des Dienstes, der Zugang hängt am Token und an der
`sub`-Allowlist.

## Voraussetzungen am Autorisierungsserver

- OAuth-Client für Claude als **Public Client** mit PKCE (S256), Redirect-URI
  `https://claude.ai/api/mcp/auth_callback`.
- Access-Tokens als **JWT** (RS256, `typ: at+jwt`), nicht als opake Tokens.
- `aud` = Ressourcen-URL, wenn der Client `resource=<Ressourcen-URL>` mitschickt (RFC 8707).
- Der `sub`-Wert des Benutzers für `NEXUS_MCP_ALLOWED_SUBS` steht im Access-Token; er ist oft
  eine ID und nicht der Benutzername.

## Connector in Claude anlegen

Einstellungen → Connectors → benutzerdefinierten Connector hinzufügen, URL = `NEXUS_MCP_RESOURCE_URL`.
Als Anmeldung OAuth wählen und, falls der Autorisierungsserver keine dynamische Registrierung
anbietet, die Client-ID des oben angelegten Clients eintragen.

## Prüfen

```bash
# Metadaten (öffentlich)
curl -s https://mcp.example.com/.well-known/oauth-protected-resource/mcp

# Ohne Token: 401 mit WWW-Authenticate
curl -si -X POST https://mcp.example.com/mcp -H 'content-type: application/json' -d '{}' | head -n 5

# Mit Token: Tool-Liste
curl -s -X POST https://mcp.example.com/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Automatische Tests: `node test/mcp-http.test.mjs` (lokal erzeugter Schlüssel, lokale JWKS).

Automatische Tests für Schreiben, Audit-Log und Download-Links: `node test/mcp-http-write.test.mjs`.

## Nicht enthalten

Rate-Limiting und Rotation der Logs sind Aufgabe von Proxy und Betrieb. Scopes aus dem Token
steuern die Stufen nicht – sie stehen in der Server-Konfiguration.
