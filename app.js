import { requireSession, logout } from "./session.js";
import { initTeamTab } from "./team.js";
import { initSettingsTab } from "./settings.js";

let session = null;

async function start() {
  try {
    session = await requireSession();
  } catch (e) {
    return; // requireSession hat bereits umgeleitet
  }

  const { profile } = session;
  document.getElementById("user-name-label").textContent = profile.name || "";

  // Admin/Leitung-Tab je nach Rolle einblenden und beschriften
  if (profile.role === "admin" || profile.role === "leitung") {
    const adminBtn = document.getElementById("admin-nav-btn");
    adminBtn.style.display = "flex";
    document.getElementById("admin-nav-label").textContent =
      profile.role === "admin" ? "Admin" : "Leitung";
  }

  // Grundeinstellungen sind nur für Admin sichtbar (nicht Leitung)
  if (profile.role !== "admin") {
    const card = document.getElementById("grundeinstellungen-card");
    if (card) card.style.display = "none";
  }

  setupBottomNav();
  setupAdminSubtabs();

  document.getElementById("logout-btn").addEventListener("click", logout);

  // Tab-Module initialisieren (laden erst Daten, wenn Admin-Bereich sichtbar wird)
  if (profile.role === "admin" || profile.role === "leitung") {
    initTeamTab(session);
    initSettingsTab(session);
  }
}

function setupBottomNav() {
  const buttons = document.querySelectorAll("#bottom-nav button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });
}

function setupAdminSubtabs() {
  const buttons = document.querySelectorAll("#admin-subtabs button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".subpanel").forEach((p) => p.classList.remove("active"));
      document.getElementById("sub-" + btn.dataset.sub).classList.add("active");
    });
  });
}

start();
