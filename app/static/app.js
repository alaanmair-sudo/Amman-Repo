"use strict";

/* ============================================================
   Route guard — runs before any other app.js logic so wrong-role
   users end up on the right page instead of seeing a half-broken UI.

     · No session                      → /login
     · Reviewer  + no ?a               → /dashboard       (reviewers don't upload)
     · Submitter, no id                → keep — upload form is fine
     · Submitter + ?a=<id>             → keep — /app is the unified
                                         per-application view for the
                                         submitter at every stage
                                         (draft, pending, returned-for-
                                         revision, approved, rejected);
                                         the page renders role-aware
                                         read-only states for non-draft.
     · Reviewer  + ?a                  → keep — full analysis view

   The guard lives at the top of app.js so redirects happen before
   any DOM queries run.
   ============================================================ */
(function routeGuard() {
  const auth = window.SAAuth;
  const session = auth && auth.readSession && auth.readSession();
  if (!session) {
    window.location.replace("/login");
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const hasId = !!params.get("a");
  if (session.role === "reviewer" && !hasId) {
    window.location.replace("/dashboard");
    return;
  }
})();

// Module-level role flag — set once at startup so renderers below can
// branch reviewer-vs-submitter UI without re-reading the session each
// time. Falls back to reviewer to keep current visual defaults if
// somehow the session is missing (route guard would have redirected).
const __APP_SESSION = (window.SAAuth && window.SAAuth.readSession && window.SAAuth.readSession()) || {};
const __APP_IS_REVIEWER = __APP_SESSION.role === "reviewer";
const __APP_IS_SUBMITTER = __APP_SESSION.role === "submitter";

/* ============================================================
   i18n — frontend-only translation layer. No backend dependency.
   English is always authoritative and acts as the fallback.
   ============================================================ */

const I18N = {
  en: {
    "ui.lang.toggle": "Toggle language",
    "app.title": "Greater Amman Municipality Smart System",
    "app.subtitle": "AI-powered building permit review platform",
    "upload.eyebrow": "Analysis engine",
    "upload.title": "Drop your files",
    "upload.tagline": "Drop any combination — CAD drawing, سند التسجيل PDF, خطة مساحة الطابقية PDF. All three pipelines run in parallel, results shown side by side.",
    "sg.title":           "Before you start — acceptance requirements",
    "sg.intro":           "To make sure your application is accepted and reviewed smoothly, check the requirements below before uploading.",
    "sg.toggle":          "Toggle guide",
    "sg.s1.title":        "Required documents",
    "sg.s1.doc_cad":      "CAD drawing (DWG / DXF / DWF)",
    "sg.s1.doc_deed":     "سند التسجيل — PDF",
    "sg.s1.doc_floor":    "خطة مساحة الطابقية — PDF",
    "sg.s1.doc_site_plan":"مخطط موقع تنظيمي — PDF",
    "sg.s1.hint":         "All four documents are required to start the analysis.",
    "sg.s2.title":        "CAD drawing requirements",
    "sg.s2.layer_building":"Layer named <code>BUILDING</code> or <code>BLDG</code> containing the building as a closed polyline",
    "sg.s2.layer_lot":    "Layer named <code>LOT</code> or <code>LOT_BOUNDARY</code> containing the lot as a closed polyline",
    "sg.s2.layer_street": "Layer named <code>STREET</code> or <code>ROAD</code> on the centerline of the adjacent street",
    "sg.s2.inside_lot":   "The building sits entirely inside the lot boundary",
    "sg.s2.closed":       "Every polyline is closed — the end point connects back to the start",
    "sg.s3.title":        "Regulatory site plan",
    "sg.s3.title_match":  "File carries the official title «مخطط موقع تنظيمي»",
    "sg.s3.issuer":       "Issued by Amanah / the relevant municipality",
    "sg.s3.setbacks":     "Front / side / rear setbacks are legible under the «الارتدادات (متر)» column",
    "sg.s4.title":        "Regulatory compliance",
    "sg.s4.setbacks":     "The building respects the setbacks declared in the site plan",
    "sg.s4.coverage":     "Coverage ratio does not exceed the allowed percentage in the site plan",
    "sg.s4.hint":         "If violations are found, the application is returned for adjustment with the reviewer's notes.",
    "upload.cad.eyebrow": "CAD · required",
    "upload.cad.text": "Drop CAD drawing",
    "upload.pdf.eyebrow": "سند التسجيل · required",
    "upload.pdf.text": "Drop سند التسجيل PDF",
    "upload.pdf.hint": "AI summary",
    "upload.floor.eyebrow": "خطة مساحة الطابقية · required",
    "upload.floor.text": "Drop floor-area plan PDF",
    "upload.floor.hint": "Per-floor tables vs. lot area",
    "upload.analyze": "Analyze",
    "status.analyzing": "Analyzing your drawing…",
    "status.analyzing_docs": "Analyzing your documents…",
    "status.uploading": "Uploading your drawing…",
    "status.uploading_docs": "Uploading your documents…",
    "status.done": "Analysis complete",
    "status.stopped": "Analysis stopped",
    "status.steps": "Steps",
    "status.tokens": "Tokens",
    "status.turn": "Turn",
    "status.new": "New drawing",
    "think.label": "Live thinking",
    "think.sub": "Every tool call and AI reasoning, as it streams",
    "think.streaming": "Streaming",
    "result.label": "Analysis",
    "result.waiting": "Finalizing analysis…",
    "result.just_now": "Completed just now",
    "placeholder.title": "Results appear here as soon as analysis finishes",
    "placeholder.item3": "Full report (markdown + JSON)",
    "drawing.loading": "Preparing setback visualization…",
    "summary.claude": "AI summary",
    "pdf.summary": "PDF summary",
    "pdf.reading": "Reading the land-record PDF…",
    "pdf.extracted": "Extracted by AI",
    "pdf.failed": "Failed to read the PDF",
    "pdf.claude_reading": "Reading the PDF…",
    "pdf.other": "Other fields extracted",
    "pdf.empty": "No identifying fields extracted.",
    "pdf.field.plot_number": "Plot number",
    "pdf.field.num_floors": "Number of floors",
    "pdf.field.basin_number": "Basin number",
    "pdf.field.basin_name": "Basin name",
    "pdf.field.village": "Village",
    "pdf.field.village_combined": "Village (number + name)",
    "pdf.field.building_number": "Building number",
    "pdf.field.street_name": "Street name",
    "pdf.field.num_streets": "Number of streets",
    "pdf.field.area": "Area",
    "metric.coverage": "Building coverage and setbacks",
    "metric.building": "Building",
    "metric.lot": "Lot",
    "metric.penalty": "Setback penalty",
    "metric.threshold": "Threshold",
    "metric.threshold.aria": "Setback threshold in meters",
    "metric.meter_abbr": "m",
    "metric.rule_text": "deficit (rounded up to whole m) × configured rate per side",
    "metric.compliant": "All sides ≥ {threshold} m — compliant, no penalty",
    "metric.jod": "JOD",
    "report.markdown": "Full markdown report",
    "report.json": "Raw JSON",
    "step.status.running": "running",
    "step.status.done": "done",
    "step.status.error": "error",
    "error.title": "Something went wrong",
    "error.start_over": "Start over",
    "stream_error.title": "Analysis could not be completed",
    "stream_error.retry": "Start over",
    // tool step labels (used by TOOL_INFO)
    "tool.convert.title": "Preparing the drawing",
    "tool.convert.running": "Normalizing to DWG if needed…",
    "tool.convert.done.converted": "Converted {ext} → DWG via reaConverter",
    "tool.convert.done.already": "Already {ext} — no conversion needed",
    "tool.open.title": "Opening in AutoCAD",
    "tool.open.running": "Loading drawing in AutoCAD LT…",
    "tool.open.done": "Opened in AutoCAD",
    "tool.layers.title": "Reading layer list",
    "tool.layers.running": "Listing all layers in the drawing…",
    "tool.layers.done": "Found {count} layers",
    "tool.extract.title": "Extracting {role} boundary",
    "tool.extract.running": "Reading polylines on \"{layer}\"…",
    "tool.extract.done": "{count} entities on \"{layer}\"",
    "tool.stitch.title": "Stitching {label} polygon",
    "tool.stitch.running": "Closing gaps between segments…",
    "tool.stitch.done": "Polygon area {area}, {vertices} vertices",
    "tool.setbacks.title": "Computing setbacks",
    "tool.setbacks.running": "Measuring each building edge to nearest lot edge…",
    "tool.setbacks.done": "{count} edges",
    "tool.street.title": "Identifying street edges",
    "tool.street.running": "Reading the STREET layer…",
    "tool.street.done": "{count} street segments",
    "tool.compliance.title": "Checking regulatory setbacks",
    "tool.compliance.running": "Comparing actual vs. allowed setbacks…",
    "tool.compliance.done": "Compliance evaluated",
    "tool.visualize.title": "Rendering visualization",
    "tool.visualize.running": "Drawing the setback diagram…",
    "tool.visualize.done": "Rendered PNG ({size} KB)",
    "tool.finalize.title": "Packaging report",
    "tool.finalize.running": "Putting together the final report…",
    "tool.finalize.done": "Report complete — {edges} edge setbacks",
    "role.building": "building",
    "role.lot": "lot",
    "role.geometry": "geometry",
    "label.building": "building",
    "label.lot": "lot",
    "label.boundary": "boundary",
    // system log messages
    "sys.uploading": "Uploading {name}",
    "sys.uploaded": "Uploaded — job {id}",
    "sys.uploaded.with_pdf": "Uploaded — job {id} (with PDF)",
    "sys.model_engaged": "Model {model} engaged",
    "sys.connected": "Connected to AutoCAD LT",
    "sys.pdf_started": "PDF analysis started",
    "sys.pdf_complete": "PDF analysis complete",
    "sys.pdf_failed": "PDF analysis failed",
    "sys.floor_started": "Floor-area plan analysis started",
    "sys.floor_complete": "Floor-area plan analysis complete",
    "sys.floor_failed": "Floor-area plan analysis failed",
    "sys.extra_started": "Extracting additional PDF: {name}",
    "sys.extra_complete": "Additional PDF extracted: {name}",
    "sys.extra_failed": "Additional PDF extraction failed: {name}",
    "app_summary.eyebrow": "Application data",
    "app_summary.sub": "Merged from all uploaded PDFs · duplicates removed",
    "app_summary.identity": "Application identity",
    "app_summary.building": "Building & project",
    "app_summary.other": "Other extracted data",
    "app_summary.empty_identity": "No identity fields extracted yet.",
    "app_summary.empty_building": "No building or project fields extracted yet.",
    "upload.extras.eyebrow": "وثائق إضافية · optional",
    "upload.extras.text": "Drop additional PDFs",
    "upload.extras.hint": "Multiple files · extracted each",
    "extras.summary": "Additional PDFs",
    "extras.reading": "Reading additional PDFs…",
    "extras.empty": "No additional PDFs were uploaded.",
    "extras.failed": "Failed to read this PDF",
    "extras.waiting": "Queued — waiting for analysis…",
    "extras.done.one": "1 PDF extracted",
    "extras.done.many": "{n} PDFs extracted",
    "extras.pending.one": "1 pending",
    "extras.pending.many": "{n} pending",
    // Site plan (مخطط موقع تنظيمي) — drop zone, card, statuses
    "upload.site_plan.eyebrow": "مخطط موقع تنظيمي · required",
    "upload.site_plan.text": "Drop site-plan PDF",
    "upload.site_plan.hint": "Required setbacks · compliance",
    // Measurement PDF — OPTIONAL viewer-only drop zone (the 5th tile)
    "upload.measurement.eyebrow": "Measurement PDF · optional",
    "upload.measurement.text": "Drop a measurement PDF",
    "upload.measurement.hint": "View · pan · zoom · measure",
    "rb.measure.open": "Open measurement tool",
    "site_plan.summary": "Regulatory site plan",
    "site_plan.reading": "Reading the مخطط موقع تنظيمي…",
    "site_plan.claude_reading": "Reading the site-plan PDF…",
    "site_plan.failed": "Failed to read the site-plan PDF",
    "site_plan.wrong_document": "Uploaded PDF is not a regulatory site plan",
    "site_plan.extraction_failed": "Could not read the required setbacks",
    "site_plan.done": "Required setbacks extracted",
    "site_plan.field.front": "Front (امامي)",
    "site_plan.field.side":  "Side (جانبي)",
    "site_plan.field.rear":  "Rear (خلفي)",
    "site_plan.field.corner": "Corner lot",
    "site_plan.field.use":    "Use type",
    "site_plan.value.corner_yes": "Yes (2 streets)",
    "site_plan.value.corner_no":  "No",
    "site_plan.value.rear_corner": "— (corner lot)",
    "sys.site_plan_started":  "Reading the regulatory site plan PDF…",
    "sys.site_plan_complete": "Regulatory site plan extracted",
    "sys.site_plan_failed":   "Regulatory site plan extraction failed",
    "pdf.field.project_name": "Project name",
    "pdf.field.owner": "Owner",
    "pdf.field.building_type": "Building type",
    "pdf.field.zoning_region": "Zoning region",
    "pdf.field.neighborhood": "Neighborhood",
    "pdf.field.engineer": "Engineer",
    "pdf.field.registration_number": "Registration number",
    "pdf.field.document_date": "Document date",
    "floor.summary": "Floor-area plan",
    "floor.reading": "Reading the floor-area plan PDF…",
    "floor.extracted": "Extracted by AI",
    "floor.failed": "Failed to read the floor-area plan PDF",
    "floor.claude_reading": "Reading the floor-area plan…",
    "floor.building_total": "Building total (PDF)",
    "floor.licensed_total": "Licensed total (PDF)",
    "floor.mismatch_count": "{n} row(s) where dim × qty ≠ printed total (±1 m²).",
    "floor.no_mismatches": "Every row's dim × qty matches the printed total within ±1 m².",
    "floor.lot_area": "Lot area (سند)",
    "floor.floor_sum": "Floor sum",
    "floor.ratio": "Floors ÷ Lot",
    "floor.over": "Floor sum exceeds lot area",
    "floor.under": "Floor sum is within lot area",
    "floor.no_deed": "Upload سند التسجيل to compute the ratio.",
    "floor.col.no": "#",
    "floor.col.dims": "Dimensions",
    "floor.col.qty": "QTY",
    "floor.col.sign": "±",
    "floor.col.printed": "Area m² (PDF)",
    "floor.col.computed": "Dim × Qty (Python)",
    "floor.col.flag": "",
    "floor.by_autocad": "By AutoCAD",
    "floor.subtotal": "Subtotal (PDF)",
    "floor.mismatch_badge": "Mismatch",
    "floor.verified": "Verified",
    "floor.verified.tip": "Re-read in a verification pass.",
    "floor.verified.changed.tip": "Re-read in a verification pass and some rows changed.",
    "floor.qty.multi": "This breakdown applies to N identical floors",
    "floor.page": "p.",
    "reasoning.label": "AI reasoning",
    "history.button": "History",
    "history.toggle": "Open analysis history",
    "history.title": "Past analyses",
    "history.sub": "Click any to re-open. Trash to delete.",
    "history.close": "Close history",
    "history.empty": "No analyses saved yet. Run one and it'll appear here.",
    "history.delete_confirm": "Delete this analysis? This cannot be undone.",
    "history.replay_banner": "Loaded from history — {name}",
    "history.failed": "Failed to load analysis history.",
    "history.load_failed": "Failed to load this analysis.",
    "history.delete_failed": "Failed to delete this analysis.",
    "history.no_cad": "(no CAD)",
    // Dashboard zone labels (result pane sections)
    "dash.metrics":        "Key metrics",
    "dash.metrics.hint":   "coverage · setback compliance",
    "dash.geometry":       "Setback geometry",
    "dash.geometry.hint":  "per-side distances from building to lot edges",
    "dash.docs":           "Document intelligence",
    "dash.docs.hint":      "extracted by AI from your PDFs",
    "dash.reports":        "Raw output",
    "dash.reports.hint":   "full markdown report · raw JSON",
    // Topbar
    "ui.dashboard":        "Dashboard",
    "ui.signout":          "Sign out",
    // Intake card
    "intake.eyebrow":      "Application intake",
    "intake.sub":          "Classify this permit for the dashboard",
    "intake.type":         "Application type",
    "intake.submitter":    "Submitted by (optional)",
    "intake.submitter.placeholder": "Owner / applicant name",
    "apptype.initial_consultation":               "Initial consultation (preliminary approval)",
    "apptype.technical_consultation":             "Technical consultation",
    "apptype.permit_vacant_land":                 "Proposed permit on vacant land",
    "apptype.permit_over_existing":               "Proposed permit over existing",
    "apptype.amended_plan_permit":                "Amended plan permit",
    "apptype.permit_cancellation":                "Permit cancellation",
    "apptype.occupancy_permit":                   "Occupancy permit",
    "apptype.occupancy_renewal":                  "Occupancy renewal",
    "apptype.occupancy_doc_correction":           "Occupancy document correction",
    "apptype.occupancy_renewal_doc_correction":   "Occupancy renewal document correction",
    "apptype.additions_permit":                   "Additions permit",
    "apptype.additions_permit_with_occupancy":    "Additions permit + occupancy",
    "apptype.existing_areas_permit_with_occupancy": "Existing areas permit + occupancy",
    "apptype.first_time_existing_building":       "Existing building registered for the first time",
    "apptype.deposit_forfeiture":                 "Deposit forfeiture",
    "apptype.central_committee_review":           "Central Planning Committee (regional) decision review",
    "apptype.other":                              "Other",
    // Reviewer banner
    "rb.title":            "Application summary",
    "rb.approve":          "Approve",
    "rb.reject":           "Reject",
    "rb.status.draft":     "Draft — pre-submission preview",
    "rb.status.pending":   "Pending review",
    "rb.status.approved":  "Approved",
    "rb.status.rejected":  "Rejected",
    "rb.status.needs_revision": "Needs revision",
    // Submitter pre-submit preview bar
    "sub.preview.clean":        "The smart system found no issues with your application. You can send it to the reviewer now.",
    "sub.preview.send":         "Send for review",
    "sub.preview.issues.title": "The smart system flagged items in your application",
    "sub.preview.issues.sub":   "Editing the files before sending is recommended to avoid delays. You can submit anyway, but the reviewer will see that the application was sent with known issues.",
    "sub.preview.edit":         "Edit files & re-upload",
    "sub.preview.send_anyway":  "Submit anyway",
    "sub.preview.confirm.msg":  "Confirm submission: your application will appear in the reviewer's queue with a \"Submitted with known issues\" badge, and the decision may take longer than usual. Continue?",
    "sub.preview.confirm.cancel": "Cancel",
    "sub.preview.confirm.yes":    "Yes, send for review",
    "rp.known_issues.title":    "This application was sent despite smart-system warnings",
    "rp.known_issues.sub":      "The submitter saw the items below and chose to proceed. Review them carefully before deciding.",
    "sub.preview.edit.title":   "Upload a corrected version of the flagged file(s)",
    "sub.preview.edit.sub":     "Only upload the documents the system flagged — every other file stays exactly as it is and we re-analyze just the new uploads.",
    "sub.preview.edit.cancel":  "Cancel",
    "sub.preview.edit.submit":  "Upload & re-analyze",
    "sub.nr.title":             "The reviewer returned your application for revision",
    "rp.title":            "Application review",
    "rp.col.document":     "Document",
    "rp.col.issue":        "Missing data",
    "rp.col.action":       "Required action",
    "rp.col.comment":      "Reviewer comment",
    "rp.needs_revision":   "Return to submitter",
    // ── Issues panel (.ip) — single shell for missing-data cards ──
    "ip.cta.edit":               "Edit files & re-upload",
    "ip.chip.known_issues":      "Submitted despite known smart-system warnings",
    "ip.rn.title":               "Reviewer's overall note",
    "ip.status.clean":           "No issues flagged · ready to send",
    "ip.status.review_pending":  "No issues flagged · ready to review",
    "ip.status.needs_revision":  "Needs revision · {n} item{plural}",
    "ip.status.review":          "{n} item{plural} flagged",
    "ip.status.sub.persistent":  "{n} carried over from the previous round",
    "ip.status.sub.new":         "{n} new this round",
    "ip.status.sub.mixed":       "{npersist} carried over · {nnew} new",
    "ip.card.status.persistent": "Still flagged",
    "ip.card.status.new":        "New this round",
    "ip.group.count":            "{n} observations",
    "ip.card.rcmt.label":        "Note for the submitter (optional)",
    "ip.card.rcmt.placeholder":  "Specific guidance on this item — optional.",
    "ip.card.prev.toggle":       "Show previous-round reviewer comment",
    "ip.card.edit_this":         "Edit this document",
    "ip.resolved.title":         "Resolved in this round",
    "ip.rev.note_label":         "Overall note for the submitter",
    "ip.rev.note_optional":      "(optional)",
    "ip.rev.note_placeholder":   "Brief overall note (optional). Per-item guidance lives inside the cards above.",
    "ip.confirm.cancel":         "Cancel",
    "ip.confirm.approve.msg_pre":  "This application has",
    "ip.confirm.approve.msg_post": "unresolved item(s). Approve anyway?",
    "ip.confirm.approve.yes":      "Yes, approve with notes",
    "ip.confirm.reject.msg":       "This will reject the application — the decision is final and cannot be undone. Are you sure?",
    "ip.confirm.reject.yes":       "Yes, reject",
    // ── Read-only submitter status messages (post-submit) ──
    "ip.status.pending":      "In review · the reviewer will respond soon",
    "ip.status.approved":     "Approved",
    "ip.status.rejected":     "Rejected",
    // ── Documents panel ──
    "dp.title":               "Application documents",
    "dp.prev.toggle":         "Show previous document versions",
    "rb.section.identity": "Application identity",
    "rb.section.building": "Project & building",
    "rb.section.details":  "Application details",
    "rb.section.kpis":     "Key indicators",
    "rb.section.setbacks": "Minimum setback",
    "rb.kpi.building_area": "Building area",
    "rb.kpi.lot_area":      "Lot area",
    "rb.kpi.coverage":      "Coverage",
    "rb.kpi.penalty":       "Setback fines",
    "rb.kpi.floor_printed": "Floors total (printed)",
    "rb.kpi.floor_computed":"Floors total (computed)",
    "rb.kpi.floor_coverage":"Floor coverage ratio",
    "rb.hint.floors_over_lot":"Floors ÷ lot",
    "rb.kpi.required_setbacks":"Required setbacks",
    "rb.kpi.compliance_fine":  "Setback violation fine",
    "rb.hint.from_site_plan":  "From مخطط موقع تنظيمي",
    "rb.hint.from_compliance": "Used in fine calculation",
    "rb.hint.from_compliance_overridden": "Adjusted by الاحكام الخاصة",
    "rb.hint.compliance_clean":"Within required setbacks",
    "rb.hint.compliance_serious":"SERIOUS · building exits lot",
    "rb.hint.compliance_infeasible":"Lot too small for required setbacks",
    "rb.hint.coverage_max":    "Max {max}% allowed",
    "rb.hint.coverage_over":   "Over max {max}% by {over}%",
    "rb.pb.total":"Total fine",
    "rb.pb.toggle":"Fine breakdown",
    "rb.hint.from_cad":         "From CAD",
    "rb.hint.from_deed":        "From سند التسجيل",
    "rb.lotcheck.pending":      "Waiting for both CAD and deed values",
    "rb.lotcheck.match":        "✓ Lot area matches",
    "rb.lotcheck.mismatch":     "⚠ Mismatch · {diff} m² difference",
    // Generic "compare tile" labels used across coverage / floor-coverage / floor-count
    "rb.compare.actual_cad":         "Actual (CAD)",
    "rb.compare.actual_floor_plan":  "Actual (floor plan)",
    "rb.compare.allowed_site_plan":  "Allowed (site plan)",
    "rb.compare.allowed_derived":    "Allowed (deed × coverage %)",
    "rb.compare.pending":            "Waiting for values",
    "rb.compare.no_rule":            "No regulatory limit available",
    "rb.compare.coverage_ok":        "✓ Within allowed coverage",
    "rb.compare.coverage_violation": "⚠ Exceeds allowed by {over}%",
    "rb.compare.floor_cov_ok":       "✓ Within allowed floor ratio",
    "rb.compare.floor_cov_violation":"⚠ Exceeds allowed floor ratio by {over}%",
    "rb.compare.floors_ok":          "✓ Within allowed floor count",
    "rb.compare.floors_violation":   "⚠ Exceeds allowed by {over} floor(s)",
    "rb.compare.bldg_ok":            "✓ Within allowed building area",
    "rb.compare.bldg_violation":     "⚠ Exceeds allowed by {over} m²",
    "rb.compare.fine_jd":            "Fine: {fine} JOD",
    "rb.kpi.floor_totals":           "Floors total",
    "rb.kpi.building_sqm":           "Building area",
    "rb.kpi.building_pct":           "Coverage",
    "rb.kpi.floor_sqm":              "Floors total",
    "rb.kpi.floor_pct":              "Floor coverage ratio",
    "rb.compare.floor_printed":      "Printed (PDF)",
    "rb.compare.floor_computed":     "Computed (compliance)",
    "rb.compare.allowed_derived_floor": "Allowed (lot × ratio %)",
    "rb.compare.floor_violation_sqm":   "⚠ Exceeds allowed floor area by {over} m²",
    "rb.kpi.total_fines":            "Total fines",
    "rb.hint.total_fines_clean":     "No violations",
    "rb.hint.total_fines_zoning_required": "Zoning category required to compute fines",
    "rb.fine.component.setbacks":      "Setbacks",
    "rb.fine.component.building_area": "Building area",
    "rb.fine.component.floor_coverage":"Floor coverage",
    "rb.kpi.num_floors":             "Number of floors",
    "rb.hint.building_over_lot":"Building ÷ lot",
    "rb.hint.no_violations":    "No violations",
    "rb.hint.from_floor_plan":  "From floor-area plan",
    "rb.hint.claude_recompute": "AI re-computation",
    "rb.scroll_hint":      "Scroll down for live thinking · document intelligence · raw reports",
    "rb.other":            "Other extracted data",
    "rb.plot_title":       "Plot {plot}",
    "rb.plot_title_village":"Plot {plot} · {village}",
    "rb.penalty.zero_jod": "0.00 JOD",
    "rb.penalty.jod":      "{total} JOD",
    "rb.penalty.no_violations_threshold": "No violations · threshold {threshold} m",
    "rb.penalty.sides_below_one":  "1 side below {threshold} m",
    "rb.penalty.sides_below_many": "{count} sides below {threshold} m",
    "rb.floor.mismatch":   "Mismatch vs. printed total",
    "rb.floor.matches":    "Matches printed total",
    "rb.loaded_archive":   "Loaded from archive",
    "rb.archive_sub":      "Archived analysis · reviewer overview",
  },
  ar: {
    "ui.lang.toggle": "تبديل اللغة",
    "app.title": "النظام الذكي لامانة عمان الكبرى",
    "app.subtitle": "منصة مراجعة طلبات الترخيص بالذكاء الاصطناعي",
    "upload.eyebrow": "محرك التحليل",
    "upload.title": "تحميل ملفاتك",
    "upload.tagline": "تحميل أي مزيج — رسم CAD، سند التسجيل PDF، خطة مساحة الطابقية PDF. تعمل المسارات الثلاثة بالتوازي وتُعرض النتائج جنبًا إلى جنب.",
    "sg.title":           "قبل أن تبدأ — متطلبات قبول الطلب",
    "sg.intro":           "لضمان قبول طلبك ومراجعته بسلاسة، راجع المتطلبات التالية قبل رفع الملفات.",
    "sg.toggle":          "إظهار/إخفاء الدليل",
    "sg.s1.title":        "الوثائق المطلوبة",
    "sg.s1.doc_cad":      "ملف المخطط CAD (DWG أو DXF أو DWF)",
    "sg.s1.doc_deed":     "سند التسجيل — ملف PDF",
    "sg.s1.doc_floor":    "خطة مساحة الطابقية — ملف PDF",
    "sg.s1.doc_site_plan":"مخطط موقع تنظيمي — ملف PDF",
    "sg.s1.hint":         "جميع الوثائق الأربع مطلوبة لبدء التحليل.",
    "sg.s2.title":        "متطلبات المخطط (CAD)",
    "sg.s2.layer_building":"طبقة باسم <code>BUILDING</code> أو <code>BLDG</code> تحتوي على مضلع المبنى مغلقًا",
    "sg.s2.layer_lot":    "طبقة باسم <code>LOT</code> أو <code>LOT_BOUNDARY</code> تحتوي على مضلع قطعة الأرض مغلقًا",
    "sg.s2.layer_street": "طبقة باسم <code>STREET</code> أو <code>ROAD</code> على محور الشارع المحاذي",
    "sg.s2.inside_lot":   "المبنى بأكمله داخل حدود قطعة الأرض",
    "sg.s2.closed":       "جميع المضلعات مغلقة — تتصل نقطة النهاية بنقطة البداية",
    "sg.s3.title":        "مخطط الموقع التنظيمي",
    "sg.s3.title_match":  "الملف يحمل العنوان الرسمي «مخطط موقع تنظيمي»",
    "sg.s3.issuer":       "صادر عن الأمانة أو البلدية المعنية",
    "sg.s3.setbacks":     "قيم الارتدادات (امامي / جانبي / خلفي) مقروءة تحت عمود «الارتدادات (متر)»",
    "sg.s4.title":        "الالتزام التنظيمي",
    "sg.s4.setbacks":     "المبنى يلتزم بالارتدادات المذكورة في مخطط الموقع التنظيمي",
    "sg.s4.coverage":     "نسبة التغطية لا تتجاوز المسموح به في مخطط الموقع التنظيمي",
    "sg.s4.hint":         "في حال وجود مخالفات، سيتم إعادة الطلب للتعديل مع ملاحظات المراجع.",
    "upload.cad.eyebrow": "CAD · مطلوب",
    "upload.cad.text": "تحميل رسم CAD",
    "upload.pdf.eyebrow": "سند التسجيل · مطلوب",
    "upload.pdf.text": "تحميل ملف سند التسجيل PDF",
    "upload.pdf.hint": "ملخص آلي",
    "upload.floor.eyebrow": "خطة مساحة الطابقية · مطلوب",
    "upload.floor.text": "تحميل خطة مساحة الطابقية PDF",
    "upload.floor.hint": "جداول الطوابق مقارنةً بمساحة القطعة",
    "upload.analyze": "تحليل",
    "status.analyzing": "يجري تحليل الرسم…",
    "status.analyzing_docs": "يجري تحليل المستندات…",
    "status.uploading": "يتم رفع الرسم…",
    "status.uploading_docs": "يتم رفع المستندات…",
    "status.done": "اكتمل التحليل",
    "status.stopped": "توقف التحليل",
    "status.steps": "الخطوات",
    "status.tokens": "الرموز",
    "status.turn": "الدور",
    "status.new": "رسم جديد",
    "think.label": "التفكير المباشر",
    "think.sub": "كل استدعاء أداة والاستنتاجات الذكية أثناء البث",
    "think.streaming": "جارٍ البث",
    "result.label": "التحليل",
    "result.waiting": "بانتظار إتمام التحليل…",
    "result.just_now": "اكتمل للتو",
    "placeholder.title": "ستظهر النتائج هنا فور انتهاء التحليل",
    "placeholder.item3": "تقرير كامل (markdown + JSON)",
    "drawing.loading": "جارٍ تحضير الرسم التوضيحي للارتدادات…",
    "summary.claude": "الملخص",
    "pdf.summary": "ملخص PDF",
    "pdf.reading": "قراءة ملف الطابو PDF…",
    "pdf.extracted": "استخراج آلي",
    "pdf.failed": "فشلت قراءة الـ PDF",
    "pdf.claude_reading": "يجري قراءة ملف الـ PDF…",
    "pdf.other": "حقول إضافية مستخرجة",
    "pdf.empty": "لم يتم استخراج أي حقول تعريفية.",
    "pdf.field.plot_number": "رقم قطعة الأرض",
    "pdf.field.num_floors": "عدد الطوابق",
    "pdf.field.basin_number": "رقم الحوض",
    "pdf.field.basin_name": "اسم الحوض",
    "pdf.field.village": "اسم القرية",
    "pdf.field.village_combined": "اسم ورقم القرية",
    "pdf.field.building_number": "رقم البناية",
    "pdf.field.street_name": "اسم الشارع",
    "pdf.field.num_streets": "عدد الشوارع",
    "pdf.field.area": "المساحة",
    "metric.coverage": "تغطية المبنى والارتدادات",
    "metric.building": "المبنى",
    "metric.lot": "القطعة",
    "metric.penalty": "غرامة الارتداد",
    "metric.threshold": "الحد",
    "metric.threshold.aria": "حد الارتداد بالأمتار",
    "metric.meter_abbr": "م",
    "metric.rule_text": "العجز (مقرَّبًا لأعلى لأقرب متر كامل) × المعدل المعتمد لكل جهة",
    "metric.compliant": "جميع الجهات ≥ {threshold} م — متوافقة، لا توجد غرامة",
    "metric.jod": "دينار",
    "report.markdown": "التقرير الكامل (markdown)",
    "report.json": "JSON الخام",
    "step.status.running": "قيد التنفيذ",
    "step.status.done": "مكتمل",
    "step.status.error": "خطأ",
    "error.title": "حدث خطأ ما",
    "error.start_over": "ابدأ من جديد",
    "stream_error.title": "تعذّر إتمام التحليل",
    "stream_error.retry": "ابدأ من جديد",
    "tool.convert.title": "تحضير الرسم",
    "tool.convert.running": "التحويل إلى DWG عند الحاجة…",
    "tool.convert.done.converted": "تم التحويل {ext} ← DWG عبر reaConverter",
    "tool.convert.done.already": "بالفعل {ext} — لا حاجة للتحويل",
    "tool.open.title": "فتح في AutoCAD",
    "tool.open.running": "تحميل الرسم في AutoCAD LT…",
    "tool.open.done": "تم الفتح في AutoCAD",
    "tool.layers.title": "قراءة قائمة الطبقات",
    "tool.layers.running": "سرد جميع الطبقات في الرسم…",
    "tool.layers.done": "تم العثور على {count} طبقة",
    "tool.extract.title": "استخراج حدود {role}",
    "tool.extract.running": "قراءة الخطوط المتعددة على \"{layer}\"…",
    "tool.extract.done": "{count} عنصر على \"{layer}\"",
    "tool.stitch.title": "تجميع مضلع {label}",
    "tool.stitch.running": "سد الفجوات بين الأجزاء…",
    "tool.stitch.done": "مساحة المضلع {area}، {vertices} رأس",
    "tool.setbacks.title": "حساب الارتدادات",
    "tool.setbacks.running": "قياس كل حافة للمبنى إلى أقرب حافة للقطعة…",
    "tool.setbacks.done": "{count} حافة",
    "tool.street.title": "تحديد الشوارع المحاذية",
    "tool.street.running": "قراءة طبقة STREET…",
    "tool.street.done": "{count} مقطع شارع",
    "tool.compliance.title": "مطابقة الاشتراطات التنظيمية",
    "tool.compliance.running": "مقارنة الارتدادات الفعلية مع المسموح…",
    "tool.compliance.done": "تم تقييم المطابقة",
    "tool.visualize.title": "إنشاء الرسم التوضيحي",
    "tool.visualize.running": "رسم مخطط الارتدادات…",
    "tool.visualize.done": "تم إنشاء PNG ({size} كب)",
    "tool.finalize.title": "تجهيز التقرير",
    "tool.finalize.running": "تجميع التقرير النهائي…",
    "tool.finalize.done": "التقرير مكتمل — {edges} ارتداد",
    "role.building": "المبنى",
    "role.lot": "القطعة",
    "role.geometry": "الهندسة",
    "label.building": "المبنى",
    "label.lot": "القطعة",
    "label.boundary": "الحدود",
    "sys.uploading": "يتم رفع {name}",
    "sys.uploaded": "تم الرفع — المهمة {id}",
    "sys.uploaded.with_pdf": "تم الرفع — المهمة {id} (مع PDF)",
    "sys.model_engaged": "تم تفعيل النموذج {model}",
    "sys.connected": "تم الاتصال بـ AutoCAD LT",
    "sys.pdf_started": "بدأ تحليل PDF",
    "sys.pdf_complete": "اكتمل تحليل PDF",
    "sys.pdf_failed": "فشل تحليل PDF",
    "sys.floor_started": "بدأ تحليل خطة مساحة الطابقية",
    "sys.extra_started": "جارٍ استخراج وثيقة إضافية: {name}",
    "sys.extra_complete": "تم استخراج الوثيقة الإضافية: {name}",
    "sys.extra_failed": "فشل استخراج الوثيقة الإضافية: {name}",
    "app_summary.eyebrow": "بيانات الطلب",
    "app_summary.sub": "مُجمَّعة من كل الملفات · بدون تكرار",
    "app_summary.identity": "بيانات الهوية",
    "app_summary.building": "المبنى والمشروع",
    "app_summary.other": "بيانات أخرى مستخرجة",
    "app_summary.empty_identity": "لم تُستخرَج أي بيانات هوية بعد.",
    "app_summary.empty_building": "لم تُستخرَج أي بيانات مبنى أو مشروع بعد.",
    "upload.extras.eyebrow": "وثائق إضافية · اختياري",
    "upload.extras.text": "تحميل وثائق PDF إضافية",
    "upload.extras.hint": "ملفات متعددة · يُستخرج كل منها",
    // Site plan (مخطط موقع تنظيمي)
    "upload.site_plan.eyebrow": "مخطط موقع تنظيمي · مطلوب",
    "upload.site_plan.text": "تحميل مخطط موقع تنظيمي PDF",
    "upload.site_plan.hint": "الارتدادات المطلوبة · فحص التوافق",
    // Measurement PDF — اختياري · أداة القياس
    "upload.measurement.eyebrow": "PDF القياس · اختياري",
    "upload.measurement.text": "تحميل ملف PDF للقياس",
    "upload.measurement.hint": "عرض · تكبير · قياس",
    "rb.measure.open": "فتح أداة القياس",
    "site_plan.summary": "مخطط موقع تنظيمي",
    "site_plan.reading": "جارٍ قراءة مخطط الموقع التنظيمي…",
    "site_plan.claude_reading": "يجري قراءة مخطط الموقع التنظيمي…",
    "site_plan.failed": "تعذّرت قراءة ملف مخطط موقع تنظيمي",
    "site_plan.wrong_document": "الملف المرفوع ليس مخطط موقع تنظيمي",
    "site_plan.extraction_failed": "تعذّر قراءة الارتدادات المطلوبة",
    "site_plan.done": "تم استخراج الارتدادات المطلوبة",
    "site_plan.field.front": "أمامي",
    "site_plan.field.side":  "جانبي",
    "site_plan.field.rear":  "خلفي",
    "site_plan.field.corner": "قطعة على شارعين",
    "site_plan.field.use":    "الاستعمال",
    "site_plan.value.corner_yes": "نعم (شارعان)",
    "site_plan.value.corner_no":  "لا",
    "site_plan.value.rear_corner": "— (قطعة على شارعين)",
    "sys.site_plan_started":  "بدء قراءة مخطط الموقع التنظيمي…",
    "sys.site_plan_complete": "اكتمل استخراج مخطط الموقع التنظيمي",
    "sys.site_plan_failed":   "فشل استخراج مخطط الموقع التنظيمي",
    "extras.summary": "وثائق إضافية",
    "extras.reading": "جارٍ قراءة الوثائق الإضافية…",
    "extras.empty": "لم تُرفَع وثائق إضافية.",
    "extras.failed": "تعذّرت قراءة هذا الملف",
    "extras.waiting": "في الانتظار — قبل بدء التحليل…",
    "extras.done.one": "تم استخراج وثيقة واحدة",
    "extras.done.many": "تم استخراج {n} وثائق",
    "extras.pending.one": "وثيقة واحدة قيد المعالجة",
    "extras.pending.many": "{n} وثائق قيد المعالجة",
    "pdf.field.project_name": "اسم المشروع",
    "pdf.field.owner": "المالك",
    "pdf.field.building_type": "نوع البناء",
    "pdf.field.zoning_region": "منطقة التنظيم",
    "pdf.field.neighborhood": "المنطقة / الحي",
    "pdf.field.engineer": "المهندس",
    "pdf.field.registration_number": "رقم التسجيل",
    "pdf.field.document_date": "تاريخ الوثيقة",
    "sys.floor_complete": "اكتمل تحليل خطة مساحة الطابقية",
    "sys.floor_failed": "فشل تحليل خطة مساحة الطابقية",
    "floor.summary": "خطة مساحة الطابقية",
    "floor.reading": "قراءة خطة مساحة الطابقية…",
    "floor.extracted": "استخراج آلي",
    "floor.failed": "فشلت قراءة ملف خطة مساحة الطابقية",
    "floor.claude_reading": "يجري قراءة خطة مساحة الطابقية…",
    "floor.building_total": "المجموع الكلي للمبنى (PDF)",
    "floor.licensed_total": "المساحة المراد ترخيصها (PDF)",
    "floor.mismatch_count": "{n} صف(وف) حيث البعد × العدد ≠ المجموع المطبوع (±1 م²).",
    "floor.no_mismatches": "كل الصفوف: البعد × العدد يطابق المجموع المطبوع ضمن ±1 م².",
    "floor.lot_area": "مساحة القطعة (سند)",
    "floor.floor_sum": "مجموع الطوابق",
    "floor.ratio": "الطوابق ÷ القطعة",
    "floor.over": "مجموع الطوابق يتجاوز مساحة القطعة",
    "floor.under": "مجموع الطوابق ضمن مساحة القطعة",
    "floor.no_deed": "ارفع سند التسجيل لحساب النسبة.",
    "floor.col.no": "#",
    "floor.col.dims": "الأبعاد",
    "floor.col.qty": "العدد",
    "floor.col.sign": "الإشارة",
    "floor.col.printed": "المساحة م² (PDF)",
    "floor.col.computed": "البعد × العدد (Python)",
    "floor.col.flag": "",
    "floor.by_autocad": "By AutoCAD",
    "floor.subtotal": "المجموع (PDF)",
    "floor.mismatch_badge": "عدم تطابق",
    "floor.verified": "تم التحقق",
    "floor.verified.tip": "أُعيدت القراءة في جولة التحقق.",
    "floor.verified.changed.tip": "أُعيدت القراءة في جولة التحقق وبعض الصفوف تغيّرت.",
    "floor.qty.multi": "هذا الجدول يمثل عدة طوابق متطابقة",
    "floor.page": "صفحة",
    "reasoning.label": "الاستنتاجات",
    "history.button": "السجل",
    "history.toggle": "فتح سجل التحليلات",
    "history.title": "التحليلات السابقة",
    "history.sub": "انقر لإعادة الفتح. سلة المهملات للحذف.",
    "history.close": "إغلاق السجل",
    "history.empty": "لا توجد تحليلات محفوظة بعد. شغّل واحدًا وسيظهر هنا.",
    "history.delete_confirm": "حذف هذا التحليل؟ لا يمكن التراجع.",
    "history.replay_banner": "تم التحميل من السجل — {name}",
    "history.failed": "فشل تحميل سجل التحليلات.",
    "history.load_failed": "فشل تحميل هذا التحليل.",
    "history.delete_failed": "فشل حذف هذا التحليل.",
    "history.no_cad": "(بدون CAD)",
    "dash.metrics":        "المقاييس الرئيسية",
    "dash.metrics.hint":   "تغطية المبنى · التوافق مع الارتدادات",
    "dash.geometry":       "هندسة الارتدادات",
    "dash.geometry.hint":  "المسافات لكل جهة من المبنى إلى حدود القطعة",
    "dash.docs":           "ذكاء المستندات",
    "dash.docs.hint":      "استخراج آلي من ملفات الـ PDF",
    "dash.reports":        "المخرجات الخام",
    "dash.reports.hint":   "تقرير Markdown الكامل · JSON الخام",
    // Topbar
    "ui.dashboard":        "لوحة التحكم",
    "ui.signout":          "تسجيل الخروج",
    // Intake card
    "intake.eyebrow":      "تصنيف الطلب",
    "intake.sub":          "صنّف هذا الترخيص لعرضه في لوحة التحكم",
    "intake.type":         "نوع الطلب",
    "intake.submitter":    "مقدّم الطلب (اختياري)",
    "intake.submitter.placeholder": "اسم المالك / مقدّم الطلب",
    "apptype.initial_consultation":               "الاستشارة (موافقة مبدئية)",
    "apptype.technical_consultation":             "استشارة فنية",
    "apptype.permit_vacant_land":                 "ترخيص مقترح على ارض خالية",
    "apptype.permit_over_existing":               "ترخيص مقترح فوق قائم",
    "apptype.amended_plan_permit":                "ترخيص مخطط تعديلي",
    "apptype.permit_cancellation":                "الغاء ترخيص مقترح",
    "apptype.occupancy_permit":                   "اذن اشغال",
    "apptype.occupancy_renewal":                  "تجديد اذن اشغال",
    "apptype.occupancy_doc_correction":           "تصحيح وثيقة اذن الاشغال",
    "apptype.occupancy_renewal_doc_correction":   "تصحيح وثيقة تجديد اذن الاشغال",
    "apptype.additions_permit":                   "ترخيص زيادات",
    "apptype.additions_permit_with_occupancy":    "ترخيص زيادات + أذن اشغال",
    "apptype.existing_areas_permit_with_occupancy": "ترخيص مساحات قائمة و إذن اشغال",
    "apptype.first_time_existing_building":       "بناء قائم لأول مرة",
    "apptype.deposit_forfeiture":                 "مصادرة تأمينات",
    "apptype.central_committee_review":           "اعادة النظر بقرار لجنة التخطيط المركزية (اللوائية)",
    "apptype.other":               "أخرى",
    // Reviewer banner
    "rb.title":            "ملخص الطلب",
    "rb.approve":          "موافقة",
    "rb.reject":           "رفض",
    "rb.status.draft":     "مسودة قبل الإرسال",
    "rb.status.pending":   "قيد المراجعة",
    "rb.status.approved":  "تمت الموافقة",
    "rb.status.rejected":  "مرفوض",
    "rb.status.needs_revision": "بحاجة إلى تعديل",
    // Submitter pre-submit preview bar
    "sub.preview.clean":        "لم يرصد النظام الذكي أي ملاحظات على طلبك. يمكنك الآن إرساله للمراجع.",
    "sub.preview.send":         "إرسال للمراجعة",
    "sub.preview.issues.title": "رصد النظام الذكي ملاحظات على طلبك",
    "sub.preview.issues.sub":   "يُنصح بتعديل الملفات قبل الإرسال لتجنّب تأخير الموافقة. يمكنك الإرسال الآن إن أردت، لكن المراجع سيرى أن الطلب أُرسل مع ملاحظات معروفة.",
    "sub.preview.edit":         "تعديل الملفات وإعادة الرفع",
    "sub.preview.send_anyway":  "إرسال رغم الملاحظات",
    "sub.preview.confirm.msg":  "تأكيد الإرسال: سيظهر طلبك في قائمة المراجع مع تنبيه «أُرسل مع ملاحظات معروفة من النظام الذكي»، وقد يستغرق القرار وقتًا أطول من المعتاد. هل تريد المتابعة؟",
    "sub.preview.confirm.cancel": "إلغاء",
    "sub.preview.confirm.yes":    "نعم، إرسال للمراجعة",
    "rp.known_issues.title":    "أُرسل هذا الطلب رغم وجود ملاحظات من النظام الذكي",
    "rp.known_issues.sub":      "المقدّم اطّلع على الملاحظات أدناه واختار المتابعة. راجع جدول الملاحظات قبل اتخاذ القرار.",
    "sub.preview.edit.title":   "رفع نسخة معدّلة من الملفات المعنيّة",
    "sub.preview.edit.sub":     "ارفع فقط الملفات التي رصد النظام ملاحظات عليها — سنحتفظ بالملفات الأخرى كما هي ونعيد تحليل المستجدّات.",
    "sub.preview.edit.cancel":  "إلغاء",
    "sub.preview.edit.submit":  "رفع وإعادة التحليل",
    "sub.nr.title":             "المراجع أعاد طلبك للتعديل",
    "rp.title":            "مراجعة الطلب",
    "rp.col.document":     "الوثيقة",
    "rp.col.issue":        "البيانات الناقصة",
    "rp.col.action":       "إجراء مطلوب",
    "rp.col.comment":      "ملاحظة المراجع",
    "rp.needs_revision":   "إعادة للمقدّم للتعديل",
    // ── لوحة البنود (.ip) — حاوية موحّدة لبطاقات البيانات الناقصة ──
    "ip.cta.edit":               "تعديل الملفات وإعادة الرفع",
    "ip.chip.known_issues":      "أُرسل هذا الطلب رغم وجود ملاحظات معلومة من المقدّم",
    "ip.rn.title":               "ملاحظة عامة من المراجع",
    "ip.status.clean":           "لا توجد ملاحظات · جاهز للإرسال",
    "ip.status.review_pending":  "لا توجد ملاحظات · جاهز للمراجعة",
    "ip.status.needs_revision":  "بحاجة إلى تعديل · {n} ملاحظة",
    "ip.status.review":          "{n} ملاحظة مرصودة",
    "ip.status.sub.persistent":  "{n} ملاحظة منقولة من الجولة السابقة",
    "ip.status.sub.new":         "{n} ملاحظة جديدة في هذه الجولة",
    "ip.status.sub.mixed":       "{npersist} منقولة · {nnew} جديدة",
    "ip.card.status.persistent": "ما زال مرصودًا",
    "ip.card.status.new":        "جديد في هذه الجولة",
    "ip.group.count":            "{n} ملاحظات",
    "ip.card.rcmt.label":        "ملاحظة للمقدّم (اختياري)",
    "ip.card.rcmt.placeholder":  "إرشاد محدّد لهذا البند — اختياري.",
    "ip.card.prev.toggle":       "عرض ملاحظة المراجع من الجولة السابقة",
    "ip.card.edit_this":         "تعديل هذا الملف",
    "ip.resolved.title":         "تم حلّها في هذه الجولة",
    "ip.rev.note_label":         "ملاحظة عامة للمقدّم",
    "ip.rev.note_optional":      "(اختياري)",
    "ip.rev.note_placeholder":   "اكتب ملاحظة موجزة (اختياري). الملاحظات التفصيلية لكل بند تُكتب داخل البطاقات أعلاه.",
    "ip.confirm.cancel":         "إلغاء",
    "ip.confirm.approve.msg_pre":  "هذا الطلب يحتوي",
    "ip.confirm.approve.msg_post": "بنود لم تُحلَّ. هل تريد الموافقة رغم ذلك؟",
    "ip.confirm.approve.yes":      "نعم، موافقة مع ملاحظات",
    "ip.confirm.reject.msg":       "سيتم رفض الطلب نهائيًا — هذا قرار لا يمكن التراجع عنه. هل أنت متأكد؟",
    "ip.confirm.reject.yes":       "نعم، رفض",
    // ── حالات للعرض فقط بعد الإرسال ──
    "ip.status.pending":      "قيد المراجعة · سيرد المراجع قريبًا",
    "ip.status.approved":     "تمت الموافقة على الطلب",
    "ip.status.rejected":     "تم رفض الطلب",
    // ── لوحة الوثائق ──
    "dp.title":               "وثائق الطلب",
    "dp.prev.toggle":         "عرض النسخ السابقة من الوثائق",
    "rb.section.identity": "هوية الطلب",
    "rb.section.building": "المشروع والمبنى",
    "rb.section.details":  "تفاصيل الطلب",
    "rb.section.kpis":     "المؤشرات الرئيسية",
    "rb.section.setbacks": "الحد الأدنى للارتداد",
    "rb.kpi.building_area": "مساحة المبنى",
    "rb.kpi.lot_area":      "مساحة القطعة",
    "rb.kpi.coverage":      "نسبة المئويه",
    "rb.kpi.penalty":       "غرامات الارتداد",
    "rb.kpi.floor_printed": "إجمالي الطوابق (المطبوع)",
    "rb.kpi.floor_computed":"إجمالي الطوابق (المحسوب)",
    "rb.kpi.floor_coverage":"نسبة التغطية الطابقية",
    "rb.hint.floors_over_lot":"الطوابق ÷ القطعة",
    "rb.kpi.required_setbacks":"الارتدادات المطلوبة",
    "rb.kpi.compliance_fine":  "غرامة تجاوز الارتدادات",
    "rb.hint.from_site_plan":  "من مخطط موقع تنظيمي",
    "rb.hint.from_compliance": "المستخدمة في حساب الغرامة",
    "rb.hint.from_compliance_overridden": "معدّلة بالاحكام الخاصة",
    "rb.hint.compliance_clean":"ضمن الارتدادات المطلوبة",
    "rb.hint.compliance_serious":"خطيرة · المبنى يتجاوز حدود القطعة",
    "rb.hint.compliance_infeasible":"القطعة لا تستوعب الارتدادات المطلوبة",
    "rb.hint.coverage_max":    "الحد الأقصى المسموح {max}٪",
    "rb.hint.coverage_over":   "تجاوز الحد {max}٪ بـ {over}٪",
    "rb.pb.total":"مجموع الغرامة",
    "rb.pb.toggle":"تفاصيل الغرامة",
    "rb.hint.from_cad":         "من CAD",
    "rb.hint.from_deed":        "من سند التسجيل",
    "rb.lotcheck.pending":      "في انتظار قيم المخطط والسند",
    "rb.lotcheck.match":        "✓ مساحة القطعة متطابقة بين المخطط والسند",
    "rb.lotcheck.mismatch":     "⚠ مساحة القطعة لا تتطابق · فرق {diff} م²",
    "rb.compare.actual_cad":         "الفعلية (CAD)",
    "rb.compare.actual_floor_plan":  "الفعلية (خطة الطوابق)",
    "rb.compare.allowed_site_plan":  "المسموح (مخطط الموقع التنظيمي)",
    "rb.compare.allowed_derived":    "المسموح (السند × نسبة التغطية)",
    "rb.compare.pending":            "في انتظار البيانات",
    "rb.compare.no_rule":            "لا يوجد حد تنظيمي للمقارنة",
    "rb.compare.coverage_ok":        "✓ ضمن نسبة التغطية المسموحة",
    "rb.compare.coverage_violation": "⚠ تجاوز الحد المسموح بـ {over}٪",
    "rb.compare.floor_cov_ok":       "✓ ضمن نسبة التغطية الطابقية المسموحة",
    "rb.compare.floor_cov_violation":"⚠ تجاوز نسبة التغطية الطابقية المسموحة بـ {over}٪",
    "rb.compare.floors_ok":          "✓ ضمن الحد الأقصى لعدد الطوابق",
    "rb.compare.floors_violation":   "⚠ تجاوز الحد الأقصى بـ {over} طابق",
    "rb.compare.bldg_ok":            "✓ ضمن مساحة المبنى المسموحة",
    "rb.compare.bldg_violation":     "⚠ تجاوز المساحة المسموحة بـ {over} م²",
    "rb.compare.fine_jd":            "غرامة: {fine} د.أ",
    "rb.kpi.floor_totals":           "إجمالي الطوابق",
    "rb.kpi.building_sqm":           "مساحة المبنى",
    "rb.kpi.building_pct":           "نسبة المئويه",
    "rb.kpi.floor_sqm":              "إجمالي الطوابق",
    "rb.kpi.floor_pct":              "نسبة التغطية الطابقية",
    "rb.compare.floor_printed":      "المطبوع (PDF)",
    "rb.compare.floor_computed":     "المحتسب (للتغطية)",
    "rb.compare.allowed_derived_floor": "المسموح (القطعة × النسبة)",
    "rb.compare.floor_violation_sqm":   "⚠ تجاوز المساحة الطابقية المسموحة بـ {over} م²",
    "rb.kpi.total_fines":            "إجمالي الغرامات",
    "rb.hint.total_fines_clean":     "لا توجد مخالفات",
    "rb.hint.total_fines_zoning_required": "فئة التنظيم مطلوبة لاحتساب الغرامات",
    "rb.fine.component.setbacks":      "الارتدادات",
    "rb.fine.component.building_area": "مساحة المبنى",
    "rb.fine.component.floor_coverage":"التغطية الطابقية",
    "rb.kpi.num_floors":             "عدد الطوابق",
    "rb.hint.building_over_lot":"المبنى ÷ القطعة",
    "rb.hint.no_violations":    "لا توجد مخالفات",
    "rb.hint.from_floor_plan":  "من خطة مساحة الطابقية",
    "rb.hint.claude_recompute": "إعادة احتساب آلية",
    "rb.scroll_hint":      "اسحب للأسفل لعرض التفكير المباشر · ذكاء المستندات · التقارير الخام",
    "rb.other":            "بيانات أخرى مستخرجة",
    "rb.plot_title":       "قطعة {plot}",
    "rb.plot_title_village":"قطعة {plot} · {village}",
    "rb.penalty.zero_jod": "0.00 دينار",
    "rb.penalty.jod":      "{total} دينار",
    "rb.penalty.no_violations_threshold": "لا توجد مخالفات · الحد {threshold} م",
    "rb.penalty.sides_below_one":  "جهة واحدة دون {threshold} م",
    "rb.penalty.sides_below_many": "{count} جهات دون {threshold} م",
    "rb.floor.mismatch":   "عدم تطابق مع المجموع المطبوع",
    "rb.floor.matches":    "مطابق للمجموع المطبوع",
    "rb.loaded_archive":   "تم التحميل من الأرشيف",
    "rb.archive_sub":      "تحليل مؤرشف · نظرة عامة للمراجع",
  },
};

let currentLang = (localStorage.getItem("ui-lang") === "en") ? "en" : "ar";

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key]);
  if (s == null) s = (I18N.en[key] != null) ? I18N.en[key] : key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split("{" + k + "}").join(String(vars[k]));
    }
  }
  return s;
}
// Expose t() so reviewer.js (a separate script) can localize dynamic strings.
try { window.t = t; } catch {}

