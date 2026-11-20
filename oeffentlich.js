// =============================================================================
//  Öffentliche Kopien für alle Mitarbeitenden (Datenschutz)
//  - personen/<uid>:            nur Name, Abteilungen, aktiv  (statt des ganzen Profils in «users»)
//  - abwesenheiten_plan/<id>:   Abwesenheiten für den Arbeitsplan; Krank, Unfall und
//                               Schwangerschaft erscheinen dort nur als «Abwesend»
//  «users» und «abwesenheiten» dürfen Mitarbeitende nur noch für sich selbst lesen.
//  Admin und Leitung halten die Kopien aktuell: abgleichen() vergleicht alles und
//  schreibt nur Unterschiede (beim Start und nach jeder Änderung).
// =============================================================================

import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Diese Arten sieht im Arbeitsplan niemand ausser der Person selbst, Admin und Leitung
export const VERBORGEN = ["krank", "unfall", "schwangerschaft"];

function abteilungenVon(u) {
  if (Array.isArray(u.abteilungen)) return u.abteilungen;
  if (u.abteilung) return [u.abteilung];
  return [];
}

export function personDaten(u) {
  return { name: u.name || "", abteilungen: abteilungenVon(u), active: u.active !== false };
}

export function planDaten(a) {
  const verborgen = VERBORGEN.includes(a.typ);
  return {
    uid: a.uid || "",
    name: a.name || "",
    von: a.von || "",
    bis: a.bis || "",
    typ: verborgen ? "abwesend" : (a.typ || ""),
    // Nur beim bezahlten Frei-Tag ist die Bemerkung für alle gedacht
    bemerkung: a.typ === "bezahlter_frei_tag" ? (a.bemerkung || "") : "",
  };
}

// Vergleich unabhängig von der Reihenfolge der Felder (Firestore liefert sie sortiert zurück)
const stabil = (o) => JSON.stringify(o && Object.keys(o).sort().map((k) => [k, o[k]]));
const gleich = (x, y) => stabil(x) === stabil(y);

let laeuft = null;
// Nur für Admin/Leitung aufrufen. Mehrfache Aufrufe kurz hintereinander laufen nacheinander.
export function abgleichen() {
  laeuft = (laeuft || Promise.resolve()).then(lauf).catch((e) => console.error("Abgleich öffentliche Daten:", e));
  return laeuft;
}

async function lauf() {
  const [users, personen, abw, plan] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "personen")),
    getDocs(collection(db, "abwesenheiten")),
    getDocs(collection(db, "abwesenheiten_plan")),
  ]);
  await spiegeln(users.docs, personen.docs, "personen", personDaten);
  await spiegeln(abw.docs, plan.docs, "abwesenheiten_plan", planDaten);
}

async function spiegeln(quelle, ziel, sammlung, umformen) {
  const vorhanden = new Map(ziel.map((d) => [d.id, d.data()]));
  for (const d of quelle) {
    const soll = umformen(d.data());
    if (!gleich(vorhanden.get(d.id), soll)) await setDoc(doc(db, sammlung, d.id), soll);
    vorhanden.delete(d.id);
  }
  // Kopien ohne Original (gelöscht) entfernen
  for (const id of vorhanden.keys()) await deleteDoc(doc(db, sammlung, id));
}
