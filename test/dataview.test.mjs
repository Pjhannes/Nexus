// test/dataview.test.mjs – verifiziert die pure Dataview-Engine (src/dataview.js)
// gegen genau die DQL-Formen, die im realen Vault vorkommen (LIST/TABLE/WITHOUT ID,
// FROM, WHERE mit !contains/AND/!=, SORT, LIMIT, dateformat).
// Lauf: node test/dataview.test.mjs
import { evaluateDataview, parseDataview } from '../src/dataview.js';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label); fail++; }
}

// Page-Builder analog zu tools.js (file.* + fm)
function mkPage(path, mtimeMs, fm = {}, tags = []) {
  const name = path.replace(/\.md$/i, '').split('/').pop();
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  const tagList = tags.map(t => '#' + String(t).replace(/^#/, ''));
  return {
    file: {
      path, name, folder,
      link: { __link: true, path, display: name },
      mtime: mtimeMs, ctime: mtimeMs, size: 100,
      tags: tagList, etags: tagList,
    },
    fm,
  };
}

const T = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h, 0, 0).getTime();

const pages = [
  mkPage('Wissen/00 – Index.md',           T(2026, 1, 1)),
  mkPage('Wissen/Alpha.md',                T(2026, 6, 10)),
  mkPage('Wissen/Beta.md',                 T(2026, 6, 15)),
  mkPage('Wissen/Gamma.md',                T(2026, 5, 1)),
  mkPage('WissenExtra/Falle.md',           T(2026, 6, 30)),   // darf NICHT zu "Wissen" zaehlen
  mkPage('Gesundheit/00 – Übersicht.md',   T(2026, 1, 2)),
  mkPage('Gesundheit/Blutbild.md',         T(2026, 6, 17), { status: 'aktiv' }),
  mkPage('Gesundheit/Labor.md',            T(2026, 4, 20), { status: 'archiv' }),
  mkPage('Gesundheit/Dateien/scan.md',     T(2026, 6, 1)),    // via /Dateien/ ausgeschlossen
  mkPage('_System/00 – Index.md',          T(2026, 1, 3)),
  mkPage('_System/Arbeitsweise.md',        T(2026, 6, 2)),
  mkPage('_System/Logs/run.md',            T(2026, 6, 5)),     // Logs/ ausgeschlossen
  mkPage('_System/Templates/Note.md',      T(2026, 6, 6)),     // Templates/ ausgeschlossen
];

// ── 1) LIST FROM "Wissen" – Ordner-Scoping inkl. Grenzfall WissenExtra ──
{
  const r = evaluateDataview('LIST\nFROM "Wissen"', pages);
  ok('LIST: kind=LIST', r.kind === 'LIST');
  const paths = r.rows.map(x => x.cell.path);
  ok('LIST FROM "Wissen": 4 Treffer (kein WissenExtra)', r.count === 4 && !paths.includes('WissenExtra/Falle.md'));
  ok('LIST: Zellen sind Links', r.rows.every(x => x.cell.type === 'link'));
}

// ── 2) START.md: LIST file.link ... WHERE file.name != ... SORT file.mtime DESC LIMIT 5 ──
{
  const src = 'LIST file.link\nFROM "Wissen"\nWHERE file.name != "00 – Index"\nSORT file.mtime DESC\nLIMIT 5';
  const r = evaluateDataview(src, pages);
  ok('LIST file.link: Index ausgeschlossen', !r.rows.some(x => x.cell.text === '00 – Index'));
  ok('LIST file.link: 3 Treffer', r.count === 3);
  ok('SORT file.mtime DESC: Beta vor Alpha vor Gamma', r.rows.map(x => x.cell.text).join(',') === 'Beta,Alpha,Gamma');
}

// ── 3) Bereichs-Tabelle: TABLE WITHOUT ID file.link AS "Notiz", dateformat(...) AS "Geändert" ──
{
  const src = 'TABLE WITHOUT ID file.link AS "Notiz", dateformat(file.mtime, "yyyy-MM-dd") AS "Geändert"\n'
    + 'FROM "Gesundheit"\nWHERE !contains(file.path, "/Dateien/") AND file.name != "00 – Übersicht"\nSORT file.name ASC';
  const r = evaluateDataview(src, pages);
  ok('TABLE: kind=TABLE', r.kind === 'TABLE');
  ok('TABLE WITHOUT ID: kein "Datei"-Header', r.headers[0] === 'Notiz' && r.headers.length === 2);
  ok('TABLE: AS-Header übernommen', r.headers[1] === 'Geändert');
  ok('TABLE: /Dateien/ + Übersicht ausgeschlossen → 2 Zeilen', r.count === 2);
  ok('TABLE SORT file.name ASC: Blutbild vor Labor', r.rows[0][0].text === 'Blutbild' && r.rows[1][0].text === 'Labor');
  ok('TABLE: erste Zelle ist Link', r.rows[0][0].type === 'link');
  ok('TABLE: dateformat Blutbild = 2026-06-17', r.rows[0][1].text === '2026-06-17');
}

// ── 4) _System Mehrzeilen-WHERE mit mehreren !contains + file.name != ──
{
  const src = 'LIST\nFROM "_System"\nWHERE !contains(file.path, "Logs/")\n  AND !contains(file.path, "Templates/")\n  AND file.name != "00 – Index"\nSORT file.name ASC';
  const r = evaluateDataview(src, pages);
  const paths = r.rows.map(x => x.cell.path);
  ok('_System: nur Arbeitsweise übrig', r.count === 1 && paths[0] === '_System/Arbeitsweise.md');
}

// ── 5) TABLE OHNE "WITHOUT ID" → implizite "Datei"-Spalte ──
{
  const r = evaluateDataview('TABLE file.name AS "Name" FROM "Wissen" WHERE file.name != "00 – Index"', pages);
  ok('TABLE implizite ID: Header[0]=Datei', r.headers[0] === 'Datei' && r.headers[1] === 'Name');
  ok('TABLE implizite ID: 2 Spalten/Zeile', r.rows[0].length === 2);
  ok('TABLE implizite ID: erste Zelle Link', r.rows[0][0].type === 'link');
}

// ── 6) contains auf Frontmatter / SORT ASC default ──
{
  const r = evaluateDataview('LIST FROM "Gesundheit" WHERE status = "aktiv"', pages);
  ok('WHERE status = "aktiv": nur Blutbild', r.count === 1 && r.rows[0].cell.text === 'Blutbild');
}

// ── 7) dateformat-Tokens ──
{
  const p = [mkPage('X/A.md', T(2026, 3, 7, 9))];
  const r = evaluateDataview('TABLE WITHOUT ID dateformat(file.mtime, "dd.MM.yyyy") AS "D" FROM "X"', p);
  ok('dateformat dd.MM.yyyy = 07.03.2026', r.rows[0][0].text === '07.03.2026');
  const r2 = evaluateDataview('TABLE WITHOUT ID dateformat(file.mtime, "yyyy/M/d") AS "D" FROM "X"', p);
  ok('dateformat yyyy/M/d = 2026/3/7', r2.rows[0][0].text === '2026/3/7');
}

// ── 8) leeres Ergebnis + Fehlerfälle ──
{
  const r = evaluateDataview('LIST FROM "GibtEsNicht"', pages);
  ok('Unbekannter Ordner → count 0', r.count === 0 && r.kind === 'LIST');
}
{
  const r = evaluateDataview('GARBAGE blah blah', pages);
  ok('Müll-Query → error', !!r.error);
}
{
  const r = parseDataview('TASK FROM "x"');
  ok('TASK parst, ist als unsupported markiert', r.ast && r.ast.unsupported);
  const run = evaluateDataview('TASK FROM "x"', pages);
  ok('TASK → unsupported im Ergebnis', run.unsupported === true);
}

// ── 9) FROM mit OR (mehrere Ordner) ──
{
  const r = evaluateDataview('LIST FROM "Wissen" or "_System" WHERE file.name != "00 – Index"', pages);
  const folders = new Set(r.rows.map(x => x.cell.path.split('/')[0]));
  ok('FROM "a" or "b": beide Ordner vertreten', folders.has('Wissen') && folders.has('_System'));
}

console.log(`\n  ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
