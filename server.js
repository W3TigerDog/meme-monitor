const express = require("express");
const path = require("path");
const { startMonitor } = require("./monitor");


console.log("SERVER BOOT:", new Date().toISOString());

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 改成你的 GitHub Pages 域名
const ALLOWED_ORIGIN = "https://YOURNAME.github.io";

const signals = [];
const clients = new Set();

function broadcast(signal) {
  if (!signal || typeof signal !== "object" || !signal.tokenSymbol) return;

  const msg = `data: ${JSON.stringify(signal)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ===== CORS (安全版，只允许你的前端访问) =====
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(204);

  next();
});

// 健康检查
app.get("/ping", (req, res) => res.send("pong"));

// 初始数据
app.get("/api/signals", (req, res) => {
  res.json({ signals });
});

// ===== SSE (Render 兼容版) =====
app.get("/events", (req, res) => {
  console.log("SSE client connected:", new Date().toISOString());

  res.status(200);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // Render / Nginx 关键
  res.setHeader("X-Accel-Buffering", "no");

  res.flushHeaders?.();

  res.write(`event: hello\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  clients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
    console.log("SSE client disconnected");
  });
});

// 启动监控
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

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});