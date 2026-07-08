import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ABTEILUNGEN = ["Bäckerei", "Tearoom&Laden", "Dorfladen"];

const absenceStyles = {
  ferien: { icon: "🌴", color: "#4CAF7D" },
  krank: { icon: "🤒", color: "#E5484D" },
  unfall: { icon: "🚑", color: "#E8792A" },
  militaer: { icon: "🎖️", color: "#8A9A5B" },
  schwangerschaft: { icon: "🤰", color: "#B084D0" },
  bezahlter_frei_tag: { icon: "🎉", color: "#4A9FE0" },
};
const typLabels = {
  krank: "Krank", unfall: "Unfall", militaer: "Militär",
  schwangerschaft: "Schwangerschaft", bezahlter_frei_tag: "Bezahlter Frei Tag",
};

let editingShiftId = null;
let employeesCache = null;

export function initArbeitsplanTab(session) {
  const myAbteilungen = getEmpAbteilungen(session.profile);
  const sichtbareAbteilungen = ABTEILUNGEN.filter((a) => myAbteilungen.includes(a));

  setupWeekTab(session, {
    prevBtnId: "week-prev", nextBtnId: "week-next", labelId: "week-label",
    contentId: "arbeitsplan-content", editable: false,
    abteilungen: sichtbareAbteilungen.length > 0 ? sichtbareAbteilungen : ABTEILUNGEN,
  });
}

export function initPlanungTab(session) {
  setupWeekTab(session, {
    prevBtnId: "woche-prev-admin", nextBtnId: "woche-next-admin", labelId: "woche-label-admin",
    contentId: "planung-content", editable: true, abteilungen: ABTEILUNGEN,
  });
  setupShiftModal(session);
}

function setupWeekTab(session, cfg) {
  let weekStart = getMonday(new Date());

  document.getElementById(cfg.prevBtnId).addEventListener("click", () => { weekStart = addDays(weekStart, -7); render(); });
  document.getElementById(cfg.nextBtnId).addEventListener("click", () => { weekStart = addDays(weekStart, 7); render(); });

  render();
  window.addEventListener("arbeitsplan-refresh", render);

  async function render() {
    const labelEl = document.getElementById(cfg.labelId);
    const contentEl = document.getElementById(cfg.contentId);
    labelEl.textContent = formatWeekLabel(weekStart);
    contentEl.innerHTML = '<div class="hint-text">Lädt…</div>';

    const weekEnd = addDays(weekStart, 6);
    const weekStartISO = toISO(weekStart);
    const weekEndISO = toISO(weekEnd);

    const [employees, shifts, ferien, abwesenheiten] = await Promise.all([
      loadEmployees(),
      loadShifts(weekStartISO, weekEndISO),
      loadFerien(weekStartISO, weekEndISO),
      loadAbwesenheiten(weekStartISO, weekEndISO),
    ]);

    contentEl.innerHTML = "";
    for (const abteilung of cfg.abteilungen) {
      contentEl.appendChild(renderAbteilungBlock(abteilung, weekStart, employees, shifts, ferien, abwesenheiten, cfg.editable));
    }

    if (cfg.editable) {
      wireUpAddButtons(contentEl, session);
      wireUpEditDeleteButtons(contentEl, render);
    }
  }
}