function applyLanguage(lang) {
  currentLang = (lang === "ar") ? "ar" : "en";
  try { localStorage.setItem("ui-lang", currentLang); } catch {}

  const html = document.documentElement;
  html.lang = currentLang;
  html.dir = (currentLang === "ar") ? "rtl" : "ltr";
  document.body.classList.toggle("rtl", currentLang === "ar");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const varsStr = el.getAttribute("data-i18n-vars");
    let vars;
    if (varsStr) { try { vars = JSON.parse(varsStr); } catch {} }
    el.textContent = t(key, vars);
  });
  // Trusted-HTML variant — only for strings authored inside I18N (the
  // submission guide uses <code> tags to highlight layer names). Do NOT
  // apply to user-supplied text.
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });

  // CSS pseudo-element text (::before content) drives via custom property
  document.body.style.setProperty("--i18n-reasoning-label", '"' + t("reasoning.label") + '"');

  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.setAttribute("data-active", currentLang);

  // Re-render dynamic sections that depend on the active language
  if (typeof lastPdfData !== "undefined" && lastPdfData) {
    renderPdfContent(lastPdfData);
  }
  if (typeof lastFloorData !== "undefined" && lastFloorData) {
    renderFloorContent(lastFloorData);
  }
}

// Set an element's translatable text, remembering the key so it re-renders on language change.
function setI18n(el, key, vars) {
  if (!el) return;
  el.setAttribute("data-i18n", key);
  if (vars) {
    el.setAttribute("data-i18n-vars", JSON.stringify(vars));
  } else {
    el.removeAttribute("data-i18n-vars");
  }
  el.textContent = t(key, vars);
}

/* ============================================================
   Event → step mapping: each tool call becomes a visible card
   with a human-readable title/subtitle. Claude's streaming
   reasoning text renders as a separate "reasoning" bubble
   interleaved with the step cards.
   ============================================================ */

function roleLabel(role)  { return t("role." + (role  || "geometry")); }
function labelLabel(label) { return t("label." + (label || "boundary")); }

const TOOL_INFO = {
  convert_dwf_if_needed: {
    number: 1,
    title:   () => t("tool.convert.title"),
    pending: () => t("tool.convert.running"),
    running: () => t("tool.convert.running"),
    done: (_r) => {
      const ext = (uploadedFileExt || "").toUpperCase();
      if (ext === "DWF" || ext === "DWFX") return t("tool.convert.done.converted", { ext });
      return t("tool.convert.done.already", { ext: ext || "DWG" });
    },
  },
  open_drawing: {
    number: 2,
    title:   () => t("tool.open.title"),
    pending: () => t("tool.open.running"),
    running: () => t("tool.open.running"),
    done:    ()  => t("tool.open.done"),
  },
  list_layers: {
    number: 3,
    title:   () => t("tool.layers.title"),
    pending: () => t("tool.layers.running"),
    running: () => t("tool.layers.running"),
    done: (r) => t("tool.layers.done", { count: r.count ?? "?" }),
  },
  extract_polylines: {
    number: 4,
    title:   (a) => t("tool.extract.title", { role: roleLabel(a?.role) }),
    pending: (a) => t("tool.extract.running", { layer: a?.layer_name || "…" }),
    running: (a) => t("tool.extract.running", { layer: a?.layer_name || "…" }),
    done: (r) => t("tool.extract.done", { count: r.entity_count ?? 0, layer: r.layer || "?" }),
  },
  build_polygon_from_segments: {
    number: 5,
    title:   (a) => t("tool.stitch.title", { label: labelLabel(a?.label) }),
    pending: ()  => t("tool.stitch.running"),
    running: ()  => t("tool.stitch.running"),
    done: (r) => t("tool.stitch.done", { area: fmt(r.area), vertices: r.num_vertices }),
  },
  compute_setbacks: {
    number: 6,
    title:   () => t("tool.setbacks.title"),
    pending: () => t("tool.setbacks.running"),
    running: () => t("tool.setbacks.running"),
    done: (r) => t("tool.setbacks.done", { count: r.edge_count ?? 0 }),
  },
  extract_street_polylines: {
    number: 6,
    title:   () => t("tool.street.title"),
    pending: () => t("tool.street.running"),
    running: () => t("tool.street.running"),
    done: (r) => t("tool.street.done", { count: r.entity_count ?? 0 }),
  },
  compute_compliance: {
    number: 7,
    title:   () => t("tool.compliance.title"),
    pending: () => t("tool.compliance.running"),
    running: () => t("tool.compliance.running"),
    done: () => t("tool.compliance.done"),
  },
  render_visualization: {
    number: 7,
    title:   () => t("tool.visualize.title"),
    pending: () => t("tool.visualize.running"),
    running: () => t("tool.visualize.running"),
    done: (r) => t("tool.visualize.done", { size: (r.bytes / 1024).toFixed(1) }),
  },
  finalize: {
    number: 8,
    title:   () => t("tool.finalize.title"),
    pending: () => t("tool.finalize.running"),
    running: () => t("tool.finalize.running"),
    done: (r) => t("tool.finalize.done", { edges: r.edges ?? "?" }),
  },
};

function fmt(n) {
  if (n == null) return "—";
  if (typeof n !== "number") return String(n);
  return n.toFixed(Math.abs(n) >= 100 ? 1 : 3);
}

function pickLabel(info, phase, args) {
  const v = info?.[phase];
  if (typeof v === "function") return v(args || {});
  return v || "";
}

/* ============================================================
   DOM elements
   ============================================================ */

const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const dropText = dropZone.querySelector(".drop-text");
const pdfInput = document.getElementById("pdf-input");
const pdfDropZone = document.getElementById("pdf-drop-zone");
const pdfDropText = document.getElementById("pdf-drop-text");
const floorInput = document.getElementById("floor-input");
const floorDropZone = document.getElementById("floor-drop-zone");
const floorDropText = document.getElementById("floor-drop-text");
const extrasInput = document.getElementById("extras-input");
const extrasDropZone = document.getElementById("extras-drop-zone");
const extrasDropText = document.getElementById("extras-drop-text");
const sitePlanInput = document.getElementById("site-plan-input");
const sitePlanDropZone = document.getElementById("site-plan-drop-zone");
const sitePlanDropText = document.getElementById("site-plan-drop-text");
// Optional 5th uploader · vector PDF used only by the measurement viewer.
// Not wired to any analysis pipeline; never required to enable Analyze.
const measurementInput = document.getElementById("measurement-input");
const measurementDropZone = document.getElementById("measurement-drop-zone");
const measurementDropText = document.getElementById("measurement-drop-text");
const analyzeBtn = document.getElementById("analyze-btn");
const uploadForm = document.getElementById("upload-form");
const uploadView = document.getElementById("upload-view");
const workView = document.getElementById("work-view");

const statusTitle = document.getElementById("status-title");
const statusFile = document.getElementById("status-file");
const statusSpinner = document.getElementById("status-spinner");

const feedEl = document.getElementById("feed");
const stepCountEl = document.getElementById("step-count");
const tokenCountEl = document.getElementById("token-count");
const turnPill = document.getElementById("turn-pill");
const turnCountEl = document.getElementById("turn-count");

const resultPlaceholder = document.getElementById("result-placeholder");
const resultContent = document.getElementById("result-content");
const resultSub = document.getElementById("result-sub");
const summaryBox = document.getElementById("summary-box");
const drawingImg = document.getElementById("drawing-img");
const reportMdEl = document.getElementById("report-md");
const reportJsonEl = document.getElementById("report-json");
// Note: the per-cardinal-side stats (#side-n/s/e/w), overall stats placeholders
// (#overall-edges/min/max), coverage widget (#coverage-*), and the
// threshold-based penalty widget (#penalty-*) were all removed when the
// authoritative compliance flow took over (driven by the مخطط موقع تنظيمي
// PDF). Per-side numbers + fine now live entirely in the Compliance section
// of the markdown report and the rb-compliance-tile / rb-required-tile in the
// reviewer banner.

// PDF summary section (fully independent of the CAD pipeline UI)
const pdfSection = document.getElementById("pdf-section");
const pdfSubEl = document.getElementById("pdf-sub");
const pdfStatusEl = document.getElementById("pdf-status");
const pdfLoadingEl = document.getElementById("pdf-loading");
const pdfContentEl = document.getElementById("pdf-content");
const pdfSummaryTextEl = document.getElementById("pdf-summary-text");
const pdfFieldsEl = document.getElementById("pdf-fields");
const pdfOtherDetails = document.getElementById("pdf-other");
const pdfOtherListEl = document.getElementById("pdf-other-list");
const pdfErrorBox = document.getElementById("pdf-error-box");

// Floor-area plan section (second independent PDF pipeline)
const floorSection = document.getElementById("floor-section");
const floorSubEl = document.getElementById("floor-sub");
const floorStatusEl = document.getElementById("floor-status");
const floorLoadingEl = document.getElementById("floor-loading");
const floorContentEl = document.getElementById("floor-content");
const floorTotalsEl = document.getElementById("floor-totals");
const floorComparisonEl = document.getElementById("floor-comparison");
const floorFloorsEl = document.getElementById("floor-floors");
const floorErrorBox = document.getElementById("floor-error-box");

// Additional-PDFs section — multi-file, one card per uploaded doc.
const extrasSection = document.getElementById("extras-section");
const extrasSubEl = document.getElementById("extras-sub");
const extrasStatusEl = document.getElementById("extras-status");
const extrasListEl = document.getElementById("extras-list");

// Site-plan section (مخطط موقع تنظيمي) — supplies the required setbacks
// consumed by the compliance pipeline. Same shape as the deed PDF section.
const sitePlanSection   = document.getElementById("site-plan-section");
const sitePlanSubEl     = document.getElementById("site-plan-sub");
const sitePlanStatusEl  = document.getElementById("site-plan-status");
const sitePlanLoadingEl = document.getElementById("site-plan-loading");
const sitePlanContentEl = document.getElementById("site-plan-content");
const sitePlanSummaryTextEl = document.getElementById("site-plan-summary-text");
const sitePlanFieldsEl  = document.getElementById("site-plan-fields");
const sitePlanErrorBox  = document.getElementById("site-plan-error-box");

// Compliance KPI tiles in the reviewer banner — populated when the CAD
// pipeline finalises with a `compliance` payload (driven by the agent's
// compute_compliance tool result, which itself depends on the site plan).
const rbRequiredTile    = document.getElementById("rb-required-tile");
const rbRequiredValues  = document.getElementById("rb-required-values");
const rbRequiredHint    = document.getElementById("rb-required-hint");
const rbComplianceTile  = document.getElementById("rb-compliance-tile");
const rbComplianceFine  = document.getElementById("rb-compliance-fine");
const rbComplianceHint  = document.getElementById("rb-compliance-hint");

// Image lightbox elements — clicking the inline drawing PNG opens it scaled
// up in a viewport-filling overlay; backdrop / × / Escape all close it.
const lightboxEl       = document.getElementById("img-lightbox");
const lightboxImgEl    = document.getElementById("img-lightbox-img");
const lightboxCloseBtn = document.getElementById("img-lightbox-close");

function openLightbox(src) {
  if (!src || !lightboxEl || !lightboxImgEl) return;
  lightboxImgEl.src = src;
  lightboxEl.hidden = false;
  // Lock body scroll while the overlay is open so the page underneath
  // doesn't move when the user wheels over the dark backdrop.
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  if (!lightboxEl || !lightboxImgEl) return;
  lightboxEl.hidden = true;
  lightboxImgEl.removeAttribute("src");
  document.body.style.overflow = "";
}

if (drawingImg) {
  drawingImg.addEventListener("click", () => {
    if (drawingImg.src) openLightbox(drawingImg.src);
  });
}
if (lightboxCloseBtn) lightboxCloseBtn.addEventListener("click", closeLightbox);
if (lightboxEl) {
  lightboxEl.addEventListener("click", (e) => {
    // Only close on backdrop clicks — not when clicking the image itself.
    if (e.target === lightboxEl) closeLightbox();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lightboxEl && !lightboxEl.hidden) closeLightbox();
});

// Reviewer-banner grids that hold the consolidated deed + extras data.
// The banner is the ONLY place the extracted identity / building fields
// live now — the old #app-summary-section was removed.
const rbIdentityGrid    = document.getElementById("rb-identity-grid");
const rbBuildingLabel   = document.getElementById("rb-building-label");
const rbBuildingGrid    = document.getElementById("rb-building-grid");
const rbOther           = document.getElementById("rb-other");
const rbOtherList       = document.getElementById("rb-other-list");

const newUploadBtn = document.getElementById("new-upload-btn");

const errorCard = document.getElementById("error-card");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-btn");

// Inline per-field error slots (Arabic, under each drop-zone). Keys MUST match
// the FastAPI form-field names the upload endpoint validates against: "file",
// "pdf_deed", "pdf_floor", "pdf_site_plan", "pdf_extras".
const FIELD_ERROR_EL = {
  file:           document.getElementById("field-error-file"),
  pdf_deed:       document.getElementById("field-error-pdf_deed"),
  pdf_floor:      document.getElementById("field-error-pdf_floor"),
  pdf_site_plan:  document.getElementById("field-error-pdf_site_plan"),
  pdf_extras:     document.getElementById("field-error-pdf_extras"),
  pdf_measurement: document.getElementById("field-error-pdf_measurement"),
};

// SSE pipeline-error banner (sits in the work view, above the reviewer
// banner). Shown when the agent raises mid-stream (e.g. geometry ValueError)
// or the site-plan extractor rejects the document.
const streamErrorBanner = document.getElementById("stream-error-banner");
const streamErrorMsg    = document.getElementById("stream-error-msg");
const streamErrorRetry  = document.getElementById("stream-error-retry");

function clearFieldErrors() {
  for (const el of Object.values(FIELD_ERROR_EL)) {
    if (!el) continue;
    el.textContent = "";
    el.hidden = true;
  }
}

function renderFieldErrors(errors) {
  // `errors` is the `{errors: {field: arabic_message}}` map the backend sends
  // on a 422 upload response. Unknown keys fall back to the CAD slot so the
  // user always sees the message somewhere.
  clearFieldErrors();
  if (!errors || typeof errors !== "object") return;
  for (const [field, msg] of Object.entries(errors)) {
    const el = FIELD_ERROR_EL[field] || FIELD_ERROR_EL.file;
    if (!el) continue;
    el.textContent = String(msg || "");
    el.hidden = false;
  }
  // Scroll the first visible error into view so the reviewer sees it
  // immediately even if the form is long.
  for (const key of ["file", "pdf_deed", "pdf_floor", "pdf_site_plan", "pdf_extras"]) {
    const el = FIELD_ERROR_EL[key];
    if (el && !el.hidden) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      break;
    }
  }
}

// Set true the moment a stream-level error lands, so late-arriving `final`
// and `done` events (which race against the aborted agent) don't overwrite
// the banner state with phantom results. Cleared on resetAll/hideStreamBanner.
let __streamErrored = false;

function showStreamBanner(msg) {
  // Pipeline-time failure — show the banner in the work view, halt spinners,
  // and hide any in-progress result content. We do NOT switch to the
  // full-page error card: leaving the work view up lets the reviewer see
  // whichever side pipelines already succeeded.
  if (!streamErrorBanner || !streamErrorMsg) return;
  __streamErrored = true;
  streamErrorMsg.textContent = String(msg || "");
  streamErrorBanner.hidden = false;
  setI18n(statusTitle, "status.stopped");
  statusSpinner.style.display = "none";
  newUploadBtn.hidden = false;
  if (resultPlaceholder) resultPlaceholder.hidden = false;
  if (resultContent) resultContent.hidden = true;
}

function hideStreamBanner() {
  __streamErrored = false;
  if (streamErrorBanner) streamErrorBanner.hidden = true;
  if (streamErrorMsg) streamErrorMsg.textContent = "";
}

/* ============================================================
   Issues panel — single shell (#issues-panel) that owns the
   missing-data cards, the role-aware action footer, and the
   inline confirms. Replaces the legacy 4-banner stack +
   #rp-notes editor.

   Data flow:
     · `missing_data` SSE events → addMissingDataRow → __missingData
     · autoLoad / replay → seeds __missingData from persisted JSON
     · per-row comments (reviewer) → __pendingRowComments
     · previous-round comments (carryforward) → __previousRound
     · all of the above → renderIssuesPanel() which paints the panel
   ============================================================ */

// Shape of a row: {key, document, issue, action, reviewer_comment}
// `key` is a stable identifier (defined in app/validation.py) used for
// de-dup across repeat events AND for matching previous-round state
// during resubmits.
const __missingData = {
  rows: [],
  keys: new Set(),
};
// Exposed so reviewer.js's inline edit form can read which document
// slots the AI flagged (drives slot visibility on the partial-resubmit
// form during the draft preview flow).
window.__missingData = __missingData;

// Per-row reviewer comments — pending edits held in memory until the
// reviewer commits a decision. On PATCH, submitReviewStatus reads this
// and sends `missing_data_comments`. Map: key → text (empty = clear).
const __pendingRowComments = {};
window.__pendingRowComments = __pendingRowComments;

// Per-row reviewer endorsements (the "push" toggle). Same lifecycle as
// __pendingRowComments — held in memory until decision submit, then
// sent as `missing_data_endorsed` on the PATCH. Map: key → bool. A
// missing key falls back to the row's persisted `reviewer_endorsed`
// (if any). Demoting (false) also clears any pending comment for the
// same row, since comments only make sense on pushed/mandatory rows.
const __pendingRowEndorsements = {};
window.__pendingRowEndorsements = __pendingRowEndorsements;

// Effective endorsement: pending override, then persisted, then a
// backward-compat default. Legacy analyses created before the push
// feature shipped don't carry a `reviewer_endorsed` field at all —
// treating them as un-endorsed would silently demote every previously-
// flagged AI row to advisory and break the existing consultant flow.
// So when the field is absent AND the analysis has already moved past
// its draft/pending state, we default to endorsed (preserving the
// "every AI flag is mandatory" semantics that pre-existed). Live drafts
// and pending reviews default to un-endorsed so the reviewer deliberately
// pushes only what should block approval.
function _ipIsEndorsed(row) {
  if (!row || !row.key) return false;
  // Blocking rows (missing required CAD layer, deed↔site-plan identity
  // mismatch) are always mandatory — they halt the analysis pre-agent
  // and the reviewer never gets a chance to triage them. They live in
  // #ip-cards regardless of the push toggle's state.
  if (row.blocking) return true;
  if (Object.prototype.hasOwnProperty.call(__pendingRowEndorsements, row.key)) {
    return !!__pendingRowEndorsements[row.key];
  }
  if (row.reviewer_endorsed === true)  return true;
  if (row.reviewer_endorsed === false) return false;
  // Field absent — apply the legacy-migration default.
  const meta = window.__loadedAnalysisMeta || {};
  const reviewStatus = (window.__reviewerBanner && window.__reviewerBanner.reviewStatus)
    || meta.review_status
    || "draft";
  return reviewStatus !== "draft" && reviewStatus !== "pending";
}

// View toggler — applied when an analysis has been halted by a blocking
// issue (missing CAD layer, deed↔site-plan identity mismatch). Adds a
// body-level class so CSS can hide chart/KPIs and elevate the issues
// panel into a "fix before analysis" focus state. Idempotent. The
// inverse helper clears the class on a fresh upload / clean stream.
function _applyBlockedView() {
  document.body.classList.add("analysis-blocked");
}
function _clearBlockedView() {
  document.body.classList.remove("analysis-blocked");
  window.__blockingIssuesPresent = false;
  window.__blockedRedirectPending = false;
  const banner = document.getElementById("upload-blocked-banner");
  if (banner) banner.hidden = true;
}
window.__applyBlockedView = _applyBlockedView;
window.__clearBlockedView = _clearBlockedView;

// Reason-specific intro copy for the upload-view blocking banner. Falls
// back to a generic "fix the issues below and re-upload" string.
const _UPLOAD_BLOCK_REASON_COPY = {
  cad_missing_required_layers:
    "ملف CAD لا يحتوي على جميع الطبقات المطلوبة (Lot, Building, Street). أضف الطبقات الناقصة وأعد الرفع.",
  deed_site_plan_identity_mismatch:
    "السند ومخطط الموقع التنظيمي يصفان قطعتين مختلفتين — صحّح المستندات وأعد الرفع.",
};

