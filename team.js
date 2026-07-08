import { db } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDocs, setDoc, updateDoc, query, orderBy
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

export function initTeamTab(session) {
  const listEl = document.getElementById("employee-list");
  const fab = document.getElementById("add-employee-fab");
  const modal = document.getElementById("employee-modal");
  const form = document.getElementById("employee-form");
  const cancelBtn = document.getElementById("employee-cancel-btn");
  const errorEl = document.getElementById("employee-error");
  const modalTitle = document.getElementById("employee-modal-title");
  const emailField = document.getElementById("emp-email");
  const passwordField = document.getElementById("emp-password-field");

  loadEmployees();

  fab.addEventListener("click", () => openModal(null));
  cancelBtn.addEventListener("click", closeModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const saveBtn = document.getElementById("employee-save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Speichert …";

    const data = {
      name: document.getElementById("emp-name").value.trim(),
      personalnummer: document.getElementById("emp-personalnummer").value.trim(),
      abteilung: document.getElementById("emp-abteilung").value,
      email: emailField.value.trim(),
      anstellungsart: document.getElementById("emp-anstellungsart").value,
      role: document.getElementById("emp-rolle").value,
      stellenprozent: Number(document.getElementById("emp-stellenprozent").value),
      arbeitstageProWoche: Number(document.getElementById("emp-arbeitstage").value),
      anstellungsdatum: document.getElementById("emp-anstellungsdatum").value,
    };

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
      closeModal();
      loadEmployees();
    } catch (err) {
      console.error(err);
      errorEl.textContent = mapError(err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Speichern";
    }
  });

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
      const item = document.createElement("div");
      item.className = "employee-item";
      item.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(u.name || "(ohne Name)")}</div>
          <div class="meta">${escapeHtml(u.abteilung || "–")} · ${escapeHtml(u.personalnummer || "–")}</div>
        </div>
        <span class="badge role-${u.role || "mitarbeiter"}">${roleLabels[u.role] || u.role || ""}</span>
      `;
      item.addEventListener("click", () => openModal(docSnap.id, u));
      listEl.appendChild(item);
    });
  }

  function openModal(uid, data) {
    editingUid = uid;
    errorEl.textContent = "";
    form.reset();

    if (uid) {
      modalTitle.textContent = "Mitarbeiter bearbeiten";
      document.getElementById("emp-name").value = data.name || "";
      document.getElementById("emp-personalnummer").value = data.personalnummer || "";
      document.getElementById("emp-abteilung").value = data.abteilung || "Bäckerei";
      emailField.value = data.email || "";
      emailField.disabled = true;
      passwordField.style.display = "none";
      document.getElementById("emp-anstellungsart").value = data.anstellungsart || "festangestellt";
      document.getElementById("emp-rolle").value = data.role || "mitarbeiter";
      document.getElementById("emp-stellenprozent").value = data.stellenprozent || 100;
      document.getElementById("emp-arbeitstage").value = data.arbeitstageProWoche || 5;
      document.getElementById("emp-anstellungsdatum").value = data.anstellungsdatum || "";
    } else {
      modalTitle.textContent = "Mitarbeiter anlegen";
      emailField.disabled = false;
      passwordField.style.display = "flex";
    }

    modal.classList.add("active");
  }

  function closeModal() {
    modal.classList.remove("active");
    editingUid = null;
  }
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
