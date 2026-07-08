import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initStempelTab(session) {
  const uid = session.uid;
  const abteilung = session.profile.abteilung || "–";

  const dotEl = document.getElementById("status-dot");
  const labelEl = document.getElementById("status-label");
  const abteilungEl = document.getElementById("status-abteilung");
  const kommenRow = document.getElementById("status-kommen-row");
  const kommenEl = document.getElementById("status-kommen");
  const pauseRow = document.getElementById("status-pause-row");
  const pauseSinceEl = document.getElementById("status-pause-since");
  const actionsEl = document.getElementById("stempel-actions");
  const shiftList = document.getElementById("today-shift-list");

  abteilungEl.textContent = abteilung;

  let currentShifts = [];

  startClock();
  loadToday();

  async function loadToday() {
    try {
      const snap = await getDoc(doc(db, "timeentries", entryId(uid)));
      currentShifts = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
      render();
    } catch (err) {
      console.error("Fehler beim Laden der Stempeldaten:", err);
      labelEl.textContent = "Fehler beim Laden – bitte Seite neu laden";
      actionsEl.innerHTML = "";
    }
  }

  async function saveToday() {
    await setDoc(doc(db, "timeentries", entryId(uid)), {
      uid,
      date: todayISO(),
      shifts: currentShifts,
    });
  }

  async function handleAction(action) {
    const now = new Date().toISOString();
    const status = getStatus(currentShifts);

    if (action === "kommen") {
      currentShifts.push({ start: now, ende: null, pausen: [] });
    } else if (action === "pause") {
      status.shift.pausen.push({ start: now, ende: null });
    } else if (action === "pause-beenden") {
      status.shift.pausen[status.shift.pausen.length - 1].ende = now;
    } else if (action === "gehen") {
      status.shift.ende = now;
    }

    setActionsDisabled(true);
    try {
      await saveToday();
      render();
    } catch (err) {
      console.error(err);
      alert("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setActionsDisabled(false);
    }
  }

  function setActionsDisabled(disabled) {
    actionsEl.querySelectorAll("button").forEach((b) => (b.disabled = disabled));
  }

  function render() {
    const status = getStatus(currentShifts);

    dotEl.className = "status-dot-badge";
    kommenRow.style.display = "none";
    pauseRow.style.display = "none";

    if (status.state === "idle") {
      dotEl.classList.add("dot-idle");
      labelEl.textContent = "Nicht eingestempelt";
      actionsEl.innerHTML = `<button class="btn btn-primary" data-action="kommen">Kommen</button>`;
    } else if (status.state === "working") {
      dotEl.classList.add("dot-working");
      labelEl.textContent = "Eingestempelt";
      kommenRow.style.display = "flex";
      kommenEl.textContent = formatTime(status.shift.start);
      actionsEl.innerHTML = `
        <button class="btn btn-yellow-outline" data-action="pause">⏸ Pause</button>
        <button class="btn btn-danger-solid" data-action="gehen">✕ Gehen</button>
      `;
    } else if (status.state === "onbreak") {
      dotEl.classList.add("dot-break");
      labelEl.textContent = "Pause";
      kommenRow.style.display = "flex";
      kommenEl.textContent = formatTime(status.shift.start);
      pauseRow.style.display = "flex";
      pauseSinceEl.textContent = formatTime(status.shift.pausen[status.shift.pausen.length - 1].start);
      actionsEl.innerHTML = `<button class="btn btn-primary" data-action="pause-beenden">▶ Pause beenden</button>`;
    }

    actionsEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.action));
    });

    renderShiftList();
  }

  function renderShiftList() {
    if (currentShifts.length === 0) {
      shiftList.innerHTML = '<div class="hint-text">Heute noch keine Schicht erfasst.</div>';
      return;
    }
    shiftList.innerHTML = currentShifts
      .map((s, i) => {
        const range = `${formatTime(s.start)} – ${s.ende ? formatTime(s.ende) : "läuft"}`;
        const pausenText =
          s.pausen && s.pausen.length > 0
            ? s.pausen
                .map((p) => `${formatTime(p.start)}–${p.ende ? formatTime(p.ende) : "läuft"}`)
                .join(", ")
            : "Keine Pause";
        return `
        <div class="shift-row">
          <div class="shift-row-main">
            <span class="shift-label">Schicht ${i + 1}</span>
            <span class="shift-range">${range}</span>
          </div>
          <div class="shift-row-pause">Pause: ${pausenText}</div>
        </div>`;
      })
      .join("");
  }

  function startClock() {
    const timeEl = document.getElementById("live-clock");
    const dateEl = document.getElementById("live-date");
    function tick() {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      dateEl.textContent = now.toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }
    tick();
    setInterval(tick, 1000);
  }
}

function getStatus(shifts) {
  if (shifts.length === 0) return { state: "idle" };
  const last = shifts[shifts.length - 1];
  if (last.ende) return { state: "idle" };
  const lastPause = last.pausen && last.pausen.length > 0 ? last.pausen[last.pausen.length - 1] : null;
  if (lastPause && !lastPause.ende) return { state: "onbreak", shift: last };
  return { state: "working", shift: last };
}

function entryId(uid) {
  return `${uid}_${todayISO()}`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}