// Bounce the submitter back to the upload screen with a focused list of
// the blocking AI notes. Called either:
//   · live, when the analysis_blocked SSE event arrives mid-pipeline
//   · on auto-load, when meta.blocking_issues_present is true
// Keeps the user's previously-picked files in the form so they can swap
// just the bad slots instead of re-picking everything (matches the
// existing 422 / field-error path's behavior).
function showUploadViewBlocked(rows, reason) {
  const upload  = document.getElementById("upload-view");
  const work    = document.getElementById("work-view");
  const loading = document.getElementById("analysis-loading-view");
  const errCard = document.getElementById("error-card");
  const banner  = document.getElementById("upload-blocked-banner");
  const list    = document.getElementById("upload-blocked-list");
  const subEl   = document.getElementById("upload-blocked-sub");
  if (!upload || !banner || !list) return;

  // Tear down any in-flight SSE so events from the abandoned run don't
  // continue to mutate the panel after we navigate back to upload.
  try {
    if (currentEventSource) { currentEventSource.close(); currentEventSource = null; }
  } catch {}

  // Suppress the loading-view's auto-redirect: when analysis_blocked
  // arrives mid-stream, the agent's `done` event fires shortly after
  // and _alOnDone would otherwise redirect to /app?a=<id>. The flag
  // tells _alOnDone to skip the redirect (we're already where we
  // want the user to be).
  window.__blockedRedirectPending = true;

  // View swap — same pattern as the 422-error path (keep file
  // selections, surface a banner above the form).
  if (loading && typeof hideAnalysisLoadingView === "function") {
    try { hideAnalysisLoadingView(); } catch {}
  } else if (loading) {
    loading.hidden = true;
  }
  if (work)    work.hidden    = true;
  if (errCard) errCard.hidden = true;
  upload.hidden = false;

  // Group blocking rows by their `document` chip so a label like
  // "السند مقابل مخطط موقع تنظيمي" doesn't repeat once per mismatch
  // (parcel # / basin / village). Single-row groups render flat; multi-
  // row groups stack the issues under one shared chip. Same dedupe
  // pattern as the suggestions list and mandatory cards.
  list.innerHTML = "";
  const blocking = (rows || []).filter((r) => r && r.blocking);
  const blockingGroups = _ipGroupRowsByDocument(blocking);
  for (const group of blockingGroups) {
    if (group.length === 1) {
      const r = group[0];
      const li = document.createElement("li");
      li.className = "ubb-item";
      const docHtml = r.document
        ? `<span class="ubb-item-doc">${_escapeHtml(r.document)}</span>`
        : "";
      const issueHtml = r.issue
        ? `<div class="ubb-item-issue">${_escapeHtml(r.issue)}</div>`
        : "";
      const actionHtml = r.action
        ? `<div class="ubb-item-action">${_escapeHtml(r.action)}</div>`
        : "";
      li.innerHTML = docHtml + issueHtml + actionHtml;
      list.appendChild(li);
    } else {
      const li = document.createElement("li");
      li.className = "ubb-item ubb-item--grouped";
      const docLabel = (group[0] && group[0].document) || "";
      const docHtml = docLabel
        ? `<span class="ubb-item-doc">${_escapeHtml(docLabel)}</span>`
        : "";
      const obsHtml = group.map((r) => {
        const issueHtml = r.issue
          ? `<div class="ubb-item-issue">${_escapeHtml(r.issue)}</div>`
          : "";
        const actionHtml = r.action
          ? `<div class="ubb-item-action">${_escapeHtml(r.action)}</div>`
          : "";
        return `<li class="ubb-obs">${issueHtml}${actionHtml}</li>`;
      }).join("");
      li.innerHTML = `${docHtml}<ol class="ubb-obs-list">${obsHtml}</ol>`;
      list.appendChild(li);
    }
  }

  if (subEl) {
    subEl.textContent = _UPLOAD_BLOCK_REASON_COPY[reason]
      || "صحّح الملفات أدناه ثم أعد الرفع.";
  }
  banner.hidden = false;

  // Scroll the user to the top so the banner is the first thing they
  // see — without this, a user mid-page when blocked might miss it.
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
}
window.__showUploadViewBlocked = showUploadViewBlocked;

// Reviewer toggles an AI row's mandatory/advisory state. Promoting
// (push) moves the row into #ip-cards as a mandatory item; demoting
// (un-push) sends it back to #ip-suggestions and clears the pending
// reviewer comment for that row, since comments only attach to
// mandatory rows. Multiple keys at once — used by the card-level
// toggle on grouped cards (single click flips every row in the group).
function _ipTogglePush(rowKeys, endorsed) {
  const keys = Array.isArray(rowKeys) ? rowKeys : [rowKeys];
  for (const k of keys) {
    if (!k) continue;
    __pendingRowEndorsements[k] = !!endorsed;
    if (!endorsed) delete __pendingRowComments[k];
  }
  renderIssuesPanel();
}

// Lightweight suggestion-item renderer — used inside #ip-suggestions for
// AI rows the reviewer has NOT pushed. Carries less chrome than a full
// _ipBuildCard: doc chip + issue + action, plus (reviewer-only) a
// "push to mandatory" button that promotes the row.
function _ipBuildSuggestionItem(row, opts) {
  const isReviewer = !!opts.isReviewer;
  const isReadOnly = !!opts.isReadOnly;

  const li = document.createElement("li");
  li.className = "ip-sugg";
  li.dir = "rtl";
  if (row.key) li.dataset.key = row.key;

  const body = document.createElement("div");
  body.className = "ip-sugg-body";
  if (row.issue) {
    const issue = document.createElement("div");
    issue.className = "ip-sugg-issue";
    issue.textContent = row.issue;
    body.appendChild(issue);
  }
  if (row.action) {
    const action = document.createElement("div");
    action.className = "ip-sugg-action";
    action.textContent = row.action;
    body.appendChild(action);
  }
  li.appendChild(body);

  if (isReviewer && !isReadOnly && row.key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ip-sugg-push";
    btn.title = "اعتماد كملاحظة إلزامية على المقدّم";
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4 6l4-4 4 4M3 13h10"/></svg><span>رفع للمراجع</span>';
    btn.addEventListener("click", () => _ipTogglePush(row.key, true));
    li.appendChild(btn);
  }
  return li;
}

// Previous-round carryforward — populated by autoLoadFromQuery when the
// backend exposes meta.previous_round_* on a resubmit chain. The panel
// uses these to:
//   · prefill / show "previous reviewer comment" inside cards whose key
//     was flagged last round too
//   · render the "✓ resolved this round" strip for keys that disappeared
const __previousRound = {
  keys: [],          // [string]
  comments: {},      // { key: "comment text" }
  summary: {},       // { key: { document, issue } } — for resolved labels
};
window.__previousRound = __previousRound;

function setPreviousRound(meta) {
  __previousRound.keys = Array.isArray(meta && meta.previous_round_keys)
    ? meta.previous_round_keys.slice() : [];
  __previousRound.comments = (meta && typeof meta.previous_round_comments === "object")
    ? Object.assign({}, meta.previous_round_comments) : {};
  __previousRound.summary = (meta && typeof meta.previous_round_summary === "object")
    ? Object.assign({}, meta.previous_round_summary) : {};
  renderIssuesPanel();
}
window.__setPreviousRound = setPreviousRound;

const ipPanel        = document.getElementById("issues-panel");
const ipCards        = document.getElementById("ip-cards");
const ipResolved     = document.getElementById("ip-resolved");
const ipResolvedList = document.getElementById("ip-resolved-list");

function resetMissingData() {
  __missingData.rows = [];
  __missingData.keys.clear();
  // Pending comments and endorsements don't survive a resubmit — the
  // reviewer hasn't committed them yet and the new round may carry
  // different keys, so old state would attach to the wrong issue.
  for (const k of Object.keys(__pendingRowComments)) delete __pendingRowComments[k];
  for (const k of Object.keys(__pendingRowEndorsements)) delete __pendingRowEndorsements[k];
  renderIssuesPanel();
}

function addMissingDataRow(row) {
  if (!row || typeof row !== "object") return;
  const key = String(row.key || "");
  if (key && __missingData.keys.has(key)) return;
  if (key) __missingData.keys.add(key);
  __missingData.rows.push({
    key,
    document: String(row.document || ""),
    issue:    String(row.issue || ""),
    action:   String(row.action || ""),
    reviewer_comment: String(row.reviewer_comment || ""),
    reviewer_endorsed: !!row.reviewer_endorsed,
    // Blocking rows (missing required CAD layer, deed↔site-plan identity
    // mismatch) halt the analysis pre-agent. Preserved end-to-end from
    // jobs.py / agent.py via SSE so the panel can lift them above the
    // normal endorsement triage and switch the view to a focused
    // "fix before analysis" mode.
    blocking: !!row.blocking,
  });
  if (row.blocking) {
    window.__blockingIssuesPresent = true;
    _applyBlockedView();
  }
  renderIssuesPanel();
}

// Pluralization helper for Arabic ("بنود" vs "بند") and English ("items" vs "item").
function _ipPluralWord(n) {
  if (currentLang === "ar") {
    if (n === 1) return "بند";
    if (n === 2) return "بندان";
    if (n >= 3 && n <= 10) return "بنود";
    return "بندًا";
  }
  return n === 1 ? "" : "s";
}

// SVG factory — kept inline so each render is self-contained without a
// template engine. The strokes match the rest of the app's iconography.
function _ipSvg(d, opts) {
  const o = opts || {};
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", o.viewBox || "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", o.sw || "1.9");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

// Build the inner body for ONE observation (issue + action + reviewer
// comment + previous-round details). Returns a DocumentFragment so the
// caller can drop it directly into either a flat card or a stacked
// observation list. Doesn't render the doc chip or the edit button —
// those are owned by the surrounding card so a multi-observation card
// shows them only ONCE.
function _ipBuildObservationBody(row, opts) {
  const frag = document.createDocumentFragment();
  const isReviewer = !!opts.isReviewer;
  const showStatusBadge = !!opts.showStatusBadge;
  const isPersistent = !!opts.isPersistent;
  const isNew = !!opts.isNew;
  const prevComment = (__previousRound.comments && __previousRound.comments[row.key]) || "";

  // Per-observation status badge — only when the caller asks for it
  // (multi-obs cards). For single-obs cards the badge sits in the
  // card head next to the doc chip instead.
  if (showStatusBadge && (isPersistent || isNew)) {
    const status = document.createElement("span");
    status.className = "ip-card-status ip-obs-status " + (isPersistent
      ? "ip-card-status--persistent"
      : "ip-card-status--new");
    status.textContent = isPersistent
      ? t("ip.card.status.persistent")
      : t("ip.card.status.new");
    frag.appendChild(status);
  }

  if (row.issue) {
    const issue = document.createElement("div");
    issue.className = "ip-card-issue";
    issue.textContent = row.issue;
    frag.appendChild(issue);
  }
  if (row.action) {
    const action = document.createElement("div");
    action.className = "ip-card-action";
    const actionText = document.createElement("span");
    actionText.textContent = row.action;
    action.appendChild(actionText);
    frag.appendChild(action);
  }

  // Reviewer comment — editable textarea OR read-only callout.
  if (isReviewer && row.key) {
    const label = document.createElement("label");
    label.className = "ip-card-rcmt-label";
    label.htmlFor = "ip-card-rcmt-" + row.key;
    label.textContent = t("ip.card.rcmt.label");
    frag.appendChild(label);
    const ta = document.createElement("textarea");
    ta.id = "ip-card-rcmt-" + row.key;
    ta.className = "ip-card-rcmt-input";
    ta.rows = 2;
    ta.dir = "auto";
    ta.maxLength = 2000;
    ta.placeholder = t("ip.card.rcmt.placeholder");
    ta.value = (__pendingRowComments[row.key] != null)
      ? __pendingRowComments[row.key]
      : (row.reviewer_comment || prevComment || "");
    ta.addEventListener("input", () => {
      __pendingRowComments[row.key] = ta.value;
    });
    if (ta.value && __pendingRowComments[row.key] == null) {
      __pendingRowComments[row.key] = ta.value;
    }
    frag.appendChild(ta);
  } else {
    const cmt = (row.reviewer_comment || "").trim();
    if (cmt) {
      const box = document.createElement("div");
      box.className = "ip-card-rcmt";
      const icon = _ipSvg("M2.5 4h11v8h-7l-2.5 2.5V12h-1.5z", { sw: "1.7" });
      icon.classList.add("ip-card-rcmt-icon");
      box.appendChild(icon);
      const text = document.createElement("div");
      text.textContent = cmt;
      box.appendChild(text);
      frag.appendChild(box);
    }
  }

  if (isReviewer && prevComment) {
    const details = document.createElement("details");
    details.className = "ip-card-prev";
    const summary = document.createElement("summary");
    summary.className = "ip-card-prev-toggle";
    const chev = _ipSvg("M5 3l4 5-4 5", { viewBox: "0 0 12 12", sw: "2" });
    summary.appendChild(chev);
    const lbl = document.createElement("span");
    lbl.textContent = t("ip.card.prev.toggle");
    summary.appendChild(lbl);
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "ip-card-prev-body";
    body.textContent = prevComment;
    details.appendChild(body);
    frag.appendChild(details);
  }

  return frag;
}

// Build one card for a GROUP of rows that share a document label. When
// the group has a single row, the card renders the legacy flat layout
// (issue + action + comment + edit). When it has multiple rows, the
// observations stack inside an ordered list with a count chip in the
// head and a SINGLE "edit this document" button at the bottom — so two
// observations on the same CAD file mean one upload, not two.
function _ipBuildCard(groupRows, opts) {
  const isReviewer = !!opts.isReviewer;
  const isResubmit = !!opts.isResubmit;
  const isReadOnly = !!opts.isReadOnly;
  const isEndorsed = !!opts.isEndorsed;
  const prevKeySet = opts.prevKeySet;
  const groupSize = groupRows.length;

  // Per-row carryforward state (drives card-level color border + per-
  // observation badges in stacked mode).
  const rowFlags = groupRows.map((r) => ({
    isPersistent: isResubmit && r.key && prevKeySet.has(r.key),
    isNew:        isResubmit && r.key && !prevKeySet.has(r.key),
  }));
  const allPersistent = rowFlags.every((f) => f.isPersistent);
  const allNew = rowFlags.every((f) => f.isNew);

  const card = document.createElement("li");
  let cardCls = "ip-card";
  if (allPersistent) cardCls += " ip-card--persistent";
  else if (allNew)   cardCls += " ip-card--new";
  if (groupSize > 1) cardCls += " ip-card--grouped";
  card.className = cardCls;
  card.dir = "rtl";
  // Stash all row keys so external code (e.g. tests, future tooling)
  // can find the group by either of its constituent issues.
  card.dataset.keys = groupRows.map((r) => r.key || "").filter(Boolean).join(",");

  // ── Head: doc chip + (count chip if grouped) + (status badge if N=1) ──
  const head = document.createElement("div");
  head.className = "ip-card-head";
  const doc = document.createElement("span");
  doc.className = "ip-card-doc";
  doc.textContent = (groupRows[0] && groupRows[0].document) || "";
  head.appendChild(doc);

  if (groupSize > 1) {
    const count = document.createElement("span");
    count.className = "ip-card-count";
    count.textContent = t("ip.group.count", { n: groupSize });
    head.appendChild(count);
  } else if (rowFlags[0] && (rowFlags[0].isPersistent || rowFlags[0].isNew)) {
    const status = document.createElement("span");
    status.className = "ip-card-status " + (rowFlags[0].isPersistent
      ? "ip-card-status--persistent"
      : "ip-card-status--new");
    status.textContent = rowFlags[0].isPersistent
      ? t("ip.card.status.persistent")
      : t("ip.card.status.new");
    head.appendChild(status);
  }

  // Origin badge — every row in #ip-cards comes from missing_data.
  // Blocking rows (missing layer, deed↔site-plan mismatch) get a
  // ⛔ critical chip; ordinary endorsed AI rows get the brain chip the
  // Phase-2 push feature added. The two states never coexist on the
  // same row, so the chip text is unambiguous.
  const isBlocking = groupRows.some((r) => r.blocking);
  if (isEndorsed) {
    const origin = document.createElement("span");
    if (isBlocking) {
      origin.className = "ip-card-origin ip-card-origin--blocking";
      origin.title = "ملاحظة حرجة — يجب معالجتها قبل متابعة التحليل";
      origin.textContent = "⛔ حرجة";
    } else {
      origin.className = "ip-card-origin";
      origin.title = "ملاحظة من النظام الذكي اعتمدها المراجع";
      origin.innerHTML = `${_brainSVG(13)}<span>معتمدة</span>`;
    }
    head.appendChild(origin);
  }

  // Reviewer-only: demote (un-push) toggle. Hidden on blocking rows
  // because the reviewer can't override a critical pre-analysis gate
  // — the issue must be fixed at the source. Pinned to the head's
  // trailing edge so it never crowds the issue text.
  if (isReviewer && isEndorsed && !isReadOnly && !isBlocking) {
    const groupKeys = groupRows.map((r) => r.key).filter(Boolean);
    if (groupKeys.length > 0) {
      const demote = document.createElement("button");
      demote.type = "button";
      demote.className = "ip-card-demote";
      demote.title = "إعادة هذه الملاحظة إلى قسم الاقتراحات (لن تكون إلزامية على المقدّم)";
      demote.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14V6M4 10l4 4 4-4M3 3h10"/></svg><span>تراجع عن الاعتماد</span>';
      demote.addEventListener("click", () => _ipTogglePush(groupKeys, false));
      head.appendChild(demote);
    }
  }

  card.appendChild(head);

  // ── Body: flat (N=1) or stacked observation list (N>1) ──
  if (groupSize === 1) {
    card.appendChild(_ipBuildObservationBody(groupRows[0], {
      isReviewer,
      showStatusBadge: false,  // already shown in head
      isPersistent: rowFlags[0].isPersistent,
      isNew:        rowFlags[0].isNew,
    }));
  } else {
    const list = document.createElement("ol");
    list.className = "ip-obs-list";
    groupRows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "ip-obs";
      const num = document.createElement("span");
      num.className = "ip-obs-num";
      num.textContent = (i + 1) + ".";
      li.appendChild(num);
      const inner = document.createElement("div");
      inner.className = "ip-obs-body";
      inner.appendChild(_ipBuildObservationBody(r, {
        isReviewer,
        // Show per-observation badge only when the group is mixed
        // (otherwise the card-level border already conveys it).
        showStatusBadge: !allPersistent && !allNew,
        isPersistent: rowFlags[i].isPersistent,
        isNew:        rowFlags[i].isNew,
      }));
      li.appendChild(inner);
      list.appendChild(li);
    });
    card.appendChild(list);
  }

  // ── Single "Edit this document" button per group (submitter only,
  //     and only while editing is still allowed: draft / needs_revision).
  //     Two observations on the same CAD file = ONE re-upload, not two.
  //     The button passes every key in the group; openInlineEditForm
  //     unions the slots so the form pre-checks exactly the right zones. ──
  if (!isReviewer && !isReadOnly && typeof window.__openInlineEditForm === "function") {
    const groupKeys = groupRows.map((r) => r.key).filter(Boolean);
    if (groupKeys.length > 0) {
      const actionsRow = document.createElement("div");
      actionsRow.className = "ip-card-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ip-card-edit-link";
      const ic = _ipSvg("M3 13l3-3 6-6 3 3-6 6-3 3z", { viewBox: "0 0 16 16", sw: "1.8" });
      btn.appendChild(ic);
      const lbl = document.createElement("span");
      lbl.textContent = t("ip.card.edit_this");
      btn.appendChild(lbl);
      btn.addEventListener("click", () => {
        try { window.__openInlineEditForm({ focusKeys: groupKeys }); } catch {}
      });
      actionsRow.appendChild(btn);
      card.appendChild(actionsRow);
    }
  }

  return card;
}

// Group rows by their document label (the chip text) preserving emit
// order. Rows with the same `document` string land in the same group;
// in practice these always share the same target slots so a single
// "edit" button per group is unambiguous.
function _ipGroupRowsByDocument(rows) {
  const groups = [];
  const indexByDoc = new Map();
  for (const r of rows) {
    const k = String(r.document || "");
    if (indexByDoc.has(k)) {
      groups[indexByDoc.get(k)].push(r);
    } else {
      indexByDoc.set(k, groups.length);
      groups.push([r]);
    }
  }
  return groups;
}

// Single render entry point — paints header + cards + resolved + role
// footer based on the current __missingData / __previousRound /
// banner.reviewStatus state. Idempotent and cheap; safe to call from
// every SSE event, replay step, language toggle, etc.
function renderIssuesPanel() {
  if (!ipPanel) return;
  const isReviewer = !!__APP_IS_REVIEWER;
  const status = (window.__reviewerBanner && window.__reviewerBanner.applicationId
    ? null : null);
  // The banner state lives inside reviewer.js; we read review_status from
  // the loaded meta for archive opens or the reviewer-banner module for
  // live runs. Defaults to "draft" for fresh submitter previews.
  const meta = window.__loadedAnalysisMeta || {};
  const reviewStatus = (window.__reviewerBanner && window.__reviewerBanner.reviewStatus)
    || meta.review_status
    || (isReviewer ? "pending" : "draft");

  const rows = __missingData.rows;
  const n = rows.length;
  const prevKeys = Array.isArray(__previousRound.keys) ? __previousRound.keys : [];
  const currentKeySet = new Set(rows.map((r) => r.key).filter(Boolean));
  const isResubmit = prevKeys.length > 0;

  // Decide which audience and which sub-flavour we're in.
  // (clean / has-issues × draft / needs_revision / pending / approved / rejected)
  const isNeedsRevision = reviewStatus === "needs_revision";
  const isClean = n === 0;
  // Submitter is read-only post-submit (and always for terminal states).
  // The issues panel still renders cards + reviewer comments + the "✓
  // resolved" strip — it just doesn't show any action buttons because
  // the submitter has nothing to do until the reviewer acts.
  const isSubmitterReadOnly = !isReviewer
    && reviewStatus !== "draft" && reviewStatus !== "needs_revision";

  // Reveal the panel: it stays visible across all states (clean shows
  // the green header + ready-to-send action, has-issues shows the cards
  // + per-role action footer). Hidden only before a pipeline starts.
  ipPanel.hidden = false;
  ipPanel.classList.toggle("ip--clean", isClean);
  ipPanel.classList.toggle(
    "ip--review-pending",
    isClean && (isReviewer || isSubmitterReadOnly)
      && (reviewStatus === "pending" || reviewStatus === "draft"),
  );
  ipPanel.classList.toggle("ip--read-only", isSubmitterReadOnly);

  // ── Header (status icon + title + sub) ──────────────────────────
  const titleEl = document.getElementById("ip-status-title");
  const subEl   = document.getElementById("ip-status-sub");
  const iconPath = isClean
    ? "M3 8.5l3.3 3L13 5"
    : "M10 6v4M10 13.5h.01";  // re-used inside the existing circle
  if (titleEl) {
    if (isSubmitterReadOnly) {
      // Submitter post-submit: title reflects the application's
      // current status (in review / approved / rejected) so the panel
      // reads as a status report instead of an action prompt.
      const tk = "ip.status." + (reviewStatus || "pending");
      titleEl.textContent = t(tk);
    } else if (isClean) {
      titleEl.textContent = isReviewer ? t("ip.status.review_pending") : t("ip.status.clean");
    } else {
      const key = isNeedsRevision || isReviewer
        ? (isNeedsRevision ? "ip.status.needs_revision" : "ip.status.review")
        : "ip.status.review";  // draft preview reuses "review" wording
      titleEl.textContent = t(key, { n, plural: _ipPluralWord(n) });
    }
  }
  if (subEl) {
    if (isResubmit && !isClean) {
      const newKeys = rows.filter((r) => !prevKeys.includes(r.key)).length;
      const persistKeys = n - newKeys;
      let subText;
      if (newKeys && persistKeys) {
        subText = t("ip.status.sub.mixed", { npersist: persistKeys, nnew: newKeys });
      } else if (newKeys) {
        subText = t("ip.status.sub.new", { n: newKeys });
      } else {
        subText = t("ip.status.sub.persistent", { n: persistKeys });
      }
      subEl.textContent = subText;
      subEl.hidden = false;
    } else {
      subEl.textContent = "";
      subEl.hidden = true;
    }
  }

  // Header CTA (submitter primary "Edit files" — shown when issues > 0
  // AND we're in a state where editing is allowed). Reviewer never
  // sees a header CTA; their primary lives in the action footer.
  const headerCta = document.getElementById("ip-cta");
  if (headerCta) {
    const submitterCanEdit = !isReviewer && !isClean
      && (reviewStatus === "draft" || reviewStatus === "needs_revision");
    headerCta.hidden = !submitterCanEdit;
    if (submitterCanEdit && !headerCta.__wired) {
      headerCta.__wired = true;
      headerCta.addEventListener("click", () => {
        try { window.__openInlineEditForm && window.__openInlineEditForm(); } catch {}
      });
    }
  }

  // ── Pre-analysis block banner ──────────────────────────────────
  // Visible whenever this analysis was halted by a blocking issue —
  // missing CAD layer, deed↔site-plan identity mismatch. Both reviewer
  // and submitter see it, but the action surface differs (submitter
  // gets the edit-files CTA; reviewer just sees the read-only banner
  // because there's nothing for them to decide until the submitter
  // re-uploads). The body.analysis-blocked class hides chart/KPIs.
  const isBlocked = !!(window.__blockingIssuesPresent
    || meta.blocking_issues_present
    || rows.some((r) => r.blocking));
  // Toggle (not just add) — re-renders after a successful resubmit
  // need to clear the blocked state when the new round comes in clean.
  document.body.classList.toggle("analysis-blocked", isBlocked);
  if (!isBlocked) window.__blockingIssuesPresent = false;
  const blockedBanner = document.getElementById("ip-blocked-banner");
  if (blockedBanner) {
    blockedBanner.hidden = !isBlocked;
    if (isBlocked) {
      const sub = document.getElementById("ip-blocked-banner-sub");
      if (sub) {
        const reason = window.__blockedReason || meta.blocked_reason || "";
        if (reason === "deed_site_plan_identity_mismatch") {
          sub.textContent = "السند ومخطط الموقع التنظيمي يصفان قطعتين مختلفتين — صحّح المستندات وأعد الرفع قبل متابعة التحليل.";
        } else if (reason === "cad_missing_required_layers") {
          sub.textContent = "ملف CAD لا يحتوي على جميع الطبقات المطلوبة (Lot, Building, Street). أضف الطبقات الناقصة وأعد الرفع.";
        } else {
          sub.textContent = "لا يمكن متابعة التحليل قبل معالجة الملاحظات أدناه. صحّح الملفات وأعد الرفع.";
        }
      }
    }
  }

  // ── Reviewer-only "submitted with known issues" chip ────────────
  const knownChip = document.getElementById("ip-known-chip");
  if (knownChip) {
    // Hide it when the analysis is in the focused blocked state — the
    // blocked banner above already conveys "something needs fixing".
    knownChip.hidden = isBlocked || !(isReviewer && meta.submitted_with_known_issues);
  }

  // ── Reviewer's overall freeform note (returned-for-revision view) ─
  // Submitter-only, and only when the reviewer left a non-empty note
  // on the latest decision. The auto-composed [doc]: issue — action
  // concatenation that this banner used to dump is GONE — we show
  // only what the reviewer actually wrote.
  const rnBox = document.getElementById("ip-reviewer-note");
  const rnBy  = document.getElementById("ip-rn-by");
  const rnBody = document.getElementById("ip-rn-body");
  if (rnBox && rnBy && rnBody) {
    let latestNote = "";
    let latestActor = "";
    let latestTs = "";
    if (!isReviewer && isNeedsRevision) {
      const hist = (meta.reviewer_notes_history || []).slice();
      for (let i = hist.length - 1; i >= 0; i--) {
        const e = hist[i];
        const k = e && e.kind;
        if (k === "submission" || k === "resubmission" || k === "draft_started") continue;
        if (e && (e.note || "").trim()) {
          latestNote = e.note;
          latestActor = e.reviewer_display || e.reviewer_username || "";
          latestTs = e.timestamp || "";
          break;
        }
      }
    }
    if (latestNote) {
      rnBox.hidden = false;
      const tsLabel = latestTs ? new Date(latestTs).toLocaleString("ar", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }) : "";
      rnBy.textContent = tsLabel ? `${latestActor} · ${tsLabel}` : latestActor;
      rnBody.textContent = latestNote;
    } else {
      rnBox.hidden = true;
      rnBy.textContent = "";
      rnBody.textContent = "";
    }
  }

  // ── Issue cards split by reviewer endorsement ───────────────────
  // Endorsed (pushed) rows render as mandatory cards in #ip-cards.
  // Un-endorsed rows render as a lighter advisory list inside the
  // collapsible #ip-suggestions block. Splitting happens BEFORE
  // grouping so each card contains rows of one endorsement state —
  // a single push toggle on the card flips the whole group.
  // The consultant-side view skips the push toggle but still sees
  // the mandatory/advisory split (un-pushed = collapsed suggestion).
  const prevKeySet = new Set(prevKeys);
  const endorsedRows = [];
  const unendorsedRows = [];
  for (const r of rows) {
    if (_ipIsEndorsed(r)) endorsedRows.push(r);
    else unendorsedRows.push(r);
  }

  if (ipCards) {
    ipCards.innerHTML = "";
    const groups = _ipGroupRowsByDocument(endorsedRows);
    for (const group of groups) {
      ipCards.appendChild(_ipBuildCard(group, {
        isReviewer,
        isResubmit,
        isReadOnly: isSubmitterReadOnly,
        prevKeySet,
        isEndorsed: true,
      }));
    }
  }

  const suggBox  = document.getElementById("ip-suggestions");
  const suggList = document.getElementById("ip-suggestions-list");
  const suggTitle = document.getElementById("ip-suggestions-title");
  if (suggBox && suggList) {
    if (unendorsedRows.length === 0) {
      suggBox.hidden = true;
      suggList.innerHTML = "";
    } else {
      suggBox.hidden = false;
      suggList.innerHTML = "";
      if (suggTitle) {
        suggTitle.textContent = isReviewer
          ? `اقتراحات النظام الذكي — ${unendorsedRows.length} لم تُعتمد`
          : `اقتراحات النظام الذكي — ${unendorsedRows.length}`;
      }
      // Flat list — every AI suggestion renders as its own row regardless
      // of which document pair it came from.
      for (const r of unendorsedRows) {
        suggList.appendChild(_ipBuildSuggestionItem(r, {
          isReviewer,
          isReadOnly: isSubmitterReadOnly,
        }));
      }
    }
  }

  // ── Resolved strip — keys that existed last round but not this ─
  if (ipResolved && ipResolvedList) {
    const resolved = prevKeys.filter((k) => k && !currentKeySet.has(k));
    if (resolved.length > 0) {
      ipResolvedList.innerHTML = "";
      const titleEl = document.getElementById("ip-resolved-title");
      if (titleEl) titleEl.textContent = t("ip.resolved.title");
      for (const k of resolved) {
        const sum = __previousRound.summary[k] || {};
        const li = document.createElement("li");
        const label = sum.issue
          ? (sum.document ? `[${sum.document}] ${sum.issue}` : sum.issue)
          : k;
        li.textContent = label;
        ipResolvedList.appendChild(li);
      }
      ipResolved.hidden = false;
    } else {
      ipResolved.hidden = true;
      ipResolvedList.innerHTML = "";
    }
  }

  // ── Role-aware action footer ────────────────────────────────────
  // Hidden entirely for the submitter once the application has left
  // the active states (draft / needs_revision) — there's nothing for
  // them to do until the reviewer acts. The panel above still shows
  // every flagged issue + every reviewer comment + the resolved
  // strip, all read-only.
  const reviewerFooter = document.getElementById("ip-actions-reviewer");
  const submitterFooter = document.getElementById("ip-actions-submitter");
  if (reviewerFooter) reviewerFooter.hidden = !isReviewer;
  if (submitterFooter) submitterFooter.hidden = isReviewer || isSubmitterReadOnly;
  // Header CTA also disappears in read-only mode (it's the same
  // "edit files" action as the footer's primary button).
  const headerCtaEl = document.getElementById("ip-cta");
  if (headerCtaEl && isSubmitterReadOnly) headerCtaEl.hidden = true;

  if (isReviewer) {
    // Approve label morphs based on whether there are open issues.
    const approveLabel = document.getElementById("ip-approve-label");
    if (approveLabel) {
      approveLabel.textContent = isClean
        ? t("rb.approve")
        : t("ip.confirm.approve.yes").replace(/^[^،,]*[،,]\s*/, "");
      // Strip leading "Yes," prefix so the button itself stays tidy;
      // the full "Yes, approve with notes" text is in the confirm.
    }
    // Hide both confirm panels by default; clicks below open them.
    const confApprove = document.getElementById("ip-confirm-approve");
    const confReject = document.getElementById("ip-confirm-reject");
    if (confApprove) confApprove.hidden = true;
    if (confReject) confReject.hidden = true;
    const confCount = document.getElementById("ip-confirm-approve-count");
    if (confCount) confCount.textContent = String(n);
  } else {
    // Submitter sub-state: clean / has-issues / has-issues-after-review
    const cleanMsg = document.getElementById("ip-sub-clean-msg");
    const btnClean = document.getElementById("ip-sub-submit-clean");
    const btnEdit  = document.getElementById("ip-sub-edit-files");
    const btnAnyway = document.getElementById("ip-sub-submit-anyway");
    const confAnyway = document.getElementById("ip-confirm-anyway");
    if (isClean) {
      if (cleanMsg) cleanMsg.hidden = false;
      if (btnClean) btnClean.hidden = false;
      if (btnEdit) btnEdit.hidden = true;
      if (btnAnyway) btnAnyway.hidden = true;
    } else {
      if (cleanMsg) cleanMsg.hidden = true;
      if (btnClean) btnClean.hidden = true;
      if (btnEdit) btnEdit.hidden = false;
      // Submit-anyway is only valid in the draft preview. After a
      // reviewer return, the only path forward is to fix files —
      // submit-anyway no longer applies.
      if (btnAnyway) btnAnyway.hidden = isNeedsRevision;
    }
    if (confAnyway) confAnyway.hidden = true;
  }

  // Keep the submitter button enable/disable state in sync so the bar
  // disables while the pipeline is still running.
  if (window.__submitterActions && typeof window.__submitterActions.refresh === "function") {
    window.__submitterActions.refresh();
  }
}
window.__renderIssuesPanel = renderIssuesPanel;

/* ============================================================
   Communication timeline — rendered for both reviewer and submitter
   views of the application (same /app page, role-aware). Every entry is
   one of:
     · submission       — the engineer first sent the application
     · reviewer decision — approve / reject / needs_revision (may
                           carry a freeform note)
     · resubmission     — the engineer uploaded fixed documents

   Icons per kind make the history scannable at a glance.
   ============================================================ */
function timelineEntryIconSVG(entry) {
  const kind = (entry && entry.kind) || "";
  const after = (entry && entry.status_after) || "";
  if (kind === "draft_started") {
    // Pencil-on-paper glyph — distinguishes the AI-preview phase from the
    // "submission" event that fires when the engineer actually sends.
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5L12 3.5l1.5 1.5L4.5 14L3 12.5z"/><path d="M11 4.5L12.5 6"/></svg>';
  }
  if (kind === "submission") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v10M4 6l4-4 4 4M3 13h10"/></svg>';
  }
  if (kind === "resubmission") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a5 5 0 0 1 8.5-3.5L13 7M13 3v4h-4"/><path d="M13 7a5 5 0 0 1-8.5 3.5L3 9M3 13v-4h4"/></svg>';
  }
  if (after === "approved") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.3 3L13 5"/></svg>';
  }
  if (after === "rejected") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  }
  if (after === "needs_revision") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h.01"/></svg>';
  }
  // Default dot
  return '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/></svg>';
}

function timelineEntryKindClass(entry) {
  if (!entry) return "";
  if (entry.kind === "draft_started") return "rp-te--draft";
  if (entry.kind === "submission") {
    return entry.submitted_with_known_issues
      ? "rp-te--submission rp-te--known-issues"
      : "rp-te--submission";
  }
  if (entry.kind === "resubmission") return "rp-te--resubmission";
  const after = entry.status_after || "";
  if (after === "approved") return "rp-te--approved";
  if (after === "rejected") return "rp-te--rejected";
  if (after === "needs_revision") return "rp-te--needs_revision";
  return "rp-te--default";
}

const _TIMELINE_STATUS_LABELS = {
  draft: "مسودة قبل الإرسال",
  pending: "قيد المراجعة",
  needs_revision: "بحاجة تعديل",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  "": "",
};

