// src/norm.js – gemeinsame Text-Normalisierung fuer die Grounding-Pruefung.
//
// Ausgelagert aus tools.js (R24), damit auch src/lernen.js (R26, Karteikarten)
// sie nutzen kann, ohne einen Zirkelimport tools.js <-> lernen.js zu erzeugen.
// tools.js re-exportiert vortragNorm unveraendert weiter – bestehende Importe
// (test/vortrag.test.mjs) bleiben gueltig.
//
// Sie muss ROH-Markdown und gerenderten Sichttext (DOM textContent) auf dieselbe
// Form bringen, damit ein Anker/Quellenzitat, das beim Schreiben validiert wurde,
// auch im Player gefunden wird (vtNorm in public/index.html – MUSS identisch
// bleiben, Paritaets-Test in test/vortrag.test.mjs).
// Inline-Marker (*_~`=) -> '' (Rendern entfernt sie ersatzlos, auch mitten im Wort);
// Struktur-Marker (# > |) -> ' ' (Ueberschriften-/Zitat-/Tabellenzeichen trennen Woerter).
// NFC vorweg: sonst lehnt die Validierung visuell identische Eingaben in NFD ab
// (z. B. von macOS kopierte Umlaute: 'ä' als 'a'+Kombinationszeichen).
export function vortragNorm(t) {
  return (t || '')
    .normalize('NFC')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')                            // Embeds weg
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                       // Bilder weg
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2') // [[Ziel|Alias]] -> Alias
    .replace(/\[\[([^\]#|]+)(?:#[^\]|]*)?\]\]/g, '$1')           // [[Ziel]] -> Ziel
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                     // [Text](url) -> Text
    .replace(/[*_~`=]/g, '')
    .replace(/[#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

// Frontmatter fuer Grounding-Pruefungen ausblenden: die Leseansicht rendert es als
// Chip, ein Zitat daraus waere serverseitig "gueltig", aber im Player/Editor nie
// auffindbar. Der Inhalts-Hash laeuft weiter ueber den vollen Text.
export function ohneFrontmatter(s) {
  return (s || '').replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '');
}

// BOM strippen: fetch().text() im Browser entfernt die UTF-8-BOM per Spec – ein
// Hash ueber den BOM-behafteten String waere client-seitig NIE reproduzierbar
// (Sidecar stuende dauerhaft auf "veraltet").
export function ohneBom(s) {
  return (s || '').replace(/^﻿/, '');
}
