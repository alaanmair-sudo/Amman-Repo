/* Settings page — tab switching, slider live value, integrations list */
(function () {
  "use strict";
  if (!window.SASession) return;
  const $ = (id) => document.getElementById(id);

  const INTEGRATIONS = [
    { initials: "GIS", name: "نظام GIS أمانة عمان",                 sub: "تبادل بيانات الأحياء والأحواض",          status: "on"  },
    { initials: "S",   name: "بوابة سند الإلكترونية",                 sub: "التحقق التلقائي من سندات التسجيل",       status: "on"  },
    { initials: "ID",  name: "خدمة التحقق من الهوية الوطنية",          sub: "OAuth حكومي · IDP",                        status: "on"  },
    { initials: "M",   name: "بوابة الأمانة الإلكترونية",                sub: "نقل الطلبات والقرارات للنظام المركزي",   status: "on"  },
    { initials: "$",   name: "نظام eFAWATEERcom",                       sub: "تحصيل الرسوم والغرامات",                  status: "on"  },
    { initials: "📧",  name: "Microsoft 365 — البريد المؤسسي",         sub: "إرسال التقارير والتنبيهات",                 status: "on"  },
    { initials: "📱",  name: "بوابة الرسائل القصيرة",                    sub: "تنبيهات SMS للحالات الجسيمة",              status: "on"  },
    { initials: "T",   name: "Microsoft Teams",                         sub: "قناة تواصل قسم التراخيص",                  status: "off" },
    { initials: "C",   name: "Anthropic Claude API",                    sub: "محرك الذكاء الاصطناعي",                    status: "on"  },
    { initials: "</>", name: "Webhook خارجي مخصص",                       sub: "بث أحداث JSON لأي عنوان",                   status: "off" },
  ];

  function renderIntegrations() {
    const root = $("set-integrations");
    if (!root) return;
    INTEGRATIONS.forEach((it) => {
      const div = document.createElement("div");
      div.className = "set-int-card";
      const cls = it.status === "on" ? "set-int-status--on" : "set-int-status--off";
      const lbl = it.status === "on" ? "مفعّل" : "معطّل";
      div.innerHTML = `
        <div class="set-int-icon">${it.initials}</div>
        <div>
          <div class="set-int-name">${it.name}</div>
          <div class="set-int-sub">${it.sub}</div>
        </div>
        <span class="set-int-status ${cls}">${lbl}</span>
      `;
      root.appendChild(div);
    });
  }

  function bindTabs() {
    document.querySelectorAll(".set-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".set-tab").forEach((x) => x.classList.remove("set-tab--active"));
        btn.classList.add("set-tab--active");
        document.querySelectorAll(".set-pane").forEach((p) => {
          p.classList.toggle("set-pane--active", p.dataset.pane === target);
        });
      });
    });
  }

  function bindSlider() {
    const sl = $("ai-threshold");
    const val = $("ai-threshold-val");
    if (!sl || !val) return;
    function arDigits(s) { return String(s).replace(/[0-9]/g, (g) => "٠١٢٣٤٥٦٧٨٩"[+g]); }
    function update() {
      const v = parseInt(sl.value, 10);
      val.textContent = arDigits(v) + "٪";
      sl.style.setProperty("--val", `${((v - 50) / 49) * 100}%`);
    }
    sl.addEventListener("input", update);
    update();
  }

  function boot() { renderIntegrations(); bindTabs(); bindSlider(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
