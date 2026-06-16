// scripts/afterPack.cjs – Haerten der gepackten App ueber Electron-Fuses.
//
// Fuses sind beim Verpacken in die Electron-Binary eingebrannte Schalter, die zur
// Laufzeit NICHT mehr aenderbar sind. Sie erschweren Manipulation/Debugging deutlich:
//   - RunAsNode AN (true)        -> MUSS an bleiben: der MCP-Server (Claude Desktop)
//                                   wird ueber ELECTRON_RUN_AS_NODE als reiner Node-Prozess
//                                   gestartet. Nur so funktioniert die stdio-JSON-RPC-
//                                   Verbindung (ein gepacktes GUI-Electron hat auf Windows
//                                   keine brauchbaren stdin/stdout-Pipes im Hauptprozess).
//   - NODE_OPTIONS-Env aus       -> kein Einschleusen von Startflags ueber die Umgebung
//   - Node-CLI-Inspect aus       -> kein --inspect-Debugger gegen die laufende App
//   - CookieEncryption an        -> lokal gespeicherte Cookies verschluesselt
//   - OnlyLoadAppFromAsar an     -> es wird AUSSCHLIESSLICH aus app.asar geladen; eine
//                                   danebengelegte, modifizierte Datei wird ignoriert
//
// Bewusst NICHT gesetzt: EnableEmbeddedAsarIntegrityValidation. Diese kryptografische
// asar-Pruefung verlangt einen eingebetteten Integritaets-Hash + sinnvollerweise eine
// Code-Signatur; ohne Signatur wuerde sie den Start brechen. Wird zusammen mit den
// (spaeter nachruestbaren) Code-Signing-Zertifikaten aktiviert.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productName = packager.appInfo.productFilename; // "Nexus"

  let electronBinary;
  if (electronPlatformName === 'darwin') {
    electronBinary = path.join(appOutDir, `${productName}.app`); // flipFuses handhabt das .app-Bundle
  } else if (electronPlatformName === 'win32') {
    electronBinary = path.join(appOutDir, `${productName}.exe`);
  } else {
    electronBinary = path.join(appOutDir, productName);
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    // Auf macOS die Ad-hoc-Signatur nach dem Flippen neu setzen (sonst „beschaedigt").
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: true,   // noetig fuer den MCP-Server (ELECTRON_RUN_AS_NODE)
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log(`[afterPack] Electron-Fuses gesetzt (${electronPlatformName}): ${electronBinary}`);
};
