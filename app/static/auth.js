/* Real-server auth — replaces the earlier localStorage-only gate.
   Posts credentials to /api/auth/login, stores the returned token, and
   attaches it as `Authorization: Bearer <token>` to every fetch. Role
   information (submitter vs reviewer) travels with the session so the
   frontend can branch the dashboard, upload, and detail views.           */
(function () {
  "use strict";

  const TOKEN_KEY = "sa_session";
  const USER_KEY = "sa_user";

  function readSession() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.token || !parsed.role) return null;
      return parsed;
    } catch { return null; }
  }

  function writeSession(payload) {
    const data = {
      token: String(payload.token),
      username: String(payload.username),
      role: String(payload.role),
      display_name: String(payload.display_name || payload.username),
      signed_in_at: new Date().toISOString(),
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
    localStorage.setItem(USER_KEY, data.username);
    return data;
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function requireAuth(redirect) {
    const s = readSession();
    if (!s) {
      window.location.replace(redirect || "/login");
      return null;
    }
    return s;
  }

  function redirectIfAuthed(target) {
    const s = readSession();
    if (s) window.location.replace(target || "/dashboard");
  }

  /* ------------------------------------------------------------------
     Global fetch interceptor: attach `Authorization: Bearer <token>`
     to every request to our own API. This runs as soon as auth.js is
     loaded so downstream scripts (app.js, dashboard.js, reviewer.js)
     never have to think about the header.

     Also handles 401 responses globally — if the stored token is
     rejected (user removed from users.json, role changed, server
     restart in a never-expiring demo isn't a concern, but still), we
     clear the session and bounce to /login.
     ------------------------------------------------------------------ */
  const origFetch = window.fetch.bind(window);
  window.fetch = function authedFetch(input, init) {
    const s = readSession();
    const headers = new Headers((init && init.headers) || (typeof input !== "string" ? input.headers : null) || {});
    if (s && s.token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + s.token);
    }
    const newInit = Object.assign({}, init || {}, { headers });
    return origFetch(input, newInit).then((res) => {
      if (res.status === 401) {
        // Token rejected — wipe and send to login unless we're already there.
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (!/\/api\/auth\/login/.test(url)) {
          clearSession();
          if (!/\/login/.test(window.location.pathname)) {
            window.location.replace("/login");
          }
        }
      }
      return res;
    });
  };

  // Expose
  window.SAAuth = {
    TOKEN_KEY,
    USER_KEY,
    readSession,
    writeSession,
    clearSession,
    requireAuth,
    redirectIfAuthed,
  };

  // Bind the login form
  function bindLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;
    redirectIfAuthed("/dashboard");

    const errorEl = document.getElementById("login-error");
    function showError(msg) {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
      }
    }
    function hideError() { if (errorEl) errorEl.hidden = true; }

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      hideError();
      const u = document.getElementById("login-username");
      const p = document.getElementById("login-password");
      const username = (u && u.value || "").trim();
      const password = (p && p.value) || "";
      if (!username || !password) {
        showError("Enter username and password");
        return;
      }
      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          let detail = "Invalid username or password";
          try {
            const body = await res.json();
            if (body && body.detail) detail = String(body.detail);
          } catch {}
          showError(detail);
          return;
        }
        const body = await res.json();
        writeSession({
          token: body.token,
          username: body.user.username,
          role: body.user.role,
          display_name: body.user.display_name,
        });
        window.location.assign("/dashboard");
      } catch (err) {
        showError("Login failed: " + (err && err.message || err));
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLoginForm);
  } else {
    bindLoginForm();
  }
})();
