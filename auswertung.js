import { db } from "./firebase-config.js";
import { collection, doc, getDoc, getDocs, setDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const typLabels = {
  krank: "Krank", unfall: "Unfall", militaer: "Militär",
  schwangerschaft: "Schwangerschaft", bezahlter_frei_tag: "Bezahlter Frei Tag",
};

const statusStyles = {
  unterwegs: { icon: "🚗", color: "#5AC8E0", label: "Auf dem Weg" },
  arbeitet: { icon: "🟢", color: "#4CAF7D", label: "Eingestempelt" },
  pause: { icon: "☕", color: "#FDD600", label: "Pause" },
  feierabend: { icon: "🍺", color: "#9E9E9E", label: "Feierabend" },
  frei: { icon: "💤", color: "#6b6b6b", label: "Frei" },
  ferien: { icon: "🌴", color: "#4CAF7D", label: "Ferien" },
  krank: { icon: "🤒", color: "#E5484D", label: "Krank" },
  unfall: { icon: "🚑", color: "#E8792A", label: "Unfall" },
  militaer: { icon: "🎖️", color: "#8A9A5B", label: "Militär" },
  schwangerschaft: { icon: "🤰", color: "#B084D0", label: "Schwangerschaft" },
  bezahlter_frei_tag: { icon: "🎉", color: "#4A9FE0", label: "Bezahlter Frei Tag" },
};

export function initAuswertungTab(session) {
  setupSubtabs();
  setupLiveStatus();
  setupUebersicht(session);
  setupJahresuebersicht(session);
  setupDetailModal();
}

function setupSubtabs() {
  const buttons = document.querySelectorAll("#auswertung-subtabs button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll("#sub-auswertung > .abw-subpanel").forEach((p) => p.classList.remove("active"));
      document.getElementById("ausw-sub-" + btn.dataset.auswsub).classList.add("active");
    });
  });
}

function setupLiveStatus() {
  let currentFilter = "alle";
  const selectEl = document.getElementById("live-abteilung-select");

  selectEl.addEventListener("change", () => {
    currentFilter = selectEl.value;
    render();
  });

  render();

  async function render() {
    const listEl = document.getElementById("live-status-list");
    listEl.innerHTML = '<div class="hint-text">Lädt…</div>';

    const todayISO = toISODate(new Date());

    const [employeesSnap, planSnap, ferienSnap, abwSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), orderBy("name"))),
      getDocs(query(collection(db, "arbeitsplan"), where("datum", "==", todayISO))),
      getDocs(query(collection(db, "ferienantraege"), where("status", "==", "genehmigt"))),
      getDocs(collection(db, "abwesenheiten")),
    ]);

    const employees = employeesSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const planToday = planSnap.docs.map((d) => d.data());
    const ferien = ferienSnap.docs.map((d) => d.data()).filter((r) => todayISO >= r.von && todayISO <= r.bis);
    const abwesenheiten = abwSnap.docs.map((d) => d.data()).filter((r) => todayISO >= r.von && todayISO <= r.bis);

    const filtered = employees.filter((e) => {
      if (currentFilter === "alle") return true;
      const abteilungen = getAbteilungen(e);
      return abteilungen.includes(currentFilter);
    });

    // Alle Stempeldaten von heute parallel laden
    const timeentryResults = await Promise.all(
      filtered.map((e) => getDoc(doc(db, "timeentries", `${e.uid}_${todayISO}`)))
    );

    listEl.innerHTML = '<div class="status-grid" id="status-grid-inner"></div>';
    const gridEl = document.getElementById("status-grid-inner");

    filtered.forEach((emp, i) => {
      const shifts = timeentryResults[i].exists() && Array.isArray(timeentryResults[i].data().shifts)
        ? timeentryResults[i].data().shifts : [];
      const planEntry = planToday.find((p) => p.uid === emp.uid);
      const ferienEntry = ferien.find((f) => f.uid === emp.uid);
      const abwEntry = abwesenheiten.find((a) => a.uid === emp.uid);

      const status = determineStatus(shifts, planEntry, ferienEntry, abwEntry);
      const style = statusStyles[status.state];

      const item = document.createElement("div");
      item.className = "status-item";
      item.style.border = `1px solid ${style.color}`;
      item.innerHTML = `
        <div class="name-row">${style.icon} <span>${escapeHtml(emp.name || "")}</span></div>
        <div class="status-label" style="color:${style.color};">${style.label}</div>
        ${status.sub ? `<div class="status-time">${escapeHtml(status.sub)}</div>` : ""}
      `;
      gridEl.appendChild(item);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="hint-text">Keine Mitarbeiter in dieser Abteilung.</div>';
    }
  }
}

