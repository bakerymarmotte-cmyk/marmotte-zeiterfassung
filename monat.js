import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

    // Monatswerte
    const sollMinuten = calculateSollMinutes(viewYear, viewMonth, profile, general, feiertagDates);
    const { totalMinutes: istMinuten, perDay } = await calculateIstForMonth(uid, viewYear, viewMonth);
    const diffMinuten = istMinuten - sollMinuten;

    sollEl.textContent = formatMinutes(sollMinuten);
    istEl.textContent = formatMinutes(istMinuten);
    diffEl.textContent = (diffMinuten >= 0 ? "+" : "") + formatMinutes(diffMinuten);
    diffEl.className = "summary-value " + (diffMinuten >= 0 ? "positive" : "negative");
    ferienBezogenEl.textContent = "0 T"; // folgt mit dem Anträge-Bereich

    // Feriensaldo
    const heuteStr = new Date().toLocaleDateString("de-CH");
    feriensaldoLabel.textContent = `Feriensaldo (Stand ${heuteStr})`;
    const ferienanspruch = (general.ferientageProJahr || 25) * ((profile.stellenprozent || 100) / 100);
    const ferienSaldo = ferienanspruch - 0; // bezogene Ferientage folgen mit dem Anträge-Bereich
    feriensaldoValue.textContent = `${ferienSaldo.toFixed(1)} Tage`;

    // Gleitzeitkonto (kumuliert ab Anstellungsdatum)
    if (profile.anstellungsdatum) {
      const startDate = new Date(profile.anstellungsdatum);
      gleitzeitLabel.textContent = `Gleitzeitkonto (ab ${startDate.toLocaleDateString("de-CH")})`;
      const gleitzeitMinuten = await calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate);
      gleitzeitValue.textContent = (gleitzeitMinuten >= 0 ? "+" : "") + formatMinutes(gleitzeitMinuten);
      gleitzeitValue.className = "balance-value " + (gleitzeitMinuten >= 0 ? "positive" : "negative");
    } else {
      gleitzeitValue.textContent = "–";
    }

    renderDayList(viewYear, viewMonth, perDay);
  }

  function renderDayList(year, month, perDay) {
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
        const subLines = dayData.shifts
          .map((s) => `[${profile.abteilung || "–"}] ${formatTime(s.start)}–${s.ende ? formatTime(s.ende) : "läuft"}`)
          .join(" · ");
        rows.push(`
          <div class="day-row has-hours${isToday ? " is-today" : ""}">
            <div>
              <div class="day-date">${dateLabel}</div>
              <div class="day-sub">${subLines}</div>
            </div>
            <div class="day-hours">${formatMinutes(dayData.minutes)}</div>
          </div>`);
      } else {
        rows.push(`
          <div class="day-row${isToday ? " is-today" : ""}">
            <div>
              <div class="day-date">${dateLabel}</div>
              <div class="day-sub">Frei</div>
            </div>
          </div>`);
      }
    }
    dayListEl.innerHTML = rows.join("");
  }
}

// Tagessoll = (Wochenstunden bei 100% × Stellenprozent) ÷ Arbeitstage/Woche
// Monatssoll = Tagessoll × Anzahl Wochentage (Mo–Fr) im Monat, minus Feiertage,
// ab dem späteren von Monatsanfang/Anstellungsdatum, bis capEnd (Standard: Monatsende).
function calculateSollMinutes(year, month, profile, general, feiertagDates, capEnd) {
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
    if (feiertagDates.has(toISODate(d))) continue;
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

async function calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate) {
  const today = new Date();
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(today.getFullYear(), today.getMonth(), 1);

  let totalDiff = 0;
  while (cursor <= endCursor) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthEnd = new Date(y, m + 1, 0);
    const capEnd = monthEnd < today ? monthEnd : today;

    const soll = calculateSollMinutes(y, m, profile, general, feiertagDates, capEnd);
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
