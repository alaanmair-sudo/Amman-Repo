/* Reports page — mock UI rendered from constants. */
(function () {
  "use strict";
  if (!window.SASession) return;

  const $ = (id) => document.getElementById(id);

  const ICONS = {
    chart:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V8M8 17V4M13 17v-7M17 17v-4M2.5 17h15"/></svg>',
    shield: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z"/><path d="M7 10l2 2 4-4"/></svg>',
    money:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v8M7.5 7.5h4a1.5 1.5 0 010 3H8.5a1.5 1.5 0 000 3H12.5"/></svg>',
    map:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l5-2 6 2 5-2v12l-5 2-6-2-5 2V5z"/><path d="M7 3v14M13 5v14"/></svg>',
    users:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3"/><path d="M3 17c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></svg>',
    ai:     '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l1.8 4.2L16 8l-4.2 1.8L10 14l-1.8-4.2L4 8l4.2-1.8L10 2z"/></svg>',
    pdf:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h7l4 4v12H5V2z"/><path d="M12 2v4h4"/></svg>',
    xls:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M7 7l6 6M13 7l-6 6"/></svg>',
  };

  const REPORTS = [
    { title: "تقرير الأداء الشهري", sub: "ملخص الطلبات والمراجعات والقرارات لشهر كامل", icon: "chart",  color: "",      tag: "شهري",  pages: 12, lastGen: "أمس" },
    { title: "تقرير الامتثال والمخالفات", sub: "كل المخالفات المرصودة مع تفاصيل المبنى وموقعه", icon: "shield", color: "ok",   tag: "ربعي",  pages: 28, lastGen: "قبل ٣ أيام" },
    { title: "تقرير الغرامات المالية", sub: "الغرامات المُقدّرة والمحصّلة، مفصّلة حسب الحي", icon: "money",  color: "warn", tag: "شهري",  pages: 18, lastGen: "اليوم" },
    { title: "التقرير الجغرافي للنشاط", sub: "توزيع الطلبات والمخالفات على مناطق الأمانة", icon: "map",    color: "",      tag: "أسبوعي", pages: 9,  lastGen: "قبل يومين" },
    { title: "تقرير أداء المراجعين", sub: "إنتاجية كل مراجع، نسبة الموافقة، ومتوسط زمن المراجعة", icon: "users",  color: "",      tag: "شهري",  pages: 14, lastGen: "أمس" },
    { title: "ملخص الذكاء الاصطناعي", sub: "ما اكتشفه النظام الذكي قبل المراجع — مع نسب الدقة", icon: "ai",     color: "ai",   tag: "أسبوعي", pages: 7,  lastGen: "اليوم" },
  ];

  const SCHEDULED = [
    { name: "تقرير الأداء الشهري",     freq: "أول كل شهر · ٠٨:٠٠",     to: "almasaoul@amman.jo + ٤", next: "١ حزيران ٢٠٢٦",   last: "١ أيار ٢٠٢٦",  status: "active" },
    { name: "ملخص الغرامات الأسبوعي", freq: "كل أحد · ٠٧:٠٠",          to: "finance@amman.jo + ٢",  next: "١٠ أيار ٢٠٢٦",     last: "٣ أيار ٢٠٢٦",  status: "active" },
    { name: "تقرير المخالفات الجسيمة", freq: "فوري عند الاكتشاف",       to: "legal@amman.jo",        next: "حسب الحدث",      last: "٢٩ نيسان ٢٠٢٦", status: "active" },
    { name: "تقرير المراجعين الشهري", freq: "آخر كل شهر · ١٧:٠٠",      to: "hr@amman.jo + ١",       next: "٣١ أيار ٢٠٢٦",    last: "٣٠ نيسان ٢٠٢٦", status: "active" },
    { name: "تقرير الذكاء الاصطناعي",  freq: "كل أسبوعين · الإثنين",     to: "ai-ops@amman.jo + ٣",   next: "١١ أيار ٢٠٢٦",    last: "٢٧ نيسان ٢٠٢٦", status: "paused" },
  ];

  const RECENT = [
    { name: "تقرير_الأداء_الشهري_أيار_٢٠٢٦.pdf", fmt: "pdf", who: "أنت",                 size: "١٫٤ MB", time: "منذ ١٢ دقيقة" },
    { name: "غرامات_الأسبوع_W18_٢٠٢٦.xlsx",     fmt: "xls", who: "إيمان الزعبي",        size: "٤٢٠ KB", time: "منذ ٤٥ دقيقة" },
    { name: "النشاط_الجغرافي_نيسان.pdf",          fmt: "pdf", who: "خالد الفايز",        size: "٢٫١ MB", time: "منذ ساعتين" },
    { name: "مخالفات_العبدلي.csv",                 fmt: "csv", who: "ميسون عبيدات",     size: "٨٧ KB",  time: "اليوم ٠٩:٢٠" },
    { name: "أداء_المراجعين_شهري.xlsx",            fmt: "xls", who: "زيد العواملة",     size: "٦٤٠ KB", time: "أمس" },
    { name: "ملخص_AI_W17.pdf",                     fmt: "pdf", who: "تلقائي · مجدول",  size: "٧٨٠ KB", time: "أمس" },
  ];

  const SUGGEST = [
    { title: "زيادة طلبات حي العبدلي ٤٧٪",   sub: "نموذج تنبؤ يقترح إعداد تقرير سبب الزيادة قبل اجتماع المدير",  iconKey: "ai" },
    { title: "تكرار مخالفة الارتداد الأمامي ٥م", sub: "اقتراح تقرير مخصص لشارع الياسمين — ٤٢٪ من الطلبات",         iconKey: "ai" },
    { title: "اقتراب SLA من ٦ معاملات",            sub: "تقرير عاجل يُظهر المعاملات قبل تجاوزها",                     iconKey: "ai" },
  ];

  // Render report cards
  function renderGrid() {
    const root = $("rep-grid");
    if (!root) return;
    root.innerHTML = "";
    REPORTS.forEach((r) => {
      const div = document.createElement("article");
      div.className = "rep-card";
      const colorCls = r.color ? `rep-card-icon--${r.color}` : "";
      div.innerHTML = `
        <div class="rep-card-top">
          <div class="rep-card-icon ${colorCls}">${ICONS[r.icon]}</div>
          <span class="rep-card-tag">${r.tag}</span>
        </div>
        <div>
          <h3 class="rep-card-title">${r.title}</h3>
          <p class="rep-card-sub">${r.sub}</p>
        </div>
        <div class="rep-card-meta">
          <span><strong>${r.pages}</strong> صفحة</span>
          <span>·</span>
          <span>آخر إصدار ${r.lastGen}</span>
        </div>
        <div class="rep-card-actions">
          <button class="rep-fmt-btn" type="button">${ICONS.pdf}<span>PDF</span></button>
          <button class="rep-fmt-btn" type="button">${ICONS.xls}<span>Excel</span></button>
        </div>
      `;
      root.appendChild(div);
    });
  }

  function renderScheduled() {
    const tbody = document.querySelector("#rep-sched tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const STATUS_LABEL = {
      active: { lbl: "نشط",   cls: "ov-status-pill--ok" },
      paused: { lbl: "موقوف", cls: "ov-status-pill--warn" },
    };
    SCHEDULED.forEach((s) => {
      const st = STATUS_LABEL[s.status];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${s.name}</strong></td>
        <td>${s.freq}</td>
        <td>${s.to}</td>
        <td class="ov-num">${s.next}</td>
        <td>${s.last}</td>
        <td><span class="ov-status-pill ${st.cls}">${st.lbl}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderRecent() {
    const root = $("rep-recent");
    if (!root) return;
    root.innerHTML = "";
    RECENT.forEach((r) => {
      const div = document.createElement("div");
      div.className = "rep-recent-row";
      div.innerHTML = `
        <div class="rep-recent-icon rep-recent-icon--${r.fmt}">${r.fmt.toUpperCase()}</div>
        <div>
          <div class="rep-recent-name">${r.name}</div>
          <div class="rep-recent-meta">${r.who} · ${r.size}</div>
        </div>
        <div class="rep-recent-time">${r.time}</div>
      `;
      root.appendChild(div);
    });
  }

  function renderSuggested() {
    const root = $("rep-suggest");
    if (!root) return;
    root.innerHTML = "";
    SUGGEST.forEach((s) => {
      const div = document.createElement("div");
      div.className = "rep-suggest-row";
      div.innerHTML = `
        <div class="rep-suggest-icon">${ICONS.ai}</div>
        <div>
          <div class="rep-suggest-title">${s.title}</div>
          <div class="rep-suggest-sub">${s.sub}</div>
        </div>
      `;
      root.appendChild(div);
    });
  }

  function boot() {
    renderGrid();
    renderScheduled();
    renderRecent();
    renderSuggested();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
