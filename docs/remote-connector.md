# Nexus als Remote-Connector (nur lesen)

`src/mcp-http.js` stellt die Lese-Tools von Nexus über HTTP bereit, damit Claude (Web, Mobil,
Desktop) einen Vault als **Custom Connector** nutzen kann. Der Einstieg ist optional und
eigenständig: Die Desktop-App und der UI-Server starten ihn nie.

```
Claude ──HTTPS──► Reverse-Proxy ──HTTP──► node src/mcp-http.js ──► Vault (nur lesen)
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
| `GET /.well-known/oauth-protected-resource` und `…/oauth-protected-resource/mcp` | Öffentliche Metadaten (RFC 9728): `resource`, `authorization_servers`, `bearer_methods_supported` |
| `GET /healthz` | `200` mit `{"status":"ok"}` – ohne Token, von der Host-Allowlist ausgenommen, ohne Angaben zu Vaults, Version oder Konfiguration. Bei `NEXUS_MCP_ENABLED=0`: `503`. |
| alles andere | `404` |

**Freigegebene Tools:** `search`, `outline`, `read_note`, `read_bild`, `backlinks`, `list_notes`,
`query`, `dataview`, `lern_status`, `list_vaults`, `list_trash`. Schreib-Tools werden für diesen
Einstieg nicht registriert – sie stehen nicht in `tools/list` und sind nicht aufrufbar.

**Token-Prüfung** (lokal, ohne Rückfrage beim Aussteller): JWT mit `alg` RS256 und `typ` `at+jwt`,
Signatur gegen die JWKS (mit Cache), `iss` zeichengenau, `aud` enthält die Ressourcen-URL, `exp`,
`nbf`. Scopes werden aus dem Claim `scp` (Array) gelesen. Danach muss `sub` in der Allowlist stehen.

| Fall | Antwort |
|---|---|
| Token fehlt oder ist ungültig | `401` mit `WWW-Authenticate: Bearer resource_metadata="…"` |
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
| `NEXUS_MCP_ALLOWED_HOSTS` | nein | Host aus der Ressourcen-URL | Erlaubte `Host`-Header, kommagetrennt (mit Port, falls nicht Standard). |
| `NEXUS_MCP_ALLOWED_ORIGINS` | nein | *(nur der eigene)* | Zusätzlich erlaubte `Origin`-Werte, z. B. für ein Prüfwerkzeug im Browser. |
| `NEXUS_MCP_MAX_RESPONSE_BYTES` | nein | `524288` | Größenlimit je Tool-Antwort (1024 bis 16777216). Größere Antworten werden zu einem Tool-Fehler mit Hinweis, wie der Aufruf enger zu fassen ist. Bilder aus `read_bild` zählen mit. |
| `NEXUS_MCP_REQUIRED_SCOPES` | nein | *(keine)* | Scopes, die im Claim `scp` stehen müssen; sonst `403 insufficient_scope`. |
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
`origin_abgelehnt` oder `body_zu_gross`. Nicht im Log: Suchbegriffe, Abfragen, Notiztext, Token,
Header. Abrufe der Metadaten werden nicht protokolliert.

## Beispiel: Container

Das Image ist dasselbe wie für den UI-Server, nur mit anderem Startbefehl. Der Vault kann für den
Lesezugriff schreibgeschützt eingehängt werden; der Datenordner braucht Schreibrechte für den Index.

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
    volumes:
      - <pfad-zum-vault>:/vault:ro
      - nexus_mcp_data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
    networks: [proxy]          # kein veröffentlichter Port – nur der Reverse-Proxy erreicht :3100

volumes:
  nexus_mcp_data:
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

Der Container muss die `NEXUS_MCP_JWKS_URI` erreichen können (ausgehend, HTTPS).

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

## Nicht enthalten

Schreib-Tools, ein dauerhaftes Audit-Log und Rate-Limiting (Aufgabe des Proxys) gibt es in
diesem Stand nicht.