function renderAbteilungBlock(abteilung, weekStart, employees, shifts, ferien, abwesenheiten, editable) {
  const wrap = document.createElement("div");
  wrap.className = "abteilung-block";

  const heading = document.createElement("div");
  heading.className = "abteilung-heading";
  heading.textContent = abteilung.replace("&", " & ");
  wrap.appendChild(heading);

  const todayISO = toISO(new Date());

  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const iso = toISO(d);
    const isToday = iso === todayISO;

    const dayBlock = document.createElement("div");
    dayBlock.className = "arbeitsplan-day";

    const dayHeader = document.createElement("div");
    dayHeader.className = "arbeitsplan-day-header";
    dayHeader.innerHTML = `
      <span class="day-weekday">${d.toLocaleDateString("de-CH", { weekday: "short" })}</span>
      <span class="day-daydate">${d.getDate()}. ${d.toLocaleDateString("de-CH", { month: "short" })}</span>
      ${isToday ? '<span class="today-badge">Heute</span>' : ""}
    `;
    dayBlock.appendChild(dayHeader);

    // Absenzen der Mitarbeiter dieser Abteilung an diesem Tag
    const absencesToday = [];
    for (const emp of employees) {
      if (!getEmpAbteilungen(emp).includes(abteilung)) continue;
      const f = ferien.find((r) => r.uid === emp.uid && iso >= r.von && iso <= r.bis);
      if (f) absencesToday.push({ name: emp.name, type: "ferien", label: "Ferien genehmigt" });
      const a = abwesenheiten.find((r) => r.uid === emp.uid && iso >= r.von && iso <= r.bis);
      if (a) {
        const label = a.typ === "bezahlter_frei_tag" ? (a.bemerkung || "Bezahlter Frei Tag") : (typLabels[a.typ] || a.typ);
        absencesToday.push({ name: emp.name, type: a.typ, label });
      }
    }
    absencesToday.forEach((abs) => {
      const style = absenceStyles[abs.type] || {};
      const card = document.createElement("div");
      card.className = "shift-card absence-card";
      card.style.border = `1px solid ${style.color || "#666"}`;
      card.innerHTML = `
        <div class="shift-card-main">
          <span>${style.icon || ""} <strong>${escapeHtml(abs.name)}</strong></span>
        </div>
        <div class="shift-card-sub" style="color:${style.color || "inherit"};">${escapeHtml(abs.label)}</div>
      `;
      dayBlock.appendChild(card);
    });

    // Geplante Schichten dieser Abteilung an diesem Tag
    const dayShifts = shifts.filter((s) => s.abteilung === abteilung && s.datum === iso);

    if (absencesToday.length === 0 && dayShifts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint-text no-shifts-text";
      empty.textContent = "Keine Schichten";
      dayBlock.appendChild(empty);
    }

    dayShifts.forEach((s) => {
      const card = document.createElement("div");
      card.className = "shift-card";
      card.innerHTML = `
        <div class="shift-card-main">
          <div>
            <strong>${escapeHtml(s.name)}</strong>
            <div class="shift-card-time">${s.von} – ${s.bis}</div>
            ${s.bemerkung ? `<div class="shift-card-sub">${escapeHtml(s.bemerkung)}</div>` : ""}
          </div>
          ${editable ? `
            <div class="shift-card-actions">
              <button class="icon-btn" data-edit="${s.id}" title="Bearbeiten">✏️</button>
              <button class="icon-btn icon-btn-danger" data-delete="${s.id}" title="Löschen">🗑️</button>
            </div>` : ""}
        </div>
      `;
      dayBlock.appendChild(card);
    });

    if (editable) {
      const addBtn = document.createElement("button");
      addBtn.className = "add-shift-btn";
      addBtn.textContent = "+ Schicht hinzufügen";
      addBtn.dataset.datum = iso;
      addBtn.dataset.abteilung = abteilung;
      dayBlock.appendChild(addBtn);
    }

    wrap.appendChild(dayBlock);
  }

  return wrap;
}

function wireUpAddButtons(container, session) {
  container.querySelectorAll(".add-shift-btn").forEach((btn) => {
    btn.addEventListener("click", () => openShiftModal(null, btn.dataset.datum, btn.dataset.abteilung));
  });
}

function wireUpEditDeleteButtons(container, refreshFn) {
  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const snap = await getDoc(doc(db, "arbeitsplan", btn.dataset.edit));
      if (snap.exists()) openShiftModal(btn.dataset.edit, snap.data().datum, snap.data().abteilung, snap.data());
    });
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Diese Schicht wirklich löschen?")) return;
      await deleteDoc(doc(db, "arbeitsplan", btn.dataset.delete));
      refreshFn();
    });
  });
}

