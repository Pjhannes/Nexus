// test/bild.test.mjs – Bildmasse aus dem Dateikopf + Themen-Gliederung.
//
// Die Masse braucht read_bild, damit Claude Pixelkoordinaten in die auf 0..1 normierten
// Rechtecke der Bild-Karten umrechnen kann. Getestet wird gegen von Hand gebaute
// Dateikoepfe – so bleibt der Test ohne Binaerdateien im Repo.
// Lauf: node test/bild.test.mjs
import { bildMasse, svgMasse, mimeFuer, istVektor, BILD_ENDUNGEN } from '../src/bildmasse.js';
import { themenFilter, themenJeNotiz, sessionQueue, LERN_START } from '../src/lernen.js';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, detail ? `(${detail})` : ''); fail++; }
}

console.log('\n── A. MIME + Erkennung ──');
ok('png', mimeFuer('a/b/c.png') === 'image/png');
ok('JPG gross geschrieben', mimeFuer('X.JPG') === 'image/jpeg');
ok('jpeg', mimeFuer('x.jpeg') === 'image/jpeg');
ok('svg', mimeFuer('x.svg') === 'image/svg+xml');
ok('unbekannt -> null', mimeFuer('x.md') === null && mimeFuer('x') === null);
ok('istVektor nur bei svg', istVektor('a.svg') && !istVektor('a.png'));
ok('Endungsliste vollstaendig', BILD_ENDUNGEN.includes('webp') && BILD_ENDUNGEN.includes('avif'));

console.log('\n── B. PNG ──');
function png(w, h) {
  const b = Buffer.alloc(24);
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary').copy(b, 0);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
ok('PNG 1600x900', JSON.stringify(bildMasse(png(1600, 900))) === JSON.stringify({ breite: 1600, hoehe: 900, format: 'png' }),
  JSON.stringify(bildMasse(png(1600, 900))));
ok('PNG sehr gross (4K)', bildMasse(png(3840, 2160)).breite === 3840);
ok('PNG 1x1', bildMasse(png(1, 1)).hoehe === 1);
ok('abgeschnittener PNG-Kopf -> null', bildMasse(png(100, 100).subarray(0, 18)) === null);

console.log('\n── C. JPEG ──');
function jpeg(w, h, { marker = 0xc0, mitExif = true } = {}) {
  const teile = [Buffer.from([0xff, 0xd8])];
  if (mitExif) {                              // APP1-Segment davor: muss uebersprungen werden
    const nutz = Buffer.alloc(20); nutz.write('Exif\0\0', 0, 'ascii');
    const kopf = Buffer.alloc(4);
    kopf.writeUInt8(0xff, 0); kopf.writeUInt8(0xe1, 1); kopf.writeUInt16BE(nutz.length + 2, 2);
    teile.push(kopf, nutz);
  }
  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0); sof.writeUInt8(marker, 1);
  sof.writeUInt16BE(9, 2);                    // Segmentlaenge
  sof.writeUInt8(8, 4);                       // Genauigkeit
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  teile.push(sof, Buffer.alloc(8));
  return Buffer.concat(teile);
}
ok('JPEG hinter einem APP1/Exif-Segment', JSON.stringify(bildMasse(jpeg(1920, 1080))) === JSON.stringify({ hoehe: 1080, breite: 1920, format: 'jpeg' }),
  JSON.stringify(bildMasse(jpeg(1920, 1080))));
ok('JPEG ohne Exif', bildMasse(jpeg(800, 600, { mitExif: false })).breite === 800);
ok('progressives JPEG (SOF2)', bildMasse(jpeg(640, 480, { marker: 0xc2 })).breite === 640);
ok('DHT (0xC4) ist KEIN Start-of-Frame', bildMasse(jpeg(640, 480, { marker: 0xc4 })) === null);
ok('kaputtes JPEG -> null', bildMasse(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(40)])) === null);

console.log('\n── D. GIF / BMP / WebP / AVIF ──');
function gif(w, h) {
  const b = Buffer.alloc(16); b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
}
ok('GIF', bildMasse(gif(320, 240)).breite === 320 && bildMasse(gif(320, 240)).hoehe === 240);
function bmp(w, h) {
  const b = Buffer.alloc(30); b.write('BM', 0, 'ascii');
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); return b;
}
ok('BMP', bildMasse(bmp(200, 100)).breite === 200);
ok('BMP mit negativer Hoehe (top-down)', bildMasse(bmp(200, -100)).hoehe === 100);
function webpX(w, h) {
  const b = Buffer.alloc(40); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  const w1 = w - 1, h1 = h - 1;
  b[24] = w1 & 0xff; b[25] = (w1 >> 8) & 0xff; b[26] = (w1 >> 16) & 0xff;
  b[27] = h1 & 0xff; b[28] = (h1 >> 8) & 0xff; b[29] = (h1 >> 16) & 0xff;
  return b;
}
ok('WebP (VP8X)', bildMasse(webpX(1280, 720)).breite === 1280 && bildMasse(webpX(1280, 720)).hoehe === 720,
  JSON.stringify(bildMasse(webpX(1280, 720))));
