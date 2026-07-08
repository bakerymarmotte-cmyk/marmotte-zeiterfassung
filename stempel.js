import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initStempelTab(session) {
  const uid = session.uid;
  const bigBtn = document.getElementById("stempel-btn");
  const statusText = document.getElementById("stempel-status");
  const shiftList = document.getElementById("today-shift-list");

  let currentShifts = [];

  loadToday();

  bigBtn.addEventListener("click", async () => {
    bigBtn.disabled = true;
    try {
      const status = getStatus(currentShifts);
      const now = new Date().toISOString();

      if (status.state === "idle") {
        currentShifts.push({ start: now, ende: null, pause: null });
      } else if (status.state === "working") {
        status.shift.pause = { start: now, ende: null };
      } else if (status.state === "onbreak") {
        status.shift.pause.ende = now;
      } else if (status.state === "afterbreak") {
        status.shift.ende = now;
      }

      await saveToday();
      render();
    } catch (err) {
      console.error(err);
      alert("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      bigBtn.disabled = false;
    }
  });

  async function loadToday() {
    const snap = await getDoc(doc(db, "timeentries", entryId(uid)));
    currentShifts = snap.exists() && Array.isArray(snap.data().shifts) ? snap.data().shifts : [];
    render();
  }

  async function saveToday() {
    await setDoc(doc(db, "timeentries", entryId(uid)), {
      uid,
      date: todayISO(),
      shifts: currentShifts,
    });
  }

  function render() {
    const status = getStatus(currentShifts);
    const labels = {
      idle: { btn: "Einstempeln", info: "Nicht eingestempelt" },
      working: { btn: "Pause starten", info: `Eingestempelt seit ${formatTime(status.shift.start)}` },
      onbreak: { btn: "Pause beenden", info: `Pause seit ${formatTime(status.shift.pause.start)}` },
      afterbreak: { btn: "Ausstempeln", info: `Pause beendet um ${formatTime(status.shift.pause.ende)}` },
    };
    const l = labels[status.state];
    bigBtn.textContent = l.btn;
    statusText.textContent = l.info;

    bigBtn.className = "btn stempel-main-btn " + {
      idle: "btn-primary",
      working: "btn-yellow-outline",
      onbreak: "btn-primary",
      afterbreak: "btn-danger-solid",
    }[status.state];

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
        const pause = s.pause
          ? `Pause: ${formatTime(s.pause.start)} – ${s.pause.ende ? formatTime(s.pause.ende) : "läuft"}`
          : "Keine Pause";
        return `
        <div class="shift-row">
          <div class="shift-row-main">
            <span class="shift-label">Schicht ${i + 1}</span>
            <span class="shift-range">${range}</span>
          </div>
          <div class="shift-row-pause">${pause}</div>
        </div>`;
      })
      .join("");
  }
}

function getStatus(shifts) {
  if (shifts.length === 0) return { state: "idle" };
  const last = shifts[shifts.length - 1];
  if (last.ende) return { state: "idle" };
  if (!last.pause) return { state: "working", shift: last };
  if (!last.pause.ende) return { state: "onbreak", shift: last };
  return { state: "afterbreak", shift: last };
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
