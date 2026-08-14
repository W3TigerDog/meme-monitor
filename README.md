# Meme Monitor

[English](README.md) | [Français](README.fr.md) | [Português](README.pt.md)

Meme Monitor is a Node.js service and browser dashboard that watches recent Solana token pairs from DexScreener, scores market activity, and streams signals to connected clients in real time.

> This project provides automated market indicators for research purposes. It is not financial advice.

## Features

- Polls recent Solana token profiles and pairs from DexScreener every 10 seconds.
- Scores pairs using liquidity, age, 24-hour volume, buy/sell activity, FDV, and short-term liquidity and price growth.
- Publishes the latest signals through a JSON API and Server-Sent Events (SSE).
- Includes browser dashboards with score, age, keyword, and alert filters.
- Provides 10-, 15-, 30-, and 60-minute dashboard views.
- Persists high-score deduplication state in `seen_pairs.json`.

## Requirements

- Node.js 18.x
- npm
- Internet access to the DexScreener API

## Quick Start

```bash
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

## Configuration

Create a `.env` file in the project root if you need to override the defaults:

```dotenv
PORT=3000
HELIUS_API_KEY=your_optional_helius_api_key
```

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port. Defaults to `3000`. |
| `HELIUS_API_KEY` | No | Reserved for Helius integration. The current server only checks whether it is present. |

Scoring thresholds, polling frequency, and deduplication settings are defined in `monitor.js`. The allowed production browser origin is set by `ALLOWED_ORIGIN` in `server.js`; update it when deploying the dashboard under another domain.

## Dashboards

| Route | Description |
| --- | --- |
| `/?view=10m` | Default 10-minute dashboard |
| `/?view=15m` | 15-minute V2 dashboard |
| `/?view=30m` | 30-minute V2 dashboard |
| `/?view=60m` | 60-minute V2 dashboard |
| `/?view=v2` | Extended 120-minute V2 lab |

All views run inside one shared dashboard, so switching windows preserves the live SSE connection. The legacy HTML routes still work and redirect to the matching view. Filters, sorting, compact mode, and sound preferences are saved on the current device.

## API

| Endpoint | Description |
| --- | --- |
| `GET /ping` | Health check; returns `pong`. |
| `GET /api/signals` | Returns up to 200 recent in-memory signals. |
| `GET /events` | Opens the live SSE signal stream. |

A signal includes the token and pair addresses, symbols, liquidity, FDV, volume, price, age, score, scoring reasons, timestamp, and DexScreener URL when available.

## Scoring Overview

The backend score in `monitor.js` considers:

- USD liquidity
- Pair age
- 24-hour trading volume
- Five-minute buy/sell pressure
- Fully diluted valuation (FDV)
- One- and three-minute liquidity growth
- One- and three-minute price growth

The V2 dashboards apply an additional client-side score for presentation and filtering. All scores are heuristics and can be affected by missing, delayed, or inaccurate third-party data.

## Project Structure

| Path | Purpose |
| --- | --- |
| `server.js` | Express server, static dashboard hosting, REST API, and SSE stream |
| `monitor.js` | Active DexScreener polling and backend scoring logic |
| `index.js` | Standalone legacy scorer that writes results to `signals.csv` |
| `public/index.html` | Shared dashboard document and controls |
| `public/dashboard-app.js` | Live feed, filtering, sorting, preferences, and safe DOM rendering |
| `public/dashboard-logic.js` | Shared formatters, URL validation, reason parsing, and V2 scoring |
| `public/dashboard-shell.js` | Responsive layout, navigation, connection state, and view switching |
| `public/dashboard.css` | Shared visual system and responsive styles |
| `test/dashboard.test.js` | Built-in Node.js tests for scoring, URL safety, and legacy routes |
| `seen_pairs.json` | Persistent deduplication state for high-score signals |
| `signals.csv` | CSV output used by the standalone scorer |

To run the standalone CSV scorer instead of the web service:

```bash
node index.js
```

## Operational Notes

- Recent API signals are stored in memory and reset when the server restarts.
- High-score deduplication survives restarts through `seen_pairs.json`.
- The service depends on DexScreener response formats and availability.
- CORS currently allows the configured GitHub Pages domain and local development on port `3000`.

## License

ISC