function _escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function _formatTimelineDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("ar", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function renderReviewTimeline(history) {
  const listEl = document.getElementById("rp-timeline-list");
  const countEl = document.getElementById("rp-timeline-count");
  if (!listEl) return;
  const entries = Array.isArray(history) ? history.slice() : [];
  if (entries.length === 0) {
    listEl.innerHTML = '<li class="rp-timeline-empty" dir="rtl">لا توجد أحداث بعد.</li>';
    if (countEl) countEl.textContent = "";
    return;
  }
  // Newest first
  entries.reverse();
  if (countEl) {
    countEl.textContent = entries.length === 1 ? "حدث واحد" : `${entries.length} أحداث`;
  }
  listEl.innerHTML = entries.map((e) => {
    const icon = timelineEntryIconSVG(e);
    const kindClass = timelineEntryKindClass(e);
    const actor = _escapeHtml(e.reviewer_display || e.reviewer_username || "—");
    const ts = _escapeHtml(_formatTimelineDate(e.timestamp));
    const before = _TIMELINE_STATUS_LABELS[e.status_before || ""] || (e.status_before || "");
    const after = _TIMELINE_STATUS_LABELS[e.status_after || ""] || (e.status_after || "");
    const note = _escapeHtml(e.note || "");
    const transitionHtml = e.kind === "submission"
      ? `<span class="rp-te-label">إرسال</span> <span class="rp-te-after">${_escapeHtml(after)}</span>`
      : (before
          ? `<span class="rp-te-before">${_escapeHtml(before)}</span> <span class="rp-te-arrow">←</span> <span class="rp-te-after">${_escapeHtml(after)}</span>`
          : `<span class="rp-te-after">${_escapeHtml(after)}</span>`);
    return `
      <li class="rp-te ${kindClass}" dir="rtl">
        <div class="rp-te-icon">${icon}</div>
        <div class="rp-te-body">
          <div class="rp-te-head">
            <span class="rp-te-actor">${actor}</span>
            <span class="rp-te-date">${ts}</span>
          </div>
          <div class="rp-te-transition">${transitionHtml}</div>
          ${note ? `<div class="rp-te-note">${note.replace(/\n/g, "<br>")}</div>` : ""}
        </div>
      </li>
    `;
  }).join("");
}

// Window-scoped so reviewer.js can call it after autoLoadFromQuery()
// without depending on script load order.
window.__renderReviewTimeline = renderReviewTimeline;


/* ============================================================
   Documents panel — fetches /api/analyses/{id}/history once and
   renders the current round's files (with download links) plus a
   collapsible per-round history of prior versions. Both reviewer
   and submitter use the same render. The fetch is cheap (one
   round-trip; payload bounded by chain length × ~5 fields per
   round) and is invoked from autoLoadFromQuery + after every
   successful submit/resubmit so the panel stays current without
   a full page reload.
   ============================================================ */
const _DP_SLOT_LABELS = {
  cad:           "مخطط CAD",
  pdf_deed:      "سند التسجيل",
  pdf_floor:     "خطة مساحة الطابقية",
  pdf_site_plan: "مخطط موقع تنظيمي",
  pdf_extras:    "وثيقة إضافية",
};
const _DP_STATUS_LABELS = {
  draft:          "مسودة",
  pending:        "قيد المراجعة",
  needs_revision: "بحاجة تعديل",
  approved:       "تمت الموافقة",
  rejected:       "مرفوض",
};

function _dpSlotKind(slot) {
  if (!slot) return "pdf_extras";
  if (slot.startsWith("pdf_extras")) return "pdf_extras";
  return slot;
}
function _dpSlotLabel(slot) {
  return _DP_SLOT_LABELS[_dpSlotKind(slot)] || slot;
}
function _dpSlotIconSVG(slot) {
  const kind = _dpSlotKind(slot);
  if (kind === "cad") {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 8h11M8 2.5v11"/></svg>';
  }
  // All PDF flavors share a generic doc glyph.
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4z"/><path d="M11 2v2h2"/></svg>';
}

function _dpBuildFileItem(f) {
  const li = document.createElement("li");
  li.className = "dp-file dp-file--" + _dpSlotKind(f.slot);
  li.dir = "rtl";

  const icon = document.createElement("span");
  icon.className = "dp-file-icon";
  icon.innerHTML = _dpSlotIconSVG(f.slot);
  li.appendChild(icon);

  const text = document.createElement("div");
  text.className = "dp-file-text";
  const slotLbl = document.createElement("span");
  slotLbl.className = "dp-file-slot";
  slotLbl.textContent = _dpSlotLabel(f.slot);
  text.appendChild(slotLbl);
  const nameEl = document.createElement("span");
  nameEl.className = "dp-file-name";
  nameEl.dir = "auto";
  nameEl.textContent = f.filename || "—";
  text.appendChild(nameEl);
  li.appendChild(text);

  if (f.available && f.url) {
    const link = document.createElement("a");
    link.className = "dp-file-link";
    link.href = f.url;
    link.download = f.filename || "";
    link.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1.5v6.5M3.5 6L6 8.5L8.5 6M2 10.5h8"/></svg><span>تحميل</span>';
    li.appendChild(link);
  } else {
    const missing = document.createElement("span");
    missing.className = "dp-file-missing";
    missing.textContent = "غير متوفر";
    li.appendChild(missing);
  }
  return li;
}

function _dpBuildPriorRound(round, ordinal) {
  const li = document.createElement("li");
  li.className = "dp-prev-round";
  li.dir = "rtl";

  const head = document.createElement("div");
  head.className = "dp-prev-round-head";

  const num = document.createElement("span");
  num.className = "dp-prev-round-num";
  num.textContent = `الجولة ${ordinal}`;
  head.appendChild(num);

  const ts = round.archived_at || round.finished_at || round.created_at;
  if (ts) {
    const dateEl = document.createElement("span");
    dateEl.className = "dp-prev-round-date";
    dateEl.textContent = "· " + _formatTimelineDate(ts);
    head.appendChild(dateEl);
  }
  if (round.missing_data_count > 0) {
    const issues = document.createElement("span");
    issues.className = "dp-prev-round-issues";
    issues.textContent = `· ${round.missing_data_count} ملاحظة`;
    head.appendChild(issues);
  }

  const statusKey = round.review_status || "";
  const statusLbl = _DP_STATUS_LABELS[statusKey];
  if (statusLbl) {
    const st = document.createElement("span");
    st.className = "dp-prev-round-status dp-prev-round-status--" + statusKey;
    st.textContent = statusLbl;
    head.appendChild(st);
  }
  li.appendChild(head);

  const files = document.createElement("ul");
  files.className = "dp-files";
  for (const f of (round.files || [])) {
    files.appendChild(_dpBuildFileItem(f));
  }
  li.appendChild(files);
  return li;
}

// Inline expandable per-event chrome on the review timeline. For each
// `draft_started` / `resubmission` event we attach a <details> with that
// round's AI feedback (missing_data rows) and download links for the
// files uploaded in that round. Pairing is positional: the chain is in
// chronological order, and so are the file-changing events — Nth such
// event ↔ Nth chain entry. Other event kinds (submission / approve /
// reject / needs_revision) get nothing because they don't correspond
// to a stored revision.
function _attachTimelineRoundDetails(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return;
  const listEl = document.getElementById("rp-timeline-list");
  if (!listEl) return;
  // Timeline is rendered newest-first; iterate in DOM-reverse for oldest-first.
  const rows = Array.from(listEl.querySelectorAll("li.rp-te"));
  rows.reverse();
  let chainIdx = 0;
  for (const row of rows) {
    const isFileChange = row.classList.contains("rp-te--draft")
      || row.classList.contains("rp-te--resubmission");
    if (!isFileChange) continue;
    if (chainIdx >= chain.length) break;
    const round = chain[chainIdx++];
    if (!round) continue;
    const body = row.querySelector(".rp-te-body");
    if (!body) continue;
    // Idempotent: if called twice (re-fetch after submit/resubmit), drop the
    // previous attachment first so we don't double-render.
    const prior = body.querySelector(".rp-te-round");
    if (prior) prior.remove();
    body.appendChild(_buildTimelineRoundDetails(round));
  }
}

function _buildTimelineRoundDetails(round) {
  const det = document.createElement("details");
  det.className = "rp-te-round";

  const summary = document.createElement("summary");
  summary.className = "rp-te-round-summary";
  const issuesCount = (round.missing_data || []).length;
  const filesCount = (round.files || []).length;
  const parts = [];
  if (filesCount > 0) parts.push(`${filesCount} ${filesCount === 1 ? "ملف" : "ملفات"}`);
  parts.push(issuesCount > 0
    ? `${issuesCount} ${issuesCount === 1 ? "ملاحظة" : "ملاحظات"} من النظام الذكي`
    : "بدون ملاحظات من النظام الذكي");
  summary.innerHTML = `<svg class="rp-te-round-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l4 5-4 5"/></svg><span class="rp-te-round-summary-text">عرض ملفات هذه الجولة وملاحظاتها — ${_escapeHtml(parts.join(" · "))}</span>`;
  det.appendChild(summary);

  const body = document.createElement("div");
  body.className = "rp-te-round-body";

  const files = round.files || [];
  if (files.length > 0) {
    const fHead = document.createElement("div");
    fHead.className = "rp-te-round-section-head";
    fHead.textContent = "ملفات الجولة";
    body.appendChild(fHead);
    const filesList = document.createElement("ul");
    filesList.className = "rp-te-round-files dp-files";
    for (const f of files) filesList.appendChild(_dpBuildFileItem(f));
    body.appendChild(filesList);
  }

  const missing = round.missing_data || [];
  const iHead = document.createElement("div");
  iHead.className = "rp-te-round-section-head";
  iHead.textContent = "ملاحظات النظام الذكي";
  body.appendChild(iHead);
  if (missing.length === 0) {
    const ok = document.createElement("div");
    ok.className = "rp-te-round-ok";
    ok.textContent = "✓ لم يرصد النظام الذكي ملاحظات في هذه الجولة";
    body.appendChild(ok);
  } else {
    const issuesList = document.createElement("ul");
    issuesList.className = "rp-te-round-issues";
    for (const r of missing) {
      const li = document.createElement("li");
      li.className = "rp-te-round-issue";
      const doc = (r && r.document) || "";
      const issue = (r && r.issue) || "";
      const action = (r && r.action) || "";
      const docHtml = doc ? `<span class="rp-te-round-issue-doc">[${_escapeHtml(doc)}]</span> ` : "";
      const issueHtml = `<span class="rp-te-round-issue-text">${_escapeHtml(issue)}</span>`;
      const actionHtml = action ? `<div class="rp-te-round-issue-action">${_escapeHtml(action)}</div>` : "";
      li.innerHTML = docHtml + issueHtml + actionHtml;
      issuesList.appendChild(li);
    }
    body.appendChild(issuesList);
  }

  det.appendChild(body);
  return det;
}

async function renderDocumentsPanel(analysisId) {
  if (!analysisId) return;
  const panel = document.getElementById("documents-panel");
  if (!panel) return;
  let chain = [];
  try {
    const r = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/history`, { cache: "no-store" });
    if (!r.ok) return;
    const body = await r.json();
    chain = (body && body.history) || [];
  } catch (err) {
    console.error("documents-panel fetch", err);
    return;
  }
  if (!Array.isArray(chain) || chain.length === 0) return;

  // Chain is oldest → current. Current is the entry whose analysis_id
  // matches the requested one (defensive: should always be the last).
  let currentIdx = chain.length - 1;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] && chain[i].analysis_id === analysisId) { currentIdx = i; break; }
  }
  const current = chain[currentIdx] || {};
  const previous = chain.slice(0, currentIdx);

  // Round badge — only useful when there's actually a chain.
  const badge = document.getElementById("dp-round-badge");
  if (badge) {
    if (chain.length > 1) {
      badge.hidden = false;
      badge.textContent = `الجولة ${currentIdx + 1} من ${chain.length}`;
    } else {
      badge.hidden = true;
      badge.textContent = "";
    }
  }

  // Current round's files — stable grid.
  const currentList = document.getElementById("dp-files-current");
  if (currentList) {
    currentList.innerHTML = "";
    const files = current.files || [];
    if (files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "dp-file-missing";
      empty.style.gridColumn = "1 / -1";
      empty.style.padding = "10px";
      empty.style.textAlign = "center";
      empty.textContent = "لا توجد وثائق مُسجَّلة لهذه الجولة.";
      currentList.appendChild(empty);
    } else {
      for (const f of files) currentList.appendChild(_dpBuildFileItem(f));
    }
  }

  // Previous-rounds collapsible. Newest prior round on top so the
  // reviewer reads back-in-time naturally.
  const prevWrap = document.getElementById("dp-prev-rounds");
  const prevList = document.getElementById("dp-prev-list");
  const prevCount = document.getElementById("dp-prev-count");
  if (prevWrap && prevList) {
    if (previous.length === 0) {
      prevWrap.hidden = true;
      prevList.innerHTML = "";
      if (prevCount) prevCount.textContent = "";
    } else {
      prevWrap.hidden = false;
      prevList.innerHTML = "";
      if (prevCount) prevCount.textContent = `(${previous.length})`;
      const reversed = previous.slice().reverse();
      reversed.forEach((round, i) => {
        const ordinal = previous.length - i;  // round number in chain order
        prevList.appendChild(_dpBuildPriorRound(round, ordinal));
      });
    }
  }

  panel.hidden = false;

  // Inject per-event AI-feedback + download details into the timeline
  // rows. Done here (after the chain has loaded) instead of in
  // renderReviewTimeline so the timeline render stays sync. Re-runs are
  // idempotent — _attachTimelineRoundDetails removes the prior <details>
  // before appending a fresh one.
  try { _attachTimelineRoundDetails(chain); } catch (err) {
    console.error("timeline round attach", err);
  }
}
window.__renderDocumentsPanel = renderDocumentsPanel;


/* ============================================================
   Rounds panel — round-centric consolidation that replaces the
   visual three-section layout (timeline + documents + issues).
   Each submission round renders as one .rc card containing:
     · header  — round#, status pill, started date, actors
     · files   — current round's documents with per-file AI/
                 reviewer note count badges
     · notes   — reviewer's freeform decision note (past rounds)
                 or AI-suggestions block (collapsed)
     · slot    — for the ACTIVE round, we re-parent the existing
                 #issues-panel into the card body so all live SSE
                 rendering + action-footer wiring keeps working
                 unchanged. The legacy timeline + documents
                 panels are hidden via .review-panel--rounds-active.

   The renderer is read-mostly — it does not create any new
   server-side state. It paints from /history (chain) +
   meta.reviewer_notes_history (events). Pairing of events to
   rounds is positional: each round matches the Nth file-changing
   event (draft_started or resubmission). Decisions and
   submissions in between attach to their preceding round.
   ============================================================ */

const _RC_STATUS_LABELS = {
  draft:          "مسودة قبل الإرسال",
  pending:        "قيد المراجعة",
  needs_revision: "بحاجة تعديل",
  approved:       "تمت الموافقة",
  rejected:       "مرفوض",
};

// Group reviewer_notes_history into round-shaped buckets. A new bucket
// starts on every `draft_started` / `resubmission` event. Subsequent
// `submission` and decision events attach to that bucket. Returned
// buckets are in chain order (oldest → newest). The returned length
// should match the chain length; defensively pad if not.
function _rcGroupEventsByRound(events, chainLen) {
  const buckets = [];
  let cur = null;
  for (const e of (events || [])) {
    const k = (e && e.kind) || "";
    if (k === "draft_started" || k === "resubmission") {
      cur = { started: e, submitted: null, decided: null };
      buckets.push(cur);
      continue;
    }
    if (!cur) {
      // Defensive: an event before any draft_started — treat as a
      // synthetic first round so we don't lose it.
      cur = { started: null, submitted: null, decided: null };
      buckets.push(cur);
    }
    if (k === "submission") {
      cur.submitted = e;
    } else if (e && e.status_after && e.status_after !== "draft" && e.status_after !== "pending") {
      cur.decided = e;
    } else if (e && e.status_after === "pending") {
      // status changes to pending without a kind — likely a submission shadow.
      if (!cur.submitted) cur.submitted = e;
    } else {
      cur.decided = e;  // best-effort fallback
    }
  }
  // Pad/truncate to chain length so positional pairing is stable.
  while (buckets.length < chainLen) buckets.push({ started: null, submitted: null, decided: null });
  if (buckets.length > chainLen) buckets.length = chainLen;
  return buckets;
}

// Map a missing_data row to a file slot. The row's `document` field
// uses values like "CAD", "pdf_deed", or sometimes a filename. We
// normalize to the canonical slot key via _dpSlotKind. Falls back to
// "pdf_extras" so badges aggregate sensibly when the doc field is fuzzy.
function _rcDocToSlot(doc) {
  if (!doc) return "pdf_extras";
  const lower = String(doc).toLowerCase();
  if (lower === "cad" || lower.startsWith("cad")) return "cad";
  if (lower.startsWith("pdf_extras")) return "pdf_extras";
  if (lower === "pdf_deed" || lower.includes("سند") || lower.includes("deed")) return "pdf_deed";
  if (lower === "pdf_floor" || lower.includes("طابقية") || lower.includes("floor")) return "pdf_floor";
  if (lower === "pdf_site_plan" || lower.includes("تنظيمي") || lower.includes("site")) return "pdf_site_plan";
  return "pdf_extras";
}

// Count missing_data rows per file slot for the per-file AI badge.
function _rcAiCountsByFile(missingData) {
  const counts = {};
  for (const r of (missingData || [])) {
    const slot = _rcDocToSlot(r && r.document);
    counts[slot] = (counts[slot] || 0) + 1;
  }
  return counts;
}

// Build a file row (with optional badges) for a round body. Reuses
// _dpBuildFileItem and decorates it with badge chips for AI/reviewer
// counts that target this file.
function _rcBuildFileItem(f, aiCounts, reviewerCounts) {
  const li = _dpBuildFileItem(f);
  const slot = _dpSlotKind(f.slot);
  const aiN = aiCounts[slot] || 0;
  const revN = (reviewerCounts && reviewerCounts[slot]) || 0;
  if (aiN === 0 && revN === 0) return li;
  const wrap = document.createElement("span");
  wrap.className = "rc-file-badges";
  if (aiN > 0) {
    const b = document.createElement("span");
    b.className = "rc-file-badge rc-file-badge--ai";
    b.innerHTML = `${_brainSVG(11)}<span>${aiN}</span>`;
    b.title = aiN === 1
      ? "ملاحظة من النظام الذكي"
      : aiN + " ملاحظات من النظام الذكي";
    wrap.appendChild(b);
  }
  if (revN > 0) {
    const b = document.createElement("span");
    b.className = "rc-file-badge rc-file-badge--reviewer";
    b.textContent = "💬 " + revN;
    b.title = revN === 1
      ? "ملاحظة من المراجع"
      : revN + " ملاحظات من المراجع";
    wrap.appendChild(b);
  }
  // Insert the badges before the download link so the row reads
  // [icon][text]      [badges] [download]
  const link = li.querySelector(".dp-file-link, .dp-file-missing");
  if (link) li.insertBefore(wrap, link);
  else li.appendChild(wrap);
  return li;
}

function _rcStatusPill(status) {
  const span = document.createElement("span");
  span.className = "rc-status rc-status--" + (status || "draft");
  span.textContent = _RC_STATUS_LABELS[status] || status || "—";
  return span;
}

function _rcChevSVG() {
  return '<svg class="rc-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l4 5-4 5"/></svg>';
}

// Brain icon (Lucide-style). Single source of truth for the AI marker so
// every "this came from the AI" chip / badge / summary uses the same glyph.
// Pass `size` in px; defaults to 14. Inherits color via currentColor.
function _brainSVG(size) {
  const s = size || 14;
  return `<svg class="brain-icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>`;
}

function _rcActorLine(label, actor) {
  if (!actor) return "";
  return `<span class="rc-actor">${_escapeHtml(label)} <strong>${_escapeHtml(actor)}</strong></span>`;
}

// Build a past-round card (collapsed <details>). Shows files + AI
// notes + reviewer's decision note inside.
function _rcBuildPastCard(round, ordinal, events) {
  const det = document.createElement("details");
  det.className = "rc rc--past";
  det.dir = "rtl";

  const summary = document.createElement("summary");
  summary.className = "rc-head";
  const ts = (events.decided && events.decided.timestamp)
    || (events.submitted && events.submitted.timestamp)
    || (events.started && events.started.timestamp)
    || round.archived_at || round.created_at;
  const dateLbl = ts ? _formatTimelineDate(ts) : "";
  const aiCount = (round.missing_data || []).length;
  const aiChip = aiCount > 0
    ? `<span class="rc-summary-chip rc-summary-chip--ai">${_brainSVG(11)}<span>${aiCount}</span></span>`
    : "";
  const startedActor = events.started && (events.started.reviewer_display || events.started.reviewer_username);
  const decidedActor = events.decided && (events.decided.reviewer_display || events.decided.reviewer_username);
  summary.innerHTML = `
    ${_rcChevSVG()}
    <span class="rc-num">الجولة ${ordinal}</span>
    <span class="rc-status rc-status--${_escapeHtml(round.review_status || "draft")}">${_escapeHtml(_RC_STATUS_LABELS[round.review_status] || round.review_status || "")}</span>
    <span class="rc-date">${_escapeHtml(dateLbl)}</span>
    ${aiChip}
    <span class="rc-actors">
      ${startedActor ? _rcActorLine("قدّم:", startedActor) : ""}
      ${decidedActor && decidedActor !== startedActor ? _rcActorLine("راجع:", decidedActor) : ""}
    </span>
  `;
  det.appendChild(summary);

  const body = document.createElement("div");
  body.className = "rc-body";

  // AI notes — collapsed by default. Rendered first so the engineer / reviewer
  // sees the system's findings before the document grid.
  const missing = round.missing_data || [];
  if (missing.length > 0) {
    const ai = document.createElement("details");
    ai.className = "rc-ai-block";
    const sum = document.createElement("summary");
    sum.innerHTML = `${_rcChevSVG()}${_brainSVG(13)}<span>ملاحظات النظام الذكي (${missing.length})</span>`;
    ai.appendChild(sum);
    const ul = document.createElement("ul");
    ul.className = "rc-ai-list";
    for (const r of missing) {
      const li = document.createElement("li");
      li.className = "rc-ai-item";
      const doc = (r && r.document) || "";
      const issue = (r && r.issue) || "";
      const action = (r && r.action) || "";
      const docHtml = doc ? `<span class="rc-ai-item-doc">[${_escapeHtml(doc)}]</span>` : "";
      const issueHtml = `<span>${_escapeHtml(issue)}</span>`;
      const actionHtml = action ? `<div class="rc-ai-item-action">${_escapeHtml(action)}</div>` : "";
      li.innerHTML = docHtml + issueHtml + actionHtml;
      ul.appendChild(li);
    }
    ai.appendChild(ul);
    body.appendChild(ai);
  }

  // Files — collapsible <details> so the round card stays compact.
  const files = round.files || [];
  if (files.length > 0) {
    const aiCounts = _rcAiCountsByFile(round.missing_data);
    const filesBlock = document.createElement("details");
    filesBlock.className = "rc-files-block";
    const fsum = document.createElement("summary");
    fsum.className = "rc-files-summary";
    const label = files.length === 1
      ? "وثيقة الجولة"
      : `وثائق الجولة (${files.length})`;
    fsum.innerHTML = `${_rcChevSVG()}<span>${_escapeHtml(label)}</span>`;
    filesBlock.appendChild(fsum);
    const list = document.createElement("ul");
    list.className = "rc-files";
    for (const f of files) list.appendChild(_rcBuildFileItem(f, aiCounts, null));
    filesBlock.appendChild(list);
    body.appendChild(filesBlock);
  }

  // Reviewer's freeform decision note (if any)
  if (events.decided && (events.decided.note || "").trim()) {
    const note = document.createElement("div");
    note.className = "rc-reviewer-note";
    const head = document.createElement("div");
    head.className = "rc-reviewer-note-head";
    const actor = events.decided.reviewer_display || events.decided.reviewer_username || "—";
    const tsLbl = events.decided.timestamp ? _formatTimelineDate(events.decided.timestamp) : "";
    head.innerHTML = `<span class="rc-reviewer-note-actor">${_escapeHtml(actor)}</span><span>· ${_escapeHtml(tsLbl)}</span>`;
    note.appendChild(head);
    const bd = document.createElement("div");
    bd.className = "rc-reviewer-note-body";
    bd.textContent = events.decided.note;
    note.appendChild(bd);
    body.appendChild(note);
  }

  det.appendChild(body);
  return det;
}

// Build the active-round card. Files + actors header; the existing
// #issues-panel is re-parented into this card by the caller (so this
// function only builds the chrome above the issues panel).
function _rcBuildActiveCard(round, ordinal, events) {
  const card = document.createElement("article");
  card.className = "rc rc--active";
  card.dir = "rtl";

  const head = document.createElement("header");
  head.className = "rc-head";
  const ts = (events.submitted && events.submitted.timestamp)
    || (events.started && events.started.timestamp)
    || round.created_at;
  const dateLbl = ts ? _formatTimelineDate(ts) : "";
  const startedActor = events.started && (events.started.reviewer_display || events.started.reviewer_username);
  const submittedActor = events.submitted && (events.submitted.reviewer_display || events.submitted.reviewer_username);
  head.innerHTML = `
    <span class="rc-num">الجولة ${ordinal}</span>
    <span class="rc-status rc-status--${_escapeHtml(round.review_status || "draft")}">${_escapeHtml(_RC_STATUS_LABELS[round.review_status] || round.review_status || "")}</span>
    <span class="rc-date">${_escapeHtml(dateLbl)}</span>
    <span class="rc-actors">
      ${startedActor ? _rcActorLine("قدّم:", startedActor) : ""}
      ${submittedActor && submittedActor !== startedActor ? _rcActorLine("أرسل:", submittedActor) : ""}
    </span>
  `;
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "rc-body";

  // Slot for the issues panel — caller moves #issues-panel here. Rendered
  // first so the AI suggestions / decision banner sit above the file grid.
  const slot = document.createElement("div");
  slot.className = "rc-issues-slot";
  slot.id = "rc-issues-slot";
  body.appendChild(slot);

  // Files — collapsible <details> so the round card stays compact.
  const files = round.files || [];
  if (files.length > 0) {
    const aiCounts = _rcAiCountsByFile(round.missing_data);
    const filesBlock = document.createElement("details");
    filesBlock.className = "rc-files-block";
    const fsum = document.createElement("summary");
    fsum.className = "rc-files-summary";
    const label = files.length === 1
      ? "وثيقة الجولة"
      : `وثائق الجولة (${files.length})`;
    fsum.innerHTML = `${_rcChevSVG()}<span>${_escapeHtml(label)}</span>`;
    filesBlock.appendChild(fsum);
    const list = document.createElement("ul");
    list.className = "rc-files";
    for (const f of files) list.appendChild(_rcBuildFileItem(f, aiCounts, null));
    filesBlock.appendChild(list);
    body.appendChild(filesBlock);
  }

  card.appendChild(body);
  return card;
}

async function renderRoundsPanel(analysisId) {
  if (!analysisId) return;
  const panel = document.getElementById("rounds-panel");
  const reviewPanel = document.getElementById("review-panel");
  if (!panel || !reviewPanel) return;

  let chain = [];
  try {
    const r = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/history`, { cache: "no-store" });
    if (!r.ok) return;
    const body = await r.json();
    chain = (body && body.history) || [];
  } catch (err) {
    console.error("rounds-panel fetch", err);
    return;
  }
  if (!Array.isArray(chain) || chain.length === 0) return;

  // Identify the current (active) round — the entry that matches the
  // requested analysis id. Defensive: fall back to the last entry.
  let currentIdx = chain.length - 1;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] && chain[i].analysis_id === analysisId) { currentIdx = i; break; }
  }

  // Group reviewer events into per-round buckets.
  const meta = window.__loadedAnalysisMeta || {};
  const events = meta.reviewer_notes_history || [];
  const buckets = _rcGroupEventsByRound(events, chain.length);

  // Newest round on top. Past rounds collapsed; active round expanded.
  panel.innerHTML = "";
  for (let i = chain.length - 1; i >= 0; i--) {
    const round = chain[i];
    const ordinal = i + 1;
    const evs = buckets[i] || { started: null, submitted: null, decided: null };
    if (i === currentIdx) {
      panel.appendChild(_rcBuildActiveCard(round, ordinal, evs));
    } else {
      panel.appendChild(_rcBuildPastCard(round, ordinal, evs));
    }
  }

  // Re-parent the existing #issues-panel into the active round's slot.
  // Idempotent: if it's already in the slot we leave it alone.
  const issuesPanel = document.getElementById("issues-panel");
  const slot = document.getElementById("rc-issues-slot");
  if (issuesPanel && slot && issuesPanel.parentNode !== slot) {
    slot.appendChild(issuesPanel);
  }

  panel.hidden = false;
  reviewPanel.classList.add("review-panel--rounds-active");
}
window.__renderRoundsPanel = renderRoundsPanel;


/* The legacy auto-composed reviewer note (`buildRevisionNote`) is gone —
   it dumped every row's [doc] issue — action concat into reviewer_notes,
   creating triple duplication with the table + per-row comments below.
   The new panel keeps reviewer_notes as a real freeform overall message
   (typed into #ip-rev-note-input) and lets per-row guidance live in
   missing_data_comments where it belongs. */

/* ============================================================
   Submission guide — collapse/expand toggle on the upload view
   ============================================================ */
(function initSubmissionGuide() {
  const guide = document.getElementById("submission-guide");
  const toggle = document.getElementById("sg-toggle");
  if (!guide || !toggle) return;
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    toggle.setAttribute("aria-expanded", String(next));
    guide.classList.toggle("sg-collapsed", !next);
  });
})();
// Success toast shown on the review panel after approve / reject /
// needs_revision lands. Sits under the action bar; auto-hides when we
// redirect the reviewer to their dashboard so they see the queue update.
function showReviewToast(msg, variant) {
  let el = document.getElementById("rp-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "rp-toast";
    el.className = "rp-toast";
    const panel = document.getElementById("review-panel");
    if (panel) panel.appendChild(el);
    else document.body.appendChild(el);
  }
  el.className = "rp-toast rp-toast--" + (variant || "ok");
  el.textContent = msg;
  el.hidden = false;
}

const REVIEW_SUCCESS_MESSAGES = {
  approved: "تمت الموافقة على الطلب. جارٍ إعادة التوجيه إلى لوحة التحكم…",
  rejected: "تم رفض الطلب مع إرسال الملاحظات. جارٍ إعادة التوجيه إلى لوحة التحكم…",
  needs_revision: "تم إرسال الطلب إلى المقدّم مع الملاحظات. جارٍ إعادة التوجيه إلى لوحة التحكم…",
};

async function submitReviewStatus(status, notes, opts) {
  // Single entry point for approve / reject / needs_revision. On success
  // shows a toast and redirects the reviewer back to the dashboard so
  // the action feels final and the updated status is visible in the
  // queue. Per-row reviewer comments collected in __pendingRowComments
  // piggy-back on this call so a single PATCH commits decision +
  // comments + (when relevant) approved_with_open_issues atomically.
  const rowComments = (typeof window !== "undefined" && window.__pendingRowComments) || {};
  const hasRowComments = Object.keys(rowComments).length > 0;
  const rowEndorsed = (typeof window !== "undefined" && window.__pendingRowEndorsements) || {};
  const hasRowEndorsed = Object.keys(rowEndorsed).length > 0;
  const approvedWithOpenIssues = !!(opts && opts.approvedWithOpenIssues);
  try {
    if (window.__reviewerBanner && typeof window.__reviewerBanner.submitStatus === "function") {
      await window.__reviewerBanner.submitStatus(status, notes,
        hasRowComments ? rowComments : null,
        { approvedWithOpenIssues, rowEndorsements: hasRowEndorsed ? rowEndorsed : null });
    } else {
      const appId = window.__reviewerBanner && window.__reviewerBanner.applicationId;
      if (appId) {
        const res = await fetch(`/api/analyses/${encodeURIComponent(appId)}/meta`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            review_status: status,
            ...(typeof notes === "string" ? { reviewer_notes: notes } : {}),
            ...(hasRowComments ? { missing_data_comments: rowComments } : {}),
            ...(hasRowEndorsed ? { missing_data_endorsed: rowEndorsed } : {}),
            ...(status === "approved" ? { approved_with_open_issues: approvedWithOpenIssues } : {}),
          }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      }
    }
  } catch (err) {
    console.error("submit-review-status", err);
    showReviewToast("تعذّر حفظ القرار — حاول مرة أخرى.", "err");
    return false;
  }
  showReviewToast(REVIEW_SUCCESS_MESSAGES[status] || "تم حفظ القرار. جارٍ إعادة التوجيه…", "ok");
  // Give the user ~1.2s to read the toast before redirecting.
  setTimeout(() => window.location.assign("/dashboard"), 1200);
  return true;
}
window.__submitReviewStatus = submitReviewStatus;

/* ──────────────────────────────────────────────────────────────────
   Reviewer-decision wiring on the new issues panel.
   Approve: gated by an inline confirm if open issues exist; persists
            approved_with_open_issues=true on that path.
   Needs-revision: uses whatever the reviewer typed in the inline
            #ip-rev-note-input as the freeform overall note (no auto-
            compose), plus per-row comments. Empty note is allowed.
   Reject: hard inline confirm because it's terminal.
   ────────────────────────────────────────────────────────────────── */
function _ipReadOverallNote() {
  const ta = document.getElementById("ip-rev-note-input");
  return (ta && ta.value || "").trim();
}
function _ipDisableActionButtons(disabled) {
  ["ip-approve", "ip-needs-revision", "ip-reject",
   "ip-confirm-approve-yes", "ip-confirm-reject-yes"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !!disabled;
  });
}

(function wireReviewerPanelActions() {
  if (!__APP_IS_REVIEWER) return;
  const btnApprove = document.getElementById("ip-approve");
  const btnNeeds   = document.getElementById("ip-needs-revision");
  const btnReject  = document.getElementById("ip-reject");
  const confApprove = document.getElementById("ip-confirm-approve");
  const confReject  = document.getElementById("ip-confirm-reject");

  if (btnApprove) {
    btnApprove.addEventListener("click", async () => {
      const openCount = __missingData.rows.length;
      if (openCount > 0) {
        // Open the inline confirm — the actual PATCH waits for the
        // explicit "yes" inside that confirm.
        const cnt = document.getElementById("ip-confirm-approve-count");
        if (cnt) cnt.textContent = String(openCount);
        if (confApprove) confApprove.hidden = false;
        return;
      }
      _ipDisableActionButtons(true);
      const ok = await submitReviewStatus("approved", _ipReadOverallNote() || undefined,
        { approvedWithOpenIssues: false });
      if (!ok) _ipDisableActionButtons(false);
    });
  }
  const btnApproveCancel = document.getElementById("ip-confirm-approve-cancel");
  if (btnApproveCancel) {
    btnApproveCancel.addEventListener("click", () => { if (confApprove) confApprove.hidden = true; });
  }
  const btnApproveYes = document.getElementById("ip-confirm-approve-yes");
  if (btnApproveYes) {
    btnApproveYes.addEventListener("click", async () => {
      _ipDisableActionButtons(true);
      const ok = await submitReviewStatus("approved", _ipReadOverallNote() || undefined,
        { approvedWithOpenIssues: true });
      if (!ok) _ipDisableActionButtons(false);
    });
  }

  if (btnNeeds) {
    btnNeeds.addEventListener("click", async () => {
      _ipDisableActionButtons(true);
      const ok = await submitReviewStatus("needs_revision", _ipReadOverallNote());
      if (!ok) _ipDisableActionButtons(false);
    });
  }

  if (btnReject) {
    btnReject.addEventListener("click", () => {
      if (confReject) confReject.hidden = false;
    });
  }
  const btnRejectCancel = document.getElementById("ip-confirm-reject-cancel");
  if (btnRejectCancel) {
    btnRejectCancel.addEventListener("click", () => { if (confReject) confReject.hidden = true; });
  }
  const btnRejectYes = document.getElementById("ip-confirm-reject-yes");
  if (btnRejectYes) {
    btnRejectYes.addEventListener("click", async () => {
      _ipDisableActionButtons(true);
      const ok = await submitReviewStatus("rejected", _ipReadOverallNote());
      if (!ok) _ipDisableActionButtons(false);
    });
  }
})();

/* ============================================================
   State
   ============================================================ */

let selectedFile = null;
let selectedPdf = null;        // optional deed PDF companion (سند التسجيل)
let selectedFloor = null;      // optional floor-area plan PDF (خطة مساحة الطابقية)
let selectedExtras = [];       // optional additional PDFs (0..N, وثائق إضافية)
let selectedSitePlan = null;   // optional regulatory site-plan PDF (مخطط موقع تنظيمي)
let selectedMeasurement = null; // optional measurement PDF — viewer-only, no pipeline
let uploadedFileExt = "";      // extension of the currently-uploading file (used by step labels)
// Map of pending step cards keyed by tool_use_id. Each tool_start emits an
// `id` field (the model's tool_use_id, unique per request); tool_end carries
// the same id so we can match them even when multiple tools run in parallel
// in a single turn (e.g. extract_polylines for building + lot via
// asyncio.gather on the backend). The previous design used a single shared
// `pendingToolCard` slot which the second parallel tool_start would overwrite,
// leaving the first card stuck in "running".
const pendingToolCards = new Map();    // tool_use_id -> {el, toolName, args}
// Insertion-ordered fallback queue for legacy/replayed events that don't
// carry an id (e.g. archived analyses persisted before this fix). Iterated
// in arrival order so completeStep can match to the oldest pending entry
// with the same toolName.
let _pendingFallbackKey = 0;
let currentReasoning = null;   // streaming reasoning bubble, reset on each tool_start / turn_start
let totalTokens = 0;
let stepCompleted = 0;
let currentEventSource = null;

/* ============================================================
   Upload UI
   ============================================================ */

function updateAnalyzeBtn() {
  // File presence is enforced on the frontend: all 4 required documents
  // (CAD + deed + floor plan + site plan) must be picked before the
  // Analyze button goes live. pdf_extras stay optional.
  analyzeBtn.disabled = !(selectedFile && selectedPdf && selectedFloor && selectedSitePlan);
}

function setFile(file) {
  selectedFile = file;
  if (file) {
    dropText.removeAttribute("data-i18n");       // now showing the filename, not a translatable label
    dropText.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
    const dotIdx = file.name.lastIndexOf(".");
    uploadedFileExt = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : "";
  } else {
    setI18n(dropText, "upload.cad.text");
    uploadedFileExt = "";
  }
  updateAnalyzeBtn();
}
fileInput.addEventListener("change", () => setFile(fileInput.files[0] || null));
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f) { fileInput.files = e.dataTransfer.files; setFile(f); }
});

// --- PDF drop zone (optional companion upload) ---
function setPdf(file) {
  selectedPdf = file;
  if (file) {
    pdfDropText.removeAttribute("data-i18n");
    pdfDropText.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
    pdfDropZone.classList.add("has-file");
  } else {
    setI18n(pdfDropText, "upload.pdf.text");
    pdfDropZone.classList.remove("has-file");
  }
  updateAnalyzeBtn();
}
pdfInput.addEventListener("change", () => setPdf(pdfInput.files[0] || null));
pdfDropZone.addEventListener("dragover", (e) => { e.preventDefault(); pdfDropZone.classList.add("dragover"); });
pdfDropZone.addEventListener("dragleave", () => pdfDropZone.classList.remove("dragover"));
pdfDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  pdfDropZone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) { pdfInput.files = e.dataTransfer.files; setPdf(f); }
});

// --- Floor-area plan drop zone (second optional PDF) ---
function setFloor(file) {
  selectedFloor = file;
  if (file) {
    floorDropText.removeAttribute("data-i18n");
    floorDropText.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
    floorDropZone.classList.add("has-file");
  } else {
    setI18n(floorDropText, "upload.floor.text");
    floorDropZone.classList.remove("has-file");
  }
  updateAnalyzeBtn();
}
floorInput.addEventListener("change", () => setFloor(floorInput.files[0] || null));
floorDropZone.addEventListener("dragover", (e) => { e.preventDefault(); floorDropZone.classList.add("dragover"); });
floorDropZone.addEventListener("dragleave", () => floorDropZone.classList.remove("dragover"));
floorDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  floorDropZone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) { floorInput.files = e.dataTransfer.files; setFloor(f); }
});

// --- Additional-PDFs drop zone (multi-file) ---
function setExtras(files) {
  selectedExtras = Array.isArray(files) ? files.filter((f) => f && /\.pdf$/i.test(f.name)) : [];
  if (selectedExtras.length > 0) {
    extrasDropText.removeAttribute("data-i18n");
    if (selectedExtras.length === 1) {
      const f = selectedExtras[0];
      extrasDropText.textContent = `${f.name} — ${(f.size / 1024).toFixed(1)} KB`;
    } else {
      const totalKb = selectedExtras.reduce((s, f) => s + f.size, 0) / 1024;
      extrasDropText.textContent = `${selectedExtras.length} PDFs — ${totalKb.toFixed(1)} KB total`;
    }
    extrasDropZone.classList.add("has-file");
  } else {
    setI18n(extrasDropText, "upload.extras.text");
    extrasDropZone.classList.remove("has-file");
  }
  updateAnalyzeBtn();
}
// The extras drop zone has been removed from the upload form; the
// listeners below are no-ops when the elements aren't in the DOM. Kept
// behind null-guards (rather than deleted outright) so the file-flow
// helpers (setExtras, the FormData append loop, etc.) don't need to
// branch on whether the feature is present.
if (extrasInput) {
  extrasInput.addEventListener("change", () => setExtras(Array.from(extrasInput.files || [])));
}
if (extrasDropZone) {
  extrasDropZone.addEventListener("dragover", (e) => { e.preventDefault(); extrasDropZone.classList.add("dragover"); });
  extrasDropZone.addEventListener("dragleave", () => extrasDropZone.classList.remove("dragover"));
  extrasDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  extrasDropZone.classList.remove("dragover");
  const files = Array.from(e.dataTransfer.files || []).filter((f) => /\.pdf$/i.test(f.name));
  if (files.length) {
    // Copy to the hidden input so submit picks them up when the user hasn't
    // also clicked to browse. A DataTransfer trick because FileList is
    // read-only.
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    extrasInput.files = dt.files;
    setExtras(files);
  }
  });
}

// --- Site-plan PDF (مخطط موقع تنظيمي) — single file, mirrors the deed flow.
function setSitePlan(file) {
  selectedSitePlan = file;
  if (file) {
    sitePlanDropText.removeAttribute("data-i18n");
    sitePlanDropText.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
    sitePlanDropZone.classList.add("has-file");
  } else {
    setI18n(sitePlanDropText, "upload.site_plan.text");
    sitePlanDropZone.classList.remove("has-file");
  }
  updateAnalyzeBtn();
}
sitePlanInput.addEventListener("change", () => setSitePlan(sitePlanInput.files[0] || null));
sitePlanDropZone.addEventListener("dragover", (e) => { e.preventDefault(); sitePlanDropZone.classList.add("dragover"); });
sitePlanDropZone.addEventListener("dragleave", () => sitePlanDropZone.classList.remove("dragover"));
sitePlanDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  sitePlanDropZone.classList.remove("dragover");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) { sitePlanInput.files = e.dataTransfer.files; setSitePlan(f); }
});

// --- Measurement PDF (optional, viewer-only) — accept ANY PDF; the file
// is never analyzed, only stored and rendered in the in-browser PDF.js
// viewer with calibration + click-to-measure. Does NOT contribute to the
// Analyze button's enable rule (only the 4 required docs do).
function setMeasurement(file) {
  selectedMeasurement = file;
  if (file) {
    measurementDropText.removeAttribute("data-i18n");
    measurementDropText.textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
    measurementDropZone.classList.add("has-file");
  } else {
    setI18n(measurementDropText, "upload.measurement.text");
    measurementDropZone.classList.remove("has-file");
  }
  // Note: NOT calling updateAnalyzeBtn() — measurement is optional and
  // mustn't gate the button, but a no-op call would also be safe.
}
if (measurementInput) {
  measurementInput.addEventListener("change", () => setMeasurement(measurementInput.files[0] || null));
}
if (measurementDropZone) {
  measurementDropZone.addEventListener("dragover", (e) => { e.preventDefault(); measurementDropZone.classList.add("dragover"); });
  measurementDropZone.addEventListener("dragleave", () => measurementDropZone.classList.remove("dragover"));
  measurementDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    measurementDropZone.classList.remove("dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.pdf$/i.test(f.name)) { measurementInput.files = e.dataTransfer.files; setMeasurement(f); }
  });
}

/* ============================================================
   Feed rendering
   ============================================================ */

function resetFeed() {
  feedEl.innerHTML = "";
  pendingToolCards.clear();
  currentReasoning = null;
  totalTokens = 0;
  stepCompleted = 0;
  stepCountEl.textContent = "0";
  tokenCountEl.textContent = "0";
  turnPill.hidden = true;
  turnCountEl.textContent = "1";
}

function closeReasoning() {
  if (currentReasoning) currentReasoning.classList.remove("streaming");
  currentReasoning = null;
}

// Archive-replay flag: when loadSavedAnalysis re-dispatches every stored
// event through EVENT_HANDLERS, we don't want to re-accumulate every
// "Uploading…" / "Connected" / "PDF started" system bubble — they were
// useful when live but just noise when reading back a finished job. The
// flag is flipped to true around the replayEvents() call.
let isReplayingArchive = false;

function appendSystemMsg(text) {
  if (isReplayingArchive) return;  // skip noise on archive replay
  closeReasoning();
  // System messages (upload / connect / PDF-floor lifecycle) render as a done
  // step card so the feed has a single visual vocabulary — green check, border,
  // title text — instead of dim dividers mixed with the AI tool cards.
  const div = document.createElement("div");
  div.className = "step done system-step";
  // Empty <span class="step-toggle"> reserves the 22px column-1 slot so the
  // icon/title/status line up with real step cards that DO have a toggle.
  div.innerHTML = `
    <div class="step-row">
      <span class="step-toggle" aria-hidden="true"></span>
      <div class="step-icon">
        <svg class="step-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 5"/></svg>
      </div>
      <div class="step-main">
        <span class="step-title"></span>
      </div>
      <div class="step-status">${t("step.status.done")}</div>
    </div>
  `;
  div.querySelector(".step-title").textContent = text;
  feedEl.appendChild(div);
  feedEl.scrollTop = feedEl.scrollHeight;
}

function appendStep(toolName, args, toolUseId) {
  closeReasoning();
  const info = TOOL_INFO[toolName];
  const number = info?.number ?? "•";
  const title = typeof info?.title === "function" ? info.title(args) : (info?.title || toolName);
  const sub = pickLabel(info, "running", args);

  const step = document.createElement("div");
  step.className = "step running";
  step.innerHTML = `
    <div class="step-row">
      <button class="step-toggle" aria-label="${t("ui.lang.toggle")}" hidden>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 3l3 3-3 3"/></svg>
      </button>
      <div class="step-icon">${number}</div>
      <div class="step-main">
        <span class="step-title"></span>
        <span class="step-detail"></span>
      </div>
      <div class="step-status" data-i18n="step.status.running">running</div>
    </div>
    <div class="step-details" hidden></div>
  `;
  // Re-translate the statically-inlined status text on the fresh element
  step.querySelector(".step-status").textContent = t("step.status.running");
  step.querySelector(".step-title").textContent = title;
  step.querySelector(".step-detail").textContent = sub;
  feedEl.appendChild(step);
  feedEl.scrollTop = feedEl.scrollHeight;
  // Use the tool_use_id when the backend supplies it; otherwise allocate a
  // synthetic key so the legacy single-slot semantics are preserved (oldest
  // matching toolName wins on tool_end).
  const key = toolUseId || `__legacy_${++_pendingFallbackKey}`;
  pendingToolCards.set(key, { el: step, toolName, args });
}

function completeStep(toolName, resultSummary, rawResult, details, toolUseId) {
  // Match priority:
  //   1. exact tool_use_id (always correct when both endpoints carry it)
  //   2. oldest pending entry with the same toolName (Map iteration is
  //      insertion-ordered, so this is FIFO — the right behavior for parallel
  //      tools of the same name when ids are missing on a replay)
  //   3. nothing — drop silently (stale event after a reset, etc.)
  let key = null;
  if (toolUseId && pendingToolCards.has(toolUseId)) {
    key = toolUseId;
  } else if (toolName) {
    for (const [k, v] of pendingToolCards) {
      if (v.toolName === toolName) { key = k; break; }
    }
  }
  if (key === null) return;
  const card = pendingToolCards.get(key);
  pendingToolCards.delete(key);
  const { el, args } = card;
  const info = TOOL_INFO[toolName];
  const isError = typeof resultSummary === "string" && resultSummary.startsWith("error:");

  el.classList.remove("running");
  el.classList.add(isError ? "error" : "done");

  const status = el.querySelector(".step-status");
  setI18n(status, isError ? "step.status.error" : "step.status.done");

  const iconEl = el.querySelector(".step-icon");
  iconEl.innerHTML = isError
    ? `<svg class="step-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`
    : `<svg class="step-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 5"/></svg>`;

  const detailTextEl = el.querySelector(".step-detail");
  let friendly = resultSummary;
  if (!isError && info && typeof info.done === "function" && rawResult) {
    try { friendly = info.done(rawResult); } catch { /* fall through */ }
  }
  detailTextEl.textContent = friendly || "";

  // Expandable details panel (populated only when backend sent a non-trivial details object)
  if (!isError && details) {
    const detailsHtml = renderToolDetails(toolName, details);
    if (detailsHtml) {
      const detailsEl = el.querySelector(".step-details");
      detailsEl.innerHTML = detailsHtml;
      const toggle = el.querySelector(".step-toggle");
      toggle.hidden = false;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowExpanded = !el.classList.contains("expanded");
        el.classList.toggle("expanded", nowExpanded);
        detailsEl.hidden = !nowExpanded;
      });
    }
  }

  // (card already removed from pendingToolCards above)
  if (!isError) {
    stepCompleted += 1;
    stepCountEl.textContent = String(stepCompleted);
  }
}

/* =================================================================
   Per-tool details renderer (called when user expands a completed step)
   ================================================================= */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function prettyNum(v) {
  if (typeof v !== "number") return String(v);
  if (!isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return v.toExponential(3);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(3);
}
function kvRow(key, val) {
  return `<div class="td-row"><span class="td-key">${escapeHtml(key)}</span><span class="td-val">${escapeHtml(val)}</span></div>`;
}

function renderToolDetails(toolName, details) {
  if (!details || typeof details !== "object") return "";

  if (toolName === "list_layers" && Array.isArray(details.layers)) {
    const count = details.count ?? details.layers.length;
    const items = details.layers
      .map((l) => `<li>${escapeHtml(l || "(unnamed)")}</li>`)
      .join("");
    return `
      <div class="td-heading">All ${count} layers in drawing</div>
      <ul class="td-layer-list">${items}</ul>
    `;
  }

  if (toolName === "extract_polylines") {
    const head = [
      kvRow("Layer", details.layer ?? "—"),
      kvRow("Role", details.role ?? "—"),
      kvRow("Entities", details.entity_count ?? 0),
    ].join("");
    let sample = "";
    if (Array.isArray(details.sample) && details.sample.length) {
      const items = details.sample
        .map((s, i) => {
          const bbox = Array.isArray(s.bbox)
            ? `bbox (${s.bbox.map((n) => prettyNum(n)).join(", ")})`
            : "";
          return `<li><span class="td-idx">#${i}</span> ${escapeHtml(s.type || "polyline")} · ${s.vertices} vertices · ${s.closed ? "closed" : "open"} ${bbox ? " · " + escapeHtml(bbox) : ""}</li>`;
        })
        .join("");
      sample = `<div class="td-heading">First ${details.sample.length} entities</div><ul class="td-sample-list">${items}</ul>`;
    }
    return head + sample;
  }

  if (toolName === "build_polygon_from_segments") {
    return [
      kvRow("Label", details.label ?? "—"),
      kvRow("Area", prettyNum(details.area)),
      kvRow("Perimeter", prettyNum(details.perimeter)),
      kvRow("Vertices", details.num_vertices ?? "—"),
      kvRow("Valid", details.is_valid ? "yes" : "no"),
    ].join("");
  }

  if (toolName === "compute_setbacks") {
    return [
      kvRow("Edges", details.edge_count ?? "—"),
      kvRow("Min overall", prettyNum(details.min_setback)),
      kvRow("Max overall", prettyNum(details.max_setback)),
    ].join("");
  }

  if (toolName === "convert_dwf_if_needed") {
    return [
      kvRow("Source format", details.source_format ?? "—"),
      kvRow("Converted", details.converted ? "yes" : "no"),
      kvRow("DWG path", details.dwg_path ?? "—"),
    ].join("");
  }

  if (toolName === "render_visualization") {
    return kvRow("PNG size", `${(details.bytes / 1024).toFixed(1)} KB`);
  }

  if (toolName === "open_drawing") {
    return kvRow("Opened", details.opened ?? "—");
  }

  if (toolName === "finalize") {
    return kvRow("Edges", details.edges ?? "—");
  }

  // Fallback: generic key/value rows
  const rows = Object.entries(details)
    .filter(([k]) => k !== "handle")
    .map(([k, v]) => kvRow(k, typeof v === "object" ? JSON.stringify(v) : String(v)));
  return rows.join("");
}

function appendReasoningDelta(delta) {
  if (!currentReasoning) {
    currentReasoning = document.createElement("div");
    currentReasoning.className = "reasoning streaming";
    feedEl.appendChild(currentReasoning);
  }
  currentReasoning.textContent = (currentReasoning.textContent || "") + delta;
  feedEl.scrollTop = feedEl.scrollHeight;
}

/* ============================================================
   Result rendering
   ============================================================ */

function parseTokenSummary(d) {
  const r = d.cache_read || 0;
  const w = d.cache_write || 0;
  const inp = d.input_tokens || 0;
  const out = d.output_tokens || 0;
  totalTokens += r + w + inp + out;
  tokenCountEl.textContent = totalTokens.toLocaleString();
}

function formatArea(a) {
  if (a == null || !isFinite(a)) return "—";
  if (a >= 1e6) return (a / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return Math.round(a).toLocaleString();
  if (a >= 100)  return a.toFixed(1);
  return a.toFixed(2);
}

/* ============================================================
   Result-pane wiring. The threshold-based "Setback fines" widget that
   used to live here was removed when the authoritative compliance flow
   (driven by the مخطط موقع تنظيمي PDF) took over. The fine + per-side
   breakdown now come from the Compliance section of the markdown report
   (#report-md) and from the rb-compliance-tile in the reviewer banner.
   ============================================================ */

/* ============================================================
   Interactive SVG renderer (Option C) — draws geometry_json
   straight to vanilla SVG with pan/zoom + hover tooltips. The
   PNG remains the fallback for archived analyses that predate
   geometry_json, and is also what the lightbox / report download
   uses.
   ============================================================ */

const _SVG_NS = "http://www.w3.org/2000/svg";
const _SIDE_COLORS = { front: "#e67e22", side: "#2980b9", rear: "#27ae60" };
const _SIDE_LABELS_AR = { front: "أمامي", side: "جانبي", rear: "خلفي" };
const _SIDE_LABELS_EN = { front: "front", side: "side", rear: "rear" };

// Pan/zoom state, stored on the SVG element so multiple instances
// (e.g. history replay loading a fresh analysis) don't bleed state.
function _svgState(svg) {
  if (!svg.__pz) svg.__pz = { vbX: 0, vbY: 0, vbW: 1, vbH: 1, baseVB: null };
  return svg.__pz;
}

function _svgEl(tag, attrs) {
  const el = document.createElementNS(_SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function _polyD(coords) {
  if (!coords || !coords.length) return "";
  return coords.map((c, i) => (i === 0 ? "M " : "L ") + c[0] + " " + c[1]).join(" ") + " Z";
}

function _lineD(coords) {
  if (!coords || !coords.length) return "";
  return coords.map((c, i) => (i === 0 ? "M " : "L ") + c[0] + " " + c[1]).join(" ");
}

function _applyViewBox(svg, vbX, vbY, vbW, vbH) {
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  const s = _svgState(svg);
  s.vbX = vbX; s.vbY = vbY; s.vbW = vbW; s.vbH = vbH;
}

// Render the geometry_json payload into an SVG element. Defaults to
// the inline #drawing-svg viewer; the measurement modal passes its own
// SVG so the same payload can be drawn into a second target. Returns
// true on success, false when the payload is missing/incomplete (caller
// should fall back to the PNG).
function renderGeometrySvg(geom, svgArg) {
  const svg = svgArg || document.getElementById("drawing-svg");
  if (!svg || !geom || !geom.lot || !geom.lot.coords) return false;

  // Clear previous render + reset transient state.
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // ── Compute the data extent. Includes lot, building, streets,
  // ── envelope outlines, edge endpoints — anything the user might
  // ── want visible at the default zoom. ──
  const allPts = [];
  const push = (cs) => { if (cs) for (const c of cs) allPts.push(c); };
  push(geom.lot.coords);
  push(geom.building && geom.building.coords);
  for (const s of geom.streets || []) {
    push(s.coords);
    push(s.band);   // include the offset-strip ring so it isn't clipped
  }
  for (const env of geom.envelope || []) push(env.exterior);
  for (const e of geom.edges || []) { allPts.push(e.start); allPts.push(e.end); }
  if (!allPts.length) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of allPts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const dx = Math.max(maxX - minX, 1e-6);
  const dy = Math.max(maxY - minY, 1e-6);
  const span = Math.max(dx, dy);
  const pad = span * 0.06;
  // Extra room on the LEFT (for Y-axis tick labels) and BOTTOM (for
  // X-axis tick labels) so the labels don't get clipped by the viewBox.
  const labelPad = span * 0.05;

  // SVG Y-axis grows downward; data Y grows upward. Apply a Y-flip on
  // the root group so we can use raw data coords for everything else.
  // The viewBox uses negated/flipped Y to match.
  const vbX = (minX - pad) - labelPad;
  const vbW = (dx + 2 * pad) + labelPad;
  const vbY = -(maxY + pad);
  const vbH = (dy + 2 * pad) + labelPad;
  _applyViewBox(svg, vbX, vbY, vbW, vbH);
  _svgState(svg).baseVB = { vbX, vbY, vbW, vbH };

  const root = _svgEl("g", { transform: "scale(1 -1)" });
  svg.appendChild(root);

  // Stroke widths scale with the data extent so lines stay readable
  // at any zoom level without manual tweaks.
  const strokeBase = span * 0.0035;

  // ── Lot fill (light grey background, always visible — not a
  // ── toggleable layer). Sits behind every other geometry layer. ──
  root.appendChild(_svgEl("path", {
    class: "svg-layer-lot-fill",
    d: _polyD(geom.lot.coords),
    fill: "#f4f4f4",
    stroke: "none",
  }));

  // ── Lot edges, color-coded by classification when compliance
  // ── data is available. Each edge is hover-aware (tooltip shows
  // ── side + required setback). ──
  if (geom.edges && geom.edges.length) {
    for (const e of geom.edges) {
      const seg = _svgEl("line", {
        class: "lot-edge svg-layer-edges",
        x1: e.start[0], y1: e.start[1],
        x2: e.end[0],   y2: e.end[1],
        stroke: _SIDE_COLORS[e.side] || "#222",
        "stroke-width": strokeBase * 1.3,
        "stroke-linecap": "round",
        "data-side": e.side,
        "data-required": e.required_m,
      });
      root.appendChild(seg);
    }
  } else {
    // No classified edges — draw a plain lot outline.
    root.appendChild(_svgEl("path", {
      class: "svg-layer-edges",
      d: _polyD(geom.lot.coords),
      fill: "none",
      stroke: "#222",
      "stroke-width": strokeBase * 1.0,
    }));
  }

  // ── Building (translucent fill + bold outline) ──
  if (geom.building && geom.building.coords) {
    root.appendChild(_svgEl("path", {
      class: "svg-layer-building",
      d: _polyD(geom.building.coords),
      fill: "#1f77b4",
      "fill-opacity": 0.16,
      stroke: "#1f77b4",
      "stroke-width": strokeBase * 1.2,
      "stroke-linejoin": "round",
    }));
  }

  // ── Street: solid black centerline. The DWG STREET layer is itself
  // ── just a centerline; we draw it plainly without trying to
  // ── synthesize a band/lane. (We previously rendered an offset strip
  // ── as a "fake road width" — removed at user request because it was
  // ── synthetic information dressed up as measurement.)
  for (const s of geom.streets || []) {
    if (!s.coords || s.coords.length < 2) continue;
    root.appendChild(_svgEl("path", {
      d: _lineD(s.coords),
      fill: "none",
      stroke: "#0f172a",
      "stroke-width": strokeBase * 1.1,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }));
  }

  // ── Required setback envelope: dashed outline. The buildable polygon
  // ── (lot inwardly offset by the required setbacks). Drawn black/
  // ── dashed normally; orange when the lot can't accommodate the
  // ── required setbacks at all (envelope_infeasible). Sits above the
  // ── lot fill but below the violations so the red regions still read
  // ── as "where the building broke through this dashed boundary."
  const envColor = (geom.summary && geom.summary.envelope_infeasible) ? "#ff8800" : "#0f172a";
  for (const env of geom.envelope || []) {
    if (!env.exterior) continue;
    root.appendChild(_svgEl("path", {
      d: _polyD(env.exterior),
      fill: "none",
      stroke: envColor,
      "stroke-width": strokeBase * 0.85,
      "stroke-dasharray": `${strokeBase * 3.2} ${strokeBase * 2.4}`,
      "stroke-linejoin": "round",
    }));
  }

  // ── Setback violations (red filled). One layer that combines normal
  // ── violations and "outside lot SERIOUS" regions; both render as red
  // ── shapes per the spec ("the red area of violations"). The
  // ── per-edge distance labels were dropped intentionally — the
  // ── violation polygon alone communicates "where the building
  // ── exceeds the buildable area"; the numbers live in the report.
  for (const v of geom.violations || []) {
    if (!v.exterior) continue;
    root.appendChild(_svgEl("path", {
      d: _polyD(v.exterior),
      fill: "#d62728",
      "fill-opacity": 0.42,
      stroke: "#7f0d0d",
      "stroke-width": strokeBase * 0.7,
    }));
  }
  for (const c of geom.lot_crossing || []) {
    if (!c.exterior) continue;
    root.appendChild(_svgEl("path", {
      d: _polyD(c.exterior),
      fill: "#7f0d0d",
      "fill-opacity": 0.55,
      stroke: "black",
      "stroke-width": strokeBase * 1.0,
    }));
  }

  // ── 5-metre coordinate grid + axis tick labels.
  // ── Mirrors the matplotlib PNG: gridlines snap to multiples of 5 m, and
  // ── tick labels are translated so the bottom-left corner reads "0" on
  // ── both axes — much friendlier than the raw AutoCAD coords (which can
  // ── be 4-digit numbers far from the origin).
  // ── Drawn UNDERNEATH the geometry by inserting a fresh <g> at the
  // ── beginning of the root element after layout (we use insertBefore
  // ── against root.firstChild). This keeps grid behind everything else.
  // ── The N arrow and scale bar were removed deliberately: orientation is
  // ── not always reliable from the CAD, and the gridded axes already
  // ── convey distance more directly than a bar.
  const GRID_STEP = 5.0;
  const xLow  = Math.floor(minX / GRID_STEP) * GRID_STEP;
  const xHigh = Math.ceil(maxX  / GRID_STEP) * GRID_STEP;
  const yLow  = Math.floor(minY / GRID_STEP) * GRID_STEP;
  const yHigh = Math.ceil(maxY  / GRID_STEP) * GRID_STEP;
  const gridGroup = _svgEl("g", { class: "svg-layer-grid" });
  const tickFontSize = span * 0.022;
  const tickColor = "#cbd5e1";
  const labelColor = "#475569";

  // Vertical grid lines + X-axis tick labels (along the bottom)
  for (let gx = xLow; gx <= xHigh + 1e-6; gx += GRID_STEP) {
    gridGroup.appendChild(_svgEl("line", {
      x1: gx, y1: yLow, x2: gx, y2: yHigh,
      stroke: tickColor, "stroke-width": strokeBase * 0.25,
    }));
    // Tick label below the bottom edge — counter-flipped so it reads upright.
    const tickGroup = _svgEl("g", {
      transform: `translate(${gx} ${yLow - span * 0.018}) scale(1 -1)`,
    });
    const txt = _svgEl("text", {
      x: 0, y: 0,
      "text-anchor": "middle",
      "font-size": tickFontSize,
      "font-family": "Inter, sans-serif",
      fill: labelColor,
    });
    txt.textContent = `${(gx - xLow).toFixed(0)}`;
    tickGroup.appendChild(txt);
    gridGroup.appendChild(tickGroup);
  }
  // Horizontal grid lines + Y-axis tick labels (along the left edge)
  for (let gy = yLow; gy <= yHigh + 1e-6; gy += GRID_STEP) {
    gridGroup.appendChild(_svgEl("line", {
      x1: xLow, y1: gy, x2: xHigh, y2: gy,
      stroke: tickColor, "stroke-width": strokeBase * 0.25,
    }));
    const tickGroup = _svgEl("g", {
      transform: `translate(${xLow - span * 0.012} ${gy}) scale(1 -1)`,
    });
    const txt = _svgEl("text", {
      x: 0, y: tickFontSize * 0.32,
      "text-anchor": "end",
      "font-size": tickFontSize,
      "font-family": "Inter, sans-serif",
      fill: labelColor,
    });
    txt.textContent = `${(gy - yLow).toFixed(0)}`;
    tickGroup.appendChild(txt);
    gridGroup.appendChild(tickGroup);
  }
  // Insert grid as the first child of root so it sits behind everything.
  root.insertBefore(gridGroup, root.firstChild);

  // ── Wire up pan / zoom handlers (idempotent — first call wins) ──
  _wireSvgInteractions(svg);
  return true;
}

// Pan/zoom + tooltip interactions. Bound once per SVG element via a
// guard flag; subsequent renderGeometrySvg calls reuse the existing
// listeners (they read viewBox state from the element directly).
/* ============================================================
   Measurement viewer (smv-*) — full-screen modal that re-renders
   the geometry payload into a large SVG and lets the reviewer
   place distance + area measurements directly on it.

   Coordinates are real-world metres (no calibration step), so the
   distance is just `Math.hypot(dx, dy)` and the area is the shoelace
   formula. Clicks snap to lot/building/edge/measurement vertices
   when within a small pixel radius for precise placement.
   ============================================================ */
(function () {
  const SNAP_PIXEL_RADIUS = 12;     // hit-test radius for snap candidates
  const HINT_DEFAULT_DISTANCE = "انقر على نقطتين لقياس المسافة";
  const HINT_DEFAULT_AREA     = "انقر على رؤوس متعددة، ثم انقر مزدوجًا للإغلاق";

  // DOM refs — captured lazily because index.html may not be on the
  // page (login screen, dashboard) when app.js first loads.
  let svg, wrap, toolbar, hintEl, listEl,
      distanceBtn, areaBtn, undoBtn, clearBtn, exitBtn, launcherBtn;

  // Per-session state. measurements + tool selection persist across
  // enter/exit cycles so the user doesn't lose work when toggling the
  // ruler off and back on; only `clear` blows them away.
  const state = {
    modeOn: false,                  // measure-mode active?
    tool: "distance",               // "distance" | "area"
    measurements: [],               // [{type, points, lengthM?, areaM2?}]
    pending: null,                  // in-flight measurement (1st point, polygon-in-progress)
    snap: null,                     // {x, y} when cursor is near a snap target; null otherwise
    cursorData: null,               // last cursor position (viewBox-y coords) for rubber-band
    shiftHeld: false,
    snapCandidates: [],             // pre-flattened snap targets (lot, building, edges)
    hoveredListIdx: -1,             // measurement-list row under cursor; -1 = none
  };

  // rAF-throttled redraw — pointermove can fire faster than the screen
  // refresh rate, especially during a long rubber-band drag, and each
  // call to _redrawOverlay rebuilds the overlay <g>. Coalescing into a
  // single redraw per frame keeps the rubber-band silky on big lots.
  let _redrawScheduled = false;
  function _scheduleRedraw() {
    if (_redrawScheduled) return;
    _redrawScheduled = true;
    requestAnimationFrame(() => {
      _redrawScheduled = false;
      _redrawOverlay();
    });
  }

  // ── DOM lookups (lazy) ────────────────────────────────────────
  function _ensureRefs() {
    if (svg) return svg;
    svg         = document.getElementById("drawing-svg");
    wrap        = document.getElementById("drawing-svg-wrap");
    toolbar     = document.getElementById("smv-bar");
    hintEl      = document.getElementById("smv-bar-hint");
    listEl      = document.getElementById("smv-list");
    distanceBtn = document.getElementById("smv-tool-distance");
    areaBtn     = document.getElementById("smv-tool-area");
    undoBtn     = document.getElementById("smv-undo");
    clearBtn    = document.getElementById("smv-clear");
    exitBtn     = document.getElementById("smv-exit");
    launcherBtn = document.getElementById("smv-launcher");
    return svg;
  }

  // ── Enter / exit / toggle ─────────────────────────────────────
  // Inline mode: no modal. The user clicks the ruler launcher on the
  // small SVG; `enter()` arms the measurement handlers and reveals the
  // floating toolbar without re-rendering anything. `exit()` hides the
  // toolbar, clears in-flight pending state, and erases drawn marks.
  function enter() {
    if (!_ensureRefs()) return;
    const geom = window.__latestGeometryJson;
    if (!geom) return;             // nothing to measure on
    state.modeOn = true;
    state.snapCandidates = _collectSnapCandidates(geom);
    state.pending = null;
    state.snap = null;
    state.cursorData = null;
    state.shiftHeld = false;
    state.hoveredListIdx = -1;
    setTool(state.tool || "distance");
    if (toolbar) toolbar.hidden = false;
    if (wrap) wrap.classList.add("smv-measuring");
    if (launcherBtn) launcherBtn.setAttribute("aria-pressed", "true");
    _wireMeasurementHandlers();
    _wireListHandlers();
    _renderMeasurementList();
    _redrawOverlay();
  }

  function exit() {
    if (!_ensureRefs()) return;
    state.modeOn = false;
    state.pending = null;
    state.snap = null;
    state.cursorData = null;
    state.measurements = [];        // exiting wipes marks; re-enter starts fresh
    state.hoveredListIdx = -1;
    if (toolbar) toolbar.hidden = true;
    if (wrap) wrap.classList.remove("smv-measuring");
    if (launcherBtn) launcherBtn.setAttribute("aria-pressed", "false");
    _renderMeasurementList();
    _redrawOverlay();
  }

  function toggle() { if (state.modeOn) exit(); else enter(); }

  // ── Tool selection (distance vs area) ─────────────────────────
  function setTool(next) {
    state.tool = next;
    state.pending = null;
    if (distanceBtn) {
      distanceBtn.classList.toggle("is-active", next === "distance");
      distanceBtn.setAttribute("aria-selected", String(next === "distance"));
    }
    if (areaBtn) {
      areaBtn.classList.toggle("is-active", next === "area");
      areaBtn.setAttribute("aria-selected", String(next === "area"));
    }
    _setHint(next === "distance" ? HINT_DEFAULT_DISTANCE : HINT_DEFAULT_AREA);
    _redrawOverlay();
  }

  function _setHint(text) {
    if (hintEl) hintEl.innerHTML = text;
  }

  // ── Snap candidates ───────────────────────────────────────────
  function _collectSnapCandidates(geom) {
    const out = [];
    const push = (coords) => { if (coords) for (const c of coords) out.push([c[0], c[1]]); };
    push(geom.lot && geom.lot.coords);
    push(geom.building && geom.building.coords);
    for (const e of geom.edges || []) { out.push([e.start[0], e.start[1]]); out.push([e.end[0], e.end[1]]); }
    for (const env of geom.envelope || []) push(env.exterior);
    return out;
  }

  // Find the nearest snap target to cursor (in data coords). Returns
  // null when no candidate is within the screen-pixel snap radius.
  function _findSnap(cursorData) {
    if (!svg || !cursorData) return null;
    const s = _svgState(svg);
    const rect = svg.getBoundingClientRect();
    // Convert pixel snap radius into data units using current zoom.
    const dataPerPx = s.vbW / Math.max(rect.width, 1);
    const radius = SNAP_PIXEL_RADIUS * dataPerPx;
    let best = null;
    let bestDist = radius;
    // Real data Y = -screen-Y because of the root group's scale(1, -1).
    const realCx = cursorData.x;
    const realCy = -cursorData.y;
    // Snap to geometry vertices first.
    for (const c of state.snapCandidates) {
      const d = Math.hypot(c[0] - realCx, c[1] - realCy);
      if (d < bestDist) { bestDist = d; best = { x: c[0], y: c[1] }; }
    }
    // Also snap to existing measurement endpoints.
    for (const m of state.measurements) {
      for (const p of m.points) {
        const d = Math.hypot(p[0] - realCx, p[1] - realCy);
        if (d < bestDist) { bestDist = d; best = { x: p[0], y: p[1] }; }
      }
    }
    if (state.pending && state.pending.points) {
      for (const p of state.pending.points) {
        const d = Math.hypot(p[0] - realCx, p[1] - realCy);
        if (d < bestDist) { bestDist = d; best = { x: p[0], y: p[1] }; }
      }
    }
    return best;
  }

  // Apply Shift = orthogonal lock (snap to 0/45/90 from anchor).
  function _orthogonalLock(anchor, target) {
    const dx = target.x - anchor[0];
    const dy = target.y - anchor[1];
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    // Three locks: horizontal, vertical, 45°
    if (adx > ady * 2.4)        return { x: anchor[0] + dx, y: anchor[1] };
    if (ady > adx * 2.4)        return { x: anchor[0],     y: anchor[1] + dy };
    const sgnX = dx >= 0 ? 1 : -1, sgnY = dy >= 0 ? 1 : -1;
    const len = Math.min(adx, ady);
    return { x: anchor[0] + sgnX * len, y: anchor[1] + sgnY * len };
  }

  // ── Geometry helpers ──────────────────────────────────────────
  function _distance(p1, p2) { return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); }
  function _polygonArea(points) {
    // Shoelace.  Returns the absolute area in m².
    let s = 0;
    for (let i = 0, n = points.length; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  }
  function _polygonCentroid(points) {
    let cx = 0, cy = 0, A = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      const cross = x1 * y2 - x2 * y1;
      A += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    A *= 0.5;
    if (Math.abs(A) < 1e-9) return [points[0][0], points[0][1]];
    return [cx / (6 * A), cy / (6 * A)];
  }

  // ── Pointer → data conversion ────────────────────────────────
  // Map the cursor from screen pixels to the SVG's userspace coords.
  // `getScreenCTM().inverse()` is the only formula that's correct under
  // preserveAspectRatio="xMidYMid meet" — the viewBox is letterboxed
  // inside a square wrapper (#drawing-svg-wrap is aspect-ratio:1/1),
  // and any naive (clientX-rect.left)/rect.width × vbW math drifts by
  // the letterbox padding. CTM-based mapping also picks up wheel zoom
  // and any CSS transforms for free.
  function _pointerToData(clientX, clientY) {
    const ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (ctm) {
      const inv = ctm.inverse();
      const p = (typeof DOMPoint !== "undefined")
        ? new DOMPoint(clientX, clientY).matrixTransform(inv)
        : svg.createSVGPoint && (() => {
            const sp = svg.createSVGPoint(); sp.x = clientX; sp.y = clientY;
            return sp.matrixTransform(inv);
          })();
      if (p) return { x: p.x, y: p.y };
    }
    // Fallback — only correct when there's no letterboxing.
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const s = _svgState(svg);
    return { x: s.vbX + fx * s.vbW, y: s.vbY + fy * s.vbH };
  }

  // ── Measurement event handlers ────────────────────────────────
  // Wired once per page load (all listeners gate on state.modeOn so
  // they're inert when measure mode is off — wheel/drag pan keep
  // working for the normal viewer the rest of the time).
  let _measWired = false;
  function _wireMeasurementHandlers() {
    if (_measWired) return;
    _measWired = true;

    // Click-vs-drag detection: track the pixel distance the pointer
    // moved between down and up. Anything beyond the threshold is a
    // pan, suppressing the click; anything within is a genuine click
    // that we use for measurement placement.
    const CLICK_DRAG_PX = 5;
    let downX = 0, downY = 0, downPanned = false;
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      downX = ev.clientX;
      downY = ev.clientY;
      downPanned = false;
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!svg.classList.contains("dragging")) return;
      const dx = ev.clientX - downX, dy = ev.clientY - downY;
      if (Math.hypot(dx, dy) > CLICK_DRAG_PX) downPanned = true;
    });

    // Click handler. Deletion now lives in the side-panel list, so the
    // SVG click is purely "place the next measurement point."
    svg.addEventListener("click", (ev) => {
      if (!state.modeOn) return;
      if (downPanned) { downPanned = false; return; }
      const data = _pointerToData(ev.clientX, ev.clientY);
      const point = _resolveCursor(data);   // applies snap + orthogonal lock
      if (!point) return;
      if (state.tool === "distance") _onDistanceClick(point);
      else if (state.tool === "area") _onAreaClick(point);
    });

    svg.addEventListener("dblclick", (ev) => {
      if (!state.modeOn || state.tool !== "area" || !state.pending) return;
      ev.preventDefault();
      _closeAreaPolygon();
    });

    // Pointer-move drives the rubber-band line + snap detection. Inert
    // when measure mode is off so the chart isn't redrawn on every
    // mouse move during a normal panning session. Redraw is coalesced
    // into one per animation frame for smooth tracking under fast
    // mouse movement.
    svg.addEventListener("pointermove", (ev) => {
      if (!state.modeOn) return;
      state.cursorData = _pointerToData(ev.clientX, ev.clientY);
      state.snap = _findSnap(state.cursorData);
      _scheduleRedraw();
    });

    svg.addEventListener("pointerleave", () => {
      if (!state.modeOn) return;
      state.cursorData = null;
      state.snap = null;
      _scheduleRedraw();
    });

    // Inline toolbar buttons.
    distanceBtn?.addEventListener("click", () => setTool("distance"));
    areaBtn    ?.addEventListener("click", () => setTool("area"));
    undoBtn    ?.addEventListener("click", _undo);
    clearBtn   ?.addEventListener("click", _clear);
    exitBtn    ?.addEventListener("click", exit);

    // Keyboard shortcuts — only fire while measure mode is active so
    // they don't interfere with the rest of the page (typing in
    // reviewer notes, scrolling the report, etc.).
    document.addEventListener("keydown", (ev) => {
      if (!state.modeOn) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key;
      let handled = true;
      switch (k) {
        case "m": case "M": setTool("distance"); break;
        case "a": case "A": setTool("area"); break;
        case "z": case "Z": _undo(); break;
        case "Enter":
          if (state.tool === "area" && state.pending) _closeAreaPolygon();
          else handled = false;
          break;
        case "Escape":
          // First Escape cancels an in-flight measurement; second exits.
          if (state.pending) { state.pending = null; _redrawOverlay(); }
          else exit();
          break;
        case "Shift":
          state.shiftHeld = true;
          handled = false;
          _redrawOverlay();
          break;
        default: handled = false;
      }
      if (handled) ev.preventDefault();
    });
    document.addEventListener("keyup", (ev) => {
      if (ev.key === "Shift") {
        state.shiftHeld = false;
        if (state.modeOn) _redrawOverlay();
      }
    });
  }

  // Resolve a raw cursor to its final placement point: snap target wins,
  // else orthogonal-lock against the previous point when Shift is held,
  // else the raw cursor in real-data coords.
  function _resolveCursor(cursorData) {
    if (!cursorData) return null;
    if (state.snap) return [state.snap.x, state.snap.y];
    const realX = cursorData.x;
    const realY = -cursorData.y;
    if (state.shiftHeld) {
      const anchor = _activeAnchor();
      if (anchor) {
        const o = _orthogonalLock(anchor, { x: realX, y: realY });
        return [o.x, o.y];
      }
    }
    return [realX, realY];
  }

  // Active anchor for orthogonal-lock = the previous click's point.
  function _activeAnchor() {
    if (state.tool === "distance" && state.pending && state.pending.points.length === 1)
      return state.pending.points[0];
    if (state.tool === "area" && state.pending && state.pending.points.length >= 1)
      return state.pending.points[state.pending.points.length - 1];
    return null;
  }

  // ── Tool actions ──────────────────────────────────────────────
  function _onDistanceClick(p) {
    if (!state.pending) {
      state.pending = { type: "distance", points: [p] };
      _setHint("النقطة الأولى مثبَّتة — انقر النقطة الثانية");
    } else {
      const p1 = state.pending.points[0];
      const len = _distance(p1, p);
      state.measurements.push({ type: "distance", points: [p1, p], lengthM: len });
      state.pending = null;
      _setHint(`آخر مسافة: <b>${len.toFixed(2)} م</b> · انقر لقياس آخر`);
      _renderMeasurementList();
    }
    _redrawOverlay();
  }

  function _onAreaClick(p) {
    if (!state.pending) {
      state.pending = { type: "area", points: [p] };
      _setHint("أضف رؤوسًا، ثم انقر مزدوجًا أو على الرأس الأول للإغلاق");
    } else {
      const pts = state.pending.points;
      const first = pts[0];
      if (pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 0.01) {
        _closeAreaPolygon();
        return;
      }
      pts.push(p);
      _setHint(`الرؤوس: <b>${pts.length}</b> · انقر مزدوجًا للإغلاق`);
    }
    _redrawOverlay();
  }

  function _closeAreaPolygon() {
    if (!state.pending || state.pending.points.length < 3) return;
    const pts = state.pending.points.slice();
    const area = _polygonArea(pts);
    state.measurements.push({ type: "area", points: pts, areaM2: area });
    state.pending = null;
    _setHint(`آخر مساحة: <b>${area.toFixed(2)} م²</b> · انقر لقياس أخرى`);
    _renderMeasurementList();
    _redrawOverlay();
  }

  function _undo() {
    if (state.pending) {
      if (state.pending.type === "area" && state.pending.points.length > 1) {
        state.pending.points.pop();
      } else {
        state.pending = null;
      }
    } else if (state.measurements.length) {
      state.measurements.pop();
      _renderMeasurementList();
    }
    _redrawOverlay();
    // Reset the hint after undo.
    _setHint(state.tool === "distance" ? HINT_DEFAULT_DISTANCE : HINT_DEFAULT_AREA);
  }

  function _clear() {
    state.pending = null;
    state.measurements = [];
    _setHint(state.tool === "distance" ? HINT_DEFAULT_DISTANCE : HINT_DEFAULT_AREA);
    _renderMeasurementList();
    _redrawOverlay();
  }

  // ── Measurement list (the panel under the tool buttons) ──────
  const _LIST_ICON_DEL =
    '<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M5 5l10 10M15 5L5 15"/></svg>';

  // Rebuild the measurement-list panel from state.measurements. Hidden
  // when measure mode is off OR when there are no measurements yet, so
  // the panel doesn't appear empty before the user has placed anything.
  // Uses event delegation in _wireListHandlers — no per-row listeners
  // to clean up, so calling this on every measurement change is cheap.
  function _renderMeasurementList() {
    if (!listEl) return;
    if (!state.modeOn || state.measurements.length === 0) {
      listEl.hidden = true;
      listEl.innerHTML = "";
      return;
    }
    listEl.hidden = false;
    const parts = [];
    for (let i = 0; i < state.measurements.length; i++) {
      const m = state.measurements[i];
      const value = (m.type === "distance")
        ? `${m.lengthM.toFixed(2)} م`
        : `${m.areaM2.toFixed(2)} م²`;
      const highlight = (i === state.hoveredListIdx) ? " is-highlight" : "";
      parts.push(
        `<div class="smv-list-row${highlight}" data-idx="${i}" role="listitem">` +
          `<span class="smv-list-value">${value}</span>` +
          `<button type="button" class="smv-list-del" data-idx="${i}" ` +
            `title="حذف" aria-label="حذف القياس">${_LIST_ICON_DEL}</button>` +
        `</div>`
      );
    }
    listEl.innerHTML = parts.join("");
  }

  // Event delegation on the list panel — wired ONCE, not per-row, so
  // _renderMeasurementList can innerHTML-rebuild freely without leaks.
  let _listWired = false;
  function _wireListHandlers() {
    if (_listWired || !listEl) return;
    _listWired = true;
    listEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest && ev.target.closest(".smv-list-del");
      if (!btn) return;
      ev.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-idx") || "-1", 10);
      if (idx < 0 || idx >= state.measurements.length) return;
      state.measurements.splice(idx, 1);
      if (state.hoveredListIdx === idx) state.hoveredListIdx = -1;
      else if (state.hoveredListIdx > idx) state.hoveredListIdx -= 1;
      _renderMeasurementList();
      _redrawOverlay();
    });
    // Hover a row → highlight the matching mark on the chart. The row
    // itself takes its own :hover styling via CSS; this just drives the
    // SVG redraw so the corresponding measurement gets the highlight
    // stroke.
    listEl.addEventListener("mouseover", (ev) => {
      const row = ev.target.closest && ev.target.closest(".smv-list-row");
      if (!row) return;
      const idx = parseInt(row.getAttribute("data-idx") || "-1", 10);
      if (idx === state.hoveredListIdx) return;
      state.hoveredListIdx = idx;
      _redrawOverlay();
    });
    listEl.addEventListener("mouseleave", () => {
      if (state.hoveredListIdx === -1) return;
      state.hoveredListIdx = -1;
      _redrawOverlay();
    });
  }

  // ── Overlay redraw (measurements, rubber-band, snap ring) ─────
  // ── COORDINATE-SYSTEM RULE: all stored points are in REAL-DATA
  // ── coordinates (positive Y points up, matching the geometry
  // ── payload). The renderer's root <g> has transform="scale(1,-1)",
  // ── which flips them to screen-Y-down at draw time. That means
  // ── measurement render code must NOT negate Y itself — passing raw
  // ── real-data Y is correct and matches how the lot/building/edges
  // ── are drawn. (Earlier versions of this file double-flipped and
  // ── all measurements landed off-screen.)
  function _redrawOverlay() {
    if (!svg) return;
    // Find or create the overlay group on the root <g>.
    const root = svg.querySelector("g");
    if (!root) return;
    let overlay = svg.querySelector("#smv-overlay-g");
    if (!overlay) {
      overlay = _svgEl("g", { id: "smv-overlay-g" });
      root.appendChild(overlay);
    }
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    const s = _svgState(svg);
    const rect = svg.getBoundingClientRect();
    // Convert pixels to data units at the current zoom for sizing.
    const dataPerPx = s.vbW / Math.max(rect.width, 1);
    const labelFontPx = 12, labelFontData = labelFontPx * dataPerPx;
    const dotR = 3 * dataPerPx;
    const strokeData = 1.6 * dataPerPx;

    // ── Existing measurements ──
    for (let i = 0; i < state.measurements.length; i++) {
      const m = state.measurements[i];
      if (m.type === "distance") {
        _drawDistance(overlay, m, i, dataPerPx);
      } else if (m.type === "area") {
        _drawArea(overlay, m, i, dataPerPx);
      }
    }

    // ── Resolve the live cursor point in real-data coords. The cursor
    // ── itself comes from _pointerToData (screen-Y space), so we flip
    // ── once to get real-data Y. After that, stored real-data points
    // ── and the cursor share the same coordinate system. ──
    const cursorRD = state.cursorData ? { x: state.cursorData.x, y: -state.cursorData.y } : null;
    let cursorPt = null;
    if (cursorRD) {
      if (state.snap) {
        cursorPt = [state.snap.x, state.snap.y];
      } else if (state.shiftHeld && _activeAnchor()) {
        const o = _orthogonalLock(_activeAnchor(), cursorRD);
        cursorPt = [o.x, o.y];
      } else {
        cursorPt = [cursorRD.x, cursorRD.y];
      }
    }

    // ── In-flight rubber-band ──
    if (state.pending && cursorPt) {
      if (state.pending.type === "distance") {
        const p1 = state.pending.points[0];
        // Anchor dot — first click sticks visibly.
        overlay.appendChild(_svgEl("circle", {
          class: "smv-meas-endpoint",
          cx: p1[0], cy: p1[1], r: dotR, "stroke-width": strokeData * 0.7,
        }));
        overlay.appendChild(_svgEl("line", {
          class: "smv-rubber-line",
          x1: p1[0], y1: p1[1], x2: cursorPt[0], y2: cursorPt[1],
          "stroke-width": strokeData,
        }));
        // Live distance pill at midpoint.
        const mx = (p1[0] + cursorPt[0]) / 2;
        const my = (p1[1] + cursorPt[1]) / 2;
        const live = Math.hypot(cursorPt[0] - p1[0], cursorPt[1] - p1[1]);
        _drawPill(overlay, mx, my, `${live.toFixed(2)} م`, labelFontData, "#1d4ed8");
      } else if (state.pending.type === "area") {
        const pts = state.pending.points;
        const closing = [...pts, cursorPt, pts[0]];
        overlay.appendChild(_svgEl("path", {
          class: "smv-rubber-poly",
          d: _lineD(closing),    // raw real-data Y; root flips
          "stroke-width": strokeData,
        }));
        // Already-placed vertices.
        for (const p of pts) {
          overlay.appendChild(_svgEl("circle", {
            class: "smv-meas-endpoint",
            cx: p[0], cy: p[1], r: dotR, "stroke-width": strokeData * 0.7,
          }));
        }
        if (pts.length >= 2) {
          const live = [...pts, cursorPt];
          const liveArea = _polygonArea(live);
          const cent = _polygonCentroid(live);
          _drawPill(overlay, cent[0], cent[1], `${liveArea.toFixed(2)} م²`, labelFontData, "#1d4ed8");
        }
      }
    }

    // ── Snap target ring (when cursor is near a vertex) ──
    if (state.snap) {
      overlay.appendChild(_svgEl("circle", {
        class: "smv-snap-ring",
        cx: state.snap.x, cy: state.snap.y,
        r: 7 * dataPerPx,
        "stroke-width": strokeData,
      }));
    } else if (cursorPt && (state.tool === "distance" || state.tool === "area")) {
      // Faint ghost dot at cursor when not snapping — gives the user
      // confidence about where the next click will land.
      overlay.appendChild(_svgEl("circle", {
        class: "smv-cursor-ghost",
        cx: cursorPt[0], cy: cursorPt[1],
        r: 3 * dataPerPx,
      }));
    }
    // Always send the overlay to the front (above all geometry layers).
    root.appendChild(overlay);
  }

  function _drawDistance(parent, m, idx, dpx) {
    const [p1, p2] = m.points;
    const baseStroke = 1.6 * dpx;
    const isHighlight = (idx === state.hoveredListIdx);
    const stroke = isHighlight ? baseStroke * 1.6 : baseStroke;
    // Group all parts so the corresponding side-panel row can drive
    // an .is-highlight class via state.hoveredListIdx — hovering a
    // row in the list lights up the matching line on the chart.
    // No on-chart label pill: the side panel is the single source of
    // truth for the value, so the chart stays uncluttered.
    const grp = _svgEl("g", {
      class: "smv-meas-group" + (isHighlight ? " is-highlight" : ""),
      "data-meas-idx": String(idx),
    });
    grp.appendChild(_svgEl("line", {
      class: "smv-meas-line",
      x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
      "stroke-width": stroke,
    }));
    for (const p of [p1, p2]) {
      grp.appendChild(_svgEl("circle", {
        class: "smv-meas-endpoint",
        cx: p[0], cy: p[1], r: (isHighlight ? 4.2 : 3) * dpx, "stroke-width": baseStroke * 0.7,
      }));
    }
    parent.appendChild(grp);
  }

  function _drawArea(parent, m, idx, dpx) {
    const baseStroke = 1.6 * dpx;
    const isHighlight = (idx === state.hoveredListIdx);
    const stroke = isHighlight ? baseStroke * 1.6 : baseStroke;
    const grp = _svgEl("g", {
      class: "smv-meas-group" + (isHighlight ? " is-highlight" : ""),
      "data-meas-idx": String(idx),
    });
    grp.appendChild(_svgEl("path", {
      class: "smv-meas-poly",
      d: _polyD(m.points),     // raw real-data Y; root flips
      "stroke-width": stroke,
    }));
    for (const p of m.points) {
      grp.appendChild(_svgEl("circle", {
        class: "smv-meas-endpoint",
        cx: p[0], cy: p[1], r: (isHighlight ? 4.2 : 3) * dpx, "stroke-width": baseStroke * 0.7,
      }));
    }
    parent.appendChild(grp);
  }

  function _drawPill(parent, dataX, dataY, text, fontSize, fillBg) {
    // The label group sits inside root (which has scale(1,-1)). To place
    // the group at real-data (dataX, dataY) AND have the text read
    // upright we use translate(rx, ry) followed by a counter-flip.
    // Conceptually: the inner scale(1,-1) cancels root's scale(1,-1)
    // for the children, then translate moves to (rx, ry) in root's
    // local space; root's flip then carries the whole group to viewBox
    // (rx, -ry), which is the screen position for real-data (rx, ry).
    const grp = _svgEl("g", {
      class: "smv-meas-pill-group",
      transform: `translate(${dataX} ${dataY}) scale(1 -1)`,
    });
    const w = fontSize * (text.length * 0.55 + 1.0);
    const h = fontSize * 1.5;
    grp.appendChild(_svgEl("rect", {
      class: "smv-meas-pill",
      x: -w / 2, y: -h / 2, width: w, height: h,
      rx: h * 0.28,
      fill: fillBg,
    }));
    const t = _svgEl("text", {
      class: "smv-meas-pill-text",
      x: 0, y: fontSize * 0.34,
      "text-anchor": "middle",
      "font-size": fontSize,
    });
    t.textContent = text;
    grp.appendChild(t);
    parent.appendChild(grp);
  }

  // ── Public hooks ──────────────────────────────────────────────
  // The ruler launcher is a toggle: click once to enter measure mode,
  // click again (or hit Esc) to exit.
  function _wireLauncher() {
    const launcher = document.getElementById("smv-launcher");
    if (!launcher || launcher.__wired) return;
    launcher.__wired = true;
    launcher.addEventListener("click", toggle);
  }
  document.addEventListener("DOMContentLoaded", _wireLauncher);
  if (document.readyState !== "loading") _wireLauncher();

  window.__smvToggle = toggle;
  window.__smvExit   = exit;
})();

