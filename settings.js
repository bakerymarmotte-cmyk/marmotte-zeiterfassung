import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initSettingsTab(session) {
  const isAdmin = session.profile.role === "admin";
  let holidaysCache = [];

  loadGrundeinstellungen();
  loadHolidays();
  loadFeriensperren();

  if (isAdmin) {
    document.getElementById("save-grundeinstellungen-btn").addEventListener("click", saveGrundeinstellungen);
  }
  document.getElementById("add-holiday-btn").addEventListener("click", addHoliday);
  document.getElementById("add-feriensperre-btn").addEventListener("click", addFeriensperre);
  document.getElementById("holiday-year-select").addEventListener("change", () => {
    renderHolidaysForYear(document.getElementById("holiday-year-select").value);
  });

  async function loadGrundeinstellungen() {
    const snap = await getDoc(doc(db, "settings", "general"));
    const data = snap.exists() ? snap.data() : { wochenstunden100: 42, ferientageProJahr: 25, sperrfristWochen: 0 };
    document.getElementById("wochenstunden100").value = data.wochenstunden100 ?? 42;
    document.getElementById("ferientage-jahr").value = data.ferientageProJahr ?? 25;
    document.getElementById("sperrfrist-wochen").value = data.sperrfristWochen ?? 0;
  }

  async function saveGrundeinstellungen() {
    const btn = document.getElementById("save-grundeinstellungen-btn");
    btn.disabled = true;
    btn.textContent = "Speichert …";
    try {
      await setDoc(doc(db, "settings", "general"), {
        wochenstunden100: Number(document.getElementById("wochenstunden100").value),
        ferientageProJahr: Number(document.getElementById("ferientage-jahr").value),
        sperrfristWochen: Number(document.getElementById("sperrfrist-wochen").value) || 0,
      });
      btn.textContent = "Gespeichert ✓";
      setTimeout(() => (btn.textContent = "Speichern"), 1500);
    } catch (err) {
      console.error(err);
      btn.textContent = "Fehler – erneut versuchen";
    } finally {
      btn.disabled = false;
    }
  }

  async function loadHolidays() {
    const ref = doc(db, "settings", "feiertage");
    const snap = await getDoc(ref);
    let list;
    if (snap.exists() && Array.isArray(snap.data().list)) {
      list = snap.data().list;
    } else {
      // Erstmalige Einrichtung: Standard-Feiertage Kanton Bern generieren (2026–2032)
      list = generateDefaultBernHolidays(2026, 2032);
      await setDoc(ref, { list });
    }
    holidaysCache = list;
    populateHolidayYearSelect(list);
  }

  function populateHolidayYearSelect(list) {
    const select = document.getElementById("holiday-year-select");
    const currentSelection = select.value;
    const years = [...new Set(list.map((h) => h.date.slice(0, 4)))].sort();
    const thisYear = String(new Date().getFullYear());
    if (!years.includes(thisYear)) years.push(thisYear);
    years.sort();

    select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    select.value = years.includes(currentSelection) ? currentSelection : (years.includes(thisYear) ? thisYear : years[0]);
    renderHolidaysForYear(select.value);
  }

  function renderHolidaysForYear(year) {
    const container = document.getElementById("holiday-list");
    const filtered = holidaysCache.filter((h) => h.date.slice(0, 4) === year).sort((a, b) => a.date.localeCompare(b.date));

    if (filtered.length === 0) {
      container.innerHTML = `<div class="hint-text">Keine Feiertage für ${year} hinterlegt.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map(
        (h) => `
      <div class="holiday-row" data-date="${h.date}">
        <span class="date">${formatDate(h.date)}</span>
        <span style="flex:1; margin-left:12px;">${escapeHtml(h.name)}</span>
        <button class="remove-btn" data-remove="${h.date}|${escapeAttr(h.name)}">✕</button>
      </div>`
      )
      .join("");

    container.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [date, name] = btn.dataset.remove.split("|");
        const ref = doc(db, "settings", "feiertage");
        const snap = await getDoc(ref);
        const current = snap.exists() ? snap.data().list : [];
        const updated = current.filter((h) => !(h.date === date && h.name === name));
        await setDoc(ref, { list: updated });
        holidaysCache = updated;
        renderHolidaysForYear(year);
      });
    });
  }

  async function addHoliday() {
    const dateInput = document.getElementById("new-holiday-date");
    const nameInput = document.getElementById("new-holiday-name");
    const date = dateInput.value;
    const name = nameInput.value.trim();
    if (!date || !name) return;

    const ref = doc(db, "settings", "feiertage");
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data().list : [];
    const updated = [...current, { date, name }];
    await setDoc(ref, { list: updated });
    holidaysCache = updated;
    populateHolidayYearSelect(updated);
    document.getElementById("holiday-year-select").value = date.slice(0, 4);
    renderHolidaysForYear(date.slice(0, 4));
    dateInput.value = "";
    nameInput.value = "";
  }

  async function loadFeriensperren() {
    const ref = doc(db, "settings", "feriensperren");
    const snap = await getDoc(ref);
    const list = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
    renderFeriensperren(list);
  }

  function renderFeriensperren(list) {
    const container = document.getElementById("feriensperre-list");
    const sorted = [...list].sort((a, b) => a.von.localeCompare(b.von));
    if (sorted.length === 0) {
      container.innerHTML = '<div class="hint-text">Keine Sperrzeiträume hinterlegt.</div>';
      return;
    }
    container.innerHTML = sorted
      .map(
        (s) => `
      <div class="feriensperre-row" data-von="${s.von}" data-bis="${s.bis}">
        <span class="range">${formatDate(s.von)} – ${formatDate(s.bis)}</span>
        <span class="name">${escapeHtml(s.name || "")}</span>
        <button class="remove-btn" data-remove="${s.von}|${s.bis}|${escapeAttr(s.name || "")}">✕</button>
      </div>`
      )
      .join("");

    container.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [von, bis, name] = btn.dataset.remove.split("|");
        const ref = doc(db, "settings", "feriensperren");
        const snap = await getDoc(ref);
        const current = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
        const updated = current.filter((s) => !(s.von === von && s.bis === bis && (s.name || "") === name));
        await setDoc(ref, { list: updated });
        renderFeriensperren(updated);
      });
    });
  }

  async function addFeriensperre() {
    const vonInput = document.getElementById("new-feriensperre-von");
    const bisInput = document.getElementById("new-feriensperre-bis");
    const nameInput = document.getElementById("new-feriensperre-name");
    const von = vonInput.value;
    const bis = bisInput.value;
    const name = nameInput.value.trim();
    if (!von || !bis) return;
    if (bis < von) return;

    const ref = doc(db, "settings", "feriensperren");
    const snap = await getDoc(ref);
    const current = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
    const updated = [...current, { von, bis, name }];
    await setDoc(ref, { list: updated });
    renderFeriensperren(updated);
    vonInput.value = "";
    bisInput.value = "";
    nameInput.value = "";
  }
}

// Berechnet die Feiertage des Kantons Bern für einen Jahresbereich.
// Bewegliche Feiertage (Karfreitag, Ostermontag, Auffahrt, Pfingstmontag) werden
// über den Ostersonntag berechnet (Gauss'sches Osteralgorithmus).
function generateDefaultBernHolidays(startYear, endYear) {
  const holidays = [];
  for (let year = startYear; year <= endYear; year++) {
    const easter = calculateEasterSunday(year);
    const karfreitag = addDays(easter, -2);
    const ostermontag = addDays(easter, 1);
    const auffahrt = addDays(easter, 39);
    const pfingstmontag = addDays(easter, 50);

    holidays.push(
      { date: `${year}-01-01`, name: "Neujahr" },
      { date: `${year}-01-02`, name: "Berchtoldstag" },
      { date: toISODate(karfreitag), name: "Karfreitag" },
      { date: toISODate(ostermontag), name: "Ostermontag" },
      { date: toISODate(auffahrt), name: "Auffahrt" },
      { date: toISODate(pfingstmontag), name: "Pfingstmontag" },
      { date: `${year}-08-01`, name: "Bundesfeier" },
      { date: `${year}-12-25`, name: "Weihnachten" },
      { date: `${year}-12-26`, name: "Stephanstag" }
    );
  }
  return holidays;
}

function calculateEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}
