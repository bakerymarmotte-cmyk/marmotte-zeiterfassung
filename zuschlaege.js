// =============================================================================
//  Nacht- und Zeitzuschlag (Bäckerei)
//  - Gilt für alle Mitarbeitenden mit der eingestellten Abteilung (Standard «Bäckerei»).
//  - Nachtzuschlag: gearbeitete Zeit im Nachtfenster (Standard 22:00–03:00) → Lohnzuschlag in %.
//    Die App zeigt die Nachtstunden; ausbezahlt wird über den Lohn.
//  - Zeitzuschlag: gearbeitete Zeit im Zeitfenster (Standard 22:00–05:00) → Zeitgutschrift in %,
//    die zur gearbeiteten Zeit dazukommt (Differenz und Gleitzeitkonto).
//  - Arbeit im Nachtfenster zählt für beide Zuschläge. Pausen zählen nicht.
//  - Einstellungen in settings/general → «zuschlaege» (Admin → Einstellungen).
//  Diese Berechnung gibt es gleich auch in M.A.R.M.O.T. (werkzeuge/stundenblatt.js).
// =============================================================================

export const ZUSCHLAG_STANDARD = {
  aktiv: true,
  abteilung: "Bäckerei",
  nachtVon: "22:00",
  nachtBis: "03:00",
  nachtProzent: 25,
  zeitVon: "22:00",
  zeitBis: "05:00",
  zeitProzent: 10,
};

export function zuschlagEinst(general) {
  return { ...ZUSCHLAG_STANDARD, ...(general?.zuschlaege || {}) };
}

export function hatZuschlag(profile, einst) {
  if (!einst.aktiv) return false;
  const abt = Array.isArray(profile?.abteilungen) ? profile.abteilungen : (profile?.abteilung ? [profile.abteilung] : []);
  return abt.includes(einst.abteilung);
}

const minuten = (hm) => { const [h, m] = String(hm || "0:0").split(":").map(Number); return h * 60 + m; };

// Fensterstücke [von, bis) in ms, die das Intervall [a, b) berühren können (über Mitternacht möglich)
function fenster(a, b, vonHM, bisHM) {
  const von = minuten(vonHM), bis = minuten(bisHM);
  const stuecke = [];
  const tag = new Date(a); tag.setHours(0, 0, 0, 0); tag.setDate(tag.getDate() - 1);
  for (; tag.getTime() <= b; tag.setDate(tag.getDate() + 1)) {
    const start = new Date(tag); start.setMinutes(von);
    const ende = new Date(tag);
    if (bis <= von) ende.setDate(ende.getDate() + 1);
    ende.setMinutes(bis);
    stuecke.push([start.getTime(), ende.getTime()]);
  }
  return stuecke;
}

function ueberlappung(a, b, stuecke) {
  let ms = 0;
  for (const [s, e] of stuecke) ms += Math.max(0, Math.min(b, e) - Math.max(a, s));
  return ms;
}

// Minuten im Fenster: Schichtzeit minus Pausen. jetzt = Ende für laufende Schichten/Pausen (oder null = nicht zählen)
function imFenster(shifts, vonHM, bisHM, jetzt) {
  let ms = 0;
  for (const s of shifts || []) {
    const a = new Date(s.start).getTime();
    const b = s.ende ? new Date(s.ende).getTime() : jetzt;
    if (!b || b <= a) continue;
    const st = fenster(a, b, vonHM, bisHM);
    ms += ueberlappung(a, b, st);
    for (const p of s.pausen || []) {
      const pa = new Date(p.start).getTime();
      const pb = p.ende ? new Date(p.ende).getTime() : (jetzt || b);
      if (pb > pa) ms -= ueberlappung(Math.max(pa, a), Math.min(pb, b), st);
    }
  }
  return Math.max(0, ms / 60000);
}

// Ergebnis für die Schichten eines Tages: { nacht, zeit, gutschrift } in Minuten
export function zuschlaegeTag(shifts, einst, jetzt = null) {
  const nacht = imFenster(shifts, einst.nachtVon, einst.nachtBis, jetzt);
  const zeit = imFenster(shifts, einst.zeitVon, einst.zeitBis, jetzt);
  return { nacht, zeit, gutschrift: zeit * (Number(einst.zeitProzent) || 0) / 100 };
}
