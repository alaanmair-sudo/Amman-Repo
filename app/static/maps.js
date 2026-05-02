/* Maps page — stylized SVG map of Amman regions with layer toggle */
(function () {
  "use strict";
  if (!window.SASession) return;
  const $ = (id) => document.getElementById(id);

  // Stylized regions with hand-positioned polygons (relative to 600x480 viewBox).
  // Each region carries multi-layer values so layer toggle just remaps colors.
  const REGIONS = [
    { id:"jubaiha",  name:"الجبيهة",       polygon:"180,40 250,30 290,80 250,130 180,120",        cx:230, cy:80,  density:487, violations:117, fines:78420,  zoning:"سكني A" },
    { id:"sweifieh", name:"الصويفية",      polygon:"320,150 400,140 430,200 380,250 320,230",     cx:370, cy:195, density:412, violations:128, fines:92150,  zoning:"تجاري + سكني" },
    { id:"tlaa",     name:"تلاع العلي",    polygon:"100,90 175,80 195,160 130,170 80,140",        cx:135, cy:125, density:386, violations:84,  fines:64800,  zoning:"سكني B" },
    { id:"abdali",   name:"العبدلي",       polygon:"305,80 380,70 415,135 370,150 310,130",       cx:355, cy:105, density:341, violations:130, fines:105600, zoning:"تجاري كثيف" },
    { id:"andalus",  name:"الأندلس",        polygon:"430,55 500,50 525,110 480,135 425,120",       cx:475, cy:90,  density:298, violations:57,  fines:41250,  zoning:"سكني A" },
    { id:"daboq",    name:"دابوق",         polygon:"50,180 130,175 145,235 90,260 30,225",        cx:85,  cy:215, density:267, violations:70,  fines:56400,  zoning:"سكني خاص" },
    { id:"khalda",   name:"خلدا",          polygon:"195,200 285,195 305,275 240,290 175,265",     cx:235, cy:240, density:254, violations:53,  fines:38900,  zoning:"سكني B" },
    { id:"marj",     name:"مرج الحمام",    polygon:"230,310 320,300 340,380 270,395 215,370",     cx:275, cy:345, density:231, violations:58,  fines:47200,  zoning:"سكني C" },
    { id:"yasmeen",  name:"الياسمين",      polygon:"395,260 470,255 490,330 430,350 375,320",     cx:430, cy:300, density:198, violations:36,  fines:29800,  zoning:"سكني B" },
    { id:"rashid",   name:"ضاحية الرشيد",  polygon:"475,160 545,155 565,220 510,245 460,215",     cx:510, cy:195, density:184, violations:40,  fines:33500,  zoning:"سكني A" },
    { id:"marka",    name:"ماركا",         polygon:"445,30 525,30 540,80 490,95 440,75",          cx:490, cy:60,  density:142, violations:32,  fines:22800,  zoning:"صناعي + سكني" },
    { id:"tarbarbour",name:"طبربور",       polygon:"335,15 415,15 435,55 385,75 330,55",          cx:385, cy:40,  density:128, violations:28,  fines:19600,  zoning:"سكني C" },
  ];

  const MONTHS = [
    "حزيران ٢٠٢٥","تموز ٢٠٢٥","آب ٢٠٢٥","أيلول ٢٠٢٥",
    "تشرين الأول ٢٠٢٥","تشرين الثاني ٢٠٢٥","كانون الأول ٢٠٢٥","كانون الثاني ٢٠٢٦",
    "شباط ٢٠٢٦","آذار ٢٠٢٦","نيسان ٢٠٢٦","أيار ٢٠٢٦",
  ];

  // Color scales per layer (5 buckets each, low → high)
  const PALETTES = {
    density:    ["#dbeafe","#93c5fd","#60a5fa","#2563eb","#1e3a8a"],
    violations: ["#fee2e2","#fecaca","#fca5a5","#ef4444","#7f1d1d"],
    fines:      ["#fef3c7","#fde68a","#fbbf24","#f59e0b","#92400e"],
    zoning:     ["#d1fae5","#a7f3d0","#6ee7b7","#10b981","#065f46"],
  };
  const LAYER_LABELS = {
    density:    "كثافة الطلبات",
    violations: "المخالفات",
    fines:      "الغرامات (د.أ)",
    zoning:     "تنوّع التنظيم",
  };
  const LAYER_VALUE_KEYS = {
    density: "density", violations: "violations", fines: "fines", zoning: null,
  };

  let currentLayer = "density";
  let selectedId = null;

  function bucketFor(value, layer) {
    if (layer === "zoning") {
      // Different visualization: hash zoning string to a color index
      const zones = Array.from(new Set(REGIONS.map(r => r.zoning)));
      return zones.indexOf(REGIONS.find(r => r.zoning === value).zoning) % 5;
    }
    const key = LAYER_VALUE_KEYS[layer];
    const values = REGIONS.map(r => r[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const ratio = (value - min) / (max - min || 1);
    return Math.min(4, Math.floor(ratio * 5));
  }

  function colorFor(region, layer) {
    if (layer === "zoning") {
      const zones = Array.from(new Set(REGIONS.map(r => r.zoning)));
      const idx = zones.indexOf(region.zoning) % 5;
      return PALETTES.zoning[idx];
    }
    const key = LAYER_VALUE_KEYS[layer];
    return PALETTES[layer][bucketFor(region[key], layer)];
  }

  function renderMap() {
    const svg = $("map-svg");
    if (!svg) return;
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = "";

    // Grid bg
    const grid = document.createElementNS(ns, "pattern");
    grid.setAttribute("id", "mapgrid");
    grid.setAttribute("patternUnits", "userSpaceOnUse");
    grid.setAttribute("width", "32"); grid.setAttribute("height", "32");
    grid.innerHTML = `<path d="M32 0H0V32" fill="none" stroke="rgba(15,23,42,.04)" />`;
    const defs = document.createElementNS(ns, "defs");
    defs.appendChild(grid);
    svg.appendChild(defs);
    const bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "url(#mapgrid)");
    svg.appendChild(bg);

    REGIONS.forEach((r) => {
      const poly = document.createElementNS(ns, "polygon");
      poly.setAttribute("points", r.polygon);
      poly.setAttribute("fill", colorFor(r, currentLayer));
      poly.setAttribute("class", "map-region" + (r.id === selectedId ? " map-region--selected" : ""));
      poly.dataset.id = r.id;
      poly.addEventListener("click", () => selectRegion(r.id));
      poly.addEventListener("mouseenter", () => {
        const title = document.createElementNS(ns, "title");
        title.textContent = `${r.name} · ${r.density} طلب`;
        poly.appendChild(title);
      });
      svg.appendChild(poly);

      // Label
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", r.cx);
      text.setAttribute("y", r.cy);
      text.setAttribute("class", "map-label");
      text.textContent = r.name;
      svg.appendChild(text);
    });
  }

  function selectRegion(id) {
    selectedId = id;
    const r = REGIONS.find(x => x.id === id);
    if (!r) return;
    renderMap();
    const detail = $("map-detail");
    const titleEl = $("map-detail-title");
    const subEl   = $("map-detail-sub");
    if (titleEl) titleEl.textContent = r.name;
    if (subEl)   subEl.textContent = `تنظيم: ${r.zoning}`;
    if (detail) {
      detail.innerHTML = `
        <div class="map-detail-stat"><span class="map-detail-stat-label">الطلبات</span><span class="map-detail-stat-num">${r.density.toLocaleString("ar-EG")}</span></div>
        <div class="map-detail-stat"><span class="map-detail-stat-label">المخالفات</span><span class="map-detail-stat-num">${r.violations.toLocaleString("ar-EG")}</span></div>
        <div class="map-detail-stat"><span class="map-detail-stat-label">الغرامات</span><span class="map-detail-stat-num">${r.fines.toLocaleString("ar-EG")} د.أ</span></div>
        <div class="map-detail-stat"><span class="map-detail-stat-label">نسبة المخالفات</span><span class="map-detail-stat-num">${(r.violations/r.density*100).toFixed(1)}٪</span></div>
        <div class="map-detail-stat"><span class="map-detail-stat-label">متوسط الغرامة</span><span class="map-detail-stat-num">${Math.round(r.fines/r.violations).toLocaleString("ar-EG")} د.أ</span></div>
      `;
    }
  }

  function renderRanking() {
    const root = $("map-rank");
    if (!root) return;
    const key = LAYER_VALUE_KEYS[currentLayer];
    const sorted = key
      ? [...REGIONS].sort((a, b) => b[key] - a[key]).slice(0, 5)
      : [...REGIONS].slice(0, 5);
    root.innerHTML = "";
    sorted.forEach((r) => {
      const li = document.createElement("li");
      const num = key
        ? (currentLayer === "fines" ? `${r[key].toLocaleString("ar-EG")} د.أ` : r[key].toLocaleString("ar-EG"))
        : r.zoning;
      li.innerHTML = `<span class="map-rank-name">${r.name}</span><span class="map-rank-num">${num}</span>`;
      li.addEventListener("click", () => selectRegion(r.id));
      root.appendChild(li);
    });
  }

  // Layer toggle buttons
  function bindLayerToggle() {
    document.querySelectorAll(".map-layer-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".map-layer-btn").forEach((x) => x.classList.remove("map-layer-btn--active"));
        btn.classList.add("map-layer-btn--active");
        currentLayer = btn.dataset.layer || "density";
        const titleEl = $("map-legend-title");
        if (titleEl) titleEl.textContent = LAYER_LABELS[currentLayer];
        renderMap();
        renderRanking();
      });
    });
  }

  // Time slider
  function bindTimeSlider() {
    const sl = $("map-time");
    const val = $("map-time-val");
    if (!sl || !val) return;
    sl.addEventListener("input", () => {
      const idx = parseInt(sl.value, 10);
      val.textContent = MONTHS[idx];
      sl.style.setProperty("--val", `${(idx / 11) * 100}%`);
    });
  }

  function boot() {
    renderMap();
    renderRanking();
    bindLayerToggle();
    bindTimeSlider();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
