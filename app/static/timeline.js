/* Timeline page — activity feed + heatmap from mock constants */
(function () {
  "use strict";
  if (!window.SASession) return;
  const $ = (id) => document.getElementById(id);

  // Mock event types
  const ICONS = {
    submit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14v9a2 2 0 01-2 2h-3l-2 2-2-2H5a2 2 0 01-2-2V4z"/><path d="M7 9h6M7 12h4"/></svg>',
    review: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h14v9H8l-3 3v-3H3V5z"/><path d="M7 9h6M7 11h4"/></svg>',
    approve:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l4 4 8-9"/></svg>',
    reject: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M7 7l6 6M13 7l-6 6"/></svg>',
    revision: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 1010-4M4 10V5M4 10h5"/></svg>',
    comment:'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h14v9H8l-3 3v-3H3V5z"/></svg>',
    ai:     '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l1.8 4.2L16 8l-4.2 1.8L10 14l-1.8-4.2L4 8l4.2-1.8L10 2z"/></svg>',
    alert:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3l8 14H2L10 3z"/><path d="M10 9v3M10 14.5h.01"/></svg>',
    upload: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v2h12v-2M10 4v9M6 8l4-4 4 4"/></svg>',
  };

  // Activity feed grouped by day
  const FEED = [
    {
      day: "اليوم · ١ أيار ٢٠٢٦",
      events: [
        { time: "١٥:٤٢", type: "ai",      sev: "ai",   actor: "النظام الذكي", action: "اكتشف",   target: "تجاوز نسبة التغطية في طلب #٤٢٣٧",  extra: "حي العبدلي · ٢٫٤٪ زيادة", tag: "AI", tagCls: "ai" },
        { time: "١٥:٢٨", type: "approve", sev: "ok",   actor: "إيمان الزعبي",  action: "وافقت على", target: "طلب الترخيص #٤٢٣٢", extra: "بعد ٢٫١ يوم مراجعة", tag: "موافقة", tagCls: "ok" },
        { time: "١٤:٥٠", type: "submit",  sev: "info", actor: "محمد العمري",  action: "قدّم",      target: "طلب جديد #٤٢٣٨ — الجبيهة", extra: "تأشيرة + سند + مخطط", tag: "تقديم", tagCls: "" },
        { time: "١٤:١٢", type: "alert",   sev: "warn", actor: "النظام",       action: "نبّه عن",   target: "اقتراب SLA — ٦ معاملات", extra: "يجب الحسم خلال ٤٨ ساعة", tag: "تنبيه", tagCls: "warn" },
        { time: "١٣:٣٠", type: "revision",sev: "warn", actor: "خالد الفايز",  action: "أعاد إلى التعديل", target: "طلب #٤٢٢١", extra: "وثائق ناقصة — مخطط موقع تنظيمي", tag: "إعادة", tagCls: "warn" },
        { time: "١٢:٤٥", type: "review",  sev: "info", actor: "ميسون عبيدات", action: "بدأت مراجعة", target: "طلب #٤٢٣٠ — الصويفية", extra: "", tag: "مراجعة", tagCls: "" },
        { time: "١٢:١٢", type: "ai",      sev: "ai",   actor: "النظام الذكي", action: "اكتشف نمطًا في", target: "مخالفات شارع الياسمين", extra: "٤٢٪ يخالف الارتداد الأمامي ٥م", tag: "AI", tagCls: "ai" },
        { time: "١١:٢٠", type: "reject",  sev: "err",  actor: "زيد العواملة", action: "رفض",       target: "طلب #٤١٩٨", extra: "تجاوز حدود القطعة بـ ١٢م²", tag: "رفض", tagCls: "err" },
        { time: "١٠:٤٥", type: "upload",  sev: "info", actor: "ندى الكساسبة", action: "حدّثت وثائق", target: "طلب #٤٢١٥", extra: "أعادت رفع المخطط الطابقي", tag: "تحديث", tagCls: "" },
        { time: "٠٩:٣٠", type: "approve", sev: "ok",   actor: "إيمان الزعبي", action: "وافقت على", target: "طلب #٤٢٢٧", extra: "بدون مخالفات", tag: "موافقة", tagCls: "ok" },
      ]
    },
    {
      day: "أمس · ٣٠ نيسان ٢٠٢٦",
      events: [
        { time: "١٧:١٢", type: "ai",      sev: "ai",   actor: "النظام الذكي", action: "أنتج تقرير", target: "ملخص النهاية لشهر نيسان", extra: "تم إرساله إلى ٤ مستلمين", tag: "AI", tagCls: "ai" },
        { time: "١٦:٤٥", type: "alert",   sev: "err",  actor: "النظام",       action: "تجاوز SLA",  target: "معاملة #٤١٢٢ — ضاحية الرشيد", extra: "١٥ يوم بدون قرار — للتصعيد", tag: "تجاوز", tagCls: "err" },
        { time: "١٤:٣٠", type: "approve", sev: "ok",   actor: "خالد الفايز",  action: "وافق على",   target: "طلب #٤٢٠٥", extra: "بناء قائم لأول مرة", tag: "موافقة", tagCls: "ok" },
        { time: "١٣:١٥", type: "submit",  sev: "info", actor: "أحمد القضاة",  action: "قدّم",      target: "طلب #٤٢٣٦ — العبدلي", extra: "ترخيص فوق قائم — ١٢٠٠ م²", tag: "تقديم", tagCls: "" },
        { time: "١١:٠٠", type: "comment", sev: "info", actor: "ميسون عبيدات", action: "علّقت على",  target: "طلب #٤٢١٨", extra: "طلبت توضيحًا لخط البناء الخلفي", tag: "تعليق", tagCls: "" },
        { time: "٠٩:٢٠", type: "review",  sev: "info", actor: "زيد العواملة", action: "أكمل مراجعة", target: "٧ طلبات", extra: "متوسط ٢٫٤ يوم/طلب", tag: "مراجعة", tagCls: "" },
      ]
    },
    {
      day: "قبل يومين · ٢٩ نيسان ٢٠٢٦",
      events: [
        { time: "١٨:٠٠", type: "ai",      sev: "ai",   actor: "النظام الذكي", action: "اكتشف",   target: "ارتفاع غير اعتيادي في طلبات حي العبدلي", extra: "زيادة ٤٧٪ خلال ٧ أيام", tag: "AI", tagCls: "ai" },
        { time: "١٥:٣٠", type: "reject",  sev: "err",  actor: "إيمان الزعبي", action: "رفضت",    target: "طلب #٤١٧٤", extra: "وثائق متعارضة — السند والمخطط لا يطابقان", tag: "رفض", tagCls: "err" },
        { time: "١٢:٤٠", type: "upload",  sev: "info", actor: "ليلى خليل",    action: "رفعت",    target: "نسخة معدّلة من #٤١٨٢", extra: "بعد طلب التعديل من المراجع", tag: "تحديث", tagCls: "" },
        { time: "١٠:١٥", type: "approve", sev: "ok",   actor: "ندى الكساسبة", action: "وافقت على", target: "٣ طلبات دفعة واحدة", extra: "موافقة جماعية — كلها متطابقة", tag: "جماعية", tagCls: "ok" },
        { time: "٠٨:٣٠", type: "alert",   sev: "warn", actor: "النظام",       action: "نبّه",     target: "وثائق ناقصة في ١٤ طلبًا", extra: "غالبًا مخطط موقع تنظيمي", tag: "تنبيه", tagCls: "warn" },
      ]
    },
  ];

  // Heatmap: 12 weeks × 7 days = 84 cells. Random-ish realistic intensity.
  const HEAT_DATA = [];
  const SEED = [
    1,0,2,3,2,4,3, 2,1,3,4,3,2,4, 3,2,4,4,3,5,4, 2,3,4,5,4,5,5, 4,3,5,5,4,5,5, 3,4,5,5,5,6,6,
    4,5,5,6,6,5,7, 5,6,6,7,6,6,7, 6,5,7,7,7,7,8, 7,6,8,8,7,8,8, 7,8,8,9,8,8,9, 8,7,9,9,8,9,9,
  ];
  for (let i = 0; i < 84; i++) HEAT_DATA.push(SEED[i] || 1);

  function colorForLevel(level) {
    // level 0–9 → 5 buckets
    if (level <= 1) return "#eef1f7";
    if (level <= 3) return "#bfdbfe";
    if (level <= 5) return "#60a5fa";
    if (level <= 7) return "#2563eb";
    return "#1e3a8a";
  }

  function renderHeatmap() {
    const root = $("tl-heatmap");
    if (!root) return;
    root.innerHTML = "";
    HEAT_DATA.forEach((lvl, idx) => {
      const cell = document.createElement("div");
      cell.className = "tl-heat-cell";
      cell.style.background = colorForLevel(lvl);
      const w = Math.floor(idx / 7) + 1;
      const d = (idx % 7) + 1;
      cell.title = `الأسبوع ${w}، اليوم ${d} — ${lvl * 12 + 5} حدثًا`;
      root.appendChild(cell);
    });
  }

  function renderFeed() {
    const root = $("tl-feed");
    if (!root) return;
    root.innerHTML = "";
    let total = 0;
    FEED.forEach((day) => {
      const dayDiv = document.createElement("div");
      dayDiv.className = "tl-day";
      const head = document.createElement("div");
      head.className = "tl-day-head";
      head.textContent = day.day;
      dayDiv.appendChild(head);
      day.events.forEach((e) => {
        total++;
        const div = document.createElement("div");
        div.className = "tl-event";
        const tagPill = e.tag ? `<span class="tl-event-meta-pill tl-event-tag--${e.tagCls}">${e.tag}</span>` : "";
        div.innerHTML = `
          <div class="tl-event-time">${e.time}</div>
          <div class="tl-event-icon tl-event-icon--${e.sev}">${ICONS[e.type] || ICONS.alert}</div>
          <div class="tl-event-body">
            <div class="tl-event-actor"><strong>${e.actor}</strong> ${e.action} <span class="tl-event-target">${e.target}</span></div>
            <div class="tl-event-meta">
              ${tagPill}
              ${e.extra ? `<span>${e.extra}</span>` : ""}
            </div>
          </div>
          <div class="tl-event-extra"></div>
        `;
        dayDiv.appendChild(div);
      });
      root.appendChild(dayDiv);
    });
    const counter = $("tl-event-count");
    if (counter) counter.textContent = total.toLocaleString("ar-EG") + " حدثًا";
  }

  function boot() {
    renderHeatmap();
    renderFeed();
    document.querySelectorAll(".ov-period-pill").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".ov-period-pill").forEach((x) => x.classList.remove("ov-period-pill--active"));
        b.classList.add("ov-period-pill--active");
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
