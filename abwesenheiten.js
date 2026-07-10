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
  let editingAbwId = null;

  setupSubtabs();
  loadFerienantraegeAdmin();

  document.getElementById("abw-submit-btn").addEventListener("click", submitAbwesenheit);
  document.getElementById("abw-cancel-edit-btn").addEventListener("click", resetForm);

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
          resetForm();
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
    btn.textContent = editingAbwId ? "Speichert …" : "Wird gespeichert …";
    try {
      const overlap = await hasOverlap(uid, von, bis, editingAbwId);
      if (overlap) {
        errorEl.textContent = "Dieser Zeitraum überschneidet sich mit einem bereits bestehenden Abwesenheits-Eintrag dieses Mitarbeiters.";
        return;
      }

      if (editingAbwId) {
        await updateDoc(doc(db, "abwesenheiten", editingAbwId), {
          uid, name: empl ? empl.name : "", typ: currentTyp, von, bis, bemerkung,
        });
      } else {
        await addDoc(collection(db, "abwesenheiten"), {
          uid,
          name: empl ? empl.name : "",
          typ: currentTyp,
          von, bis, bemerkung,
          createdAt: new Date().toISOString(),
        });
      }
      resetForm();
      loadSimpleList(currentTyp);
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
    } finally {
      btn.disabled = false;
      btn.textContent = editingAbwId ? "Speichern" : "Eintragen";
    }
  }

  // Prüft Überschneidung mit bestehenden Abwesenheiten desselben Mitarbeiters
  // (über alle Typen hinweg, ausser dem gerade bearbeiteten Eintrag selbst).
  async function hasOverlap(uid, von, bis, excludeId) {
    const snap = await getDocs(query(collection(db, "abwesenheiten"), where("uid", "==", uid)));
    for (const d of snap.docs) {
      if (excludeId && d.id === excludeId) continue;
      const r = d.data();
      if (von <= r.bis && bis >= r.von) return true;
    }
    return false;
  }

  function resetForm() {
    editingAbwId = null;
    document.getElementById("abw-form-title").textContent = "Neuen Eintrag erfassen";
    document.getElementById("abw-von").value = "";
    document.getElementById("abw-bis").value = "";
    document.getElementById("abw-bemerkung").value = "";
    document.getElementById("abw-error").textContent = "";
    document.getElementById("abw-submit-btn").textContent = "Eintragen";
    document.getElementById("abw-cancel-edit-btn").style.display = "none";
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
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="icon-btn" data-edit="${d.id}" title="Bearbeiten">✏️</button>
              <button class="icon-btn icon-btn-danger" data-id="${d.id}" title="Löschen">🗑️</button>
            </div>
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-id]").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!confirm("Diesen Eintrag wirklich löschen?")) return;
        await deleteDoc(doc(db, "abwesenheiten", b.dataset.id));
        if (editingAbwId === b.dataset.id) resetForm();
        loadSimpleList(typ);
      });
    });
    listEl.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", async () => {
        const snapDoc = await getDoc(doc(db, "abwesenheiten", b.dataset.edit));
        if (!snapDoc.exists()) return;
        const a = snapDoc.data();
        editingAbwId = b.dataset.edit;
        document.getElementById("abw-form-title").textContent = "Eintrag bearbeiten";
        document.getElementById("abw-mitarbeiter").value = a.uid;
        document.getElementById("abw-von").value = a.von || "";
        document.getElementById("abw-bis").value = a.bis || "";
        document.getElementById("abw-bemerkung").value = a.bemerkung || "";
        document.getElementById("abw-error").textContent = "";
        document.getElementById("abw-submit-btn").textContent = "Speichern";
        document.getElementById("abw-cancel-edit-btn").style.display = "block";
        document.querySelector("#abw-sub-simple .form-card").scrollIntoView({ behavior: "smooth", block: "start" });
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
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="status-badge ${r.status}">${statusLabel}</span>
              <button class="small-remove-btn" data-delete="${d.id}" title="Löschen">✕</button>
            </div>
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
    listEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Diesen Ferienantrag wirklich löschen?")) return;
        await deleteDoc(doc(db, "ferienantraege", btn.dataset.delete));
        loadFerienantraegeAdmin();
      });
    });
  }

  function openDecisionModal(id, action) {
    return new Promise((resolve) => {
      const modal = document.getElementById("ferien-decision-modal");
      const title = document.getElementById("ferien-decision-title");
      const label = document.getElementById("ferien-decision-label");
      const input = document.getElementById("ferien-decision-begruendung");
      const okBtn = document.getElementById("ferien-decision-ok");
      const cancelBtn = document.getElementById("ferien-decision-cancel");

      title.textContent = action === "approve" ? "Ferienantrag genehmigen" : "Ferienantrag ablehnen";
      label.textContent = action === "approve" ? "Bemerkung (optional)" : "Begründung (optional)";
      input.value = "";
      okBtn.textContent = action === "approve" ? "Genehmigen" : "Ablehnen";
      modal.classList.add("active");
      input.focus();

      function cleanup(result) {
        modal.classList.remove("active");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onOk() { cleanup(input.value.trim()); }
      function onCancel() { cleanup(null); }

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  async function handleDecision(id, action) {
    const begruendung = await openDecisionModal(id, action);
    if (begruendung === null) return; // abgebrochen
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