function determineStatus(shifts, planEntry, ferienEntry, abwEntry) {
  if (ferienEntry) return { state: "ferien", sub: `bis ${formatDate(ferienEntry.bis)}` };
  if (abwEntry) return { state: abwEntry.typ, sub: `bis ${formatDate(abwEntry.bis)}` };

  const last = shifts.length > 0 ? shifts[shifts.length - 1] : null;

  if (last && !last.ende) {
    const lastPause = last.pausen && last.pausen.length > 0 ? last.pausen[last.pausen.length - 1] : null;
    if (lastPause && !lastPause.ende) {
      return { state: "pause", sub: `seit ${formatTime(lastPause.start)}` };
    }
    return { state: "arbeitet", sub: `seit ${formatTime(last.start)}` };
  }

  if (shifts.length > 0) {
    return { state: "feierabend", sub: `${formatTime(last.start)}–${formatTime(last.ende)}` };
  }

  if (planEntry) {
    return { state: "unterwegs", sub: `ab ${planEntry.von}` };
  }

  return { state: "frei" };
}

function getAbteilungen(profile) {
  if (Array.isArray(profile.abteilungen)) return profile.abteilungen;
  if (profile.abteilung) return [profile.abteilung];
  return [];
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ==========================================================================
// ÜBERSICHT (Zeitraum-Auswertung mit Filtern, Detail-Ansicht, PDF-Export)
// ==========================================================================

let uebersichtEmployeesCache = null;
let uebersichtGeneral = null;
let uebersichtFeiertage = null;
let detailContext = null; // { emp, von, bis }
let editingManualEntry = null; // { iso, idx }

function setupUebersicht(session) {
  const vonEl = document.getElementById("uebersicht-von");
  const bisEl = document.getElementById("uebersicht-bis");
  const abtEl = document.getElementById("uebersicht-abteilung");
  const mitEl = document.getElementById("uebersicht-mitarbeiter");
  const filterBtn = document.getElementById("uebersicht-filter-btn");

  const now = new Date();
  vonEl.value = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  bisEl.value = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  loadEmployeeOptions().then(renderUebersicht);
  filterBtn.addEventListener("click", renderUebersicht);

  async function loadEmployeeOptions() {
    const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
    uebersichtEmployeesCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    mitEl.innerHTML =
      '<option value="alle">Alle</option>' +
      uebersichtEmployeesCache.map((e) => `<option value="${e.uid}">${escapeHtml(e.name)}</option>`).join("");
  }

  async function renderUebersicht() {
    const resultsEl = document.getElementById("uebersicht-results");
    resultsEl.innerHTML = '<div class="hint-text">Lädt…</div>';
    if (!uebersichtEmployeesCache) await loadEmployeeOptions();

    const [generalSnap, feiertageSnap] = await Promise.all([
      getDoc(doc(db, "settings", "general")),
      getDoc(doc(db, "settings", "feiertage")),
    ]);
    uebersichtGeneral = generalSnap.exists() ? generalSnap.data() : { wochenstunden100: 42, ferientageProJahr: 25 };
    const feiertageList = feiertageSnap.exists() && Array.isArray(feiertageSnap.data().list) ? feiertageSnap.data().list : [];
    uebersichtFeiertage = new Set(feiertageList.map((f) => f.date));

    const von = vonEl.value;
    const bis = bisEl.value;
    const abtFilter = abtEl.value;
    const mitFilter = mitEl.value;

    let employees = uebersichtEmployeesCache;
    if (mitFilter !== "alle") {
      employees = employees.filter((e) => e.uid === mitFilter);
    } else if (abtFilter !== "alle") {
      employees = employees.filter((e) => getAbteilungen(e).includes(abtFilter));
    }

    const [ferienSnap, abwSnap] = await Promise.all([
      getDocs(query(collection(db, "ferienantraege"), where("status", "==", "genehmigt"))),
      getDocs(collection(db, "abwesenheiten")),
    ]);
    const allFerien = ferienSnap.docs.map((d) => d.data());
    const allAbw = abwSnap.docs.map((d) => d.data());

    resultsEl.innerHTML = "";
    for (const emp of employees) {
      const report = await computeEmployeeReport(emp, von, bis, allFerien, allAbw);
      resultsEl.appendChild(renderEmployeeCard(emp, report, von, bis));
    }
    if (employees.length === 0) {
      resultsEl.innerHTML = '<div class="hint-text">Keine Mitarbeiter gefunden.</div>';
    }
  }
}

async function computeEmployeeReport(emp, vonISO, bisISO, allFerien, allAbw) {
  const myFerien = allFerien.filter((f) => f.uid === emp.uid);
  const myAbw = allAbw.filter((a) => a.uid === emp.uid);
  const todayISO = toISODate(new Date());
  const start = new Date(vonISO);
  const end = new Date(bisISO);

  const fetchPromises = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    fetchPromises.push(getDoc(doc(db, "timeentries", `${emp.uid}_${iso}`)).then((snap) => ({ iso, snap })));
  }
  const timeResults = await Promise.all(fetchPromises);
  const timeMap = {};
  timeResults.forEach(({ iso, snap }) => {
    timeMap[iso] = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
  });

  const stellenprozent = emp.stellenprozent || 100;
  const arbeitstageProWoche = emp.arbeitstageProWoche || 5;
  const isStundenlohn = emp.anstellungsart === "stundenlohn";
  const tagessollMinuten = ((uebersichtGeneral.wochenstunden100 || 42) * (stellenprozent / 100)) / arbeitstageProWoche * 60;

  const dailyRows = [];
  let istMinuten = 0;
  let sollMinuten = 0;
  let ferienBezogenDays = 0;
  const abwesenheitenCounts = {};

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    const weekday = d.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isFeiertag = uebersichtFeiertage.has(iso);

    const ferienHit = myFerien.find((f) => iso >= f.von && iso <= f.bis);
    const abwHit = myAbw.find((a) => iso >= a.von && iso <= a.bis);
    const shifts = timeMap[iso] || [];

    let dayMinutes = 0;
    shifts.forEach((s) => {
      const st = new Date(s.start);
      const en = s.ende ? new Date(s.ende) : iso === todayISO ? new Date() : null;
      if (!en) return;
      let m = (en - st) / 60000;
      (s.pausen || []).forEach((p) => {
        const ps = new Date(p.start);
        const pe = p.ende ? new Date(p.ende) : new Date();
        m -= (pe - ps) / 60000;
      });
      dayMinutes += Math.max(0, m);
    });
    istMinuten += dayMinutes;

    if (!isStundenlohn && !isWeekend && !isFeiertag && !ferienHit && !abwHit && isEmployedOn(iso, emp)) {
      sollMinuten += tagessollMinuten;
    }
    if (ferienHit && !isWeekend && !isFeiertag) ferienBezogenDays++;
    if (abwHit) abwesenheitenCounts[abwHit.typ] = (abwesenheitenCounts[abwHit.typ] || 0) + 1;

    dailyRows.push({ iso, weekday, shifts, ferien: !!ferienHit, abwesenheit: abwHit || null });
  }

  const diffMinuten = istMinuten - sollMinuten;

  const ferienDatesAll = myFerien.flatMap((f) => expandRange(f.von, f.bis));
  const feriensaldoStart = calculateFeriensaldoBis(emp, uebersichtGeneral, uebersichtFeiertage, ferienDatesAll, vonISO);
  const feriensaldoEnde = feriensaldoStart - ferienBezogenDays;

  return { sollMinuten, istMinuten, diffMinuten, ferienBezogenDays, abwesenheitenCounts, dailyRows, feriensaldoStart, feriensaldoEnde, isStundenlohn };
}

