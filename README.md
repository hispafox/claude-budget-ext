# ⚡ Claude Usage Budget

> Know if you'll make it to the reset — before you run out.

Claude shows you a bar: **"23% used"**. But it doesn't tell you if you're burning too fast, if you'll hit the limit by Thursday, or how many daily routine runs you have left. This extension fixes that.

![Version](https://img.shields.io/badge/version-0.5.0-blue?style=flat-square)
![Manifest](https://img.shields.io/badge/manifest-v3-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-gray?style=flat-square)

---

## What it does

The extension injects visual overlays **directly on top of Claude's usage bars** at `claude.ai/settings/usage` — no new pages, no popups, no dashboards. Just extra information on the bars you already look at.

### Session bar — 5 hourly segments

Each segment = 20% = 1 hour of budget. If the fill passes a line before that hour ends, you're over pace.

- Projection marker showing where you'll land at reset
- `✅ Llegas al reset` or `⚠️ Vacío a las 14:32` — no ambiguity
- Hatched zone on the bar visualizing projected consumption

### Weekly bars — 7 daily segments

One segment per day (~14.3% each). Works for all three bars:

| Bar | Budget |
|-----|--------|
| Todos los modelos | 14.3%/día |
| Solo Sonnet | 14.3%/día |
| Claude Design | 14.3%/día |

The **current day is highlighted** so you always know where you are in the cycle.

### Daily routine executions — 15 discrete runs

The "Ejecuciones de rutinas diarias incluidas" bar gets its own overlay with 5 groups of 3 runs each. Badge shows `🔁 X/15` at a glance.

### Rate tracking

The extension silently records usage snapshots in the background and calculates your actual consumption rate:

- **High confidence** `●` — 5+ snapshots, real measured rate
- **Medium** `◐` — 2–4 snapshots, estimated
- **Low** `○` — fallback: usage ÷ elapsed time

Rate resets automatically when Claude resets your quota. No manual intervention needed.

---

## Installation

No build step. No npm. No configuration.

1. Download the [latest release zip](https://github.com/hispafox/claude-budget-ext/releases) or clone this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked** → select the folder
5. Go to `claude.ai/settings/usage`

The overlays appear automatically.

---

## Popup

Click the extension icon for a quick summary of your current session: usage %, time remaining, rate, and projection — without opening the settings page.

The version number in the popup always reflects the installed version.

---

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Saves usage snapshots locally for rate calculation |
| `https://claude.ai/*` | Injects the overlay on Claude's settings page |

**No data leaves your browser.** No analytics, no telemetry, no external requests.

---

## Tech

Vanilla JS. Manifest V3. Zero dependencies. Zero build step.

The entire extension is two files: `content.js` and `content.css`.

---

## Trademark notice

"Claude" is a trademark of Anthropic, PBC. This extension is not affiliated with, endorsed by, or sponsored by Anthropic.

## Privacy

No data leaves your browser. See [PRIVACY.md](PRIVACY.md) for details.

## License

MIT © 2026 Pedro Hernández
