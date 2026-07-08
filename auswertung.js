import { db } from "./firebase-config.js";
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
  const filterBtns = document.querySelectorAll("#live-abteilung-filter button");

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.abtfilter;
      render();
    });
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

    listEl.innerHTML = "";
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
      item.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(emp.name || "")}</div>
          <div class="meta">${escapeHtml(getAbteilungen(emp).join(", ") || "–")}${status.sub ? " · " + escapeHtml(status.sub) : ""}</div>
        </div>
        <span class="status-pill" style="background:${style.color}22; color:${style.color};">
          ${style.icon} ${style.label}
        </span>
      `;
      listEl.appendChild(item);
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
    return { state: "feierabend", sub: `seit ${formatTime(last.ende)}` };
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
