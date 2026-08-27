// lernen-kern.js — gemeinsame, DOM-freie Auswertungs-Logik des Lernmodus (R26).
//
// Wird von BEIDEN Oberflaechen als klassisches <script src> geladen, die Funktionen
// landen also global: public/index.html (Desktop-App) und public/lernen.html (Handy).
// test/karten.test.mjs liest die Datei und importiert sie als Modul – deshalb hier
// AUSSCHLIESSLICH pure functions: kein DOM-Zugriff, keine Seiteneffekte, keine Globals
// ausser den Funktionen selbst. Wer hier etwas aendert, aendert Desktop UND Handy.
// Regionen sind Rechtecke, auf die Bildgroesse normiert (0..1): x/y = linke obere Ecke,
// w/h = Anteil der Breite bzw. Hoehe. Jede Achse fuer sich normiert -> kein Seitenverhaeltnis
// noetig. Kreise {x,y,r} aus der ersten Fassung (x/y = MITTELPUNKT) bleiben lesbar.
function lnRegionRect(r){
  if(!r||typeof r.x!=='number'||typeof r.y!=='number')return null;
  if(typeof r.w==='number'&&typeof r.h==='number')return {x:r.x,y:r.y,w:r.w,h:r.h};
  if(typeof r.r==='number')return {x:r.x-r.r,y:r.y-r.r,w:r.r*2,h:r.r*2};
  return null;
}
// Editor und Player benutzen exakt dieselbe Trefferpruefung – was aufgezogen wurde, gilt.
// Bei Ueberlappung gewinnt das KLEINERE Rechteck (sonst waere ein grosses nie verlassbar).
function lnTrefferRegion(px,py,regionen){
  let best=null,bestF=Infinity;
  for(const r of (regionen||[])){
    const b=lnRegionRect(r);if(!b)continue;
    if(px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h){
      const f=b.w*b.h;
      if(f<bestF){best=r;bestF=f;}
    }
  }
  return best;
}
// Getippte Begriffe grosszuegig vergleichen: Gross/Kleinschreibung, Bindestriche und
// Satzzeichen sollen nicht ueber richtig/falsch entscheiden.
function lnTippNorm(s){
  return String(s==null?'':s).normalize('NFC').toLowerCase()
    .replace(/[\s\-_/.,;:!?()\[\]"'`]+/g,' ').trim();
}
function lnTippWertung(eingaben,regionen){
  const falsch=[];
  (regionen||[]).forEach((r,i)=>{
    const soll=lnTippNorm(r&&r.label);
    if(!soll||lnTippNorm((eingaben||[])[i])!==soll)falsch.push(r&&r.label);
  });
  return {korrekt:falsch.length===0,falsch};
}
// Multiple Choice: Mengenvergleich. Zu wenig, zu viel oder nichts ausgewaehlt = falsch.
function lnMcWertung(gewaehlt,korrekt){
  const g=[...new Set(gewaehlt||[])].sort((a,b)=>a-b);
  const k=[...new Set(korrekt||[])].sort((a,b)=>a-b);
  if(!g.length||g.length!==k.length)return false;
  return g.every((v,i)=>v===k[i]);
}
// zuordnung: {Region-Label -> vom Nutzer zugeordnetes Label}. Nicht zugeordnet = falsch.
function lnBildWertung(zuordnung,regionen){
  const falsch=[];
  for(const r of (regionen||[])){
    if((zuordnung||{})[r.label]!==r.label)falsch.push(r.label);
  }
  return {korrekt:falsch.length===0,falsch};
}
