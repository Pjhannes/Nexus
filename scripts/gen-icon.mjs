// scripts/gen-icon.mjs — Nexus App-Icon-Generator (einmaliges Build-Script)
//
// Erzeugt aus EINER SVG-Definition:
//   build/icon.png  (256x256, transparenter Hintergrund, dunkles Diamant-Theme)
//   build/icon.ico  (multi-size: 16/24/32/48/64/128/256)
//
// Kein Fremd-Tool noetig – nur die devDependencies `sharp` (SVG->PNG-Raster)
// und `png-to-ico` (PNG-Bundle -> .ico).
//
// Aufruf:  npm run gen:icon      (bzw.  node scripts/gen-icon.mjs)
//
// Design (leichte Abwandlung des bisherigen Icons): das vertraute
// Nexus-Diamant-Motiv (◆ verschachtelte Rauten, Cyan/Violett) bekommt einen
// dezenten Glow (weiche Aura um die Cyan-Elemente) und einen feinen Ring
// rundherum. Dunkles, zur UI passendes Theme (#07090f).

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = join(__dir, '..', 'build');

// ── Akzentfarben (zur UI passend) ─────────────────────────────────────────────
const CYAN   = '#22d3ee';
const CYAN_L = '#67e8f9';
const VIOLET = '#8b8cf0';

// ── SVG-Quelle (512px Arbeitsflaeche, wird heruntergerechnet) ─────────────────
// cx/cy = Mittelpunkt; r = halbe Diagonale der jeweiligen Raute.
function diamond(cx, cy, r) {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10141f"/>
      <stop offset="0.55" stop-color="#0a0d15"/>
      <stop offset="1" stop-color="#06080d"/>
    </linearGradient>
    <radialGradient id="aura" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${CYAN}" stop-opacity="0.20"/>
      <stop offset="0.55" stop-color="${VIOLET}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#06080d" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>

  <!-- Hintergrund: abgerundetes Quadrat -->
  <rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="url(#bg)"/>
  <!-- innere Aura hinter den Rauten -->
  <rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="url(#aura)"/>

  <!-- feiner Ring rundherum (neu) -->
  <circle cx="256" cy="256" r="196" fill="none" stroke="${CYAN}" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="256" cy="256" r="178" fill="none" stroke="${VIOLET}" stroke-opacity="0.10" stroke-width="1.5"/>

  <!-- weicher Glow-Layer (unter den scharfen Rauten) -->
  <g filter="url(#softglow)" opacity="0.55">
    <polygon points="${diamond(256,256,168)}" fill="none" stroke="${CYAN}" stroke-width="6"/>
    <rect x="206" y="206" width="100" height="100" rx="8" transform="rotate(45 256 256)" fill="${CYAN}"/>
  </g>

  <!-- scharfe Rauten mit Glow-Filter -->
  <g filter="url(#glow)" stroke-linejoin="round">
    <polygon points="${diamond(256,256,168)}" fill="none" stroke="${CYAN_L}" stroke-width="9"/>
    <polygon points="${diamond(256,256,120)}" fill="none" stroke="${VIOLET}" stroke-width="8"/>
    <rect x="214" y="214" width="84" height="84" rx="8" transform="rotate(45 256 256)" fill="${CYAN}"/>
  </g>
</svg>`;

// ── Rasterung ─────────────────────────────────────────────────────────────────
const svgBuf = Buffer.from(SVG);

// Haupt-PNG 256x256 (transparenter Rahmen ausserhalb des Rechtecks bleibt erhalten,
// da das Rechteck die volle Flaeche fuellt -> effektiv deckend, aber Format mit Alpha).
await sharp(svgBuf, { density: 384 })
  .resize(256, 256)
  .png()
  .toFile(join(BUILD, 'icon.png'));

// ICO: mehrere Groessen aus demselben SVG rendern und buendeln.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = [];
for (const s of sizes) {
  pngBuffers.push(
    await sharp(svgBuf, { density: 384 }).resize(s, s).png().toBuffer()
  );
}
const ico = await pngToIco(pngBuffers);
writeFileSync(join(BUILD, 'icon.ico'), ico);

console.error(`[gen-icon] build/icon.png (256) + build/icon.ico (${sizes.join('/')}) geschrieben.`);
