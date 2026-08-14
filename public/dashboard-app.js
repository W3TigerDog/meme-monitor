(() => {
  "use strict";

  const logic = window.MemeDashboardLogic;
  const shell = window.MemeDashboardShell;
  if (!logic || !shell) return;

  let view = shell.currentPage;
  let usesV2 = view.key !== "10m";
  const preferenceKey = "meme-monitor:preferences:v2";

  const elements = {
    list: document.getElementById("list"),
    minScore: document.getElementById("minScore"),
    keyword: document.getElementById("kw"),
    ageWindow: document.getElementById("ageWindow"),
    ageWindowLabel: document.getElementById("ageWindowLabel"),
    alertScore: document.getElementById("alertScore"),
    sound: document.getElementById("soundOn"),
    compact: document.getElementById("compactMode"),
    sort: document.getElementById("sortBy"),
    clear: document.getElementById("clear"),
    undo: document.getElementById("undo"),
    status: document.getElementById("status"),
    filtersToggle: document.getElementById("filtersToggle"),
    controlWrap: document.querySelector(".control-wrap"),
  };

  let signals = [];
  let undoSnapshot = null;
  let undoTimer = null;
  let initialLoading = true;
  let initialLoadFailed = false;
  let connectionState = "connecting";
  let lastAliveAt = null;
  let lastSignalAt = null;
  let eventSource = null;
  let audioContext = null;

  function readPreferences() {
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  const saved = readPreferences();
  const preferences = {
    minScore: Number.isFinite(Number(saved.minScore)) ? Number(saved.minScore) : usesV2 ? 5 : 3,
    keyword: typeof saved.keyword === "string" ? saved.keyword : "",
    alertScore: Number.isFinite(Number(saved.alertScore)) ? Number(saved.alertScore) : usesV2 ? 7 : 5,
    sound: saved.sound === true,
    compact: saved.compact === true,
    sort: ["newest", "score", "liquidity", "volume", "pairAge"].includes(saved.sort) ? saved.sort : "newest",
    filtersCollapsed: typeof saved.filtersCollapsed === "boolean" ? saved.filtersCollapsed : true,
    ageWindows: saved.ageWindows && typeof saved.ageWindows === "object" ? saved.ageWindows : {},
  };

  const savedAgeWindow = Number(preferences.ageWindows[view.key]);
  const activeAgeWindow = Number.isFinite(savedAgeWindow) && savedAgeWindow > 0 ? savedAgeWindow : view.ageMinutes;

  elements.minScore.value = String(preferences.minScore);
  elements.keyword.value = preferences.keyword;
  elements.ageWindow.value = String(activeAgeWindow);
  elements.ageWindowLabel.textContent = String(activeAgeWindow);
  elements.alertScore.value = String(preferences.alertScore);
  elements.sound.checked = preferences.sound;
  elements.compact.checked = preferences.compact;
  elements.sort.value = preferences.sort;
  document.body.classList.toggle("compact-view", preferences.compact);
  shell.setFiltersCollapsed(preferences.filtersCollapsed);

  function persistPreferences() {
    preferences.minScore = Number(elements.minScore.value || 0);
    preferences.keyword = elements.keyword.value;
    preferences.alertScore = Number(elements.alertScore.value || 0);
    preferences.sound = elements.sound.checked;
    preferences.compact = elements.compact.checked;
    preferences.sort = elements.sort.value;
    preferences.ageWindows[view.key] = Number(elements.ageWindow.value || view.ageMinutes);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      // The dashboard remains fully functional when device storage is unavailable.
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function formatClock(timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  function updateClocks() {
    document.getElementById("clockET").textContent = formatClock("America/New_York");
    document.getElementById("clockMT").textContent = formatClock("America/Edmonton");
    document.getElementById("clockPT").textContent = formatClock("America/Los_Angeles");
  }

  function formatSignalTime(timestamp) {
    const parsed = logic.parseTimestamp(timestamp);
    if (parsed === null) return "Unknown signal time";
    const date = new Date(parsed);
    const format = (timeZone, label) => `${label} ${new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)}`;
    return [
      format("America/New_York", "ET"),
      format("America/Edmonton", "MT"),
      format("America/Los_Angeles", "PT"),
    ].join(" · ");
  }

  function setConnectionState(state, detail) {
    connectionState = state;
    const labels = {
      connecting: "Connecting to live feed…",
      connected: "Connected · live",
      reconnecting: "Connection interrupted · retrying…",
      stale: "Connected · waiting for fresh data",
      offline: "Signal service unavailable",
    };
    elements.status.textContent = detail || labels[state] || labels.connecting;
    elements.status.dataset.state = state;
    shell.setConnectionState(state);
  }

  function markAlive() {
    lastAliveAt = Date.now();
    setConnectionState("connected");
    updateFeedMeta();
  }

  function updateFeedMeta(visibleCount = null) {
    shell.setFeedMeta({
      visible: visibleCount,
      total: signals.length,
      lastUpdated: lastSignalAt || lastAliveAt,
      state: connectionState,
    });
  }

  function primeAudio() {
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioContext = new AudioContext();
    }
    if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
  }

  function beep(times) {
    if (!elements.sound.checked || !audioContext) return;
    const count = Math.min(5, Math.max(1, times));
    const start = audioContext.currentTime;
    for (let index = 0; index < count; index += 1) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = start + index * 0.14;
      oscillator.frequency.value = 820;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.11, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.1);
    }
  }

  function scoreFor(signal) {
    if (usesV2) return signal._v2.score;
    return logic.toNumber(signal.score) ?? 0;
  }

  function enrichSignal(signal) {
    const value = signal && typeof signal === "object" ? { ...signal } : {};
    value._timestamp = logic.parseTimestamp(value.ts);
    value._v2 = logic.scoreV2(value);
    return value;
  }

  function badgeTone(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("avoid") || text.includes("illiquid") || text.includes("decay")) return "danger";
    if (text.includes("wait") || text.includes("watch") || text.includes("distribution") || text.includes("fomo")) return "warn";
    return "strong";
  }

  function appendBadge(container, text, tone) {
    container.appendChild(createElement("span", `badge ${tone || badgeTone(text)}`, text));
  }

  function createMetric(label, value) {
    const metric = createElement("div", "metric");
    metric.append(createElement("span", "metric-label", label), createElement("strong", "metric-value", value));
    return metric;
  }

  function createReasonGroup(title, reasons) {
    const section = createElement("section", "reason-group");
    section.appendChild(createElement("h4", "gtitle", title));
    if (!reasons.length) {
      section.appendChild(createElement("p", "reason-empty", "None"));
      return section;
    }

    const list = createElement("ul", "reasons");
    for (const reason of reasons) {
      const item = createElement("li");
      const pointsClass = reason.points < 0 ? "neg" : reason.points === 0 ? "zero" : "pos";
      const points = reason.points > 0 ? `+${reason.points}` : String(reason.points);
      item.append(createElement("span", `pts ${pointsClass}`, points), createElement("span", "rtext", reason.text));
      list.appendChild(item);
    }
    section.appendChild(list);
    return section;
  }

  function createCard(signal) {
    const card = createElement("article", "card");
    const signalScore = scoreFor(signal);
    const pairAge = logic.toNumber(signal.ageMin);
    const signalAge = logic.signalAgeMinutes(signal);

    const head = createElement("div", "card-head");
    const identity = createElement("div", "card-identity");
    identity.append(
      createElement("span", "score", `${usesV2 ? "V2 " : ""}Score ${signalScore}`),
      createElement("h3", "token-title", `${signal.tokenSymbol || "Unknown"} / ${signal.quoteSymbol || "?"}`),
    );
    head.appendChild(identity);
    card.appendChild(head);

    if (usesV2) {
      const badges = createElement("div", "badgeRow");
      appendBadge(badges, signal._v2.stage);
      appendBadge(badges, `Confidence: ${signal._v2.confidence}`, signal._v2.confidence === "High" ? "strong" : "warn");
      appendBadge(badges, `Action: ${signal._v2.action}`);
      for (const tag of signal._v2.tags) appendBadge(badges, tag);
      card.appendChild(badges);
    }

    card.appendChild(createElement(
      "p",
      "card-meta",
      `${formatSignalTime(signal.ts)} · Signal ${logic.formatAge(signalAge)} ago · Pair ${logic.formatAge(pairAge)}`,
    ));

    const metrics = createElement("div", "kpi-grid");
    metrics.append(
      createMetric("Liquidity", logic.formatCurrency(signal.liquidityUsd)),
      createMetric("FDV", logic.formatCurrency(signal.fdv)),
      createMetric("Volume 24h", logic.formatCurrency(signal.volume24h)),
      createMetric("Price", logic.formatPrice(signal.priceUsd)),
    );
    card.appendChild(metrics);

    const reasons = usesV2
      ? [...signal._v2.reasons, ...(signal.reasons || []).filter((reason) => logic.parseReason(reason).points < 0)]
      : signal.reasons || [];
    const grouped = logic.groupReasons(reasons);
    const details = createElement("details", "reason-details");
    details.appendChild(createElement("summary", "reason-summary", "Score breakdown"));
    const reasonGrid = createElement("div", "reason-grid");
    reasonGrid.append(
      createReasonGroup("Base", grouped.base),
      createReasonGroup("Momentum", grouped.momentum),
      createReasonGroup("Risk", grouped.risk),
    );
    details.appendChild(reasonGrid);
    card.appendChild(details);

    const actions = createElement("div", "card-actions");
    const dexUrl = logic.safeDexScreenerUrl(signal.url);
    if (dexUrl) {
      const link = createElement("a", "dex-link", "Open DexScreener");
      link.href = dexUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      actions.appendChild(link);
    } else {
      actions.appendChild(createElement("span", "invalid-link", "DexScreener link unavailable"));
    }
    card.appendChild(actions);
    return card;
  }

  function createEmptyState(type, title, copy) {
    const state = createElement("div", `empty empty-state ${type}`);
    state.append(createElement("span", "empty-label", type), createElement("h3", "empty-title", title), createElement("p", "empty-copy", copy));
    return state;
  }

  function compareSignals(left, right, sort) {
    if (sort === "score") return scoreFor(right) - scoreFor(left) || (right._timestamp || 0) - (left._timestamp || 0);
    if (sort === "liquidity") return (logic.toNumber(right.liquidityUsd) || 0) - (logic.toNumber(left.liquidityUsd) || 0);
    if (sort === "volume") return (logic.toNumber(right.volume24h) || 0) - (logic.toNumber(left.volume24h) || 0);
    if (sort === "pairAge") return (logic.toNumber(left.ageMin) ?? Infinity) - (logic.toNumber(right.ageMin) ?? Infinity);
    return (right._timestamp || 0) - (left._timestamp || 0);
  }

  function render() {
    const minScore = Number(elements.minScore.value || 0);
    const keyword = elements.keyword.value.trim().toLowerCase();
    const ageWindow = Math.max(1, Number(elements.ageWindow.value || view.ageMinutes));
    elements.ageWindowLabel.textContent = String(ageWindow);

    const valid = signals.filter((signal) => signal._timestamp !== null && signal.tokenSymbol);
    const windowed = valid.filter((signal) => {
      const age = logic.signalAgeMinutes(signal);
      return age !== null && age <= ageWindow;
    });
    const filtered = windowed
      .filter((signal) => scoreFor(signal) >= minScore)
      .filter((signal) => !keyword || `${signal.tokenSymbol || ""} ${signal.quoteSymbol || ""}`.toLowerCase().includes(keyword))
      .sort((left, right) => compareSignals(left, right, elements.sort.value));

    elements.list.replaceChildren();
    if (initialLoading) {
      elements.list.appendChild(createEmptyState("loading", "Loading live signals", "Connecting to the signal API and preparing the latest candidates."));
    } else if (initialLoadFailed && signals.length === 0) {
      elements.list.appendChild(createEmptyState("offline", "Signal API unavailable", "The dashboard will keep retrying automatically. No stale candidates are being presented as live."));
    } else if (signals.length === 0) {
      elements.list.appendChild(createEmptyState("live", "No new candidates yet", "The feed is connected and waiting for a signal that meets the monitor's backend threshold."));
    } else if (windowed.length === 0) {
      elements.list.appendChild(createEmptyState("window", `No signals in the last ${ageWindow} minutes`, "Increase the age window or wait for a new launch."));
    } else if (filtered.length === 0) {
      elements.list.appendChild(createEmptyState("filtered", "No signals match these filters", "Lower the minimum score, clear the keyword, or choose a different sort and window."));
    } else {
      const fragment = document.createDocumentFragment();
      for (const signal of filtered) fragment.appendChild(createCard(signal));
      elements.list.appendChild(fragment);
    }

    updateFeedMeta(filtered.length);
  }

  async function loadInitialSignals() {
    try {
      const response = await fetch("/api/signals", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      signals = Array.isArray(payload.signals)
        ? payload.signals.filter((signal) => signal && typeof signal === "object" && signal.tokenSymbol).slice(0, 200).map(enrichSignal)
        : [];
      initialLoadFailed = false;
    } catch {
      initialLoadFailed = true;
      if (connectionState !== "connected") setConnectionState("offline");
    } finally {
      initialLoading = false;
      render();
    }
  }

  function connectLiveFeed() {
    eventSource = new EventSource("/events");
    eventSource.onopen = markAlive;
    eventSource.addEventListener("hello", markAlive);
    eventSource.addEventListener("heartbeat", markAlive);
    eventSource.onerror = () => setConnectionState("reconnecting");
    eventSource.onmessage = (event) => {
      try {
        const signal = JSON.parse(event.data);
        if (!signal || typeof signal !== "object" || !signal.tokenSymbol) return;
        const enriched = enrichSignal(signal);
        signals.unshift(enriched);
        signals = signals.slice(0, 200);
        lastSignalAt = Date.now();
        markAlive();
        render();
        const threshold = Number(elements.alertScore.value || 0);
        if (scoreFor(enriched) >= threshold) beep(1 + scoreFor(enriched) - threshold);
      } catch {
        // Ignore malformed third-party messages without interrupting the stream.
      }
    };
  }

  function schedulePreferenceUpdate() {
    document.body.classList.toggle("compact-view", elements.compact.checked);
    persistPreferences();
    render();
  }

  for (const element of [elements.minScore, elements.keyword, elements.ageWindow, elements.alertScore, elements.sort]) {
    element.addEventListener("input", schedulePreferenceUpdate);
    element.addEventListener("change", schedulePreferenceUpdate);
  }
  elements.sound.addEventListener("change", () => {
    if (elements.sound.checked) primeAudio();
    persistPreferences();
  });
  elements.compact.addEventListener("change", schedulePreferenceUpdate);

  elements.filtersToggle.addEventListener("click", () => {
    preferences.filtersCollapsed = !elements.controlWrap.classList.contains("is-collapsed");
    shell.setFiltersCollapsed(preferences.filtersCollapsed);
    persistPreferences();
  });

  document.querySelector(".text-link")?.addEventListener("click", () => {
    if (elements.controlWrap.classList.contains("is-collapsed")) {
      preferences.filtersCollapsed = false;
      shell.setFiltersCollapsed(false);
      persistPreferences();
    }
  });

  elements.clear.addEventListener("click", () => {
    undoSnapshot = signals;
    signals = [];
    elements.undo.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      undoSnapshot = null;
      elements.undo.hidden = true;
    }, 10000);
    render();
  });

  elements.undo.addEventListener("click", () => {
    if (undoSnapshot) signals = undoSnapshot;
    undoSnapshot = null;
    elements.undo.hidden = true;
    clearTimeout(undoTimer);
    render();
  });

  document.addEventListener("pointerdown", primeAudio, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
  window.addEventListener("meme-monitor:view-change", (event) => {
    persistPreferences();
    view = event.detail;
    usesV2 = view.key !== "10m";
    const storedWindow = Number(preferences.ageWindows[view.key]);
    const nextWindow = Number.isFinite(storedWindow) && storedWindow > 0 ? storedWindow : view.ageMinutes;
    elements.ageWindow.value = String(nextWindow);
    elements.ageWindowLabel.textContent = String(nextWindow);
    render();
  });
  window.addEventListener("beforeunload", () => eventSource?.close());

  setInterval(updateClocks, 1000);
  setInterval(() => {
    if (lastAliveAt && Date.now() - lastAliveAt > 60000 && connectionState === "connected") setConnectionState("stale");
    render();
  }, 15000);

  updateClocks();
  setConnectionState("connecting");
  render();
  loadInitialSignals();
  connectLiveFeed();
})();
