/* =================================================================
   Dashboard — role-aware:
     - Submitter: "My applications" list, "New application" button,
       clicking a row opens the analysis view (/app) — same destination
       as the reviewer, the page renders role-aware read-only states
       for non-draft submitter views.
     - Reviewer: queue of every application, "New application" hidden,
       clicking a row opens the full review view (/app).
   Same table + stats shell for both; copy branches on role, routing
   does not.
   ================================================================= */
(function () {
  "use strict";

  const session = window.SAAuth && window.SAAuth.requireAuth("/login");
  if (!session) return;

  const ROLE = session.role;   // "submitter" | "reviewer"
  const IS_SUBMITTER = ROLE === "submitter";
  const IS_REVIEWER  = ROLE === "reviewer";

  const APP_TYPE_LABELS = {
    initial_consultation: "الاستشارة (موافقة مبدئية)",
    technical_consultation: "استشارة فنية",
    permit_vacant_land: "ترخيص مقترح على ارض خالية",
    permit_over_existing: "ترخيص مقترح فوق قائم",
    amended_plan_permit: "ترخيص مخطط تعديلي",
    permit_cancellation: "الغاء ترخيص مقترح",
    occupancy_permit: "اذن اشغال",
    occupancy_renewal: "تجديد اذن اشغال",
    occupancy_doc_correction: "تصحيح وثيقة اذن الاشغال",
    occupancy_renewal_doc_correction: "تصحيح وثيقة تجديد اذن الاشغال",
    additions_permit: "ترخيص زيادات",
    additions_permit_with_occupancy: "ترخيص زيادات + أذن اشغال",
    existing_areas_permit_with_occupancy: "ترخيص مساحات قائمة و إذن اشغال",
    first_time_existing_building: "بناء قائم لأول مرة",
    deposit_forfeiture: "مصادرة تأمينات",
    central_committee_review: "اعادة النظر بقرار لجنة التخطيط المركزية (اللوائية)",
    other: "أخرى",
  };

  const APP_STATUS_LABELS = {
    draft: "مسودة قبل الإرسال",
    pending: "قيد المراجعة",
    needs_revision: "بحاجة تعديل",
    approved: "تمت الموافقة",
    rejected: "مرفوض",
  };

  // ---- State
  let ALL_APPS = [];
  let filterStatus = "all";
  let filterType = "all";
  let filterQuery = "";

  // ---- DOM
  const $ = (id) => document.getElementById(id);
  const elTbody = $("app-tbody");
  const elEmpty = $("app-empty");
  const elCount = $("list-count");
  const elSearch = $("list-search-input");
  const elTypeFilter = $("list-type-filter");
  const filterBtns = Array.from(document.querySelectorAll("[data-filter-status]"));

  // ---- Role-aware topbar + heading
  (function initChrome() {
    const nameEl = $("user-name");
    const avatarEl = $("user-avatar");
    const display = session.display_name || session.username || "user";
    if (nameEl) nameEl.textContent = display;
    if (avatarEl) avatarEl.textContent = (display[0] || "U").toUpperCase();

    const roleChip = $("dash-role-chip");
    if (roleChip) {
      roleChip.hidden = false;
      roleChip.textContent = IS_REVIEWER ? "مراجع" : "مقدّم طلب";
    }

    // "New application" button + nav link — submitter-only
    const newBtn = $("dash-new-btn");
    const newLink = $("dash-new-link");
    if (newBtn)  newBtn.hidden  = !IS_SUBMITTER;
    if (newLink) newLink.hidden = !IS_SUBMITTER;

    // "Overview" (manager dashboard) link — reviewer-only
    const overviewLink = $("dash-overview-link");
    if (overviewLink) overviewLink.hidden = !IS_REVIEWER;

    // Page title + subtitle
    const titleEl = $("dash-heading-title");
    const subEl = $("dash-heading-sub");
    if (titleEl) titleEl.textContent = IS_SUBMITTER ? "طلباتي" : "طلبات للمراجعة";
    if (subEl)   subEl.textContent   = IS_SUBMITTER
      ? "طلباتك المقدّمة وحالة المراجعة الحالية."
      : "طلبات الترخيص في انتظار قرارك، بالإضافة إلى الأرشيف.";

    const logoutBtn = $("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        window.SAAuth.clearSession();
        window.location.assign("/login");
      });
    }
  })();

  // ---- Filter controls
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("list-filter-btn--active"));
      btn.classList.add("list-filter-btn--active");
      filterStatus = btn.getAttribute("data-filter-status") || "all";
      render();
    });
  });
  if (elTypeFilter) {
    elTypeFilter.addEventListener("change", () => {
      filterType = elTypeFilter.value || "all";
      render();
    });
  }
  if (elSearch) {
    elSearch.addEventListener("input", () => {
      filterQuery = (elSearch.value || "").trim().toLowerCase();
      render();
    });
  }

  // ---- Fetch analyses (server already filters to what this role can see)
  async function load() {
    const errBox = document.getElementById("app-load-error");
    const errText = document.getElementById("app-load-error-text");
    try {
      const res = await fetch("/api/analyses", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      ALL_APPS = Array.isArray(data.items) ? data.items : [];
      // Clear any prior error banner now that we have fresh data.
      if (errBox) errBox.hidden = true;
    } catch (err) {
      console.error("load analyses", err);
      // Surface the error so the user knows the list isn't fresh — silent
      // failure was the original gap. Existing data (ALL_APPS) is left
      // intact so a transient blip doesn't blank the table.
      if (errBox && errText) {
        errText.textContent = "تعذّر تحميل القائمة — " + ((err && err.message) || "خطأ في الشبكة");
        errBox.hidden = false;
      }
    }
    updateStats();
    render();
  }

  // Wire the retry button. Single delegated listener so HTML changes
  // (re-rendering the banner) don't drop the binding.
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest && ev.target.closest("#app-load-retry");
    if (!btn) return;
    btn.disabled = true;
    load().finally(() => { btn.disabled = false; });
  });

  // ---- Stats (now includes needs_revision)
  function updateStats() {
    const counts = {
      total: ALL_APPS.length,
      pending: 0,
      needs_revision: 0,
      approved: 0,
      rejected: 0,
    };
    for (const a of ALL_APPS) {
      const s = a.review_status || "pending";
      if (counts[s] != null) counts[s]++;
    }

    $("stat-total").textContent = counts.total;
    $("stat-pending").textContent = counts.pending;
    if ($("stat-needs-revision")) $("stat-needs-revision").textContent = counts.needs_revision;
    $("stat-approved").textContent = counts.approved;
    $("stat-rejected").textContent = counts.rejected;

    const hint = $("stat-total-hint");
    if (hint) hint.textContent = counts.total === 0 ? "لا توجد طلبات بعد" : `${counts.total} عبر جميع الحالات`;
    $("stat-pending-hint").textContent = counts.pending === 1 ? "طلب واحد قيد المراجعة" : `${counts.pending} قيد المراجعة`;
    if ($("stat-needs-revision-hint")) {
      $("stat-needs-revision-hint").textContent = counts.needs_revision === 1
        ? "طلب واحد بحاجة إلى تعديل" : `${counts.needs_revision} بحاجة إلى تعديل`;
    }
    $("stat-approved-hint").textContent = counts.approved === 1 ? "تمت الموافقة على طلب واحد" : `${counts.approved} تمت الموافقة`;
    $("stat-rejected-hint").textContent = counts.rejected === 1 ? "تم رفض طلب واحد" : `${counts.rejected} مرفوضة`;
  }

  // ---- Filter + sort
  function filtered() {
    return ALL_APPS.filter((a) => {
      if (filterStatus !== "all" && (a.review_status || "pending") !== filterStatus) return false;
      if (filterType !== "all" && (a.application_type || "other") !== filterType) return false;
      if (filterQuery) {
        const hay = [
          a.filename, a.owner, a.basin_name, a.village_name, a.plot_number,
          a.submitted_by, a.submitted_by_display, a.id,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(filterQuery)) return false;
      }
      return true;
    });
  }

  // ---- Helpers
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return "الآن";
      if (diff < 3600) return "منذ " + Math.floor(diff / 60) + " دقيقة";
      if (diff < 86400) return "منذ " + Math.floor(diff / 3600) + " ساعة";
      if (diff < 7 * 86400) return "منذ " + Math.floor(diff / 86400) + " يوم";
      return d.toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" });
    } catch { return iso; }
  }

  // Application display name. Prefers the parcel identity (plot # +
  // village/basin) extracted from the title-deed PDF — that's the
  // human-meaningful identifier ("قطعة 2014 · بدران"). Falls back to a
  // cleaned filename only when the PDF wasn't parsed yet, and finally to
  // the file id stub. The DWG filename is still surfaced as a small
  // muted line beneath the name so the engineer can match the row to a
  // local file.
  function prettyAppName(a) {
    if (!a) return "—";
    const plot = a.plot_number ? "قطعة " + a.plot_number : "";
    const place = a.village_name || a.basin_name || (a.basin_number ? "حوض " + a.basin_number : "");
    if (plot && place) return `${plot} · ${place}`;
    if (plot) return plot;
    if (place) return place;
    const base = a.filename || a.id || "";
    if (base === "(no CAD)") return "طلب بملفات PDF فقط";
    return String(base).replace(/\.(dwg|dxf|dwf|dwfx)$/i, "") || "—";
  }

  // Subtitle under the application name — the source CAD filename, so
  // the engineer can match the row to a file on disk. Empty when the
  // application has no CAD file (PDF-only submissions).
  function appSubtitle(a) {
    if (!a) return "";
    const fn = a.filename || a.cad_filename || "";
    if (!fn || fn === "(no CAD)") return "";
    return String(fn).replace(/\.(dwg|dxf|dwf|dwfx)$/i, "");
  }

  // Both roles land on /app for the per-application view. The page
  // renders role-aware read-only states for submitter views of
  // pending / needs-revision / approved / rejected applications, so
  // there's no separate submitter detail page anymore.
  function detailUrl(a) {
    return `/app?a=${encodeURIComponent(a.id)}`;
  }

  function openLabel(a) {
    if (!IS_SUBMITTER) return "فتح";
    if (a && a.review_status === "draft") return "متابعة المسودة";
    return "عرض";
  }

  // ---- Render list
  function render() {
    const rows = filtered();
    elCount.textContent = rows.length === 1 ? "طلب واحد" : rows.length + " طلب";

    if (ALL_APPS.length === 0) {
      elTbody.innerHTML = "";
      elEmpty.hidden = false;
      return;
    }
    elEmpty.hidden = true;

    if (rows.length === 0) {
      elTbody.innerHTML = `
        <tr><td colspan="7" class="app-cell-muted" style="text-align:center; padding:32px;">
          لا توجد طلبات مطابقة للمرشحات الحالية.
        </td></tr>`;
      return;
    }

    elTbody.innerHTML = rows.map((a) => {
      const t = APP_TYPE_LABELS[a.application_type] ? a.application_type : "other";
      const s = APP_STATUS_LABELS[a.review_status] ? a.review_status : "pending";
      // Property owner from the title-deed PDF; falls back to the submitter's
      // display name only when no deed was parsed (so the cell never shows "—"
      // for an application that has at least one human attached to it).
      const owner = a.owner || a.submitted_by_display || a.submitted_by || "—";
      const created = formatDate(a.created_at);
      const url = detailUrl(a);
      const subtitle = appSubtitle(a);

      // Pipeline-level status: a just-submitted app has data.status = "running"
      // (stub record) and stays that way until _save_analysis overwrites with
      // status = "done". Show a distinct "قيد التحليل" chip and lock the row
      // from opening in either role's detail view.
      const isAnalyzing = (a.status === "running");
      const rowClass = isAnalyzing ? "app-row-locked" : "app-row-clickable";
      // Warning chip — added next to the status badge when the submitter
      // chose to send their application despite AI-flagged issues. Visible
      // to both reviewer and submitter so neither side is surprised.
      const knownIssuesBadge = a.submitted_with_known_issues
        ? `<span class="app-badge app-badge--known-issues" title="أُرسل الطلب مع ملاحظات معروفة من النظام الذكي — قد يتأخر القرار">
             <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L1 14h14L8 2z"/><path d="M8 7v3M8 12h.01"/></svg>
             <span>مع ملاحظات</span>
           </span>`
        : "";
      const statusBadgeHtml = isAnalyzing
        ? `<span class="app-badge app-badge--status-analyzing">
             <span class="spinner spinner--tiny" aria-hidden="true"></span>
             <span>قيد التحليل</span>
           </span>`
        : `<span class="app-badge-stack">
             <span class="app-badge app-badge--status-${escapeHtml(s)}">
               <span class="app-badge-dot"></span>${escapeHtml(APP_STATUS_LABELS[s] || s)}
             </span>
             ${knownIssuesBadge}
           </span>`;
      const openHtml = isAnalyzing
        ? `<span class="app-open-btn app-open-btn--disabled" title="سيصبح متاحًا بعد اكتمال التحليل">
             <span>قيد التحليل…</span>
           </span>`
        : `<a href="${url}" class="app-open-btn" onclick="event.stopPropagation()">
             <span>${escapeHtml(openLabel(a))}</span>
             <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3l3 3-3 3"/></svg>
           </a>`;

      // Total estimated fines = setback + building-area + floor-coverage,
      // computed server-side in main.py:_total_estimated_fine_jd so it
      // matches the "إجمالي الغرامات التقديرية" tile inside the application.
      // Falls back to the older setback-only field for archived analyses
      // saved before the aggregate landed.
      const fine = (typeof a.total_estimated_fine_jd === "number")
        ? a.total_estimated_fine_jd
        : a.compliance_fine_jd;
      const fineHtml =
        typeof fine === "number" && fine > 0
          ? `<span class="app-fine-value">${Math.round(fine).toLocaleString("en-US")} د.أ</span>`
          : `<span class="app-cell-muted">—</span>`;

      // Subtitle slot under the application name — used to surface the
      // CAD filename when one exists, so engineers can still match a row
      // to a local file even though "filename" is no longer a column.
      const subtitleHtml = subtitle
        ? `<span class="app-cell-app-id" dir="auto">${escapeHtml(subtitle)}</span>`
        : "";
      return `
        <tr class="${rowClass}" data-id="${escapeHtml(a.id)}" data-status="${escapeHtml(a.status || "")}"${isAnalyzing ? ' title="سيصبح متاحًا بعد اكتمال التحليل"' : ""}>
          <td>
            <div class="app-cell-app">
              <span class="app-cell-app-name">${escapeHtml(prettyAppName(a))}</span>
              ${subtitleHtml}
            </div>
          </td>
          <td>
            <span class="app-badge app-badge--type-${escapeHtml(t)}">
              <span class="app-badge-dot"></span>${escapeHtml(APP_TYPE_LABELS[t] || t)}
            </span>
          </td>
          <td><span dir="auto">${escapeHtml(owner)}</span></td>
          <td>${statusBadgeHtml}</td>
          <td><span class="app-cell-muted">${escapeHtml(created)}</span></td>
          <td>${fineHtml}</td>
          <td>${openHtml}</td>
        </tr>
      `;
    }).join("");

    Array.from(elTbody.querySelectorAll("tr.app-row-clickable")).forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-id");
        if (id) window.location.assign(detailUrl({ id }));
      });
    });
  }

  load();

  /* ============================================================
     Post-submit landing — the submit handler in app.js redirects here
     with ?submitted=<analysis_id>. Thanks to the stub save at intake,
     the row is ALREADY in the list as status=running ("قيد التحليل")
     when the page first renders. We just poll that specific id until
     its status flips to "done" / "error", then flip the toast green
     and re-render so the KPIs + status chip update in place.
     ============================================================ */
  (function initSubmittedFlow() {
    if (!IS_SUBMITTER) return;
    const url = new URL(window.location.href);
    const submittedParam = url.searchParams.get("submitted");
    if (!submittedParam) return;
    // Drop the query string so a reload doesn't re-trigger the toast.
    url.searchParams.delete("submitted");
    window.history.replaceState({}, "", url.pathname + url.search);

    const toast = document.createElement("div");
    toast.className = "dash-submitted-toast";
    toast.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="10" cy="10" r="8" />
        <path d="M10 6v4l2.5 1.5" />
      </svg>
      <div class="dash-submitted-text">
        <strong>تم استلام طلبك بنجاح.</strong>
        <span>يتم تحليل المستندات الآن — سيُفتح الطلب للعرض فور اكتمال التحليل.</span>
      </div>`;
    const main = document.querySelector(".dash-main");
    if (main) main.insertBefore(toast, main.firstChild);

    // `submitted=1` is a legacy fallback (no specific id). Bail out after
    // showing the toast — we can't target a specific row.
    if (submittedParam === "1") return;

    const targetId = submittedParam;
    const started = Date.now();
    const POLL_MS = 4000;
    const TIMEOUT_MS = 180000;  // 3 minutes

    let consecutiveFailures = 0;
    const errBox = document.getElementById("app-load-error");
    const errText = document.getElementById("app-load-error-text");
    const timer = setInterval(async () => {
      if (Date.now() - started > TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await fetch("/api/analyses", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const match = items.find((it) => it.id === targetId);
        // Successful tick — clear any "polling failed" indicator we may
        // have shown on a previous failure.
        consecutiveFailures = 0;
        if (errBox) errBox.hidden = true;
        if (!match) return;  // still writing — next tick

        // Always refresh the list so status chips / KPIs update in place
        // while the user watches.
        ALL_APPS = items;
        updateStats();
        render();

        if (match.status === "done" || match.status === "error") {
          clearInterval(timer);
          const ok = match.status === "done";
          toast.classList.add(ok ? "dash-submitted-toast--done" : "dash-submitted-toast--err");
          toast.querySelector(".dash-submitted-text strong").textContent = ok
            ? "اكتمل التحليل."
            : "تعذّر إتمام التحليل.";
          toast.querySelector(".dash-submitted-text span").textContent = ok
            ? "طلبك جاهز للاستعراض — اضغط على الصف لفتحه."
            : "يرجى التواصل مع الدعم أو إعادة المحاولة.";
          setTimeout(() => { toast.remove(); }, 6000);
        }
      } catch (err) {
        // Tolerate transient blips — but if every tick fails for a few
        // cycles in a row, surface the failure so the user knows the
        // page is stale instead of seeing it sit silently with old data.
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3 && errBox && errText) {
          errText.textContent = "تعذّر تحديث القائمة — جارٍ إعادة المحاولة";
          errBox.hidden = false;
        }
      }
    }, POLL_MS);
  })();
})();