function webpLossy(w, h) {
  const b = Buffer.alloc(40); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8 ', 12, 'ascii');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); return b;
}
ok('WebP (VP8 verlustbehaftet)', bildMasse(webpLossy(640, 360)).breite === 640);
function avif(w, h) {
  const b = Buffer.alloc(80); b.write('ftyp', 4, 'ascii'); b.write('avif', 8, 'ascii');
  b.write('ispe', 40, 'ascii'); b.writeUInt32BE(w, 48); b.writeUInt32BE(h, 52); return b;
}
ok('AVIF ueber die ispe-Box', bildMasse(avif(1024, 768)).breite === 1024 && bildMasse(avif(1024, 768)).hoehe === 768);
ok('unbekannte Bytes -> null', bildMasse(Buffer.alloc(64)) === null);
ok('leerer Buffer -> null', bildMasse(Buffer.alloc(0)) === null && bildMasse(null) === null);

console.log('\n── E. SVG ──');
ok('viewBox gewinnt (sie beschreibt das Koordinatensystem)', (() => {
  const m = svgMasse('<svg width="100px" height="50px" viewBox="0 0 1600 900"><text/></svg>');
  return m.breite === 1600 && m.hoehe === 900 && m.quelle === 'viewBox';
})());
ok('ohne viewBox: width/height', (() => {
  const m = svgMasse('<svg width="800" height="600"></svg>');
  return m.breite === 800 && m.hoehe === 600 && m.quelle === 'width/height';
})());
ok('width mit px-Einheit', svgMasse('<svg width="640px" height="480px"></svg>').breite === 640);
ok('viewBox mit Kommas', svgMasse('<svg viewBox="0,0,200,100"></svg>').hoehe === 100);
ok('ohne Masse -> null', svgMasse('<svg></svg>') === null);
ok('kein SVG -> null', svgMasse('') === null && svgMasse(null) === null);

console.log('\n── F. Themen: Gliederung und Filter ──');
const sc = { notiz: 'Uni/FAPS.md', karten: [
  { id: 'a', typ: 'janein', frage: 'A', thema: 'Robotik' },
  { id: 'b', typ: 'janein', frage: 'B', thema: 'Robotik' },
  { id: 'c', typ: 'janein', frage: 'C', thema: 'Fügetechnik' },
  { id: 'd', typ: 'janein', frage: 'D' },
] };
const themen = themenJeNotiz(sc);
ok('gruppiert nach Thema', themen.length === 3, JSON.stringify(themen.map(t => t.thema)));
ok('zaehlt je Thema', themen.find(t => t.thema === 'Robotik').karten === 2);
ok('"ohne Thema" steht am Ende', themen[themen.length - 1].thema === '');
ok('alphabetisch davor', themen[0].thema === 'Fügetechnik' && themen[1].thema === 'Robotik',
  JSON.stringify(themen.map(t => t.thema)));

const f = themenFilter(['Uni/FAPS.md::Robotik']);
ok('Filter kennt die Notiz', f.hatNotiz('Uni/FAPS.md') && !f.hatNotiz('Andere.md'));
ok('Filter passt nur aufs gewaehlte Thema', f.passt('Uni/FAPS.md', 'Robotik') && !f.passt('Uni/FAPS.md', 'Fügetechnik'));
ok('Markdown-Dekoration im Thema stoert nicht', themenFilter(['X.md::**Robotik**']).passt('X.md', 'Robotik'));
const fOhne = themenFilter(['Uni/FAPS.md::']);
ok('leeres Thema trifft Karten ohne Thema', fOhne.passt('Uni/FAPS.md', '') && fOhne.passt('Uni/FAPS.md', undefined)
  && !fOhne.passt('Uni/FAPS.md', 'Robotik'));
ok('leere Liste -> kein Filter', themenFilter([]) === null && themenFilter(null) === null);

const q = sessionQueue({ sidecars: [sc], zustaende: new Map(), faecher: [], heute: '2026-08-09',
  uebung: true, filter: { themen: ['Uni/FAPS.md::Robotik'] } });
ok('Queue liefert nur das gewaehlte Thema', q.gesamt === 2 && q.karten.every(e => e.karte.thema === 'Robotik'),
  JSON.stringify(q.karten.map(e => e.karte.id)));
const q2 = sessionQueue({ sidecars: [sc], zustaende: new Map(), faecher: [], heute: '2026-08-09',
  uebung: true, filter: { themen: ['Uni/FAPS.md::Robotik', 'Uni/FAPS.md::'] } });
ok('mehrere Themen kombinierbar', q2.gesamt === 3, String(q2.gesamt));
const q3 = sessionQueue({ sidecars: [sc], zustaende: new Map(), faecher: [], heute: '2026-08-09', uebung: true });
ok('ohne Filter alle Karten', q3.gesamt === 4);

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