function expandRange(von, bis) {
  const result = [];
  if (!von || !bis) return result;
  for (let d = new Date(von); toISODate(d) <= bis; d.setDate(d.getDate() + 1)) result.push(toISODate(d));
  return result;
}

// Prüft, ob ein Datum (YYYY-MM-DD) innerhalb der Anstellungsdauer liegt
// (Anstellungs-/Kündigungsdatum sind ebenfalls YYYY-MM-DD-Strings, daher reicht String-Vergleich).
function isEmployedOn(iso, emp) {
  if (emp.anstellungsdatum && iso < emp.anstellungsdatum) return false;
  if (emp.kuendigungsdatum && iso > emp.kuendigungsdatum) return false;
  return true;
}

// Zählt Wochentage (Mo–Fr) ohne Feiertage aus einer Liste von ISO-Daten – optional
// nur bis zu einem bestimmten Datum (inklusive).
function countFerientageDays(isoList, feiertagDates, upToISO) {
  let count = 0;
  for (const iso of isoList) {
    if (upToISO && iso > upToISO) continue;
    const d = new Date(iso);
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (feiertagDates.has(iso)) continue;
    count++;
  }
  return count;
}

// Feriensaldo unmittelbar VOR beforeDateISO — gleiche Logik wie im Monat-Tab:
// voller anteiliger Jahresanspruch ab Anstellung (gekürzt durch Kündigungsdatum),
// abzüglich bereits bezogener Tage. Vollständig vergangene Jahre werden komplett
// gerechnet, im Zieljahr nur die Tage vor beforeDateISO.
function calculateFeriensaldoBis(profile, general, feiertagDates, ferienDatesAll, beforeDateISO) {
  const anstellungsdatum = profile.anstellungsdatum ? new Date(profile.anstellungsdatum) : null;
  const kuendigungsdatum = profile.kuendigungsdatum ? new Date(profile.kuendigungsdatum) : null;
  const stellenprozent = profile.stellenprozent || 100;
  const ferientageProJahr = general.ferientageProJahr || 25;
  const beforeDate = new Date(beforeDateISO);

  const startYear = anstellungsdatum ? anstellungsdatum.getFullYear() : beforeDate.getFullYear();
  const endYear = beforeDate.getFullYear();

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

    const ferienDatesInYear = ferienDatesAll.filter((iso) => iso.startsWith(`${y}-`));
    const upTo = y === endYear ? toISODate(new Date(beforeDate.getTime() - 86400000)) : undefined;
    const bezogenJahr = countFerientageDays(ferienDatesInYear, feiertagDates, upTo);

    saldo += anspruchJahr - bezogenJahr;
  }
  return saldo;
}

