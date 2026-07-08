import { db } from "./firebase-config.js";
import {
  collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const typLabels = {
  krank: "Krank",
  unfall: "Unfall",
  militaer: "Militär",
  schwangerschaft: "Schwangerschaft",
  bezahlter_frei_tag: "Bezahlter Frei Tag",
};

export function initAbwesenheitenTab(session) {
  let currentTyp = "ferienantraege";
  let employeesCache = null;

  setupSubtabs();
  loadFerienantraegeAdmin();

  document.getElementById("abw-submit-btn").addEventListener("click", submitAbwesenheit);

  function setupSubtabs() {
    const buttons = document.querySelectorAll("#abwesenheiten-subtabs button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentTyp = btn.dataset.abwsub;

        document.getElementById("abw-sub-ferienantraege").classList.toggle("active", currentTyp === "ferienantraege");
        document.getElementById("abw-sub-simple").classList.toggle("active", currentTyp !== "ferienantraege");

        if (currentTyp === "ferienantraege") {
          loadFerienantraegeAdmin();
        } else {
          document.getElementById("abw-bemerkung-hint").style.display = currentTyp === "bezahlter_frei_tag" ? "block" : "none";
          await ensureEmployeeOptions();
          loadSimpleList(currentTyp);
        }
      });
    });
  }

  async function ensureEmployeeOptions() {
    const select = document.getElementById("abw-mitarbeiter");
    if (employeesCache) return;
    const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
    employeesCache = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    select.innerHTML = employeesCache
      .map((e) => `<option value="${e.uid}">${escapeHtml(e.name || e.email || e.uid)}</option>`)
      .join("");
  }

  async function submitAbwesenheit() {
    const errorEl = document.getElementById("abw-error");
    const btn = document.getElementById("abw-submit-btn");
    errorEl.textContent = "";

    const select = document.getElementById("abw-mitarbeiter");
    const uid = select.value;
    const empl = employeesCache.find((e) => e.uid === uid);
    const von = document.getElementById("abw-von").value;
    const bis = document.getElementById("abw-bis").value;
    const bemerkung = document.getElementById("abw-bemerkung").value.trim();

    if (!uid || !von || !bis) {
      errorEl.textContent = "Bitte Mitarbeiter, Von- und Bis-Datum angeben.";
      return;
    }
    if (bis < von) {
      errorEl.textContent = "Das Bis-Datum darf nicht vor dem Von-Datum liegen.";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Wird gespeichert …";
    try {
      await addDoc(collection(db, "abwesenheiten"), {
        uid,
        name: empl ? empl.name : "",
        typ: currentTyp,
        von, bis, bemerkung,
        createdAt: new Date().toISOString(),
      });
      document.getElementById("abw-von").value = "";
      document.getElementById("abw-bis").value = "";
      document.getElementById("abw-bemerkung").value = "";
      loadSimpleList(currentTyp);
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Eintragen";
    }
  }

  async function loadSimpleList(typ) {
    const listEl = document.getElementById("abw-simple-list");
    listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
    const q = query(collection(db, "abwesenheiten"), where("typ", "==", typ), orderBy("von", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<div class="hint-text">Keine Einträge für ${typLabels[typ]}.</div>`;
      return;
    }
    listEl.innerHTML = snap.docs
      .map((d) => {
        const a = d.data();
        return `
        <div class="request-item">
          <div class="request-item-top">
            <div>
              <div class="request-range">${formatDate(a.von)} – ${formatDate(a.bis)}</div>
              <div class="request-name">${escapeHtml(a.name || "")}</div>
              ${a.bemerkung ? `<div class="request-bemerkung">"${escapeHtml(a.bemerkung)}"</div>` : ""}
            </div>
            <button class="small-remove-btn" data-id="${d.id}">✕</button>
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-id]").forEach((b) => {
      b.addEventListener("click", async () => {
        await deleteDoc(doc(db, "abwesenheiten", b.dataset.id));
        loadSimpleList(typ);
      });
    });
  }

  async function loadFerienantraegeAdmin() {
    const listEl = document.getElementById("ferienantraege-admin-list");
    listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
    const q = query(collection(db, "ferienantraege"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<div class="hint-text">Keine Ferienanträge vorhanden.</div>';
      return;
    }
    listEl.innerHTML = snap.docs
      .map((d) => {
        const r = d.data();
        const statusLabel = { offen: "Offen", genehmigt: "Genehmigt", abgelehnt: "Abgelehnt" }[r.status] || r.status;
        return `
        <div class="request-item">
          <div class="request-item-top">
            <div>
              <div class="request-range">${formatDate(r.von)} – ${formatDate(r.bis)}</div>
              <div class="request-name">${escapeHtml(r.name || "")}</div>
            </div>
            <span class="status-badge ${r.status}">${statusLabel}</span>
          </div>
          ${r.bemerkung ? `<div class="request-bemerkung">"${escapeHtml(r.bemerkung)}"</div>` : ""}
          ${r.begruendung ? `<div class="request-begruendung">Begründung: ${escapeHtml(r.begruendung)}</div>` : ""}
          ${r.status === "offen" ? `
            <div class="request-actions">
              <button class="btn btn-approve" data-action="approve" data-id="${d.id}">✓ Genehmigen</button>
              <button class="btn btn-reject" data-action="reject" data-id="${d.id}">✕ Ablehnen</button>
            </div>` : ""}
        </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleDecision(btn.dataset.id, btn.dataset.action));
    });
  }

  async function handleDecision(id, action) {
    let begruendung = "";
    if (action === "reject") {
      begruendung = prompt("Optionale Begründung für die Ablehnung:") || "";
    } else {
      begruendung = prompt("Optionale Bemerkung zur Genehmigung:") || "";
    }
    await updateDoc(doc(db, "ferienantraege", id), {
      status: action === "approve" ? "genehmigt" : "abgelehnt",
      begruendung,
      decidedAt: new Date().toISOString(),
    });
    loadFerienantraegeAdmin();
  }
}

function formatDate(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
