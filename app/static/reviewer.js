/* =================================================================
   Reviewer layer — glued on top of app.js
   - Gates the page behind a session
   - Wires the top-bar Dashboard / user / logout affordances
   - Injects the `meta_json` form field into the upload POST
   - Populates the reviewer summary banner as the three pipelines stream
   - Persists approve/reject on the banner
   - If ?a=<analysis_id> is in the URL, auto-loads that saved analysis
   ================================================================= */
(function () {
  "use strict";

  // --- Session gate ---------------------------------------------------------
  const session = window.SAAuth && window.SAAuth.requireAuth("/login");
  if (!session) return;
  const ROLE = session.role || "reviewer";
  const IS_SUBMITTER = ROLE === "submitter";

  // Fill user chip + logout wiring in the side nav. The IDs are
  // historically `topbar-*` because this used to live in the topbar; now
  // the same widgets sit in the sidebar footer but the IDs are kept so
  // the JS doesn't have to fork.
  (function initShellChrome() {
    const name = (session.display_name || session.username || "reviewer").trim();
    const nameEl = document.getElementById("topbar-user-name");
    const avatarEl = document.getElementById("topbar-user-avatar");
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = (name[0] || "R").toUpperCase();
    const roleChip = document.getElementById("topbar-role-chip");
    if (roleChip) {
      roleChip.hidden = false;
      roleChip.textContent = IS_SUBMITTER ? "مقدّم طلب" : "مراجع";
    }
    const logoutBtn = document.getElementById("topbar-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        window.SAAuth.clearSession();
        window.location.assign("/login");
      });
    }
    // "طلب جديد" pill in the side nav is submitter-only, mirroring
    // the same rule in dashboard.js. Reviewers don't create new
    // applications so the link stays hidden for them.
    const newLink = document.getElementById("dash-new-link");
    if (newLink) newLink.hidden = !IS_SUBMITTER;
    // "نظرة عامة" (manager dashboard) is reviewer-only — gives the
    // reviewer a one-click escape from the per-application view back
    // to the cross-portfolio dashboard.
    const overviewLink = document.getElementById("dash-overview-link");
    if (overviewLink) overviewLink.hidden = IS_SUBMITTER;
    // Whole sidebar sections that are reviewer-only (analytics, admin).
    // Submitters never see these.
    document.querySelectorAll("[data-reviewer-only]").forEach((el) => {
      el.hidden = IS_SUBMITTER;
    });
  })();

  // Sidebar collapse toggle — same shape and same localStorage key as
  // shell.js / dashboard.js so the collapsed state persists across all
  // pages of the app.
  (function initSidebarToggle() {
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
  })();

  // Role-aware footer visibility on the issues panel. The panel itself
  // stays in the DOM for both roles; only the footer (action buttons +
  // freeform-note textarea) flips. The render function in app.js also
  // sets these — this is a belt-and-suspenders gate that runs early
  // so an unauthorized button can never flash visible during the
  // brief window before the first render.
  (function gateActionFooters() {
    const reviewerFooter = document.getElementById("ip-actions-reviewer");
    const submitterFooter = document.getElementById("ip-actions-submitter");
    if (IS_SUBMITTER) {
      if (reviewerFooter) reviewerFooter.hidden = true;
    } else {
      if (submitterFooter) submitterFooter.hidden = true;
    }
  })();

  // --- Banner state ---------------------------------------------------------
  // Labels go through the i18n layer in app.js so the banner speaks the
  // active language. We list the keys here and resolve them lazily so every
  // call picks up the current language.
  const TYPE_KEYS = {
    initial_consultation: "apptype.initial_consultation",
    technical_consultation: "apptype.technical_consultation",
    permit_vacant_land: "apptype.permit_vacant_land",
    permit_over_existing: "apptype.permit_over_existing",
    amended_plan_permit: "apptype.amended_plan_permit",
    permit_cancellation: "apptype.permit_cancellation",
    occupancy_permit: "apptype.occupancy_permit",
    occupancy_renewal: "apptype.occupancy_renewal",
    occupancy_doc_correction: "apptype.occupancy_doc_correction",
    occupancy_renewal_doc_correction: "apptype.occupancy_renewal_doc_correction",
    additions_permit: "apptype.additions_permit",
    additions_permit_with_occupancy: "apptype.additions_permit_with_occupancy",
    existing_areas_permit_with_occupancy: "apptype.existing_areas_permit_with_occupancy",
    first_time_existing_building: "apptype.first_time_existing_building",
    deposit_forfeiture: "apptype.deposit_forfeiture",
    central_committee_review: "apptype.central_committee_review",
    other: "apptype.other",
  };
  const STATUS_KEYS = {
    draft: "rb.status.draft",
    pending: "rb.status.pending",
    approved: "rb.status.approved",
    rejected: "rb.status.rejected",
    needs_revision: "rb.status.needs_revision",
  };
  function tr(key, fallback, vars) {
    try {
      if (typeof window.t === "function") return window.t(key, vars);
    } catch {}
    return fallback;
  }

  const banner = {
    applicationId: null,      // set from /?a=xxx or after upload completes
    applicationType: "initial_consultation",
    reviewStatus: "pending",
    submittedBy: "",
    // Data accumulated as pipelines stream
    lastCad: null,            // { coverage_pct, building_area, lot_area, summary }
    lastPdf: null,            // deed fields
    lastFloor: null,          // floor summary
    lastSitePlan: null,       // regulatory site-plan fields (max_floors, floor_ratio_pct, ...)
  };

  // --- DOM refs -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    banner: $("reviewer-banner"),
    typePill: $("rb-type-pill"),
    typeText: $("rb-type-text"),
    title: $("rb-title"),
    sub: $("rb-sub"),
    status: $("rb-status"),
    statusText: $("rb-status-text"),
    // Approve / Reject buttons live inside the issues panel now
    // (#ip-approve / #ip-reject); they're wired in app.js. No DOM
    // refs needed here.
    // Identity + Building tiles live in the banner but are populated by
    // app.js's aggregator (BANNER_IDENTITY_FIELDS / BANNER_BUILDING_FIELDS).
    // reviewer.js doesn't touch them directly — it only owns title, status,
    // CAD KPIs, setbacks, and the floor-plan KPIs.
    building: $("rb-building-area"),
    buildingAllowed: $("rb-building-area-allowed"),
    buildingStatus: $("rb-building-area-status"),
    buildingCard: $("rb-building-area-card"),
    buildingFine: $("rb-building-area-fine"),
    buildingTileLabel: $("rb-building-area-tile-label"),
    buildingActualSrc: $("rb-building-area-actual-src"),
    buildingAllowedSrc: $("rb-building-area-allowed-src"),
    lot: $("rb-lot-area"),
    lotDeed: $("rb-lot-area-deed"),
    lotStatus: $("rb-lot-area-status"),
    lotCard: $("rb-lot-area-card"),
    floorComputed: $("rb-floor-computed"),
    floorCoverageAllowed: $("rb-floor-coverage-allowed"),
    floorCoverageStatus: $("rb-floor-coverage-status"),
    floorCoverageCard: $("rb-floor-coverage-card"),
    floorCoverageFine: $("rb-floor-coverage-fine"),
    floorTileLabel: $("rb-floor-coverage-tile-label"),
    floorActualSrc: $("rb-floor-coverage-actual-src"),
    floorAllowedSrc: $("rb-floor-coverage-allowed-src"),
    totalFinesTile: $("rb-total-fines-tile"),
    totalFinesValue: $("rb-total-fines-value"),
    totalFinesHint: $("rb-total-fines-hint"),
    numFloorsActual: $("rb-num-floors-actual"),
    numFloorsAllowed: $("rb-num-floors-allowed"),
    numFloorsStatus: $("rb-num-floors-status"),
    numFloorsCard: $("rb-num-floors-card"),
    // CAD-derived count of street-facing lot edges. Lives in the Details
    // grid alongside the PDF-sourced identity tiles, but is owned by
    // applyCad below since its source is compliance.edge_classifications.
    numStreets: $("rb-num-streets"),
  };

  // --- Intake (upload form) -------------------------------------------------
  const intakeTypeEl = $("intake-type");
  const intakeSubmitterEl = $("intake-submitter");

  // --- Formatters -----------------------------------------------------------
  function fmtArea(v) {
    if (v == null || !isFinite(v)) return "—";
    const n = Number(v);
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " m²";
    return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " m²";
  }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return "—";
    return Number(v).toFixed(1) + "%";
  }

  // --- Banner updaters ------------------------------------------------------
  function setTypeOnBanner(type) {
    const k = TYPE_KEYS[type] ? type : "other";
    banner.applicationType = k;
    if (!el.typePill || !el.typeText) return;
    el.typeText.setAttribute("data-i18n", TYPE_KEYS[k]);
    el.typeText.textContent = tr(TYPE_KEYS[k], k);
    el.typePill.className = "rb-eyebrow rb-type--" + k;
  }

  function setStatusOnBanner(status) {
    const k = STATUS_KEYS[status] ? status : "pending";
    banner.reviewStatus = k;
    if (el.status && el.statusText) {
      el.statusText.setAttribute("data-i18n", STATUS_KEYS[k]);
      el.statusText.textContent = tr(STATUS_KEYS[k], k);
      el.status.className = "rb-status rb-status--" + k;
    }
    // Issues panel branches on review_status (draft → submit-anyway is
    // valid, needs_revision → it isn't, etc.). Keep them in sync.
    try { window.__renderIssuesPanel && window.__renderIssuesPanel(); } catch {}
  }

  function showBanner() {
    if (el.banner) el.banner.hidden = false;
  }

  // --- PDF / deed fields ----------------------------------------------------
  // The per-field identity + building tiles inside the banner are owned by
  // app.js's aggregator (renderApplicationSummary) — it merges the deed with
  // every additional PDF and de-dupes. All this handler does now is set the
  // banner's H2 title from the plot number + village, and reveal the banner.
  // Mirror of dashboard.js's prettyAppName so the application page's
  // banner title matches the dashboard's row label (e.g. "قطعة 2014 ·
  // بدران") instead of the bare CAD filename. Same priority:
  //   1. plot + place (village/basin) from the deed PDF
  //   2. plot alone if no place
  //   3. place alone if no plot
  //   4. cleaned filename
  //   5. file id stub
  function _prettyAppNameFromAnalysis(data) {
    const pdf = (data && data.pdf_result) || {};
    const plot = pdf.plot_number ? "قطعة " + pdf.plot_number : "";
    const place = pdf.village_name
      || pdf.basin_name
      || (pdf.basin_number ? "حوض " + pdf.basin_number : "");
    if (plot && place) return `${plot} · ${place}`;
    if (plot) return plot;
    if (place) return place;
    const fn = (data && data.filename) || "";
    if (fn === "(no CAD)") return tr("history.no_cad", "PDF-only application");
    return String(fn).replace(/\.(dwg|dxf|dwf|dwfx)$/i, "") || "—";
  }

  function applyPdf(pdf) {
    banner.lastPdf = pdf || {};
    if (!pdf) return;
    if (el.title && pdf.plot_number) {
      const plotKey = pdf.village_name ? "rb.plot_title_village" : "rb.plot_title";
      const vars = { plot: pdf.plot_number, village: pdf.village_name || "" };
      el.title.setAttribute("data-i18n", plotKey);
      el.title.setAttribute("data-i18n-vars", JSON.stringify(vars));
      el.title.textContent = tr(plotKey, `Plot ${pdf.plot_number}`, vars);
    }
    // Deed lot area populates the right-hand half of the lot-area
    // comparison block. The CAD half is updated by applyCad. Either side
    // arriving triggers a status-strip recompute.
    if (el.lotDeed) {
      el.lotDeed.textContent = fmtArea(pdf.area_m2);
    }
    updateLotAreaStatus();
    // Deed lot area also feeds the derived "allowed building area"
    // (lot × coverage_pct ÷ 100) — recompute that compare too.
    updateBuildingAreaCompare();
    // Deed PDF also delivers the lot area used for the floor-coverage
    // ratio — re-render the tile in case floor data already landed.
    updateFloorCoverageTile();
    showBanner();
  }

  // Helper for compare tiles — write a localized status line into the
  // strip and propagate the state attribute to the card. Centralizes the
  // status-rendering pattern so each tile's updater can stay short.
  function _writeCompareStatus(card, statusEl, state, i18nKey, i18nVars) {
    if (card) card.setAttribute("data-state", state);
    if (!statusEl) return;
    statusEl.setAttribute("data-state", state);
    statusEl.innerHTML = "";
    const span = document.createElement("span");
    span.setAttribute("data-i18n", i18nKey);
    if (i18nVars && Object.keys(i18nVars).length) {
      span.setAttribute("data-i18n-vars", JSON.stringify(i18nVars));
    }
    span.textContent = tr(i18nKey, "", i18nVars || {});
    statusEl.appendChild(span);
  }

  // Per-tile estimated-fine line. Shown only when the tile is in
  // "violation" state. Rates come from the server-side compliance
  // result's `fine_rates` dict — different per zoning category × fine
  // type (setback / building / floor coverage), per the official Amman
  // fines table. When zoning isn't resolved, the rate is null and the
  // fine line stays hidden — the missing-data row "compliance_zoning_unresolved"
  // surfaces the issue and blocks submission.
  function _fineRateJodPerSqm(fineType) {
    const cad = banner.lastCad || {};
    const compliance = cad.compliance || {};
    // Strict mode (new analyses): zoning_unresolved=true means no rate
    // can be produced. Caller renders "—" and submission stays blocked.
    if (compliance.zoning_unresolved === true) return null;
    // Per-category rates (new analyses with resolved zoning).
    const rates = compliance.fine_rates;
    if (rates && typeof rates === "object") {
      const r = Number(rates[fineType]);
      if (Number.isFinite(r) && r > 0) return r;
    }
    // Legacy fallback (analyses saved before per-category rates landed)
    // — read the single flat rate the old code wrote into compliance.
    const legacy = Number(compliance.fine_per_sqm_jd);
    return (Number.isFinite(legacy) && legacy > 0) ? legacy : null;
  }
  function _writeCompareFine(fineEl, excessSqm, fineType) {
    if (!fineEl) return;
    if (!Number.isFinite(excessSqm) || excessSqm <= 0) {
      fineEl.hidden = true;
      fineEl.removeAttribute("data-i18n");
      fineEl.removeAttribute("data-i18n-vars");
      fineEl.textContent = "";
      return;
    }
    const rate = _fineRateJodPerSqm(fineType);
    if (rate == null) {
      // Violation exists but rate unknown — keep the badge red, but don't
      // show a fake JOD figure. The block-submission row spells out why.
      fineEl.hidden = true;
      fineEl.removeAttribute("data-i18n");
      fineEl.removeAttribute("data-i18n-vars");
      fineEl.textContent = "";
      return;
    }
    const fine = excessSqm * rate;
    const fineStr = Math.round(fine).toLocaleString();
    const vars = { fine: fineStr };
    fineEl.hidden = false;
    fineEl.setAttribute("data-i18n", "rb.compare.fine_jd");
    fineEl.setAttribute("data-i18n-vars", JSON.stringify(vars));
    fineEl.textContent = tr("rb.compare.fine_jd", `Fine: ${fineStr} JOD`, vars);
  }

  // --- Total fines aggregator -----------------------------------------------
  // Sums every fine the reviewer is meant to see in one place: setbacks
  // (server-side, lives on cad.compliance.fine_jd) + the two new
  // client-side fines (building area, floor coverage). Reads the same
  // banner state that the per-tile updaters read so it can never
  // disagree with the per-tile JOD figures. Re-runs whenever any of
  // those four inputs change (applyCad / applyPdf / applyFloor /
  // applySitePlan all call it).
  function _excessSqmBuildingArea() {
    const cad = banner.lastCad || {};
    const pdf = banner.lastPdf || {};
    const sp  = banner.lastSitePlan || {};
    const actual  = Number(cad.building_area);
    const lotDeed = Number(pdf.area_m2);
    const covPct  = Number(sp.coverage_pct);
    if (!Number.isFinite(actual) || !Number.isFinite(lotDeed)
        || !Number.isFinite(covPct) || lotDeed <= 0) return 0;
    const allowed = lotDeed * covPct / 100;
    return Math.max(0, actual - allowed);
  }
  function _excessSqmFloorCoverage() {
    const fp  = banner.lastFloor || {};
    const pdf = banner.lastPdf || {};
    const sp  = banner.lastSitePlan || {};
    const floorSum = (fp.floor_area_sum != null)
      ? Number(fp.floor_area_sum)
      : Number(fp.printed_grand_total);
    const lotArea  = Number(pdf.area_m2);
    const allowedPct = Number(sp.floor_ratio_pct);
    if (!Number.isFinite(floorSum) || !Number.isFinite(lotArea)
        || !Number.isFinite(allowedPct) || lotArea <= 0) return 0;
    const actualPct = (floorSum / lotArea) * 100;
    if (actualPct <= allowedPct) return 0;
    return ((actualPct - allowedPct) / 100) * lotArea;
  }
  function updateTotalFines() {
    if (!el.totalFinesTile || !el.totalFinesValue) return;
    // Show the tile only after at least one ingredient has arrived. Before
    // that the "0 JOD" reading would be misleading (we genuinely don't
    // know yet — not "we've checked and there's nothing").
    const hasAny = !!(banner.lastCad || banner.lastPdf
                      || banner.lastFloor || banner.lastSitePlan);
    if (!hasAny) { el.totalFinesTile.hidden = true; return; }
    el.totalFinesTile.hidden = false;
    // If zoning is unresolved, building + floor rates are unknown → can't
    // honestly produce a total. Show "—" and a hint pointing at the
    // missing-data row that's already blocking submission.
    const compliance = (banner.lastCad && banner.lastCad.compliance) || {};
    if (compliance.zoning_unresolved) {
      el.totalFinesValue.removeAttribute("data-i18n");
      el.totalFinesValue.removeAttribute("data-i18n-vars");
      el.totalFinesValue.textContent = "—";
      el.totalFinesTile.classList.remove("rb-kpi--violated");
      if (el.totalFinesHint) {
        el.totalFinesHint.setAttribute("data-i18n", "rb.hint.total_fines_zoning_required");
        el.totalFinesHint.removeAttribute("data-i18n-vars");
        el.totalFinesHint.textContent = tr("rb.hint.total_fines_zoning_required", "");
      }
      return;
    }
    const bldgRate  = _fineRateJodPerSqm("building") || 0;
    const floorRate = _fineRateJodPerSqm("floor")    || 0;
    const setbackFine  = Number(compliance.fine_jd || 0);
    const buildingFine = _excessSqmBuildingArea() * bldgRate;
    const floorFine    = _excessSqmFloorCoverage() * floorRate;
    const total = setbackFine + buildingFine + floorFine;
    // Mirror the same sub-JOD threshold the setback tile uses (0.5 JOD)
    // to avoid flipping the tile red on shapely's micro-intersections.
    const violated = total >= 0.5;
    const totalStr = Math.round(total).toLocaleString();
    const vars = { total: totalStr };
    el.totalFinesValue.setAttribute("data-i18n",
      violated ? "rb.penalty.jod" : "rb.penalty.zero_jod");
    el.totalFinesValue.setAttribute("data-i18n-vars", JSON.stringify(vars));
    el.totalFinesValue.textContent = violated
      ? tr("rb.penalty.jod", `${totalStr} JOD`, vars)
      : tr("rb.penalty.zero_jod", "0 JOD");
    el.totalFinesTile.classList.toggle("rb-kpi--violated", violated);
    if (el.totalFinesHint) {
      if (!violated) {
        el.totalFinesHint.setAttribute("data-i18n", "rb.hint.total_fines_clean");
        el.totalFinesHint.removeAttribute("data-i18n-vars");
        el.totalFinesHint.textContent = tr("rb.hint.total_fines_clean", "");
      } else {
        // Build the breakdown from only the components that actually
        // contributed (>= 0.5 JOD, same threshold the violated check uses)
        // so the hint reads e.g. "Setbacks" alone when only setbacks fired.
        const parts = [];
        if (setbackFine  >= 0.5) parts.push(tr("rb.fine.component.setbacks",      "Setbacks"));
        if (buildingFine >= 0.5) parts.push(tr("rb.fine.component.building_area", "Building area"));
        if (floorFine    >= 0.5) parts.push(tr("rb.fine.component.floor_coverage","Floor coverage"));
        el.totalFinesHint.removeAttribute("data-i18n");
        el.totalFinesHint.removeAttribute("data-i18n-vars");
        el.totalFinesHint.textContent = parts.join(" · ");
      }
    }
  }

  // Drive the lot-area compare tile. Status states match the server-side
  // cross-doc validator (deed_cad_lot_area_mismatch): any non-zero gap
  // between deed and CAD flags as mismatch.
  function updateLotAreaStatus() {
    if (!el.lotStatus || !el.lotCard) return;
    const cad = (banner.lastCad && typeof banner.lastCad.lot_area === "number")
      ? banner.lastCad.lot_area : null;
    const deed = (banner.lastPdf && typeof banner.lastPdf.area_m2 === "number")
      ? banner.lastPdf.area_m2 : null;
    let state = "pending";
    let i18nKey = "rb.lotcheck.pending";
    let i18nVars = {};
    if (cad != null && deed != null && cad > 0 && deed > 0) {
      const diff = Math.abs(cad - deed);
      if (diff === 0) {
        state = "ok";
        i18nKey = "rb.lotcheck.match";
      } else {
        state = "violation";
        i18nKey = "rb.lotcheck.mismatch";
        i18nVars = { diff: diff.toFixed(2) };
      }
    }
    _writeCompareStatus(el.lotCard, el.lotStatus, state, i18nKey, i18nVars);
  }

  // --- Unit toggle (m² ↔ %) -------------------------------------------------
  // Each unified tile (building, floor) carries its own display unit so
  // the reviewer can keep e.g. building in m² while looking at floor in %.
  // Stored separately in localStorage so the choice survives reloads.
  // Default = m² (matches the unit consultants design in inside CAD).
  const UNIT_STORAGE_KEYS = { building: "rb-tile-unit-building", floor: "rb-tile-unit-floor" };
  function _activeUnit(tile) {
    try {
      const v = localStorage.getItem(UNIT_STORAGE_KEYS[tile]);
      return (v === "pct") ? "pct" : "sqm";
    } catch { return "sqm"; }
  }
  function _setActiveUnit(tile, unit) {
    const next = (unit === "pct") ? "pct" : "sqm";
    try { localStorage.setItem(UNIT_STORAGE_KEYS[tile], next); } catch {}
    // Sync the matching toggle's pressed state + the tile's data-unit attr
    // (only this tile — the other one stays at whatever the reviewer set).
    const toggle = document.querySelector(`.rb-unit-toggle[data-tile="${tile}"]`);
    if (toggle) {
      toggle.querySelectorAll(".rb-unit-btn").forEach((btn) => {
        btn.setAttribute("aria-pressed", btn.dataset.unit === next ? "true" : "false");
      });
    }
    const card = (tile === "building") ? el.buildingCard : el.floorCoverageCard;
    if (card) card.dataset.unit = next;
    if (tile === "building") updateBuildingAreaCompare();
    else updateFloorCoverageTile();
  }
  function _setI18n(node, key, vars) {
    if (!node) return;
    node.setAttribute("data-i18n", key);
    if (vars && Object.keys(vars).length) {
      node.setAttribute("data-i18n-vars", JSON.stringify(vars));
    } else {
      node.removeAttribute("data-i18n-vars");
    }
    node.textContent = tr(key, "", vars || {});
  }

  // Drive the unified Building Area / Coverage tile. Same constraint
  // (building footprint vs lot × cov%), shown either in m² (default —
  // the CAD-design unit) or as a percentage. Status + fine are always
  // computed in m² so the verdict is identical regardless of view.
  function updateBuildingAreaCompare() {
    if (!el.buildingCard) return;
    const unit = _activeUnit("building");
    const actualSqm  = (banner.lastCad && Number.isFinite(banner.lastCad.building_area))
      ? Number(banner.lastCad.building_area) : null;
    const actualPct  = (banner.lastCad && Number.isFinite(banner.lastCad.coverage_pct))
      ? Number(banner.lastCad.coverage_pct) : null;
    const lotDeed    = (banner.lastPdf && Number.isFinite(banner.lastPdf.area_m2))
      ? Number(banner.lastPdf.area_m2) : null;
    const allowedPct = (banner.lastSitePlan && Number.isFinite(banner.lastSitePlan.coverage_pct))
      ? Number(banner.lastSitePlan.coverage_pct) : null;
    const allowedSqm = (lotDeed != null && allowedPct != null && lotDeed > 0)
      ? (lotDeed * allowedPct / 100) : null;

    // Render label + values per active unit.
    if (unit === "pct") {
      _setI18n(el.buildingTileLabel, "rb.kpi.building_pct");
      if (el.building) el.building.textContent = (actualPct != null) ? actualPct.toFixed(1) + "%" : "—";
      if (el.buildingAllowed) el.buildingAllowed.textContent = (allowedPct != null) ? allowedPct.toFixed(1) + "%" : "—";
      _setI18n(el.buildingActualSrc,  "rb.compare.actual_cad");
      _setI18n(el.buildingAllowedSrc, "rb.compare.allowed_site_plan");
    } else {
      _setI18n(el.buildingTileLabel, "rb.kpi.building_sqm");
      if (el.building) el.building.textContent = (actualSqm != null) ? fmtArea(actualSqm) : "—";
      if (el.buildingAllowed) el.buildingAllowed.textContent = (allowedSqm != null) ? fmtArea(allowedSqm) : "—";
      _setI18n(el.buildingActualSrc,  "rb.compare.actual_cad");
      _setI18n(el.buildingAllowedSrc, "rb.compare.allowed_derived");
    }

    // Status + fine — canonical in m². Violation message uses the
    // active-unit's natural phrasing (m² over for sqm, % over for pct).
    let state = "pending";
    let i18nKey = "rb.compare.pending";
    let i18nVars = {};
    let excessSqm = null;
    if (actualSqm != null && allowedSqm != null) {
      if (actualSqm > allowedSqm) {
        state = "violation";
        excessSqm = actualSqm - allowedSqm;
        if (unit === "pct" && actualPct != null && allowedPct != null) {
          i18nKey = "rb.compare.coverage_violation";
          i18nVars = { over: (actualPct - allowedPct).toFixed(1) };
        } else {
          i18nKey = "rb.compare.bldg_violation";
          i18nVars = { over: excessSqm.toFixed(2) };
        }
      } else {
        state = "ok";
        i18nKey = (unit === "pct") ? "rb.compare.coverage_ok" : "rb.compare.bldg_ok";
      }
    } else if (actualSqm != null && allowedSqm == null) {
      i18nKey = "rb.compare.no_rule";
    }
    _writeCompareStatus(el.buildingCard, el.buildingStatus, state, i18nKey, i18nVars);
    _writeCompareFine(el.buildingFine, excessSqm, "building");
    updateTotalFines();
  }

  // Drive the floor-count compare tile (actual from floor plan vs the
  // regulatory max from the site plan). Server-side equivalent:
  // cross_doc_floors_exceed_max in validation.py.
  function updateNumFloorsCompare() {
    if (!el.numFloorsCard) return;
    const actual = (banner.lastFloor && Number.isFinite(banner.lastFloor.num_floors))
      ? Number(banner.lastFloor.num_floors) : null;
    const allowed = (banner.lastSitePlan && Number.isFinite(banner.lastSitePlan.max_floors))
      ? Number(banner.lastSitePlan.max_floors) : null;
    if (el.numFloorsActual) el.numFloorsActual.textContent = (actual != null) ? String(actual) : "—";
    if (el.numFloorsAllowed) el.numFloorsAllowed.textContent = (allowed != null) ? String(allowed) : "—";
    let state = "pending";
    let i18nKey = "rb.compare.pending";
    let i18nVars = {};
    if (actual != null && allowed != null) {
      if (actual > allowed) {
        state = "violation";
        i18nKey = "rb.compare.floors_violation";
        i18nVars = { over: String(actual - allowed) };
      } else {
        state = "ok";
        i18nKey = "rb.compare.floors_ok";
      }
    } else if (actual != null && allowed == null) {
      i18nKey = "rb.compare.no_rule";
    }
    _writeCompareStatus(el.numFloorsCard, el.numFloorsStatus, state, i18nKey, i18nVars);
  }

  // Drive the unified Floors total / Floor-coverage tile. m² mode shows
  // the computed floor-area sum (compliance basis) vs the allowed
  // absolute (lot × allowed_pct/100). % mode shows the same constraint
  // as a ratio. Status + fine are always canonical in m².
  function updateFloorCoverageTile() {
    if (!el.floorComputed) return;
    const unit = _activeUnit("floor");
    const fp = banner.lastFloor || {};
    const pdf = banner.lastPdf || {};
    const sp  = banner.lastSitePlan || {};
    // Prefer filtered floor_area_sum (ground + numbered upper + repeated)
    // — Python postprocess. Fall back to printed_grand_total for older
    // saved analyses that pre-date floor_area_sum.
    const floorSum = (fp.floor_area_sum != null) ? Number(fp.floor_area_sum)
      : Number(fp.printed_grand_total);
    const lotArea = (typeof pdf.area_m2 === "number") ? pdf.area_m2 : null;
    const allowedPct = (Number.isFinite(Number(sp.floor_ratio_pct)))
      ? Number(sp.floor_ratio_pct) : null;
    const actualPct = (Number.isFinite(floorSum) && lotArea != null && lotArea > 0)
      ? (floorSum / lotArea) * 100 : null;
    const allowedSqm = (lotArea != null && lotArea > 0 && allowedPct != null)
      ? (lotArea * allowedPct / 100) : null;
    const actualSqm = Number.isFinite(floorSum) ? floorSum : null;

    // Render label + values per active unit.
    if (unit === "pct") {
      _setI18n(el.floorTileLabel, "rb.kpi.floor_pct");
      el.floorComputed.textContent = (actualPct != null) ? actualPct.toFixed(1) + "%" : "—";
      if (el.floorCoverageAllowed) el.floorCoverageAllowed.textContent = (allowedPct != null) ? allowedPct.toFixed(1) + "%" : "—";
      _setI18n(el.floorActualSrc,  "rb.hint.floors_over_lot");
      _setI18n(el.floorAllowedSrc, "rb.compare.allowed_site_plan");
    } else {
      _setI18n(el.floorTileLabel, "rb.kpi.floor_sqm");
      el.floorComputed.textContent = (actualSqm != null) ? fmtArea(actualSqm) : "—";
      if (el.floorCoverageAllowed) el.floorCoverageAllowed.textContent = (allowedSqm != null) ? fmtArea(allowedSqm) : "—";
      _setI18n(el.floorActualSrc,  "rb.compare.floor_computed");
      _setI18n(el.floorAllowedSrc, "rb.compare.allowed_derived_floor");
    }

    // Status + fine — canonical in m². Violation message uses the
    // active-unit's natural phrasing.
    let state = "pending";
    let i18nKey = "rb.compare.pending";
    let i18nVars = {};
    let excessSqm = null;
    if (actualPct != null && allowedPct != null) {
      if (actualPct > allowedPct) {
        state = "violation";
        if (lotArea != null && lotArea > 0) {
          excessSqm = ((actualPct - allowedPct) / 100) * lotArea;
        }
        if (unit === "pct") {
          i18nKey = "rb.compare.floor_cov_violation";
          i18nVars = { over: (actualPct - allowedPct).toFixed(1) };
        } else {
          i18nKey = "rb.compare.floor_violation_sqm";
          i18nVars = { over: (excessSqm != null) ? excessSqm.toFixed(2) : "—" };
        }
      } else {
        state = "ok";
        i18nKey = "rb.compare.floor_cov_ok";
      }
    } else if (actualPct != null && allowedPct == null) {
      i18nKey = "rb.compare.no_rule";
    }
    _writeCompareStatus(el.floorCoverageCard, el.floorCoverageStatus, state, i18nKey, i18nVars);
    _writeCompareFine(el.floorCoverageFine, excessSqm, "floor");
    updateTotalFines();
  }

  // --- CAD result -----------------------------------------------------------
  function applyCad(cad) {
    banner.lastCad = cad || {};
    if (!cad) return;

    // CAD data landed — hide the KPI section spinner.
    const kpisSpinner = document.getElementById("rb-kpis-spinner");
    if (kpisSpinner) kpisSpinner.hidden = true;

    // el.building and el.coverage values are written by updateBuildingAreaCompare
    // (which now handles both m² and % display via the unit toggle).
    if (el.lot) el.lot.textContent = fmtArea(cad.lot_area);
    // Number of streets — count of lot edges classified as street-facing
    // by street_classifier.py. Sourced from compliance.edge_classifications,
    // so it stays "—" until the compliance pipeline runs (i.e. site plan
    // was extractable). Hides the "0" case as "—" too — a lot with zero
    // street-facing edges is a missing-STREET-layer signal, not a real
    // value worth showing.
    if (el.numStreets) {
      const ec = (cad.compliance && Array.isArray(cad.compliance.edge_classifications))
        ? cad.compliance.edge_classifications : null;
      const n = ec ? ec.filter((c) => c && c.side === "front").length : null;
      el.numStreets.textContent = (n != null && n > 0) ? String(n) : "—";
    }
    // CAD lot area drives the left-hand half of the comparison block.
    // Recompute the status strip whenever this side updates.
    updateLotAreaStatus();
    // CAD building_area is the left side of the building-area compare.
    updateBuildingAreaCompare();
    // CAD compliance carries the per-category fine_rates dict — the floor
    // tile reads `floor` rate from there, so refresh it whenever a new
    // CAD result lands. Without this, the floor tile keeps the rate it
    // had at the last applyFloor / applySitePlan call.
    updateFloorCoverageTile();
    showBanner();
  }

  // --- Floor-plan result ----------------------------------------------------
  function applyFloor(fp) {
    banner.lastFloor = fp || {};
    if (!fp) return;
    // The unified floor tile (m² vs % via toggle) reads fp.floor_area_sum
    // and fp.printed_grand_total directly — populated by updateFloorCoverageTile.
    updateFloorCoverageTile();
    // Floor-count compare tile — left side (actual) reads from this
    // pipeline's num_floors; right side (allowed) and the status come
    // from updateNumFloorsCompare which also reads banner.lastSitePlan.
    updateNumFloorsCompare();
    showBanner();
  }

  // App.js's renderSitePlanContent calls this with the site-plan PDF
  // payload so the compare tiles have the rulebook side they need
  // (floor_ratio_pct for the floor coverage tile, max_floors for the
  // floor count tile). Caller is the only place this is invoked from.
  function applySitePlan(d) {
    banner.lastSitePlan = d || null;
    updateFloorCoverageTile();
    updateNumFloorsCompare();
    // Site-plan coverage_pct is the multiplier in the derived allowed
    // building area, so the building-area compare tile also recomputes.
    updateBuildingAreaCompare();
    showBanner();
  }

  // --- Approve / Reject -----------------------------------------------------
  async function persistMeta(partial) {
    if (!banner.applicationId) return;
    try {
      const res = await fetch(`/api/analyses/${encodeURIComponent(banner.applicationId)}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      console.error("persistMeta", err);
    }
  }

  // Submit a status + optional reviewer notes + per-row comments. Called
  // by app.js's submitReviewStatus (the only entry point — the in-panel
  // Approve / Needs-Revision / Reject buttons all funnel through there).
  // `opts.approvedWithOpenIssues` flags an Approve-with-N-flagged-rows
  // path so the backend can stamp the audit flag on meta.
  async function submitStatus(status, notes, rowComments, opts) {
    if (!STATUS_KEYS[status]) return;
    setStatusOnBanner(status);
    const patch = { review_status: status };
    if (typeof notes === "string") patch.reviewer_notes = notes;
    if (rowComments && typeof rowComments === "object" && Object.keys(rowComments).length > 0) {
      patch.missing_data_comments = rowComments;
    }
    // Per-row endorsements (the "push" toggles) ride along on the same
    // PATCH so a single round-trip commits decision + comments + push
    // state atomically. Passed via opts.rowEndorsements: {key: bool}.
    const endorsed = opts && opts.rowEndorsements;
    if (endorsed && typeof endorsed === "object" && Object.keys(endorsed).length > 0) {
      patch.missing_data_endorsed = endorsed;
    }
    if (status === "approved") {
      patch.approved_with_open_issues = !!(opts && opts.approvedWithOpenIssues);
    }
    await persistMeta(patch);
  }
  // No direct el.approve / el.reject wiring here anymore — those buttons
  // are gone from the markup; the new #ip-approve / #ip-reject /
  // #ip-needs-revision buttons inside the issues panel are wired in
  // app.js (wireReviewerPanelActions) and route through submitStatus.

  // --- Upload POST: attach meta_json ---------------------------------------
  // app.js submits with fetch(). We intercept fetch and add meta_json to any
  // POST to /api/jobs that carries a FormData body.
  const origFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url && /\/api\/jobs(?:$|\?)/.test(url) && init && init.body instanceof FormData) {
        const fd = init.body;
        if (!fd.has("meta_json")) {
          const payload = {
            application_type: (intakeTypeEl && intakeTypeEl.value) || "initial_consultation",
            submitted_by: (intakeSubmitterEl && intakeSubmitterEl.value) || "",
          };
          fd.append("meta_json", JSON.stringify(payload));
          // Remember local banner state so when the final event arrives we
          // already know the type / submitter.
          banner.applicationType = payload.application_type;
          banner.submittedBy = payload.submitted_by;
          if (payload.submitted_by && el.owner) el.owner.textContent = payload.submitted_by;
          setTypeOnBanner(payload.application_type);
        }
      }
    } catch (err) { /* non-fatal */ }
    return origFetch(input, init);
  };

  // --- SSE event interception via EventSource constructor -------------------
  // app.js opens SSE to /api/jobs/{id}/events. We listen for the same named
  // events to keep the banner live, without touching app.js.
  //
  // Race-safety: every patched EventSource is stamped with the current
  // window.__analysisGen at construction time. If a partial-resubmit
  // bumps the generation counter mid-flight (see attachLiveResubmitStream),
  // any late events from the prior stream are dropped here so they
  // can't poison the new panel state.
  if (typeof window.__analysisGen !== "number") window.__analysisGen = 0;
  const OrigES = window.EventSource;
  window.EventSource = function PatchedEventSource(url, config) {
    const es = new OrigES(url, config);
    es.__gen = window.__analysisGen;
    // Track the active stream so attachLiveResubmitStream can close it
    // synchronously before opening the next one. (Multiple ES instances
    // can briefly co-exist for unrelated pages — only the live-banner
    // path needs this.)
    window.__currentEventSource = es;

    function on(name, fn) {
      es.addEventListener(name, (ev) => {
        // Generation guard — drop events from a superseded stream.
        if (es.__gen !== window.__analysisGen) return;
        let data = {};
        try { data = JSON.parse(ev.data); } catch {}
        try { fn(data); } catch (err) { console.error("reviewer " + name, err); }
      });
    }

    on("start", () => { showBanner(); });
    on("final", (d) => { applyCad(d); });
    on("pdf_done", (d) => { applyPdf(d); });
    on("floor_done", (d) => { applyFloor(d); });
    on("done", () => {
      // Lookup the saved analysis record so we can PATCH meta on approve/reject
      // and wire applicationId for the banner. (Skipped for submitters — their
      // applicationId was pre-seeded by app.js after the POST returned.)
      if (!IS_SUBMITTER) setTimeout(resolveApplicationIdFromLatest, 800);
      // Submitter pre-submit bar: enable buttons now that analysis finished.
      if (IS_SUBMITTER && window.__submitterActions) {
        window.__submitterActions.markReady();
        window.__submitterActions.showState();
      }
    });

    return es;
  };
  // Preserve statics if code references them
  for (const k in OrigES) {
    try { window.EventSource[k] = OrigES[k]; } catch {}
  }

  // Clear every CAD / floor-plan driven cell in the banner back to the "—"
  // placeholder so a new analysis starts from a blank slate instead of showing
  // the previous run's numbers while the new one is streaming.
  function resetBanner() {
    banner.lastCad = null;
    banner.lastFloor = null;
    banner.lastPdf = null;

    const dash = "—";
    if (el.building) el.building.textContent = dash;
    if (el.buildingAllowed) el.buildingAllowed.textContent = dash;
    if (el.lot) el.lot.textContent = dash;
    if (el.lotDeed) el.lotDeed.textContent = dash;
    if (el.coverage) el.coverage.textContent = dash;
    if (el.floorComputed) el.floorComputed.textContent = dash;
    if (el.floorCoverageAllowed) el.floorCoverageAllowed.textContent = dash;
    if (el.numFloorsActual) el.numFloorsActual.textContent = dash;
    if (el.numFloorsAllowed) el.numFloorsAllowed.textContent = dash;
    if (el.numStreets) el.numStreets.textContent = dash;
    banner.lastSitePlan = null;
    // Reset the comparison strips back to "pending" so the visual state
    // matches the empty values above.
    updateLotAreaStatus();
    updateBuildingAreaCompare();
    updateFloorCoverageTile();
    updateNumFloorsCompare();
  }

  // Targeted reset for CAD-only resubmits — clears only the agent-derived
  // banner cells (building area, lot area, coverage) so the floor-PDF KPIs
  // (number of floors, floors total, floor coverage ratio) stay populated
  // from the carried-over previous analysis. Without this, a CAD-only
  // resubmit would wipe the floor data and leave it as "—" forever (no
  // floor_done event arrives because the floor pipeline isn't re-running).
  function resetBannerCadOnly() {
    banner.lastCad = null;
    const dash = "—";
    if (el.building) el.building.textContent = dash;
    if (el.lot) el.lot.textContent = dash;
    if (el.coverage) el.coverage.textContent = dash;
    if (el.numStreets) el.numStreets.textContent = dash;
    // Recompute the lot-area comparison strip — CAD half is now blank
    // but the deed half (banner.lastPdf) survives the partial reset.
    updateLotAreaStatus();
    updateBuildingAreaCompare();
    // Floor-coverage tile mixes CAD lot-area with floor-PDF data — the
    // tile's value re-renders inside updateFloorCoverageTile() when CAD
    // data lands again, so it's safe to leave the cached lastFloor in
    // place. No need to clear floorPrinted / floorComputed / numFloors.
  }

  // Wire the unit-toggle pills on the building + floor tiles. Per-tile
  // state — clicking one toggle only flips its own tile.
  document.addEventListener("click", (ev) => {
    const btn = ev.target && ev.target.closest && ev.target.closest(".rb-unit-btn");
    if (!btn) return;
    const toggle = btn.closest(".rb-unit-toggle");
    const tile = toggle && toggle.dataset.tile;
    const u = btn.dataset.unit;
    if ((tile === "building" || tile === "floor") && (u === "sqm" || u === "pct")) {
      _setActiveUnit(tile, u);
    }
  });
  // Apply each tile's persisted unit (or default) on init so the toggles
  // and tiles reflect the right state before any data lands.
  _setActiveUnit("building", _activeUnit("building"));
  _setActiveUnit("floor",    _activeUnit("floor"));

  // Expose the banner updaters so app.js's replay path (loadSavedAnalysis
  // and EVENT_HANDLERS.final/pdf_done/floor_done/site_plan_done) can populate
  // the banner even when there's no real SSE stream wiring it up. Both live
  // and replay routes now land the same values in the same tiles.
  window.__reviewerBanner = {
    applyPdf, applyCad, applyFloor, applySitePlan, showBanner,
    reset: resetBanner,
    resetCadOnly: resetBannerCadOnly,
    submitStatus,
    setApplicationId(id) {
      // Used by app.js (submitter flow) to pre-seed the id from the POST
      // /api/jobs response, so the submitter action bar can POST /submit
      // without waiting for resolveApplicationIdFromLatest's polling.
      if (id) banner.applicationId = String(id);
    },
    get applicationId() { return banner.applicationId; },
    // Read-only view of the current review_status so app.js's
    // renderIssuesPanel() can branch on draft / pending / needs_revision /
    // approved / rejected without duplicating the banner-state machine.
    get reviewStatus() { return banner.reviewStatus; },
  };

  // Re-fetch the analysis from disk and update every piece of UI that
  // depends on meta + missing_data. Cheap (single endpoint hit) and
  // covers: status chip, timeline (new "submission"/decision entry),
  // documents panel (in case file_paths shifted), issues panel
  // (read-only switch). Used post-submit and post-resubmit so the
  // submitter sees their action's effect without a full page reload.
  async function refreshAnalysisInPlace(id) {
    try {
      const r = await fetch(`/api/analyses/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) return;
      const fresh = await r.json();
      const m = fresh.meta || {};
      window.__loadedAnalysisMeta = m;
      if (typeof window.__setPreviousRound === "function") {
        try { window.__setPreviousRound(m); } catch {}
      }
      setStatusOnBanner(m.review_status || "pending");
      if (typeof window.__renderReviewTimeline === "function") {
        window.__renderReviewTimeline(m.reviewer_notes_history || []);
      }
      if (typeof window.__renderDocumentsPanel === "function") {
        try { window.__renderDocumentsPanel(id); } catch {}
      }
      try { window.__renderIssuesPanel && window.__renderIssuesPanel(); } catch {}
      // Rounds panel — paints the round-centric consolidation that
      // visually subsumes the timeline + documents + issues sections.
      // Must run AFTER the legacy renderers so #issues-panel exists
      // and contains its freshly-rendered cards before we re-parent
      // it into the active round card.
      if (typeof window.__renderRoundsPanel === "function") {
        try { window.__renderRoundsPanel(id); } catch {}
      }
    } catch (err) {
      console.error("refreshAnalysisInPlace", err);
    }
  }
  // Window-scope mirror so app.js's submitReviewStatus path can call
  // it after a reviewer decision lands (Approve / Needs-Revision /
  // Reject) — same in-place refresh as the submitter post-submit path.
  window.__refreshAnalysisInPlace = refreshAnalysisInPlace;

  // --- Submitter pre-submit action bar -------------------------------------
  // The state machine is now driven by app.js's renderIssuesPanel(): it
  // shows/hides the right buttons based on missing_data + review_status.
  // This function only:
  //   · wires the click handlers on the new #ip-sub-* buttons
  //   · exposes markReady / markBusy / refresh on window.__submitterActions
  //     so the SSE attach + autoLoad paths can flip the disabled state
  //   · does NOT compute which buttons are visible — the panel render
  //     handles that
  let __submitterReady = false;  // flipped by markReady() once `done` lands

  function initSubmitterActions() {
    if (!IS_SUBMITTER) return;
    const btnClean    = document.getElementById("ip-sub-submit-clean");
    const btnEdit     = document.getElementById("ip-sub-edit-files");
    const btnAnyway   = document.getElementById("ip-sub-submit-anyway");
    const confAnyway  = document.getElementById("ip-confirm-anyway");
    const btnAnywayYes    = document.getElementById("ip-confirm-anyway-yes");
    const btnAnywayCancel = document.getElementById("ip-confirm-anyway-cancel");
    const headerCta   = document.getElementById("ip-cta");

    function refreshButtons() {
      // Submit buttons are gated on the analysis being done. The "edit
      // files" button is always live — they can bail out at any point.
      [btnClean, btnAnyway, btnAnywayYes].forEach((b) => {
        if (b) b.disabled = !__submitterReady;
      });
    }

    async function postSubmit(withKnownIssues) {
      const id = banner.applicationId;
      if (!id) {
        alert("لم يكتمل تحليل الطلب بعد. الرجاء الانتظار قليلًا ثم المحاولة من جديد.");
        return;
      }
      // Disable everything in-flight so the user can't double-submit.
      [btnClean, btnEdit, btnAnyway, btnAnywayYes].forEach((b) => { if (b) b.disabled = true; });
      try {
        const res = await fetch(`/api/analyses/${encodeURIComponent(id)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submit_with_known_issues: !!withKnownIssues }),
        });
        if (!res.ok) {
          let detail = "تعذّر إرسال الطلب.";
          try { const b = await res.json(); if (b && b.detail) detail = b.detail; } catch {}
          alert(detail);
          [btnClean, btnEdit, btnAnyway, btnAnywayYes].forEach((b) => { if (b) b.disabled = false; });
          return;
        }
        // Success — stay on /app and refresh the panel state in place
        // (status chip → "قيد المراجعة", new timeline entry, footer
        // collapses to read-only). No redirect; the user keeps the same
        // visual context they just acted on.
        await refreshAnalysisInPlace(id);
      } catch (err) {
        alert("خطأ في الاتصال: " + (err && err.message || err));
        [btnClean, btnEdit, btnAnyway, btnAnywayYes].forEach((b) => { if (b) b.disabled = false; });
      }
    }


    if (btnClean) btnClean.addEventListener("click", () => postSubmit(false));
    if (btnEdit) btnEdit.addEventListener("click", () => openInlineEditForm());
    if (headerCta && !headerCta.__cta_wired) {
      // The header CTA is the same primary "edit files" action as
      // btnEdit — wired here so it works whether app.js's renderer
      // already flipped the wire flag or not.
      headerCta.addEventListener("click", () => openInlineEditForm());
      headerCta.__cta_wired = true;
    }
    if (btnAnyway) {
      btnAnyway.addEventListener("click", () => {
        if (confAnyway) confAnyway.hidden = false;
      });
    }
    if (btnAnywayCancel) {
      btnAnywayCancel.addEventListener("click", () => {
        if (confAnyway) confAnyway.hidden = true;
      });
    }
    if (btnAnywayYes) {
      btnAnywayYes.addEventListener("click", () => postSubmit(true));
    }

    // Expose hooks the rest of the app uses to flip ready state +
    // request a re-render. The render itself lives in app.js — this
    // file does NOT compute visibility anymore.
    window.__submitterActions = {
      markReady() { __submitterReady = true; refreshButtons(); },
      markBusy()  { __submitterReady = false; refreshButtons(); },
      refresh:    refreshButtons,
      // Back-compat alias: callers (live-stream attach, autoLoad) used
      // to call showState; keep the name working but route to the
      // panel's render so any state delta is reflected immediately.
      showState() {
        try { window.__renderIssuesPanel && window.__renderIssuesPanel(); } catch {}
        refreshButtons();
      },
    };

    // First paint
    refreshButtons();
    try { window.__renderIssuesPanel && window.__renderIssuesPanel(); } catch {}
  }

  // --- Inline partial-resubmit form (draft preview) ------------------------
  // Stays inside the draft preview screen so the engineer doesn't lose
  // context. Only shows the document slots flagged by the AI; unchanged
  // slots carry forward on the backend. After a successful POST, lands on
  // the new draft so the re-analysis streams into the same screen.

  // Mirror of app/validation.py:_KEY_TO_SLOTS. Cross-document rows
  // implicate multiple slots so the partial-resubmit form surfaces every
  // document the user could fix.
  const _KEY_TO_SLOTS = {
    cad_missing_building_layer: ["cad"],
    cad_missing_lot_layer: ["cad"],
    cad_missing_street_layer: ["cad"],
    cad_building_empty: ["cad"],
    cad_lot_empty: ["cad"],
    cad_building_open: ["cad"],
    cad_lot_open: ["cad"],
    cad_building_outside_lot: ["cad"],
    coverage_exceeds_allowed: ["cad"],
    setback_violation: ["cad"],
    site_plan_wrong_doc: ["pdf_site_plan"],
    site_plan_unreadable: ["pdf_site_plan"],
    deed_cad_lot_area_mismatch: ["cad", "pdf_deed"],
    deed_site_plan_plot_mismatch: ["pdf_deed", "pdf_site_plan"],
    deed_site_plan_basin_mismatch: ["pdf_deed", "pdf_site_plan"],
    deed_site_plan_village_mismatch: ["pdf_deed", "pdf_site_plan"],
    floors_exceed_max: ["pdf_floor", "pdf_site_plan", "cad"],
    floor_ratio_exceeds_allowed: ["pdf_floor", "pdf_site_plan", "cad"],
  };

  function deriveFlagsFromMissingRows(rows) {
    const out = { cad: false, pdf_deed: false, pdf_floor: false, pdf_site_plan: false };
    for (const r of rows || []) {
      const slots = _KEY_TO_SLOTS[(r && r.key) || ""];
      if (!slots) continue;
      for (const s of slots) if (s in out) out[s] = true;
    }
    return out;
  }

  // Derive flags from the live missing-data store (window.__missingData,
  // populated from `missing_data` SSE events) or — for the autoLoad
  // path — from the persisted snapshot stashed at
  // window.__loadedAnalysisMissingData. Fallback exposes all 4 slots
  // so the form is at least usable if both are empty.
  function deriveFlagsFromCurrentTable() {
    // Prefer the in-memory missing-data store maintained by app.js.
    const store = window.__missingData;
    if (store && Array.isArray(store.rows) && store.rows.length > 0) {
      return deriveFlagsFromMissingRows(store.rows);
    }
    // Fallback for the autoLoaded path: read from analysis.missing_data
    const cached = window.__loadedAnalysisMissingData;
    if (Array.isArray(cached) && cached.length > 0) {
      return deriveFlagsFromMissingRows(cached);
    }
    return { cad: true, pdf_deed: true, pdf_floor: true, pdf_site_plan: true };
  }

  function currentFilenameFor(slot) {
    const meta = window.__loadedAnalysisMeta || {};
    const paths = meta.file_paths || {};
    if (slot === "cad") {
      return meta.cad_filename || (paths.cad ? String(paths.cad).split(/[/\\]/).pop() : "");
    }
    const fn = paths[slot + "_filename"];
    if (fn) return fn;
    if (paths[slot]) return String(paths[slot]).split(/[/\\]/).pop();
    return "";
  }

  async function openInlineEditForm(opts) {
    const editBox = document.getElementById("rp-submitter-edit");
    if (!editBox) return;

    // The legacy clean / issues / confirm sub-state divs are gone — the
    // inline edit form lives inside the new issues panel and just slides
    // open below the cards. The action footer stays visible so the
    // submitter can cancel out and pick a different path.
    editBox.hidden = false;

    // If we don't have fresh meta yet (live-upload path — autoLoad never
    // ran), fetch it now so the "current file:" captions are accurate.
    if (!window.__loadedAnalysisMeta && banner.applicationId) {
      try {
        const r = await fetch(`/api/analyses/${encodeURIComponent(banner.applicationId)}`, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          window.__loadedAnalysisMeta = d.meta || {};
          window.__loadedAnalysisMissingData = d.missing_data || window.__loadedAnalysisMissingData || [];
        }
      } catch { /* non-fatal */ }
    }

    // Decide which slots to show. Three modes:
    //   · No opts            — every flagged slot is visible (the "edit
    //                           all flagged" CTA in the panel header).
    //   · opts.focusKey      — single-key carryover from the legacy
    //                           per-row link (kept for back-compat).
    //   · opts.focusKeys[]   — UNION of slots from every key in the
    //                           array. Used by the per-card edit
    //                           button in grouped cards: two
    //                           observations on the same CAD file
    //                           pre-check the CAD slot once, not twice.
    const focusKeys = (opts && Array.isArray(opts.focusKeys) && opts.focusKeys.length > 0)
      ? opts.focusKeys.slice()
      : (opts && opts.focusKey ? [opts.focusKey] : null);
    const flags = focusKeys
      ? deriveFlagsFromMissingRows(focusKeys.map((k) => ({ key: k })))
      : deriveFlagsFromCurrentTable();
    const slots = ["cad", "pdf_deed", "pdf_floor", "pdf_site_plan"];
    for (const slot of slots) {
      const wrap = document.getElementById(`rp-edit-${slot}-wrap`);
      const current = document.getElementById(`rp-edit-${slot}-current`);
      if (!wrap) continue;
      const visible = !!flags[slot];
      wrap.hidden = !visible;
      if (visible && current) {
        const fn = currentFilenameFor(slot);
        current.innerHTML = fn
          ? `<span class="rp-edit-current-label">الملف الحالي:</span> <span class="rp-edit-current-name" dir="auto">${fn.replace(/[<>&"']/g, "")}</span>`
          : "";
      }
    }
    // Scroll the form into view so it's obvious what to do next.
    try { editBox.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
  }
  // Exposed so app.js's renderIssuesPanel can wire the per-card "edit
  // this document" link without a circular import.
  window.__openInlineEditForm = openInlineEditForm;

  function closeInlineEditForm() {
    const editBox = document.getElementById("rp-submitter-edit");
    if (editBox) editBox.hidden = true;
    // Re-render the panel so the action footer/buttons return.
    try { window.__renderIssuesPanel && window.__renderIssuesPanel(); } catch {}
  }

  function initInlineEditForm() {
    if (!IS_SUBMITTER) return;
    const SLOTS = ["cad", "pdf_deed", "pdf_floor", "pdf_site_plan"];
    const SLOT_TO_FIELD = { cad: "file", pdf_deed: "pdf_deed", pdf_floor: "pdf_floor", pdf_site_plan: "pdf_site_plan" };
    const DEFAULT_LABEL = {
      cad: "تحميل رسم CAD",
      pdf_deed: "تحميل سند التسجيل PDF",
      pdf_floor: "تحميل خطة مساحة الطابقية PDF",
      pdf_site_plan: "تحميل مخطط موقع تنظيمي PDF",
    };
    const picked = { cad: null, pdf_deed: null, pdf_floor: null, pdf_site_plan: null };

    const submitBtn = document.getElementById("rp-edit-submit");
    const cancelBtn = document.getElementById("rp-edit-cancel");
    const form = document.getElementById("rp-submitter-edit-form");
    const msg = document.getElementById("rp-edit-msg");

    function refreshSubmitState() {
      const any = SLOTS.some((s) => picked[s] != null);
      if (submitBtn) submitBtn.disabled = !any;
    }

    // Char-counter for the optional submitter-notes textarea so the
    // 2000-char cap is visible during composition.
    const notesEl = document.getElementById("rp-edit-notes-input");
    const notesCount = document.getElementById("rp-edit-notes-count");
    if (notesEl && notesCount) {
      const updateCount = () => { notesCount.textContent = String((notesEl.value || "").length); };
      notesEl.addEventListener("input", updateCount);
      updateCount();
    }

    SLOTS.forEach((slot) => {
      const input = document.getElementById(`rp-edit-${slot}`);
      const label = document.getElementById(`rp-edit-${slot}-text`);
      const zone = input && input.closest(".drop-zone");
      if (!input) return;
      input.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        picked[slot] = f || null;
        if (label) {
          if (f) {
            label.textContent = `${f.name} — ${(f.size / 1024).toFixed(1)} KB`;
            if (zone) zone.classList.add("has-file");
          } else {
            label.textContent = DEFAULT_LABEL[slot];
            if (zone) zone.classList.remove("has-file");
          }
        }
        refreshSubmitState();
      });
      // Drag-drop support for parity with the main upload form.
      if (zone) {
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
        zone.addEventListener("drop", (e) => {
          e.preventDefault();
          zone.classList.remove("dragover");
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (!f) return;
          input.files = e.dataTransfer.files;
          input.dispatchEvent(new Event("change"));
        });
      }
    });

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        // Clear pickers so re-opening starts clean.
        SLOTS.forEach((slot) => {
          picked[slot] = null;
          const input = document.getElementById(`rp-edit-${slot}`);
          const label = document.getElementById(`rp-edit-${slot}-text`);
          const zone = input && input.closest(".drop-zone");
          if (input) input.value = "";
          if (label) label.textContent = DEFAULT_LABEL[slot];
          if (zone) zone.classList.remove("has-file");
        });
        if (msg) { msg.hidden = true; msg.textContent = ""; msg.className = "rp-edit-msg"; }
        refreshSubmitState();
        closeInlineEditForm();
      });
    }

    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const id = banner.applicationId;
        if (!id) {
          if (msg) {
            msg.textContent = "لم يكتمل التحليل الأصلي بعد. الرجاء الانتظار قليلًا ثم المحاولة من جديد.";
            msg.className = "rp-edit-msg rp-edit-msg--err";
            msg.hidden = false;
          }
          return;
        }
        const fd = new FormData();
        let appended = 0;
        for (const slot of SLOTS) {
          if (picked[slot]) {
            fd.append(SLOT_TO_FIELD[slot], picked[slot]);
            appended += 1;
          }
        }
        if (appended === 0) {
          if (msg) {
            msg.textContent = "الرجاء رفع ملف واحد على الأقل.";
            msg.className = "rp-edit-msg rp-edit-msg--err";
            msg.hidden = false;
          }
          return;
        }
        // Optional submitter notes — capped at 2000 chars on the backend
        // and gated by the textarea's maxlength on the frontend.
        const inlineNotesEl = document.getElementById("rp-edit-notes-input");
        const inlineNoteText = (inlineNotesEl && inlineNotesEl.value || "").trim();
        if (inlineNoteText) fd.append("notes", inlineNoteText);
        if (submitBtn) submitBtn.disabled = true;
        if (msg) { msg.hidden = true; msg.className = "rp-edit-msg"; }
        try {
          const res = await fetch(`/api/analyses/${encodeURIComponent(id)}/resubmit`, {
            method: "POST",
            body: fd,
          });
          if (!res.ok) {
            let detail = "تعذّر إعادة الرفع.";
            try { const b = await res.json(); if (b && b.detail) detail = b.detail; } catch {}
            if (msg) {
              msg.textContent = detail;
              msg.className = "rp-edit-msg rp-edit-msg--err";
              msg.hidden = false;
            }
            if (submitBtn) submitBtn.disabled = false;
            return;
          }
          let body = {};
          try { body = await res.json(); } catch {}
          const newId = body.analysis_id || id;
          const newJobId = body.job_id;
          const rerun = body.rerun || {};

          // Show the polished progress screen instead of the raw streaming
          // work-view. attachLiveResubmitStream below still re-attaches SSE
          // and resets carry-forward sections in the background; the user
          // just sees the loading view until `done` navigates them to
          // /app?a=<newId>. `expect` maps to which sub-pipelines are
          // re-running on this partial resubmit.
          if (typeof window.__showAnalysisLoadingView === "function") {
            try {
              // Forward the server's rerun map so each loading-view
              // stage knows whether it's actually running this round
              // (active spinner) or being carried forward from the
              // prior round (immediate green check). Without `agent`
              // here, a CAD-only resubmit would show stage 3 (rules)
              // stuck at "waiting" forever.
              window.__showAnalysisLoadingView({
                analysisId: newId,
                expect: {
                  agent:     !!rerun.agent,
                  deed:      !!rerun.deed,
                  floor:     !!rerun.floor,
                  site_plan: !!rerun.site_plan,
                  // Partial resubmits don't re-run extras (they're carried
                  // forward from the previous round), so 0 here keeps the
                  // expected-total math honest.
                  extras:    0,
                },
              });
            } catch (e) { console.error("show loading view (resubmit)", e); }
          }

          // Both source states (draft AND needs_revision) now stay on
          // /app: the live-stream attach swaps the URL to the new
          // analysis id, refreshes the panel state in place, and lets
          // the new pipeline's events stream into the same screen. The
          // user keeps the visual context they just acted on — only the
          // status chip flips ("قيد المراجعة" for needs_revision→
          // pending; "مسودة" stays for draft→draft). Read-only
          // detection in renderIssuesPanel hides the action footer
          // automatically once status leaves draft / needs_revision.
          attachLiveResubmitStream({
            newId,
            newJobId,
            rerun,
            // Filename labels for the per-slot statusbar text
            filenames: {
              cad: picked.cad && picked.cad.name,
              pdf_deed: picked.pdf_deed && picked.pdf_deed.name,
              pdf_floor: picked.pdf_floor && picked.pdf_floor.name,
              pdf_site_plan: picked.pdf_site_plan && picked.pdf_site_plan.name,
            },
          });
          // Refresh meta-derived UI (timeline, documents panel,
          // status chip, issues-panel read-only state) right away so
          // the resubmission entry shows up before the new pipeline's
          // SSE events even start landing.
          await refreshAnalysisInPlace(newId);

          // Form did its job — reset its file pickers + close it.
          SLOTS.forEach((slot) => {
            picked[slot] = null;
            const input = document.getElementById(`rp-edit-${slot}`);
            const label = document.getElementById(`rp-edit-${slot}-text`);
            const zone = input && input.closest(".drop-zone");
            if (input) input.value = "";
            if (label) label.textContent = DEFAULT_LABEL[slot];
            if (zone) zone.classList.remove("has-file");
          });
          refreshSubmitState();
          closeInlineEditForm();
        } catch (err) {
          if (msg) {
            msg.textContent = "خطأ في الاتصال: " + (err && err.message || err);
            msg.className = "rp-edit-msg rp-edit-msg--err";
            msg.hidden = false;
          }
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // After a partial resubmit lands, we keep the user on the same screen.
  // This:
  //   · updates the URL (history.replaceState) to /app?a=<new_id>
  //   · re-points banner.applicationId to the new analysis id
  //   · resets ONLY the sections being re-run + shows their pending state
  //   · clears the live-thinking feed (a fresh agent run is about to start)
  //   · resets the missing-data table (rows are about to be re-emitted)
  //   · disables the submit buttons until the new `done` arrives
  //   · attaches the new pipeline's SSE stream
  function attachLiveResubmitStream({ newId, newJobId, rerun, filenames }) {
    const helpers = window.__appHelpers || {};

    // Bump the analysis-generation counter and close any prior SSE
    // stream BEFORE we touch state. Without this, a late `missing_data`
    // event from the previous pipeline can race the new one and inject
    // a stale row into the new panel. The generation counter is the
    // belt; closing the prior EventSource is the suspenders.
    window.__analysisGen = (window.__analysisGen || 0) + 1;
    if (window.__currentEventSource && typeof window.__currentEventSource.close === "function") {
      try { window.__currentEventSource.close(); } catch {}
    }
    window.__currentEventSource = null;

    // 1) URL + applicationId
    try {
      window.history.replaceState({}, "", `/app?a=${encodeURIComponent(newId)}`);
    } catch {}
    banner.applicationId = newId;

    // 2) Reset only the slots being re-run. Everything else carries over.
    if (rerun.deed && helpers.resetPdfSection) {
      helpers.resetPdfSection();
      if (helpers.showPdfPending) helpers.showPdfPending();
    }
    if (rerun.floor && helpers.resetFloorSection) {
      helpers.resetFloorSection();
      if (helpers.showFloorPending) helpers.showFloorPending();
    }
    if (rerun.site_plan && helpers.resetSitePlanSection) {
      helpers.resetSitePlanSection();
      if (helpers.showSitePlanPending) helpers.showSitePlanPending();
    }
    if (rerun.agent) {
      // Agent rerun affects the CAD chart + CAD-derived KPIs + setbacks.
      // Use the targeted CAD-only reset so the floor-PDF KPIs (number of
      // floors, floors total, floor coverage ratio) stay populated from
      // the carried-over previous analysis — those don't re-emit events
      // because the floor pipeline isn't being re-run.
      if (window.__reviewerBanner && window.__reviewerBanner.resetCadOnly) {
        try { window.__reviewerBanner.resetCadOnly(); } catch {}
      }
      // Re-show the chart loading spinner.
      const drawingLoading = document.getElementById("drawing-loading");
      if (drawingLoading) drawingLoading.hidden = false;
      const drawingImg = document.getElementById("drawing-img");
      if (drawingImg) drawingImg.removeAttribute("src");
      // Re-show the KPI / setback section spinners.
      ["rb-kpis-spinner", "rb-setbacks-spinner"].forEach((id) => {
        const sp = document.getElementById(id);
        if (sp) sp.hidden = false;
      });
    }

    // 3) Live thinking + missing data — a fresh pipeline cycle is about to
    // emit new events, so wipe the stale ones.
    if (helpers.resetFeed) helpers.resetFeed();
    if (helpers.resetMissingData) helpers.resetMissingData();

    // 4) Statusbar — show "analyzing" with the file(s) being re-uploaded.
    const fileList = Object.entries(filenames || {})
      .filter(([_, v]) => !!v).map(([_, v]) => v).join(" + ");
    if (helpers.setStreamingStatus) helpers.setStreamingStatus(fileList);

    // 5) Submitter action bar — re-disable the submit buttons; the new
    // `done` will re-enable them when the partial pipeline completes.
    if (window.__submitterActions && window.__submitterActions.markBusy) {
      window.__submitterActions.markBusy();
    }
    // Also clear the cached missing-data so the inline form's flag
    // derivation starts fresh on the next open.
    try {
      if (window.__missingData) {
        window.__missingData.rows = [];
        if (window.__missingData.keys && window.__missingData.keys.clear) window.__missingData.keys.clear();
      }
      window.__loadedAnalysisMissingData = [];
    } catch {}

    // 6) Open the new SSE on the freshly-spawned pipeline. Stamp the
    // current generation onto it so the patched EventSource constructor
    // can ignore late events from any earlier stream.
    if (newJobId && window.attachEventStream) {
      try {
        const es = new EventSource(`/api/jobs/${encodeURIComponent(newJobId)}/events`);
        es.__gen = window.__analysisGen;
        window.__currentEventSource = es;
        window.attachEventStream(es);
      } catch (err) {
        console.error("attach resubmit SSE", err);
      }
    }
  }

  async function resolveApplicationIdFromLatest() {
    try {
      const res = await fetch("/api/analyses", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const items = (data && data.items) || [];
      if (items.length === 0) return;
      const first = items[0];
      banner.applicationId = first.id;
      setStatusOnBanner(first.review_status || "pending");
      setTypeOnBanner(first.application_type || banner.applicationType);
      if (first.owner && el.owner && el.owner.textContent === "—") {
        el.owner.textContent = first.owner;
      }
    } catch (err) { /* non-fatal */ }
  }

  // --- Auto-load from ?a=<id> ----------------------------------------------
  // Dashboard "Open" links route here with ?a=<analysis_id>. Load the saved
  // JSON and populate everything the banner needs (we don't re-run analysis).
  async function autoLoadFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("a");
    if (!id) return;

    try {
      // Fetch the analysis detail and the events log in parallel. The
      // detail call no longer carries `events` by default (split out in
      // the events sub-endpoint to keep payloads small), so a separate
      // fetch is required for the replay path that drives setback tiles,
      // tool cards, and the compliance / fine widgets on the banner.
      const [res, evRes] = await Promise.all([
        fetch(`/api/analyses/${encodeURIComponent(id)}`, { cache: "no-store" }),
        fetch(`/api/analyses/${encodeURIComponent(id)}/events`, { cache: "no-store" }),
      ]);
      if (!res.ok) return;
      const data = await res.json();
      let eventsForReplay = null;
      if (evRes && evRes.ok) {
        try {
          const evBody = await evRes.json();
          if (evBody && Array.isArray(evBody.events)) eventsForReplay = evBody.events;
        } catch { /* fall through to data.events back-compat */ }
      }
      const meta0 = data.meta || {};

      // /app is the unified home for the submitter at every stage of
      // their application — draft preview, post-submit "in review",
      // returned-for-revision, approved, rejected. The issues panel and
      // documents panel both render role-aware read-only states for
      // pending/approved/rejected, so there's no separate submitter
      // detail page.

      banner.applicationId = id;
      const meta = meta0;
      banner.submittedBy = meta.submitted_by || "";
      setTypeOnBanner(meta.application_type || "initial_consultation");
      setStatusOnBanner(meta.review_status || "pending");

      // Stash meta + missing_data so the inline edit form (draft preview)
      // can read current filenames + flagged slots without re-fetching.
      window.__loadedAnalysisMeta = meta;
      window.__loadedAnalysisMissingData = data.missing_data || [];

      // Hand previous-round carryforward (comments + keys + summary) to
      // the issues-panel render so cards can show prior reviewer
      // comments and the "✓ resolved" strip can render.
      if (typeof window.__setPreviousRound === "function") {
        try { window.__setPreviousRound(meta); } catch {}
      }
      // The "submitted with known issues" chip is now part of the
      // issues panel itself (#ip-known-chip) and the panel's render
      // owns its visibility — no direct DOM toggle needed here.

      // Move directly to the work view and reveal the results shell
      const uploadView = document.getElementById("upload-view");
      const workView = document.getElementById("work-view");
      const resultContent = document.getElementById("result-content");
      const resultPlaceholder = document.getElementById("result-placeholder");
      const statusTitle = document.getElementById("status-title");
      const statusSpinner = document.getElementById("status-spinner");
      const newUploadBtn = document.getElementById("new-upload-btn");
      if (uploadView) uploadView.hidden = true;
      if (workView) workView.hidden = false;
      if (resultPlaceholder) resultPlaceholder.hidden = true;
      if (resultContent) resultContent.hidden = false;
      if (statusTitle) {
        statusTitle.setAttribute("data-i18n", "rb.loaded_archive");
        statusTitle.textContent = tr("rb.loaded_archive", "Loaded from archive");
      }
      if (statusSpinner) statusSpinner.style.display = "none";
      if (newUploadBtn) newUploadBtn.hidden = false;

      // Banner
      applyPdf(data.pdf_result);
      applyCad(data.result);
      applyFloor(data.floor_result);
      // Site-plan must also be applied so the compare tiles (coverage,
      // floor coverage, floor count) get their rulebook side restored.
      // The replay-path call site for live runs is renderSitePlanContent
      // → applySitePlan; this is the equivalent for archive opens.
      applySitePlan(data.site_plan_result);

      // Comprehensive communication timeline inside the review panel.
      // Rendered for both reviewer and submitter views of the same /app
      // page — every submission, every reviewer decision, every
      // resubmission.
      if (typeof window.__renderReviewTimeline === "function") {
        window.__renderReviewTimeline(meta.reviewer_notes_history || []);
      }

      // Documents panel — fetches /api/analyses/{id}/history and renders
      // every uploaded file across the resubmit chain with download links.
      // Both reviewer and submitter see this panel (the reviewer audits
      // what was submitted, the submitter verifies what they sent).
      if (typeof window.__renderDocumentsPanel === "function") {
        try { window.__renderDocumentsPanel(id); } catch {}
      }

      // Measurement viewer launcher — un-hide the rb-measure-btn iff the
      // submitter attached the optional 5th file (a vector PDF used by
      // the in-browser PDF.js viewer + measure tool). Hidden otherwise.
      if (typeof window.__configureMeasurementViewer === "function") {
        try { window.__configureMeasurementViewer(id, meta); } catch {}
      }

      // Rounds panel — round-centric consolidation that visually
      // replaces the legacy timeline + documents + issues sections.
      // Runs after both legacy renderers so #issues-panel is fully
      // populated before we re-parent it into the active round card.
      if (typeof window.__renderRoundsPanel === "function") {
        try { window.__renderRoundsPanel(id); } catch {}
      }

      // Fill the inner results (reuse app.js helpers where possible)
      try {
        if (typeof window.showResultPane === "function" && data.result) {
          window.showResultPane(data.result);
        }
      } catch (err) { /* non-fatal */ }

      // Document sections — leverage existing renderers if they are global.
      //
      // Each renderer is called BEFORE replayEvents so the archive-open path
      // populates the same caches the live SSE handlers populate. Crucially,
      // this is how we cover the partial-resubmit case: when the submitter
      // re-uploaded only one or two slots, the new pipeline emits events for
      // ONLY those slots — but the analysis JSON still carries forward the
      // unchanged pipelines' results. Without these calls, archive open on a
      // partial-resubmit would leave caches like `lastSitePlanData` null,
      // causing the reviewer's identity tiles (village / zoning / building
      // number / street) and the coverage compare tile to render blank.
      // (Replay-fires of the same renderer are idempotent — no double-paint.)
      try {
        if (typeof window.renderPdfContent === "function" && data.pdf_result) {
          const pdfSection = document.getElementById("pdf-section");
          if (pdfSection) pdfSection.hidden = false;
          window.renderPdfContent(data.pdf_result);
        }
      } catch (err) { /* non-fatal */ }
      try {
        if (typeof window.renderFloorContent === "function" && data.floor_result) {
          const floorSection = document.getElementById("floor-section");
          if (floorSection) floorSection.hidden = false;
          window.renderFloorContent(data.floor_result);
        }
      } catch (err) { /* non-fatal */ }
      // Site plan — same pattern as the deed + floor renderers above.
      // Populates `lastSitePlanData` (read by aggregateAppData for village /
      // zoning / building / street fallback fields). Without this, partial-
      // resubmit archive opens drop every site-plan-derived field on the
      // reviewer banner. Section is only revealed when there's actual data.
      try {
        if (typeof window.renderSitePlanContent === "function" && data.site_plan_result) {
          const sitePlanSection = document.getElementById("site-plan-section");
          if (sitePlanSection) sitePlanSection.hidden = false;
          window.renderSitePlanContent(data.site_plan_result);
        }
      } catch (err) { /* non-fatal */ }
      try {
        if (typeof window.renderExtrasFromSaved === "function" && Array.isArray(data.extras_results)) {
          window.renderExtrasFromSaved(data.extras_results);
        }
      } catch (err) { /* non-fatal */ }

      // Replay the full event stream so the Live-thinking pane, tool cards,
      // reasoning deltas, and token counters look identical to the in-app
      // "History" panel path. Archive mode suppresses the live-only
      // "Uploading…/Connected" noise.
      try {
        document.body.classList.add("is-archive");
        const pulseLabel = document.querySelector(".pane-pulse-label");
        if (pulseLabel) {
          pulseLabel.removeAttribute("data-i18n");
          pulseLabel.textContent = "Archive";
        }
        // Prefer the events sub-endpoint (current path); fall back to
        // any legacy `data.events` for older saved files or clients that
        // opted into ?include_events=true on the detail call.
        const eventsToReplay = Array.isArray(eventsForReplay)
          ? eventsForReplay
          : (Array.isArray(data.events) ? data.events : null);
        if (typeof window.replayEvents === "function" && eventsToReplay) {
          if ("isReplayingArchive" in window) window.isReplayingArchive = true;
          try { window.replayEvents(eventsToReplay); }
          finally { if ("isReplayingArchive" in window) window.isReplayingArchive = false; }
        }
        // Per-row reviewer comments live on the persisted missing_data
        // rows, not on the event log (they're added later via PATCH).
        // Overlay them after the replay populates the table so the
        // comment column shows the reviewer's text on dashboard re-open.
        if (typeof window.overlayMissingDataComments === "function") {
          try { window.overlayMissingDataComments(data.missing_data || []); }
          catch (err) { console.error("overlay-comments", err); }
        }
      } catch (err) { /* non-fatal */ }

      // Title — use the dashboard-style "قطعة X · village" composed from
      // the deed PDF's plot/village/basin fields. Falls back to the
      // cleaned filename only when the deed didn't surface any
      // identifying info, then to the file id as a last resort.
      // applyPdf() above sets the same string when the deed has plot+
      // village; this block runs after to cover the no-deed-yet case
      // and to override any stale fallback set elsewhere.
      if (el.title) {
        el.title.textContent = _prettyAppNameFromAnalysis(data);
      }
      if (el.sub) {
        el.sub.setAttribute("data-i18n", "rb.archive_sub");
        el.sub.textContent = tr("rb.archive_sub", "Archived analysis · reviewer overview");
      }

      // Submitter re-opening their own draft from the dashboard. Only flip
      // the submit buttons live if the pipeline already finished — coming
      // back to a still-running stub leaves the buttons disabled and the
      // user can refresh once the dashboard shows "اكتمل التحليل".
      if (IS_SUBMITTER && window.__submitterActions) {
        const pipelineDone = (data.status === "done" || data.status === "error");
        if (pipelineDone) window.__submitterActions.markReady();
        window.__submitterActions.showState();
      }

      // Submitter blocked-state hijack. If this analysis was halted by a
      // pre-agent gate (missing CAD layer, deed↔site-plan identity
      // mismatch), bounce the submitter from the work view back to the
      // upload screen with the blocking AI notes pinned at the top.
      // Reviewers stay on the work view — they can still audit a blocked
      // analysis read-only. The setTimeout(0) lets the rest of the
      // archive-load finish writing into __missingData / the panels
      // before we swap views, so a future "back to work" path has a
      // fully populated state to fall back on.
      if (IS_SUBMITTER && meta.blocking_issues_present
          && typeof window.__showUploadViewBlocked === "function") {
        setTimeout(() => {
          try {
            const rows = (data.missing_data || []).filter((r) => r && r.blocking);
            window.__showUploadViewBlocked(rows, meta.blocked_reason);
          } catch (err) { console.error("blocked-redirect", err); }
        }, 0);
      }
    } catch (err) {
      console.error("autoLoadFromQuery", err);
    }
  }

  // --- Kick off -------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    setTypeOnBanner("initial_consultation");
    setStatusOnBanner(IS_SUBMITTER ? "draft" : "pending");
    initSubmitterActions();
    initInlineEditForm();
    autoLoadFromQuery();
  });
})();
