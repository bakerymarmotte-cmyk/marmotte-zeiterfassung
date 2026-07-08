import { db } from "./firebase-config.js";
import {
  collection, addDoc, query, where, getDocs, orderBy, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const statusLabels = { offen: "Offen", genehmigt: "Genehmigt", abgelehnt: "Abgelehnt" };

export function initAntraegeTab(session) {
  const uid = session.uid;
  const name = session.profile.name || "";

  setupSubtabs();
  setupFerien();
  setupFreiwuensche();

  function setupSubtabs() {
    const buttons = document.querySelectorAll("#antraege-subtabs button");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll("#panel-antraege .subpanel").forEach((p) => p.classList.remove("active"));
        document.getElementById("antraege-sub-" + btn.dataset.sub).classList.add("active");
      });
    });
  }

  function setupFerien() {
    const vonEl = document.getElementById("ferien-von");
    const bisEl = document.getElementById("ferien-bis");
    const bemerkungEl = document.getElementById("ferien-bemerkung");
    const errorEl = document.getElementById("ferien-error");
    const btn = document.getElementById("ferien-submit-btn");
    const listEl = document.getElementById("ferien-list");

    loadFerien();

    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      if (!vonEl.value || !bisEl.value) {
        errorEl.textContent = "Bitte Von- und Bis-Datum angeben.";
        return;
      }
      if (bisEl.value < vonEl.value) {
        errorEl.textContent = "Das Bis-Datum darf nicht vor dem Von-Datum liegen.";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Wird gesendet …";
      try {
        await addDoc(collection(db, "ferienantraege"), {
          uid, name,
          von: vonEl.value,
          bis: bisEl.value,
          bemerkung: bemerkungEl.value.trim(),
          status: "offen",
          begruendung: "",
          createdAt: new Date().toISOString(),
        });
        vonEl.value = ""; bisEl.value = ""; bemerkungEl.value = "";
        loadFerien();
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Senden fehlgeschlagen. Bitte erneut versuchen.";
      } finally {
        btn.disabled = false;
        btn.textContent = "Ferien beantragen";
      }
    });

    async function loadFerien() {
      listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
      const q = query(collection(db, "ferienantraege"), where("uid", "==", uid), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      if (snap.empty) {
        listEl.innerHTML = '<div class="hint-text">Noch keine Ferienanträge gestellt.</div>';
        return;
      }
      listEl.innerHTML = snap.docs
        .map((d) => {
          const r = d.data();
          return `
          <div class="request-item">
            <div class="request-item-top">
              <div>
                <div class="request-range">${formatDate(r.von)} – ${formatDate(r.bis)}</div>
              </div>
              <span class="status-badge ${r.status}">${statusLabels[r.status] || r.status}</span>
            </div>
            ${r.bemerkung ? `<div class="request-bemerkung">"${escapeHtml(r.bemerkung)}"</div>` : ""}
            ${r.begruendung ? `<div class="request-begruendung">Begründung: ${escapeHtml(r.begruendung)}</div>` : ""}
          </div>`;
        })
        .join("");
    }
  }

  function setupFreiwuensche() {
    const datumEl = document.getElementById("freiwunsch-datum");
    const bemerkungEl = document.getElementById("freiwunsch-bemerkung");
    const errorEl = document.getElementById("freiwunsch-error");
    const btn = document.getElementById("freiwunsch-submit-btn");
    const listEl = document.getElementById("freiwunsch-list");

    loadFreiwuensche();

    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      if (!datumEl.value) {
        errorEl.textContent = "Bitte ein Datum angeben.";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Wird gespeichert …";
      try {
        await addDoc(collection(db, "freiwuensche"), {
          uid, name,
          datum: datumEl.value,
          bemerkung: bemerkungEl.value.trim(),
          createdAt: new Date().toISOString(),
        });
        datumEl.value = ""; bemerkungEl.value = "";
        loadFreiwuensche();
      } catch (err) {
        console.error(err);
        errorEl.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
      } finally {
        btn.disabled = false;
        btn.textContent = "Wunsch eintragen";
      }
    });

    async function loadFreiwuensche() {
      listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
      const q = query(collection(db, "freiwuensche"), where("uid", "==", uid), orderBy("datum", "desc"));
      const snap = await getDocs(q);
      if (snap.empty) {
        listEl.innerHTML = '<div class="hint-text">Noch keine Frei-Wünsche eingetragen.</div>';
        return;
      }
      listEl.innerHTML = snap.docs
        .map((d) => {
          const r = d.data();
          return `
          <div class="request-item">
            <div class="request-item-top">
              <div>
                <div class="request-range">${formatDate(r.datum)}</div>
                ${r.bemerkung ? `<div class="request-bemerkung">"${escapeHtml(r.bemerkung)}"</div>` : ""}
              </div>
              <button class="small-remove-btn" data-id="${d.id}">✕</button>
            </div>
          </div>`;
        })
        .join("");

      listEl.querySelectorAll("[data-id]").forEach((b) => {
        b.addEventListener("click", async () => {
          await deleteDoc(doc(db, "freiwuensche", b.dataset.id));
          loadFreiwuensche();
        });
      });
    }
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