const abwLabelsShort = { krank: "Krank", unfall: "Unfall", militaer: "Militär", schwangerschaft: "Schwang.", bezahlter_frei_tag: "Frei Tag" };
const abwIconsShort = { krank: "🤒", unfall: "🚑", militaer: "🎖️", schwangerschaft: "🤰", bezahlter_frei_tag: "🎉" };

function renderEmployeeCard(emp, report, von, bis, showPdfButton = true, showDetailButton = true) {
  const card = document.createElement("div");
  card.className = "uebersicht-card";

  const abteilungen = getAbteilungen(emp);
  const pills = abteilungen.map((a) => `<span class="uebersicht-pill">${escapeHtml(a)}</span>`).join(" ");
  const slPill = report.isStundenlohn ? '<span class="uebersicht-pill">SL</span>' : "";

  const abwStatsHtml = Object.entries(report.abwesenheitenCounts)
    .map(([typ, count]) => `<span>${abwIconsShort[typ] || ""} ${abwLabelsShort[typ] || typ} ${count}T</span>`)
    .join("");

  const statsHtml = report.isStundenlohn
    ? `<span>Gearbeitet <strong>${formatMinutes(report.istMinuten)}</strong></span><span>Ferien <strong>${report.ferienBezogenDays}T</strong></span>${abwStatsHtml}`
    : `<span>Soll <strong>${formatMinutes(report.sollMinuten)}</strong></span>
       <span>Ist <strong>${formatMinutes(report.istMinuten)}</strong></span>
       <span class="${report.diffMinuten < 0 ? "negative" : "positive"}">Diff <strong>${report.diffMinuten >= 0 ? "+" : ""}${formatMinutes(report.diffMinuten)}</strong></span>
       <span>Ferien <strong>${report.ferienBezogenDays}T</strong></span>${abwStatsHtml}`;

  card.innerHTML = `
    <div class="uebersicht-top">
      <div class="uebersicht-name-row">[${escapeHtml(emp.personalnummer || "–")}] ${escapeHtml(emp.name || "")} ${slPill} ${pills}</div>
      <div class="uebersicht-actions">
        ${showDetailButton ? '<button class="btn btn-secondary" data-detail>Detail</button>' : ""}
        ${showPdfButton ? '<button class="btn btn-primary" data-pdf>📄 PDF</button>' : ""}
      </div>
    </div>
    <div class="uebersicht-stats">${statsHtml}</div>
  `;

  const detailBtn = card.querySelector("[data-detail]");
  if (detailBtn) detailBtn.addEventListener("click", () => openDetailModal(emp, von, bis));
  const pdfBtn = card.querySelector("[data-pdf]");
  if (pdfBtn) pdfBtn.addEventListener("click", () => generatePdf(emp, report, von, bis));

  return card;
}

// ---- Detail-Modal ----

