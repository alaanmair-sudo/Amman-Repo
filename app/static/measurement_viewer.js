// =====================================================================
// Measurement viewer · in-browser PDF.js viewer with a custom measure
// tool. Opens when the submitter attached the OPTIONAL 5th file ("PDF
// القياس") and clicks the "فتح أداة القياس" button on the post-analysis
// reviewer banner.
//
// Flow:
//   1. autoLoadFromQuery / loadSavedAnalysis call
//      window.__configureMeasurementViewer(analysisId, meta).
//   2. If meta.file_paths.pdf_measurement exists, the launcher button is
//      revealed and clicking it calls openViewer(url, filename).
//   3. The modal mounts, fetches the PDF via PDF.js, renders the current
//      page to a canvas, and an overlay canvas captures clicks for the
//      measure tool. First measurement triggers calibration: user clicks
//      two points of a known length and types its real value (e.g. 5 m),
//      establishing a PDF-units → meters scale that powers every later
//      measurement.
//
// The viewer is intentionally self-contained — no external DOM
// dependencies beyond the markup added at the bottom of index.html. It
// uses window.pdfjsLib loaded via the legacy UMD build at
// /static/lib/pdfjs/pdf.min.js.
// =====================================================================

(function () {
  "use strict";

  // ───────── DOM handles ─────────
  const modalEl       = document.getElementById("mv-modal");
  const closeBtnEl    = document.getElementById("mv-close");
  const filenameEl    = document.getElementById("mv-filename");
  const stageEl       = document.getElementById("mv-stage");
  const wrapEl        = document.getElementById("mv-canvas-wrap");
  const canvasEl      = document.getElementById("mv-canvas");
  const overlayEl     = document.getElementById("mv-overlay");
  const emptyEl       = document.getElementById("mv-empty");
  const prevBtn       = document.getElementById("mv-prev");
  const nextBtn       = document.getElementById("mv-next");
  const pageEl        = document.getElementById("mv-page");
  const zoomInBtn     = document.getElementById("mv-zoom-in");
  const zoomOutBtn    = document.getElementById("mv-zoom-out");
  const fitBtn        = document.getElementById("mv-fit");
  const zoomEl        = document.getElementById("mv-zoom");
  const toolPanBtn    = document.getElementById("mv-tool-pan");
  const toolMeasBtn   = document.getElementById("mv-tool-measure");
  const toolAreaBtn   = document.getElementById("mv-tool-area");
  const toolCalBtn    = document.getElementById("mv-tool-calibrate");
  const toolSlopeBtn  = document.getElementById("mv-tool-slope");
  const undoBtn       = document.getElementById("mv-undo");
  const clearBtn      = document.getElementById("mv-clear");
  const launcherBtn   = document.getElementById("rb-measure-btn");
  const statusMsgEl   = document.getElementById("mv-status-msg");
  const statusScaleEl = document.getElementById("mv-status-scale");
  const scaleTextEl   = document.getElementById("mv-scale-text");
  // Inline calibrate prompt (lives inside the status bar)
  const calInlineEl       = document.getElementById("mv-cal-inline");
  const calPickedInlineEl = document.getElementById("mv-cal-picked-inline");
  const calInputEl        = document.getElementById("mv-cal-input");
  const calUnitEl         = document.getElementById("mv-cal-unit");
  const calConfirmBtn     = document.getElementById("mv-cal-confirm");
  const calCancelBtn      = document.getElementById("mv-cal-cancel");
  // (Slope tool no longer needs an inline prompt — Δh and length are
  // derived from the two picked points using the calibrated scale.)

  if (!modalEl || !canvasEl || !overlayEl) {
    // Markup absent (e.g. dashboard page) — do nothing.
    return;
  }

  // ───────── Default scale ─────────
  // Empirically calibrated against the office's typical PDFs (plotted via
  // pdfFactory Pro at "Super B" 19×13" paper, effective ~1:357 scale —
  // NOT the 1:200 the AutoCAD plot dialog reports). The "theoretical"
  // factor for a clean 1:200 vector plot would be 14.17, but pdfFactory
  // silently rescales the print job to fit its configured paper, which
  // gives the smaller effective factor below. If your office switches
  // plotters or paper presets, recalibrate once and update this constant.
  const DEFAULT_PDF_UNITS_PER_METER = 7.93;

  // PDF user-space unit = 1/72 inch (PDF spec § 8.3.2.3). The diagnostic
  // logger below also computes a "theoretical" factor at a known plot
  // scale just so we can spot when a PDF is wildly off-pattern.
  const PDF_UNITS_PER_METER_AT_1_TO_1 = (1000 * 72) / 25.4;

  // ISO 216 A-series + ANSI/Arch papers (short × long, in mm). Used purely
  // for diagnostic logging.
  const KNOWN_PAPERS = {
    "A0":      [841, 1189],
    "A1":      [594, 841],
    "A2":      [420, 594],
    "A3":      [297, 420],
    "A4":      [210, 297],
    "A5":      [148, 210],
    "Letter":  [216, 279],
    "Legal":   [216, 356],
    "Tabloid": [279, 432],
    "Super B": [330, 483],   // 19×13"  — what pdfFactory commonly defaults to
    "Arch B":  [305, 457],
    "Arch C":  [457, 610],
    "Arch D":  [610, 914],
    "Arch E":  [914, 1219],
  };

  function detectPaper(widthMm, heightMm) {
    const tol = 5;
    for (const name of Object.keys(KNOWN_PAPERS)) {
      const a = KNOWN_PAPERS[name][0];
      const b = KNOWN_PAPERS[name][1];
      const portrait  = Math.abs(widthMm - a) < tol && Math.abs(heightMm - b) < tol;
      const landscape = Math.abs(widthMm - b) < tol && Math.abs(heightMm - a) < tol;
      if (portrait)  return name + " portrait";
      if (landscape) return name + " landscape";
    }
    return null;
  }

  // Diagnostic-only: log everything we know about the PDF page so future
  // off-scale measurements can be debugged from the browser console.
  function logPageDiagnostics(viewportAtScale1, factor) {
    const widthMm  = (viewportAtScale1.width  * 25.4) / 72;
    const heightMm = (viewportAtScale1.height * 25.4) / 72;
    const paper = detectPaper(widthMm, heightMm);
    const impliedPlotScale = (PDF_UNITS_PER_METER_AT_1_TO_1 / factor).toFixed(1);
    console.log(
      `[mv] PDF page: ${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm` +
      (paper ? ` (${paper})` : " (non-standard)") +
      ` · using factor ${factor.toFixed(4)} PDF/m · implies plot ~1:${impliedPlotScale}`
    );
  }

  // ───────── Per-document state ─────────
  // Reset to these defaults every time a new PDF is opened.
  let pdfDoc       = null;
  let pageNum      = 1;
  let pageCount    = 1;
  let scale        = 1.0;          // CSS-px per PDF unit (zoom level)
  let baseScale    = 1.0;          // "fit window" scale captured on load
  let mode         = "measure";    // "pan" | "measure" | "area" | "calibrate" | "slope"
  let measurements = [];           // [{ p1, p2, text, page }]
  // Calibration: (PDF units → meters). Initialised to the office default
  // (empirically known-good for the typical pdfFactory pipeline). The
  // Calibrate tool overrides per-PDF and the override persists in
  // sessionStorage so re-opening the same document keeps the override.
  let pdfUnitsPerMeter = DEFAULT_PDF_UNITS_PER_METER;
  let currentDocKey = "";
  // In-flight measurement / calibration buffer (first click pending second)
  let pendingFirst = null;
  // In-flight polygon for area mode (vertices in PDF coords).
  let currentPolygon = [];
  // Cursor state (for live preview line + orthogonal hint while picking 2nd point)
  let cursorPos = null;       // current cursor in PDF coords (null if outside)
  let shiftHeld = false;      // Shift = orthogonal constraint during measure
  // Hover state: index in `measurements` of the segment/polygon under the
  // cursor (or -1 if none). Drives the per-measurement × delete badge.
  let hoveredMeasurement = -1;
  // Click-target boxes for the per-measurement × badges, recomputed on
  // every overlay redraw. Coords are CSS pixels relative to the canvas.
  let deleteBadges = [];      // [{idx, x, y, r}]
  // Pan state
  let panState = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, button: 0 };
  // Spacebar-temporary pan: while held, the previous mode AND in-flight
  // measurement state (pendingFirst / currentPolygon) are stashed and
  // restored on keyup. Without this the user couldn't pan to find their
  // second click — entering pan mode clears the buffer.
  let spacePanState = {
    active: false,
    priorMode: "measure",
    priorPendingFirst: null,
    priorPolygon: [],
  };
  // Render task tracking — pdf.js renders are async and can be cancelled.
  // We cancel any in-flight render before starting a new one (zoom races)
  // and use a monotonic seq counter to discard "stale" render results
  // that finished after a newer render had already started.
  let currentRenderTask = null;
  let renderSeq = 0;
  // Snap targets harvested from each page's PDF vector content. Keyed by
  // pageNum → array of {x, y} in our canvas-style coords (Y down, in PDF
  // unit magnitudes — same space clientToPdf returns). Populated lazily
  // after each page's first render so cursor snap finds line endpoints
  // drawn into the PDF, not just endpoints of existing measurements.
  // Empty / missing entry just means "snap not yet ready for this page"
  // — findSnapPoint silently falls back to measurement-only snapping.
  const pdfEndpointsByPage = {};
  // Monotonic so the async extractor can drop stale results when the
  // document changes mid-extraction.
  let endpointsExtractGen = 0;
  // Endpoint drag state. mouseDownInfo records a candidate endpoint
  // grabbed on mousedown; if the cursor moves enough before mouseup,
  // dragState.active flips to true and we move the endpoint with the
  // cursor. If the user just clicked (no movement), the regular click
  // handler takes over instead — preserving "click-to-place" UX.
  let dragState = { active: false, measurementIdx: -1, endpointIdx: -1 };
  let mouseDownInfo = null;
  let suppressNextClick = false;
  const DRAG_THRESHOLD_PX = 4;
  // rAF-throttled overlay redraw flag — set by anything that wants a redraw,
  // cleared in the rAF callback. Keeps mousemove cheap on big PDFs.
  let overlayDirty = false;
  function requestOverlayDraw() {
    if (overlayDirty) return;
    overlayDirty = true;
    requestAnimationFrame(() => { overlayDirty = false; drawOverlay(); });
  }

  // ───────── Tiny helpers ─────────
  function setStatus(msg) {
    if (statusMsgEl) statusMsgEl.textContent = msg;
  }
  function setScaleBadge() {
    if (!statusScaleEl || !scaleTextEl) return;
    if (pdfUnitsPerMeter && pdfUnitsPerMeter > 0) {
      // Show a friendly "1 cm = X m" hint plus the raw factor.
      scaleTextEl.textContent = `${pdfUnitsPerMeter.toFixed(2)} وحدة PDF / متر`;
      statusScaleEl.hidden = false;
    } else {
      scaleTextEl.textContent = "—";
      statusScaleEl.hidden = true;
    }
  }
  function setMode(next) {
    mode = next;
    pendingFirst = null;
    currentPolygon = [];
    cursorPos = null;
    [toolPanBtn, toolMeasBtn, toolAreaBtn, toolCalBtn, toolSlopeBtn].forEach((b) => b && b.classList.remove("is-active"));
    if (next === "pan"       && toolPanBtn)   toolPanBtn.classList.add("is-active");
    if (next === "measure"   && toolMeasBtn)  toolMeasBtn.classList.add("is-active");
    if (next === "area"      && toolAreaBtn)  toolAreaBtn.classList.add("is-active");
    if (next === "calibrate" && toolCalBtn)   toolCalBtn.classList.add("is-active");
    if (next === "slope"     && toolSlopeBtn) toolSlopeBtn.classList.add("is-active");
    overlayEl.classList.remove("mode-pan", "mode-measure", "mode-area", "mode-calibrate", "mode-slope");
    overlayEl.classList.add("mode-" + next);
    if (next === "pan") setStatus("اسحب لتحريك المستند. أو اضغط M للعودة إلى القياس.");
    else if (next === "measure") {
      if (pdfUnitsPerMeter) setStatus("انقر نقطتين لقياس المسافة الحقيقية. (Shift = أفقي/عمودي · مسافة مؤقّت = Space)");
      else setStatus("لم يتم تعيير المقياس بعد — انقر نقطتين على بُعد معروف ثم أدخِل القيمة.");
    } else if (next === "area") {
      setStatus("انقر رؤوس المضلَّع لقياس المساحة. أغلق بالنقر على النقطة الأولى أو Enter أو نقر مزدوج.");
    } else if (next === "calibrate") {
      setStatus("التعيير: انقر طرفي بُعد معروف على المخطط، ثم أدخِل قيمته الحقيقية.");
    } else if (next === "slope") {
      if (pdfUnitsPerMeter) setStatus("انقر نقطتين على طرفي الخط (المقطع الجانبي) — يحسب الميل تلقائيًا من فرق الارتفاع ÷ طول الخط.");
      else setStatus("الميل يحتاج إلى تعيير أولًا — اضغط C لتعيير المقياس قبل قياس الميل.");
    }
    requestOverlayDraw();
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Lock a point to be horizontal or vertical from `anchor` — whichever
  // axis has the larger delta. Used when Shift is held during measurement.
  function applyOrthoConstraint(anchor, p) {
    if (!shiftHeld) return p;
    const dx = Math.abs(p.x - anchor.x);
    const dy = Math.abs(p.y - anchor.y);
    if (dx >= dy) return { x: p.x, y: anchor.y }; // horizontal
    return { x: anchor.x, y: p.y };               // vertical
  }

  // Update the prev/next button disabled state to match the page boundary.
  function refreshNavState() {
    if (prevBtn) prevBtn.disabled = (pageNum <= 1);
    if (nextBtn) nextBtn.disabled = (pageNum >= pageCount);
  }

  // Map a click on the overlay canvas (CSS px from the canvas's top-left)
  // into PDF coordinate space (units of the PDF page at scale=1). The two
  // canvases are positioned identically and sized to match each render, so
  // overlay click coords correspond 1:1 to canvas pixel coords ÷ DPR.
  function clientToPdf(evt) {
    const rect = canvasEl.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / scale;
    const y = (evt.clientY - rect.top)  / scale;
    return { x, y };
  }

  function distancePdf(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Format a measurement label. With calibration → meters/centimeters with
  // appropriate precision. Without calibration → raw PDF units (still
  // useful relatively, with a "(uncalibrated)" tag).
  function formatLength(units) {
    if (pdfUnitsPerMeter && pdfUnitsPerMeter > 0) {
      const meters = units / pdfUnitsPerMeter;
      if (meters >= 1)   return `${meters.toFixed(2)} م`;
      const cm = meters * 100;
      if (cm >= 1)       return `${cm.toFixed(1)} سم`;
      const mm = meters * 1000;
      return `${mm.toFixed(0)} مم`;
    }
    return `${units.toFixed(1)} وحدة (غير معاير)`;
  }

  // Slope label.
  //   slope = Δh ÷ length × 100
  // Δh is the height difference between p₁ and p₂ (positive means the
  // first point is higher — line falls from p₁ to p₂). Length must be
  // the calibrated horizontal distance in metres — slope mode refuses
  // to commit when uncalibrated, so this assumes meters.
  function formatSlope(dh, lengthMeters) {
    if (!Number.isFinite(dh) || !Number.isFinite(lengthMeters) || lengthMeters <= 0) return "—";
    const pct = (dh / lengthMeters) * 100;
    // One decimal is the right precision for civil grades (driveways,
    // ramps, road profiles). The sign carries the direction of fall.
    return `الميل: ${pct.toFixed(1)}%`;
  }

  // Shoelace formula — signed polygon area in PDF user units squared.
  // Vertices are PDF coordinates; absolute value cancels out winding order.
  function shoelaceArea(vertices) {
    if (!vertices || vertices.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      sum += vertices[i].x * vertices[j].y;
      sum -= vertices[j].x * vertices[i].y;
    }
    return Math.abs(sum) / 2;
  }

  // Polygon perimeter — sum of edge lengths. Used for the live status line
  // while the area polygon is being drawn.
  function polygonPerimeter(vertices) {
    if (!vertices || vertices.length < 2) return 0;
    let p = 0;
    for (let i = 0; i < vertices.length - 1; i++) {
      p += distancePdf(vertices[i], vertices[i + 1]);
    }
    return p;
  }

  // Centroid of a (possibly non-convex) polygon — used to anchor the area
  // label. Falls back to the bounding-box centre for degenerate cases.
  function polygonCentroid(vertices) {
    if (!vertices || vertices.length === 0) return { x: 0, y: 0 };
    let cx = 0, cy = 0, area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const cross = vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
      area += cross;
      cx += (vertices[i].x + vertices[j].x) * cross;
      cy += (vertices[i].y + vertices[j].y) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 1e-6) {
      // Degenerate — average vertices instead.
      const ax = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
      const ay = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
      return { x: ax, y: ay };
    }
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  // Format an area in calibrated units. Falls back to "PDF units²" when
  // the viewer hasn't been calibrated yet.
  function formatArea(unitsSquared) {
    if (pdfUnitsPerMeter && pdfUnitsPerMeter > 0) {
      const m2 = unitsSquared / (pdfUnitsPerMeter * pdfUnitsPerMeter);
      if (m2 >= 1)   return `${m2.toFixed(2)} م²`;
      const cm2 = m2 * 10000;
      if (cm2 >= 1)  return `${cm2.toFixed(1)} سم²`;
      const mm2 = m2 * 1000000;
      return `${mm2.toFixed(0)} مم²`;
    }
    return `${unitsSquared.toFixed(1)} وحدة² (غير معاير)`;
  }

  // Squared distance from a point P to the segment AB (in PDF units).
  // Returns the actual squared distance — caller compares against tol².
  function distSqPointToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) {
      // Degenerate segment → distance to endpoint.
      const ex = p.x - a.x, ey = p.y - a.y;
      return ex * ex + ey * ey;
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * dx, qy = a.y + t * dy;
    const ex = p.x - qx, ey = p.y - qy;
    return ex * ex + ey * ey;
  }

  // Find the nearest endpoint of any existing measurement to `rawPoint`,
  // within a snap tolerance. Returns the snap point + a reference to the
  // owner so callers can exclude self-endpoints during drag. Used both
  // when placing a new measurement (chain by endpoint) and while dragging
  // an existing one (snap-on-drop). Calibration kind has no draggable
  // endpoints — skipped.
  function findSnapPoint(rawPoint, excludeMeasurementIdx, excludeEndpointIdx) {
    if (!rawPoint) return null;
    const tolPdf = 12 / scale; // 12 CSS-px snap radius
    const tolPdfSq = tolPdf * tolPdf;
    let best = null;
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i];
      if (m.page !== pageNum) continue;
      if (m.kind === "calibrate") continue;
      const endpoints = (m.kind === "area") ? m.vertices : [m.p1, m.p2];
      for (let k = 0; k < endpoints.length; k++) {
        if (i === excludeMeasurementIdx && k === excludeEndpointIdx) continue;
        const v = endpoints[k];
        const dx = rawPoint.x - v.x;
        const dy = rawPoint.y - v.y;
        const d = dx * dx + dy * dy;
        if (d < tolPdfSq && (!best || d < best.distSq)) {
          best = { point: { x: v.x, y: v.y }, distSq: d, idx: i, endpointIdx: k };
        }
      }
    }
    // Vector-PDF endpoint snap. Same radius / "closest wins" rule as
    // measurement endpoints — measurement endpoints take precedence on a
    // strict tie because they're checked first; otherwise the nearest
    // wins. PDF endpoints carry no idx/endpointIdx (they aren't draggable).
    const pdfEndpoints = pdfEndpointsByPage[pageNum];
    if (pdfEndpoints && pdfEndpoints.length) {
      for (let i = 0; i < pdfEndpoints.length; i++) {
        const v = pdfEndpoints[i];
        const dx = rawPoint.x - v.x;
        const dy = rawPoint.y - v.y;
        const d = dx * dx + dy * dy;
        if (d < tolPdfSq && (!best || d < best.distSq)) {
          best = { point: { x: v.x, y: v.y }, distSq: d };
        }
      }
    }
    return best;
  }

  // ───────── PDF vector endpoint extraction ─────────
  // Walk a page's operator list to harvest path endpoints (moveTo, lineTo,
  // curveTo*, rectangle corners, constructPath sub-ops) and return them
  // in our canvas-style coords (Y down, in PDF unit magnitudes — same
  // space clientToPdf returns). Maintains a CTM stack so transformed
  // sub-blocks (cm operators) land in the right place.
  //
  // Why we extract once per page (not on every cursor move): the operator
  // list is large for CAD drawings (often tens of thousands of ops); a
  // cursor-time scan would jank every mousemove.
  function extractPdfEndpoints(operatorList, viewportNoZoom) {
    const OPS = window.pdfjsLib && window.pdfjsLib.OPS;
    if (!OPS || !operatorList || !operatorList.fnArray) return [];
    const fns = operatorList.fnArray;
    const args = operatorList.argsArray;
    // Initial CTM = the viewport's PDF-user-space → display-coords matrix.
    // PDF.js viewport.transform is exactly this, evaluated for the page's
    // current rotation and the scale=1 viewport (so output is in the same
    // coordinate magnitudes clientToPdf returns: 1 unit = 1 CSS-px at
    // 100% zoom). Y already increases downward in viewport space.
    const vt = viewportNoZoom && viewportNoZoom.transform;
    const initialCtm = (Array.isArray(vt) && vt.length === 6)
      ? vt.slice() : [1, 0, 0, 1, 0, 0];
    const ctmStack = [initialCtm];
    let ctm = ctmStack[0];
    let curX = 0, curY = 0;
    let subStartX = 0, subStartY = 0;
    // De-dupe identical endpoints — CAD PDFs draw lots of segments
    // ending on the same vertex (corners, intersections). Round to 0.01
    // PDF units before keying so floating-point noise doesn't defeat it.
    const seen = new Set();
    const out = [];
    function transform(x, y) {
      // [a c e]   [x]
      // [b d f] × [y]
      return {
        x: ctm[0] * x + ctm[2] * y + ctm[4],
        y: ctm[1] * x + ctm[3] * y + ctm[5],
      };
    }
    function push(userX, userY) {
      const p = transform(userX, userY);
      const key = (Math.round(p.x * 100) | 0) + "," + (Math.round(p.y * 100) | 0);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ x: p.x, y: p.y });
    }
    function concatMatrix(m) {
      // PDF spec § 8.3.4: new CTM = m × CTM
      const [ca, cb, cc, cd, ce, cf] = ctm;
      const [ma, mb, mc, md, me, mf] = m;
      ctm = [
        ma * ca + mb * cc,
        ma * cb + mb * cd,
        mc * ca + md * cc,
        mc * cb + md * cd,
        me * ca + mf * cc + ce,
        me * cb + mf * cd + cf,
      ];
      ctmStack[ctmStack.length - 1] = ctm;
    }
    // Modern PDF.js batches path operators into OPS.constructPath, with
    // a flat sub-args array. Older streams (and some constructPath args)
    // still use the individual op codes. We handle both.
    function handlePathOp(op, oArgs) {
      if (op === OPS.moveTo) {
        curX = oArgs[0]; curY = oArgs[1];
        subStartX = curX; subStartY = curY;
        push(curX, curY);
      } else if (op === OPS.lineTo) {
        curX = oArgs[0]; curY = oArgs[1];
        push(curX, curY);
      } else if (op === OPS.curveTo) {
        // (x1, y1, x2, y2, x3, y3) — endpoint is (x3, y3)
        curX = oArgs[4]; curY = oArgs[5];
        push(curX, curY);
      } else if (op === OPS.curveTo2) {
        // (x2, y2, x3, y3) — current point + (x2,y2) + (x3,y3); end = (x3,y3)
        curX = oArgs[2]; curY = oArgs[3];
        push(curX, curY);
      } else if (op === OPS.curveTo3) {
        // (x1, y1, x3, y3) — end = (x3, y3)
        curX = oArgs[2]; curY = oArgs[3];
        push(curX, curY);
      } else if (op === OPS.closePath) {
        curX = subStartX; curY = subStartY;
      } else if (op === OPS.rectangle) {
        // (x, y, w, h) — push all 4 corners
        const [rx, ry, rw, rh] = oArgs;
        push(rx, ry); push(rx + rw, ry);
        push(rx, ry + rh); push(rx + rw, ry + rh);
        curX = rx; curY = ry;
        subStartX = curX; subStartY = curY;
      }
    }
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      const a = args[i];
      if (fn === OPS.save) {
        ctmStack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 1) ctmStack.pop();
        ctm = ctmStack[ctmStack.length - 1];
      } else if (fn === OPS.transform) {
        concatMatrix(a);
      } else if (fn === OPS.constructPath) {
        // a = [subFnArray, subArgsFlat, minMax?]
        const subFns = a[0];
        const subArgs = a[1];
        let idx = 0;
        for (let j = 0; j < subFns.length; j++) {
          const sfn = subFns[j];
          if (sfn === OPS.moveTo || sfn === OPS.lineTo) {
            handlePathOp(sfn, [subArgs[idx], subArgs[idx + 1]]);
            idx += 2;
          } else if (sfn === OPS.curveTo) {
            handlePathOp(sfn, [
              subArgs[idx], subArgs[idx + 1], subArgs[idx + 2],
              subArgs[idx + 3], subArgs[idx + 4], subArgs[idx + 5],
            ]);
            idx += 6;
          } else if (sfn === OPS.curveTo2 || sfn === OPS.curveTo3) {
            handlePathOp(sfn, [
              subArgs[idx], subArgs[idx + 1],
              subArgs[idx + 2], subArgs[idx + 3],
            ]);
            idx += 4;
          } else if (sfn === OPS.rectangle) {
            handlePathOp(sfn, [
              subArgs[idx], subArgs[idx + 1],
              subArgs[idx + 2], subArgs[idx + 3],
            ]);
            idx += 4;
          } else if (sfn === OPS.closePath) {
            handlePathOp(sfn, []);
          }
        }
      } else {
        handlePathOp(fn, a);
      }
    }
    return out;
  }

  // Small green halo drawn at a snap target to tell the user "release
  // here to land exactly on this existing endpoint."
  function drawSnapHalo(ctx, pdfPoint) {
    const x = pdfPoint.x * scale;
    const y = pdfPoint.y * scale;
    ctx.save();
    ctx.strokeStyle = "#10b981";
    ctx.fillStyle   = "rgba(16, 185, 129, 0.18)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Find the index of the measurement closest to `point`, within a hover
  // tolerance (in PDF units, scaled so behaviour is consistent at any
  // zoom). Returns -1 when none.
  function findHoveredMeasurement(point) {
    if (!point) return -1;
    // 14 CSS-pixel tolerance is generous enough that "hovering over" a
    // line works consistently without requiring pixel-perfect aim.
    const tolPdf = 14 / scale;
    const tolPdfSq = tolPdf * tolPdf;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i];
      if (m.page !== pageNum) continue;
      let d = Infinity;
      if (m.kind === "area") {
        // Distance to the closest edge of the polygon.
        const verts = m.vertices;
        for (let k = 0; k < verts.length; k++) {
          const a = verts[k];
          const b = verts[(k + 1) % verts.length];
          const ds = distSqPointToSegment(point, a, b);
          if (ds < d) d = ds;
        }
      } else {
        d = distSqPointToSegment(point, m.p1, m.p2);
      }
      if (d < tolPdfSq && d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  // ───────── Rendering ─────────
  // Cancellation-safe: if renderPage() is called while a previous render
  // is still in flight (rapid zoom is the obvious case), we cancel the
  // pending pdf.js task and tag the new call with a fresh sequence
  // number. Late completions whose seq doesn't match the current one
  // bail out without touching the DOM, so the visible canvas is never
  // left in a half-painted / blank state.
  async function renderPage() {
    if (!pdfDoc) return;
    const seq = ++renderSeq;
    if (currentRenderTask) {
      try { currentRenderTask.cancel(); } catch { /* ignore */ }
      currentRenderTask = null;
    }

    let page;
    try { page = await pdfDoc.getPage(pageNum); }
    catch (err) { console.warn("[mv] getPage failed", err); return; }
    if (seq !== renderSeq) return; // a newer render already started

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.floor(viewport.width);
    const cssH = Math.floor(viewport.height);
    if (cssW <= 0 || cssH <= 0) return; // defensive

    canvasEl.width  = Math.floor(cssW * dpr);
    canvasEl.height = Math.floor(cssH * dpr);
    canvasEl.style.width  = cssW + "px";
    canvasEl.style.height = cssH + "px";
    overlayEl.width  = canvasEl.width;
    overlayEl.height = canvasEl.height;
    overlayEl.style.width  = cssW + "px";
    overlayEl.style.height = cssH + "px";
    const ctx = canvasEl.getContext("2d", { alpha: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cssW, cssH);

    const task = page.render({ canvasContext: ctx, viewport });
    currentRenderTask = task;
    try {
      await task.promise;
    } catch (err) {
      // RenderingCancelledException is the expected outcome of cancel()
      // during rapid zoom — silent. Anything else is logged.
      if (!err || err.name !== "RenderingCancelledException") {
        console.warn("[mv] render failed", err);
      }
      return;
    }
    if (seq !== renderSeq) return; // newer render landed while we awaited
    if (currentRenderTask === task) currentRenderTask = null;

    pageEl.textContent = `${pageNum} / ${pageCount}`;
    zoomEl.textContent = `${Math.round((scale / baseScale) * 100)}%`;
    refreshNavState();
    drawOverlay();

    // Lazily harvest this page's PDF vector endpoints so cursor snap can
    // land on actual line ends drawn into the PDF (not just measurement
    // endpoints we've placed). Async + cached: once a page is harvested,
    // we never re-walk its operator list. Stale results from a swapped
    // document are dropped via endpointsExtractGen.
    if (!pdfEndpointsByPage[pageNum]) {
      const myGen = endpointsExtractGen;
      const myPage = pageNum;
      const v1 = page.getViewport({ scale: 1 });
      page.getOperatorList().then((opList) => {
        if (myGen !== endpointsExtractGen) return; // doc swapped
        try {
          pdfEndpointsByPage[myPage] = extractPdfEndpoints(opList, v1);
        } catch (err) {
          console.warn("[mv] endpoint extract failed", err);
          pdfEndpointsByPage[myPage] = []; // mark "tried, none" so we don't retry
        }
        // If the user is hovering with no in-flight measurement, repaint
        // so a snap halo appears as soon as endpoints land.
        if (myPage === pageNum && cursorPos) requestOverlayDraw();
      }).catch((err) => {
        if (myGen !== endpointsExtractGen) return;
        console.warn("[mv] getOperatorList failed", err);
        pdfEndpointsByPage[myPage] = [];
      });
    }
  }

  function drawOverlay() {
    const ctx = overlayEl.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlayEl.width / dpr, overlayEl.height / dpr);

    // Reset the click-target list before redrawing.
    deleteBadges = [];

    // Already-placed measurements on this page. The × delete badge is
    // ALWAYS drawn (subtle when idle, prominent when hovered) so the
    // affordance is discoverable without depending on hover state.
    // Calibration segments don't get a badge — clearing the calibration
    // accidentally would invalidate every other measurement's label.
    for (let i = 0; i < measurements.length; i++) {
      const m = measurements[i];
      if (m.page !== pageNum) continue;
      const isHovered = (i === hoveredMeasurement);
      if (m.kind === "area") {
        drawPolygon(ctx, m.vertices, m.text, isHovered);
        registerDeleteBadge(ctx, i, polygonCentroid(m.vertices), isHovered);
      } else if (m.kind === "calibrate") {
        drawSegment(ctx, m.p1, m.p2, m.text, m.kind, isHovered);
      } else {
        drawSegment(ctx, m.p1, m.p2, m.text, m.kind || "measure", isHovered);
        const mid = { x: (m.p1.x + m.p2.x) / 2, y: (m.p1.y + m.p2.y) / 2 };
        registerDeleteBadge(ctx, i, mid, isHovered);
      }
    }

    // Live preview for line measurement / calibration / slope.
    if (pendingFirst && pendingFirst.page === pageNum && cursorPos &&
        (mode === "measure" || mode === "calibrate" || mode === "slope")) {
      const p1 = pendingFirst.point;
      // Snap wins over ortho when cursor is near an existing endpoint.
      const snap = findSnapPoint(cursorPos);
      const p2 = snap ? snap.point : applyOrthoConstraint(p1, cursorPos);
      const units = distancePdf(p1, p2);
      let previewText;
      if (mode === "calibrate") previewText = `${units.toFixed(1)} وحدة PDF`;
      else if (mode === "slope") previewText = formatLength(units); // length only; heights come after the click
      else previewText = formatLength(units);
      drawPreviewSegment(ctx, p1, p2, previewText, mode);
      if (snap) drawSnapHalo(ctx, snap.point);
    } else if (pendingFirst && pendingFirst.page === pageNum) {
      // Fallback: if cursor isn't tracked yet, just dot the first click.
      const px = pendingFirst.point.x * scale;
      const py = pendingFirst.point.y * scale;
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, 2 * Math.PI);
      ctx.fill();
    } else if (cursorPos && (mode === "measure" || mode === "area" || mode === "calibrate" || mode === "slope")
               && currentPolygon.length === 0 && !dragState.active) {
      // No pending click yet — but if the cursor is over an existing
      // endpoint, hint that it'll snap when clicked.
      const snap = findSnapPoint(cursorPos);
      if (snap) drawSnapHalo(ctx, snap.point);
    }

    // Live preview for area mode: solid placed edges + dashed segment to
    // cursor + dashed closing segment back to the first vertex. Running
    // perimeter + estimated area shown next to the cursor.
    if (mode === "area" && currentPolygon.length > 0) {
      drawAreaInProgress(ctx);
    }
  }

  // Per-kind palette: calibrate=purple, slope=amber, measure (default)=blue.
  // `stroke` is the line/border color, `text` is the label color.
  function _segmentColors(kind) {
    if (kind === "calibrate") return { stroke: "#a855f7", text: "#7c3aed" };
    if (kind === "slope")     return { stroke: "#f59e0b", text: "#b45309" };
    return                          { stroke: "#2563eb", text: "#1e3a8a" };
  }

  // ───────── Label pill (shared) ─────────
  // One rounded, slightly shadowed pill used by every measurement label —
  // committed segment, committed polygon, and in-flight preview. Three
  // visual tiers via `variant`:
  //   "committed" → bold 16px, soft shadow
  //   "preview"   → semi-bold 14px, no shadow (it's transient)
  //   "hovered"   → committed + sharper shadow + thicker border
  // Labels use canvas-pixel sizing (independent of PDF zoom) so they
  // stay legible at any zoom level.
  function _roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rr);
      return;
    }
    // Fallback for older Canvas APIs.
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
  function drawLabelPill(ctx, cx, cy, text, palette, variant) {
    if (text == null || text === "") return;
    ctx.save();
    const isPreview  = variant === "preview";
    const isHovered  = variant === "hovered";
    // Font sizes tuned for legibility on a 100%-zoom plot — bigger than
    // the previous 13px so the value is readable without leaning in.
    const fontPx = isPreview ? 14 : 16;
    const weight = isPreview ? "600" : "700";
    ctx.font = `${weight} ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
    const padX = isPreview ? 9 : 11;
    const padY = isPreview ? 5 : 7;
    const tw = ctx.measureText(text).width;
    // Use the actual font metrics for height when available; fallback to
    // a reasonable approximation derived from the font size.
    const m = ctx.measureText(text);
    const ascent  = m.actualBoundingBoxAscent  || fontPx * 0.78;
    const descent = m.actualBoundingBoxDescent || fontPx * 0.22;
    const th = ascent + descent;
    const w = tw + padX * 2;
    const h = th + padY * 2;
    const rectX = cx - w / 2;
    const rectY = cy - h / 2;

    // Soft drop shadow for depth — brighter and farther on hover so the
    // active label visibly lifts off the page.
    if (!isPreview) {
      ctx.shadowColor   = isHovered ? "rgba(15, 23, 42, 0.22)" : "rgba(15, 23, 42, 0.14)";
      ctx.shadowBlur    = isHovered ? 10 : 6;
      ctx.shadowOffsetY = isHovered ? 2 : 1;
    }

    ctx.fillStyle = isHovered ? "#ffffff" : "rgba(255,255,255,0.96)";
    _roundRectPath(ctx, rectX, rectY, w, h, 9);
    ctx.fill();

    // Reset shadow before the outline so the border doesn't re-cast it.
    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = palette.stroke;
    ctx.lineWidth   = isHovered ? 2 : 1.4;
    _roundRectPath(ctx, rectX, rectY, w, h, 9);
    ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Dashed in-flight preview — shares colour family with drawSegment but
  // visually distinct so the user knows it's not committed yet.
  function drawPreviewSegment(ctx, p1, p2, text, kind) {
    const x1 = p1.x * scale, y1 = p1.y * scale;
    const x2 = p2.x * scale, y2 = p2.y * scale;
    const palette = _segmentColors(kind);
    const stroke = palette.stroke;
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = stroke;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    // Anchor + cursor markers
    ctx.fillStyle = stroke;
    ctx.beginPath(); ctx.arc(x1, y1, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 2 * Math.PI); ctx.fill();
    // Pill label offset from the cursor so it doesn't sit on top of the
    // geometry being placed. drawLabelPill centres on (cx, cy) — we add
    // half the rough text width as the lateral offset so it lands fully
    // to the right of the cursor instead of straddling it.
    if (text) {
      ctx.save();
      ctx.font = "600 14px system-ui, -apple-system, 'Segoe UI', Roboto, Arial";
      const approxHalfW = ctx.measureText(text).width / 2 + 9;
      ctx.restore();
      drawLabelPill(ctx, x2 + 18 + approxHalfW, y2 - 16, text, palette, "preview");
    }
    ctx.restore();
  }

  function drawSegment(ctx, p1, p2, text, kind, hovered) {
    const x1 = p1.x * scale, y1 = p1.y * scale;
    const x2 = p2.x * scale, y2 = p2.y * scale;
    const palette = _segmentColors(kind);
    const baseColor = palette.stroke;
    ctx.lineWidth = hovered ? 3 : 2;
    ctx.strokeStyle = baseColor;
    ctx.fillStyle   = baseColor;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    [[x1, y1], [x2, y2]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, hovered ? 4 : 3, 0, 2 * Math.PI); ctx.fill();
    });
    // Label at midpoint via the shared pill renderer.
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    drawLabelPill(ctx, mx, my, text, palette, hovered ? "hovered" : "committed");
  }

  // Closed-polygon area measurement. Translucent fill + outline + vertex
  // dots + centred area label.
  function drawPolygon(ctx, vertices, text, hovered) {
    if (!vertices || vertices.length < 2) return;
    const stroke = "#0ea5e9";
    const fill   = hovered ? "rgba(14,165,233,0.22)" : "rgba(14,165,233,0.14)";
    ctx.save();
    ctx.lineWidth = hovered ? 2.5 : 2;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(vertices[0].x * scale, vertices[0].y * scale);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x * scale, vertices[i].y * scale);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stroke;
    for (const v of vertices) {
      ctx.beginPath();
      ctx.arc(v.x * scale, v.y * scale, hovered ? 4 : 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    // Area label at centroid — uses the shared pill renderer with the
    // polygon's sky-blue palette so it visually matches the outline.
    const c = polygonCentroid(vertices);
    const cx = c.x * scale, cy = c.y * scale;
    const polyPalette = { stroke: stroke, text: "#0c4a6e" };
    drawLabelPill(ctx, cx, cy, text, polyPalette, hovered ? "hovered" : "committed");
    ctx.restore();
  }

  // In-progress area polygon — solid placed segments + dashed cursor lead
  // + dashed close-back-to-first preview. Highlights the first vertex
  // when the cursor is near enough to "snap-close" the polygon.
  function drawAreaInProgress(ctx) {
    const verts = currentPolygon;
    const stroke = "#0ea5e9";
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.fillStyle   = stroke;
    ctx.lineWidth = 2;
    // Solid edges already placed
    if (verts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(verts[0].x * scale, verts[0].y * scale);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x * scale, verts[i].y * scale);
      }
      ctx.stroke();
    }
    // Vertex markers (first vertex larger so it's visible as the close target)
    for (let i = 0; i < verts.length; i++) {
      ctx.beginPath();
      ctx.arc(verts[i].x * scale, verts[i].y * scale, i === 0 ? 5 : 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    // Dashed lead from last vertex → cursor (and close → first vertex when 2+).
    if (cursorPos) {
      const last = verts[verts.length - 1];
      // Snap to existing measurement endpoints (other than the first
      // vertex of THIS polygon — that one closes via its own snap).
      const epSnap = findSnapPoint(cursorPos);
      const next = epSnap ? epSnap.point : applyOrthoConstraint(last, cursorPos);
      if (epSnap) drawSnapHalo(ctx, epSnap.point);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(last.x * scale, last.y * scale);
      ctx.lineTo(next.x * scale, next.y * scale);
      if (verts.length >= 2) {
        ctx.moveTo(next.x * scale, next.y * scale);
        ctx.lineTo(verts[0].x * scale, verts[0].y * scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Close-snap halo on first vertex when cursor is near it.
      if (verts.length >= 3 && nearFirstVertex(next)) {
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(verts[0].x * scale, verts[0].y * scale, 9, 0, 2 * Math.PI);
        ctx.stroke();
      }
      // Live area + perimeter label hugging the cursor — same shared
      // pill renderer as committed labels (preview variant: lighter).
      if (verts.length >= 2) {
        const tempPoly = verts.concat([next]);
        const areaUnits = shoelaceArea(tempPoly);
        const perimUnits = polygonPerimeter(tempPoly) + distancePdf(next, verts[0]);
        const text = `${formatArea(areaUnits)} · ${formatLength(perimUnits)}`;
        const polyPalette = { stroke: stroke, text: "#0c4a6e" };
        // Offset right of the cursor so the pill doesn't sit on top of
        // the dashed lead. drawLabelPill centres on its (cx, cy), so we
        // pre-measure half the text width and shift by that + a margin.
        ctx.save();
        ctx.font = "600 14px system-ui, -apple-system, 'Segoe UI', Roboto, Arial";
        const approxHalfW = ctx.measureText(text).width / 2 + 9;
        ctx.restore();
        drawLabelPill(ctx, next.x * scale + 18 + approxHalfW, next.y * scale - 18, text, polyPalette, "preview");
      }
    }
    ctx.restore();
  }

  function nearFirstVertex(point) {
    if (currentPolygon.length === 0) return false;
    const v0 = currentPolygon[0];
    const dx = (point.x - v0.x) * scale;
    const dy = (point.y - v0.y) * scale;
    return Math.sqrt(dx * dx + dy * dy) < 12; // 12 CSS-px snap radius
  }

  // Always-on × badge near the measurement label. Subtle when idle,
  // prominent (red, bigger, drop-shadowed) when hovered. Clamped to
  // the visible canvas so badges near the page edge stay clickable.
  // The hit area stored in `deleteBadges` is the same regardless of
  // visual state, so clicks are predictable even when the badge is
  // small and grey.
  function registerDeleteBadge(ctx, idx, anchorPdf, hovered) {
    const cx = anchorPdf.x * scale;
    const cy = anchorPdf.y * scale;
    const r = hovered ? 13 : 9;
    const dpr = window.devicePixelRatio || 1;
    const cssW = overlayEl.width / dpr;
    const cssH = overlayEl.height / dpr;
    // Anchored above-right of the label.
    let bx = cx + 38;
    let by = cy - 20;
    bx = Math.max(r + 2, Math.min(cssW - r - 2, bx));
    by = Math.max(r + 2, Math.min(cssH - r - 2, by));
    ctx.save();
    if (hovered) {
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;
    }
    ctx.fillStyle   = hovered ? "#ef4444" : "rgba(100, 116, 139, 0.55)";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = hovered ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth   = hovered ? 2.4 : 1.6;
    ctx.lineCap = "round";
    const arm = hovered ? 5 : 3.5;
    ctx.beginPath();
    ctx.moveTo(bx - arm, by - arm); ctx.lineTo(bx + arm, by + arm);
    ctx.moveTo(bx + arm, by - arm); ctx.lineTo(bx - arm, by + arm);
    ctx.stroke();
    ctx.restore();
    // Larger hit radius than the drawn circle so the click is forgiving
    // even when the badge is in its small idle state.
    deleteBadges.push({ idx, x: bx, y: by, r: 14 });
  }

  // ───────── Page nav / zoom ─────────
  function setZoom(next, anchor) {
    const old = scale;
    const newScale = clamp(next, baseScale * 0.25, baseScale * 8);
    if (Math.abs(newScale - old) < 1e-3) return;
    // Anchor zoom around the cursor (or stage centre if not provided)
    // so the user doesn't lose their spot.
    const stageRect = stageEl.getBoundingClientRect();
    const ax = anchor ? anchor.x - stageRect.left : stageRect.width / 2;
    const ay = anchor ? anchor.y - stageRect.top  : stageRect.height / 2;
    const sxBefore = (stageEl.scrollLeft + ax) / old;
    const syBefore = (stageEl.scrollTop  + ay) / old;
    scale = newScale;
    // Capture the seq AFTER renderPage starts (renderPage increments it
    // synchronously). If a NEWER setZoom fires before the render below
    // resolves, that newer call also bumps renderSeq and our restore
    // becomes stale — skip it so we don't fight with the newer scroll.
    const renderPromise = renderPage();
    const mySeq = renderSeq;
    renderPromise.then(() => {
      if (mySeq !== renderSeq) return;
      stageEl.scrollLeft = sxBefore * scale - ax;
      stageEl.scrollTop  = syBefore * scale - ay;
    });
  }

  function fitToWindow() {
    if (!pdfDoc) return;
    pdfDoc.getPage(pageNum).then((page) => {
      const v1 = page.getViewport({ scale: 1 });
      const stageRect = stageEl.getBoundingClientRect();
      // Generous padding so the page doesn't kiss the toolbar borders.
      const sx = (stageRect.width  - 32) / v1.width;
      const sy = (stageRect.height - 32) / v1.height;
      baseScale = Math.max(0.1, Math.min(sx, sy));
      scale = baseScale;
      renderPage();
    });
  }

  async function gotoPage(n) {
    if (!pdfDoc) return;
    pageNum = clamp(n, 1, pageCount);
    pendingFirst = null;
    await renderPage();
  }

  // ───────── Open / close ─────────
  async function openViewer(pdfUrl, filename) {
    if (!window.pdfjsLib) {
      console.error("[mv] pdfjsLib not loaded");
      alert("Failed to load PDF.js library");
      return;
    }
    // Reset state for the new doc.
    pdfDoc = null;
    pageNum = 1;
    pageCount = 1;
    scale = 1.0;
    baseScale = 1.0;
    measurements = [];
    pendingFirst = null;
    currentDocKey = pdfUrl;
    // Drop the prior document's PDF-endpoint cache; bump the extract
    // generation so any in-flight async extraction from the old doc gets
    // dropped when it resolves.
    for (const k of Object.keys(pdfEndpointsByPage)) delete pdfEndpointsByPage[k];
    endpointsExtractGen++;
    // Per-document calibration override wins (set if the user clicked the
    // Calibrate tool earlier in this session). Otherwise the factor is
    // auto-derived from the PDF page dimensions below, after we've loaded
    // page 1 and know its size in PDF units.
    setScaleBadge();

    filenameEl.textContent = filename || "";
    // Slide-in (route-style): the .is-open class drives the CSS transform
    // transition; the body scroll-lock keeps the page underneath from
    // moving when the user wheels over the now-visible viewer.
    modalEl.classList.add("is-open");
    document.body.style.overflow = "hidden";
    emptyEl.hidden = false;
    setMode("measure");

    try {
      const task = window.pdfjsLib.getDocument({ url: pdfUrl });
      pdfDoc = await task.promise;
      pageCount = pdfDoc.numPages;
      emptyEl.hidden = true;
      // First render at scale=1 so we can capture a baseline viewport,
      // then fit to window for the actual visible scale.
      const page = await pdfDoc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });

      // Calibration override for this exact document (set if the user
      // clicked Calibrate earlier in the session) still wins; otherwise
      // we fall back to the office default. Either way, log diagnostics
      // so we can spot off-pattern PDFs via the browser console.
      const stored = readSessionScale(currentDocKey);
      pdfUnitsPerMeter = stored || DEFAULT_PDF_UNITS_PER_METER;
      logPageDiagnostics(v1, pdfUnitsPerMeter);
      setScaleBadge();
      // Refresh the status line so it reflects the now-known factor.
      setMode("measure");

      const stageRect = stageEl.getBoundingClientRect();
      const sx = (stageRect.width  - 32) / v1.width;
      const sy = (stageRect.height - 32) / v1.height;
      baseScale = Math.max(0.1, Math.min(sx, sy));
      scale = baseScale;
      await renderPage();
    } catch (err) {
      console.error("[mv] failed to load PDF", err);
      emptyEl.hidden = false;
      emptyEl.textContent = "تعذّر تحميل ملف PDF.";
    }
  }

  function closeViewer() {
    // Slide-out: dropping .is-open animates the transform back off-screen.
    // pdfDoc is intentionally NOT torn down — re-opening the same doc in
    // the same session reuses the fetched PDF instead of re-downloading.
    modalEl.classList.remove("is-open");
    document.body.style.overflow = "";
    pendingFirst = null;
    currentPolygon = [];
  }
  function isViewerOpen() {
    return modalEl.classList.contains("is-open");
  }

  // ───────── Route-style open / close ─────────
  // The viewer behaves like a separate page: opening pushes ?measure=1
  // onto history (so the address bar reflects the new "page"), and
  // closing via the × button pops that history entry — same effect as
  // pressing the browser's back arrow. This means ESC is no longer
  // tied to closing the viewer (page-like UX: ESC cancels in-progress
  // work but doesn't unwind navigation).
  function urlWithMeasureFlag(on) {
    const u = new URL(window.location.href);
    if (on) u.searchParams.set("measure", "1");
    else u.searchParams.delete("measure");
    return u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : "") + u.hash;
  }
  function openViewerRoute(pdfUrl, filename) {
    // Avoid stacking duplicate history entries if the user clicks the
    // launcher multiple times somehow.
    if (!history.state || !history.state.mvOpen) {
      try {
        history.pushState(
          { mvOpen: true, pdfUrl, filename },
          "",
          urlWithMeasureFlag(true)
        );
      } catch { /* same-origin sandboxes can throw — fall through */ }
    }
    openViewer(pdfUrl, filename);
  }
  function closeViewerRoute() {
    // If we pushed an entry on open, popping it triggers `popstate` which
    // closes the viewer below. If not (e.g. deep-linked first navigation),
    // just close in place so the user isn't dumped onto a blank tab.
    if (history.state && history.state.mvOpen) {
      history.back();
    } else {
      closeViewer();
    }
  }
  // popstate fires for browser back/forward AND for our own history.back()
  // call inside closeViewerRoute. Sync the viewer's open/closed state with
  // whatever history just landed on.
  window.addEventListener("popstate", (evt) => {
    const wantOpen = !!(evt.state && evt.state.mvOpen);
    if (wantOpen && !isViewerOpen()) {
      // Forward-navigated back into a viewer state — re-open with the
      // saved URL+filename. (Same-session reuse means pdfjs cache still
      // has the doc.)
      const s = evt.state;
      if (s && s.pdfUrl) openViewer(s.pdfUrl, s.filename || "");
    } else if (!wantOpen && isViewerOpen()) {
      closeViewer();
    }
  });

  // ───────── Calibration persistence ─────────
  // Calibration is keyed by the PDF URL (which includes the analysis id +
  // slot), so re-opening the same measurement PDF in the same session
  // remembers the scale. NOT saved across sessions because a different
  // submitter could replace the PDF without invalidating this client's
  // sessionStorage.
  function writeSessionScale(key, value) {
    try { sessionStorage.setItem("mv:scale:" + key, String(value)); } catch {}
  }
  function readSessionScale(key) {
    try {
      const raw = sessionStorage.getItem("mv:scale:" + key);
      const n = raw == null ? NaN : parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  }

  // ───────── Click flow (measure + calibrate + area + delete) ─────────
  function handleOverlayClick(evt) {
    if (mode === "pan") return; // Pan handled separately on mousedown

    // 1) Click on a hover × badge → delete that measurement. Checked
    //    BEFORE any mode-specific click logic so the user can never
    //    accidentally place a new measurement while clearing one.
    const rect = canvasEl.getBoundingClientRect();
    const cx = evt.clientX - rect.left;
    const cy = evt.clientY - rect.top;
    for (const b of deleteBadges) {
      const dx = cx - b.x, dy = cy - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) {
        const removed = measurements.splice(b.idx, 1)[0];
        hoveredMeasurement = -1;
        drawOverlay();
        setStatus(removed && removed.kind === "area" ? "تمّ حذف المساحة." : "تمّ حذف القياس.");
        return;
      }
    }

    const rawPoint = clientToPdf(evt);
    // Snap to an existing endpoint if cursor is within snap radius. This
    // is what lets the user "chain" measurements by clicking on the
    // endpoint of an existing one. Snap wins over Shift-ortho — if the
    // user is over a snap target they want exact, not constrained.
    const snapHere = findSnapPoint(rawPoint);
    const placePoint = snapHere ? snapHere.point : rawPoint;

    // 2) Area mode click flow — adds vertex / closes polygon.
    if (mode === "area") { handleAreaClick(rawPoint, placePoint, !!snapHere); return; }

    // 3) Measure / Calibrate / Slope flow.
    if (!pendingFirst) {
      // Slope mode requires calibration so the length term in the
      // (h₁ − h₂) ÷ length × 100 formula is in metres. Refuse the first
      // click otherwise — clearer than committing a meaningless number.
      if (mode === "slope" && !pdfUnitsPerMeter) {
        setStatus("الميل يحتاج إلى تعيير أولًا — اضغط C لتعيير المقياس.");
        return;
      }
      pendingFirst = { point: placePoint, page: pageNum };
      // Track cursor immediately so the live preview draws on first move.
      cursorPos = placePoint;
      drawOverlay();
      if (mode === "calibrate") setStatus("التعيير: انقر النقطة الثانية لإكمال البُعد المعروف.");
      else if (mode === "slope") setStatus("انقر النقطة الثانية على الطرف الآخر للخط.");
      else setStatus("انقر النقطة الثانية لإتمام القياس. (Shift = أفقي/عمودي · ESC = إلغاء)");
      return;
    }
    if (pendingFirst.page !== pageNum) {
      // Crossed a page boundary mid-measure — drop the buffer and start over.
      pendingFirst = { point: placePoint, page: pageNum };
      drawOverlay();
      return;
    }
    const p1 = pendingFirst.point;
    // Snap wins; otherwise apply Shift-ortho constraint.
    const p2 = snapHere ? placePoint : applyOrthoConstraint(p1, rawPoint);
    pendingFirst = null;
    const units = distancePdf(p1, p2);
    if (units < 1) {
      setStatus("النقطتان قريبتان جدًا — حاول مرة أخرى.");
      drawOverlay();
      return;
    }

    if (mode === "calibrate") {
      // Async dialog — non-blocking, doesn't freeze the page like
      // window.prompt did. The dialog returns null on cancel.
      showCalibrateDialog(units).then((meters) => {
        if (meters == null) {
          // Cancel: drop the calibration attempt, go back to measure mode.
          drawOverlay();
          setMode("measure");
          setStatus("تمّ إلغاء التعيير.");
          return;
        }
        pdfUnitsPerMeter = units / meters;
        writeSessionScale(currentDocKey, pdfUnitsPerMeter);
        setScaleBadge();
        // Calibration is purely a numeric factor (held in pdfUnitsPerMeter
        // + sessionStorage) — no on-canvas reference line. Drop any prior
        // calibration segment from earlier sessions for the same reason.
        measurements = measurements.filter((m) => m.kind !== "calibrate");
        // Re-label every measurement so labels reflect the new factor.
        // Lines, areas, and slopes use different geometry, so branch on kind.
        for (const m of measurements) {
          if (m.kind === "area") {
            m.text = formatArea(shoelaceArea(m.vertices));
          } else if (m.kind === "slope") {
            // New scale → Δh in metres ALSO changes (the y-pixel delta is
            // the same but it now represents a different real-world drop),
            // so re-derive both from the points before re-labelling.
            m.lengthMeters = distancePdf(m.p1, m.p2) / pdfUnitsPerMeter;
            m.dh = (m.p2.y - m.p1.y) / pdfUnitsPerMeter;
            m.slopePct = (m.dh / m.lengthMeters) * 100;
            m.text = formatSlope(m.dh, m.lengthMeters);
          } else {
            m.text = formatLength(distancePdf(m.p1, m.p2));
          }
        }
        setMode("measure");
        drawOverlay();
        setStatus("تمّ تعيير المقياس. يمكنك الآن إجراء قياسات حقيقية.");
      });
      return;
    }

    if (mode === "slope") {
      // Auto-derive everything from the two picked points — assumes a
      // profile / section drawing where the on-screen Y axis represents
      // elevation (i.e. the picked line IS the slope line). pdf-space y
      // here mirrors canvas y (increases downward), so a point higher
      // on the screen has a SMALLER y → Δh = (p2.y − p1.y), then divide
      // by the calibration to get metres. Sign convention matches the
      // requested formula: positive % means the line falls from p₁ → p₂.
      const lengthMeters = units / pdfUnitsPerMeter;
      const dh = (p2.y - p1.y) / pdfUnitsPerMeter;
      const text = formatSlope(dh, lengthMeters);
      measurements.push({
        p1, p2, page: pageNum, kind: "slope", text,
        dh,
        lengthMeters,
        slopePct: (dh / lengthMeters) * 100,
      });
      drawOverlay();
      setStatus("تمّ حساب الميل. انقر نقطتين أخريين لميل آخر · Z = تراجع · ESC = إلغاء.");
      return;
    }

    // mode === "measure"
    const text = formatLength(units);
    measurements.push({ p1, p2, page: pageNum, kind: "measure", text });
    drawOverlay();
    setStatus("تمّ القياس. انقر نقطتين أخريين للقياس التالي · Z = تراجع · ESC = إلغاء.");
  }

  // ───────── Area mode: click handler + polygon commit ─────────
  // Click in area mode → either close (if near first vertex with 3+ pts)
  // or append a vertex. Double-click and Enter also close (handled below).
  // `placePoint` is `rawPoint` snapped to an existing endpoint (when one
  // is in range); `snapped` says whether the snap actually fired so we
  // skip the Shift-ortho constraint in that case.
  function handleAreaClick(rawPoint, placePoint, snapped) {
    if (placePoint == null) placePoint = rawPoint;
    if (currentPolygon.length === 0) {
      currentPolygon.push(placePoint);
      cursorPos = placePoint;
      setStatus("استمرّ بالنقر لإضافة رؤوس. أغلق المضلَّع بالنقر على النقطة الأولى أو Enter.");
      drawOverlay();
      return;
    }
    // If the click is near the first vertex AND the polygon has at least
    // 3 vertices already, close it. (Use rawPoint for this — close-snap
    // is its own gesture, distinct from endpoint-chaining snap.)
    if (currentPolygon.length >= 3) {
      const v0 = currentPolygon[0];
      const dx = (rawPoint.x - v0.x) * scale;
      const dy = (rawPoint.y - v0.y) * scale;
      if (Math.sqrt(dx * dx + dy * dy) < 12) {
        commitAreaPolygon();
        return;
      }
    }
    const last = currentPolygon[currentPolygon.length - 1];
    const next = snapped ? placePoint : applyOrthoConstraint(last, rawPoint);
    // Reject duplicate / near-duplicate vertices
    const dx = (next.x - last.x) * scale, dy = (next.y - last.y) * scale;
    if (Math.sqrt(dx * dx + dy * dy) < 3) {
      setStatus("النقطة قريبة جدًا من السابقة — حاول مرّة أخرى.");
      return;
    }
    currentPolygon.push(next);
    drawOverlay();
  }

  // Finalise the in-progress polygon into a stored area measurement.
  // Requires 3+ vertices; otherwise the polygon is discarded with a hint.
  function commitAreaPolygon() {
    if (currentPolygon.length < 3) {
      setStatus("تحتاج المساحة إلى 3 رؤوس على الأقل.");
      return;
    }
    const verts = currentPolygon.slice();
    const areaUnits = shoelaceArea(verts);
    if (areaUnits < 4) {
      // Tiny polygons are almost always accidental
      setStatus("المساحة صغيرة جدًا — تم التجاهل. حاول مرّة أخرى.");
      currentPolygon = [];
      drawOverlay();
      return;
    }
    measurements.push({
      kind: "area",
      vertices: verts,
      page: pageNum,
      text: formatArea(areaUnits),
    });
    currentPolygon = [];
    drawOverlay();
    setStatus(`تمّت إضافة المساحة: ${formatArea(areaUnits)}.  انقر لبدء مساحة جديدة أو ESC للخروج.`);
  }

  // ───────── Inline calibrate prompt ─────────
  // The status bar swaps from "tip text" to an input row while the user
  // sets the scale. No modal, no backdrop — feels like part of the
  // viewer rather than a separate overlay. Returns Promise<number|null>:
  // meters on confirm, null on cancel.
  function showCalibrateDialog(distancePdfUnits) {
    return new Promise((resolve) => {
      if (!calInlineEl || !calInputEl) {
        // Fall back to native prompt if the inline markup is missing.
        const ans = window.prompt("Real length in meters:", "");
        const m = ans == null ? null : parseFloat(String(ans).replace(",", "."));
        resolve(Number.isFinite(m) && m > 0 ? m : null);
        return;
      }
      if (calPickedInlineEl) {
        calPickedInlineEl.textContent = `(${distancePdfUnits.toFixed(1)} وحدة PDF)`;
      }
      calInputEl.value = "";
      calInputEl.classList.remove("is-invalid");
      calUnitEl.value = "m";
      // Hide the regular status text + scale badge so the input row owns
      // the strip while calibration is in progress.
      if (statusMsgEl)   statusMsgEl.hidden = true;
      const scaleWasShown = statusScaleEl && !statusScaleEl.hidden;
      if (scaleWasShown) statusScaleEl.hidden = true;
      calInlineEl.hidden = false;
      // Focus next tick so the slide-in animation doesn't fight the focus.
      setTimeout(() => calInputEl.focus(), 30);

      const cleanup = () => {
        calInlineEl.hidden = true;
        if (statusMsgEl)   statusMsgEl.hidden = false;
        if (scaleWasShown) statusScaleEl.hidden = false;
        calConfirmBtn.removeEventListener("click", onConfirm);
        calCancelBtn.removeEventListener("click", onCancel);
        calInputEl.removeEventListener("keydown", onKey);
      };
      const onConfirm = () => {
        const raw = (calInputEl.value || "").trim().replace(",", ".");
        const n = parseFloat(raw);
        if (!Number.isFinite(n) || n <= 0) {
          calInputEl.classList.add("is-invalid");
          calInputEl.focus();
          calInputEl.select();
          return;
        }
        let meters = n;
        if (calUnitEl.value === "cm") meters = n / 100;
        if (calUnitEl.value === "mm") meters = n / 1000;
        cleanup();
        resolve(meters);
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey = (e) => {
        calInputEl.classList.remove("is-invalid");
        if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      };
      calConfirmBtn.addEventListener("click", onConfirm);
      calCancelBtn.addEventListener("click", onCancel);
      calInputEl.addEventListener("keydown", onKey);
    });
  }

  // ───────── Undo last measurement ─────────
  // Pops the most recent non-calibration entry. Calibration is preserved
  // so the user doesn't accidentally lose their scale by mashing Z.
  function undoLastMeasurement() {
    for (let i = measurements.length - 1; i >= 0; i--) {
      if (measurements[i].kind !== "calibrate") {
        measurements.splice(i, 1);
        drawOverlay();
        setStatus("تمّ التراجع عن آخر قياس.");
        return true;
      }
    }
    setStatus("لا يوجد قياس للتراجع عنه.");
    return false;
  }

  // ───────── Pan: dedicated mode OR middle-mouse OR Space-held override ─────────
  // Left-button only triggers pan when mode is "pan" (or temporarily so via
  // Space). Middle-button (button === 1) triggers pan from ANY mode — useful
  // for nudging the view between measurements without leaving measure mode.
  function onStagePointerDown(evt) {
    const middle = evt.button === 1;
    const allowed = middle || mode === "pan";
    if (!allowed) return;
    panState.active = true;
    panState.button = evt.button;
    panState.startX = evt.clientX;
    panState.startY = evt.clientY;
    panState.scrollLeft = stageEl.scrollLeft;
    panState.scrollTop  = stageEl.scrollTop;
    stageEl.classList.add("is-grabbing");
    evt.preventDefault();
  }
  function onStagePointerMove(evt) {
    if (!panState.active) return;
    stageEl.scrollLeft = panState.scrollLeft - (evt.clientX - panState.startX);
    stageEl.scrollTop  = panState.scrollTop  - (evt.clientY - panState.startY);
  }
  function onStagePointerUp() {
    panState.active = false;
    stageEl.classList.remove("is-grabbing");
  }

  // ───────── Wheel zoom (CAD convention: bare wheel zooms) ─────────
  // Most measurement tools (Bluebeam, AutoCAD, ArcGIS) zoom on bare wheel.
  // Ctrl+wheel falls through as scroll, Shift+wheel scrolls horizontally.
  function onWheel(evt) {
    if (evt.ctrlKey) return; // Ctrl+wheel: native scroll (rare but supported)
    evt.preventDefault();
    if (evt.shiftKey) {
      // Shift+wheel: horizontal scroll, useful for wide drawings.
      stageEl.scrollLeft += evt.deltaY;
      return;
    }
    // Slightly stronger steps than the previous 1.1× — feels snappier.
    const factor = evt.deltaY > 0 ? (1 / 1.15) : 1.15;
    setZoom(scale * factor, { x: evt.clientX, y: evt.clientY });
  }

  // ───────── Endpoint drag — mousedown / mousemove / mouseup ─────────
  // mousedown on an existing endpoint stages a "drag candidate". If the
  // cursor moves enough before mouseup, the candidate becomes an active
  // drag. If the user simply clicks (no movement), the click handler
  // runs normally — preserving snap-to-endpoint placement UX.
  function onOverlayMouseDown(evt) {
    if (evt.button !== 0) return;            // left button only
    if (mode === "pan") return;              // pan mode handles drag itself
    if (panState.active) return;
    // Don't start drag if the click is on a delete badge — that should
    // delete via the click handler.
    const rect = canvasEl.getBoundingClientRect();
    const cx = evt.clientX - rect.left;
    const cy = evt.clientY - rect.top;
    for (const b of deleteBadges) {
      const dx = cx - b.x, dy = cy - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) return;
    }
    const p = clientToPdf(evt);
    const ep = findSnapPoint(p);
    if (!ep) return;                          // not over an endpoint
    mouseDownInfo = {
      startX: evt.clientX,
      startY: evt.clientY,
      candidateIdx: ep.idx,
      candidateEp: ep.endpointIdx,
    };
    // Don't preventDefault — we may yet treat this as a click (snap-place).
  }

  function onOverlayMouseUp() {
    if (dragState.active) {
      dragState.active = false;
      overlayEl.classList.remove("is-dragging");
      // Suppress the click that fires after this mouseup so the click
      // handler doesn't think the user wanted to place a new measurement.
      suppressNextClick = true;
      // Reset the flag on the next event tick — even if no click fires
      // (mouseup at a different element), we don't want this stuck.
      setTimeout(() => { suppressNextClick = false; }, 0);
      drawOverlay();
      setStatus("تمّ تحديث القياس.");
    }
    mouseDownInfo = null;
  }

  // ───────── Cursor tracking on the overlay (drives live preview + hover) ─────────
  function onOverlayMouseMove(evt) {
    cursorPos = clientToPdf(evt);
    // If a drag candidate was staged on mousedown, promote it to an
    // active drag once the cursor moves past the threshold.
    if (mouseDownInfo && !dragState.active) {
      const dx = evt.clientX - mouseDownInfo.startX;
      const dy = evt.clientY - mouseDownInfo.startY;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        dragState.active = true;
        dragState.measurementIdx = mouseDownInfo.candidateIdx;
        dragState.endpointIdx = mouseDownInfo.candidateEp;
        // Cancel any in-flight measurement so the user's intent is clear.
        pendingFirst = null;
        currentPolygon = [];
        overlayEl.classList.add("is-dragging");
      }
    }
    // While dragging an endpoint, follow the cursor (with snap-to-other
    // endpoints + Shift-ortho relative to the opposite anchor).
    if (dragState.active) {
      const m = measurements[dragState.measurementIdx];
      if (!m) { dragState.active = false; return; }
      let target = cursorPos;
      const snap = findSnapPoint(target, dragState.measurementIdx, dragState.endpointIdx);
      if (snap) {
        target = snap.point;
      } else if (shiftHeld) {
        // Ortho relative to the OTHER endpoint of the same line, or the
        // adjacent vertex for an area polygon.
        let anchor;
        if (m.kind === "area") {
          const verts = m.vertices;
          const prev = (dragState.endpointIdx + verts.length - 1) % verts.length;
          anchor = verts[prev];
        } else {
          anchor = (dragState.endpointIdx === 0) ? m.p2 : m.p1;
        }
        target = applyOrthoConstraint(anchor, target);
      }
      if (m.kind === "area") {
        m.vertices[dragState.endpointIdx] = target;
        m.text = formatArea(shoelaceArea(m.vertices));
      } else {
        if (dragState.endpointIdx === 0) m.p1 = target;
        else m.p2 = target;
        if (m.kind === "slope" && pdfUnitsPerMeter) {
          // Both length AND Δh follow the moved endpoint — Δh is the
          // calibrated vertical drop between p₁ and p₂, derived from
          // the points on every recompute (no separate stored value).
          m.lengthMeters = distancePdf(m.p1, m.p2) / pdfUnitsPerMeter;
          m.dh = (m.p2.y - m.p1.y) / pdfUnitsPerMeter;
          m.slopePct = (m.dh / m.lengthMeters) * 100;
          m.text = formatSlope(m.dh, m.lengthMeters);
        } else {
          m.text = formatLength(distancePdf(m.p1, m.p2));
        }
      }
      requestOverlayDraw();
      return;
    }
    // Track hover for the per-measurement × delete badge regardless of mode
    // (so user can delete from any mode). Skipped during pan-drag because
    // pan owns the cursor in that case.
    if (!panState.active) {
      const rect = canvasEl.getBoundingClientRect();
      const cx = evt.clientX - rect.left;
      const cy = evt.clientY - rect.top;

      // HYSTERESIS — keep hover alive while cursor is over the currently-
      // hovered measurement's × badge. Without this, moving from line →
      // badge would clear hover (cursor leaves the line tolerance before
      // reaching the badge), and the badge would vanish before you could
      // click it. We check ANY badge, not just the hovered one, so cursors
      // landing directly on a badge from outside also latch onto it.
      let hit = -1;
      for (const b of deleteBadges) {
        const dx = cx - b.x, dy = cy - b.y;
        if (dx * dx + dy * dy <= b.r * b.r) { hit = b.idx; break; }
      }
      // Otherwise fall back to nearest-line proximity in PDF space.
      if (hit < 0) hit = findHoveredMeasurement(cursorPos);

      if (hit !== hoveredMeasurement) {
        hoveredMeasurement = hit;
        overlayEl.classList.toggle("is-hover-measurement", hit >= 0);
        requestOverlayDraw();
      }
      // Endpoint-hover cursor: when the cursor is over an existing
      // measurement endpoint, switch to "move" so the user knows they
      // can grab and drag it. This wins over the delete-badge "pointer"
      // and the mode-specific "crosshair" via CSS specificity.
      const overEndpoint = !!findSnapPoint(cursorPos);
      overlayEl.classList.toggle("is-on-endpoint", overEndpoint && !dragState.active);
    }
    if (mode === "pan") return;
    // Live preview redraw for measure / calibrate / area only when there's
    // an in-flight pick to avoid burning frames idly. Also redraw when
    // the snap halo could appear (cursor over an endpoint), so the halo
    // tracks the cursor in real time.
    if (pendingFirst && pendingFirst.page === pageNum) requestOverlayDraw();
    if (mode === "area" && currentPolygon.length > 0) requestOverlayDraw();
    requestOverlayDraw(); // covers the "no pending, near endpoint" preview branch
  }
  function onOverlayMouseLeave() {
    cursorPos = null;
    if (hoveredMeasurement !== -1) {
      hoveredMeasurement = -1;
      overlayEl.classList.remove("is-hover-measurement");
    }
    requestOverlayDraw();
  }

  // ───────── Wire events ─────────
  // × button uses the route-aware closer so the URL pops back to the
  // application page on close. Browser back also works for the same reason.
  closeBtnEl.addEventListener("click", closeViewerRoute);

  // Resetting zoom to 100% (anchored to centre).
  function setZoomToActual() { setZoom(baseScale); }
  function setZoomToHundred() { setZoom(baseScale * 1.0); }
  // For "1" key shortcut — zoom such that 1 PDF unit = 1 CSS pixel
  // (requested by readers familiar with the "actual size" preset).
  function setZoomToOnePerOne() { setZoom(1.0); }

  document.addEventListener("keydown", (e) => {
    if (!isViewerOpen()) return;
    // Don't hijack typing into the calibrate dialog input.
    const inputFocused = (document.activeElement === calInputEl);
    if (inputFocused) return;

    // Shift = orthogonal constraint while picking the second point. Track
    // the down event so the live preview snaps immediately (without
    // waiting for the next mousemove).
    if (e.key === "Shift") {
      if (!shiftHeld) { shiftHeld = true; requestOverlayDraw(); }
      return;
    }

    // Spacebar = temporary pan. Holding Space switches into pan mode;
    // releasing returns to the prior mode. The in-flight measurement
    // state (pendingFirst / currentPolygon) is stashed and restored on
    // keyup so the user can pan to find their second click without
    // losing the first one. preventDefault on the keydown stops Space
    // from scrolling the underlying page.
    if (e.code === "Space") {
      e.preventDefault();
      if (!spacePanState.active && mode !== "pan") {
        spacePanState.active = true;
        spacePanState.priorMode = mode;
        spacePanState.priorPendingFirst = pendingFirst;
        spacePanState.priorPolygon = currentPolygon.slice();
        setMode("pan");
      }
      return;
    }

    if (e.key === "Escape") {
      // ESC clears any in-flight selection / pending operation in one
      // press: open dialog → in-progress polygon → pending first click →
      // hover-on-existing measurement. It never closes the viewer (the
      // viewer is a route-like page; only × button + browser back exit).
      let touched = false;
      if (calInlineEl && !calInlineEl.hidden) {
        calCancelBtn.click();
        touched = true;
      }
      if (mode === "area" && currentPolygon.length > 0) {
        currentPolygon = [];
        touched = true;
      }
      if (pendingFirst) {
        pendingFirst = null;
        cursorPos = null;
        touched = true;
      }
      if (hoveredMeasurement !== -1) {
        hoveredMeasurement = -1;
        overlayEl.classList.remove("is-hover-measurement");
        touched = true;
      }
      if (touched) {
        drawOverlay();
        setStatus("تمّ الإلغاء.");
      }
      // No else branch — ESC is a no-op when nothing is in progress.
    } else if (e.key === "Enter" && mode === "area" && currentPolygon.length >= 3) {
      e.preventDefault();
      commitAreaPolygon();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") { gotoPage(pageNum - 1); }
      else if (e.key === "ArrowRight" || e.key === "PageDown") { gotoPage(pageNum + 1); }
      else if (e.key === "+" || e.key === "=") { setZoom(scale * 1.2); }
      else if (e.key === "-" || e.key === "_") { setZoom(scale / 1.2); }
      else if (e.key === "0") { fitToWindow(); }
      else if (e.key === "1") { setZoomToHundred(); }
      else if (e.key === "m" || e.key === "M") { setMode("measure"); }
      else if (e.key === "a" || e.key === "A") { setMode("area"); }
      else if (e.key === "p" || e.key === "P") { setMode("pan"); }
      else if (e.key === "c" || e.key === "C") { setMode("calibrate"); }
      else if (e.key === "s" || e.key === "S") { setMode("slope"); }
      else if (e.key === "z" || e.key === "Z") { undoLastMeasurement(); }
  });
  document.addEventListener("keyup", (e) => {
    if (!isViewerOpen()) return;
    if (e.key === "Shift") {
      if (shiftHeld) { shiftHeld = false; requestOverlayDraw(); }
    }
    if (e.code === "Space" && spacePanState.active) {
      spacePanState.active = false;
      // Restore the user's prior tool AND the in-flight measurement
      // state that setMode wiped when we entered temp-pan. setMode itself
      // will clear pendingFirst/currentPolygon again, so we re-hydrate
      // them right after.
      setMode(spacePanState.priorMode);
      pendingFirst    = spacePanState.priorPendingFirst;
      currentPolygon  = spacePanState.priorPolygon;
      spacePanState.priorPendingFirst = null;
      spacePanState.priorPolygon = [];
      if (pendingFirst || currentPolygon.length > 0) drawOverlay();
    }
  });

  prevBtn.addEventListener("click", () => gotoPage(pageNum - 1));
  nextBtn.addEventListener("click", () => gotoPage(pageNum + 1));
  zoomInBtn.addEventListener("click", () => setZoom(scale * 1.2));
  zoomOutBtn.addEventListener("click", () => setZoom(scale / 1.2));
  fitBtn.addEventListener("click", fitToWindow);
  // Click the percentage chip to jump to fit-to-window — common in viewer
  // UIs and matches the title hint.
  if (zoomEl) zoomEl.addEventListener("click", fitToWindow);
  toolPanBtn.addEventListener("click", () => setMode("pan"));
  toolMeasBtn.addEventListener("click", () => setMode("measure"));
  if (toolAreaBtn) toolAreaBtn.addEventListener("click", () => setMode("area"));
  toolCalBtn.addEventListener("click", () => setMode("calibrate"));
  if (toolSlopeBtn) toolSlopeBtn.addEventListener("click", () => setMode("slope"));
  if (undoBtn) undoBtn.addEventListener("click", undoLastMeasurement);
  clearBtn.addEventListener("click", () => {
    if (measurements.filter((m) => m.kind !== "calibrate").length === 0) {
      setStatus("لا توجد قياسات للمسح.");
      return;
    }
    measurements = measurements.filter((m) => m.kind === "calibrate");
    pendingFirst = null;
    drawOverlay();
    setStatus("تمّ مسح القياسات. (تم الاحتفاظ بالتعيير)");
  });

  overlayEl.addEventListener("click", (evt) => {
    if (suppressNextClick) {
      // The mouseup that just preceded this click ended a drag; don't
      // treat it as a placement click. Reset the flag immediately.
      suppressNextClick = false;
      return;
    }
    if (mode === "pan") return;
    handleOverlayClick(evt);
  });
  // Double-click closes an in-progress area polygon (alternative to clicking
  // the first vertex or pressing Enter).
  overlayEl.addEventListener("dblclick", (evt) => {
    if (mode !== "area") return;
    if (currentPolygon.length < 3) return;
    evt.preventDefault();
    // The dblclick event fires AFTER two consecutive click events that
    // already added two vertices; commit immediately without adding a 3rd.
    commitAreaPolygon();
  });
  overlayEl.addEventListener("mousedown", onOverlayMouseDown);
  // mouseup is window-level so a drag that ends outside the canvas still
  // releases dragState cleanly.
  window.addEventListener("mouseup", onOverlayMouseUp);
  overlayEl.addEventListener("mousemove", onOverlayMouseMove);
  overlayEl.addEventListener("mouseleave", onOverlayMouseLeave);
  stageEl.addEventListener("mousedown", onStagePointerDown);
  // Pointer-up needs to be window-level so a drag that ends outside the
  // canvas still releases pan state cleanly.
  window.addEventListener("mousemove", onStagePointerMove);
  window.addEventListener("mouseup",   onStagePointerUp);
  stageEl.addEventListener("wheel", onWheel, { passive: false });
  // Suppress the default middle-click "auto-scroll" cursor that some
  // browsers attach to mousedown without preventDefault.
  stageEl.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

  window.addEventListener("resize", () => {
    if (!isViewerOpen()) return;
    // Keep the page roughly centred without re-fitting (preserves the
    // user's chosen zoom across browser-window resizes).
    drawOverlay();
  });

  // ───────── Public API ─────────
  // Called by reviewer.js / app.js after the analysis JSON loads. Reveals
  // the launcher button when `meta.file_paths.pdf_measurement` exists, and
  // wires the click → openViewer to the right URL.
  window.__configureMeasurementViewer = function (analysisId, meta) {
    if (!launcherBtn) return;
    const paths = (meta && meta.file_paths) || {};
    const has = !!paths.pdf_measurement;
    launcherBtn.hidden = !has;
    if (!has) return;
    const url = `/api/analyses/${encodeURIComponent(analysisId)}/files/pdf_measurement`;
    const filename = paths.pdf_measurement_filename || "measurement.pdf";
    // Replace any prior handler; arrow function captures the new url+name.
    launcherBtn.onclick = () => openViewerRoute(url, filename);

    // Deep-link support: if the URL already has ?measure=1 on first paint,
    // open the viewer immediately. Replace state (instead of pushing) so
    // the back button takes the user out to whatever was before this page
    // rather than first popping the modal then leaving the app.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("measure") === "1" && !isViewerOpen()) {
        history.replaceState({ mvOpen: true, pdfUrl: url, filename }, "", window.location.href);
        openViewer(url, filename);
      }
    } catch { /* same-origin sandbox guard */ }
  };

  // Expose for manual testing in the console.
  window.__openMeasurementViewer = openViewerRoute;
})();