async function setupShiftModal(session) {
  const modal = document.getElementById("shift-modal");
  const form = document.getElementById("shift-form");
  const cancelBtn = document.getElementById("shift-cancel-btn");
  const errorEl = document.getElementById("shift-error");

  cancelBtn.addEventListener("click", () => modal.classList.remove("active"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const saveBtn = document.getElementById("shift-save-btn");
    const uid = document.getElementById("shift-mitarbeiter").value;
    const employees = await loadEmployees();
    const empl = employees.find((emp) => emp.uid === uid);

    const data = {
      uid,
      name: empl ? empl.name : "",
      personalnummer: empl ? empl.personalnummer : "",
      abteilung: document.getElementById("shift-abteilung").value,
      datum: form.dataset.datum,
      von: document.getElementById("shift-von").value,
      bis: document.getElementById("shift-bis").value,
      bemerkung: document.getElementById("shift-bemerkung").value.trim(),
    };

    if (!uid || !data.von || !data.bis) {
      errorEl.textContent = "Bitte Mitarbeiter, Von- und Bis-Zeit angeben.";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Speichert …";
    try {
      if (editingShiftId) {
        await updateDoc(doc(db, "arbeitsplan", editingShiftId), data);
      } else {
        await addDoc(collection(db, "arbeitsplan"), { ...data, createdAt: new Date().toISOString() });
      }
      modal.classList.remove("active");
      window.dispatchEvent(new CustomEvent("arbeitsplan-refresh"));
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Speichern";
    }
  });
}

async function openShiftModal(shiftId, datum, abteilung, existingData) {
  editingShiftId = shiftId;
  const modal = document.getElementById("shift-modal");
  const form = document.getElementById("shift-form");
  const title = document.getElementById("shift-modal-title");
  const errorEl = document.getElementById("shift-error");
  const select = document.getElementById("shift-mitarbeiter");

  errorEl.textContent = "";
  form.dataset.datum = datum;
  title.textContent = shiftId ? "Schicht bearbeiten" : "Schicht eintragen";

  const employees = await loadEmployees();
  select.innerHTML = employees
    .map((e) => `<option value="${e.uid}">[${escapeHtml(e.personalnummer || "–")}] ${escapeHtml(e.name)}</option>`)
    .join("");

  document.getElementById("shift-abteilung").value = abteilung;
  if (existingData) {
    select.value = existingData.uid;
    document.getElementById("shift-von").value = existingData.von || "";
    document.getElementById("shift-bis").value = existingData.bis || "";
    document.getElementById("shift-bemerkung").value = existingData.bemerkung || "";
  } else {
    form.reset();
    document.getElementById("shift-abteilung").value = abteilung;
  }

  modal.classList.add("active");
}

async function loadEmployees() {
  if (employeesCache) return employeesCache;
  const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
  employeesCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  return employeesCache;
}

async function loadShifts(startISO, endISO) {
  const snap = await getDocs(
    query(collection(db, "arbeitsplan"), where("datum", ">=", startISO), where("datum", "<=", endISO))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadFerien(startISO, endISO) {
  const snap = await getDocs(query(collection(db, "ferienantraege"), where("status", "==", "genehmigt")));
  return snap.docs.map((d) => d.data()).filter((r) => r.bis >= startISO && r.von <= endISO);
}

async function loadAbwesenheiten(startISO, endISO) {
  const snap = await getDocs(collection(db, "abwesenheiten"));
  return snap.docs.map((d) => d.data()).filter((r) => r.bis >= startISO && r.von <= endISO);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const kw = getISOWeekNumber(weekStart);
  const startStr = weekStart.toLocaleDateString("de-CH", { day: "numeric", month: "short" });
  const endStr = weekEnd.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" });
  return `KW ${kw} · ${startStr} – ${endStr}`;
}

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getEmpAbteilungen(profile) {
  if (Array.isArray(profile.abteilungen)) return profile.abteilungen;
  if (profile.abteilung) return [profile.abteilung];
  return [];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
