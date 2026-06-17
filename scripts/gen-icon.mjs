// scripts/gen-icon.mjs — Nexus App-Icon-Ableitung
//
// Quelle der Wahrheit ist seit Session 56 das committete, fertige Multi-Res-Icon
//   build/icon.ico   (16..256 px, je Eintrag PNG; das schlichte schwarze Nexus-Knoten-Icon)
//
// Dieses Script LEITET daraus die anderen beiden Build-Assets ab (es zeichnet NICHTS mehr selbst –
// das frühere bunte Diamant-SVG ist bewusst entfernt, damit `npm run gen:icon` das schlichte Icon
// nicht versehentlich überschreibt):
//   build/icon.png   (größter ICO-Eintrag, 256px)  -> Fenster-/Linux-Icon
//   build/icon.icns  (aus dem 256er)               -> macOS
//
// build/icon.ico selbst bleibt unangetastet. Soll das Icon getauscht werden: einfach die neue .ico
// nach build/icon.ico legen und dieses Script laufen lassen.
//
// Aufruf:  npm run gen:icon      (bzw.  node scripts/gen-icon.mjs)   – nur Dependency: png2icons.

import png2icons from 'png2icons';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dir, '..', 'build');
const ICO = join(BUILD, 'icon.ico');
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Größten PNG-Eintrag aus der .ico ziehen (ICO-Directory: 6-Byte-Header + count×16-Byte-Einträge).
function largestPngFromIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Keine gültige .ico');
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] === 0 ? 256 : buf[o];
    const len = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    if (!buf.subarray(off, off + 8).equals(PNG_SIG)) continue; // nur PNG-Einträge
    if (!best || w > best.w) best = { w, png: buf.subarray(off, off + len) };
  }
  if (!best) throw new Error('Kein PNG-Eintrag in der .ico gefunden');
  return best;
}

const ico = readFileSync(ICO);
const { w, png } = largestPngFromIco(ico);

// PNG (Fenster-/Linux-Icon)
writeFileSync(join(BUILD, 'icon.png'), png);

// ICNS (macOS) – png2icons skaliert die Unterstufen selbst, plattformunabhängig.
const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0);
if (!icns) throw new Error('png2icons.createICNS lieferte kein Ergebnis');
writeFileSync(join(BUILD, 'icon.icns'), icns);

console.error(`[gen-icon] aus build/icon.ico abgeleitet: build/icon.png (${w}px) + build/icon.icns. build/icon.ico unverändert.`);
