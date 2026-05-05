/* =================================================================
   Overview dashboard — manager view
   Filter-driven rendering: changing a period pill, area, basin, type,
   or status recomputes the entire view (KPIs, charts, tables, map)
   from a single computeView(state) function.
   ================================================================= */
(function () {
  "use strict";

  if (!window.SASession) return;

  const $ = (id) => document.getElementById(id);

  // ===================================================================
  // TOKENS
  // ===================================================================
  const COLORS = {
    brand:   "#2563eb",
    brandLt: "#93c5fd",
    success: "#059669",
    warn:    "#b45309",
    warnLt:  "#fde68a",
    amber:   "#f59e0b",
    error:   "#b91c1c",
    gray:    "#94a3b8",
    purple:  "#8b5cf6",
    indigo:  "#6366f1",
  };

  const MONTHS_AR_LONG = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران",
                          "تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];
  const MONTHS_AR_SHORT = ["كانون ٢","شباط","آذار","نيسان","أيار","حزيران",
                           "تموز","آب","أيلول","تشرين ١","تشرين ٢","كانون ١"];

  // ===================================================================
  // BASE DATASET — annualized, all-areas baseline.
  // Filters scale these via multipliers in computeView().
  // ===================================================================
  const NEIGHBORHOODS = [
    { name: "الجبيهة",      weight: 0.115, fineRate: 0.65, violationPct: 24, x: 38, y: 30 },
    { name: "الصويفية",     weight: 0.097, fineRate: 0.94, violationPct: 31, x: 52, y: 58 },
    { name: "تلاع العلي",   weight: 0.091, fineRate: 0.61, violationPct: 22, x: 30, y: 42 },
    { name: "العبدلي",      weight: 0.080, fineRate: 1.10, violationPct: 38, x: 60, y: 45 },
    { name: "الأندلس",      weight: 0.070, fineRate: 0.49, violationPct: 19, x: 72, y: 30 },
    { name: "دابوق",        weight: 0.063, fineRate: 0.71, violationPct: 26, x: 22, y: 60 },
    { name: "خلدا",         weight: 0.060, fineRate: 0.50, violationPct: 21, x: 42, y: 70 },
    { name: "مرج الحمام",   weight: 0.054, fineRate: 0.65, violationPct: 25, x: 48, y: 82 },
    { name: "الياسمين",     weight: 0.047, fineRate: 0.45, violationPct: 18, x: 68, y: 70 },
    { name: "ضاحية الرشيد", weight: 0.043, fineRate: 0.55, violationPct: 22, x: 80, y: 50 },
    { name: "طبربور",       weight: 0.030, fineRate: 0.42, violationPct: 20, x: 55, y: 18 },
    { name: "جبل عمان",     weight: 0.026, fineRate: 0.78, violationPct: 28, x: 64, y: 36 },
  ];
  // Total weight ≈ 0.776; remainder represents "other" small areas.
  const NB_WEIGHT_SUM = NEIGHBORHOODS.reduce((a, n) => a + n.weight, 0);

  const BASINS = [
    { name: "الحنو",            village: "اليادودة",  weight: 0.034, avgArea: 612 },
    { name: "مرج الاجرب",       village: "اليادودة",  weight: 0.030, avgArea: 845 },
    { name: "الياسمين الشمالي",  village: "اليادودة",  weight: 0.028, avgArea: 720 },
    { name: "أم البساتين",      village: "ناعور",     weight: 0.023, avgArea: 1240 },
    { name: "القنيطرة الغربية",  village: "القنيطرة",  weight: 0.020, avgArea: 980 },
    { name: "تلاع العلي الشرقي", village: "تلاع العلي", weight: 0.018, avgArea: 540 },
    { name: "الجيزة الجنوبية",   village: "الجيزة",    weight: 0.017, avgArea: 1580 },
    { name: "الموقر الأوسط",     village: "الموقر",    weight: 0.015, avgArea: 2100 },
    { name: "أبو نصير الشمالي",  village: "ناعور",     weight: 0.013, avgArea: 760 },
    { name: "الموقر الغربي",     village: "الموقر",    weight: 0.011, avgArea: 1880 },
  ];
  const BASIN_WEIGHT_SUM = BASINS.reduce((a, b) => a + b.weight, 0);

  const APP_TYPES = [
    { label: "ترخيص مقترح على أرض خالية",                weight: 0.295 },
    { label: "الاستشارة (موافقة مبدئية)",                  weight: 0.211 },
    { label: "إذن إشغال",                                   weight: 0.145 },
    { label: "ترخيص مقترح فوق قائم",                        weight: 0.115 },
    { label: "تجديد إذن إشغال",                            weight: 0.081 },
    { label: "ترخيص مخطط تعديلي",                          weight: 0.063 },
    { label: "ترخيص زيادات",                                weight: 0.050 },
    { label: "استشارة فنية",                                weight: 0.042 },
    { label: "ترخيص زيادات + إذن إشغال",                   weight: 0.034 },
    { label: "ترخيص مساحات قائمة وإذن إشغال",              weight: 0.023 },
    { label: "بناء قائم لأول مرة",                          weight: 0.018 },
    { label: "إلغاء ترخيص مقترح",                           weight: 0.013 },
    { label: "تصحيح وثيقة إذن الإشغال",                     weight: 0.010 },
    { label: "تصحيح وثيقة تجديد إذن الإشغال",               weight: 0.0075 },
    { label: "مصادرة تأمينات",                              weight: 0.006 },
    { label: "إعادة النظر بقرار لجنة التخطيط المركزية",    weight: 0.0042 },
    { label: "أخرى",                                        weight: 0.0025 },
  ];

  const STATUS_KEYS = ["approved", "pending", "needsRev", "rejected", "draft"];
  const STATUS_LABEL_AR = {
    approved: "موافق عليها",
    pending:  "قيد المراجعة",
    needsRev: "بحاجة تعديل",
    rejected: "مرفوضة",
    draft:    "مسودة",
  };
  const STATUS_LABEL_TO_KEY = {
    "موافق عليها": "approved",
    "قيد المراجعة": "pending",
    "بحاجة تعديل":  "needsRev",
    "مرفوضة":       "rejected",
  };

  // Annual baseline (period=365, area=all, type=all, status=all)
  const BASE = {
    annualTotal: 4237,
    statusShares: {
      approved: 0.624,
      pending:  0.097,
      needsRev: 0.085,
      rejected: 0.054,
      draft:    0.140,
    },
    fineRatePerApp: 115,    // average JD per app, averaged across all areas
    avgWaitDays:    2.3,
    avgReviewDays:  3.7,
    aiAccuracy:     94.6,
  };

  const TOP_FINE_POOL = [
    { owner: "أحمد ياسر القضاة",     area: "العبدلي",     type: "ترخيص مقترح فوق قائم",     violation: "تجاوز حدود القطعة + ارتداد خلفي", fine: 38400, status: "rejected" },
    { owner: "ليلى عبدالرحمن خليل",  area: "الصويفية",    type: "ترخيص مقترح على أرض خالية", violation: "ارتداد أمامي + تغطية",            fine: 27600, status: "needs_revision" },
    { owner: "محمد إبراهيم العمري",  area: "الجبيهة",     type: "ترخيص زيادات",              violation: "ارتداد جانبي على شارعين",         fine: 22150, status: "needs_revision" },
    { owner: "فهد سامي الحياري",     area: "تلاع العلي",  type: "بناء قائم لأول مرة",        violation: "تجاوز نسبة الطابقية",             fine: 19850, status: "pending" },
    { owner: "نور الدين أبو غزالة",  area: "دابوق",       type: "ترخيص مقترح فوق قائم",      violation: "ارتداد خلفي",                      fine: 17200, status: "approved" },
    { owner: "سلمى الحمود الزعبي",   area: "العبدلي",     type: "ترخيص مخطط تعديلي",         violation: "تجاوز نسبة التغطية",              fine: 14920, status: "approved" },
    { owner: "زاهي البطاينة",         area: "الجبيهة",     type: "ترخيص مقترح على أرض خالية", violation: "ارتداد أمامي ٣م",                  fine: 12300, status: "needs_revision" },
    { owner: "رنا محمد الكلوب",       area: "خلدا",        type: "ترخيص زيادات",              violation: "ارتداد جانبي",                     fine: 11050, status: "approved" },
    { owner: "عمر القضاة الفايز",     area: "الصويفية",    type: "إذن إشغال",                  violation: "تجاوز نسبة الطابقية",             fine: 10780, status: "rejected" },
    { owner: "هند الفقيه",            area: "تلاع العلي",  type: "ترخيص مقترح فوق قائم",      violation: "ارتداد خلفي ٤م",                   fine:  9420, status: "pending" },
    { owner: "تامر محمود السرحان",    area: "ضاحية الرشيد", type: "ترخيص مقترح على أرض خالية", violation: "ارتداد أمامي",                     fine:  8950, status: "needs_revision" },
    { owner: "ربى صالح القاسم",       area: "مرج الحمام",  type: "ترخيص زيادات",              violation: "تغطية + طابقية",                   fine:  8420, status: "rejected" },
    { owner: "خلود إبراهيم البشير",   area: "الياسمين",    type: "إذن إشغال",                  violation: "ارتداد جانبي",                     fine:  7180, status: "approved" },
    { owner: "أيمن طارق الحوراني",    area: "جبل عمان",    type: "ترخيص مقترح فوق قائم",      violation: "تجاوز نسبة التغطية",              fine:  6840, status: "pending" },
    { owner: "ميساء النوري",          area: "دابوق",       type: "ترخيص مخطط تعديلي",         violation: "ارتداد أمامي ٤م",                  fine:  6300, status: "approved" },
  ];

  // Fallback centroids when OSM boundary is unavailable
  // Approximate centroids for the dashboard's twelve mock neighbourhoods,
  // spaced so polygons don't overlap on the choropleth. Coordinates are in
  // WGS-84 (lat, lng); seeds drive the per-vertex jitter so each district
  // gets a distinct irregular outline that's stable across renders.
  const _NB_CENTERS = [
    { name: "دابوق",         lat: 32.005, lng: 35.808, seed:  17 },
    { name: "ضاحية الرشيد",  lat: 31.985, lng: 35.838, seed:  23 },
    { name: "تلاع العلي",    lat: 31.998, lng: 35.870, seed:  31 },
    { name: "الجبيهة",       lat: 32.030, lng: 35.882, seed:  41 },
    { name: "الأندلس",       lat: 32.015, lng: 35.918, seed:  53 },
    { name: "طبربور",        lat: 32.025, lng: 35.953, seed:  67 },
    { name: "خلدا",          lat: 31.960, lng: 35.835, seed:  79 },
    { name: "الصويفية",      lat: 31.945, lng: 35.872, seed:  89 },
    { name: "العبدلي",       lat: 31.968, lng: 35.916, seed:  97 },
    { name: "جبل عمان",      lat: 31.940, lng: 35.940, seed: 109 },
    { name: "مرج الحمام",    lat: 31.913, lng: 35.840, seed: 127 },
    { name: "الياسمين",      lat: 31.882, lng: 35.910, seed: 137 },
  ];

  // Generate an irregular ~2.4 km wide polygon for a neighbourhood: 11
  // vertices on an ellipse with radii (rLng, rLat), each pulled in/out by
  // a seeded jitter so districts read as hand-drawn rather than circular.
  function _buildHoodPolygon(lat, lng, rLng, rLat, seed) {
    const N = 11;
    let s = (seed | 0) || 1;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const ring = [];
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * Math.PI;
      const j = 0.85 + rng() * 0.30;
      ring.push([
        +(lng + rLng * j * Math.cos(angle)).toFixed(4),
        +(lat + rLat * j * Math.sin(angle)).toFixed(4),
      ]);
    }
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
  }

  const NEIGHBORHOOD_COORDS = Object.fromEntries(
    _NB_CENTERS.map((c) => [c.name, { lat: c.lat, lng: c.lng }])
  );

  // Hardcoded outer urban Amman boundary (irregular polygon approximating GAM's
  // built-up extent). Used as a thin dashed outline; doesn't need to be exact.
  const AMMAN_OUTER_GEOJSON = {
    type: "Polygon",
    coordinates: [[
      [35.778, 32.020], [35.795, 31.985], [35.810, 31.945], [35.825, 31.910],
      [35.840, 31.880], [35.860, 31.860], [35.885, 31.852], [35.910, 31.858],
      [35.935, 31.872], [35.960, 31.890], [35.985, 31.905], [36.005, 31.925],
      [36.020, 31.952], [36.030, 31.978], [36.038, 32.005], [36.030, 32.035],
      [36.012, 32.060], [35.985, 32.078], [35.955, 32.088], [35.920, 32.092],
      [35.885, 32.090], [35.852, 32.082], [35.822, 32.068], [35.798, 32.050],
      [35.785, 32.035], [35.778, 32.020]
    ]],
  };

  const NEIGHBORHOOD_GEOJSON = Object.fromEntries(
    _NB_CENTERS.map((c) => [c.name, _buildHoodPolygon(c.lat, c.lng, 0.013, 0.011, c.seed)])
  );

  // ===================================================================
  // STATE
  // ===================================================================
  const STATE = {
    period:      "365",
    area:        "all",
    basin:       "all",
    type:        "all",
    status:      "all",
    granularity: null,            // overrides default per period when user clicks
    geoView:     "neighborhoods", // "neighborhoods" | "basins"
    geoPanel:    "list",          // "list" | "pie" | "map"
    typesPanel:  "list",          // "list" | "pie"
    charts:      {},
  };

  // ===================================================================
  // HELPERS
  // ===================================================================
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  function toAr(s)        { return String(s).replace(/[0-9]/g, (g) => AR_DIGITS[+g]); }
  function arNum(n)       { return toAr(Math.round(n).toLocaleString("en-US")); }
  function arPct(n, dp=1) { return toAr(n.toFixed(dp)) + "٪"; }
  function arJD(n)        { return arNum(n) + " د.أ"; }

  function hexA(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function seededRand(seed) {
    let s = (seed | 0) || 1;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function periodMult(p) {
    return p === "30"  ? 30 / 365
         : p === "90"  ? 90 / 365
         : p === "365" ? 1
         :              730 / 365;   // "all" → ~2 years
  }
  function defaultGranularity(p) {
    return p === "30"  ? "day"
         : p === "90"  ? "week"
         : p === "365" ? "month"
         :              "quarter";
  }
  function effectiveGranularity() {
    return STATE.granularity || defaultGranularity(STATE.period);
  }
  function neighborhoodWeight(name) {
    const n = NEIGHBORHOODS.find((x) => x.name === name);
    return n ? n.weight : 0.04;
  }
  function basinWeight(name) {
    const b = BASINS.find((x) => x.name === name);
    return b ? b.weight : 0.012;
  }
  function typeWeight(label) {
    const t = APP_TYPES.find((x) => x.label === label);
    return t ? t.weight : 0.05;
  }
  function statusKey(label) {
    return STATUS_LABEL_TO_KEY[label] || null;
  }
  function periodLabelLong() {
    return STATE.period === "30"  ? "خلال ٣٠ يومًا"
         : STATE.period === "90"  ? "خلال ٩٠ يومًا"
         : STATE.period === "365" ? "خلال ١٢ شهرًا"
         :                          "منذ بداية التشغيل";
  }

  // ===================================================================
  // COMPUTE VIEW — single source of truth for everything rendered
  // ===================================================================
  function computeView() {
    const pm    = periodMult(STATE.period);
    const am    = STATE.area  === "all" ? 1 : neighborhoodWeight(STATE.area);
    const bm    = STATE.basin === "all" ? 1 : basinWeight(STATE.basin) / 0.18;  // basin scoped narrowly
    const tm    = STATE.type  === "all" ? 1 : typeWeight(STATE.type);
    const skey  = statusKey(STATE.status);
    const sm    = skey == null ? 1 : BASE.statusShares[skey];

    const focusFine =
      STATE.area === "all"
        ? 1
        : NEIGHBORHOODS.find((x) => x.name === STATE.area)?.fineRate ?? 0.6;

    const totalApps = Math.max(8, Math.round(BASE.annualTotal * pm * am * bm * tm * sm));

    // Status counts
    let statuses;
    if (skey) {
      statuses = { approved: 0, pending: 0, needsRev: 0, rejected: 0, draft: 0 };
      statuses[skey] = totalApps;
    } else {
      statuses = {
        approved: Math.round(totalApps * BASE.statusShares.approved),
        pending:  Math.round(totalApps * BASE.statusShares.pending),
        needsRev: Math.round(totalApps * BASE.statusShares.needsRev),
        rejected: Math.round(totalApps * BASE.statusShares.rejected),
        draft:    Math.round(totalApps * BASE.statusShares.draft),
      };
    }

    const fines = Math.round(totalApps * BASE.fineRatePerApp * focusFine);

    // Seeded wobble for "stable randomness" per filter combination
    const seed = hashStr(STATE.period + STATE.area + STATE.basin + STATE.type + STATE.status);
    const rand = seededRand(seed);
    const wob = (range) => (rand() - 0.5) * 2 * range;

    const totalDelta    = +(12.4 + wob(5)).toFixed(1);
    const approvalPct   = +(78.4 + wob(3.5)).toFixed(1);
    const approvalDelta = +(3.1 + wob(1.4)).toFixed(1);
    const finesDelta    = +(8.1 + wob(4.5)).toFixed(1);
    const reviewDays    = +(3.7 + wob(0.45)).toFixed(2);
    const reviewDelta   = +(-14.2 + wob(3.5)).toFixed(1);
    const aiAccuracy    = +(94.6 + wob(1.3)).toFixed(1);
    const waitDays      = +(2.3 + wob(0.45)).toFixed(1);

    const timeSeries = buildTimeSeries(statuses, skey);
    const sparkSeries = buildSparkSeries(totalApps, fines, reviewDays, aiAccuracy, statuses);

    // Types — when type filter active, all weight goes to that one
    const types = APP_TYPES.map((t) => ({
      label: t.label,
      count:
        STATE.type === "all"
          ? Math.round(totalApps * t.weight)
          : t.label === STATE.type
            ? totalApps
            : 0,
    })).filter((t) => t.count > 0);

    // Neighborhoods table data
    let neighborhoods;
    if (STATE.area === "all") {
      neighborhoods = NEIGHBORHOODS.map((n) => {
        const c = Math.round(totalApps * (n.weight / NB_WEIGHT_SUM));
        return {
          name: n.name,
          count: c,
          fines: Math.round(c * BASE.fineRatePerApp * n.fineRate),
          violationPct: Math.max(8, Math.min(46, Math.round(n.violationPct + wob(2)))),
        };
      });
    } else {
      const n = NEIGHBORHOODS.find((x) => x.name === STATE.area);
      neighborhoods = [
        {
          name: STATE.area,
          count: totalApps,
          fines: fines,
          violationPct: n ? n.violationPct : 24,
        },
      ];
    }

    // Basins table data
    let basins;
    if (STATE.basin === "all") {
      basins = BASINS.map((b) => ({
        name: b.name,
        village: b.village,
        count: Math.round(totalApps * (b.weight / BASIN_WEIGHT_SUM) * 0.6),
        avgArea: b.avgArea,
      }));
    } else {
      const b = BASINS.find((x) => x.name === STATE.basin);
      basins = [
        {
          name: STATE.basin,
          village: b ? b.village : "—",
          count: totalApps,
          avgArea: b ? b.avgArea : 800,
        },
      ];
    }

    // Map dots — always all neighborhoods, but dim non-focused when area filter is active
    const mapDots = NEIGHBORHOODS.map((n) => ({
      name: n.name,
      x: n.x,
      y: n.y,
      count:
        STATE.area === "all"
          ? Math.round(totalApps * (n.weight / NB_WEIGHT_SUM) * (1 / pm) * pm) // = count for the period
          : n.name === STATE.area
            ? totalApps
            : Math.round(BASE.annualTotal * pm * (n.weight / NB_WEIGHT_SUM)),
      isFocused: STATE.area === n.name,
      isDimmed:  STATE.area !== "all" && STATE.area !== n.name,
    }));

    // Violations donut — increase non-zero buckets when an area has higher violation rate
    const focusViolation =
      STATE.area === "all"
        ? 23.1
        : NEIGHBORHOODS.find((x) => x.name === STATE.area)?.violationPct ?? 23.1;
    const baseViols = [
      { label: "بدون مخالفات",        value: 76.9, color: COLORS.success },
      { label: "ارتداد جانبي",        value: 9.8,  color: COLORS.warn },
      { label: "ارتداد أمامي",        value: 6.4,  color: COLORS.amber },
      { label: "ارتداد خلفي",         value: 3.7,  color: COLORS.error },
      { label: "تجاوز نسبة التغطية",  value: 1.9,  color: COLORS.purple },
      { label: "تجاوز حدود القطعة",   value: 1.3,  color: "#7c2d12" },
    ];
    const scale = focusViolation / 23.1;
    const violations = baseViols.map((v, i) =>
      i === 0 ? { ...v, value: 100 - focusViolation } : { ...v, value: v.value * scale }
    );
    const vSum = violations.reduce((a, v) => a + v.value, 0);
    violations.forEach((v) => (v.value = (v.value / vSum) * 100));

    // Fines histogram — scales with total
    const fineMult = totalApps / BASE.annualTotal;
    const finesHist = {
      buckets: ["٠–٥٠٠", "٥٠٠–١٠٠٠", "١-٥ آلاف", "٥-١٠ آلاف", "١٠-٢٠ ألف", "أكثر من ٢٠ ألف"],
      counts:  [284, 412, 348, 156, 64, 21].map((n) => Math.max(0, Math.round(n * fineMult))),
    };

    // Top fines — filter by area when active, scale fine values by period
    const periodScale = Math.min(1.05, Math.max(0.4, Math.sqrt(pm)));
    const topFines = TOP_FINE_POOL
      .filter((f) => STATE.area === "all" || f.area === STATE.area)
      .filter((f) => STATE.type === "all" || f.type === STATE.type)
      .filter((f) => {
        if (STATE.status === "all") return true;
        const k = statusKey(STATE.status);
        return ({
          approved: "approved",
          pending:  "pending",
          needsRev: "needs_revision",
          rejected: "rejected",
        })[k] === f.status;
      })
      .slice(0, 5)
      .map((f) => ({ ...f, fine: Math.round(f.fine * periodScale) }));

    // Backlog age — only meaningful when there's pending; counts must sum to pending
    const backlogShare = [0.43, 0.34, 0.16, 0.06, 0.01];
    const totalPending = statuses.pending;
    const bRaw = backlogShare.map((s) => Math.round(totalPending * s));
    // fix rounding so sum exactly equals totalPending
    const drift = totalPending - bRaw.reduce((a, b) => a + b, 0);
    bRaw[0] += drift;
    const backlogAge = {
      buckets: ["٠–٣ أيام", "٤–٧ أيام", "٨–١٤ يومًا", "١٥–٣٠ يومًا", "أكثر من ٣٠ يومًا"],
      counts:  bRaw.map((n) => Math.max(0, n)),
    };

    const yoy = buildYoY();
    const reviewers = buildReviewers(totalApps);
    const aiInsights = buildAIInsights(totalApps, aiAccuracy, wob);
    const alerts = buildAlerts();

    return {
      totals: { totalApps, ...statuses, fines },
      kpis: {
        totalDelta, approvalPct, approvalDelta, finesDelta,
        reviewDays, reviewDelta, aiAccuracy, waitDays,
      },
      timeSeries, sparkSeries,
      types, neighborhoods, basins, mapDots,
      violations, finesHist, topFines, backlogAge,
      yoy, reviewers, aiInsights, alerts,
      lockedStatusKey: skey,
    };
  }

  // ===================================================================
  // TIME SERIES (volume bar) — granularity-aware
  // ===================================================================
  function bucketCount(gran, period) {
    if (gran === "day")     return period === "30" ? 30 : period === "90" ? 30 : 30;
    if (gran === "week")    return period === "30" ? 5  : period === "90" ? 13 : period === "365" ? 13 : 16;
    if (gran === "month")   return period === "30" ? 1  : period === "90" ? 3  : period === "365" ? 12 : 24;
    if (gran === "quarter") return period === "365" ? 4 : 8;
    return 12;
  }

  function bucketLabels(gran, n) {
    const today = new Date(2026, 4, 3); // 2026-05-03
    const labels = [];
    if (gran === "day") {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(toAr(d.getDate()) + " " + MONTHS_AR_SHORT[d.getMonth()].slice(0, 4));
      }
    } else if (gran === "week") {
      for (let i = n; i >= 1; i--) labels.push("أ-" + toAr(i));
    } else if (gran === "month") {
      for (let i = n - 1; i >= 0; i--) {
        const m  = (today.getMonth() - i + 12 * 12) % 12;
        const yr = today.getFullYear() + Math.floor((today.getMonth() - i) / 12);
        labels.push(MONTHS_AR_SHORT[m] + " " + toAr(String(yr).slice(-2)));
      }
    } else { // quarter
      for (let i = n - 1; i >= 0; i--) {
        const q     = Math.floor(today.getMonth() / 3) - i;
        const qIdx  = ((q % 4) + 4) % 4;
        const yrOff = Math.floor(q / 4);
        const yr    = today.getFullYear() + yrOff;
        labels.push("ر" + toAr(qIdx + 1) + " " + toAr(String(yr).slice(-2)));
      }
    }
    return labels;
  }

  function buildTimeSeries(statuses, lockedKey) {
    const gran = effectiveGranularity();
    const n = bucketCount(gran, STATE.period);
    const labels = bucketLabels(gran, n);
    const seed = hashStr(STATE.period + STATE.area + STATE.basin + STATE.type + STATE.status + gran);
    const rand = seededRand(seed);

    const series = {};
    STATUS_KEYS.forEach((k) => {
      if (lockedKey && k !== lockedKey) {
        series[k] = new Array(n).fill(0);
        return;
      }
      const total = statuses[k] || 0;
      const ws = [];
      for (let i = 0; i < n; i++) {
        const growth = 0.85 + (i / Math.max(1, n - 1)) * 0.40;  // 0.85 → 1.25
        const noise  = 0.85 + rand() * 0.30;                    // 0.85 → 1.15
        ws.push(growth * noise);
      }
      const wSum = ws.reduce((a, b) => a + b, 0);
      const dist = ws.map((w) => Math.round(total * (w / wSum)));
      // distribute rounding drift onto last bucket
      const drift = total - dist.reduce((a, b) => a + b, 0);
      dist[dist.length - 1] += drift;
      series[k] = dist.map((v) => Math.max(0, v));
    });

    return { labels, ...series };
  }

  function buildSparkSeries(total, fines, reviewDays, aiAccuracy, statuses) {
    const seed = hashStr(STATE.period + STATE.area + STATE.basin + STATE.type + STATE.status + "spark");
    const rand = seededRand(seed);
    const N = 12;
    const smooth = (start, end) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const noise = 0.93 + rand() * 0.14;
        out.push((start + (end - start) * t) * noise);
      }
      return out;
    };
    return {
      total:    smooth(total / (N * 1.6),    total / N).map((v) => Math.round(v)),
      pending:  smooth(statuses.pending / (N * 1.4), statuses.pending / N).map((v) => Math.round(v)),
      approval: smooth(71, 78.4).map((v) => +v.toFixed(1)),
      fines:    smooth(fines / (N * 1.8),    fines / N).map((v) => Math.round(v)),
      review:   smooth(reviewDays * 1.4, reviewDays).map((v) => +v.toFixed(2)),
      ai:       smooth(aiAccuracy - 6, aiAccuracy).map((v) => +v.toFixed(1)),
    };
  }

  function buildYoY() {
    const months = MONTHS_AR_SHORT;
    const seed = hashStr(STATE.area + STATE.basin + STATE.type + STATE.status + "yoy");
    const rand = seededRand(seed);
    const am = STATE.area === "all" ? 1 : (neighborhoodWeight(STATE.area) / NB_WEIGHT_SUM);
    const tm = STATE.type === "all" ? 1 : typeWeight(STATE.type);
    const sm = STATE.status === "all" ? 1 : BASE.statusShares[statusKey(STATE.status)];
    const baseMult = am * tm * sm;
    const y2024 = [198, 215, 226, 238, 247, 251, 263, 245, 271, 289, 304, 318]
      .map((v) => Math.max(2, Math.round(v * baseMult * (0.95 + rand() * 0.1))));
    const y2025 = [261, 278, 296, 314, 332, 341, 358, 372, 391, 412, 428, 447]
      .map((v) => Math.max(2, Math.round(v * baseMult * (0.96 + rand() * 0.08))));
    const forecastVals = [461, 489];
    const forecast = months.map((_, i) =>
      i < 10 ? null : Math.round(forecastVals[i - 10] * baseMult * (0.96 + rand() * 0.08))
    );
    return { months, y2024, y2025, forecast };
  }

  function buildReviewers(totalApps) {
    const base = [
      { name: "إيمان الزعبي",    initials: "إز", reviews: 187, avgDays: 2.8, approvalPct: 81 },
      { name: "خالد الفايز",     initials: "خف", reviews: 164, avgDays: 3.4, approvalPct: 76 },
      { name: "ميسون عبيدات",    initials: "مع", reviews: 152, avgDays: 3.1, approvalPct: 79 },
      { name: "زيد العواملة",    initials: "زع", reviews: 138, avgDays: 4.2, approvalPct: 72 },
      { name: "ندى الكساسبة",    initials: "نك", reviews: 124, avgDays: 2.5, approvalPct: 84 },
      { name: "هاني الخواجا",    initials: "هخ", reviews:  98, avgDays: 3.6, approvalPct: 74 },
    ];
    const m = totalApps / BASE.annualTotal;
    return base
      .map((r) => ({ ...r, reviews: Math.max(2, Math.round(r.reviews * m)) }))
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 5);
  }

  function buildAIInsights(totalApps, aiAcc, wob) {
    const m = totalApps / BASE.annualTotal;
    return [
      { label: "مخالفات اكتشفها الذكاء قبل المراجع",  num: arNum(Math.max(1, Math.round(1247 * m))), sub: periodLabelLong() },
      { label: "ساعات عمل مراجعة موفّرة",              num: arNum(Math.max(1, Math.round(2860 * m))), sub: "بمعدل ٤٢ دقيقة لكل طلب" },
      { label: "وثائق خاطئة أوقفها قبل المراجعة",     num: arNum(Math.max(1, Math.round(318 * m))),  sub: "سند، مخطط تنظيمي، أو طوابقي" },
      { label: "تطابق الأرقام بين السند والمخطط",     num: arPct(97.4 + wob(0.4), 1),                sub: "كشف عدم تطابق رقم القطعة" },
    ];
  }

  function buildAlerts() {
    const focus = STATE.area === "all" ? "العبدلي" : STATE.area;
    const all = [
      { sev: "warn", title: "ارتفاع غير اعتيادي في طلبات حي " + focus,
        sub: "زيادة ٤٧٪ خلال آخر ٧ أيام مقارنة بالمتوسط", time: "قبل ٣ ساعات" },
      { sev: "err",  title: "٦ طلبات تجاوزت SLA المحدد ١٤ يومًا",
        sub: STATE.area === "all"
          ? "تتطلب تدخل المدير المسؤول — ضاحية الرشيد، طبربور"
          : "تتطلب تدخل المدير المسؤول — " + STATE.area,
        time: "قبل ٥ ساعات" },
      { sev: "info", title: "تنبيه ذكي: نمط مخالفات متكرر",
        sub: STATE.area === "all"
          ? "٤٢٪ من طلبات شارع الياسمين تخالف الارتداد الأمامي ٥م"
          : "٤٢٪ من طلبات " + STATE.area + " تخالف الارتداد الأمامي ٥م",
        time: "اليوم" },
      { sev: "ok",   title: "اكتمال مراجعة دفعة الأسبوع",
        sub: "تم إغلاق ٢٣٤ طلبًا بمعدل أسرع بـ ١٢٪ من المعتاد", time: "أمس" },
      { sev: "warn", title: "وثائق ناقصة في ١٤ طلبًا جديدًا",
        sub: "غالبًا مخطط موقع تنظيمي أو سند تسجيل", time: "أمس" },
    ];
    return all;
  }

  // ===================================================================
  // CHART.JS DEFAULTS
  // ===================================================================
  Chart.defaults.font.family = "'Inter', 'Noto Kufi Arabic', sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = "#475569";
  Chart.defaults.plugins.legend.display = false;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: "rgba(15,23,42,.96)",
    titleColor: "#fff",
    bodyColor: "#e2e8f0",
    padding: 10,
    cornerRadius: 8,
    titleFont: { size: 12, weight: "600" },
    bodyFont: { size: 11.5 },
    boxPadding: 6,
    rtl: true,
    textDirection: "rtl",
  });

  function setChart(id, ctxId, config) {
    const el = $(ctxId);
    if (!el) return;
    if (STATE.charts[id]) {
      try { STATE.charts[id].destroy(); } catch (_) {}
      delete STATE.charts[id];
    }
    STATE.charts[id] = new Chart(el, config);
  }

  // ===================================================================
  // NUMBER ANIMATION
  // ===================================================================
  function animateNumber(el, to, formatter, durationMs) {
    if (!el) return;
    const dur = durationMs || 600;
    const fromAttr = el.dataset.value ? parseFloat(el.dataset.value) : NaN;
    const from = Number.isFinite(fromAttr) ? fromAttr : 0;
    // Skip animation if no change OR tab is hidden (RAF is throttled when hidden,
    // which would leave the cell stuck on its initial placeholder).
    if (Math.abs(to - from) < 0.001 || document.hidden) {
      el.textContent = formatter(to);
      el.dataset.value = String(to);
      return;
    }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * ease(t);
      el.textContent = formatter(v);
      if (t < 1) requestAnimationFrame(step);
      else      el.dataset.value = String(to);
    }
    requestAnimationFrame(step);
  }

  // If the tab was hidden during initial render, re-render once it becomes
  // visible so the animations actually play.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      const view = computeView();
      renderKpis(view);
    }
  });

  function setDelta(elId, n, reverseGood) {
    const el = $(elId);
    if (!el) return;
    const positive = n >= 0;
    const isGood = reverseGood ? !positive : positive;
    el.classList.remove("ov-delta--up", "ov-delta--bad", "ov-delta--down");
    el.classList.add(isGood ? "ov-delta--up" : "ov-delta--bad");
    el.textContent = (positive ? "▲ " : "▼ ") + toAr(Math.abs(n).toFixed(1)) + "٪";
  }

  // ===================================================================
  // RENDERERS
  // ===================================================================
  function renderKpis(view) {
    animateNumber($("kpi-total"),       view.totals.totalApps,   (v) => arNum(v));
    animateNumber($("kpi-pending"),     view.totals.pending,     (v) => arNum(v));
    animateNumber($("kpi-approval"),    view.kpis.approvalPct,   (v) => arPct(v, 1));
    animateNumber($("kpi-fines"),       view.totals.fines,       (v) => arJD(v));
    animateNumber($("kpi-review-days"), view.kpis.reviewDays,    (v) => toAr(v.toFixed(1)) + " يوم");
    animateNumber($("kpi-ai"),          view.kpis.aiAccuracy,    (v) => arPct(v, 1));

    $("kpi-pending-wait").textContent = toAr(view.kpis.waitDays.toFixed(1)) + " يوم";

    setDelta("kpi-total-delta",    view.kpis.totalDelta);
    setDelta("kpi-approval-delta", view.kpis.approvalDelta);
    setDelta("kpi-fines-delta",    view.kpis.finesDelta);          // up = bigger number, neutral framing
    setDelta("kpi-review-delta",   view.kpis.reviewDelta, true);   // negative = faster = good

    const compact = (v) => {
      const a = Math.abs(v);
      if (a >= 1e6) return toAr((v / 1e6).toFixed(1)) + "م";
      if (a >= 1e3) return toAr(Math.round(v / 1e3)) + "ك";
      return toAr(Math.round(v).toLocaleString("en-US"));
    };
    spark("spark-total",    view.sparkSeries.total,    COLORS.brand,   { tick: compact, tip: (v) => arNum(v) + " طلب" });
    spark("spark-pending",  view.sparkSeries.pending,  COLORS.warn,    { tick: compact, tip: (v) => arNum(v) + " طلب" });
    spark("spark-approval", view.sparkSeries.approval, COLORS.success, { tick: (v) => toAr(Math.round(v)) + "٪", tip: (v) => arPct(v, 1) });
    spark("spark-fines",    view.sparkSeries.fines,    COLORS.error,   { tick: compact, tip: (v) => arJD(v) });
    spark("spark-review",   view.sparkSeries.review,   COLORS.success, { tick: (v) => toAr(v.toFixed(1)), tip: (v) => toAr(v.toFixed(1)) + " يوم" });
    spark("spark-ai",       view.sparkSeries.ai,       COLORS.purple,  { tick: (v) => toAr(Math.round(v)) + "٪", tip: (v) => arPct(v, 1) });
  }

  // 12-month label series matching spark data (oldest → newest, ending in current month)
  function sparkMonthLabels(n) {
    const today = new Date(2026, 4, 3);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      out.push(MONTHS_AR_SHORT[d.getMonth()]);
    }
    return out;
  }

  function spark(id, data, color, fmt) {
    const lastIdx = data.length - 1;
    const minV = Math.min.apply(null, data);
    const maxV = Math.max.apply(null, data);
    const range = maxV - minV || Math.max(1, Math.abs(maxV) * 0.1);
    const yMin = minV - range * 0.20;
    const yMax = maxV + range * 0.25;

    const tickFmt = (fmt && fmt.tick) || ((v) => toAr(Math.round(v).toLocaleString("en-US")));
    const tipFmt  = (fmt && fmt.tip)  || ((v) => toAr(Math.round(v).toLocaleString("en-US")));

    setChart(id, id, {
      type: "line",
      data: {
        labels: sparkMonthLabels(data.length),
        datasets: [{
          data,
          borderColor: color,
          borderWidth: 2,
          borderJoinStyle: "round",
          borderCapStyle: "round",
          backgroundColor: (ctx) => {
            const { ctx: cv, chartArea } = ctx.chart;
            if (!chartArea) return hexA(color, 0.18);
            const g = cv.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, hexA(color, 0.30));
            g.addColorStop(0.55, hexA(color, 0.08));
            g.addColorStop(1, hexA(color, 0));
            return g;
          },
          fill: "start",
          tension: 0.38,
          pointRadius:           data.map((_, i) => (i === lastIdx ? 3.2 : 0)),
          pointBackgroundColor:  data.map((_, i) => (i === lastIdx ? color : "rgba(0,0,0,0)")),
          pointBorderColor:      data.map((_, i) => (i === lastIdx ? "#fff" : "rgba(0,0,0,0)")),
          pointBorderWidth:      1.6,
          pointHoverRadius: 4.5,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 2,
          pointHitRadius: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutCubic" },
        layout: { padding: { top: 4, bottom: 0, left: 0, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            padding: 7,
            callbacks: {
              title: (items) => (items[0] && items[0].label) || "",
              label: (c) => " " + tipFmt(c.parsed.y),
            },
          },
        },
        scales: {
          x: {
            display: true,
            offset: false,
            grid: { display: false, drawBorder: false },
            border: { color: "rgba(15,23,42,.10)" },
            ticks: {
              font: { size: 9.5 },
              color: "#94a3b8",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 4,
              padding: 2,
            },
          },
          y: {
            display: true,
            min: yMin,
            max: yMax,
            grid: { color: "rgba(15,23,42,.05)", drawTicks: false },
            border: { display: false },
            ticks: {
              font: { size: 9.5 },
              color: "#94a3b8",
              maxTicksLimit: 3,
              padding: 4,
              callback: (v) => tickFmt(v),
            },
          },
        },
        interaction: { mode: "index", intersect: false },
        elements: { line: { capBezierPoints: true } },
      },
    });
  }

  function renderVolume(view) {
    const ts = view.timeSeries;
    setChart("volume", "chart-volume", {
      type: "bar",
      data: {
        labels: ts.labels,
        datasets: [
          { label: "موافق عليها",  data: ts.approved, backgroundColor: COLORS.success, borderRadius: 4 },
          { label: "قيد المراجعة", data: ts.pending,  backgroundColor: COLORS.amber,   borderRadius: 4 },
          { label: "بحاجة تعديل",  data: ts.needsRev, backgroundColor: COLORS.warn,    borderRadius: 4 },
          { label: "مرفوضة",        data: ts.rejected, backgroundColor: COLORS.error,   borderRadius: 4 },
          { label: "مسودة",         data: ts.draft,    backgroundColor: COLORS.gray,    borderRadius: 4 },
        ].filter((d) => d.data.some((v) => v > 0)),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { boxWidth: 12, padding: 14, usePointStyle: true, pointStyle: "rectRounded" },
          },
          tooltip: {
            callbacks: {
              label: (c) => " " + c.dataset.label + " · " + arNum(c.parsed.y),
              footer: (items) =>
                "المجموع · " + arNum(items.reduce((a, c) => a + c.parsed.y, 0)),
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false },
               ticks: { font: { size: 10.5 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
          y: { stacked: true, grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toAr(v) } },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  }

  function renderStatusDonut(view) {
    const t = view.totals;
    const sum = t.totalApps;
    animateNumber($("donut-num"), sum, (v) => arNum(v));
    const slices = [
      { lbl: "موافق عليها",  val: t.approved, color: COLORS.success, key: "موافق عليها" },
      { lbl: "قيد المراجعة", val: t.pending,  color: COLORS.amber,   key: "قيد المراجعة" },
      { lbl: "بحاجة تعديل",  val: t.needsRev, color: COLORS.warn,    key: "بحاجة تعديل" },
      { lbl: "مرفوضة",        val: t.rejected, color: COLORS.error,   key: "مرفوضة" },
      { lbl: "مسودة",         val: t.draft,    color: COLORS.gray,    key: null },
    ].filter((s) => s.val > 0);

    setChart("status", "chart-status", {
      type: "doughnut",
      data: {
        labels: slices.map((s) => s.lbl),
        datasets: [{
          data: slices.map((s) => s.val),
          backgroundColor: slices.map((s) => s.color),
          borderColor: "#fff",
          borderWidth: 2,
          hoverBorderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        animation: { duration: 700 },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => " " + c.label + " · " + arNum(c.parsed) + " (" + arPct(c.parsed / sum * 100, 1) + ")",
            },
          },
        },
        onClick: (_, els) => {
          if (!els.length) return;
          const slice = slices[els[0].index];
          if (slice && slice.key) {
            $("ov-filter-status").value = slice.key;
            STATE.status = slice.key;
            applyFiltersAndRender();
          }
        },
      },
    });

    const legend = $("legend-status");
    legend.innerHTML = "";
    slices.forEach((s) => {
      const li = document.createElement("li");
      const isLocked = STATE.status !== "all" && s.key === STATE.status;
      li.className = "ov-legend-clickable" + (isLocked ? " ov-legend-active" : "");
      li.innerHTML = `
        <span class="ov-legend-dot" style="background:${s.color}"></span>
        <span>${s.lbl}</span>
        <span class="ov-legend-num">${arNum(s.val)}</span>
        <span class="ov-legend-pct">${arPct(s.val / sum * 100, 1)}</span>
      `;
      if (s.key) {
        li.addEventListener("click", () => {
          STATE.status = (STATE.status === s.key) ? "all" : s.key;
          $("ov-filter-status").value = STATE.status;
          applyFiltersAndRender();
        });
      }
      legend.appendChild(li);
    });
  }

  // Categorical palette for pie charts — distinct hues, ordered for contrast
  // between adjacent slices.
  const PIE_PALETTE = [
    "#2563eb", "#059669", "#b45309", "#b91c1c", "#8b5cf6",
    "#0891b2", "#c2410c", "#65a30d", "#db2777", "#7c3aed",
    "#0d9488", "#a16207", "#dc2626", "#4f46e5", "#16a34a",
    "#9333ea", "#475569",
  ];

  function renderTypesList(view) {
    const tbody = $("tbody-types");
    if (!tbody) return;
    const total = view.types.reduce((a, t) => a + t.count, 0) || 1;
    const max   = Math.max(...view.types.map((t) => t.count), 1);
    tbody.innerHTML = view.types.map((t) => {
      const isActive = STATE.type === t.label;
      const pct = (t.count / total * 100);
      return `
        <tr class="ov-row-clickable${isActive ? " ov-row-active" : ""}" data-type="${t.label}">
          <td><strong>${t.label}</strong></td>
          <td>
            <div class="ov-bar">
              <span class="ov-num">${arNum(t.count)}</span>
              <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${(t.count / max * 100).toFixed(1)}%"></div></div>
            </div>
          </td>
          <td><span class="ov-num">${arPct(pct, 1)}</span></td>
        </tr>
      `;
    }).join("");
    Array.from(tbody.querySelectorAll("tr.ov-row-clickable")).forEach((tr) => {
      tr.addEventListener("click", () => {
        const label = tr.getAttribute("data-type");
        STATE.type = (STATE.type === label) ? "all" : label;
        $("ov-filter-type").value = STATE.type;
        applyFiltersAndRender();
      });
    });
  }

  // Map slice index → palette color, with the active filter slice highlighted
  // in amber so the dashboard filter is visible alongside the categorical hues.
  function _pieColors(n, activeIdx) {
    return Array.from({ length: n }, (_, i) => {
      if (i === activeIdx) return "#f59e0b";
      return PIE_PALETTE[i % PIE_PALETTE.length];
    });
  }

  // Shared bottom-legend config: clickable, compact, wraps cleanly.
  // Default Chart.js click handler toggles slice visibility (strikethrough
  // legend label when hidden); we keep that behaviour as-is so the user can
  // add/remove categories from the chart.
  const PIE_LEGEND = {
    display: true,
    position: "bottom",
    align: "start",
    rtl: true,
    labels: {
      boxWidth: 10,
      boxHeight: 10,
      padding: 7,
      usePointStyle: true,
      pointStyle: "circle",
      font: { size: 11 },
      color: "#334155",
    },
  };

  function renderTypesPie(view) {
    const panel = $("ov-types-pie-panel");
    if (!panel || panel.hidden) return;
    const types = view.types;
    const activeIdx = STATE.type === "all" ? -1 : types.findIndex((t) => t.label === STATE.type);

    setChart("types-pie", "chart-types-pie", {
      type: "doughnut",
      data: {
        labels: types.map((t) => t.label),
        datasets: [{
          data: types.map((t) => t.count),
          backgroundColor: _pieColors(types.length, activeIdx),
          borderColor: "#fff",
          borderWidth: 2,
          hoverBorderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        animation: { duration: 700 },
        plugins: {
          legend: PIE_LEGEND,
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
                return " " + c.label + " · " + arNum(c.parsed) + " (" + arPct(c.parsed / total * 100, 1) + ")";
              },
            },
          },
        },
        // Filter-on-click only on the slice itself; legend keeps its
        // built-in toggle-visibility behaviour.
        onClick: (e, els, chart) => {
          if (e.native && e.native.target && e.native.target.closest("[role='listbox']")) return;
          if (!els.length) return;
          const label = types[els[0].index].label;
          STATE.type = (STATE.type === label) ? "all" : label;
          $("ov-filter-type").value = STATE.type;
          applyFiltersAndRender();
        },
      },
    });
  }

  function renderGeoPie(view) {
    const panel = $("ov-geo-pie-panel");
    if (!panel || panel.hidden) return;
    const isNb = STATE.geoView === "neighborhoods";
    const rows = isNb ? view.neighborhoods : view.basins;
    const activeKey = isNb ? STATE.area : STATE.basin;
    const stateField = isNb ? "area" : "basin";
    const filterId = isNb ? "ov-filter-area" : "ov-filter-basin";
    const activeIdx = activeKey === "all" ? -1 : rows.findIndex((r) => r.name === activeKey);

    setChart("geo-pie", "chart-geo-pie", {
      type: "doughnut",
      data: {
        labels: rows.map((r) => r.name),
        datasets: [{
          data: rows.map((r) => r.count),
          backgroundColor: _pieColors(rows.length, activeIdx),
          borderColor: "#fff",
          borderWidth: 2,
          hoverBorderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        animation: { duration: 700 },
        plugins: {
          legend: PIE_LEGEND,
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
                return " " + c.label + " · " + arNum(c.parsed) + " (" + arPct(c.parsed / total * 100, 1) + ")";
              },
            },
          },
        },
        onClick: (_, els) => {
          if (!els.length) return;
          const name = rows[els[0].index].name;
          STATE[stateField] = (activeKey === name) ? "all" : name;
          const sel = $(filterId);
          if (sel) sel.value = STATE[stateField];
          applyFiltersAndRender();
        },
      },
    });
  }

  function renderGeoTable(view) {
    const head = $("thead-geo");
    const body = $("tbody-geo");
    const sub  = $("geo-table-sub");
    head.innerHTML = "";
    body.innerHTML = "";
    if (STATE.geoView === "neighborhoods") {
      sub.textContent = "عدد الطلبات والغرامات لكل حي · انقر صفًا لتصفية كل اللوحة";
      head.innerHTML =
        "<tr><th>الحي</th><th>الطلبات</th><th>الغرامات</th><th>نسبة المخالفات</th></tr>";
      const max = Math.max(...view.neighborhoods.map((n) => n.count), 1);
      view.neighborhoods.forEach((n) => {
        const pctClass =
          n.violationPct > 30 ? "ov-status-pill--err" :
          n.violationPct > 22 ? "ov-status-pill--warn" : "ov-status-pill--ok";
        const isActive = STATE.area === n.name;
        const tr = document.createElement("tr");
        tr.className = "ov-row-clickable" + (isActive ? " ov-row-active" : "");
        tr.innerHTML = `
          <td><strong>${n.name}</strong></td>
          <td>
            <div class="ov-bar">
              <span class="ov-num">${arNum(n.count)}</span>
              <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${(n.count / max * 100).toFixed(1)}%"></div></div>
            </div>
          </td>
          <td class="ov-num">${arJD(n.fines)}</td>
          <td><span class="ov-status-pill ${pctClass}">${toAr(n.violationPct)}٪</span></td>
        `;
        tr.addEventListener("click", () => {
          STATE.area = (STATE.area === n.name) ? "all" : n.name;
          $("ov-filter-area").value = STATE.area;
          applyFiltersAndRender();
        });
        body.appendChild(tr);
      });
    } else {
      sub.textContent = "حسب الحوض والقرية · انقر صفًا لتصفية على ذلك الحوض";
      head.innerHTML =
        "<tr><th>الحوض</th><th>القرية</th><th>الطلبات</th><th>متوسط مساحة القطعة</th></tr>";
      const max = Math.max(...view.basins.map((b) => b.count), 1);
      view.basins.forEach((b) => {
        const isActive = STATE.basin === b.name;
        const tr = document.createElement("tr");
        tr.className = "ov-row-clickable" + (isActive ? " ov-row-active" : "");
        tr.innerHTML = `
          <td><strong>${b.name}</strong></td>
          <td>${b.village}</td>
          <td>
            <div class="ov-bar">
              <span class="ov-num">${arNum(b.count)}</span>
              <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${(b.count / max * 100).toFixed(1)}%"></div></div>
            </div>
          </td>
          <td class="ov-num">${arNum(b.avgArea)} م²</td>
        `;
        tr.addEventListener("click", () => {
          STATE.basin = (STATE.basin === b.name) ? "all" : b.name;
          $("ov-filter-basin").value = STATE.basin;
          applyFiltersAndRender();
        });
        body.appendChild(tr);
      });
    }
  }

  function renderTopFines(view) {
    const tbody = $("tbody-top-fines");
    if (!tbody) return;
    tbody.innerHTML = "";
    const STATUS_LABEL = {
      approved:       { lbl: "موافق",        cls: "ov-status-pill--ok"   },
      rejected:       { lbl: "مرفوض",        cls: "ov-status-pill--err"  },
      needs_revision: { lbl: "بحاجة تعديل",  cls: "ov-status-pill--warn" },
      pending:        { lbl: "قيد المراجعة", cls: "ov-status-pill--info" },
    };
    if (view.topFines.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" class="ov-empty">لا توجد غرامات بهذه المعايير</td>`;
      tbody.appendChild(tr);
      return;
    }
    view.topFines.forEach((f) => {
      const s = STATUS_LABEL[f.status] || STATUS_LABEL.pending;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${f.owner}</strong></td>
        <td>${f.area}</td>
        <td>${f.type}</td>
        <td>${f.violation}</td>
        <td class="ov-num">${arJD(f.fine)}</td>
        <td><span class="ov-status-pill ${s.cls}">${s.lbl}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ===================================================================
  // LEAFLET MAP — polygon choropleth, color by application count
  // ===================================================================
  let _lmap           = null;
  let _lmarkers       = [];

  function _initLeaflet() {
    if (_lmap || !window.L) return;
    _lmap = L.map("ov-leaflet-map", { center: [31.975, 35.900], zoom: 11 });
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "© Esri" }
    ).addTo(_lmap);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd", attribution: "© CARTO", opacity: 0.85 }
    ).addTo(_lmap);
  }

  // Sequential blue scale: light (#bfdbfe) → dark (#1e40af) by application count
  function _countColor(count, maxCount) {
    const t = maxCount > 0 ? Math.min(1, count / maxCount) : 0;
    const r = Math.round(191 + t * (30  - 191));
    const g = Math.round(219 + t * (64  - 219));
    const b = Math.round(254 + t * (175 - 254));
    return `rgb(${r},${g},${b})`;
  }

  function _layerStyle(n, isActive, maxCount) {
    const color = isActive ? "#fbbf24" : _countColor(n.count, maxCount);
    return {
      fillColor:   color,
      fillOpacity: isActive ? 0.70 : 0.55,
      color:       isActive ? "#d97706" : "rgba(255,255,255,0.80)",
      weight:      isActive ? 2.5 : 1.5,
    };
  }

  function _popupHtml(n) {
    return `<div style="min-width:175px;line-height:1.9;">
      <div style="font-weight:700;font-size:14px;margin-bottom:5px;">${n.name}</div>
      <div style="font-size:15px;font-weight:600;">${arNum(n.count)} طلب</div>
      <div style="margin-top:3px;">${arJD(n.fines)} غرامات مقدّرة</div>
      <div>${toAr(n.violationPct)}٪ نسبة مخالفات</div>
    </div>`;
  }

  function renderGeoMap(view) {
    const panel = $("ov-geo-map-panel");
    if (!panel || panel.hidden) return;

    _initLeaflet();
    if (!_lmap) return;
    setTimeout(() => _lmap.invalidateSize(), 60);

    _lmarkers.forEach((m) => { try { _lmap.removeLayer(m); } catch {} });
    _lmarkers = [];

    // Outer Amman urban boundary — thin dashed white outline, no fill
    const outerLayer = L.geoJSON({ type: "Feature", geometry: AMMAN_OUTER_GEOJSON }, {
      style: {
        fillColor:   "transparent",
        fillOpacity: 0,
        color:       "rgba(255,255,255,0.92)",
        weight:      2.5,
        dashArray:   "8,5",
      },
    });
    outerLayer.addTo(_lmap);
    _lmarkers.push(outerLayer);

    const maxCount = Math.max(...view.neighborhoods.map((n) => n.count), 1);

    view.neighborhoods.forEach((n) => {
      const isActive = STATE.area === n.name;
      const style    = _layerStyle(n, isActive, maxCount);
      const popup    = { direction: "rtl", className: "ov-leaflet-popup" };
      const onClick  = () => {
        STATE.area = STATE.area === n.name ? "all" : n.name;
        $("ov-filter-area").value = STATE.area;
        applyFiltersAndRender();
      };

      const geom = NEIGHBORHOOD_GEOJSON[n.name];
      let layer;

      if (geom) {
        layer = L.geoJSON({ type: "Feature", geometry: geom }, {
          style: () => style,
        });
      } else {
        const c = NEIGHBORHOOD_COORDS[n.name];
        if (!c) return;
        layer = L.circleMarker([c.lat, c.lng], { radius: 22, ...style });
      }

      layer.bindPopup(_popupHtml(n), popup);
      layer.on("click", onClick);
      layer.addTo(_lmap);
      _lmarkers.push(layer);
    });
  }

  function renderMap(view) {
    const root = $("ov-map");
    if (!root) return;
    // Preserve the legend chip; clear only the dots/labels/tip
    root.querySelectorAll(".ov-map-dot, .ov-map-tip, .ov-map-dot-label").forEach((el) => el.remove());

    const max = Math.max(...view.mapDots.map((d) => d.count), 1);
    const tip = document.createElement("div");
    tip.className = "ov-map-tip";
    tip.hidden = true;
    root.appendChild(tip);

    view.mapDots.forEach((d) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className =
        "ov-map-dot" +
        (d.isFocused ? " ov-map-dot--focus" : "") +
        (d.isDimmed  ? " ov-map-dot--dim"   : "");
      const sz = 14 + (d.count / max) * 38;
      dot.style.left   = d.x + "%";
      dot.style.top    = d.y + "%";
      dot.style.width  = sz + "px";
      dot.style.height = sz + "px";
      dot.dataset.name  = d.name;
      dot.dataset.count = String(d.count);
      dot.setAttribute("aria-label", d.name + " — " + d.count + " طلب");
      dot.addEventListener("mouseenter", () => {
        tip.innerHTML = `<strong>${d.name}</strong><span>${arNum(d.count)} طلب</span>`;
        tip.style.left = d.x + "%";
        tip.style.top  = d.y + "%";
        tip.hidden = false;
      });
      dot.addEventListener("mouseleave", () => { tip.hidden = true; });
      dot.addEventListener("click", () => {
        STATE.area = (STATE.area === d.name) ? "all" : d.name;
        $("ov-filter-area").value = STATE.area;
        applyFiltersAndRender();
      });
      root.appendChild(dot);
    });
  }

  function renderViolationsDonut(view) {
    setChart("violations", "chart-violations", {
      type: "doughnut",
      data: {
        labels: view.violations.map((v) => v.label),
        datasets: [{
          data: view.violations.map((v) => v.value),
          backgroundColor: view.violations.map((v) => v.color),
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        animation: { duration: 700 },
        plugins: {
          tooltip: {
            callbacks: { label: (c) => " " + c.label + " · " + arPct(c.parsed, 1) },
          },
        },
      },
    });
    const violatedPct = 100 - view.violations[0].value;
    animateNumber($("violation-num"), violatedPct, (v) => arPct(v, 1));

    const legend = $("legend-violations");
    legend.innerHTML = "";
    view.violations.forEach((v) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="ov-legend-dot" style="background:${v.color}"></span>
        <span>${v.label}</span>
        <span class="ov-legend-pct">${arPct(v.value, 1)}</span>
      `;
      legend.appendChild(li);
    });
  }

  function renderFinesHistogram(view) {
    setChart("fines-hist", "chart-fines-hist", {
      type: "bar",
      data: {
        labels: view.finesHist.buckets,
        datasets: [{
          data: view.finesHist.counts,
          backgroundColor: view.finesHist.counts.map((_, i, arr) => {
            const t = i / Math.max(1, arr.length - 1);
            return `hsl(${20 - t * 18}, ${55 + t * 30}%, ${56 - t * 18}%)`;
          }),
          hoverBackgroundColor: "#7f1d1d",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          tooltip: { callbacks: { label: (c) => " " + arNum(c.parsed.y) + " طلب" } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toAr(v) } },
        },
      },
    });
  }

  function renderBacklog(view) {
    const total = view.backlogAge.counts.reduce((a, b) => a + b, 0) || 1;
    const slaBreach = view.backlogAge.counts[3] + view.backlogAge.counts[4];
    if ($("sla-pill")) $("sla-pill").textContent = arNum(slaBreach) + " تجاوزت الـSLA";
    setChart("backlog", "chart-backlog", {
      type: "bar",
      data: {
        labels: view.backlogAge.buckets,
        datasets: [{
          data: view.backlogAge.counts,
          backgroundColor: view.backlogAge.counts.map((_, i) =>
            i < 2 ? COLORS.success : i < 3 ? COLORS.amber : i < 4 ? COLORS.warn : COLORS.error),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) =>
                " " + arNum(c.parsed.y) + " طلب · " + arPct(c.parsed.y / total * 100, 1),
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toAr(v) } },
        },
      },
    });
  }

  function renderYoY(view) {
    setChart("yoy", "chart-yoy", {
      type: "line",
      data: {
        labels: view.yoy.months,
        datasets: [
          {
            label: "٢٠٢٤", data: view.yoy.y2024, borderColor: COLORS.gray,
            backgroundColor: hexA(COLORS.gray, 0.06),
            borderWidth: 2, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, fill: false,
          },
          {
            label: "٢٠٢٥", data: view.yoy.y2025, borderColor: COLORS.brand,
            backgroundColor: hexA(COLORS.brand, 0.12),
            borderWidth: 2.5, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, fill: true,
          },
          {
            label: "توقع ذكي", data: view.yoy.forecast, borderColor: COLORS.purple,
            borderDash: [6, 5], borderWidth: 2.5, tension: 0.4, pointRadius: 4,
            pointBackgroundColor: COLORS.purple, fill: false, spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 700 },
        plugins: {
          legend: {
            display: true, position: "bottom",
            labels: { boxWidth: 18, padding: 16, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: (c) =>
                " " + c.dataset.label + " · " +
                (c.parsed.y == null ? "—" : arNum(c.parsed.y)),
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: false,
               ticks: { callback: (v) => toAr(v) } },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  }

  function renderReviewers(view) {
    const root = $("reviewer-board");
    root.innerHTML = "";
    const max = Math.max(...view.reviewers.map((r) => r.reviews), 1);
    view.reviewers.forEach((r) => {
      const div = document.createElement("div");
      div.className = "ov-rev";
      div.innerHTML = `
        <div class="ov-rev-avatar">${r.initials}</div>
        <div class="ov-rev-info">
          <div class="ov-rev-name">${r.name}</div>
          <div class="ov-rev-meta">
            <span>${arNum(r.reviews)} مراجعة</span>
            <span>·</span>
            <span>${toAr(r.avgDays.toFixed(1))} يوم/طلب</span>
            <span>·</span>
            <span>${toAr(r.approvalPct)}٪ موافقة</span>
          </div>
          <div class="ov-rev-bar">
            <div class="ov-rev-bar-fill" style="width:${(r.reviews / max * 100).toFixed(1)}%"></div>
          </div>
        </div>
        <div>
          <div class="ov-rev-stat">${arNum(r.reviews)}</div>
          <div class="ov-rev-stat-sub">طلب</div>
        </div>
      `;
      root.appendChild(div);
    });
  }

  function renderAIGrid(view) {
    const root = $("ai-grid");
    root.innerHTML = "";
    view.aiInsights.forEach((c) => {
      const cell = document.createElement("div");
      cell.className = "ov-ai-cell";
      cell.innerHTML = `
        <div class="ov-ai-cell-label">${c.label}</div>
        <div class="ov-ai-cell-num">${c.num}</div>
        <div class="ov-ai-cell-sub">${c.sub}</div>
      `;
      root.appendChild(cell);
    });
  }

  function renderAlerts(view) {
    const root = $("alerts-list");
    root.innerHTML = "";
    const ICONS = {
      warn: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3l8 14H2L10 3z"/><path d="M10 9v3M10 14.5h.01"/></svg>',
      err:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4M10 13.5h.01"/></svg>',
      info: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 9v4M10 6.5h.01"/></svg>',
      ok:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l4 4 8-9"/></svg>',
    };
    view.alerts.forEach((a) => {
      const div = document.createElement("div");
      div.className = "ov-alert ov-alert--" + a.sev;
      div.innerHTML = `
        <div class="ov-alert-icon">${ICONS[a.sev] || ICONS.info}</div>
        <div class="ov-alert-body">
          <div class="ov-alert-title">${a.title}</div>
          <div class="ov-alert-sub">${a.sub}</div>
        </div>
        <div class="ov-alert-time">${a.time}</div>
      `;
      root.appendChild(div);
    });
  }

  // ===================================================================
  // ACTIVE-FILTER CHIPS
  // ===================================================================
  function renderActiveChips() {
    const sub = $("ov-last-updated");
    if (sub) {
      const parts = [periodLabelLong()];
      if (STATE.area !== "all")   parts.push("منطقة: " + STATE.area);
      if (STATE.basin !== "all")  parts.push("حوض: " + STATE.basin);
      if (STATE.type !== "all")   parts.push("نوع: " + STATE.type);
      if (STATE.status !== "all") parts.push("حالة: " + STATE.status);
      sub.textContent = parts.join(" · ");
    }
    // Highlight the filter selects whenever they're not "all"
    [["ov-filter-area", STATE.area], ["ov-filter-basin", STATE.basin],
     ["ov-filter-type", STATE.type], ["ov-filter-status", STATE.status]].forEach(([id, val]) => {
      const el = $(id);
      if (el) el.classList.toggle("ov-filter-active", val !== "all");
    });
  }

  // ===================================================================
  // ORCHESTRATION
  // ===================================================================
  function renderAll() {
    const view = computeView();
    renderActiveChips();
    renderKpis(view);
    renderVolume(view);
    renderTypesList(view);
    renderTypesPie(view);
    renderGeoTable(view);
    renderGeoPie(view);
    renderGeoMap(view);
  }

  function applyFiltersAndRender() {
    renderAll();
  }

  // ===================================================================
  // FILTER UI BINDINGS
  // ===================================================================
  function bindFilters() {
    document.querySelectorAll(".ov-period-pill").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".ov-period-pill").forEach((x) =>
          x.classList.remove("ov-period-pill--active"));
        b.classList.add("ov-period-pill--active");
        STATE.period = b.dataset.period;
        STATE.granularity = null;  // reset to per-period default

        // Sync visible granularity buttons (only the volume-card group)
        const volGroup = document.querySelector(".ov-card--volume .ov-toggle, .ov-row--trends .ov-toggle");
        const def = defaultGranularity(STATE.period);
        if (volGroup) {
          volGroup.querySelectorAll(".ov-toggle-btn[data-grain]").forEach((x) =>
            x.classList.toggle("ov-toggle-btn--active", x.dataset.grain === def));
        }
        applyFiltersAndRender();
      });
    });

    document.querySelectorAll(".ov-toggle-btn[data-grain]").forEach((b) => {
      b.addEventListener("click", () => {
        const group = b.parentElement;
        group.querySelectorAll(".ov-toggle-btn").forEach((x) =>
          x.classList.remove("ov-toggle-btn--active"));
        b.classList.add("ov-toggle-btn--active");
        STATE.granularity = b.dataset.grain;
        applyFiltersAndRender();
      });
    });

    document.querySelectorAll(".ov-toggle-btn[data-geo]").forEach((b) => {
      b.addEventListener("click", () => {
        const group = b.parentElement;
        group.querySelectorAll(".ov-toggle-btn").forEach((x) =>
          x.classList.remove("ov-toggle-btn--active"));
        b.classList.add("ov-toggle-btn--active");
        STATE.geoView = b.dataset.geo;
        const view = computeView();
        renderGeoTable(view);
        if (STATE.geoPanel === "pie") renderGeoPie(view);
      });
    });

    document.querySelectorAll(".ov-toggle-btn[data-typespanel]").forEach((b) => {
      b.addEventListener("click", () => {
        const group = b.parentElement;
        group.querySelectorAll(".ov-toggle-btn").forEach((x) =>
          x.classList.remove("ov-toggle-btn--active"));
        b.classList.add("ov-toggle-btn--active");
        STATE.typesPanel = b.dataset.typespanel;

        const listPanel = $("ov-types-list-panel");
        const piePanel  = $("ov-types-pie-panel");
        const isPie = STATE.typesPanel === "pie";

        if (listPanel) listPanel.hidden = isPie;
        if (piePanel)  piePanel.hidden  = !isPie;

        if (isPie) renderTypesPie(computeView());
      });
    });

    document.querySelectorAll(".ov-toggle-btn[data-geopanel]").forEach((b) => {
      b.addEventListener("click", () => {
        const group = b.parentElement;
        group.querySelectorAll(".ov-toggle-btn").forEach((x) =>
          x.classList.remove("ov-toggle-btn--active"));
        b.classList.add("ov-toggle-btn--active");
        STATE.geoPanel = b.dataset.geopanel;

        const listPanel = $("ov-geo-list-panel");
        const piePanel  = $("ov-geo-pie-panel");
        const mapPanel  = $("ov-geo-map-panel");
        const listSub   = $("ov-geo-list-sub");

        if (listPanel) listPanel.hidden = STATE.geoPanel !== "list";
        if (piePanel)  piePanel.hidden  = STATE.geoPanel !== "pie";
        if (mapPanel)  mapPanel.hidden  = STATE.geoPanel !== "map";
        // The neighborhoods/basins toggle controls list+pie data; hide only on map
        if (listSub)   listSub.hidden   = STATE.geoPanel === "map";

        const view = computeView();
        if (STATE.geoPanel === "pie") renderGeoPie(view);
        if (STATE.geoPanel === "map") renderGeoMap(view);
      });
    });

    const wireSelect = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", () => {
        STATE[key] = el.value;
        applyFiltersAndRender();
      });
    };
    wireSelect("ov-filter-area",   "area");
    wireSelect("ov-filter-basin",  "basin");
    wireSelect("ov-filter-type",   "type");
    wireSelect("ov-filter-status", "status");

    const reset = $("ov-filter-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        ["ov-filter-area", "ov-filter-basin", "ov-filter-type", "ov-filter-status"].forEach((id) => {
          const el = $(id);
          if (el) el.value = el.options[0].value;
        });
        STATE.area = "all"; STATE.basin = "all"; STATE.type = "all"; STATE.status = "all";
        applyFiltersAndRender();
      });
    }
  }

  // ===================================================================
  // BOOT
  // ===================================================================
  function boot() {
    bindFilters();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