function setupDetailModal() {
  document.getElementById("detail-add-manual-btn").addEventListener("click", () => openManualForm(detailContext.von, null, null));
  document.getElementById("manual-cancel-btn").addEventListener("click", () => {
    document.getElementById("detail-manual-form").style.display = "none";
  });
  document.getElementById("manual-save-btn").addEventListener("click", saveManualEntry);
  document.getElementById("detail-close-btn").addEventListener("click", () => {
    document.getElementById("detail-modal").classList.remove("active");
  });
}

async function openDetailModal(emp, von, bis) {
  detailContext = { emp, von, bis };
  document.getElementById("detail-modal-title").textContent = emp.name;
  document.getElementById("detail-manual-form").style.display = "none";
  document.getElementById("detail-modal").classList.add("active");
  await renderDetailList();
}

async function renderDetailList() {
  const listEl = document.getElementById("detail-shift-list");
  listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
  const { emp, von, bis } = detailContext;
  const start = new Date(von);
  const end = new Date(bis);

  const fetches = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    fetches.push(getDoc(doc(db, "timeentries", `${emp.uid}_${iso}`)).then((snap) => ({ iso, snap })));
  }
  const results = await Promise.all(fetches);

  listEl.innerHTML = "";
  let any = false;
  results.forEach(({ iso, snap }) => {
    const shifts = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
    shifts.forEach((s, idx) => {
      any = true;
      const range = `${formatTime(s.start)} – ${s.ende ? formatTime(s.ende) : "läuft"}`;
      const pausenText = (s.pausen || []).map((p) => `Pause ${formatTime(p.start)}–${p.ende ? formatTime(p.ende) : "läuft"}`).join(", ");
      const row = document.createElement("div");
      row.className = "detail-shift-row";
      row.innerHTML = `
        <div>
          <div class="date">${formatDateLong(iso)}${s.manuell ? '<span class="manual-badge">MANUELL</span>' : ""}</div>
          <div class="sub">${range}${pausenText ? " · " + pausenText : ""}</div>
        </div>
        <div class="detail-shift-actions">
          <button class="icon-btn" data-edit-iso="${iso}" data-edit-idx="${idx}">✏️</button>
          <button class="icon-btn icon-btn-danger" data-del-iso="${iso}" data-del-idx="${idx}">🗑️</button>
        </div>`;
      listEl.appendChild(row);
    });
  });
  if (!any) listEl.innerHTML = '<div class="hint-text">Keine Schichten in diesem Zeitraum.</div>';

  listEl.querySelectorAll("[data-del-iso]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Diesen Eintrag wirklich löschen?")) return;
      const ref = doc(db, "timeentries", `${detailContext.emp.uid}_${btn.dataset.delIso}`);
      const snap = await getDoc(ref);
      const shifts = snap.data().shifts;
      shifts.splice(Number(btn.dataset.delIdx), 1);
      await setDoc(ref, { ...snap.data(), shifts });
      renderDetailList();
    });
  });
  listEl.querySelectorAll("[data-edit-iso]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ref = doc(db, "timeentries", `${detailContext.emp.uid}_${btn.dataset.editIso}`);
      const snap = await getDoc(ref);
      const shift = snap.data().shifts[Number(btn.dataset.editIdx)];
      openManualForm(btn.dataset.editIso, shift, Number(btn.dataset.editIdx));
    });
  });
}

function openManualForm(iso, existing, idx) {
  editingManualEntry = { iso: existing ? iso : null, idx: existing ? idx : null };
  document.getElementById("manual-error").textContent = "";
  document.getElementById("detail-manual-form").style.display = "block";
  document.getElementById("manual-datum").value = iso || detailContext.von;
  document.getElementById("manual-von").value = existing ? formatTimeHM(existing.start) : "";
  document.getElementById("manual-bis").value = existing && existing.ende ? formatTimeHM(existing.ende) : "";
  const pause = existing && existing.pausen && existing.pausen[0];
  document.getElementById("manual-pause-von").value = pause ? formatTimeHM(pause.start) : "";
  document.getElementById("manual-pause-bis").value = pause && pause.ende ? formatTimeHM(pause.ende) : "";
}

