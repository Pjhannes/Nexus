// scripts/gen-icon-dev.mjs
// Erzeugt ein optisch abgesetztes Dev-Icon (Hue-Rotation) aus build/icon.png:
//   -> build/icon-dev.png  +  build/icon-dev.ico
// Zweck: "Nexus Dev" (Quellcode-Start via Nexus-Dev.vbs) in der Taskleiste von der
// installierten "Nexus"-App unterscheidbar machen. electron/main.js bevorzugt diese
// Dateien automatisch, wenn NEXUS_DEV=1 (mit Fallback aufs normale Icon).
// Aufruf:  node scripts/gen-icon-dev.mjs   (sharp + png-to-ico sind devDependencies)
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root   = join(dirname(fileURLToPath(import.meta.url)), '..');
const src    = join(root, 'build', 'icon.png');
const outPng = join(root, 'build', 'icon-dev.png');
const outIco = join(root, 'build', 'icon-dev.ico');

// Hue-Rotation faerbt das Logo deutlich um (z. B. Akzent -> Gruen) -> sofort als Dev erkennbar.
const buf = await sharp(src).modulate({ hue: 130, saturation: 1.1 }).png().toBuffer();
writeFileSync(outPng, buf);

const ico = await pngToIco(outPng);
writeFileSync(outIco, ico);

console.log('Dev-Icon erzeugt:\n  ' + outPng + '\n  ' + outIco);
