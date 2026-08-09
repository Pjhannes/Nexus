// src/bildmasse.js – Bildmasse und MIME-Typ aus dem Dateikopf lesen.
//
// Warum von Hand statt per Bibliothek: Nexus haelt die Abhaengigkeiten bewusst klein
// (CLAUDE.md Regel 6) und meidet native Module. Fuer "wie breit und hoch ist das Bild?"
// reichen die ersten Bytes – jedes Format schreibt das in seinen Kopf.
//
// Gebraucht wird es fuer read_bild: Claude sieht die Grafik und braucht die Pixelmasse,
// um daraus die auf 0..1 normierten Rechtecke der Bild-Karten zu rechnen.
//
// Pur: nimmt einen Buffer, macht keinen Datei- oder Netzzugriff -> direkt testbar.

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
};

export const BILD_ENDUNGEN = Object.keys(MIME);

export function mimeFuer(pfad) {
  const m = /\.([a-z0-9]+)$/i.exec(String(pfad || ''));
  return m ? (MIME[m[1].toLowerCase()] || null) : null;
}

/** SVG ist Text, kein Pixelbild – wird von read_bild als Quelltext gereicht. */
export function istVektor(pfad) {
  return /\.svg$/i.test(String(pfad || ''));
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b, i) => (b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0)) | 0;
const tag = (b, i, s) => {
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

/**
 * Masse eines Pixelbildes ermitteln.
 * @returns {{breite:number, hoehe:number, format:string} | null} null = Format unbekannt
 *          oder Kopf unvollstaendig (dann lieber ehrlich nichts sagen als raten).
 */
export function bildMasse(buf) {
  if (!buf || buf.length < 16) return null;

  // ── PNG: 8 Byte Signatur, dann IHDR mit Breite/Hoehe als 32 Bit big-endian
  if (tag(buf, 0, '\x89PNG\r\n\x1a\n') && buf.length >= 24) {
    return { breite: u32be(buf, 16), hoehe: u32be(buf, 20), format: 'png' };
  }

  // ── GIF: Logical Screen Descriptor direkt hinter der Signatur, little-endian
  if ((tag(buf, 0, 'GIF87a') || tag(buf, 0, 'GIF89a')) && buf.length >= 10) {
    return { breite: u16le(buf, 6), hoehe: u16le(buf, 8), format: 'gif' };
  }

  // ── BMP: DIB-Header ab Byte 14; Hoehe darf negativ sein (Zeilen von oben nach unten)
  if (tag(buf, 0, 'BM') && buf.length >= 26) {
    return { breite: Math.abs(u32le(buf, 18)), hoehe: Math.abs(u32le(buf, 22)), format: 'bmp' };
  }

  // ── WebP: RIFF-Container, drei Varianten
  if (tag(buf, 0, 'RIFF') && tag(buf, 8, 'WEBP') && buf.length >= 30) {
    if (tag(buf, 12, 'VP8X')) {           // erweitert: Leinwandgroesse minus 1, 24 Bit
      return { breite: u24le(buf, 24) + 1, hoehe: u24le(buf, 27) + 1, format: 'webp' };
    }
    if (tag(buf, 12, 'VP8L')) {           // verlustfrei: 14 Bit Breite, 14 Bit Hoehe, minus 1
      const bits = u32le(buf, 21) >>> 0;
      return { breite: (bits & 0x3fff) + 1, hoehe: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
    }
    if (tag(buf, 12, 'VP8 ')) {           // verlustbehaftet: hinter dem Sync-Code 9D 01 2A
      if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
        return { breite: u16le(buf, 26) & 0x3fff, hoehe: u16le(buf, 28) & 0x3fff, format: 'webp' };
      }
    }
    return null;
  }

  // ── JPEG: Segmente durchlaufen, bis ein Start-of-Frame kommt
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }        // Fuellbytes ueberspringen
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      // Marker ohne Nutzlast
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const laenge = u16be(buf, i + 2);
      if (laenge < 2) return null;
      // SOF0..SOF15 – ausgenommen DHT (C4), JPG (C8) und DAC (CC)
      const istSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (istSof) {
        if (i + 9 > buf.length) return null;
        return { hoehe: u16be(buf, i + 5), breite: u16be(buf, i + 7), format: 'jpeg' };
      }
      i += 2 + laenge;
    }
    return null;
  }

  // ── AVIF/HEIF: ISO-BMFF. Die Masse stecken in einer 'ispe'-Box im Meta-Bereich.
  if (buf.length >= 12 && tag(buf, 4, 'ftyp')) {
    const grenze = Math.min(buf.length - 12, 65536);
    for (let i = 12; i < grenze; i++) {
      if (tag(buf, i, 'ispe')) {
        // 4 Byte Version/Flags, dann Breite und Hoehe als 32 Bit big-endian
        return { breite: u32be(buf, i + 8), hoehe: u32be(buf, i + 12), format: 'avif' };
      }
    }
    return null;
  }

  return null;
}

/**
 * Masse aus SVG-Quelltext. Bevorzugt die viewBox: sie beschreibt das Koordinatensystem,
 * auf das sich alles im Bild bezieht – genau das, was fuer normierte Rechtecke zaehlt.
 */
export function svgMasse(quelltext) {
  const s = String(quelltext || '').slice(0, 8000);
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)/.exec(s);
  if (vb) {
    const breite = parseFloat(vb[3]), hoehe = parseFloat(vb[4]);
    if (breite > 0 && hoehe > 0) return { breite, hoehe, format: 'svg', quelle: 'viewBox' };
  }
  const zahl = (name) => {
    const m = new RegExp(name + '\\s*=\\s*["\']\\s*([\\d.]+)\\s*(px)?\\s*["\']', 'i').exec(s);
    return m ? parseFloat(m[1]) : null;
  };
  const breite = zahl('width'), hoehe = zahl('height');
  if (breite > 0 && hoehe > 0) return { breite, hoehe, format: 'svg', quelle: 'width/height' };
  return null;
}
