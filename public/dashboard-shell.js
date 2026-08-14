(() => {
  "use strict";

  const body = document.body;
  if (!body || body.dataset.enhanced === "true") return;

  const requestedView = new URLSearchParams(window.location.search).get("view")?.toLowerCase();
  const pages = [
    { key: "10m", query: "10m", label: "10 min", ageMinutes: 10 },
    { key: "15m", query: "15m", label: "15 min", ageMinutes: 15 },
    { key: "30m", query: "30m", label: "30 min", ageMinutes: 30 },
    { key: "60m", query: "60m", label: "60 min", ageMinutes: 60 },
    { key: "v2", query: "v2", label: "V2 lab", ageMinutes: 120 },
  ];
  const aliases = { "10": "10m", "15": "15m", "30": "30m", "60": "60m" };
  const normalizedView = aliases[requestedView] || requestedView || "10m";
  let currentPage = pages.find((page) => page.key === normalizedView) || pages[0];

  const heading = body.querySelector(":scope > h2");
  const clocks = body.querySelector(":scope > .clockbar");
  const controls = body.querySelector(":scope > .row");
  const list = document.getElementById("list");
  if (!heading || !clocks || !controls || !list) return;

  document.title = `Meme Monitor · ${currentPage.label}`;
  body.dataset.enhanced = "true";
  body.dataset.view = currentPage.key;
  body.classList.add("enhanced");
  heading.classList.add("legacy-title", "sr-only");

  const skipLink = document.createElement("a");
  skipLink.className = "skip-link";
  skipLink.href = "#signals";
  skipLink.textContent = "Skip to live signals";

  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <a class="brand" href="./index.html?view=10m" aria-label="Meme Monitor home">
      <span class="brand-mark" aria-hidden="true">MM</span>
      <span class="brand-copy"><strong>Meme Monitor</strong><span>Signal desk</span></span>
    </a>
    <nav class="window-nav" aria-label="Signal window">
      ${pages.map((page) => `
        <a href="./index.html?view=${page.query}" data-view="${page.key}" ${page.key === currentPage.key ? 'aria-current="page"' : ""}>${page.label}</a>
      `).join("")}
    </nav>
    <div class="live-chip" data-state="connecting">Connecting</div>
  `;

  const main = document.createElement("main");
  main.className = "dashboard-shell";

  const hero = document.createElement("section");
  hero.className = "hero";
  hero.setAttribute("aria-labelledby", "dashboard-heading");
  hero.innerHTML = `
    <div class="hero-copy">
      <p class="eyebrow">Solana signal intelligence / ${currentPage.label}</p>
      <h1 id="dashboard-heading">Read the market <span>before the noise.</span></h1>
      <p class="hero-description">Liquidity, order flow, valuation, and short-term velocity distilled into one live meme-token feed.</p>
      <div class="hero-actions">
        <a class="jump-link" href="#signals">View live signals <span aria-hidden="true">↓</span></a>
        <a class="text-link" href="#filters">Tune filters</a>
      </div>
      <div class="hero-stats" aria-label="Feed summary">
        <div class="hero-stat"><strong>10 sec</strong><span>Polling cycle</span></div>
        <div class="hero-stat"><strong>SSE</strong><span>Live delivery</span></div>
        <div class="hero-stat"><strong>${currentPage.ageMinutes} min</strong><span>Active window</span></div>
      </div>
    </div>
    <aside class="market-panel" aria-label="Live market clocks">
      <div class="market-panel__head"><span>Market clocks / 01</span><span class="ready-dot" data-state="connecting">Connecting</span></div>
      <h2 class="market-panel__title">One feed. Three market clocks.</h2>
      <p class="market-panel__copy">Mountain Time follows Edmonton and observes daylight saving time.</p>
      <div class="clock-slot"></div>
      <div class="market-panel__foot"><span>DexScreener source</span><strong data-state="connecting">Connecting</strong></div>
    </aside>
  `;

  const controlWrap = document.createElement("section");
  controlWrap.className = "control-wrap";
  controlWrap.id = "filters";
  controlWrap.setAttribute("aria-labelledby", "controls-heading");

  const controlPanel = document.createElement("div");
  controlPanel.className = "control-panel";
  controlPanel.innerHTML = `
    <div class="control-intro">
      <p class="section-index">Live controls / 02</p>
      <div class="control-title-row">
        <h2 class="section-title" id="controls-heading">Tune the signal.</h2>
        <button type="button" id="filtersToggle" class="filters-toggle" aria-expanded="true">Collapse filters</button>
      </div>
      <p class="section-copy">Filter, rank, and reshape the stream without interrupting live delivery.</p>
    </div>
    <div class="control-body"><div class="panel-notes"></div></div>
  `;

  const feed = document.createElement("section");
  feed.className = "feed-section";
  feed.id = "signals";
  feed.setAttribute("aria-labelledby", "feed-heading");
  feed.innerHTML = `
    <div class="feed-head">
      <div><p class="section-index">Market candidates / 03</p><h2 class="section-title" id="feed-heading">Live signal feed.</h2></div>
      <div class="feed-metrics" aria-live="polite">
        <span id="feedCount">Preparing feed</span>
        <time id="lastUpdated">Waiting for connection</time>
      </div>
    </div>
  `;

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `
    <p><span class="footer-label">Meme Monitor</span> / Real-time signal intelligence</p>
    <p>Data via DexScreener · Research indicators only</p>
  `;

  const notes = [];
  let cursor = controls.nextElementSibling;
  while (cursor && cursor !== list) {
    const next = cursor.nextElementSibling;
    if (cursor.tagName !== "AUDIO" && cursor.tagName !== "SCRIPT") notes.push(cursor);
    cursor = next;
  }

  body.insertBefore(skipLink, heading);
  body.insertBefore(header, heading);
  body.insertBefore(main, heading);
  main.append(hero, controlWrap, feed, footer);
  hero.querySelector(".hero-copy").appendChild(heading);
  hero.querySelector(".clock-slot").appendChild(clocks);
  controlWrap.appendChild(controlPanel);
  controlPanel.querySelector(".control-body").prepend(controls);
  const notesSlot = controlPanel.querySelector(".panel-notes");
  notes.forEach((note) => notesSlot.appendChild(note));
  feed.appendChild(list);

  const status = document.getElementById("status");
  status.classList.add("connection-status");
  status.setAttribute("aria-live", "polite");
  status.dataset.state = "connecting";

  function setConnectionState(state) {
    const labels = {
      connecting: { header: "Connecting", panel: "Connecting" },
      connected: { header: "Live feed", panel: "Streaming" },
      reconnecting: { header: "Retrying", panel: "Reconnecting" },
      stale: { header: "Data stale", panel: "Waiting" },
      offline: { header: "Offline", panel: "Unavailable" },
    };
    const value = labels[state] || labels.connecting;
    const liveChip = header.querySelector(".live-chip");
    const ready = hero.querySelector(".ready-dot");
    const panelState = hero.querySelector(".market-panel__foot strong");
    for (const element of [liveChip, ready, panelState, status]) element.dataset.state = state;
    liveChip.textContent = value.header;
    ready.textContent = value.panel;
    panelState.textContent = value.panel;
  }

  function setFeedMeta({ visible, total, lastUpdated }) {
    const count = document.getElementById("feedCount");
    const updated = document.getElementById("lastUpdated");
    count.textContent = visible === null ? `${total} cached signals` : `${visible} shown · ${total} cached`;
    if (lastUpdated) {
      updated.dateTime = new Date(lastUpdated).toISOString();
      updated.textContent = `Last activity ${new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(lastUpdated))}`;
    } else {
      updated.removeAttribute("datetime");
      updated.textContent = "Waiting for connection";
    }
  }

  function setFiltersCollapsed(collapsed) {
    controlWrap.classList.toggle("is-collapsed", collapsed);
    const toggle = document.getElementById("filtersToggle");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "Open filters" : "Collapse filters";
  }

  const api = { currentPage, setConnectionState, setFeedMeta, setFiltersCollapsed };

  function activateView(page, updateHistory = false) {
    if (!page) return;
    currentPage = page;
    api.currentPage = page;
    document.title = `Meme Monitor · ${page.label}`;
    body.dataset.view = page.key;
    header.querySelectorAll(".window-nav a").forEach((link) => {
      if (link.dataset.view === page.key) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    hero.querySelector(".eyebrow").textContent = `Solana signal intelligence / ${page.label}`;
    hero.querySelector(".hero-stat:last-child strong").textContent = `${page.ageMinutes} min`;
    if (updateHistory) history.pushState({ view: page.key }, "", `./index.html?view=${page.query}`);
    window.dispatchEvent(new CustomEvent("meme-monitor:view-change", { detail: page }));
  }

  header.querySelector(".window-nav").addEventListener("click", (event) => {
    const link = event.target.closest("a[data-view]");
    if (!link) return;
    const page = pages.find((candidate) => candidate.key === link.dataset.view);
    if (!page || page.key === currentPage.key) return;
    event.preventDefault();
    activateView(page, true);
  });

  window.addEventListener("popstate", () => {
    const requested = new URLSearchParams(window.location.search).get("view")?.toLowerCase();
    const normalized = aliases[requested] || requested || "10m";
    activateView(pages.find((page) => page.key === normalized) || pages[0]);
  });

  window.MemeDashboardShell = api;
  setConnectionState("connecting");
})();