// =================================================================
// Chart expand toggle. The pill handle on the chart's panel-facing
// edge flips .rb-main-analysis between two layouts:
//   • normal      → 2-column grid (chart + KPIs/setbacks panel)
//   • expanded    → 1-column, chart fills the section width, KPIs hidden
// State is ephemeral (resets on page reload) — no persistence needed.
// The SVG re-fits automatically because #drawing-svg is width:100%.
// =================================================================
(function () {
  function _wireChartExpandToggle() {
    const btn = document.getElementById("rb-chart-expand-toggle");
    if (!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", () => {
      const root = document.querySelector(".rb-main-analysis");
      if (!root) return;
      const expanded = root.classList.toggle("is-chart-expanded");
      btn.setAttribute("aria-pressed", expanded ? "true" : "false");
      btn.setAttribute(
        "title",
        expanded ? "طيّ المخطط" : "توسيع المخطط ليأخذ كامل العرض"
      );
    });
  }
  document.addEventListener("DOMContentLoaded", _wireChartExpandToggle);
  if (document.readyState !== "loading") _wireChartExpandToggle();
})();

// Mouse-only viewer interactions: wheel = cursor-anchored zoom (instant,
// matches scroll feel), drag = pan. By design there is no toolbar,
// keyboard shortcut suite, click-to-focus, tooltip, help overlay, or
// coordinate readout — the viewer is a clean window onto the geometry
// and nothing else.
function _wireSvgInteractions(svg) {
  if (svg.__pzWired) return;
  svg.__pzWired = true;

  // Convert a screen-pixel point to data coords (post Y-flip of the
  // root group). Used to keep the cursor anchor stable during zoom and
  // to compute pan deltas. Uses getScreenCTM().inverse() so the cursor
  // anchor is exact under preserveAspectRatio letterboxing — naive
  // proportional mapping drifts by the letterbox padding.
  function _screenToData(clientX, clientY) {
    const ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (ctm) {
      const inv = ctm.inverse();
      const p = (typeof DOMPoint !== "undefined")
        ? new DOMPoint(clientX, clientY).matrixTransform(inv)
        : svg.createSVGPoint && (() => {
            const sp = svg.createSVGPoint(); sp.x = clientX; sp.y = clientY;
            return sp.matrixTransform(inv);
          })();
      if (p) return { x: p.x, y: p.y };
    }
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const s = _svgState(svg);
    return {
      x: s.vbX + fx * s.vbW,
      y: s.vbY + fy * s.vbH,
    };
  }

  // ── Wheel = cursor-anchored zoom (clamped to a sensible range) ──
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const s = _svgState(svg);
    const base = s.baseVB; if (!base) return;
    const factor = ev.deltaY < 0 ? 0.85 : 1.18;
    const nextW = s.vbW * factor;
    const nextH = s.vbH * factor;
    const minW = base.vbW / 80, maxW = base.vbW * 8;
    if (nextW < minW || nextW > maxW) return;
    const cursor = _screenToData(ev.clientX, ev.clientY);
    // Keep cursor stationary in data coords across the zoom.
    const cx = (cursor.x - s.vbX) / s.vbW;
    const cy = (cursor.y - s.vbY) / s.vbH;
    _applyViewBox(svg,
      cursor.x - cx * nextW,
      cursor.y - cy * nextH,
      nextW, nextH,
    );
  }, { passive: false });

  // ── Drag = pan (1:1 in data coords, so panning stays consistent at
  // ── any zoom level). ──
  let dragging = false;
  let lastData = null;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    lastData = _screenToData(ev.clientX, ev.clientY);
    svg.classList.add("dragging");
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const now = _screenToData(ev.clientX, ev.clientY);
    const s = _svgState(svg);
    _applyViewBox(svg,
      s.vbX - (now.x - lastData.x),
      s.vbY - (now.y - lastData.y),
      s.vbW, s.vbH,
    );
    lastData = _screenToData(ev.clientX, ev.clientY);
  });
  const stopDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove("dragging");
    try { svg.releasePointerCapture(ev.pointerId); } catch {}
  };
  svg.addEventListener("pointerup", stopDrag);
  svg.addEventListener("pointercancel", stopDrag);
}

