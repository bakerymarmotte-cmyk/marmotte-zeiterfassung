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
  const summaryGridEl = document.getElementById("month-summary-grid");
  const dayListEl = document.getElementById("month-day-list");

  const isStundenlohn = profile.anstellungsart === "stundenlohn";

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
    summaryGridEl.innerHTML = '<div class="hint-text">Lädt …</div>';
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

    const ferienDatesThisMonth = new Set(
      [...absenceDates.ferienDates].filter((iso) => iso.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`))
    );
    const ferienBezogenMonat = countFerientage(ferienDatesThisMonth, feiertagDates);

    // Feriensaldo (Stand: 1. des angezeigten Monats) — jahresweise berechnet,
    // inkl. Kürzung durch Anstellungs-/Kündigungsdatum und Übertrag aus Vorjahren
    const stichtag = new Date(viewYear, viewMonth, 1);
    const stichtagStr = stichtag.toLocaleDateString("de-CH");
    const ferienSaldo = calculateFeriensaldo(profile, general, feiertagDates, absenceDates, stichtag);

    // Gleitzeitkonto (kumuliert ab Anstellungsdatum bis 1. des angezeigten Monats)
    let gleitzeitMinuten = null;
    if (!isStundenlohn && profile.anstellungsdatum) {
      const startDate = new Date(profile.anstellungsdatum);
      gleitzeitMinuten = await calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate, absenceDates, stichtag);
    }

    renderSummaryGrid({
      sollMinuten,
      istMinuten,
      diffMinuten,
      ferienBezogenMonat,
      ferienSaldo,
      gleitzeitMinuten,
      stichtagStr,
    });

    renderDayList(viewYear, viewMonth, perDay, absenceDates);
  }

  function renderSummaryGrid({ sollMinuten, istMinuten, diffMinuten, ferienBezogenMonat, ferienSaldo, gleitzeitMinuten, stichtagStr }) {
    const diffClass = diffMinuten >= 0 ? "positive" : "negative";
    const gleitzeitClass = gleitzeitMinuten >= 0 ? "positive" : "negative";

    const gearbeitetCard = `
      <div class="summary-card${isStundenlohn ? " full-width" : ""}">
        <div class="summary-label">Gearbeitet</div>
        <div class="summary-value">${formatMinutes(istMinuten)}</div>
      </div>`;

    const feriensaldoCard = `
      <div class="summary-card">
        <div class="summary-label">Feriensaldo<span class="stand-line">(Stand ${stichtagStr})</span></div>
        <div class="summary-value">${ferienSaldo.toFixed(1)} Tage</div>
      </div>`;

    const ferienBezogenCard = `
      <div class="summary-card">
        <div class="summary-label">Ferientage bezogen</div>
        <div class="summary-value">${ferienBezogenMonat} T</div>
      </div>`;

    if (isStundenlohn) {
      summaryGridEl.innerHTML = gearbeitetCard + feriensaldoCard + ferienBezogenCard;
      return;
    }

    const sollCard = `
      <div class="summary-card">
        <div class="summary-label">Soll</div>
        <div class="summary-value">${formatMinutes(sollMinuten)}</div>
      </div>`;

    const diffCard = `
      <div class="summary-card">
        <div class="summary-label">Differenz</div>
        <div class="summary-value ${diffClass}">${(diffMinuten >= 0 ? "+" : "") + formatMinutes(diffMinuten)}</div>
      </div>`;

    const gleitzeitCard = `
      <div class="summary-card">
        <div class="summary-label">Gleitzeitkonto<span class="stand-line">(Stand ${stichtagStr})</span></div>
        <div class="summary-value ${gleitzeitMinuten === null ? "" : gleitzeitClass}">${gleitzeitMinuten === null ? "–" : (gleitzeitMinuten >= 0 ? "+" : "") + formatMinutes(gleitzeitMinuten)}</div>
      </div>`;

    summaryGridEl.innerHTML = sollCard + gearbeitetCard + diffCard + gleitzeitCard + feriensaldoCard + ferienBezogenCard;
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
        const shiftLines = dayData.shifts.map((s, i) => {
          const start = formatTime(s.start);
          const end = s.ende ? formatTime(s.ende) : "läuft";
          const pausenText =
            Array.isArray(s.pausen) && s.pausen.length > 0
              ? s.pausen.map((p) => ` (P ${formatTime(p.start)}–${p.ende ? formatTime(p.ende) : "läuft"})`).join("")
              : "";
          return `Schicht ${i + 1}: ${start}${pausenText}–${end}`;
        });
        const subLines = shiftLines.join("<br>");
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
        let subContent = "Frei";
        let subStyle = "";
        let rowStyle = "";
        if (absence) {
          const style = absenceStyles[absence.type];
          subContent = `${style ? style.icon + " " : ""}${escapeHtml(absence.label)}`;
          if (style) {
            subStyle = ` style="color:${style.color};"`;
            rowStyle = ` style="border:1px solid ${style.color}; border-radius: var(--radius-md); padding: 12px 10px; margin-bottom: 6px; border-bottom-width: 1px;"`;
          }
        }
        rows.push(`
          <div class="day-row${isToday ? " is-today" : ""}"${rowStyle}>
            <div>
              <div class="day-date">${dateLabel}</div>
              <div class="day-sub"${subStyle}>${subContent}</div>
            </div>
          </div>`);
      }
    }
    dayListEl.innerHTML = rows.join("");
  }
}

// Lädt genehmigte Ferien und eingetragene Abwesenheiten für einen Mitarbeiter
// und gibt eine Map von "YYYY-MM-DD" -> Anzeige-Label zurück.
const absenceStyles = {
  ferien: { icon: "🌴", color: "#4CAF7D" },
  krank: { icon: "🤒", color: "#E5484D" },
  unfall: { icon: "🚑", color: "#E8792A" },
  militaer: { icon: "🎖️", color: "#8A9A5B" },
  schwangerschaft: { icon: "🤰", color: "#B084D0" },
  bezahlter_frei_tag: { icon: "🎉", color: "#4A9FE0" },
};

async function loadAbsenceDates(uid) {
  const map = new Map();
  const ferienDates = new Set();

  const ferienSnap = await getDocs(
    query(collection(db, "ferienantraege"), where("uid", "==", uid), where("status", "==", "genehmigt"))
  );
  ferienSnap.forEach((docSnap) => {
    const r = docSnap.data();
    for (const iso of expandDateRange(r.von, r.bis)) {
      map.set(iso, { type: "ferien", label: "Ferien" });
      ferienDates.add(iso);
    }
  });

  const abwSnap = await getDocs(query(collection(db, "abwesenheiten"), where("uid", "==", uid)));
  abwSnap.forEach((docSnap) => {
    const r = docSnap.data();
    const label = r.typ === "bezahlter_frei_tag" ? (r.bemerkung || "Bezahlter Frei Tag") : (typLabels[r.typ] || r.typ);
    for (const iso of expandDateRange(r.von, r.bis)) map.set(iso, { type: r.typ, label });
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
  let rangeEnd = capEnd || new Date(year, month + 1, 0);

  let rangeStart = monthStart;
  if (profile.anstellungsdatum) {
    const startDate = new Date(profile.anstellungsdatum);
    if (startDate > rangeEnd) return 0;
    if (startDate > monthStart) rangeStart = startDate;
  }
  if (profile.kuendigungsdatum) {
    const endDate = new Date(profile.kuendigungsdatum);
    if (endDate < monthStart) return 0;
    if (endDate < rangeEnd) rangeEnd = endDate;
  }
  if (rangeStart > rangeEnd) return 0;

  let sollArbeitstage = 0;
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const iso = toISODate(d);
    if (feiertagDates.has(iso)) continue;
    if (absenceDates && absenceDates.has(iso)) continue;
    sollArbeitstage++;
  }

  return sollArbeitstage * tagessollMinuten;
}

// Feriensaldo = Summe über alle Jahre seit Anstellungsbeginn bis zum Stichtag-Jahr von
// (anteiliger Jahresanspruch − in diesem Jahr bezogene Ferientage). Der anteilige
// Jahresanspruch steht sofort ab Anstellungsdatum für das ganze (Rest-)Jahr zur
// Verfügung (kein monatsweises Anwachsen) und wird durch das Kündigungsdatum gekürzt,
// falls die Anstellung in diesem Jahr endet. Nicht bezogene Tage aus Vorjahren fliessen
// so automatisch als Übertrag ins Folgejahr mit ein.
function calculateFeriensaldo(profile, general, feiertagDates, absenceDates, stichtag) {
  const anstellungsdatum = profile.anstellungsdatum ? new Date(profile.anstellungsdatum) : null;
  const kuendigungsdatum = profile.kuendigungsdatum ? new Date(profile.kuendigungsdatum) : null;
  const stellenprozent = profile.stellenprozent || 100;
  const ferientageProJahr = general.ferientageProJahr || 25;

  const startYear = anstellungsdatum ? anstellungsdatum.getFullYear() : stichtag.getFullYear();
  const endYear = stichtag.getFullYear();

  let saldo = 0;
  for (let y = startYear; y <= endYear; y++) {
    const yearStart = new Date(y, 0, 1);
    const yearEnd = new Date(y, 11, 31);

    let rangeStart = yearStart;
    if (anstellungsdatum && anstellungsdatum > rangeStart) rangeStart = anstellungsdatum;
    let rangeEnd = yearEnd;
    if (kuendigungsdatum && kuendigungsdatum < rangeEnd) rangeEnd = kuendigungsdatum;

    if (rangeStart > rangeEnd) continue;

    const totalDaysInYear = Math.round((yearEnd - yearStart) / 86400000) + 1;
    const employedDays = Math.round((rangeEnd - rangeStart) / 86400000) + 1;
    const anspruchJahr = ferientageProJahr * (stellenprozent / 100) * (employedDays / totalDaysInYear);

    const ferienDatesInYear = new Set(
      [...absenceDates.ferienDates].filter((iso) => iso.startsWith(`${y}-`))
    );
    const bezogenJahr = countFerientage(ferienDatesInYear, feiertagDates);

    saldo += anspruchJahr - bezogenJahr;
  }

  return saldo;
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

async function calculateGleitzeitkonto(uid, profile, general, feiertagDates, startDate, absenceDates, stichtag) {
  const today = new Date();
  const cutoff = stichtag < today ? stichtag : today;
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  let totalDiff = 0;
  while (cursor < cutoff) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthEnd = new Date(y, m + 1, 0);
    const capEnd = monthEnd < cutoff ? monthEnd : cutoff;

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
