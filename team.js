import { db } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Muss identisch zur Config in firebase-config.js sein (wird für den "Zweit-App"-Trick benötigt,
// damit beim Anlegen eines neuen Mitarbeiter-Logins nicht das eigene Admin-Konto ausgeloggt wird)
const firebaseConfigDuplicate = {
  apiKey: "AIzaSyASYr0_6uHpBSYb6E7hLO-pqsySPSC9Wmk",
  authDomain: "marmotte-zeiterfassung.firebaseapp.com",
  projectId: "marmotte-zeiterfassung",
  storageBucket: "marmotte-zeiterfassung.firebasestorage.app",
  messagingSenderId: "214685195694",
  appId: "1:214685195694:web:a2cf2d9b0ec2330bdefc3f",
  measurementId: "G-84XYYD97E5"
};

const roleLabels = { admin: "Admin", leitung: "Leitung", mitarbeiter: "Mitarbeiter" };

let editingUid = null; // null = Neuanlage, sonst UID des bearbeiteten Mitarbeiters
let generalSettings = { wochenstunden100: 42, ferientageProJahr: 25 };

export function initTeamTab(session) {
  const listEl = document.getElementById("employee-list");
  const subnavBtns = document.querySelectorAll("#team-subnav button");
  const listView = document.getElementById("team-list-view");
  const formView = document.getElementById("team-form-view");
  const form = document.getElementById("employee-form");
  const errorEl = document.getElementById("employee-error");
  const formTitle = document.getElementById("team-form-title");
  const emailField = document.getElementById("emp-email");
  const passwordField = document.getElementById("emp-password-field");
  const stellenprozentEl = document.getElementById("emp-stellenprozent");
  const anstellungsartRadios = document.querySelectorAll('input[name="emp-anstellungsart"]');
  const wochenstundenField = document.getElementById("emp-wochenstunden-field");

  loadGeneralSettings();
  loadEmployees();

  subnavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      subnavBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.teamview === "list") {
        listView.style.display = "block";
        formView.style.display = "none";
      } else {
        showForm(null);
        listView.style.display = "none";
        formView.style.display = "block";
      }
    });
  });

  stellenprozentEl.addEventListener("input", updateAutoFields);
  anstellungsartRadios.forEach((r) => r.addEventListener("change", updateAutoFields));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const saveBtn = document.getElementById("employee-save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Speichert …";

    const abteilungen = Array.from(document.querySelectorAll(".emp-abteilung-cb:checked")).map((cb) => cb.value);
    const anstellungsart = document.querySelector('input[name="emp-anstellungsart"]:checked').value;

    const data = {
      name: document.getElementById("emp-name").value.trim(),
      personalnummer: document.getElementById("emp-personalnummer").value.trim(),
      abteilungen,
      email: emailField.value.trim(),
      anstellungsart,
      role: document.getElementById("emp-rolle").value,
      stellenprozent: Number(stellenprozentEl.value),
      arbeitstageProWoche: Number(document.getElementById("emp-arbeitstage").value),
      anstellungsdatum: document.getElementById("emp-anstellungsdatum").value,
    };

    if (abteilungen.length === 0) {
      errorEl.textContent = "Bitte mindestens eine Abteilung auswählen.";
      saveBtn.disabled = false;
      saveBtn.textContent = editingUid ? "Speichern" : "Mitarbeitenden erstellen";
      return;
    }

    try {
      if (editingUid) {
        await updateDoc(doc(db, "users", editingUid), data);
      } else {
        const password = document.getElementById("emp-password").value;
        if (!password || password.length < 6) {
          throw { code: "custom/short-password" };
        }
        await createEmployeeAccount(data, password);
      }
      listView.style.display = "block";
      formView.style.display = "none";
      subnavBtns.forEach((b) => b.classList.remove("active"));
      subnavBtns[0].classList.add("active");
      loadEmployees();
    } catch (err) {
      console.error(err);
      errorEl.textContent = mapError(err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = editingUid ? "Speichern" : "Mitarbeitenden erstellen";
    }
  });

  async function loadGeneralSettings() {
    const snap = await getDoc(doc(db, "settings", "general"));
    if (snap.exists()) generalSettings = snap.data();
    updateAutoFields();
  }

  function updateAutoFields() {
    const stellenprozent = Number(stellenprozentEl.value) || 0;
    const anstellungsart = document.querySelector('input[name="emp-anstellungsart"]:checked')?.value;
    const ferienEl = document.getElementById("emp-ferientage-auto");
    const wochenstundenEl = document.getElementById("emp-wochenstunden-auto");

    ferienEl.value = ((generalSettings.ferientageProJahr || 25) * (stellenprozent / 100)).toFixed(1);

    if (anstellungsart === "stundenlohn") {
      wochenstundenEl.value = "—";
      wochenstundenField.style.opacity = "0.5";
    } else {
      wochenstundenEl.value = ((generalSettings.wochenstunden100 || 42) * (stellenprozent / 100)).toFixed(1);
      wochenstundenField.style.opacity = "1";
    }
  }

  async function loadEmployees() {
    listEl.innerHTML = '<div class="hint-text">Lädt…</div>';
    const q = query(collection(db, "users"), orderBy("name"));
    const snap = await getDocs(q);
    listEl.innerHTML = "";
    if (snap.empty) {
      listEl.innerHTML = '<div class="hint-text">Noch keine Mitarbeiter angelegt.</div>';
      return;
    }
    snap.forEach((docSnap) => {
      const u = docSnap.data();
      const abteilungen = getAbteilungen(u);
      const item = document.createElement("div");
      item.className = "employee-item";
      item.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(u.name || "(ohne Name)")}</div>
          <div class="meta">${escapeHtml(abteilungen.join(", ") || "–")} · ${escapeHtml(u.personalnummer || "–")}</div>
        </div>
        <span class="badge role-${u.role || "mitarbeiter"}">${roleLabels[u.role] || u.role || ""}</span>
      `;
      item.addEventListener("click", () => {
        showForm(docSnap.id, u);
        listView.style.display = "none";
        formView.style.display = "block";
        subnavBtns.forEach((b) => b.classList.remove("active"));
        subnavBtns[1].classList.add("active");
      });
      listEl.appendChild(item);
    });
  }

  function showForm(uid, data) {
    editingUid = uid;
    errorEl.textContent = "";
    form.reset();
    document.querySelectorAll(".emp-abteilung-cb").forEach((cb) => (cb.checked = false));

    if (uid && data) {
      formTitle.textContent = "Mitarbeiter bearbeiten";
      document.getElementById("emp-name").value = data.name || "";
      document.getElementById("emp-personalnummer").value = data.personalnummer || "";
      emailField.value = data.email || "";
      emailField.disabled = true;
      passwordField.style.display = "none";
      document.querySelector(`input[name="emp-anstellungsart"][value="${data.anstellungsart || "festangestellt"}"]`).checked = true;
      document.getElementById("emp-rolle").value = data.role || "mitarbeiter";
      stellenprozentEl.value = data.stellenprozent || 100;
      document.getElementById("emp-arbeitstage").value = data.arbeitstageProWoche || 5;
      document.getElementById("emp-anstellungsdatum").value = data.anstellungsdatum || "";
      getAbteilungen(data).forEach((a) => {
        const cb = document.querySelector(`.emp-abteilung-cb[value="${a}"]`);
        if (cb) cb.checked = true;
      });
      document.getElementById("employee-save-btn").textContent = "Speichern";
    } else {
      formTitle.textContent = "Neuen Mitarbeitenden hinzufügen";
      emailField.disabled = false;
      passwordField.style.display = "flex";
      document.getElementById("employee-save-btn").textContent = "Mitarbeitenden erstellen";
    }
    updateAutoFields();
  }
}

// Fällt auf das alte Einzel-Feld "abteilung" zurück, falls ein Mitarbeiter
// noch vor der Umstellung auf Mehrfachauswahl angelegt wurde.
function getAbteilungen(profile) {
  if (Array.isArray(profile.abteilungen)) return profile.abteilungen;
  if (profile.abteilung) return [profile.abteilung];
  return [];
}

async function createEmployeeAccount(data, password) {
  // Zweite, unabhängige Firebase-App-Instanz, damit das Erstellen des neuen Logins
  // die aktuell eingeloggte Admin/Leitung-Sitzung nicht beeinflusst.
  const secondaryApp = initializeApp(firebaseConfigDuplicate, "Secondary-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, data.email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      ...data,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    });
    await signOutSecondary(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }
}

function mapError(err) {
  const messages = {
    "auth/email-already-in-use": "Diese E-Mail-Adresse wird bereits verwendet.",
    "auth/invalid-email": "Diese E-Mail-Adresse ist ungültig.",
    "auth/weak-password": "Das Passwort ist zu schwach (mind. 6 Zeichen).",
    "custom/short-password": "Das temporäre Passwort muss mindestens 6 Zeichen haben.",
  };
  return messages[err.code] || "Speichern fehlgeschlagen. Bitte erneut versuchen.";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
