/* =================================================================
   Shared shell — runs on every reviewer-only management page
   (overview, reports, timeline, maps, users, settings).
   Handles:
     - Auth gate (reviewer-only — submitters bounce to /dashboard)
     - Topbar wiring: user name, avatar initial, role chip, logout
     - Sidebar collapse toggle (with localStorage persistence)
   Each page also loads its own *.js for page-specific rendering.
   ================================================================= */
(function () {
  "use strict";

  // ----- Auth: reviewer-only -----
  const session = window.SAAuth && window.SAAuth.requireAuth("/login");
  if (!session) return;
  if (session.role !== "reviewer") {
    window.location.replace("/dashboard");
    return;
  }
  // Expose the verified session so page scripts don't have to re-check.
  window.SASession = session;

  const $ = (id) => document.getElementById(id);

  // ----- Topbar wiring -----
  function initTopbar() {
    const display = session.display_name || session.username || "reviewer";
    const nameEl = $("user-name");
    const avatarEl = $("user-avatar");
    if (nameEl) nameEl.textContent = display;
    if (avatarEl) avatarEl.textContent = (display[0] || "R").toUpperCase();

    const roleChip = $("dash-role-chip");
    if (roleChip) {
      roleChip.hidden = false;
      roleChip.textContent = "مراجع";
    }

    const logoutBtn = $("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        if (window.SAAuth) window.SAAuth.clearSession();
        window.location.replace("/login");
      });
    }
  }

  // ----- Sidebar collapse toggle (persisted) -----
  function initSidebarToggle() {
    const KEY = "ov_sidebar_collapsed";
    const sidebar = document.getElementById("ov-sidebar");
    const layout  = document.querySelector(".ov-layout");
    const toggle  = document.getElementById("ov-side-toggle");
    if (!sidebar || !layout || !toggle) return;

    function apply(collapsed) {
      sidebar.classList.toggle("ov-sidebar--collapsed", collapsed);
      layout.classList.toggle("ov-layout--collapsed",   collapsed);
      toggle.setAttribute("aria-label", collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية");
      toggle.title = collapsed ? "توسيع" : "طي";
    }

    apply(localStorage.getItem(KEY) === "true");

    toggle.addEventListener("click", () => {
      const next = !sidebar.classList.contains("ov-sidebar--collapsed");
      apply(next);
      try { localStorage.setItem(KEY, String(next)); } catch {}
    });
  }

  function boot() {
    initTopbar();
    initSidebarToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
