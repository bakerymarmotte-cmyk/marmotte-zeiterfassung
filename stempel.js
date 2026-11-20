import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initStempelTab(session) {
  const uid = session.uid;
  const abteilungen = Array.isArray(session.profile.abteilungen)
    ? session.profile.abteilungen
    : (session.profile.abteilung ? [session.profile.abteilung] : []);
  const abteilung = abteilungen.join(", ") || "–";

  const dotEl = document.getElementById("status-dot");
  const labelEl = document.getElementById("status-label");
  const abteilungEl = document.getElementById("status-abteilung");
  const kommenRow = document.getElementById("status-kommen-row");
  const kommenEl = document.getElementById("status-kommen");
  const pauseRow = document.getElementById("status-pause-row");
  const pauseSinceEl = document.getElementById("status-pause-since");
  const actionsEl = document.getElementById("stempel-actions");
  const shiftList = document.getElementById("today-shift-list");
  const errorEl = document.getElementById("stempel-error");

  const confirmModal = document.getElementById("stempel-confirm-modal");
  const confirmTitle = document.getElementById("stempel-confirm-title");
  const confirmText = document.getElementById("stempel-confirm-text");
  const confirmOkBtn = document.getElementById("stempel-confirm-ok");
  const confirmCancelBtn = document.getElementById("stempel-confirm-cancel");

  const confirmMessages = {
    kommen: { title: "Einstempeln", text: "Möchtest du dich jetzt einstempeln?", ok: "Einstempeln" },
    gehen: { title: "Ausstempeln", text: "Möchtest du dich jetzt ausstempeln?", ok: "Ausstempeln" },
  };

  function askConfirm(action) {
    return new Promise((resolve) => {
      const msg = confirmMessages[action];
      confirmTitle.textContent = msg.title;
      confirmText.textContent = msg.text;
      confirmOkBtn.textContent = msg.ok;
      confirmModal.classList.add("active");

      function cleanup(result) {
        confirmModal.classList.remove("active");
        confirmOkBtn.removeEventListener("click", onOk);
        confirmCancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      confirmOkBtn.addEventListener("click", onOk);
      confirmCancelBtn.addEventListener("click", onCancel);
    });
  }

  abteilungEl.textContent = abteilung;

  let currentShifts = [];
  // Datum des Eintrags, an dem gerade gestempelt wird. Normalerweise heute; läuft noch eine
  // Schicht von gestern Abend (über Mitternacht), wird diese am gestrigen Eintrag weitergeführt.
  let aktivDatum = todayISO();
  let gesternVergessen = null; // offene Schicht von gestern, die zu alt ist (vergessen auszustempeln)

  startClock();
  loadToday();

  async function loadToday() {
    try {
      const heute = todayISO();
      const gestern = isoVon(-1);
      const [snapHeute, snapGestern] = await Promise.all([
        getDoc(doc(db, "timeentries", `${uid}_${heute}`)),
        getDoc(doc(db, "timeentries", `${uid}_${gestern}`)).catch(() => null),
      ]);
      const schichtenHeute = snapHeute.exists() && Array.isArray(snapHeute.data().shifts) ? snapHeute.data().shifts : [];
      const schichtenGestern = snapGestern?.exists() && Array.isArray(snapGestern.data().shifts) ? snapGestern.data().shifts : [];
      const offenGestern = schichtenGestern.length && !schichtenGestern[schichtenGestern.length - 1].ende
        ? schichtenGestern[schichtenGestern.length - 1] : null;
      gesternVergessen = null;
      if (offenGestern && getStatus(schichtenHeute).state === "idle" &&
          Date.now() - new Date(offenGestern.start).getTime() < UEBER_MITTERNACHT_MAX) {
        aktivDatum = gestern;
        currentShifts = schichtenGestern;
      } else {
        aktivDatum = heute;
        currentShifts = schichtenHeute;
        if (offenGestern) gesternVergessen = offenGestern;
      }
      render();
    } catch (err) {
      console.error("Fehler beim Laden der Stempeldaten:", err);
      labelEl.textContent = "Fehler beim Laden – bitte Seite neu laden";
      actionsEl.innerHTML = "";
    }
  }

  async function saveToday() {
    await setDoc(doc(db, "timeentries", `${uid}_${aktivDatum}`), {
      uid,
      date: aktivDatum,
      shifts: currentShifts,
    });
  }

  async function handleAction(action) {
    if (action === "kommen" || action === "gehen") {
      const confirmed = await askConfirm(action);
      if (!confirmed) return;
    }

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

    errorEl.textContent = "";
    setActionsDisabled(true);
    try {
      await saveToday();
      // Nach dem Ausstempeln einer Schicht von gestern wieder auf heute wechseln
      if (action === "gehen" && aktivDatum !== todayISO()) await loadToday();
      else render();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen. Bitte prüfe deine Internetverbindung und versuche es erneut.";
      // Änderung rückgängig machen, da sie nicht gespeichert werden konnte
      await loadToday();
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
      actionsEl.innerHTML = `<button class="btn btn-primary" data-action="kommen">Einstempeln</button>`;
    } else if (status.state === "working") {
      dotEl.classList.add("dot-working");
      labelEl.textContent = "Eingestempelt";
      kommenRow.style.display = "flex";
      kommenEl.textContent = kommenText(status.shift.start);
      actionsEl.innerHTML = `
        <button class="btn btn-yellow-outline" data-action="pause"><i data-icon="pause" data-size="16"></i> Pause</button>
        <button class="btn btn-danger-solid" data-action="gehen"><i data-icon="log-out" data-size="16"></i> Ausstempeln</button>
      `;
    } else if (status.state === "onbreak") {
      dotEl.classList.add("dot-break");
      labelEl.textContent = "Pause";
      kommenRow.style.display = "flex";
      kommenEl.textContent = kommenText(status.shift.start);
      pauseRow.style.display = "flex";
      pauseSinceEl.textContent = formatTime(status.shift.pausen[status.shift.pausen.length - 1].start);
      actionsEl.innerHTML = `<button class="btn btn-primary" data-action="pause-beenden"><i data-icon="play" data-size="16"></i> Pause beenden</button>`;
    }

    actionsEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.action));
    });

    if (gesternVergessen && status.state === "idle") {
      errorEl.textContent = `Gestern nicht ausgestempelt (Schicht seit ${formatTime(gesternVergessen.start)}). Bitte der Leitung melden, damit sie die Zeit korrigiert.`;
    } else if (errorEl.textContent.startsWith("Gestern nicht ausgestempelt")) {
      errorEl.textContent = "";
    }

    renderShiftList();
  }

  // «06:00» oder «gestern 23:00» bei einer Schicht über Mitternacht
  function kommenText(startIso) {
    return aktivDatum !== todayISO() ? `gestern ${formatTime(startIso)}` : formatTime(startIso);
  }

  function renderShiftList() {
    const titelEl = document.querySelector(".shift-list-title");
    if (titelEl) titelEl.textContent = aktivDatum !== todayISO() ? "Schichten von gestern (läuft über Mitternacht)" : "Heutige Schichten";
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
        const hoursText = s.ende ? formatDuration(s.start, s.ende, s.pausen) : "läuft";
        return `
        <div class="shift-row">
          <div class="shift-row-main">
            <span class="shift-label">Schicht ${i + 1}</span>
            <span class="shift-range">${hoursText}</span>
          </div>
          <div class="shift-row-pause">${range} · Pause: ${pausenText}</div>
        </div>`;
      })
      .join("");
  }

  function formatDuration(startIso, endIso, pausen) {
    let minutes = (new Date(endIso) - new Date(startIso)) / 60000;
    if (Array.isArray(pausen)) {
      for (const p of pausen) {
        const pStart = new Date(p.start);
        const pEnd = p.ende ? new Date(p.ende) : new Date();
        minutes -= (pEnd - pStart) / 60000;
      }
    }
    minutes = Math.max(0, Math.round(minutes));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
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

// Eine offene Schicht von gestern wird nur weitergeführt, wenn sie vor weniger als 16 Stunden
// begonnen hat (z.B. 22:00 → 06:00). Ältere offene Schichten gelten als vergessen.
const UEBER_MITTERNACHT_MAX = 16 * 60 * 60 * 1000;

function isoVon(tageVerschiebung) {
  const d = new Date();
  d.setDate(d.getDate() + tageVerschiebung);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
