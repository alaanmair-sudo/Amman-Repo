/* Users page — table + recent activity from mock constants */
(function () {
  "use strict";
  if (!window.SASession) return;
  const $ = (id) => document.getElementById(id);

  const USERS = [
    { name: "إيمان الزعبي",      email: "iman.zoubi@amman.jo",        role: "reviewer",   reviews: 187, avgDays: 2.8, lastSeen: "الآن",        status: "active",  online: true,  bg: "#2563eb" },
    { name: "خالد الفايز",       email: "khalid.fayez@amman.jo",      role: "reviewer",   reviews: 164, avgDays: 3.4, lastSeen: "قبل ٤ دقائق", status: "active",  online: true,  bg: "#0891b2" },
    { name: "ميسون عبيدات",      email: "maysoun.o@amman.jo",         role: "supervisor", reviews: 152, avgDays: 3.1, lastSeen: "قبل ١٢ دقيقة", status: "active",  online: true,  bg: "#7c3aed" },
    { name: "زيد العواملة",      email: "zaid.aw@amman.jo",           role: "reviewer",   reviews: 138, avgDays: 4.2, lastSeen: "قبل ٢٢ دقيقة", status: "active",  online: false, bg: "#0d9488" },
    { name: "ندى الكساسبة",      email: "nada.k@amman.jo",            role: "admin",      reviews: 124, avgDays: 2.5, lastSeen: "قبل ٤٠ دقيقة", status: "active",  online: true,  bg: "#b91c1c" },
    { name: "طارق الدلاعة",      email: "tareq.d@amman.jo",           role: "admin",      reviews: 98,  avgDays: 2.1, lastSeen: "قبل ساعة",     status: "active",  online: false, bg: "#9d174d" },
    { name: "علاء النمير",        email: "alaa.n@amman.jo",            role: "consultant", reviews: 0,   avgDays: 0.0, lastSeen: "أمس",          status: "active",  online: false, bg: "#d97706" },
    { name: "عمر الحياري",       email: "omar.h@amman.jo",            role: "reviewer",   reviews: 87,  avgDays: 3.7, lastSeen: "قبل يومين",   status: "suspended", online: false, bg: "#475569" },
    { name: "أحمد القضاة",       email: "ahmad.q@external.jo",        role: "submitter",  reviews: 0,   avgDays: 0.0, lastSeen: "اليوم ١٢:٠٠", status: "active",  online: false, bg: "#059669" },
    { name: "ليلى خليل",         email: "laila.k@external.jo",        role: "submitter",  reviews: 0,   avgDays: 0.0, lastSeen: "اليوم ٠٩:٢٠", status: "active",  online: false, bg: "#10b981" },
    { name: "محمد إبراهيم",      email: "m.ibrahim@external.jo",      role: "submitter",  reviews: 0,   avgDays: 0.0, lastSeen: "أمس",          status: "active",  online: false, bg: "#0e7490" },
    { name: "(دعوة معلّقة)",      email: "h.malkawi@amman.jo",         role: "reviewer",   reviews: 0,   avgDays: 0.0, lastSeen: "—",            status: "invited", online: false, bg: "#94a3b8" },
  ];

  const ROLE_LABEL = {
    reviewer:   { lbl: "مراجع",   cls: "us-role-reviewer" },
    supervisor: { lbl: "مشرف",    cls: "us-role-supervisor" },
    admin:      { lbl: "مدير",    cls: "us-role-admin" },
    consultant: { lbl: "مستشار",  cls: "us-role-consultant" },
    submitter:  { lbl: "مقدّم",    cls: "us-role-submitter" },
  };

  const STATUS_LABEL = {
    active:    { lbl: "نشط",      cls: "ov-status-pill--ok" },
    suspended: { lbl: "معلّق",     cls: "ov-status-pill--err" },
    invited:   { lbl: "دعوة",     cls: "ov-status-pill--warn" },
  };

  const RECENT = [
    { initials: "ن.ك", bg: "#b91c1c", html: "<strong>ندى الكساسبة</strong> أضافت مستخدمًا جديدًا · هاني ملكاوي", time: "منذ ٣ دقائق" },
    { initials: "م.ع", bg: "#7c3aed", html: "<strong>ميسون عبيدات</strong> غيّرت دور مستخدم من مراجع إلى مشرف", time: "منذ ٢٠ دقيقة" },
    { initials: "ط.د", bg: "#9d174d", html: "<strong>طارق الدلاعة</strong> سجّل دخوله من جهاز جديد", time: "منذ ساعة" },
    { initials: "ع.ن", bg: "#d97706", html: "<strong>علاء النمير</strong> قبل دعوة الانضمام كمستشار خارجي", time: "أمس" },
    { initials: "ع.ح", bg: "#475569", html: "<strong>المدير</strong> علّق حساب: عمر الحياري", time: "أمس" },
    { initials: "ن.ك", bg: "#b91c1c", html: "<strong>ندى الكساسبة</strong> فعّلت المصادقة الثنائية لجميع المراجعين", time: "قبل يومين" },
  ];

  function avatarInitials(name) {
    const parts = name.replace(/[()]/g, "").trim().split(/\s+/);
    return ((parts[0] || "")[0] || "") + ((parts[1] || "")[0] || "");
  }

  function renderTable() {
    const tbody = document.querySelector("#us-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    USERS.forEach((u) => {
      const r = ROLE_LABEL[u.role] || { lbl: u.role, cls: "" };
      const s = STATUS_LABEL[u.status] || { lbl: u.status, cls: "" };
      const onlineDot = u.online
        ? `<span class="ov-build-dot" style="display:inline-block; vertical-align:middle; margin-inline-start:6px;"></span>`
        : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="us-user">
            <div class="us-avatar" style="background:${u.bg}">${avatarInitials(u.name)}</div>
            <div>
              <div class="us-name">${u.name}${onlineDot}</div>
              <div class="us-email">${u.email}</div>
            </div>
          </div>
        </td>
        <td><span class="us-role-pill ${r.cls}">${r.lbl}</span></td>
        <td class="ov-num">${u.reviews ? u.reviews.toLocaleString("ar-EG") : "—"}</td>
        <td>${u.avgDays ? u.avgDays.toLocaleString("ar-EG") + " يوم" : "—"}</td>
        <td>${u.lastSeen}</td>
        <td><span class="ov-status-pill ${s.cls}">${s.lbl}</span></td>
        <td>
          <button class="us-action-btn" type="button" title="إجراءات">
            <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderRecent() {
    const root = $("us-recent");
    if (!root) return;
    root.innerHTML = "";
    RECENT.forEach((r) => {
      const div = document.createElement("div");
      div.className = "us-recent-row";
      div.innerHTML = `
        <div class="us-avatar" style="background:${r.bg}">${r.initials}</div>
        <div class="us-recent-text">${r.html}</div>
        <div class="us-recent-time">${r.time}</div>
      `;
      root.appendChild(div);
    });
  }

  function boot() { renderTable(); renderRecent(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