async function saveManualEntry() {
  const errorEl = document.getElementById("manual-error");
  errorEl.textContent = "";
  const datum = document.getElementById("manual-datum").value;
  const von = document.getElementById("manual-von").value;
  const bis = document.getElementById("manual-bis").value;
  const pvon = document.getElementById("manual-pause-von").value;
  const pbis = document.getElementById("manual-pause-bis").value;

  if (!datum || !von || !bis) {
    errorEl.textContent = "Bitte Datum, Von und Bis ausfüllen.";
    return;
  }

  const newShift = {
    start: combineDateTime(datum, von),
    ende: combineDateTime(datum, bis),
    pausen: pvon && pbis ? [{ start: combineDateTime(datum, pvon), ende: combineDateTime(datum, pbis) }] : [],
    manuell: true,
  };

  const ref = doc(db, "timeentries", `${detailContext.emp.uid}_${datum}`);
  const snap = await getDoc(ref);
  let shifts = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];

  if (editingManualEntry && editingManualEntry.idx !== null && editingManualEntry.iso === datum) {
    shifts[editingManualEntry.idx] = newShift;
  } else {
    shifts.push(newShift);
  }

  await setDoc(ref, { uid: detailContext.emp.uid, date: datum, shifts });
  document.getElementById("detail-manual-form").style.display = "none";
  renderDetailList();
}

function combineDateTime(dateISO, timeHM) {
  return new Date(`${dateISO}T${timeHM}:00`).toISOString();
}

function formatTimeHM(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateLong(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---- PDF-Export ----

function generatePdf(emp, report, von, bis) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  const monthYear = new Date(von).toLocaleDateString("de-CH", { month: "long", year: "numeric" });
  const abteilungen = getAbteilungen(emp).join(", ");
  const anstellung = report.isStundenlohn ? "Stundenlöhner" : `Festangestellt (${emp.stellenprozent || 100}%)`;

  pdf.setFontSize(16);
  pdf.text("Marmotte", 14, 18);
  pdf.setFontSize(12);
  pdf.text("Monatsbericht Zeiterfassung", 14, 25);

  pdf.setFontSize(9.5);
  pdf.text(`Name: ${emp.name}   Abteilung: ${abteilungen}   Personalnummer: ${emp.personalnummer || "–"}`, 14, 34);
  pdf.text(`Periode: ${formatDatePdf(von)} – ${formatDatePdf(bis)}   Anstellung: ${anstellung}`, 14, 40);

  if (!report.isStundenlohn) {
    pdf.text(
      `Soll: ${formatMinutes(report.sollMinuten)}   Gearbeitet: ${formatMinutes(report.istMinuten)}   Differenz: ${report.diffMinuten >= 0 ? "+" : ""}${formatMinutes(report.diffMinuten)}`,
      14, 48
    );
  } else {
    pdf.text(`Gearbeitet: ${formatMinutes(report.istMinuten)}`, 14, 48);
  }
  pdf.text(`Feriensaldo Monatsanfang: ${report.feriensaldoStart.toFixed(1)} Tage   Ferien bezogen: ${report.ferienBezogenDays} Tage`, 14, 54);
  pdf.text(`Feriensaldo Monatsende: ${report.feriensaldoEnde.toFixed(1)} Tage`, 14, 60);

  const rows = [];
  report.dailyRows.forEach((day) => {
    const dateLabel = formatDateLong(day.iso);
    if (day.ferien) {
      rows.push([dateLabel, { content: "Ferien bezogen", colSpan: 5 }]);
    } else if (day.abwesenheit) {
      const label = day.abwesenheit.typ === "bezahlter_frei_tag"
        ? (day.abwesenheit.bemerkung || "Bezahlter Frei Tag")
        : (typLabels[day.abwesenheit.typ] || day.abwesenheit.typ);
      rows.push([dateLabel, { content: label, colSpan: 5 }]);
    } else if (day.shifts.length > 0) {
      day.shifts.forEach((s, i) => {
        const pause = s.pausen && s.pausen[0];
        let minutes = s.ende ? (new Date(s.ende) - new Date(s.start)) / 60000 : 0;
        if (pause && pause.ende) minutes -= (new Date(pause.ende) - new Date(pause.start)) / 60000;
        rows.push([
          i === 0 ? dateLabel : "",
          formatTime(s.start),
          pause ? formatTime(pause.start) : "—",
          pause && pause.ende ? formatTime(pause.ende) : "—",
          s.ende ? formatTime(s.ende) : "läuft",
          formatMinutes(Math.max(0, minutes)),
        ]);
      });
    } else {
      rows.push([dateLabel, { content: "Frei", colSpan: 5 }]);
    }
  });

  pdf.autoTable({
    startY: 66,
    head: [["Datum", "Von", "Pause von", "Pause bis", "Bis", "Gearbeitet"]],
    body: rows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 30, 30] },
    margin: { bottom: 20 },
  });

  const finalY = pdf.lastAutoTable.finalY + 10;
  pdf.setFontSize(10);
  pdf.text(`Total gearbeitet: ${formatMinutes(report.istMinuten)}`, 14, finalY);
  pdf.setFontSize(9);
  pdf.text("Arbeitgeber: Unterschrift / Datum", 14, finalY + 20);
  pdf.text("Arbeitnehmer: Unterschrift / Datum", 120, finalY + 20);

  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.text(`Seite ${i} von ${totalPages}`, 14, pdf.internal.pageSize.height - 10);
  }

  const filename = `${(emp.name || "Mitarbeiter").replace(/\s+/g, "_")}_Stundenabrechnung_${monthYear.replace(" ", "_")}.pdf`;
  pdf.save(filename);
}

