import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initSettingsTab(session) {
  const isAdmin = session.profile.role === "admin";

  loadGrundeinstellungen();
  loadHolidays();

  if (isAdmin) {
    document.getElementById("save-grundeinstellungen-btn").addEventListener("click", saveGrundeinstellungen);
  }
  document.getElementById("add-holiday-btn").addEventListener("click", addHoliday);

  async function loadGrundeinstellungen() {
    const snap = await getDoc(doc(db, "settings", "general"));
    const data = snap.exists() ? snap.data() : { wochenstunden100: 42, ferientageProJahr: 25 };
    document.getElementById("wochenstunden100").value = data.wochenstunden100 ?? 42;
    document.getElementById("ferientage-jahr").value = data.ferientageProJahr ?? 25;
  }

  async function saveGrundeinstellungen() {
    const btn = document.getElementById("save-grundeinstellungen-btn");
    btn.disabled = true;
    btn.textContent = "Speichert …";
    try {
      await setDoc(doc(db, "settings", "general"), {
        wochenstunden100: Number(document.getElementById("wochenstunden100").value),
        ferientageProJahr: Number(document.getElementById("ferientage-jahr").value),
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
    renderHolidays(list);
  }

  function renderHolidays(list) {
    const container = document.getElementById("holiday-list");
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) {
      container.innerHTML = '<div class="hint-text">Keine Feiertage hinterlegt.</div>';
      return;
    }
    container.innerHTML = sorted
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
        renderHolidays(updated);
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
    renderHolidays(updated);
    dateInput.value = "";
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