function showResultPane(d) {
  if (resultPlaceholder) resultPlaceholder.hidden = true;
  if (resultContent) resultContent.hidden = false;
  if (resultSub) setI18n(resultSub, "result.just_now");

  if (summaryBox) summaryBox.textContent = d.summary || "";
  if (reportMdEl) reportMdEl.textContent = d.markdown || "";
  if (reportJsonEl) reportJsonEl.textContent = d.json || "";

  // Hide the chart spinner once any visualization is ready.
  const drawingLoading = document.getElementById("drawing-loading");
  if (drawingLoading) drawingLoading.hidden = true;

  // Visualization priority:
  //   1. Live runs ship `geometry_json` → render the interactive SVG.
  //   2. Archived runs from before the SVG migration only have
  //      `png_base64` → fall back to the static <img>. The PNG is no
  //      longer generated for new analyses; this branch is a
  //      backward-compat path for already-saved JSON files.
  //   3. Neither → both stay hidden (placeholder / error state above).
  const svgWrap = document.getElementById("drawing-svg-wrap");
  if (d && d.geometry_json && svgWrap) {
    const ok = renderGeometrySvg(d.geometry_json);
    if (ok) {
      svgWrap.hidden = false;
      if (drawingImg) {
        drawingImg.style.display = "none";
        drawingImg.removeAttribute("src");
      }
      // Stash the latest geometry payload so the measurement viewer
      // (opened by the small ruler button) can rebuild the same scene
      // in the modal. Cheap reference; no clone.
      window.__latestGeometryJson = d.geometry_json;
      return;
    }
  }
  // Fallback path: archived analyses without geometry_json.
  if (svgWrap) svgWrap.hidden = true;
  window.__latestGeometryJson = null;
  if (drawingImg && d && d.png_base64) {
    drawingImg.src = "data:image/png;base64," + d.png_base64;
    drawingImg.style.display = "";
  }
}

function markAnalysisDone() {
  // Don't flip the status chip back to "done" / "complete" when we already
  // displayed a stream-error banner — the analysis is stopped, not done.
  if (__streamErrored) {
    statusSpinner.style.display = "none";
    newUploadBtn.hidden = false;
    return;
  }
  setI18n(statusTitle, "status.done");
  statusSpinner.style.display = "none";
  newUploadBtn.hidden = false;
}

/* ============================================================
   PDF summary pane (independent pipeline)
   ============================================================ */

const PDF_FIELD_DEFS = [
  { key: "plot_number",   i18nKey: "pdf.field.plot_number",  ar: "رقم قطعة الأرض" },
  { key: "basin_number",  i18nKey: "pdf.field.basin_number", ar: "رقم الحوض" },
  { key: "basin_name",    i18nKey: "pdf.field.basin_name",   ar: "اسم الحوض" },
  { key: "village_name",  i18nKey: "pdf.field.village",      ar: "اسم القرية" },
  // Area is rendered specially — computed as dunum × 1000 + m² remainder,
  // displayed as a plain numeric "X m²" instead of the raw Arabic string.
  { key: "area_m2",       i18nKey: "pdf.field.area",         ar: "المساحة", format: "area_m2" },
];

let lastPdfData = null;  // cached for re-render on language change

function showPdfPending() {
  // The deed / floor sections live inside #result-content, which the CAD
  // pipeline normally un-hides via showResultPane(). In a PDF-only flow there
  // is no `final` event, so we open the wrapper here too.
  openResultsShell();
  pdfSection.hidden = false;
  pdfLoadingEl.hidden = false;
  pdfContentEl.hidden = true;
  pdfErrorBox.hidden = true;
  setI18n(pdfStatusEl, "step.status.running");
  pdfStatusEl.className = "pdf-status pdf-status-running";
  setI18n(pdfSubEl, "pdf.reading");
}

function openResultsShell() {
  if (resultPlaceholder) resultPlaceholder.hidden = true;
  if (resultContent) resultContent.hidden = false;
  if (resultSub) setI18n(resultSub, "result.waiting");
}

function renderPdfContent(data) {
  lastPdfData = data;
  // If the floor-plan section is already showing, re-render its comparison row
  // now that we finally know the lot area.
  if (lastFloorData && floorComparisonEl && !floorSection.hidden) {
    try { renderFloorComparison(); } catch {}
  }
  // Refresh the top consolidated "Application data" summary.
  try { refreshAppSummaryFromState(); } catch {}
  pdfLoadingEl.hidden = true;
  pdfErrorBox.hidden = true;
  pdfContentEl.hidden = false;
  setI18n(pdfStatusEl, "step.status.done");
  pdfStatusEl.className = "pdf-status pdf-status-done";
  setI18n(pdfSubEl, "pdf.extracted");

  pdfSummaryTextEl.textContent = data.summary || "";

  // Known fields — render only rows that have a value. The area row is
  // special: it shows the Python-computed `area_m2` (= dunum × 1000 + m²
  // remainder) as a plain number, never the raw mixed-unit Arabic string.
  const rows = PDF_FIELD_DEFS
    .filter((def) => {
      const v = data[def.key];
      return v != null && v !== "" && v !== false;
    })
    .map((def) => {
      let displayValue;
      if (def.format === "area_m2") {
        displayValue = fmtArea(data.area_m2) + " m²";
      } else {
        displayValue = String(data[def.key]);
      }
      const enLabel = t(def.i18nKey);
      const showSecondary = currentLang !== "ar";
      return `
        <div class="pdf-field">
          <div class="pdf-field-label">
            <span class="pdf-field-en">${escapeHtml(enLabel)}</span>
            ${showSecondary ? `<span class="pdf-field-ar" dir="rtl">${escapeHtml(def.ar)}</span>` : ""}
          </div>
          <div class="pdf-field-value" dir="auto">${escapeHtml(displayValue)}</div>
        </div>
      `;
    })
    .join("");
  pdfFieldsEl.innerHTML = rows || `<div class="pdf-empty">${escapeHtml(t("pdf.empty"))}</div>`;

  // Other fields collapsible. Filter out any area/دونم/remainder entries that
  // Claude might have duplicated there — they're already in the structured
  // top-level fields and re-rendering the raw string would contradict the
  // "show numbers only" rule.
  const areaLabelRE = /(مساحة|دونم|\barea\b|\bdunum\b)/i;
  const others = Array.isArray(data.other_fields)
    ? data.other_fields.filter((f) =>
        f && f.value && !areaLabelRE.test(String(f.label || "")))
    : [];
  if (others.length) {
    pdfOtherDetails.hidden = false;
    pdfOtherListEl.innerHTML = others.map((f) => `
      <div class="pdf-other-row">
        <span class="po-label">${escapeHtml(String(f.label || "—"))}</span>
        <span class="po-value" dir="auto">${escapeHtml(String(f.value))}</span>
      </div>
    `).join("");
  } else {
    pdfOtherDetails.hidden = true;
    pdfOtherListEl.innerHTML = "";
  }
}

function renderPdfError(message) {
  pdfLoadingEl.hidden = true;
  pdfContentEl.hidden = true;
  pdfErrorBox.hidden = false;
  pdfErrorBox.textContent = message || t("pdf.failed");
  setI18n(pdfStatusEl, "step.status.error");
  pdfStatusEl.className = "pdf-status pdf-status-error";
  setI18n(pdfSubEl, "pdf.failed");
}

function resetPdfSection() {
  lastPdfData = null;
  // Section wrapper stays visible so its space is reserved from page load;
  // only the inner loading / content / error states get toggled here.
  pdfLoadingEl.hidden = false;
  pdfContentEl.hidden = true;
  pdfErrorBox.hidden = true;
  pdfSummaryTextEl.textContent = "";
  pdfFieldsEl.innerHTML = "";
  pdfOtherDetails.hidden = true;
  pdfOtherListEl.innerHTML = "";
  setI18n(pdfStatusEl, "step.status.running");
  pdfStatusEl.className = "pdf-status pdf-status-running";
  setI18n(pdfSubEl, "pdf.reading");
}

/* ============================================================
   Site-plan PDF (مخطط موقع تنظيمي) — single doc, structured fields:
   front/side/rear setbacks, corner-lot flag, plot identity, use type.
   ============================================================ */
let lastSitePlanData = null;

function showSitePlanPending() {
  openResultsShell();
  if (!sitePlanSection) return;
  sitePlanSection.hidden = false;
  sitePlanLoadingEl.hidden = false;
  sitePlanContentEl.hidden = true;
  sitePlanErrorBox.hidden = true;
  setI18n(sitePlanStatusEl, "step.status.running");
  sitePlanStatusEl.className = "pdf-status pdf-status-running";
  setI18n(sitePlanSubEl, "site_plan.reading");
}

function renderSitePlanContent(data) {
  if (!sitePlanSection) return;
  lastSitePlanData = data || {};
  sitePlanSection.hidden = false;
  sitePlanLoadingEl.hidden = true;
  sitePlanErrorBox.hidden = true;
  sitePlanContentEl.hidden = false;

  sitePlanSummaryTextEl.textContent = data && data.summary ? data.summary : "";

  // Flat list — only show fields with values.
  const isCorner = !!(data && data.is_corner_lot);
  const corner_str = isCorner ? t("site_plan.value.corner_yes") : t("site_plan.value.corner_no");
  const rear_str = (data && data.rear_setback_m != null)
    ? `${data.rear_setback_m} m`
    : (isCorner ? t("site_plan.value.rear_corner") : "—");
  const rows = [
    { label: t("site_plan.field.front"),  value: (data && data.front_setback_m != null) ? `${data.front_setback_m} m` : null },
    { label: t("site_plan.field.side"),   value: (data && data.side_setback_m  != null) ? `${data.side_setback_m} m`  : null },
    { label: t("site_plan.field.rear"),   value: rear_str },
    { label: t("site_plan.field.corner"), value: corner_str },
    { label: t("pdf.field.plot_number"),  value: data && data.plot_number },
    { label: t("pdf.field.basin_name"),   value: data && data.basin },
    { label: t("pdf.field.village"),      value: data && data.village },
    { label: t("pdf.field.neighborhood"), value: data && data.neighborhood },
    { label: t("site_plan.field.use"),    value: data && data.use_type },
  ];
  sitePlanFieldsEl.innerHTML = rows
    .filter((r) => r.value != null && r.value !== "")
    .map((r) => `
      <div class="pdf-field">
        <span class="pf-label">${escapeHtml(String(r.label))}</span>
        <span class="pf-value" dir="auto">${escapeHtml(String(r.value))}</span>
      </div>
    `).join("");

  setI18n(sitePlanStatusEl, "step.status.done");
  sitePlanStatusEl.className = "pdf-status pdf-status-done";
  setI18n(sitePlanSubEl, "site_plan.done");

  // Reflect required setbacks in the reviewer banner KPI tile immediately —
  // the compliance fine tile waits for the CAD pipeline's final result.
  applySitePlanToBanner(data);
  // Forward the same site-plan data to the reviewer banner so the floor
  // coverage / floor count compare tiles have the rulebook side they
  // need (floor_ratio_pct, max_floors). Without this they would never
  // populate their right-hand value and the status would stay "pending".
  try {
    if (window.__reviewerBanner && typeof window.__reviewerBanner.applySitePlan === "function") {
      window.__reviewerBanner.applySitePlan(data);
    }
  } catch (err) { /* non-fatal */ }
  // Re-run the application-summary aggregator now that the site plan is
  // available. Pulls combined village (e.g. "118 بدران") and street name
  // into the unified details grid; without this refresh they'd only show
  // up after the next deed/extras event.
  try { refreshAppSummaryFromState(); } catch {}
}

function renderSitePlanError(message, kind) {
  if (!sitePlanSection) return;
  sitePlanSection.hidden = false;
  sitePlanLoadingEl.hidden = true;
  sitePlanContentEl.hidden = true;
  sitePlanErrorBox.hidden = false;
  sitePlanErrorBox.textContent = message || t("site_plan.failed");
  setI18n(sitePlanStatusEl, "step.status.error");
  sitePlanStatusEl.className = "pdf-status pdf-status-error";
  // Subline depends on which kind of failure we got back from the extractor.
  const subKey = kind === "wrong_document"
    ? "site_plan.wrong_document"
    : (kind === "extraction_failed" ? "site_plan.extraction_failed" : "site_plan.failed");
  setI18n(sitePlanSubEl, subKey);
}

function resetSitePlanSection() {
  lastSitePlanData = null;
  if (sitePlanSection) {
    sitePlanSection.hidden = true;
    sitePlanLoadingEl.hidden = false;
    sitePlanContentEl.hidden = true;
    sitePlanErrorBox.hidden = true;
    sitePlanSummaryTextEl.textContent = "";
    sitePlanFieldsEl.innerHTML = "";
    setI18n(sitePlanStatusEl, "step.status.running");
    sitePlanStatusEl.className = "pdf-status pdf-status-running";
    setI18n(sitePlanSubEl, "site_plan.reading");
  }
  // Hide the compliance KPI tiles too — they only make sense when a site
  // plan has been extracted and the CAD geometry has been compared to it.
  if (rbRequiredTile) rbRequiredTile.hidden = true;
  if (rbComplianceTile) {
    rbComplianceTile.hidden = true;
    rbComplianceTile.classList.remove("rb-kpi--violated", "rb-kpi--serious");
  }
  if (rbRequiredValues) rbRequiredValues.textContent = "—";
  if (rbRequiredHint) setI18n(rbRequiredHint, "rb.hint.from_site_plan");
  if (rbComplianceFine) rbComplianceFine.textContent = "—";
  if (rbComplianceHint) setI18n(rbComplianceHint, "rb.hint.compliance_clean");
  // Clear the reviewer-banner's cached site-plan result too. Without this,
  // the floor-coverage / num-floors / building-area compare tiles keep
  // showing the previous round's allowed values (e.g. floor_ratio_pct=35)
  // for the entire re-upload window. And if the new extraction errors out,
  // it never gets replaced — the backend emits site_plan_error instead of
  // site_plan_done, so applySitePlan is never re-invoked.
  try {
    if (window.__reviewerBanner && typeof window.__reviewerBanner.applySitePlan === "function") {
      window.__reviewerBanner.applySitePlan(null);
    }
  } catch (err) { /* non-fatal */ }
}

// Reveal + populate the "Required setbacks" KPI tile in the reviewer banner.
// Called from both the live `site_plan_done` event and from history replay.
// This is the "preview" feed — populated as soon as the site-plan PDF is
// extracted, before the CAD pipeline has computed the fine. Once compliance
// arrives, applyComplianceToBanner overrides the values from
// compliance.per_side[*].required_m so the displayed numbers always match
// the values actually used in the fine calculation (which can differ from
// raw PDF values when الاحكام الخاصة overrides apply).
function applySitePlanToBanner(data) {
  if (!data || !rbRequiredTile || !rbRequiredValues) return;
  const front = data.front_setback_m;
  const side  = data.side_setback_m;
  const rear  = data.rear_setback_m;
  const isCorner = !!data.is_corner_lot;
  if (front == null && side == null && rear == null) return;
  const rearStr = isCorner ? t("site_plan.value.rear_corner")
                            : (rear != null ? `${rear} m` : "—");
  rbRequiredValues.innerHTML =
    `${escapeHtml(t("site_plan.field.front"))}: <b>${front != null ? front + " m" : "—"}</b><br>`
    + `${escapeHtml(t("site_plan.field.side"))}: <b>${side != null ? side + " m" : "—"}</b><br>`
    + `${escapeHtml(t("site_plan.field.rear"))}: <b>${escapeHtml(rearStr)}</b>`;
  if (rbRequiredHint) setI18n(rbRequiredHint, "rb.hint.from_site_plan");
  rbRequiredTile.hidden = false;
}

// Lock the "Required setbacks" tile to the values that were actually used
// in the compliance / fine calculation. compliance.per_side carries the
// post-special-provisions required_m for each side, so this is the single
// source of truth — never the raw PDF values, which can diverge when
// setback_override or side_reclassification rules fire. Returns true when
// it found enough data to render; the caller keeps the PDF-fed preview
// otherwise.
function applyComplianceRequiredToBanner(compliance) {
  if (!compliance || !rbRequiredTile || !rbRequiredValues) return false;
  const perSide = compliance.per_side || {};
  const fSide = perSide.front || null;
  const sSide = perSide.side  || null;
  const rSide = perSide.rear  || null;
  const front = fSide && fSide.required_m != null ? Number(fSide.required_m) : null;
  const side  = sSide && sSide.required_m != null ? Number(sSide.required_m) : null;
  const rear  = rSide && rSide.required_m != null ? Number(rSide.required_m) : null;
  const isCorner = !!compliance.is_corner_lot;
  if (front == null && side == null && rear == null) return false;
  const fmtM = (v) => (v != null && Number.isFinite(v))
    ? `${(Math.round(v * 100) / 100)} m` : "—";
  const rearStr = isCorner ? t("site_plan.value.rear_corner") : fmtM(rear);
  rbRequiredValues.innerHTML =
    `${escapeHtml(t("site_plan.field.front"))}: <b>${escapeHtml(fmtM(front))}</b><br>`
    + `${escapeHtml(t("site_plan.field.side"))}: <b>${escapeHtml(fmtM(side))}</b><br>`
    + `${escapeHtml(t("site_plan.field.rear"))}: <b>${escapeHtml(rearStr)}</b>`;
  if (rbRequiredHint) {
    const hasOverrides = Array.isArray(compliance.applied_special_provisions)
      && compliance.applied_special_provisions.some((r) => r && r.status === "applied");
    setI18n(rbRequiredHint,
      hasOverrides ? "rb.hint.from_compliance_overridden"
                   : "rb.hint.from_compliance");
  }
  rbRequiredTile.hidden = false;
  return true;
}

// Compliance fine tile — driven by the `compliance` block on the CAD final
// result. Hides when no compliance was computed (no site plan, or extraction
// failed). Color shifts: clean = neutral · violated = red · serious = solid red.
function applyComplianceToBanner(compliance) {
  if (!rbComplianceTile || !rbComplianceFine || !rbComplianceHint) return;
  if (!compliance) {
    rbComplianceTile.hidden = true;
    rbComplianceTile.classList.remove("rb-kpi--violated", "rb-kpi--serious");
    return;
  }
  // Lock the required-setbacks tile to compliance.per_side so the displayed
  // values match the ones the fine was actually computed from (post الاحكام
  // الخاصة). Falls back silently to the PDF-fed preview if per_side is empty.
  applyComplianceRequiredToBanner(compliance);
  rbComplianceTile.hidden = false;
  const fine = Number(compliance.fine_jd || 0);
  const area = Number(compliance.total_violation_area_m2 || 0);
  const fmtFine = fine.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Big text shows the total violation area; "0 م²" when below the rounding
  // threshold (clean / sub-millimeter envelope intersections).
  rbComplianceFine.textContent = (area >= 0.005)
    ? `${area.toFixed(2)} م²`
    : `0 م²`;

  rbComplianceTile.classList.remove("rb-kpi--violated", "rb-kpi--serious");
  if (compliance.is_serious) {
    rbComplianceTile.classList.add("rb-kpi--violated", "rb-kpi--serious");
    setI18n(rbComplianceHint, "rb.hint.compliance_serious");
  } else if (compliance.envelope_infeasible) {
    rbComplianceTile.classList.add("rb-kpi--violated");
    setI18n(rbComplianceHint, "rb.hint.compliance_infeasible");
  } else if (fine >= 0.005 || area >= 0.005) {
    // Treat as a violation only when at least one of fine / area is
    // large enough to render as non-zero after rounding. Shapely
    // produces sub-millimeter intersections (~1e-4 m², ~0.02 JOD) on
    // lots whose building edge nearly coincides with the setback
    // envelope; those used to flip the tile red while the UI said
    // "JOD 0.00 · 0.00 م²". Thresholds match the display precision:
    //   fine — toLocaleString(2 fraction digits) → 0.005 cutoff
    //   area — toFixed(2) → 0.005 cutoff
    rbComplianceTile.classList.add("rb-kpi--violated");
    rbComplianceHint.removeAttribute("data-i18n");
    rbComplianceHint.textContent = `JOD ${fmtFine}`;
  } else {
    setI18n(rbComplianceHint, "rb.hint.compliance_clean");
  }
}

/* ============================================================
   Additional PDFs pane (independent pipeline)
   Each file uploaded shows as its own collapsible card. Cards are
   pre-rendered in a "pending" state on submit, then replaced in place
   when their extra_done / extra_error event arrives.
   ============================================================ */

