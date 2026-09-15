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
// Gruppen (R26f): Regionen mit gleichem getrimmtem "gruppe"-Wert sind untereinander
// vertauschbar – bei einer Stichpunktliste auf der Folie soll man die Begriffe lernen,
// nicht ihre Reihenfolge. Ohne gruppe (oder leer) bleibt der Kasten fest wie bisher.
function lnGruppeVon(r){
  const g=r&&r.gruppe;
  return (typeof g==='string'&&g.trim())?g.trim():null;
}
// Gemeinsamer Abgleich fuer Zuordnen und Tippen. istFn(i) = normierter Ist-Wert des
// Kastens i, sollFn(r) = normierter Soll-Wert der Region (null/leer = nie richtig).
// Regel je Gruppe: jeder Soll-Begriff passt in jeden Kasten der Gruppe, aber nur EINMAL.
// Erst exakte Treffer verbuchen, dann die uebrigen Kaesten gegen die noch freien
// Soll-Begriffe – so bleibt die Rueckmeldung stabil und ein doppelt getippter Begriff
// zaehlt nur einmal. Tausch ueber Gruppengrenzen oder mit festen Kaesten bleibt falsch.
// Liefert richtig[] je Region-Index.
function lnGruppenAbgleich(regionen,istFn,sollFn){
  const rs=regionen||[];
  const richtig=rs.map(()=>false);
  const gruppen=new Map();
  rs.forEach((r,i)=>{
    const g=lnGruppeVon(r);
    if(g){if(!gruppen.has(g))gruppen.set(g,[]);gruppen.get(g).push(i);return;}
    const soll=sollFn(r);
    richtig[i]=!!soll&&istFn(i)===soll;
  });
  for(const idx of gruppen.values()){
    const frei=new Map();             // Soll-Begriff -> wie oft noch vergebbar
    for(const i of idx){const s=sollFn(rs[i]);if(s)frei.set(s,(frei.get(s)||0)+1);}
    const offen=[];
    for(const i of idx){
      const s=sollFn(rs[i]);
      if(s&&istFn(i)===s&&frei.get(s)>0){richtig[i]=true;frei.set(s,frei.get(s)-1);}
      else offen.push(i);
    }
    for(const i of offen){
      const ist=istFn(i);
      if(ist&&frei.get(ist)>0){richtig[i]=true;frei.set(ist,frei.get(ist)-1);}
    }
  }
  return richtig;
}
// Anzeige-Hilfe fuer beide Player: je Gruppe ein Symbol in der Reihenfolge des ersten
// Auftretens, damit mehrere Gruppen auf einer Karte nicht nur ueber Farbe unterscheidbar
// sind. Liefert Map Gruppenname -> Symbol (leer, wenn die Karte keine Gruppen hat).
function lnGruppenSymbole(regionen){
  const symbole=['\u25C6','\u25CF','\u25B2','\u25A0','\u2605','\u2B22'];
  const m=new Map();
  for(const r of (regionen||[])){
    const g=lnGruppeVon(r);
    if(g&&!m.has(g))m.set(g,symbole[m.size%symbole.length]);
  }
  return m;
}
// eingaben: getippte Begriffe je Region-Index. Vergleich ueber lnTippNorm; leer = falsch.
function lnTippWertung(eingaben,regionen){
  const rs=regionen||[],e=eingaben||[];
  const richtig=lnGruppenAbgleich(rs,i=>lnTippNorm(e[i]),r=>lnTippNorm(r&&r.label));
  const falsch=[];
  rs.forEach((r,i)=>{if(!richtig[i])falsch.push(r&&r.label);});
  return {korrekt:falsch.length===0,falsch,richtig};
}
// Multiple Choice: Mengenvergleich. Zu wenig, zu viel oder nichts ausgewaehlt = falsch.
function lnMcWertung(gewaehlt,korrekt){
  const g=[...new Set(gewaehlt||[])].sort((a,b)=>a-b);
  const k=[...new Set(korrekt||[])].sort((a,b)=>a-b);
  if(!g.length||g.length!==k.length)return false;
  return g.every((v,i)=>v===k[i]);
}
// zuordnung: {Region-Label -> vom Nutzer zugeordnetes Label}. Nicht zugeordnet = falsch.
// richtig[i] gilt je Region-Index – der Player faerbt die Kaesten NUR daraus.
function lnBildWertung(zuordnung,regionen){
  const rs=regionen||[],zu=zuordnung||{};
  const richtig=lnGruppenAbgleich(rs,i=>zu[rs[i].label],r=>r.label);
  const falsch=[];
  rs.forEach((r,i)=>{if(!richtig[i])falsch.push(r.label);});
  return {korrekt:falsch.length===0,falsch,richtig};
}
