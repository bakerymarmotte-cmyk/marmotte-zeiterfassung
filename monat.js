import { db } from "./firebase-config.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const typLabels = {
  krank: "Krank",
  unfall: "Unfall",
  militaer: "Militär",
  schwangerschaft: "Schwangerschaft",
  bezahlter_frei_tag: "Bezahlter Frei Tag",
};

export function initMonatTab(session) {
  const uid = session.uid;
  const profile = session.profile;

  const labelEl = document.getElementById("month-label");
  const sollEl = document.getElementById("month-soll");
  const istEl = document.getElementById("month-ist");
  const diffEl = document.getElementById("month-diff");
  const ferienBezogenEl = document.getElementById("month-ferien");
  const feriensaldoLabel = document.getElementById("feriensaldo-label");
  const feriensaldoValue = document.getElementById("feriensaldo-value");
  const gleitzeitLabel = document.getElementById("gleitzeit-label");
  const gleitzeitValue = document.getElementById("gleitzeit-value");
  const dayListEl = document.getElementById("month-day-list");

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-basiert

  document.getElementById("month-prev").addEventListener("click", () => changeMonth(-1));
  document.getElementById("month-next").addEventListener("click", () => changeMonth(1));

  render();

  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  }

  async function render() {
    labelEl.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString("de-CH", { month: "long", year: "numeric" });
    sollEl.textContent = "…";
    istEl.textContent = "…";
    diffEl.textContent = "…";
    feriensaldoValue.textContent = "…";
    gleitzeitValue.textContent = "…";
    dayListEl.innerHTML = '<div class="hint-text">Lädt …</div>';

    const [generalSnap, feiertageSnap] = await Promise.all([
      getDoc(doc(db, "settings", "general")),
      getDoc(doc(db, "settings", "feiertage")),
    ]);
    const general = generalSnap.exists() ? generalSnap.data() : { wochenstunden100: 42, ferientageProJahr: 25 };
    const feiertage = feiertageSnap.exists() && Array.isArray(feiertageSnap.data().list) ? feiertageSnap.data().list : [];
    const feiertagDates = new Set(feiertage.map((f) => f.date));

    const absenceDates = await loadAbsenceDates(uid);

    // Monatswerte
    const sollMinuten = calculateSollMinutes(viewYear, viewMonth, profile, general, feiertagDates, null, absenceDates);
    const { totalMinutes: istMinuten, perDay } = await calculateIstForMonth(uid, viewYear, viewMonth);
    const diffMinuten = istMinuten - sollMinuten;

    sollEl.textContent = formatMinutes(sollMinuten);
    istEl.textContent = formatMinutes(istMinuten);
    diffEl.textContent = (diffMinuten >= 0 ? "+" : "") + formatMinutes(diffMinuten);
    diffEl.className = "summary-value " + (diffMinuten >= 0 ? "positive" : "negative");

    const ferienDatesThisMonth = new Set(
      [...absenceDates.ferienDates].filter((iso) => iso.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`))
    );
    const ferienBezogenMonat = countFerientage(ferienDatesThisMonth, feiertagDates);
    ferienBezogenEl.textContent = `${ferienBezogenMonat} T`;

    // Feriensaldo
    const heuteStr = new Date().toLocaleDateString("de-CH");
    feriensaldoLabel.textContent = `Feriensaldo (Stand ${heuteStr})`;
    const ferienanspruch = (general.ferientageProJahr || 25) * ((profile.stellenprozent || 100) / 100);
    const ferienBezogenTotal = countFerientage(absenceDates.ferienDates, feiertagDates, toISODate(new Date()));
    const ferienSaldo = ferienanspruch - ferienBezogenTotal;
    feriensaldoValue.textContent = `${ferienSaldo.toFixed(1)} Tage`;

    // Gleitzeitkonto (kumuliert ab Anstellungsdatum)
    if (profile.anstellungsdatum) {
      const startDate = new Date(profile.anstellungsdatum);
      gleitzeitLabel.textContent = `Gleitzeitkonto (ab ${startDate.toLocaleDateString("de-CH")})`;
      const gleitzeitMinuten = await calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate, absenceDates);
      gleitzeitValue.textContent = (gleitzeitMinuten >= 0 ? "+" : "") + formatMinutes(gleitzeitMinuten);
      gleitzeitValue.className = "balance-value " + (gleitzeitMinuten >= 0 ? "positive" : "negative");
    } else {
      gleitzeitValue.textContent = "–";
    }

    renderDayList(viewYear, viewMonth, perDay, absenceDates);
  }

  function renderDayList(year, month, perDay, absenceDates) {
    const monthEnd = new Date(year, month + 1, 0);
    const todayISO = toISODate(new Date());
    const rows = [];
    for (let day = 1; day <= monthEnd.getDate(); day++) {
      const d = new Date(year, month, day);
      const iso = toISODate(d);
      const dayData = perDay[iso];
      const weekdayLabel = d.toLocaleDateString("de-CH", { weekday: "short" });
      const dateLabel = `${weekdayLabel}., ${day}. ${d.toLocaleDateString("de-CH", { month: "long" })}`;
      const isToday = iso === todayISO;

      if (dayData && dayData.shifts.length > 0) {
        const shiftTexts = dayData.shifts.map((s) => {
          const start = formatTime(s.start);
          const end = s.ende ? formatTime(s.ende) : "läuft";
          const pausenText =
            Array.isArray(s.pausen) && s.pausen.length > 0
              ? s.pausen.map((p) => ` (P ${formatTime(p.start)}–${p.ende ? formatTime(p.ende) : "läuft"})`).join("")
              : "";
          return `${start}${pausenText}–${end}`;
        });
        const subLines = `[${profile.abteilung || "–"}] ${shiftTexts.join(" · ")}`;
        rows.push(`
          <div class="day-row has-hours${isToday ? " is-today" : ""}">
            <div>
              <div class="day-date">${dateLabel}</div>
              <div class="day-sub">${subLines}</div>
            </div>
            <div class="day-hours">${formatMinutes(dayData.minutes)}</div>
          </div>`);
      } else {
        const absence = absenceDates.get(iso);
        rows.push(`
          <div class="day-row${isToday ? " is-today" : ""}">
            <div>
              <div class="day-date">${dateLabel}</div>
              <div class="day-sub">${absence ? escapeHtml(absence) : "Frei"}</div>
            </div>
          </div>`);
      }
    }
    dayListEl.innerHTML = rows.join("");
  }
}

// Lädt genehmigte Ferien und eingetragene Abwesenheiten für einen Mitarbeiter
// und gibt eine Map von "YYYY-MM-DD" -> Anzeige-Label zurück.
async function loadAbsenceDates(uid) {
  const map = new Map();
  const ferienDates = new Set();

  const ferienSnap = await getDocs(
    query(collection(db, "ferienantraege"), where("uid", "==", uid), where("status", "==", "genehmigt"))
  );
  ferienSnap.forEach((docSnap) => {
    const r = docSnap.data();
    for (const iso of expandDateRange(r.von, r.bis)) {
      map.set(iso, "Ferien");
      ferienDates.add(iso);
    }
  });

  const abwSnap = await getDocs(query(collection(db, "abwesenheiten"), where("uid", "==", uid)));
  abwSnap.forEach((docSnap) => {
    const r = docSnap.data();
    const label = r.typ === "bezahlter_frei_tag" ? (r.bemerkung || "Bezahlter Frei Tag") : (typLabels[r.typ] || r.typ);
    for (const iso of expandDateRange(r.von, r.bis)) map.set(iso, label);
  });

  map.ferienDates = ferienDates; // kleiner Zusatz, damit wir die Ferientage separat zählen können
  return map;
}

// Zählt nur Wochentage (Mo–Fr), die keine Feiertage sind – das sind die Tage,
// die tatsächlich vom Ferienguthaben abgezogen werden.
function countFerientage(dateSet, feiertagDates, upToDateISO) {
  let count = 0;
  for (const iso of dateSet) {
    if (upToDateISO && iso > upToDateISO) continue;
    const d = new Date(iso);
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (feiertagDates.has(iso)) continue;
    count++;
  }
  return count;
}

function expandDateRange(von, bis) {
  const result = [];
  if (!von || !bis) return result;
  for (let d = new Date(von); toISODate(d) <= bis; d.setDate(d.getDate() + 1)) {
    result.push(toISODate(d));
  }
  return result;
}

// Tagessoll = (Wochenstunden bei 100% × Stellenprozent) ÷ Arbeitstage/Woche
// Monatssoll = Tagessoll × Anzahl Wochentage (Mo–Fr) im Monat, minus Feiertage,
// ab dem späteren von Monatsanfang/Anstellungsdatum, bis capEnd (Standard: Monatsende).
function calculateSollMinutes(year, month, profile, general, feiertagDates, capEnd, absenceDates) {
  const stellenprozent = profile.stellenprozent || 100;
  const arbeitstageProWoche = profile.arbeitstageProWoche || 5;
  const wochenstunden100 = general.wochenstunden100 || 42;

  const tagessollMinuten = ((wochenstunden100 * (stellenprozent / 100)) / arbeitstageProWoche) * 60;

  const monthStart = new Date(year, month, 1);
  const monthEnd = capEnd || new Date(year, month + 1, 0);

  let rangeStart = monthStart;
  if (profile.anstellungsdatum) {
    const startDate = new Date(profile.anstellungsdatum);
    if (startDate > monthEnd) return 0;
    if (startDate > monthStart) rangeStart = startDate;
  }
  if (rangeStart > monthEnd) return 0;

  let sollArbeitstage = 0;
  for (let d = new Date(rangeStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const iso = toISODate(d);
    if (feiertagDates.has(iso)) continue;
    if (absenceDates && absenceDates.has(iso)) continue;
    sollArbeitstage++;
  }

  return sollArbeitstage * tagessollMinuten;
}

async function calculateIstForMonth(uid, year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const todayISO = toISODate(new Date());

  const fetches = [];
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    if (iso > todayISO) break;
    fetches.push(getDoc(doc(db, "timeentries", `${uid}_${iso}`)).then((snap) => ({ iso, snap })));
  }

  const results = await Promise.all(fetches);
  let totalMinutes = 0;
  const perDay = {};

  for (const { iso, snap } of results) {
    if (!snap.exists()) continue;
    const shifts = Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
    if (shifts.length === 0) continue;
    let dayMinutes = 0;
    for (const shift of shifts) {
      const start = new Date(shift.start);
      const end = shift.ende ? new Date(shift.ende) : (iso === todayISO ? new Date() : null);
      if (!end) continue;
      let minutes = (end - start) / 60000;
      if (Array.isArray(shift.pausen)) {
        for (const p of shift.pausen) {
          const pStart = new Date(p.start);
          const pEnd = p.ende ? new Date(p.ende) : new Date();
          minutes -= (pEnd - pStart) / 60000;
        }
      }
      dayMinutes += Math.max(0, minutes);
    }
    perDay[iso] = { shifts, minutes: dayMinutes };
    totalMinutes += dayMinutes;
  }

  return { totalMinutes, perDay };
}

async function calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate, absenceDates) {
  const today = new Date();
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(today.getFullYear(), today.getMonth(), 1);

  let totalDiff = 0;
  while (cursor <= endCursor) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthEnd = new Date(y, m + 1, 0);
    const capEnd = monthEnd < today ? monthEnd : today;

    const soll = calculateSollMinutes(y, m, profile, general, feiertagDates, capEnd, absenceDates);
    const { totalMinutes: ist } = await calculateIstForMonth(uid, y, m);
    totalDiff += (ist - soll);

    cursor = new Date(y, m + 1, 1);
  }
  return totalDiff;
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function formatMinutes(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.round(Math.abs(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