// The display order of structured fields inside each extra card. Same set
// as the deed, with the building / title-block fields added. Only rows with
// a non-null value are rendered, so deed-like PDFs and title-block PDFs
// both look natural.
const EXTRA_FIELD_DEFS = [
  { key: "plot_number",         i18nKey: "pdf.field.plot_number",         ar: "رقم قطعة الأرض" },
  { key: "basin_number",        i18nKey: "pdf.field.basin_number",        ar: "رقم الحوض" },
  { key: "basin_name",          i18nKey: "pdf.field.basin_name",          ar: "اسم الحوض" },
  { key: "village_name",        i18nKey: "pdf.field.village",             ar: "اسم القرية" },
  { key: "neighborhood",        i18nKey: "pdf.field.neighborhood",        ar: "المنطقة / الحي" },
  { key: "area_m2",             i18nKey: "pdf.field.area",                ar: "المساحة", format: "area_m2" },
  { key: "project_name",        i18nKey: "pdf.field.project_name",        ar: "اسم المشروع" },
  { key: "owner",               i18nKey: "pdf.field.owner",               ar: "المالك" },
  { key: "building_type",       i18nKey: "pdf.field.building_type",       ar: "نوع البناء" },
  { key: "zoning_region",       i18nKey: "pdf.field.zoning_region",       ar: "منطقة التنظيم" },
  { key: "engineer",            i18nKey: "pdf.field.engineer",            ar: "المهندس" },
  { key: "registration_number", i18nKey: "pdf.field.registration_number", ar: "رقم التسجيل" },
  { key: "document_date",       i18nKey: "pdf.field.document_date",       ar: "تاريخ الوثيقة" },
];

// Which labels in other_fields to suppress because they duplicate a
// structured field we already render above.
const EXTRA_DUPLICATE_RE = /(مساحة|دونم|\barea\b|\bdunum\b|رقم القطعة|رقم الحوض|اسم الحوض|اسم القرية|اسم المشروع|نوع البناء|منطقة التنظيم|رقم التسجيل|المهندس|المالك)/i;

function showExtrasPending(files) {
  openResultsShell();
  extrasSection.hidden = false;
  extrasListEl.innerHTML = files.map((f, i) => extraCardHtml({
    index: i,
    filename: f.name,
    status: "pending",
  })).join("");
  setI18n(extrasStatusEl, "step.status.running");
  extrasStatusEl.className = "pdf-status pdf-status-running";
  updateExtrasSubline();
}

function markExtraPending(index, filename) {
  // Promote the pending card to "running" styling, e.g. when the extra_start
  // event arrives on replay (showExtrasPending wasn't called).
  const existing = extrasListEl.querySelector(`.extra-card[data-index="${index}"]`);
  if (existing) {
    existing.classList.add("is-running");
    return;
  }
  extrasSection.hidden = false;
  extrasListEl.insertAdjacentHTML(
    "beforeend",
    extraCardHtml({ index, filename, status: "running" })
  );
  updateExtrasSubline();
}

function renderExtraCard(index, filename, data) {
  const html = extraCardHtml({ index, filename, status: "done", data });
  replaceExtraCard(index, html);
  updateExtrasSubline();
  // Cache the payload so refreshAppSummaryFromState can rebuild the top
  // consolidated summary whenever any PDF finishes.
  _extrasDataByIndex[index] = data || {};
  try { refreshAppSummaryFromState(); } catch {}
}

function renderExtraError(index, filename, message) {
  const html = extraCardHtml({ index, filename, status: "error", error: message });
  replaceExtraCard(index, html);
  updateExtrasSubline();
}

function replaceExtraCard(index, html) {
  const existing = extrasListEl.querySelector(`.extra-card[data-index="${index}"]`);
  if (existing) {
    existing.outerHTML = html;
  } else {
    extrasSection.hidden = false;
    extrasListEl.insertAdjacentHTML("beforeend", html);
  }
}

function extraCardHtml({ index, filename, status, data, error }) {
  const statusTag = status === "done"
    ? `<span class="extra-status is-done">${escapeHtml(t("step.status.done"))}</span>`
    : status === "error"
      ? `<span class="extra-status is-error">${escapeHtml(t("step.status.error"))}</span>`
      : `<span class="extra-status is-running">${escapeHtml(t("step.status.running"))}</span>`;

  const titleEn = filename || `PDF #${index + 1}`;
  // Default open on completion / error so the user sees the content without
  // clicking; leave pending/running cards closed since there's nothing to show.
  const openAttr = (status === "done" || status === "error") ? "open" : "";

  let body = "";
  if (status === "pending" || status === "running") {
    body = `
      <div class="extra-pending">
        <div class="spinner" aria-hidden="true"></div>
        <span>${escapeHtml(t("extras.waiting"))}</span>
      </div>`;
  } else if (status === "error") {
    body = `<div class="pdf-error extra-error-body">${escapeHtml(error || t("extras.failed"))}</div>`;
  } else {
    body = extraBodyHtml(data || {});
  }

  return `
    <details class="extra-card is-${status}" data-index="${index}" ${openAttr}>
      <summary class="extra-card-head">
        <svg class="summary-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 3l3 3-3 3"/></svg>
        <span class="extra-card-title" dir="auto">${escapeHtml(titleEn)}</span>
        ${statusTag}
      </summary>
      <div class="extra-card-body">${body}</div>
    </details>
  `;
}

function extraBodyHtml(data) {
  const summary = data.summary
    ? `<p class="pdf-summary-text extra-summary">${escapeHtml(String(data.summary))}</p>`
    : "";

  // Structured fields — render only the ones with a value.
  const showSecondary = currentLang !== "ar";
  const fieldRows = EXTRA_FIELD_DEFS
    .filter((def) => {
      const v = data[def.key];
      return v != null && v !== "" && v !== false;
    })
    .map((def) => {
      let displayValue;
      if (def.format === "area_m2") {
        displayValue = fmtArea(data.area_m2) + " m²";
      } else {
        displayValue = String(data[def.key]);
      }
      return `
        <div class="pdf-field">
          <div class="pdf-field-label">
            <span class="pdf-field-en">${escapeHtml(t(def.i18nKey))}</span>
            ${showSecondary ? `<span class="pdf-field-ar" dir="rtl">${escapeHtml(def.ar)}</span>` : ""}
          </div>
          <div class="pdf-field-value" dir="auto">${escapeHtml(displayValue)}</div>
        </div>
      `;
    })
    .join("");

  const fields = fieldRows
    ? `<div class="pdf-fields">${fieldRows}</div>`
    : `<div class="pdf-empty">${escapeHtml(t("pdf.empty"))}</div>`;

  // Other fields — filter out anything that duplicates a structured field.
  const others = Array.isArray(data.other_fields)
    ? data.other_fields.filter((f) =>
        f && f.value && !EXTRA_DUPLICATE_RE.test(String(f.label || "")))
    : [];
  const otherHtml = others.length
    ? `
      <details class="pdf-other extra-other">
        <summary>${escapeHtml(t("pdf.other"))}</summary>
        <div class="pdf-other-list">
          ${others.map((f) => `
            <div class="pdf-other-row">
              <span class="po-label">${escapeHtml(String(f.label || "—"))}</span>
              <span class="po-value" dir="auto">${escapeHtml(String(f.value))}</span>
            </div>
          `).join("")}
        </div>
      </details>`
    : "";

  return summary + fields + otherHtml;
}

function updateExtrasSubline() {
  const cards = extrasListEl.querySelectorAll(".extra-card");
  const total = cards.length;
  const done = extrasListEl.querySelectorAll(".extra-card.is-done").length;
  const errored = extrasListEl.querySelectorAll(".extra-card.is-error").length;
  const finished = done + errored;
  const pending = Math.max(0, total - finished);

  if (pending === 0 && total > 0) {
    setI18n(extrasStatusEl, "step.status.done");
    extrasStatusEl.className = "pdf-status pdf-status-done";
    extrasSubEl.removeAttribute("data-i18n");
    extrasSubEl.textContent = total === 1
      ? t("extras.done.one")
      : t("extras.done.many", { n: String(total) });
  } else if (total === 0) {
    setI18n(extrasStatusEl, "step.status.done");
    extrasStatusEl.className = "pdf-status pdf-status-done";
    setI18n(extrasSubEl, "extras.empty");
  } else {
    setI18n(extrasStatusEl, "step.status.running");
    extrasStatusEl.className = "pdf-status pdf-status-running";
    extrasSubEl.removeAttribute("data-i18n");
    extrasSubEl.textContent = pending === 1
      ? t("extras.pending.one")
      : t("extras.pending.many", { n: String(pending) });
  }
}

function resetExtrasSection() {
  // Section wrapper stays visible so its space is reserved from page load.
  extrasListEl.innerHTML = "";
  setI18n(extrasStatusEl, "step.status.running");
  extrasStatusEl.className = "pdf-status pdf-status-running";
  setI18n(extrasSubEl, "extras.reading");
}

// Exposed globally so the saved-analysis replay path in reviewer.js can call it.
window.renderExtrasFromSaved = function(extrasResults) {
  const list = Array.isArray(extrasResults) ? extrasResults : [];
  if (!list.length) { return; }
  extrasListEl.innerHTML = list.map((slot, i) => {
    const filename = slot.filename || `PDF #${i + 1}`;
    if (slot.status === "done" && slot.result) {
      _extrasDataByIndex[i] = slot.result;
      return extraCardHtml({ index: i, filename, status: "done", data: slot.result });
    } else if (slot.status === "error") {
      return extraCardHtml({ index: i, filename, status: "error", error: slot.error || "" });
    }
    return extraCardHtml({ index: i, filename, status: "pending" });
  }).join("");
  updateExtrasSubline();
  try { refreshAppSummaryFromState(); } catch {}
};

/* ============================================================
   Top "Application summary" — consolidates the deed PDF + every
   additional PDF into one clean, deduplicated view at the top of
   the doc zone. Two groups: identity (plot, basin, area, …) and
   building (project, engineer, zoning, …). Duplicates by field
   key are kept once (deed wins, then extras in upload order).
   Duplicates in other_fields are kept once per (label, value).
   ============================================================ */

// Unified "تفاصيل الطلب" field list — order matches the HTML grid in the
// banner and the user's intake spec. `tileId` is the value <span>; the
// optional `derive` key signals a synthesized field (computed from the
// merged sources rather than read straight from one).
const BANNER_DETAILS_FIELDS = [
  { key: "plot_number",         tileId: "rb-plot" },
  { key: "basin_number",        tileId: "rb-basin-number" },
  { key: "basin_name",          tileId: "rb-basin-name" },
  { key: "village_combined",    tileId: "rb-village-combined", derive: "village_combined" },
  { key: "owner",               tileId: "rb-owner" },
  { key: "zoning_region",       tileId: "rb-zoning-region" },
  { key: "street_name",         tileId: "rb-street-name" },
  { key: "document_date",       tileId: "rb-document-date" },
  { key: "building_number",     tileId: "rb-building-number" },
];

// Back-compat aliases — older callers (loadSavedAnalysis fallback paths,
// reset helpers) still reference these by name. Both now resolve to the
// same unified list.
const BANNER_IDENTITY_FIELDS = BANNER_DETAILS_FIELDS;
const BANNER_BUILDING_FIELDS = [];

// Fields the extractors still surface but that no longer have their own
// tile in the unified grid. They get folded into the "بيانات أخرى مستخرجة"
// accordion as labeled rows so the data isn't lost — these used to live
// in the separate "Project & building" group.
const STRUCTURED_FIELDS_TO_OTHERS = [
  { key: "neighborhood",        i18nKey: "pdf.field.neighborhood" },
  { key: "project_name",        i18nKey: "pdf.field.project_name" },
  { key: "engineer",            i18nKey: "pdf.field.engineer" },
  { key: "building_type",       i18nKey: "pdf.field.building_type" },
  { key: "village_name",        i18nKey: "pdf.field.village" },
  { key: "registration_number", i18nKey: "pdf.field.registration_number" },
];

// Any label in other_fields that already maps to a structured tile above —
// filter those out so we don't render the same value twice. Only field
// labels still represented as structured tiles are listed; neighborhood /
// project_name / engineer are intentionally NOT here so they survive
// into the accordion display.
const APP_SUMMARY_DUP_LABEL_RE = /(مساحة|دونم|\barea\b|\bdunum\b|رقم قطعة|رقم القطعة|رقم الحوض|اسم الحوض|منطقة التنظيم|رقم التسجيل|تاريخ الوثيقة|المالك|السادة|رقم البناية|اسم الشارع|\bowner\b|\bzoning\b)/i;

function _isFilled(v) {
  return v != null && v !== "" && v !== false;
}

function _dedupKey(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
}

function aggregateAppData(deedResult, extrasResults) {
  // Priority order: deed first (authoritative for the plot), then each
  // extra PDF in upload order. The site plan also contributes — but only
  // for fields where it's the better source (combined village, street).
  const sources = [];
  if (deedResult && typeof deedResult === "object" && !deedResult.error) {
    sources.push(deedResult);
  }
  if (Array.isArray(extrasResults)) {
    for (const slot of extrasResults) {
      if (slot && slot.status === "done" && slot.result && !slot.result.error) {
        sources.push(slot.result);
      }
    }
  }
  const sitePlan = (lastSitePlanData && typeof lastSitePlanData === "object")
    ? lastSitePlanData : {};

  // Source-priority overrides — by default deed wins, but a few fields
  // more reliably live on the regulatory site plan and the deed often
  // either doesn't carry them or returns junk values (like "0" pulled
  // from رقم الطابق / رقم الشقة when the deed has no real building number).
  const PREFER_SITE_PLAN = new Set(["building_number", "street_name"]);
  // Site plan stores zoning under a different key (use_type) than the
  // deed (zoning_region). Both describe the same concept ("سكن ج") so
  // we alias them when one document has it and the other doesn't.
  const SITE_PLAN_KEY_ALIAS = {
    zoning_region: "use_type",
  };
  // "0" frequently shows up on deed fields that don't apply to this
  // record (floor / apartment numbers on a plain land deed). Treat it
  // as effectively missing for fields where 0 isn't a meaningful value.
  function _spVal(key) {
    const aliased = SITE_PLAN_KEY_ALIAS[key];
    if (aliased && _isFilled(sitePlan[aliased])) return sitePlan[aliased];
    if (_isFilled(sitePlan[key])) return sitePlan[key];
    return null;
  }
  function _looksMissing(v) {
    if (!_isFilled(v)) return true;
    const s = String(v).trim();
    return s === "" || s === "0";
  }

  const merged = {};
  const directKeys = BANNER_DETAILS_FIELDS
    .filter((f) => !f.derive)
    .map((f) => f.key);
  for (const k of directKeys) {
    const spVal = _spVal(k);
    if (PREFER_SITE_PLAN.has(k) && _isFilled(spVal)) {
      // Site plan is the natural home for this field — take it first.
      merged[k] = spVal;
    } else {
      // Default: deed first, then each additional PDF in upload order.
      for (const src of sources) {
        if (_isFilled(src[k])) { merged[k] = src[k]; break; }
      }
      // Treat junky deed values (empty or "0") as missing for fields where
      // a literal 0 is never the right answer — let the site plan win.
      if (PREFER_SITE_PLAN.has(k) && _looksMissing(merged[k]) && _isFilled(spVal)) {
        merged[k] = spVal;
      }
      // Site-plan fallback (including aliased keys like use_type → zoning_region).
      if (!_isFilled(merged[k]) && _isFilled(spVal)) {
        merged[k] = spVal;
      }
    }
  }

  // Derived: village_combined — prefer site_plan.village (already in
  // "<num> <name>" format like "118 بدران"), fallback to combining the
  // deed's village_name with neighborhood, fallback again to bare name.
  const spVillage = sitePlan.village;
  if (_isFilled(spVillage)) {
    merged.village_combined = String(spVillage).trim();
  } else if (_isFilled(merged.village_name)) {
    merged.village_combined = String(merged.village_name).trim();
  }

  // Merge other_fields from every PDF source. Dedup by (label, value) pair
  // so the same "نوع الأرض → ملك" row doesn't repeat across documents.
  const seen = new Set();
  const others = [];
  function _addOther(label, value) {
    if (!_isFilled(value)) return;
    if (label && APP_SUMMARY_DUP_LABEL_RE.test(label)) return;
    const key = _dedupKey(label) + "||" + _dedupKey(value);
    if (seen.has(key)) return;
    seen.add(key);
    others.push({ label: label || "—", value: String(value) });
  }
  for (const src of sources) {
    const list = Array.isArray(src.other_fields) ? src.other_fields : [];
    for (const f of list) {
      if (!f) continue;
      _addOther(String(f.label || ""), f.value);
    }
  }
  // Fold previously-tiled fields (neighborhood, project_name, engineer)
  // into the same accordion so the data still surfaces somewhere when
  // present. Pulled from the same merged sources.
  for (const def of STRUCTURED_FIELDS_TO_OTHERS) {
    let val = null;
    for (const src of sources) {
      if (_isFilled(src[def.key])) { val = src[def.key]; break; }
    }
    if (_isFilled(val)) _addOther(t(def.i18nKey), val);
  }

  return { merged, others, sourceCount: sources.length };
}

function _formatBannerFieldValue(def, value) {
  if (def.format === "area_m2") return fmtArea(value) + " m²";
  return String(value);
}

// Populate (and hide empty) the banner's identity + building tiles from the
// consolidated deed + extras data. Also populates the "Other extracted data"
// collapsible. Hides the Building group entirely when it has no values.
function renderApplicationSummary(deedResult, extrasResults) {
  const { merged, others } = aggregateAppData(deedResult, extrasResults);

  // Hide the section spinner — even if individual values are still empty,
  // the PDF pipeline has reported, so the loading indicator is stale.
  const idSpinner = document.getElementById("rb-identity-spinner");
  if (idSpinner) idSpinner.hidden = true;

  // Render every tile from the unified details list. Empty values
  // collapse to "—" — the cards stay visible so the grid keeps its
  // shape even before the deed lands.
  for (const def of BANNER_DETAILS_FIELDS) {
    const tile = document.getElementById(def.tileId);
    if (!tile) continue;
    const card = tile.closest(".rb-id-item");
    const v = merged[def.key];
    const text = _isFilled(v) ? _formatBannerFieldValue(def, v) : "—";
    tile.textContent = text;
    // Long values are truncated with text-overflow ellipsis when 11
    // tiles share a row; the title makes the full string visible on
    // hover without expanding the tile.
    if (text && text !== "—") tile.setAttribute("title", text);
    else tile.removeAttribute("title");
    if (card) card.hidden = false;
  }
  // The legacy "Project & building" group was merged into the unified
  // tile list. Its placeholder divs stay hidden so they don't take up
  // vertical space. (Refs are still wired in case anything else asks.)
  if (rbBuildingLabel) rbBuildingLabel.hidden = true;
  if (rbBuildingGrid)  rbBuildingGrid.hidden  = true;

  // Other extracted data — rendered as tiles using the same .rb-id-item
  // shape as the top "تفاصيل الطلب" grid so the visual treatment is
  // consistent. The accordion stays collapsed by default; expand to view.
  if (others.length && rbOther && rbOtherList) {
    rbOther.hidden = false;
    rbOtherList.innerHTML = others.map((f) => {
      const labelHtml = escapeHtml(f.label || "—");
      const valueHtml = escapeHtml(f.value);
      const titleAttr = ` title="${valueHtml}"`;
      return `
        <div class="rb-id-item" data-field="other">
          <div class="rb-id-label-row">
            <span class="rb-id-label">${labelHtml}</span>
          </div>
          <span class="rb-id-value" dir="auto"${titleAttr}>${valueHtml}</span>
        </div>
      `;
    }).join("");
  } else if (rbOther) {
    rbOther.hidden = true;
    if (rbOtherList) rbOtherList.innerHTML = "";
  }
}

// Collect the current per-file results (both the deed and each extra slot)
// and re-render the banner tiles. Called from every terminal event handler.
function refreshAppSummaryFromState() {
  const extras = [];
  const cards = extrasListEl ? extrasListEl.querySelectorAll(".extra-card") : [];
  cards.forEach((c) => {
    const idx = parseInt(c.getAttribute("data-index"), 10);
    const cached = _extrasDataByIndex[idx];
    if (cached) extras.push({ status: "done", result: cached });
  });
  renderApplicationSummary(lastPdfData, extras);
}

// Cache of the most recent extra_done / saved-replay data per index.
const _extrasDataByIndex = Object.create(null);

function resetAppSummarySection() {
  // Reset every identity + building tile value back to "—", but keep the
  // cards + section label + grid visible so the full block reserves its
  // space from the moment the page loads. Empty fields stay as "—".
  for (const def of [...BANNER_IDENTITY_FIELDS, ...BANNER_BUILDING_FIELDS]) {
    const tile = document.getElementById(def.tileId);
    if (!tile) continue;
    tile.textContent = "—";
  }
  if (rbOther) { rbOther.hidden = true; rbOther.open = false; }
  if (rbOtherList) rbOtherList.innerHTML = "";
  // Clear the in-memory cache so a fresh job starts from nothing.
  for (const k of Object.keys(_extrasDataByIndex)) delete _extrasDataByIndex[k];
}

/* ============================================================
   Floor-area plan pane (independent pipeline, separate from deed PDF)
   Renders per-floor tables, subtotals, and a lot-vs-floors ratio
   once both the deed and floor events have arrived.
   ============================================================ */

let lastFloorData = null;   // cached for re-render on language change / deed-late-arrival

function fmtArea(n, digits) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits ?? 2,
    maximumFractionDigits: digits ?? 2,
  });
}

function showFloorPending() {
  openResultsShell();
  floorSection.hidden = false;
  floorLoadingEl.hidden = false;
  floorContentEl.hidden = true;
  floorErrorBox.hidden = true;
  setI18n(floorStatusEl, "step.status.running");
  floorStatusEl.className = "pdf-status pdf-status-running";
  setI18n(floorSubEl, "floor.reading");
}

function renderFloorContent(data) {
  lastFloorData = data;
  floorLoadingEl.hidden = true;
  floorErrorBox.hidden = true;
  floorContentEl.hidden = false;
  setI18n(floorStatusEl, "step.status.done");
  floorStatusEl.className = "pdf-status pdf-status-done";
  setI18n(floorSubEl, "floor.extracted");

  // Building-level info from the PDF only — no Python recomputation is done at
  // this level. We only check math row-by-row inside each floor's table.
  const buildingTotal = data.printed_grand_total;
  const licensedTotal = data.licensed_total;

  const floors = Array.isArray(data.floors) ? data.floors : [];
  let mismatchCount = 0;
  for (const f of floors) {
    for (const r of (f.rows || [])) {
      if (r.row_mismatch) mismatchCount++;
    }
  }

  const headerCards = [];
  if (buildingTotal != null) {
    headerCards.push({ key: "floor.building_total", value: buildingTotal });
  }
  if (licensedTotal != null) {
    headerCards.push({ key: "floor.licensed_total", value: licensedTotal });
  }
  const cardsHtml = headerCards.map((c) => `
    <div class="floor-header-card">
      <span class="ft-label">${escapeHtml(t(c.key))}</span>
      <span class="ft-value">${escapeHtml(fmtArea(c.value))}<span class="ft-unit">m²</span></span>
    </div>
  `).join("");

  // Single banner: "N rows flagged" or "all clean". No grand-total / subtotal
  // checks any more — per user spec.
  const bannerCls = mismatchCount > 0 ? "is-mismatch" : "is-clean";
  const bannerText = mismatchCount > 0
    ? t("floor.mismatch_count").replace("{n}", String(mismatchCount))
    : t("floor.no_mismatches");

  floorTotalsEl.innerHTML = `
    ${headerCards.length > 0 ? `<div class="floor-header-cards">${cardsHtml}</div>` : ""}
    <div class="floor-recon ${bannerCls}">
      <span class="fr-state-dot"></span>
      <span class="fr-state-text">${escapeHtml(bannerText)}</span>
    </div>
  `;

  // Clean up any stale DOM from earlier renders.
  const staleGT = document.getElementById("floor-grand-total-note");
  if (staleGT) staleGT.remove();

  renderFloorComparison();

  floorFloorsEl.innerHTML = floors.map((f) => renderOneFloor(f)).join("");
}

function renderOneFloor(floor) {
  const name = floor.name || "—";
  const subtotal = Number.isFinite(floor.printed_subtotal) ? floor.printed_subtotal : null;
  const hasMismatch = !!floor.has_row_mismatch;

  const floorQty = Number.isFinite(floor.qty) && floor.qty > 1 ? floor.qty : 1;
  const floorQtyBadge = floorQty > 1
    ? `<span class="floor-floor-qty" title="${escapeHtml(t("floor.qty.multi"))}">×${floorQty}</span>`
    : "";

  const pageBadge = Number.isFinite(floor.page)
    ? `<span class="floor-floor-page">${escapeHtml(t("floor.page"))} ${floor.page}</span>`
    : "";

  const verifiedBadge = floor.verified
    ? `<span class="floor-floor-verified" title="${escapeHtml(t("floor.verified.tip"))}">
         ${escapeHtml(t("floor.verified"))}
       </span>`
    : "";

  const subtotalChip = subtotal != null
    ? `<span class="floor-floor-subtotal" dir="ltr">
         ${escapeHtml(t("floor.subtotal"))}: ${escapeHtml(fmtArea(subtotal))} m²
       </span>`
    : "";

  const mismatchChip = hasMismatch
    ? `<span class="floor-floor-flag">${escapeHtml(t("floor.mismatch_badge"))}</span>`
    : "";

  const rowsArr = Array.isArray(floor.rows) ? floor.rows : [];
  const rowsHtml = rowsArr.map((r) => {
    const ac = !!r.by_autocad;
    const dims = r.dims || "—";
    const sign = r.sign || "+";
    const qty = Number.isFinite(r.qty) && r.qty > 0 ? r.qty : 1;
    // PDF's printed area (positive) and Python's signed dim × qty.
    const printedCell = (r.total_printed ?? r.printed_area) != null
      ? fmtArea(r.total_printed ?? r.printed_area)
      : "—";
    const pythonRaw = r.dim_times_qty != null
      ? r.dim_times_qty
      : (Number.isFinite(r.computed) ? r.computed : null);
    const pythonCell = pythonRaw != null ? fmtSignedArea(pythonRaw) : "—";

    const isRowMm = !!r.row_mismatch;
    const rowCls = [
      ac ? "is-autocad" : "",
      isRowMm ? "is-mismatch" : "",
    ].filter(Boolean).join(" ");

    const flagHtml = isRowMm
      ? `<span class="floor-mismatch-badge">${escapeHtml(t("floor.mismatch_badge"))}</span>`
      : "";

    const verMark = r.verification === "changed"
      ? `<span class="floor-row-ver" title="${escapeHtml(t("floor.verified.changed.tip"))}">✓</span>`
      : r.verification === "agreed"
        ? `<span class="floor-row-ver is-agreed" title="${escapeHtml(t("floor.verified.tip"))}">✓</span>`
        : "";

    return `
      <tr class="${rowCls}">
        <td>${escapeHtml(String(r.no ?? ""))}${verMark}</td>
        <td class="num" dir="ltr">${escapeHtml(dims)}</td>
        <td>${escapeHtml(sign)}</td>
        <td class="num" dir="ltr">${escapeHtml(String(qty))}</td>
        <td class="num" dir="ltr">${escapeHtml(printedCell)}</td>
        <td class="num" dir="ltr">${escapeHtml(pythonCell)}</td>
        <td class="floor-row-flag">${flagHtml}</td>
      </tr>
    `;
  }).join("");

  // Mismatched floors open by default; clean floors stay collapsed.
  return `
    <details class="floor-floor ${hasMismatch ? "is-mismatch" : ""}" ${hasMismatch ? "open" : ""}>
      <summary>
        <svg class="summary-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 3l3 3-3 3"/></svg>
        <span class="floor-floor-name" dir="rtl">${escapeHtml(name)}</span>
        ${floorQtyBadge}${pageBadge}${verifiedBadge}
        ${subtotalChip}
        ${mismatchChip}
      </summary>
      <table class="floor-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("floor.col.no"))}</th>
            <th>${escapeHtml(t("floor.col.dims"))}</th>
            <th>${escapeHtml(t("floor.col.sign"))}</th>
            <th>${escapeHtml(t("floor.col.qty"))}</th>
            <th>${escapeHtml(t("floor.col.printed"))}</th>
            <th>${escapeHtml(t("floor.col.computed"))}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </details>
  `;
}

function fmtSignedArea(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = fmtArea(Math.abs(n));
  return (n < 0 ? "−" : "") + s;
}

function renderFloorComparison() {
  if (!floorComparisonEl) return;
  const data = lastFloorData;
  if (!data) {
    floorComparisonEl.hidden = true;
    return;
  }
  const lotArea = lastPdfData && typeof lastPdfData.area_m2 === "number" ? lastPdfData.area_m2 : null;
  // Prefer the filtered floor_area_sum (ground + numbered upper + repeated)
  // produced by floor_plan_analyzer; fall back to the raw printed total for
  // pre-v4 saved analyses that don't carry the filtered field yet.
  const floorSum = (data.floor_area_sum != null) ? data.floor_area_sum
    : data.printed_grand_total;

  if (lotArea == null) {
    floorComparisonEl.hidden = false;
    floorComparisonEl.className = "floor-comparison";
    floorComparisonEl.innerHTML = `
      <div class="fc-row"><span class="fc-label">${escapeHtml(t("floor.no_deed"))}</span></div>
    `;
    return;
  }

  const ratio = (floorSum != null && lotArea > 0) ? floorSum / lotArea : null;
  const isOver = ratio != null && ratio > 1;
  floorComparisonEl.hidden = false;
  floorComparisonEl.className = "floor-comparison " + (isOver ? "is-over" : "is-under");
  const verdict = isOver ? t("floor.over") : t("floor.under");
  const ratioPct = ratio != null ? (ratio * 100).toFixed(1) + "%" : "—";
  const ratioX = ratio != null ? "×" + ratio.toFixed(3) : "—";
  floorComparisonEl.innerHTML = `
    <div class="fc-row">
      <span class="fc-label">${escapeHtml(t("floor.lot_area"))}</span>
      <span class="fc-value">${escapeHtml(fmtArea(lotArea))} m²</span>
    </div>
    <div class="fc-row">
      <span class="fc-label">${escapeHtml(t("floor.floor_sum"))}</span>
      <span class="fc-value">${escapeHtml(fmtArea(floorSum))} m²</span>
    </div>
    <div class="fc-row">
      <span class="fc-label">${escapeHtml(t("floor.ratio"))}</span>
      <span class="fc-value fc-ratio">${escapeHtml(ratioPct)} <span style="opacity:.6;font-weight:500;">(${escapeHtml(ratioX)})</span></span>
    </div>
    <div class="fc-row">
      <span class="fc-label" style="font-style:italic;">${escapeHtml(verdict)}</span>
    </div>
  `;
}

function renderFloorError(message) {
  floorLoadingEl.hidden = true;
  floorContentEl.hidden = true;
  floorErrorBox.hidden = false;
  floorErrorBox.textContent = message || t("floor.failed");
  setI18n(floorStatusEl, "step.status.error");
  floorStatusEl.className = "pdf-status pdf-status-error";
  setI18n(floorSubEl, "floor.failed");
}

function resetFloorSection() {
  lastFloorData = null;
  // Section wrapper stays visible so its space is reserved from page load;
  // only the inner loading / content / error states get toggled here.
  floorLoadingEl.hidden = false;
  floorContentEl.hidden = true;
  floorErrorBox.hidden = true;
  floorTotalsEl.innerHTML = "";
  floorComparisonEl.innerHTML = "";
  floorComparisonEl.hidden = true;
  floorFloorsEl.innerHTML = "";
  setI18n(floorStatusEl, "step.status.running");
  floorStatusEl.className = "pdf-status pdf-status-running";
  setI18n(floorSubEl, "floor.reading");
}

/* ============================================================
   Flow
   ============================================================ */

function showError(msg) {
  setI18n(statusTitle, "status.stopped");
  statusSpinner.style.display = "none";
  errorCard.hidden = false;
  errorMessage.textContent = msg;
  newUploadBtn.hidden = false;
  // Clear any side-pane tiles that may have been shown in pending state so
  // the error isn't rendered next to "RUNNING" spinners.
  try { resetPdfSection(); } catch {}
  try { resetFloorSection(); } catch {}
  try { resetExtrasSection(); } catch {}
  try { resetSitePlanSection(); } catch {}
  try { resetAppSummarySection(); } catch {}
  if (resultPlaceholder) resultPlaceholder.hidden = false;
  if (resultContent) resultContent.hidden = true;
}

function resetAll() {
  setFile(null);
  fileInput.value = "";
  setPdf(null);
  pdfInput.value = "";
  setFloor(null);
  floorInput.value = "";
  setExtras([]);
  extrasInput.value = "";
  setSitePlan(null);
  if (sitePlanInput) sitePlanInput.value = "";
  setMeasurement(null);
  if (measurementInput) measurementInput.value = "";
  resetPdfSection();
  resetFloorSection();
  resetExtrasSection();
  resetSitePlanSection();
  resetAppSummarySection();
  resetFeed();
  // Leaving archive replay mode — restore the live pulse label & styling.
  document.body.classList.remove("is-archive");
  const pulseLabel = document.querySelector(".pane-pulse-label");
  if (pulseLabel) {
    pulseLabel.setAttribute("data-i18n", "think.streaming");
    pulseLabel.textContent = t("think.streaming");
  }

  uploadView.hidden = false;
  workView.hidden = true;
  errorCard.hidden = true;
  hideStreamBanner();
  clearFieldErrors();
  resetMissingData();

  if (resultPlaceholder) resultPlaceholder.hidden = false;
  if (resultContent) resultContent.hidden = true;
  if (resultSub) setI18n(resultSub, "result.waiting");

  setI18n(statusTitle, "status.analyzing");
  statusSpinner.style.display = "";
  statusFile.textContent = "";
  newUploadBtn.hidden = true;

  analyzeBtn.disabled = true;
  if (currentEventSource) { currentEventSource.close(); currentEventSource = null; }

  // If we were viewing a saved analysis (?a=<id> in the URL), drop the
  // query string so the next upload is a clean session — otherwise the
  // page would still think it's bound to the old analysis.
  if (window.location.search) {
    try { window.history.replaceState({}, "", window.location.pathname); } catch {}
  }
}

newUploadBtn.addEventListener("click", resetAll);
retryBtn.addEventListener("click", resetAll);
if (streamErrorRetry) streamErrorRetry.addEventListener("click", resetAll);

// Simple full-card overlay for submitters while the POST to /api/jobs is
// in flight. Replaces the reviewer-oriented work view (live thinking,
// KPIs, approve/reject) which the submitter must never see. Injected into
// the #upload-shell so it covers the form without introducing a new
// layout.
function showSubmitterUploadOverlay() {
  let shell = document.querySelector(".upload-shell");
  if (!shell) return;
  let overlay = document.getElementById("submitter-upload-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "submitter-upload-overlay";
    overlay.className = "submitter-upload-overlay";
    overlay.innerHTML = `
      <div class="sub-upload-card">
        <div class="spinner spinner--large" aria-hidden="true"></div>
        <div class="sub-upload-title">جارٍ إرسال طلبك…</div>
        <div class="sub-upload-sub">يتم رفع الملفات الآن. لا تُغلق هذه النافذة حتى يكتمل الرفع.</div>
      </div>`;
    shell.appendChild(overlay);
    // The shell needs position:relative so the overlay can absolute-fill.
    if (getComputedStyle(shell).position === "static") {
      shell.style.position = "relative";
    }
  }
  overlay.hidden = false;
}

function hideSubmitterUploadOverlay() {
  const overlay = document.getElementById("submitter-upload-overlay");
  if (overlay) overlay.hidden = true;
}

/* ============================================================
   Analysis loading view — the polished progress screen shown
   between POST /api/jobs (or /resubmit) and the SSE `done`
   event. Replaces the reviewer-style live work-view during
   analysis for both roles. Stage progression hooks into the
   existing SSE event stream (no separate listener); on `done`
   we hard-navigate to /app?a=<id> so the saved analysis renders
   via autoLoadFromQuery. State is intentionally module-local —
   no need to leak it onto window.
   ============================================================ */
const _AL_STATE = {
  active: false,
  analysisId: "",
  // Per-pipeline expectation flags. `agent` covers CAD geometry +
  // compliance (the rules stage). `deed/floor/site_plan` cover the
  // three PDF analyzers. On a partial resubmit, only the pipelines
  // listed in the server's `rerun` map will actually fire — every
  // other stage shows as "done" immediately so the user isn't waiting
  // on data that's being carried forward from the previous round.
  // `extras` is a count (number of extra PDFs uploaded), each fires
  // one extra_done event.
  expect: { agent: false, deed: false, floor: false, site_plan: false, extras: 0 },
  done:   { deed: false, floor: false, site_plan: false },
  tipTimer: null,
  // Granular progress: counts individual SSE events as discrete steps
  // (one per pdf_done / floor_done / site_plan_done / extra_done /
  // agent tool_end / final / done). expectedTotal is computed upfront
  // from the `expect` map; agent tool count is estimated since it
  // varies per run. completedSteps clamps at expectedTotal in the
  // renderer so the bar never visually exceeds 100%.
  completedSteps: 0,
  expectedTotal: 1,
  currentPhase: "",
};

// Phase rank — used to keep the "now" label monotonic. Pipelines run
// in parallel, so a late-arriving doc event shouldn't drag the label
// back to "reading documents" once we've moved on to the agent loop.
const _AL_PHASE_RANK = {
  "تحضير الملفات":          0,
  "قراءة المستندات":        1,
  "تحليل المخطط الهندسي":   2,
  "مراجعة الاشتراطات":      3,
  "إعداد التقرير النهائي":  4,
};

// Estimated agent tool_end count for a typical CAD analysis. Now that the
// preflight pre-opens the drawing and lists layers (so the agent skips
// convert_dwf_if_needed / open_drawing / list_layers), real runs span 6-9.
// 8 is the median we've seen post-optimization. The bar fills smoothly
// for typical runs and clamps/jumps gracefully on the tails.
const _AL_AGENT_TOOL_ESTIMATE = 8;

function _alComputeExpectedTotal(expect) {
  let total = 0;
  if (expect.deed)      total += 1;
  if (expect.floor)     total += 1;
  if (expect.site_plan) total += 1;
  total += Math.max(0, Number(expect.extras) || 0);
  if (expect.agent) {
    total += 1;  // `agent_start` — model + MCP subprocess warming up
    total += 1;  // `mcp_ready` — drawing opened, agent loop kicking off
    total += _AL_AGENT_TOOL_ESTIMATE;
    total += 1;  // `final`
  }
  total += 1;    // `done`
  return Math.max(total, 1);
}

function _alSetPhase(phase) {
  if (!phase) return;
  const cur = _AL_STATE.currentPhase || "";
  const curRank = _AL_PHASE_RANK[cur] || 0;
  const newRank = _AL_PHASE_RANK[phase] || 0;
  if (newRank >= curRank) _AL_STATE.currentPhase = phase;
}