function formatDatePdf(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// ---- Jahresüberblick-PDF: alle Mitarbeiter auf einem PDF, eine Zeile pro Person ----

const monatsNamenKurz = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const abwKuerzel = { ferien: "Fer", krank: "Kr", unfall: "Unf", militaer: "Mil", schwangerschaft: "Schw", bezahlter_frei_tag: "BFT" };

async function computeYearlyBreakdown(emp, year, allFerien, allAbw) {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  const todayISO = toISODate(new Date());

  const myFerien = allFerien.filter((f) => f.uid === emp.uid);
  const myAbw = allAbw.filter((a) => a.uid === emp.uid);

  const fetchPromises = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    fetchPromises.push(getDoc(doc(db, "timeentries", `${emp.uid}_${iso}`)).then((snap) => ({ iso, snap })));
  }
  const timeResults = await Promise.all(fetchPromises);
  const timeMap = {};
  timeResults.forEach(({ iso, snap }) => {
    timeMap[iso] = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
  });

  const stellenprozent = emp.stellenprozent || 100;
  const arbeitstageProWoche = emp.arbeitstageProWoche || 5;
  const isStundenlohn = emp.anstellungsart === "stundenlohn";
  const tagessollMinuten = ((uebersichtGeneral.wochenstunden100 || 42) * (stellenprozent / 100)) / arbeitstageProWoche * 60;

  const monthlyIst = new Array(12).fill(0);
  let jahresSoll = 0;
  let jahresIst = 0;
  const abwesenheitenCounts = {};

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    const month = d.getMonth();
    const weekday = d.getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isFeiertag = uebersichtFeiertage.has(iso);
    const ferienHit = myFerien.find((f) => iso >= f.von && iso <= f.bis);
    const abwHit = myAbw.find((a) => iso >= a.von && iso <= a.bis);
    const shifts = timeMap[iso] || [];

    let dayMinutes = 0;
    shifts.forEach((s) => {
      const st = new Date(s.start);
      const en = s.ende ? new Date(s.ende) : iso === todayISO ? new Date() : null;
      if (!en) return;
      let m = (en - st) / 60000;
      (s.pausen || []).forEach((p) => {
        const ps = new Date(p.start);
        const pe = p.ende ? new Date(p.ende) : new Date();
        m -= (pe - ps) / 60000;
      });
      dayMinutes += Math.max(0, m);
    });
    monthlyIst[month] += dayMinutes;
    jahresIst += dayMinutes;

    if (!isStundenlohn && !isWeekend && !isFeiertag && !ferienHit && !abwHit && isEmployedOn(iso, emp)) jahresSoll += tagessollMinuten;
    if (abwHit) abwesenheitenCounts[abwHit.typ] = (abwesenheitenCounts[abwHit.typ] || 0) + 1;
    if (ferienHit && !isWeekend && !isFeiertag) abwesenheitenCounts.ferien = (abwesenheitenCounts.ferien || 0) + 1;
  }

  return { monthlyIst, jahresSoll, jahresIst, gleitzeit: jahresIst - jahresSoll, abwesenheitenCounts, isStundenlohn };
}

