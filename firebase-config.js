// Firebase-Konfiguration für Marmotte Zeiterfassung
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyASYr0_6uHpBSYb6E7hLO-pqsySPSC9Wmk",
  authDomain: "marmotte-zeiterfassung.firebaseapp.com",
  projectId: "marmotte-zeiterfassung",
  storageBucket: "marmotte-zeiterfassung.firebasestorage.app",
  messagingSenderId: "214685195694",
  appId: "1:214685195694:web:a2cf2d9b0ec2330bdefc3f",
  measurementId: "G-84XYYD97E5"
};

// Firebase initialisieren
const app = initializeApp(firebaseConfig);

// Auth und Firestore exportieren, damit andere Dateien sie nutzen können
export const auth = getAuth(app);
export const db = getFirestore(app);
