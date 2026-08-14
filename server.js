// server.js

require("dotenv").config(); // ✅ Load .env variables (must remain at the top)

const express = require("express");
const path = require("path");
const { startMonitor } = require("./monitor");

console.log("SERVER BOOT:", new Date().toISOString());

// ✅ Check whether the Helius key was loaded (avoid printing the full key outside temporary debugging)
console.log("Helius key loaded:", process.env.HELIUS_API_KEY ? "YES" : "NO");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// ✅ GitHub Pages domain (add other domains here if needed later)
const ALLOWED_ORIGIN = "https://w3tigerdog.github.io";

const signals = [];
const clients = new Set();

function broadcast(signal) {
  if (!signal || typeof signal !== "object" || !signal.tokenSymbol) return;
  const msg = `data: ${JSON.stringify(signal)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ✅ CORS (allow only the configured GitHub Pages domain)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow GitHub Pages and optional local development origins
  if (
    origin === ALLOWED_ORIGIN ||
    origin === "http://localhost:3000" ||
    origin === "http://127.0.0.1:3000"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);

  next();
});

// Static files (retained without affecting the API)
app.use(express.static(path.join(__dirname, "public")));

app.get("/ping", (req, res) => res.send("pong"));

app.get("/api/signals", (req, res) => {
  res.json({ signals });
});

app.get("/events", (req, res) => {
  console.log("SSE client connected:", new Date().toISOString());

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // proxy buffering off
  res.flushHeaders?.();

  res.write(
    `event: hello\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`
  );

  clients.add(res);

  const keepAlive = setInterval(() => {
    res.write(
      `event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`
    );
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
    console.log("SSE client disconnected");
  });
});

// ✅ Keep the service running even if the monitor fails to start
try {
  startMonitor({
    onSignal: (s) => {
      if (!s || typeof s !== "object" || !s.tokenSymbol) return;

      signals.unshift(s);
      signals.splice(200);

      console.log("NEW SIGNAL:", s.tokenSymbol, "score", s.score);
      broadcast(s);
    },
    intervalMs: 10000,
  });
} catch (e) {
  console.error("startMonitor failed:", e);
}

app.listen(PORT, HOST, () => {
  console.log(`✅ API running at http://${HOST}:${PORT}`);
  console.log(`✅ Ping: /ping`);
  console.log(`✅ Signals: /api/signals`);
  console.log(`✅ SSE: /events`);
});