async function generateJahresPdf({ employees, year, allFerien, allAbw }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape" });

  pdf.setFontSize(16);
  pdf.text("Marmotte", 14, 15);
  pdf.setFontSize(12);
  pdf.text(`Jahresüberblick ${year}`, 14, 22);

  const head = [["Nr.", "Name", ...monatsNamenKurz, "Soll", "Ist", "Gleitzeit", "Abwesenheiten"]];
  const body = [];

  for (const emp of employees) {
    const bd = await computeYearlyBreakdown(emp, year, allFerien, allAbw);
    const abwText = Object.entries(bd.abwesenheitenCounts)
      .map(([typ, count]) => `${abwKuerzel[typ] || typ} ${count}`)
      .join("  ");

    body.push([
      emp.personalnummer || "–",
      emp.name || "",
      ...bd.monthlyIst.map((m) => formatHoursShort(m)),
      bd.isStundenlohn ? "–" : formatHoursShort(bd.jahresSoll),
      formatHoursShort(bd.jahresIst),
      bd.isStundenlohn ? "–" : (bd.gleitzeit >= 0 ? "+" : "") + formatHoursShort(bd.gleitzeit),
      abwText || "–",
    ]);
  }

  pdf.autoTable({
    startY: 28,
    head,
    body,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 30, 30] },
    margin: { bottom: 16 },
  });

  const totalPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.text(`Seite ${i} von ${totalPages}`, 14, pdf.internal.pageSize.height - 8);
  }

  pdf.save(`Marmotte_Jahresüberblick_${year}.pdf`);
}

function formatHoursShort(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.round(Math.abs(totalMinutes));
  return `${sign}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

function formatMinutes(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.round(Math.abs(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

// ---- Jahresübersicht (nutzt dieselbe Berechnungs-/Karten-/PDF-Logik wie die Übersicht) ----

let jahrEmployeesCache = null;
let jahrCurrentContext = null; // { employees, year, allFerien, allAbw }

function setupJahresuebersicht(session) {
  const yearEl = document.getElementById("jahr-select");
  const abtEl = document.getElementById("jahr-abteilung");
  const mitEl = document.getElementById("jahr-mitarbeiter");
  const filterBtn = document.getElementById("jahr-filter-btn");
  const pdfBtn = document.getElementById("jahr-pdf-btn");

  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 3; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearEl.appendChild(opt);
  }

  loadEmployeeOptions().then(renderJahr);
  filterBtn.addEventListener("click", renderJahr);
  pdfBtn.addEventListener("click", () => {
    if (!jahrCurrentContext) return;
    generateJahresPdf(jahrCurrentContext);
  });

  async function loadEmployeeOptions() {
    const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
    jahrEmployeesCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    mitEl.innerHTML =
      '<option value="alle">Alle</option>' +
      jahrEmployeesCache.map((e) => `<option value="${e.uid}">${escapeHtml(e.name)}</option>`).join("");
  }

  async function renderJahr() {
    const resultsEl = document.getElementById("jahr-results");
    resultsEl.innerHTML = '<div class="hint-text">Lädt…</div>';
    if (!jahrEmployeesCache) await loadEmployeeOptions();

    const [generalSnap, feiertageSnap] = await Promise.all([
      getDoc(doc(db, "settings", "general")),
      getDoc(doc(db, "settings", "feiertage")),
    ]);
    uebersichtGeneral = generalSnap.exists() ? generalSnap.data() : { wochenstunden100: 42, ferientageProJahr: 25 };
    const feiertageList = feiertageSnap.exists() && Array.isArray(feiertageSnap.data().list) ? feiertageSnap.data().list : [];
    uebersichtFeiertage = new Set(feiertageList.map((f) => f.date));

    const year = Number(yearEl.value) || currentYear;
    const von = `${year}-01-01`;
    const bis = `${year}-12-31`;

    const abtFilter = abtEl.value;
    const mitFilter = mitEl.value;

    let employees = jahrEmployeesCache;
    if (mitFilter !== "alle") {
      employees = employees.filter((e) => e.uid === mitFilter);
    } else if (abtFilter !== "alle") {
      employees = employees.filter((e) => getAbteilungen(e).includes(abtFilter));
    }

    const [ferienSnap, abwSnap] = await Promise.all([
      getDocs(query(collection(db, "ferienantraege"), where("status", "==", "genehmigt"))),
      getDocs(collection(db, "abwesenheiten")),
    ]);
    const allFerien = ferienSnap.docs.map((d) => d.data());
    const allAbw = abwSnap.docs.map((d) => d.data());
    jahrCurrentContext = { employees, year, allFerien, allAbw };

    resultsEl.innerHTML = "";
    for (const emp of employees) {
      const report = await computeEmployeeReport(emp, von, bis, allFerien, allAbw);
      resultsEl.appendChild(renderEmployeeCard(emp, report, von, bis, false, false));
    }
    if (employees.length === 0) {
      resultsEl.innerHTML = '<div class="hint-text">Keine Mitarbeiter gefunden.</div>';
    }
  }
}
