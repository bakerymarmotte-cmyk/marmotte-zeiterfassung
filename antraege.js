import { db } from "./firebase-config.js";
import {
  collection, addDoc, query, where, getDocs, getDoc, orderBy, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const statusLabels = { offen: "Offen", genehmigt: "Genehmigt", abgelehnt: "Abgelehnt" };

export function initAntraegeTab(session) {
  const uid = session.uid;
  const name = session.profile.name || "";
  const isExemptFromSperrfrist = session.profile.role === "admin" || session.profile.role === "leitung";

  setupSubtabs();
  setupFerien();
  setupFreiwuensche();

  // Prüft, ob ein Datum innerhalb der aktuell geltenden Sperrfrist liegt.
  // Admin/Leitung sind davon ausgenommen.
  async function isDateBlocked(dateISO) {
    if (isExemptFromSperrfrist) return false;
    const snap = await getDoc(doc(db, "settings", "general"));
    const wochen = snap.exists() ? Number(snap.data().sperrfristWochen) || 0 : 0;
    if (wochen <= 0) return false;
    const grenze = new Date();
    grenze.setDate(grenze.getDate() + wochen * 7);
    return dateISO < toISODate(grenze);
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

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
        const blocked = await isDateBlocked(vonEl.value);
        if (blocked) {
          errorEl.textContent = "Für diesen Zeitraum gilt aktuell eine Sperrfrist – bitte wende dich an die Leitung/Admin.";
          return;
        }
        const overlap = await hasOverlap(vonEl.value, bisEl.value);
        if (overlap) {
          errorEl.textContent = "Dieser Zeitraum überschneidet sich mit einem bereits bestehenden Ferienantrag.";
          return;
        }
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

    // Prüft, ob sich der gewünschte Zeitraum mit einem bestehenden (offenen oder
    // genehmigten) Ferienantrag desselben Mitarbeiters überschneidet.
    async function hasOverlap(von, bis) {
      const q = query(collection(db, "ferienantraege"), where("uid", "==", uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const r = d.data();
        if (r.status === "abgelehnt") continue;
        if (von <= r.bis && bis >= r.von) return true;
      }
      return false;
    }

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
                <div class="request-name">${escapeHtml(name)}</div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="status-badge ${r.status}">${statusLabels[r.status] || r.status}</span>
                ${r.status === "offen" ? `<button class="small-remove-btn" data-id="${d.id}">✕</button>` : ""}
              </div>
            </div>
            ${r.bemerkung ? `<div class="request-bemerkung">"${escapeHtml(r.bemerkung)}"</div>` : ""}
            ${r.begruendung ? `<div class="request-begruendung">Begründung: ${escapeHtml(r.begruendung)}</div>` : ""}
          </div>`;
        })
        .join("");

      listEl.querySelectorAll("[data-id]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (!confirm("Diesen Ferienantrag wirklich löschen?")) return;
          await deleteDoc(doc(db, "ferienantraege", b.dataset.id));
          loadFerien();
        });
      });
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
        const blocked = await isDateBlocked(datumEl.value);
        if (blocked) {
          errorEl.textContent = "Für dieses Datum gilt aktuell eine Sperrfrist – bitte wende dich an die Leitung/Admin.";
          return;
        }
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
