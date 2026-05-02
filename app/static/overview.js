/* =================================================================
   Overview dashboard — manager view
   Renders rich dummy data via Chart.js. Auth, topbar, and sidebar
   toggle are handled by shell.js (loaded before this file).
   ================================================================= */
(function () {
  "use strict";

  if (!window.SASession) return;  // shell.js bounced us — nothing to do

  const $ = (id) => document.getElementById(id);

  // ===================================================================
  // DUMMY DATA — realistic Amman context, 12-month window
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
    teal:    "#0d9488",
    indigo:  "#6366f1",
  };

  const MONTHS_AR = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران",
                     "تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];

  // Build 12 monthly rows (ending at current month — 2026-05).
  const monthlyVolume = [
    { label: "حزيران ٢٠٢٥",     approved: 178, pending: 24, needsRev: 19, rejected: 12, draft: 28 },
    { label: "تموز ٢٠٢٥",        approved: 192, pending: 31, needsRev: 22, rejected: 14, draft: 35 },
    { label: "آب ٢٠٢٥",          approved: 165, pending: 28, needsRev: 18, rejected: 11, draft: 31 },
    { label: "أيلول ٢٠٢٥",       approved: 209, pending: 34, needsRev: 25, rejected: 16, draft: 42 },
    { label: "تشرين الأول ٢٠٢٥", approved: 234, pending: 41, needsRev: 28, rejected: 19, draft: 47 },
    { label: "تشرين الثاني ٢٠٢٥",approved: 256, pending: 38, needsRev: 31, rejected: 22, draft: 51 },
    { label: "كانون الأول ٢٠٢٥", approved: 243, pending: 44, needsRev: 26, rejected: 17, draft: 49 },
    { label: "كانون الثاني ٢٠٢٦",approved: 271, pending: 48, needsRev: 33, rejected: 21, draft: 55 },
    { label: "شباط ٢٠٢٦",        approved: 289, pending: 52, needsRev: 36, rejected: 24, draft: 58 },
    { label: "آذار ٢٠٢٦",        approved: 312, pending: 57, needsRev: 39, rejected: 26, draft: 64 },
    { label: "نيسان ٢٠٢٦",       approved: 298, pending: 61, needsRev: 41, rejected: 23, draft: 67 },
    { label: "أيار ٢٠٢٦",        approved: 287, pending: 78, needsRev: 44, rejected: 28, draft: 72 },
  ];

  // Application type counts (matches dashboard.js APP_TYPE_LABELS, ordered desc)
  const applicationsByType = [
    { label: "ترخيص مقترح على أرض خالية",                    count: 1248 },
    { label: "الاستشارة (موافقة مبدئية)",                      count: 892 },
    { label: "إذن إشغال",                                       count: 614 },
    { label: "ترخيص مقترح فوق قائم",                            count: 487 },
    { label: "تجديد إذن إشغال",                                count: 342 },
    { label: "ترخيص مخطط تعديلي",                              count: 268 },
    { label: "ترخيص زيادات",                                    count: 213 },
    { label: "استشارة فنية",                                    count: 178 },
    { label: "ترخيص زيادات + إذن إشغال",                       count: 142 },
    { label: "ترخيص مساحات قائمة وإذن إشغال",                  count: 98 },
    { label: "بناء قائم لأول مرة",                              count: 76 },
    { label: "إلغاء ترخيص مقترح",                               count: 54 },
    { label: "تصحيح وثيقة إذن الإشغال",                         count: 41 },
    { label: "تصحيح وثيقة تجديد إذن الإشغال",                   count: 32 },
    { label: "مصادرة تأمينات",                                  count: 24 },
    { label: "إعادة النظر بقرار لجنة التخطيط المركزية",        count: 18 },
    { label: "أخرى",                                            count: 11 },
  ];

  const neighborhoods = [
    { name: "الجبيهة",        count: 487, fines:  78420, violationPct: 24 },
    { name: "الصويفية",       count: 412, fines:  92150, violationPct: 31 },
    { name: "تلاع العلي",     count: 386, fines:  64800, violationPct: 22 },
    { name: "العبدلي",        count: 341, fines: 105600, violationPct: 38 },
    { name: "الأندلس",        count: 298, fines:  41250, violationPct: 19 },
    { name: "دابوق",          count: 267, fines:  56400, violationPct: 26 },
    { name: "خلدا",           count: 254, fines:  38900, violationPct: 21 },
    { name: "مرج الحمام",     count: 231, fines:  47200, violationPct: 25 },
    { name: "الياسمين",       count: 198, fines:  29800, violationPct: 18 },
    { name: "ضاحية الرشيد",   count: 184, fines:  33500, violationPct: 22 },
  ];

  const basins = [
    { name: "الحنو",            village: "اليادودة",     count: 142, avgArea: 612 },
    { name: "مرج الاجرب",       village: "اليادودة",     count: 128, avgArea: 845 },
    { name: "الياسمين الشمالي",  village: "ناعور",        count: 117, avgArea: 720 },
    { name: "أم البساتين",      village: "ناعور",        count: 96,  avgArea: 1240 },
    { name: "القنيطرة الغربية",  village: "القنيطرة",     count: 84,  avgArea: 980 },
    { name: "تلاع العلي الشرقي", village: "تلاع العلي",   count: 78,  avgArea: 540 },
    { name: "الجيزة الجنوبية",   village: "الجيزة",       count: 71,  avgArea: 1580 },
    { name: "الموقر الأوسط",     village: "الموقر",       count: 64,  avgArea: 2100 },
  ];

  // Map dots (rough relative positioning over a stylized Amman canvas)
  const mapDots = [
    { name: "الجبيهة",     x: 38, y: 30, count: 487 },
    { name: "الصويفية",    x: 52, y: 58, count: 412 },
    { name: "تلاع العلي",  x: 30, y: 42, count: 386 },
    { name: "العبدلي",     x: 60, y: 45, count: 341 },
    { name: "الأندلس",     x: 72, y: 30, count: 298 },
    { name: "دابوق",       x: 22, y: 60, count: 267 },
    { name: "خلدا",        x: 42, y: 70, count: 254 },
    { name: "مرج الحمام",  x: 48, y: 82, count: 231 },
    { name: "الياسمين",    x: 68, y: 70, count: 198 },
    { name: "ضاحية الرشيد",x: 80, y: 50, count: 184 },
    { name: "ماركا",       x: 75, y: 22, count: 142 },
    { name: "طبربور",      x: 55, y: 18, count: 128 },
  ];

  const violations = [
    { label: "بدون مخالفات",        value: 76.9, color: COLORS.success },
    { label: "ارتداد جانبي",        value: 9.8,  color: COLORS.warn },
    { label: "ارتداد أمامي",        value: 6.4,  color: COLORS.amber },
    { label: "ارتداد خلفي",         value: 3.7,  color: COLORS.error },
    { label: "تجاوز نسبة التغطية",  value: 1.9,  color: COLORS.purple },
    { label: "تجاوز حدود القطعة",   value: 1.3,  color: "#7c2d12" },
  ];

  const finesHistogram = {
    buckets: ["٠–٥٠٠", "٥٠٠–١٠٠٠", "١-٥ آلاف", "٥-١٠ آلاف", "١٠-٢٠ ألف", "أكثر من ٢٠ ألف"],
    counts:  [284, 412, 348, 156, 64, 21],
  };

  const topFines = [
    { owner: "أحمد ياسر القضاة",      area: "العبدلي",     type: "ترخيص مقترح فوق قائم",   violation: "تجاوز حدود القطعة + ارتداد خلفي", fine: 38400, status: "rejected" },
    { owner: "ليلى عبدالرحمن خليل",   area: "الصويفية",    type: "ترخيص مقترح على أرض خالية", violation: "ارتداد أمامي + تغطية",            fine: 27600, status: "needs_revision" },
    { owner: "محمد إبراهيم العمري",   area: "الجبيهة",     type: "ترخيص زيادات",              violation: "ارتداد جانبي على شارعين",         fine: 22150, status: "needs_revision" },
    { owner: "فهد سامي الحياري",      area: "تلاع العلي",  type: "بناء قائم لأول مرة",        violation: "تجاوز نسبة الطابقية",             fine: 19850, status: "pending" },
    { owner: "نور الدين أبو غزالة",   area: "دابوق",       type: "ترخيص مقترح فوق قائم",     violation: "ارتداد خلفي",                      fine: 17200, status: "approved" },
  ];

  const reviewers = [
    { name: "إيمان الزعبي",        initials: "إز", reviews: 187, avgDays: 2.8, approvalPct: 81 },
    { name: "خالد الفايز",         initials: "خف", reviews: 164, avgDays: 3.4, approvalPct: 76 },
    { name: "ميسون عبيدات",        initials: "مع", reviews: 152, avgDays: 3.1, approvalPct: 79 },
    { name: "زيد العواملة",        initials: "زع", reviews: 138, avgDays: 4.2, approvalPct: 72 },
    { name: "ندى الكساسبة",        initials: "نك", reviews: 124, avgDays: 2.5, approvalPct: 84 },
  ];

  const aiInsights = [
    { label: "مخالفات اكتشفها الذكاء قبل المراجع",  num: "1,247", sub: "خلال ١٢ شهرًا" },
    { label: "ساعات عمل مراجعة موفّرة",              num: "2,860", sub: "بمعدل ٤٢ دقيقة لكل طلب" },
    { label: "وثائق خاطئة أوقفها قبل المراجعة",     num: "318",   sub: "سند، مخطط تنظيمي، أو طوابقي" },
    { label: "تطابق الأرقام بين السند والمخطط",     num: "%97.4", sub: "كشف عدم تطابق رقم القطعة" },
  ];

  const backlogAge = {
    buckets: ["٠–٣ أيام", "٤–٧ أيام", "٨–١٤ يومًا", "١٥–٣٠ يومًا", "أكثر من ٣٠ يومًا"],
    counts:  [186, 142, 64, 18, 2],
  };

  const yoy = {
    months: ["كانون ٢", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تش ١", "تش ٢", "كانون ١"],
    y2024:  [198, 215, 226, 238, 247, 251, 263, 245, 271, 289, 304, 318],
    y2025:  [261, 278, 296, 314, 332, 341, 358, 372, 391, 412, 428, 447],
    forecast: [null, null, null, null, null, null, null, null, null, null, 461, 489],
  };

  const alerts = [
    { sev: "warn", title: "ارتفاع غير اعتيادي في طلبات حي العبدلي",
      sub: "زيادة ٤٧٪ خلال آخر ٧ أيام مقارنة بالمتوسط",  time: "قبل ٣ ساعات" },
    { sev: "err",  title: "٦ طلبات تجاوزت SLA المحدد ١٤ يومًا",
      sub: "تتطلب تدخل المدير المسؤول — ضاحية الرشيد، طبربور",  time: "قبل ٥ ساعات" },
    { sev: "info", title: "تنبيه ذكي: نمط مخالفات متكرر",
      sub: "٤٢٪ من طلبات شارع الياسمين تخالف الارتداد الأمامي ٥م",  time: "اليوم" },
    { sev: "ok",   title: "اكتمال مراجعة دفعة الأسبوع",
      sub: "تم إغلاق ٢٣٤ طلبًا بمعدل أسرع بـ ١٢٪ من المعتاد",  time: "أمس" },
    { sev: "warn", title: "وثائق ناقصة في ١٤ طلبًا جديدًا",
      sub: "غالبًا مخطط موقع تنظيمي أو سند تسجيل",  time: "أمس" },
  ];

  // KPI deltas + spark series
  const kpis = {
    total: 4237,        totalDelta: 12.4,
    pending: 412,       waitDays: 2.3,
    approval: 78.4,     approvalDelta: 3.1,
    fines: 487250,      finesDelta: 8.1,
    reviewDays: 3.7,    reviewDelta: -14.2,
    aiAccuracy: 94.6,
  };

  const sparkSeries = {
    total:    [268, 294, 261, 327, 369, 398, 379, 428, 459, 498, 490, 509],
    pending:  [180, 215, 198, 240, 278, 295, 282, 318, 341, 372, 388, 412],
    approval: [71, 73, 72, 74, 75, 76, 75, 77, 78, 78.5, 78.2, 78.4],
    fines:    [298, 312, 285, 348, 392, 416, 401, 442, 471, 506, 478, 487],
    review:   [5.2, 4.9, 5.1, 4.7, 4.4, 4.2, 4.3, 4.0, 3.9, 3.7, 3.8, 3.7],
    ai:       [88.2, 89.1, 89.8, 90.5, 91.2, 91.8, 92.4, 93.0, 93.6, 94.1, 94.4, 94.6],
  };

  // ===================================================================
  // CHART.JS DEFAULTS
  // ===================================================================
  Chart.defaults.font.family = "'Inter', 'Noto Kufi Arabic', sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = "#475569";
  Chart.defaults.plugins.legend.display = false;

  function fmtNum(n) { return n.toLocaleString("ar-EG"); }
  function fmtJD(n)  { return n.toLocaleString("ar-EG") + " د.أ"; }
  function fmtPct(n) { return (n).toLocaleString("ar-EG", { maximumFractionDigits: 1 }) + "٪"; }

  // Convert ASCII digits to Arabic-Indic for visual polish.
  function toArDigits(str) {
    const d = "٠١٢٣٤٥٦٧٨٩";
    return String(str).replace(/[0-9]/g, (g) => d[+g]);
  }

  // ===================================================================
  // KPI strip
  // ===================================================================
  function renderKpis() {
    $("kpi-total").textContent       = toArDigits(kpis.total.toLocaleString("en-US"));
    $("kpi-total-delta").textContent = "▲ " + toArDigits(kpis.totalDelta) + "٪";
    $("kpi-pending").textContent     = toArDigits(kpis.pending.toLocaleString("en-US"));
    $("kpi-pending-wait").textContent = toArDigits(kpis.waitDays) + " أيام";
    $("kpi-approval").textContent    = toArDigits(kpis.approval) + "٪";
    $("kpi-approval-delta").textContent = "▲ " + toArDigits(kpis.approvalDelta) + "٪";
    $("kpi-fines").textContent       = toArDigits(kpis.fines.toLocaleString("en-US")) + " د.أ";
    $("kpi-fines-delta").textContent = "▲ " + toArDigits(kpis.finesDelta) + "٪";
    $("kpi-review-days").textContent = toArDigits(kpis.reviewDays) + " يوم";
    $("kpi-review-delta").textContent = "▼ " + toArDigits(Math.abs(kpis.reviewDelta)) + "٪";
    $("kpi-ai").textContent          = toArDigits(kpis.aiAccuracy) + "٪";

    // Sparklines — minimalist tiny line charts
    function spark(canvasId, data, color) {
      const ctx = $(canvasId);
      if (!ctx) return;
      new Chart(ctx, {
        type: "line",
        data: {
          labels: data.map((_, i) => i),
          datasets: [{
            data,
            borderColor: color,
            borderWidth: 1.6,
            backgroundColor: hexA(color, 0.12),
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } },
        },
      });
    }
    spark("spark-total",    sparkSeries.total,    COLORS.brand);
    spark("spark-pending",  sparkSeries.pending,  COLORS.warn);
    spark("spark-approval", sparkSeries.approval, COLORS.success);
    spark("spark-fines",    sparkSeries.fines,    COLORS.error);
    spark("spark-review",   sparkSeries.review,   COLORS.success);
    spark("spark-ai",       sparkSeries.ai,       COLORS.purple);
  }

  function hexA(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ===================================================================
  // Volume chart — stacked bar by status, monthly
  // ===================================================================
  function renderVolume() {
    const ctx = $("chart-volume");
    if (!ctx) return;
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: monthlyVolume.map((m) => m.label),
        datasets: [
          { label: "موافق عليها",   data: monthlyVolume.map((m) => m.approved), backgroundColor: COLORS.success },
          { label: "قيد المراجعة",  data: monthlyVolume.map((m) => m.pending),  backgroundColor: COLORS.amber },
          { label: "بحاجة تعديل",   data: monthlyVolume.map((m) => m.needsRev), backgroundColor: COLORS.warn },
          { label: "مرفوضة",         data: monthlyVolume.map((m) => m.rejected), backgroundColor: COLORS.error },
          { label: "مسودة",          data: monthlyVolume.map((m) => m.draft),    backgroundColor: COLORS.gray },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 12, padding: 14 } },
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)",
            padding: 10,
            cornerRadius: 8,
            titleFont: { size: 12, weight: "600" },
            bodyFont: { size: 11.5 },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10.5 } } },
          y: { stacked: true, grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toArDigits(v) } },
        },
      },
    });
  }

  // ===================================================================
  // Status donut
  // ===================================================================
  function renderStatusDonut() {
    const total = monthlyVolume.reduce(
      (acc, m) => {
        acc.approved += m.approved;
        acc.pending  += m.pending;
        acc.needsRev += m.needsRev;
        acc.rejected += m.rejected;
        acc.draft    += m.draft;
        return acc;
      }, { approved:0, pending:0, needsRev:0, rejected:0, draft:0 });
    const sum = total.approved + total.pending + total.needsRev + total.rejected + total.draft;
    $("donut-num").textContent = toArDigits(sum.toLocaleString("en-US"));
    const slices = [
      { lbl: "موافق عليها", val: total.approved, color: COLORS.success },
      { lbl: "قيد المراجعة", val: total.pending,  color: COLORS.amber },
      { lbl: "بحاجة تعديل",  val: total.needsRev, color: COLORS.warn },
      { lbl: "مرفوضة",       val: total.rejected, color: COLORS.error },
      { lbl: "مسودة",        val: total.draft,    color: COLORS.gray },
    ];
    new Chart($("chart-status"), {
      type: "doughnut",
      data: {
        labels: slices.map((s) => s.lbl),
        datasets: [{
          data: slices.map((s) => s.val),
          backgroundColor: slices.map((s) => s.color),
          borderColor: "#fff",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)",
            padding: 10,
            cornerRadius: 8,
          },
        },
      },
    });

    const legend = $("legend-status");
    legend.innerHTML = "";
    slices.forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="ov-legend-dot" style="background:${s.color}"></span>
        <span>${s.lbl}</span>
        <span class="ov-legend-num">${toArDigits(s.val.toLocaleString("en-US"))}</span>
        <span class="ov-legend-pct">${toArDigits(((s.val / sum) * 100).toFixed(1))}٪</span>
      `;
      legend.appendChild(li);
    });
  }

  // ===================================================================
  // Application types — horizontal bar (top → bottom)
  // ===================================================================
  function renderTypes() {
    const ctx = $("chart-types");
    if (!ctx) return;
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: applicationsByType.map((t) => t.label),
        datasets: [{
          data: applicationsByType.map((t) => t.count),
          backgroundColor: applicationsByType.map((_, i) =>
            hexA(COLORS.brand, 1 - i * 0.04)),
          borderRadius: 6,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)",
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: (ctx) => " " + toArDigits(ctx.parsed.x.toLocaleString("en-US")) + " طلب" },
          },
        },
        scales: {
          x: { grid: { color: "rgba(15,23,42,.06)" }, ticks: { callback: (v) => toArDigits(v) } },
          y: { grid: { display: false }, ticks: { font: { size: 11.5 } } },
        },
      },
    });
  }

  // ===================================================================
  // Tables
  // ===================================================================
  function renderNeighborhoods() {
    const tbody = document.querySelector("#table-neighborhoods tbody");
    tbody.innerHTML = "";
    const max = Math.max(...neighborhoods.map((n) => n.count));
    neighborhoods.forEach((n) => {
      const tr = document.createElement("tr");
      const pctClass = n.violationPct > 30 ? "ov-status-pill--err"
                     : n.violationPct > 22 ? "ov-status-pill--warn"
                     : "ov-status-pill--ok";
      tr.innerHTML = `
        <td><strong>${n.name}</strong></td>
        <td>
          <div class="ov-bar">
            <span class="ov-num">${toArDigits(n.count)}</span>
            <div class="ov-bar-track">
              <div class="ov-bar-fill" style="width:${(n.count / max * 100).toFixed(1)}%"></div>
            </div>
          </div>
        </td>
        <td class="ov-num">${toArDigits(n.fines.toLocaleString("en-US"))} د.أ</td>
        <td><span class="ov-status-pill ${pctClass}">${toArDigits(n.violationPct)}٪</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderBasins() {
    const tbody = document.querySelector("#table-basins tbody");
    tbody.innerHTML = "";
    basins.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${b.name}</strong></td>
        <td>${b.village}</td>
        <td class="ov-num">${toArDigits(b.count)}</td>
        <td>${toArDigits(b.avgArea.toLocaleString("en-US"))} م²</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderTopFines() {
    const tbody = document.querySelector("#table-top-fines tbody");
    tbody.innerHTML = "";
    const STATUS_LABEL = {
      approved: { lbl: "موافق",       cls: "ov-status-pill--ok" },
      rejected: { lbl: "مرفوض",       cls: "ov-status-pill--err" },
      needs_revision: { lbl: "بحاجة تعديل", cls: "ov-status-pill--warn" },
      pending: { lbl: "قيد المراجعة", cls: "ov-status-pill--info" },
    };
    topFines.forEach((f) => {
      const s = STATUS_LABEL[f.status];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${f.owner}</strong></td>
        <td>${f.area}</td>
        <td>${f.type}</td>
        <td>${f.violation}</td>
        <td class="ov-num">${toArDigits(f.fine.toLocaleString("en-US"))} د.أ</td>
        <td><span class="ov-status-pill ${s.cls}">${s.lbl}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ===================================================================
  // Map placeholder
  // ===================================================================
  function renderMap() {
    const root = $("ov-map");
    if (!root) return;
    const max = Math.max(...mapDots.map((d) => d.count));
    mapDots.forEach((d) => {
      const dot = document.createElement("div");
      dot.className = "ov-map-dot";
      const sz = 14 + (d.count / max) * 36;
      dot.style.left = d.x + "%";
      dot.style.top = d.y + "%";
      dot.style.width = sz + "px";
      dot.style.height = sz + "px";

      const label = document.createElement("div");
      label.className = "ov-map-dot-label";
      label.style.left = d.x + "%";
      label.style.top = d.y + "%";
      label.textContent = `${d.name} · ${toArDigits(d.count)}`;
      root.appendChild(dot);
      root.appendChild(label);
    });
  }

  // ===================================================================
  // Violations donut + fines histogram + backlog + YoY
  // ===================================================================
  function renderViolationsDonut() {
    new Chart($("chart-violations"), {
      type: "doughnut",
      data: {
        labels: violations.map((v) => v.label),
        datasets: [{
          data: violations.map((v) => v.value),
          backgroundColor: violations.map((v) => v.color),
          borderColor: "#fff",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: {
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)", padding: 10, cornerRadius: 8,
            callbacks: { label: (c) => " " + toArDigits(c.parsed.toFixed(1)) + "٪" },
          },
        },
      },
    });
    const violatedPct = 100 - violations[0].value;
    $("violation-num").textContent = toArDigits(violatedPct.toFixed(1)) + "٪";

    const legend = $("legend-violations");
    legend.innerHTML = "";
    violations.forEach((v) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="ov-legend-dot" style="background:${v.color}"></span>
        <span>${v.label}</span>
        <span class="ov-legend-pct">${toArDigits(v.value.toFixed(1))}٪</span>
      `;
      legend.appendChild(li);
    });
  }

  function renderFinesHistogram() {
    new Chart($("chart-fines-hist"), {
      type: "bar",
      data: {
        labels: finesHistogram.buckets,
        datasets: [{
          data: finesHistogram.counts,
          backgroundColor: COLORS.error,
          hoverBackgroundColor: "#7f1d1d",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)", padding: 10, cornerRadius: 8,
            callbacks: { label: (c) => " " + toArDigits(c.parsed.y.toLocaleString("en-US")) + " طلب" },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toArDigits(v) } },
        },
      },
    });
  }

  function renderBacklog() {
    const total = backlogAge.counts.reduce((a, b) => a + b, 0);
    const slaBreach = backlogAge.counts[3] + backlogAge.counts[4];
    const slaPill = $("sla-pill");
    if (slaPill) slaPill.textContent = toArDigits(slaBreach) + " تجاوزت الـSLA";
    new Chart($("chart-backlog"), {
      type: "bar",
      data: {
        labels: backlogAge.buckets,
        datasets: [{
          data: backlogAge.counts,
          backgroundColor: backlogAge.counts.map((_, i) =>
            i < 2 ? COLORS.success : i < 3 ? COLORS.amber : i < 4 ? COLORS.warn : COLORS.error),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)", padding: 10, cornerRadius: 8,
            callbacks: {
              label: (c) => " " + toArDigits(c.parsed.y) + " طلب · " +
                            toArDigits((c.parsed.y / total * 100).toFixed(1)) + "٪",
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: true,
               ticks: { callback: (v) => toArDigits(v) } },
        },
      },
    });
  }

  function renderYoY() {
    new Chart($("chart-yoy"), {
      type: "line",
      data: {
        labels: yoy.months,
        datasets: [
          {
            label: "٢٠٢٤",
            data: yoy.y2024,
            borderColor: COLORS.gray,
            backgroundColor: hexA(COLORS.gray, 0.06),
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0,
            fill: false,
          },
          {
            label: "٢٠٢٥",
            data: yoy.y2025,
            borderColor: COLORS.brand,
            backgroundColor: hexA(COLORS.brand, 0.12),
            borderWidth: 2.5,
            tension: 0.4,
            pointRadius: 0,
            fill: true,
          },
          {
            label: "توقع ذكي",
            data: yoy.forecast,
            borderColor: COLORS.purple,
            borderDash: [6, 5],
            borderWidth: 2.5,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: COLORS.purple,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 18, padding: 16 } },
          tooltip: {
            backgroundColor: "rgba(15,23,42,.95)", padding: 10, cornerRadius: 8,
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(15,23,42,.06)" }, beginAtZero: false,
               ticks: { callback: (v) => toArDigits(v) } },
        },
      },
    });
  }

  // ===================================================================
  // Reviewer leaderboard + AI grid + Alerts
  // ===================================================================
  function renderReviewers() {
    const root = $("reviewer-board");
    root.innerHTML = "";
    reviewers.forEach((r) => {
      const div = document.createElement("div");
      div.className = "ov-rev";
      div.innerHTML = `
        <div class="ov-rev-avatar">${r.initials}</div>
        <div>
          <div class="ov-rev-name">${r.name}</div>
          <div class="ov-rev-meta">
            <span>${toArDigits(r.reviews)} مراجعة</span>
            <span>·</span>
            <span>${toArDigits(r.avgDays)} يوم/طلب</span>
            <span>·</span>
            <span>${toArDigits(r.approvalPct)}٪ موافقة</span>
          </div>
        </div>
        <div>
          <div class="ov-rev-stat">${toArDigits(r.reviews)}</div>
          <div class="ov-rev-stat-sub">طلب</div>
        </div>
      `;
      root.appendChild(div);
    });
  }

  function renderAIGrid() {
    const root = $("ai-grid");
    root.innerHTML = "";
    aiInsights.forEach((c) => {
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

  function renderAlerts() {
    const root = $("alerts-list");
    root.innerHTML = "";
    const ICONS = {
      warn: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3l8 14H2L10 3z"/><path d="M10 9v3M10 14.5h.01"/></svg>',
      err:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4M10 13.5h.01"/></svg>',
      info: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 9v4M10 6.5h.01"/></svg>',
      ok:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l4 4 8-9"/></svg>',
    };
    alerts.forEach((a) => {
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
  // Period pill interactivity (cosmetic — does not refilter data)
  // ===================================================================
  document.querySelectorAll(".ov-period-pill").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".ov-period-pill").forEach((x) =>
        x.classList.remove("ov-period-pill--active"));
      b.classList.add("ov-period-pill--active");
    });
  });
  document.querySelectorAll(".ov-toggle-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const group = b.parentElement;
      group.querySelectorAll(".ov-toggle-btn").forEach((x) =>
        x.classList.remove("ov-toggle-btn--active"));
      b.classList.add("ov-toggle-btn--active");
    });
  });
  const reset = $("ov-filter-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      ["ov-filter-area", "ov-filter-basin", "ov-filter-type", "ov-filter-status"].forEach((id) => {
        const el = $(id);
        if (el) el.value = el.options[0].value;
      });
    });
  }

  // ===================================================================
  // Boot
  // ===================================================================
  function boot() {
    renderKpis();
    renderVolume();
    renderStatusDonut();
    renderTypes();
    renderNeighborhoods();
    renderBasins();
    renderTopFines();
    renderMap();
    renderViolationsDonut();
    renderFinesHistogram();
    renderBacklog();
    renderYoY();
    renderReviewers();
    renderAIGrid();
    renderAlerts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
