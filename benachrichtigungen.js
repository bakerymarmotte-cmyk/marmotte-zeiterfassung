// =============================================================================
//  Benachrichtigungen von M.A.R.M.O.T. (Web Push, nur Admin)
//  - Karte «Benachrichtigungen» unter Admin → Einstellungen: pro Gerät ein-/ausschalten
//  - Eingeschaltete Geräte stehen in der Sammlung «pushabos»; M.A.R.M.O.T. schickt
//    an alle diese Geräte (z.B. «nicht ausgestempelt» um 21:00).
//  - Antippen einer Meldung öffnet app.html?zeige=… → linkOeffnen() springt an die Stelle.
// =============================================================================

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const unterstuetzt = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function initBenachrichtigungen(session) {
  if (session.profile.role !== "admin") return;

  const panel = document.getElementById("sub-einstellungen");
  const karte = document.createElement("div");
  karte.className = "settings-card";
  karte.id = "push-card";
  karte.innerHTML = `
    <h4>Benachrichtigungen (M.A.R.M.O.T.)</h4>
    <span class="hint-text" style="display:block; margin-bottom:12px;">Meldungen von M.A.R.M.O.T. auf diesem Gerät – z.B. um 21:00, wenn noch jemand nicht ausgestempelt ist.</span>
    <div id="push-status" style="font-weight:600; font-size:14px; margin-bottom:12px;">Prüfe …</div>
    <div class="error-text" id="push-error"></div>
    <button class="btn btn-primary" id="push-toggle-btn" style="width:100%; margin-bottom:10px;" disabled>…</button>
    <button class="btn btn-secondary" id="push-probe-btn" style="width:100%; margin-bottom:18px; display:none;">Probemeldung anzeigen</button>
  `;
  panel.prepend(karte);

  const statusEl = karte.querySelector("#push-status");
  const errorEl = karte.querySelector("#push-error");
  const toggleBtn = karte.querySelector("#push-toggle-btn");
  const probeBtn = karte.querySelector("#push-probe-btn");
  let reg = null;
  let abo = null;

  toggleBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    toggleBtn.disabled = true;
    try {
      if (abo) await ausschalten(); else await einschalten();
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || "Hat nicht geklappt.";
    }
    await anzeigen();
  });

  probeBtn.addEventListener("click", () => {
    reg?.showNotification("M.A.R.M.O.T.", {
      body: "Probemeldung – so sehen die Meldungen aus.",
      icon: "assets/icon-192.png",
      tag: "probe",
      data: { url: "./app.html" },
    });
  });

  anzeigen();

  async function anzeigen() {
    if (!unterstuetzt()) {
      statusEl.textContent = "Dieser Browser unterstützt keine Benachrichtigungen.";
      toggleBtn.style.display = "none";
      return;
    }
    reg = await navigator.serviceWorker.register("./service-worker.js").then(() => navigator.serviceWorker.ready);
    abo = await reg.pushManager.getSubscription();
    if (Notification.permission === "denied") {
      statusEl.textContent = "Blockiert – Benachrichtigungen in den Browser-Einstellungen für diese Seite erlauben.";
      toggleBtn.style.display = "none";
      probeBtn.style.display = "none";
      return;
    }
    if (abo && Notification.permission !== "granted") abo = null;
    statusEl.textContent = abo ? "Auf diesem Gerät eingeschaltet ✓" : "Auf diesem Gerät ausgeschaltet";
    toggleBtn.textContent = abo ? "Ausschalten" : "Auf diesem Gerät einschalten";
    toggleBtn.className = abo ? "btn btn-secondary" : "btn btn-primary";
    toggleBtn.style.display = "";
    toggleBtn.disabled = false;
    probeBtn.style.display = abo ? "" : "none";
  }

  async function einschalten() {
    const erlaubnis = await Notification.requestPermission();
    if (erlaubnis !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
    const snap = await getDoc(doc(db, "settings", "push"));
    const publicKey = snap.exists() ? snap.data().publicKey : null;
    if (!publicKey) throw new Error("M.A.R.M.O.T. hat noch keinen Schlüssel hinterlegt. Läuft er mit den neuen Einstellungen?");

    // Immer frisch anmelden (falls sich der Schlüssel geändert hat)
    const alt = await reg.pushManager.getSubscription();
    if (alt) await alt.unsubscribe();
    const neu = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ZuBytes(publicKey) });

    await setDoc(doc(db, "pushabos", await aboId(neu)), {
      uid: session.uid,
      name: session.profile.name || "",
      geraet: geraetName(),
      abo: JSON.parse(JSON.stringify(neu)),
      erstelltAm: new Date().toISOString(),
    });
  }

  async function ausschalten() {
    await deleteDoc(doc(db, "pushabos", await aboId(abo))).catch((e) => console.warn(e));
    await abo.unsubscribe();
  }
}

// Antippen einer Meldung: app.html?zeige=monat | live | detail&uid=…&von=…&bis=…
export async function linkOeffnen(session) {
  const p = new URLSearchParams(location.search);
  const zeige = p.get("zeige");
  if (!zeige) return;
  history.replaceState(null, "", location.pathname);
  if (session.profile.role !== "admin" && session.profile.role !== "leitung") return;

  klick('#bottom-nav [data-tab="admin"]');
  klick('#admin-subtabs [data-sub="auswertung"]');
  if (zeige === "live") { klick('#auswertung-subtabs [data-auswsub="live"]'); return; }
  klick('#auswertung-subtabs [data-auswsub="monat"]');
  if (zeige !== "detail") return;

  // Warten, bis die Monatsübersicht fertig geladen ist, dann auf die Person filtern
  const sel = document.getElementById("uebersicht-mitarbeiter");
  const results = document.getElementById("uebersicht-results");
  for (let i = 0; i < 150; i++) {
    const anzahl = sel.options.length - 1;
    const fertig = anzahl > 0 && (results.querySelectorAll(".uebersicht-card").length >= anzahl || results.textContent.includes("Keine Mitarbeiter"));
    if (fertig) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const uid = p.get("uid");
  if (![...sel.options].some((o) => o.value === uid)) return;
  if (p.get("von")) document.getElementById("uebersicht-von").value = p.get("von");
  if (p.get("bis")) document.getElementById("uebersicht-bis").value = p.get("bis");
  document.getElementById("uebersicht-abteilung").value = "alle";
  sel.value = uid;
  document.getElementById("uebersicht-filter-btn").click();
}

function klick(selektor) {
  document.querySelector(selektor)?.click();
}

function base64ZuBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const roh = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(roh, (c) => c.charCodeAt(0));
}

async function aboId(abo) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(abo.endpoint));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function geraetName() {
  const ua = navigator.userAgent;
  const system = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "Gerät";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return `${system}${browser ? " · " + browser : ""}`;
}