function _alRenderProgress() {
  if (!_AL_STATE.active) return;
  const total = Math.max(1, _AL_STATE.expectedTotal | 0);
  const done  = Math.max(0, Math.min(_AL_STATE.completedSteps | 0, total));
  const pct   = Math.round((done / total) * 100);
  const stepEl  = document.getElementById("al-progress-step");
  const totalEl = document.getElementById("al-progress-total");
  const pctEl   = document.getElementById("al-progress-pct");
  const fillEl  = document.getElementById("al-progress-fill");
  const phaseEl = document.getElementById("al-progress-phase");
  if (stepEl)  stepEl.textContent  = String(done);
  if (totalEl) totalEl.textContent = String(total);
  if (pctEl)   pctEl.textContent   = pct + "%";
  if (fillEl)  fillEl.style.width  = pct + "%";
  if (phaseEl && _AL_STATE.currentPhase) phaseEl.textContent = _AL_STATE.currentPhase;
}

function _alIncrementProgress(phase) {
  if (!_AL_STATE.active) return;
  _AL_STATE.completedSteps += 1;
  _alSetPhase(phase);
  _alRenderProgress();
}

const _AL_TIPS = [
  "يقارن النظام الذكي مساحة المبنى من المخطط بنسبة التغطية المسموحة من مخطط الموقع التنظيمي.",
  "يتم استخراج الارتدادات الفعلية للمبنى من هندسة المخطط، ثم مقارنتها بالقيم المطلوبة في كل اتجاه.",
  "تُحسب غرامة تجاوز الارتدادات تلقائيًا إذا خرج جزء من المبنى عن المساحة المسموح بها.",
  "يقارن النظام عدد الطوابق المرسومة فعليًا بالحد الأقصى المسموح في مخطط الموقع التنظيمي.",
  "يستخرج النظام بيانات السند (المالك، الحوض، القرية، رقم القطعة، المساحة) ويطابقها مع المخطط.",
];

function _alSetStage(key, state) {
  const li = document.querySelector(`#al-stages .al-stage[data-stage="${key}"]`);
  if (li) li.setAttribute("data-state", state);
  // Mirror state onto the matching validation dot inside the hero box, so
  // each red-dot/green-check follows the stage it represents.
  const dot = document.querySelector(`.al-dot[data-dot="${key}"]`);
  if (dot) dot.setAttribute("data-state", state);
}

function _alAdvanceTip() {
  const el = document.getElementById("al-tip-text");
  if (!el) return;
  const idx = (Number(el.dataset.idx) || 0) + 1;
  const next = _AL_TIPS[idx % _AL_TIPS.length];
  el.classList.add("al-tip-text--swap");
  setTimeout(() => {
    el.textContent = next;
    el.dataset.idx = String(idx);
    el.classList.remove("al-tip-text--swap");
  }, 300);
}

function showAnalysisLoadingView({ analysisId = "", expect = {} } = {}) {
  const view = document.getElementById("analysis-loading-view");
  if (!view) return;

  _AL_STATE.active = true;
  _AL_STATE.analysisId = analysisId || "";
  _AL_STATE.expect = {
    agent:     !!expect.agent,
    deed:      !!expect.deed,
    floor:     !!expect.floor,
    site_plan: !!expect.site_plan,
    extras:    Math.max(0, Number(expect.extras) || 0),
  };
  _AL_STATE.done = { deed: false, floor: false, site_plan: false };

  // Reset granular progress state. expectedTotal is fixed for the
  // duration of this run (computed from `expect`); completedSteps
  // increments as SSE events arrive. The bar/counter renders 0/N at 0%.
  _AL_STATE.completedSteps = 0;
  _AL_STATE.expectedTotal  = _alComputeExpectedTotal(_AL_STATE.expect);
  _AL_STATE.currentPhase   = "تحضير الملفات";
  _alRenderProgress();

  // Initial states are driven by `expect`: any pipeline that *will*
  // run starts as "active" so the user sees a spinner from the first
  // frame; any pipeline being carried forward from the prior round
  // starts as "done" so it's visibly clear we're not re-processing it.
  // Stage 5 (report) always stays "waiting" until `final` fires — it
  // represents the final assembly step.
  // Stage map (new 5-stage flow):
  //   documents   — covers all 3 PDFs (deed + floor + site_plan)
  //   drawings    — covers CAD geometry portion of the agent run
  //   structural  — covers compliance/rules portion of the agent run
  //   safety      — synthetic sub-step of compliance; flips with structural
  //   report      — final assembly + save
  const e = _AL_STATE.expect;
  const anyDocs = e.deed || e.floor || e.site_plan;
  _alSetStage("documents",  anyDocs ? "active" : "done");
  _alSetStage("drawings",   e.agent ? "active" : "done");
  _alSetStage("structural", e.agent ? "active" : "done");
  _alSetStage("safety",     e.agent ? "active" : "done");
  _alSetStage("report",     "waiting");

  // Reset the tip rotator.
  const tipEl = document.getElementById("al-tip-text");
  if (tipEl) {
    tipEl.dataset.idx = "0";
    tipEl.textContent = _AL_TIPS[0];
  }
  if (_AL_STATE.tipTimer) clearInterval(_AL_STATE.tipTimer);
  _AL_STATE.tipTimer = setInterval(_alAdvanceTip, 5500);

  // Hide the other views so the loading screen stands alone.
  const upload = document.getElementById("upload-view");
  const work   = document.getElementById("work-view");
  const error  = document.getElementById("error-card");
  if (upload) upload.hidden = true;
  if (work)   work.hidden   = true;
  if (error)  error.hidden  = true;
  view.hidden = false;
}

function _alSetAnalysisId(id) {
  if (id) _AL_STATE.analysisId = String(id);
}
window.__alSetAnalysisId = _alSetAnalysisId;
window.__showAnalysisLoadingView = showAnalysisLoadingView;
window.__hideAnalysisLoadingView = hideAnalysisLoadingView;

function hideAnalysisLoadingView() {
  _AL_STATE.active = false;
  if (_AL_STATE.tipTimer) {
    clearInterval(_AL_STATE.tipTimer);
    _AL_STATE.tipTimer = null;
  }
  const view = document.getElementById("analysis-loading-view");
  if (view) view.hidden = true;
}

// Called from the existing EVENT_HANDLERS so the loading view advances
// in lock-step with the SSE stream — no separate listener needed.
//
// Stage transitions (5-stage flow):
//   `pdf_done`/`floor_done`/`site_plan_done` → tick the doc-done flags;
//        when all expected docs have landed, flip "documents" → done.
//   `final` → agent finished both CAD geometry and compliance, so flip
//        "drawings" → done, "structural" → done, "safety" → done. We
//        stagger them by ~180ms so the green checks land in sequence
//        rather than all at once (small visual flourish — the underlying
//        truth is that all three completed together via the same event).
//        "report" flips to active here — it's the brief finalize/save
//        window before `done` fires.
function _alOnEvent(kind, _data) {
  if (!_AL_STATE.active) return;
  if (kind === "agent_start") {
    // Model client + MCP subprocess starting. Counts as one explicit step
    // so the bar visibly advances right after upload — the longest
    // "nothing-happens" gap users used to feel.
    _alIncrementProgress("تحضير الملفات");
  } else if (kind === "mcp_ready") {
    // Drawing has been opened and the layer list is in hand; the agent
    // loop is about to issue its first tool call. One explicit step so
    // the bar reflects the AutoCAD-warmup phase finishing.
    _alIncrementProgress("تحليل المخطط الهندسي");
  } else if (kind === "pdf_done") {
    _AL_STATE.done.deed = true;
    _alIncrementProgress("قراءة المستندات");
  } else if (kind === "floor_done") {
    _AL_STATE.done.floor = true;
    _alIncrementProgress("قراءة المستندات");
  } else if (kind === "site_plan_done") {
    _AL_STATE.done.site_plan = true;
    _alIncrementProgress("قراءة المستندات");
  } else if (kind === "extra_done") {
    _alIncrementProgress("قراءة المستندات");
  } else if (kind === "tool_start") {
    // Display the actual tool title as the phase label so the user sees
    // what is happening RIGHT NOW (e.g. "حساب الارتدادات") instead of a
    // generic phase. Reuses the existing TOOL_INFO i18n entries; falls
    // back to the bare tool name if a label isn't defined. No increment
    // — tool_end below ratchets the counter forward.
    const name = _data && _data.name;
    const info = name ? TOOL_INFO[name] : null;
    let label = "";
    try {
      let input = _data && _data.input;
      if (typeof input === "string") { try { input = JSON.parse(input); } catch {} }
      label = info && typeof info.title === "function"
        ? info.title(input || {})
        : (name || "");
    } catch { label = name || ""; }
    if (label) {
      _AL_STATE.currentPhase = label;
      _alRenderProgress();
    }
  } else if (kind === "tool_end") {
    // Each agent tool call counts as one granular step. The `final`
    // event below adds one more on top — together they map to the
    // tool-count estimate baked into _alComputeExpectedTotal. Pass an
    // empty phase so the tool-specific label set by tool_start (e.g.
    // "حساب الارتدادات") survives until the next tool_start replaces
    // it; otherwise the label flickers back to a generic phrase between
    // every tool.
    _alIncrementProgress("");
  } else if (kind === "final") {
    if (_AL_STATE.expect.agent) {
      _alSetStage("drawings", "done");
      setTimeout(() => { if (_AL_STATE.active) _alSetStage("structural", "done"); }, 180);
      setTimeout(() => { if (_AL_STATE.active) _alSetStage("safety",     "done"); }, 360);
    }
    _alSetStage("report", "active");
    _alIncrementProgress("مراجعة الاشتراطات");
  }
  // After any doc event, recompute "all expected docs done" and flip
  // "documents" → done if so. Idempotent — calling _alSetStage with the
  // same state is a no-op.
  if (kind === "pdf_done" || kind === "floor_done" || kind === "site_plan_done") {
    const e = _AL_STATE.expect, d = _AL_STATE.done;
    const allDone =
      (!e.deed      || d.deed) &&
      (!e.floor     || d.floor) &&
      (!e.site_plan || d.site_plan);
    if (allDone) _alSetStage("documents", "done");
  }
}
window.__alOnEvent = _alOnEvent;

// Called from the `done` handler. Marks the final stages, lets the
// success animation breathe for a moment, then navigates to the saved
// analysis page so the result renders via autoLoadFromQuery.
function _alOnDone() {
  if (!_AL_STATE.active) return;
  _alSetStage("documents",  "done");
  _alSetStage("drawings",   "done");
  _alSetStage("structural", "done");
  _alSetStage("safety",     "done");
  _alSetStage("report",     "done");
  // Force the granular counter/bar to 100% — covers two cases:
  //   a) the agent ran fewer tool calls than estimated (bar would have
  //      stalled below 100%); we snap it up so the user sees completion;
  //   b) the agent ran more tool calls than estimated (bar already
  //      clamped at 100% but completedSteps may have overshot); we
  //      pin both to expectedTotal so the displayed counter reads N/N.
  _AL_STATE.completedSteps = _AL_STATE.expectedTotal;
  _alSetPhase("إعداد التقرير النهائي");
  _alRenderProgress();
  const id = _AL_STATE.analysisId;
  // Short hold so the user sees the all-green state before the page
  // transition. Long enough to register as "complete", short enough to
  // not feel laggy.
  setTimeout(() => {
    hideAnalysisLoadingView();
    // Suppress the work-view redirect when the analysis was halted by
    // a pre-agent blocking gate. The analysis_blocked SSE handler has
    // already swapped the user back to the upload view with the AI
    // notes pinned — navigating to /app?a=<id> would yank them off
    // that screen into a half-empty work view.
    if (window.__blockedRedirectPending) {
      _AL_STATE.active = false;
      return;
    }
    if (id) {
      window.location.assign(`/app?a=${encodeURIComponent(id)}`);
    } else {
      // No id (shouldn't happen — POST returns one) → fall back to dashboard.
      window.location.assign("/dashboard");
    }
  }, 900);
}
window.__alOnDone = _alOnDone;

// On stream error during loading: hide the loading view and surface the
// regular error card so the user can retry. Without this they'd be
// stuck staring at a "ready to navigate" screen that never advances.
function _alOnStreamError() {
  if (!_AL_STATE.active) return;
  hideAnalysisLoadingView();
  // Re-reveal the upload view so the retry button is reachable.
  const upload = document.getElementById("upload-view");
  if (upload) upload.hidden = false;
}
window.__alOnStreamError = _alOnStreamError;

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFieldErrors();
  hideStreamBanner();
  resetMissingData();
  // Clear the pre-analysis block banner — the user is starting a
  // fresh attempt and the prior round's blocking notes shouldn't
  // linger above the form once a new POST is in flight.
  _clearBlockedView();

  // Role branch — both roles now see the live analysis screen. The
  // difference is at the *end* of the analysis: reviewers get
  // approve/reject; submitters get "submit to reviewer" / "submit anyway"
  // (the action bar swap is handled in reviewer.js once status resolves).
  const __session = window.SAAuth && window.SAAuth.readSession && window.SAAuth.readSession();
  const __isSubmitter = !!(__session && __session.role === "submitter");

  // Reset every per-section panel and reveal the work view so the live SSE
  // can stream into it. Identical for both roles — the only role-specific
  // bit is which buttons appear in the review panel after `done` arrives.
  resetFeed();
  resetPdfSection();
  resetFloorSection();
  resetExtrasSection();
  resetSitePlanSection();
  resetAppSummarySection();
  drawingImg.removeAttribute("src");
  const drawingLoading = document.getElementById("drawing-loading");
  if (drawingLoading) drawingLoading.hidden = false;
  ["rb-identity-spinner", "rb-building-spinner", "rb-kpis-spinner", "rb-setbacks-spinner"].forEach((id) => {
    const sp = document.getElementById(id);
    if (sp) sp.hidden = false;
  });
  try { if (window.__reviewerBanner && window.__reviewerBanner.reset) window.__reviewerBanner.reset(); } catch {}
  uploadView.hidden = true;
  // workView is populated by SSE in the background but stays hidden — the
  // user only sees the loading view until `done` triggers a navigate to
  // /app?a=<id>. Suppressing the reveal here avoids a brief flash of the
  // raw work-view between this line and the showAnalysisLoadingView call
  // a few lines down.
  workView.hidden = true;
  errorCard.hidden = true;
  // Polished progress screen replaces the raw work-view during analysis.
  // For a new upload, `agent` is always true (CAD is required); doc flags
  // mirror what the user picked. expect drives which stages start as
  // "active" (with a spinner) vs. "done" (carried-forward, green check).
  showAnalysisLoadingView({
    expect: {
      agent:     true,
      deed:      !!selectedPdf,
      floor:     !!selectedFloor,
      site_plan: !!selectedSitePlan,
      extras:    (selectedExtras && selectedExtras.length) || 0,
    },
  });
  if (resultPlaceholder) resultPlaceholder.hidden = false;
  if (resultContent) resultContent.hidden = true;
  if (resultSub) setI18n(resultSub, "result.waiting");
  setI18n(statusTitle, selectedFile ? "status.uploading" : "status.uploading_docs");
  statusSpinner.style.display = "";
  statusFile.textContent = [
    selectedFile     ? `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB` : null,
    selectedPdf      ? selectedPdf.name      : null,
    selectedFloor    ? selectedFloor.name    : null,
    selectedSitePlan ? selectedSitePlan.name : null,
    (selectedExtras && selectedExtras.length) ? `${selectedExtras.length} extras` : null,
  ].filter(Boolean).join(" + ");
  newUploadBtn.hidden = true;
  analyzeBtn.disabled = true;
  appendSystemMsg(t("sys.uploading", { name: [
    selectedFile?.name, selectedPdf?.name, selectedFloor?.name, selectedSitePlan?.name,
    ...(selectedExtras || []).map((f) => f.name),
  ].filter(Boolean).join(" + ") }));

  let jobId;
  try {
    const fd = new FormData();
    if (selectedFile)        fd.append("file", selectedFile);
    if (selectedPdf)         fd.append("pdf_deed", selectedPdf);
    if (selectedFloor)       fd.append("pdf_floor", selectedFloor);
    if (selectedSitePlan)    fd.append("pdf_site_plan", selectedSitePlan);
    if (selectedMeasurement) fd.append("pdf_measurement", selectedMeasurement);
    // Multi-file: append each extra PDF under the same `pdf_extras` field
    // name; FastAPI's `list[UploadFile]` collects them into a list.
    for (const f of (selectedExtras || [])) {
      fd.append("pdf_extras", f);
    }
    const res = await fetch("/api/jobs", { method: "POST", body: fd });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      if (res.status === 422 && body && body.errors && typeof body.errors === "object") {
        // Back to the upload form; keep selected files so the user can
        // just swap the problem file instead of re-picking everything.
        hideAnalysisLoadingView();
        workView.hidden = true;
        uploadView.hidden = false;
        setI18n(statusTitle, "status.analyzing");
        statusSpinner.style.display = "";
        analyzeBtn.disabled = false;
        renderFieldErrors(body.errors);
        return;
      }
      const detail = body && body.detail != null
        ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail))
        : (body ? JSON.stringify(body).slice(0, 400) : "");
      throw new Error(`Upload failed: HTTP ${res.status}${detail ? " — " + detail.slice(0, 400) : ""}`);
    }
    const j = await res.json();
    jobId = j.job_id;
    // Stash the analysis_id so the submitter action bar can POST
    // /api/analyses/{id}/submit when the user clicks "Submit to reviewer".
    window.__lastSubmittedAnalysisId = j.analysis_id || "";
    // Lock the loading-view's destination — _alOnDone navigates to
    // /app?a=<this id> when the SSE `done` event lands.
    _alSetAnalysisId(j.analysis_id || "");
    if (window.__reviewerBanner && j.analysis_id) {
      // Pre-seed the banner's applicationId; reviewer.js normally fills this
      // by polling the latest analysis after `done`, but for submitters we
      // already know the exact id from the POST response.
      try { window.__reviewerBanner.setApplicationId && window.__reviewerBanner.setApplicationId(j.analysis_id); } catch {}
    }
    appendSystemMsg(t(j.has_pdf ? "sys.uploaded.with_pdf" : "sys.uploaded", { id: jobId }));
    setI18n(statusTitle, selectedFile ? "status.analyzing" : "status.analyzing_docs");
    if (selectedPdf)      showPdfPending();
    if (selectedFloor)    showFloorPending();
    if (selectedSitePlan) showSitePlanPending();
    if (selectedExtras && selectedExtras.length) showExtrasPending(selectedExtras);
  } catch (err) {
    hideAnalysisLoadingView();
    showError(err.message);
    return;
  }

  const es = new EventSource(`/api/jobs/${jobId}/events`);
  currentEventSource = es;
  attachEventStream(es);
});

/* ============================================================
   Shared event handlers — used by BOTH the live SSE stream and
   the history-replay path. Each handler takes the parsed payload
   object directly (not a MessageEvent), so replay can call them
   without a real EventSource.
   ============================================================ */

const EVENT_HANDLERS = {
  agent_start: (d) => {
    appendSystemMsg(t("sys.model_engaged", { model: d.model }));
  },
  mcp_ready: () => {
    appendSystemMsg(t("sys.connected"));
  },
  turn_start: (d) => {
    turnPill.hidden = false;
    turnCountEl.textContent = String(d.turn);
  },
  assistant_text: (d) => {
    appendReasoningDelta(d.delta);
  },
  tool_start: (d) => {
    let input = d.input;
    if (typeof input === "string") { try { input = JSON.parse(input); } catch {} }
    appendStep(d.name, input || {}, d.id);
  },
  tool_end: (d) => {
    // Prefer the full `details` object if the backend sent one; fall back to parsing `summary` for older clients/events.
    const raw = (d.details && typeof d.details === "object") ? d.details : {};
    if (!Object.keys(raw).length && typeof d.summary === "string") {
      d.summary.split("|").forEach(part => {
        const m = part.trim().match(/^([a-z_]+)=(.+)$/);
        if (m) {
          const v = m[2].trim();
          raw[m[1]] = isNaN(Number(v)) ? v : Number(v);
        }
      });
    }
    // Pass d.name so completeStep can fall back to FIFO-by-name matching for
    // legacy events that don't carry an id; pass d.id so the new path matches
    // exactly even when multiple parallel tools share a name.
    completeStep(d.name || "", d.summary, raw, d.details || null, d.id);
  },
  turn_usage: (d) => {
    parseTokenSummary(d);
  },
  final: (d) => {
    // If an error banner already fired (e.g. site-plan rejected, geometry
    // ValueError), ignore this late `final`. Otherwise the agent's partial
    // result would overwrite the error state with phantom KPIs.
    if (__streamErrored) return;
    // Populate the reviewer banner FIRST — showResultPane below still touches
    // some legacy DOM nodes (Zone 1 coverage/penalty widgets, side-n/s/e/w)
    // that were removed in the redesigned layout. If showResultPane throws on
    // those null refs, the banner update must already have landed by then,
    // otherwise history-replay ends up with blank KPIs and setbacks.
    try { if (window.__reviewerBanner) { window.__reviewerBanner.applyCad(d); window.__reviewerBanner.showBanner(); } } catch (err) { console.error("banner applyCad", err); }
    try { showResultPane(d); } catch (err) { console.error("showResultPane", err); }
    // Compliance KPI tile — populated from the `compliance` block on the CAD
    // final result. The required-setbacks tile was already populated by the
    // earlier site_plan_done event; this only hides/colors the fine tile.
    try { applyComplianceToBanner(d && d.compliance); } catch (err) { console.error("compliance banner", err); }
  },
  // PDF pipeline (independent of CAD)
  pdf_start: () => {
    showPdfPending();
    appendSystemMsg(t("sys.pdf_started"));
  },
  pdf_done: (d) => {
    renderPdfContent(d || {});
    appendSystemMsg(t("sys.pdf_complete"));
    try { if (window.__reviewerBanner) { window.__reviewerBanner.applyPdf(d || {}); window.__reviewerBanner.showBanner(); } } catch {}
  },
  pdf_error: (d) => {
    renderPdfError((d && d.message) || t("pdf.failed"));
    appendSystemMsg(t("sys.pdf_failed"));
  },
  // Floor-area plan pipeline (independent of CAD)
  floor_start: () => {
    showFloorPending();
    appendSystemMsg(t("sys.floor_started"));
  },
  floor_done: (d) => {
    renderFloorContent(d || {});
    appendSystemMsg(t("sys.floor_complete"));
    try { if (window.__reviewerBanner) { window.__reviewerBanner.applyFloor(d || {}); window.__reviewerBanner.showBanner(); } } catch {}
  },
  floor_error: (d) => {
    renderFloorError((d && d.message) || t("floor.failed"));
    appendSystemMsg(t("sys.floor_failed"));
  },
  // Additional PDFs — one event per uploaded file, keyed by index.
  extra_start: (d) => {
    markExtraPending(d.index, d.filename);
    appendSystemMsg(t("sys.extra_started", { name: d.filename || "" }));
  },
  extra_done: (d) => {
    renderExtraCard(d.index, d.filename, d);
    appendSystemMsg(t("sys.extra_complete", { name: d.filename || "" }));
  },
  extra_error: (d) => {
    renderExtraError(d.index, d.filename, (d && d.message) || t("extras.failed"));
    appendSystemMsg(t("sys.extra_failed", { name: d.filename || "" }));
  },
  // Regulatory site plan (مخطط موقع تنظيمي) — independent extractor that
  // feeds the compliance pipeline. The CAD agent's `compute_compliance` tool
  // result determines the fine; this event just lights up the required-
  // setbacks tile and the site-plan card.
  site_plan_start: () => {
    showSitePlanPending();
    appendSystemMsg(t("sys.site_plan_started"));
  },
  site_plan_done: (d) => {
    renderSitePlanContent(d || {});
    appendSystemMsg(t("sys.site_plan_complete"));
  },
  site_plan_error: (d) => {
    // The categorization is in payload.category — `kind` is stripped by
    // the SSE serializer (it's reserved for the event name). Older
    // archives might still carry `d.kind`, so fall back for back-compat.
    renderSitePlanError(
      (d && (d.reason || d.message)) || t("site_plan.failed"),
      d && (d.category || d.kind),
    );
    appendSystemMsg(t("sys.site_plan_failed"));
  },
  missing_data: (d) => {
    // A pipeline stage found a content issue (missing CAD layer, wrong
    // site-plan, unreadable setbacks, etc). Append it to the review-panel
    // table and flip the action bar into needs-revision mode.
    addMissingDataRow(d || {});
  },
  agent_skipped: () => {
    // Emitted by agent.py when geometry can't run (e.g. BUILDING/LOT
    // missing from the drawing). Side pipelines keep streaming; the table
    // rows that explain why are delivered via `missing_data` events.
  },
  analysis_blocked: (d) => {
    // Emitted by agent.py when a pre-agent gate fails (missing required
    // CAD layer, or the deed and site-plan describe different lots).
    // The agent loop is skipped entirely. Bounce the submitter back to
    // the upload screen with the blocking AI notes pinned at the top —
    // they fix the documents and re-upload (no inline edit-files form,
    // no chart/KPIs to look at, just a clean restart prompt).
    window.__blockingIssuesPresent = true;
    if (d && d.reason) window.__blockedReason = d.reason;
    _applyBlockedView();
    const blockingRows = __missingData.rows.filter((r) => r.blocking);
    showUploadViewBlocked(blockingRows, d && d.reason);
  },
  error: (d) => {
    // Pipeline-time error (geometry.py, site-plan rejected, agent crash).
    // Show the Arabic banner in the work view instead of the full-page
    // error card — the reviewer can still see which side pipelines succeeded.
    showStreamBanner((d && d.message) || "Stream error");
  },
  done: () => {
    closeReasoning();
    markAnalysisDone();
  },
};

function attachEventStream(es) {
  // Race-safety: every stream is stamped with the analysis generation
  // it was opened under (see reviewer.js's PatchedEventSource and
  // attachLiveResubmitStream). If a partial-resubmit bumps the counter
  // mid-flight, late events from this prior stream are dropped before
  // they reach a handler so they can't poison the new panel state.
  function _isCurrentGen() {
    return typeof window.__analysisGen !== "number"
        || typeof es.__gen !== "number"
        || es.__gen === window.__analysisGen;
  }
  for (const name of Object.keys(EVENT_HANDLERS)) {
    if (name === "done") continue;  // wired separately so we can also close the stream
    es.addEventListener(name, (e) => {
      if (!_isCurrentGen()) return;
      let d = {};
      try { d = JSON.parse(e.data) || {}; } catch {}
      try { EVENT_HANDLERS[name](d); } catch (err) { console.error(name, err); }
      // Mirror to the loading-view stage tracker. No-op when the loading
      // view is inactive (history replay, archived analysis open, etc.).
      try { _alOnEvent(name, d); } catch (err) { console.error("al-" + name, err); }
    });
  }
  es.addEventListener("done", () => {
    if (!_isCurrentGen()) { es.close(); return; }
    try { EVENT_HANDLERS.done({}); } catch (err) { console.error("done", err); }
    es.close();
    if (currentEventSource === es) currentEventSource = null;
    // Loading-view: mark every stage done, hold for a brief beat so the
    // all-green state registers, then navigate to /app?a=<id>. No-op when
    // the loading view is inactive.
    try { _alOnDone(); } catch (err) { console.error("al-done", err); }
  });
  // Connection error handler. Without this, EventSource silently retries
  // forever on a dropped network — the user sees a frozen "Streaming…"
  // UI with no failure signal. We close the stream explicitly and surface
  // an error banner so the user can choose to restart instead of waiting.
  // The browser only fires `error` for genuinely terminal failures once
  // we close it; transient reconnect blips don't reach this path.
  es.addEventListener("error", (ev) => {
    // EventSource.readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED.
    const rs = es.readyState;
    if (rs === 2) {
      // Already closed — nothing more to do.
      return;
    }
    // If we're mid-stream and not just connecting for the first time,
    // treat this as a real failure: stop reconnect attempts and tell
    // the user. Connecting blips before the first event arrives are
    // ignored — the browser handles those.
    if (rs === EventSource.OPEN || rs === 1) {
      try { es.close(); } catch {}
      if (currentEventSource === es) currentEventSource = null;
      try {
        showStreamBanner("انقطع الاتصال أثناء التحليل — يرجى إعادة المحاولة.");
      } catch (err) {
        console.error("stream-error-banner", err);
      }
      // Drop the loading view too so the user isn't stuck on a screen
      // that will never reach `done`. The stream banner above tells them
      // to retry; without this they'd see only the loading animation.
      try { _alOnStreamError(); } catch (err) { console.error("al-stream-error", err); }
    }
  });
}

// Exposed so reviewer.js's inline partial-resubmit handler can attach the
// new pipeline's SSE stream without leaving the page. The handler also
// needs the per-section reset + show-pending helpers so it can reset ONLY
// the slots being re-run while leaving the carried-over slots untouched.
window.attachEventStream = attachEventStream;
window.__appHelpers = {
  resetFeed,
  resetMissingData,
  resetPdfSection, showPdfPending,
  resetFloorSection, showFloorPending,
  resetSitePlanSection, showSitePlanPending,
  resetExtrasSection,
  resetAppSummarySection,
  setStreamingStatus(filename) {
    setI18n(statusTitle, "status.analyzing");
    statusSpinner.style.display = "";
    if (filename) statusFile.textContent = filename;
    newUploadBtn.hidden = true;
    if (resultPlaceholder) resultPlaceholder.hidden = false;
    // Do NOT hide #result-content — the carried-over sections live there
    // and must stay visible so the user keeps seeing them.
  },
};

function replayEvents(events) {
  for (const ev of events || []) {
    const fn = EVENT_HANDLERS[ev.kind];
    if (!fn) continue;
    try { fn(ev); } catch (err) { console.error("replay", ev.kind, err); }
  }
}

/* ============================================================
   Language toggle wiring + initial application
   ============================================================ */
const langToggle = document.getElementById("lang-toggle");
if (langToggle) {
  langToggle.addEventListener("click", () => {
    applyLanguage(currentLang === "ar" ? "en" : "ar");
  });
}
// Apply saved language on initial load (runs after all elements are in the DOM)
applyLanguage(currentLang);

/* ============================================================
   History panel — list, replay, delete saved analyses
   ============================================================ */

const historyToggleBtn = document.getElementById("history-toggle");
const historyPanel     = document.getElementById("history-panel");
const historyBackdrop  = document.getElementById("history-backdrop");
const historyCloseBtn  = document.getElementById("history-close");
const historyListEl    = document.getElementById("history-list");
const historyEmptyEl   = document.getElementById("history-empty");
const historyCountEl   = document.getElementById("history-count");

let cachedHistory = [];

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(currentLang === "ar" ? "ar" : "en", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtBytes(n) {
  if (typeof n !== "number" || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderHistoryList(items) {
  historyListEl.innerHTML = "";
  cachedHistory = items || [];
  if (!cachedHistory.length) {
    historyEmptyEl.hidden = false;
    historyCountEl.hidden = true;
    return;
  }
  historyEmptyEl.hidden = true;
  historyCountEl.hidden = false;
  historyCountEl.textContent = String(cachedHistory.length);

  for (const item of cachedHistory) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.dataset.id = item.id;

    const isError = item.status === "error" || !!item.error;
    const filename = item.filename === "(no CAD)" ? t("history.no_cad") : item.filename;
    const badges = [];
    badges.push(`<span class="history-item-badge ${isError ? "error" : "done"}">${isError ? t("step.status.error") : t("step.status.done")}</span>`);
    if (item.has_pdf)   badges.push(`<span class="history-item-badge pdf">سند</span>`);
    if (item.has_floor) badges.push(`<span class="history-item-badge floor">طابقية</span>`);

    row.innerHTML = `
      <div class="history-item-main">
        <div class="history-item-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
        <div class="history-item-meta">
          ${badges.join("")}
          <span>${escapeHtml(fmtTimestamp(item.finished_at || item.created_at))}</span>
          <span>${escapeHtml(fmtBytes(item.size))}</span>
        </div>
      </div>
      <button class="history-item-delete" type="button" aria-label="Delete">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>
        </svg>
      </button>
    `;

    row.addEventListener("click", (e) => {
      if (e.target.closest(".history-item-delete")) return;
      loadSavedAnalysis(item.id);
    });
    row.querySelector(".history-item-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSavedAnalysis(item.id);
    });

    historyListEl.appendChild(row);
  }
}

async function refreshHistory() {
  try {
    const res = await fetch("/api/analyses");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    renderHistoryList(j.items || []);
  } catch (err) {
    historyListEl.innerHTML = `<div class="history-empty">${escapeHtml(t("history.failed"))} (${escapeHtml(err.message)})</div>`;
    historyEmptyEl.hidden = true;
  }
}

function openHistoryPanel() {
  historyPanel.hidden = false;
  historyPanel.setAttribute("aria-hidden", "false");
  historyBackdrop.hidden = false;
  refreshHistory();
}

function closeHistoryPanel() {
  historyPanel.hidden = true;
  historyPanel.setAttribute("aria-hidden", "true");
  historyBackdrop.hidden = true;
}

if (historyToggleBtn) historyToggleBtn.addEventListener("click", openHistoryPanel);
if (historyCloseBtn)  historyCloseBtn.addEventListener("click", closeHistoryPanel);
if (historyBackdrop)  historyBackdrop.addEventListener("click", closeHistoryPanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && historyPanel && !historyPanel.hidden) closeHistoryPanel();
});

async function loadSavedAnalysis(id) {
  // Tear down any in-flight live stream and reset every UI region.
  if (currentEventSource) { try { currentEventSource.close(); } catch {} currentEventSource = null; }
  resetFeed();
  resetPdfSection();
  resetFloorSection();
  resetExtrasSection();
  resetSitePlanSection();
  resetAppSummarySection();
  // Reset the chart area so the spinner shows again until the new PNG arrives.
  drawingImg.removeAttribute("src");
  const drawingLoading = document.getElementById("drawing-loading");
  if (drawingLoading) drawingLoading.hidden = false;
  // Re-show each banner section spinner — they hide as their data lands.
  ["rb-identity-spinner", "rb-building-spinner", "rb-kpis-spinner", "rb-setbacks-spinner"].forEach((id) => {
    const sp = document.getElementById(id);
    if (sp) sp.hidden = false;
  });
  // Clear CAD / floor-plan tiles (KPIs, setbacks, num_floors, penalty) so the
  // previous run's numbers don't leak into the new one while it's streaming.
  try { if (window.__reviewerBanner && window.__reviewerBanner.reset) window.__reviewerBanner.reset(); } catch {}
  uploadView.hidden = true;
  workView.hidden = false;
  errorCard.hidden = true;
  if (resultPlaceholder) resultPlaceholder.hidden = false;
  if (resultContent) resultContent.hidden = true;
  if (resultSub) setI18n(resultSub, "result.waiting");
  setI18n(statusTitle, "status.analyzing");
  statusSpinner.style.display = "";
  newUploadBtn.hidden = true;
  analyzeBtn.disabled = true;

  let record;
  let eventsPayload;
  try {
    // The detail endpoint excludes `events` by default — fetch them in
    // parallel from the dedicated sub-endpoint to keep the main payload
    // small on long agent runs (some events log to tens of MB).
    const [recRes, evRes] = await Promise.all([
      fetch(`/api/analyses/${encodeURIComponent(id)}`),
      fetch(`/api/analyses/${encodeURIComponent(id)}/events`),
    ]);
    if (!recRes.ok) throw new Error(`HTTP ${recRes.status}`);
    record = await recRes.json();
    if (evRes.ok) {
      eventsPayload = await evRes.json();
    }
  } catch (err) {
    showError(`${t("history.load_failed")} (${err.message})`);
    return;
  }

  closeHistoryPanel();

  // Header info — filename and "loaded from history" badge in the feed
  const displayName = record.filename === "(no CAD)" ? t("history.no_cad") : (record.filename || "—");
  statusFile.textContent = displayName;

  const banner = document.createElement("div");
  banner.className = "replay-banner";
  banner.innerHTML = `
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 1.5"/>
    </svg>
    <span>${escapeHtml(t("history.replay_banner", { name: displayName }))}</span>
  `;
  feedEl.appendChild(banner);

  // Flip the live-thinking pane into archive mode so the pulse label reads
  // "ARCHIVE" instead of "STREAMING" and CSS can dim the "live" chrome.
  document.body.classList.add("is-archive");
  const pulseLabel = document.querySelector(".pane-pulse-label");
  if (pulseLabel) {
    pulseLabel.removeAttribute("data-i18n");
    pulseLabel.textContent = "Archive";
  }

  // Show pending placeholders for any side pipelines that ran, so the UI
  // updates correctly when their `*_done` events get replayed.
  if (record.pdf_expected)        showPdfPending();
  if (record.floor_expected)      showFloorPending();
  if (record.site_plan_expected)  showSitePlanPending();

  // Suppress the cascade of live-only "Uploading…/Connected" bubbles that
  // the replay would otherwise re-append to the feed. Tool cards and
  // reasoning blocks still render — only the system-message noise is muted.
  isReplayingArchive = true;
  try {
    // Events come from the dedicated sub-endpoint when available, with a
    // fallback to record.events for back-compat with older saved files
    // or clients that opted into ?include_events=true on the detail call.
    const eventsToReplay = (eventsPayload && Array.isArray(eventsPayload.events))
      ? eventsPayload.events
      : (record.events || []);
    replayEvents(eventsToReplay);
  } finally {
    isReplayingArchive = false;
  }
  // Reviewer comments live on the persisted missing_data rows, not on
  // the SSE event log (they're added via PATCH /meta after the fact),
  // so replayEvents alone won't restore them. Overlay from the record.
  overlayMissingDataComments(record.missing_data || []);

  // Measurement viewer launcher — same pattern as autoLoadFromQuery.
  if (typeof window.__configureMeasurementViewer === "function") {
    try { window.__configureMeasurementViewer(id, record.meta || {}); } catch {}
  }
}

function overlayMissingDataComments(persistedRows) {
  if (!Array.isArray(persistedRows) || persistedRows.length === 0) return;
  const byKey = {};
  for (const r of persistedRows) {
    if (r && r.key && r.reviewer_comment) byKey[r.key] = r.reviewer_comment;
  }
  let changed = false;
  for (const r of __missingData.rows) {
    if (r.key && byKey[r.key] && !r.reviewer_comment) {
      r.reviewer_comment = byKey[r.key];
      changed = true;
    }
  }
  if (changed) renderIssuesPanel();
}
// Exposed so reviewer.js's autoLoadFromQuery can apply the same overlay
// after its own replay path finishes — that flow doesn't go through
// loadSavedAnalysis, so it would otherwise leave the comment column
// blank on a re-open from the dashboard.
window.overlayMissingDataComments = overlayMissingDataComments;

async function deleteSavedAnalysis(id) {
  if (!confirm(t("history.delete_confirm"))) return;
  try {
    const res = await fetch(`/api/analyses/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    alert(`${t("history.delete_failed")} (${err.message})`);
    return;
  }
  refreshHistory();
}
