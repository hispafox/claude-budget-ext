/**
 * Claude Usage Budget — Content Script v0.4.0
 *
 * Session: 5 fixed segments of 20% covering the FULL bar
 * Weekly: 7 fixed segments (~14.3%) covering the FULL bar
 * Rate: auto-calculated from usage ÷ elapsed time
 * Projection: marker + hatched zone on bar, chips below
 */

(function () {
  "use strict";

  const OVERLAY_CLASS = "cub-overlay";
  const POLL_INTERVAL = 10000;
  const MAX_RETRIES = 30;
  const SNAPSHOT_KEY = "cubSnapshots";
  const MAX_SNAPSHOTS = 200;
  const SESSION_TOTAL_H = 5;
  const WEEK_TOTAL_DAYS = 7;

  // ── Helpers ──────────────────────────────────────────────

  function fmtTime(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtDay(d) {
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return days[d.getDay()];
  }

  function parseHoursRemaining(text) {
    const hMatch = text.match(/(\d+)\s*h/);
    const mMatch = text.match(/(\d+)\s*min/);
    const hours = hMatch ? parseInt(hMatch[1], 10) : 0;
    const mins = mMatch ? parseInt(mMatch[1], 10) : 0;
    if (hours === 0 && mins === 0) return null;
    return hours + mins / 60;
  }

  function parseWeeklyReset(text) {
    const dayMap = {
      lun: 1, mar: 2, "mié": 3, mi: 3, mie: 3, jue: 4, vie: 5,
      "sáb": 6, sab: 6, dom: 0,
      mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
    };
    const match = text.match(
      /(?:restablece|resets)\s+(\w+),?\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i
    );
    if (!match) return null;
    const dayStr = match[1].toLowerCase().replace(/[.,]/g, "");
    const targetDay = dayMap[dayStr];
    if (targetDay === undefined) return null;
    let hours = parseInt(match[2], 10);
    const mins = parseInt(match[3], 10);
    const ampm = (match[4] || "").replace(/\./g, "").toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    const now = new Date();
    const resetDate = new Date(now);
    let daysUntil = targetDay - now.getDay();
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0) {
      const rt = new Date(now);
      rt.setHours(hours, mins, 0, 0);
      if (rt <= now) daysUntil = 7;
    }
    resetDate.setDate(now.getDate() + daysUntil);
    resetDate.setHours(hours, mins, 0, 0);
    return resetDate;
  }

  function parsePercent(text) {
    const m = text.match(/(\d+)\s*%\s*(usado|used)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseRoutineCount(text) {
    const m = text.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { used: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
  }

  // ── Snapshot Engine ─────────────────────────────────────

  async function recordSnapshot(key, percent) {
    const storageKey = `${SNAPSHOT_KEY}_${key}`;
    const now = Date.now();
    let snapshots = [];
    try {
      const result = await chrome.storage.local.get([storageKey]);
      snapshots = result[storageKey] || [];
    } catch (e) {}

    const last = snapshots[snapshots.length - 1];
    if (!last || last.pct !== percent || now - last.ts > 60000) {
      snapshots.push({ ts: now, pct: percent });
    }
    if (snapshots.length > MAX_SNAPSHOTS) snapshots = snapshots.slice(-MAX_SNAPSHOTS);

    // Detect resets
    const cleaned = [];
    for (let i = 0; i < snapshots.length; i++) {
      if (i > 0 && snapshots[i].pct < snapshots[i - 1].pct - 2) cleaned.length = 0;
      cleaned.push(snapshots[i]);
    }
    try { await chrome.storage.local.set({ [storageKey]: cleaned }); } catch (e) {}
    return cleaned;
  }

  /**
   * Calculate rate. Priority:
   * 1. From snapshots if enough data
   * 2. Fallback: usage ÷ elapsed time
   */
  function calcRate(snapshots, percent, elapsedH, windowMs) {
    const now = Date.now();
    const cutoff = now - (windowMs || 3600000);
    const recent = snapshots.filter(s => s.ts >= cutoff);

    // From snapshots
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const dPct = last.pct - first.pct;
      const dH = (last.ts - first.ts) / 3600000;
      if (dH > 0.01 && dPct > 0) {
        return {
          rate: dPct / dH,
          confidence: recent.length >= 5 ? "high" : "medium",
          dataPoints: recent.length,
        };
      }
    }

    // Fallback: usage ÷ elapsed
    if (elapsedH > 0.03 && percent > 0) {
      return {
        rate: percent / elapsedH,
        confidence: "low",
        dataPoints: 1,
      };
    }

    return null;
  }

  // ── DOM Discovery ────────────────────────────────────────

  function findProgressBar(container) {
    let bar = container.querySelector('[role="progressbar"]');
    if (bar) return bar;
    for (const el of container.querySelectorAll("div")) {
      if (el.offsetWidth > 200 && el.offsetHeight >= 6 && el.offsetHeight <= 20) {
        const fill = el.firstElementChild;
        if (fill && fill.offsetHeight === el.offsetHeight && fill.offsetWidth <= el.offsetWidth) return el;
      }
    }
    return null;
  }

  function findUsageSections() {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    const candidates = [];
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || "").trim();
      if (txt === "Sesión actual" || txt === "Current session" || txt === "Current period")
        candidates.push({ type: "session", el: node, label: "session" });
      if (txt === "Todos los modelos" || txt === "All models")
        candidates.push({ type: "weekly", el: node, label: "weekly_all" });
      if (txt === "Solo Sonnet" || txt === "Sonnet only")
        candidates.push({ type: "weekly", el: node, label: "weekly_sonnet" });
      if (txt === "Claude Design")
        candidates.push({ type: "weekly", el: node, label: "weekly_design" });
      if (
        txt === "Ejecuciones de rutinas diarias incluidas" ||
        txt === "Daily routine executions included"
      )
        candidates.push({ type: "routine", el: node, label: "routine_daily" });
    }
    for (const cand of candidates) {
      let container = cand.el.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const text = container.textContent || "";
        const hasData = cand.type === "routine"
          ? /\d+\s*\/\s*\d+/.test(text)
          : /\d+%/.test(text);
        if (hasData) {
          const bar = findProgressBar(container);
          if (bar && !results.some(r => r.bar === bar)) {
            results.push({ type: cand.type, label: cand.label, container, bar });
            break;
          }
        }
        container = container.parentElement;
      }
    }
    return results;
  }

  // ── Overlay Rendering ───────────────────────────────────

  function removeOverlays() {
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());
  }

  function ensureRelative(el) {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
  }

  /** Inject projection marker + hatched zone on the bar */
  function injectBarMarker(bar, currentPct, projectedPct, danger, markerLabel) {
    const clamped = Math.min(projectedPct, 100);

    // Hatched zone
    if (clamped > currentPct) {
      const fill = document.createElement("div");
      fill.className = `${OVERLAY_CLASS} cub-projected-fill ${danger ? "cub-projected-fill-danger" : "cub-projected-fill-ok"}`;
      fill.style.left = `${currentPct}%`;
      fill.style.width = `${clamped - currentPct}%`;
      bar.appendChild(fill);
    }

    // Marker line
    const marker = document.createElement("div");
    marker.className = `${OVERLAY_CLASS} cub-marker ${danger ? "cub-marker-danger" : "cub-marker-ok"}`;
    marker.style.left = `${clamped}%`;
    if (markerLabel) {
      const lbl = document.createElement("span");
      lbl.className = "cub-marker-label";
      lbl.textContent = markerLabel;
      marker.appendChild(lbl);
    }
    bar.appendChild(marker);
  }

  /** Build fixed segments covering the FULL bar */
  function buildFixedSegments(count, labelFn, budgetPct) {
    return Array.from({ length: count }, (_, i) => ({
      label: labelFn(i),
      budget: `${budgetPct.toFixed(budgetPct % 1 === 0 ? 0 : 1)}%`,
      widthPct: 100 / count,
    }));
  }

  /** Render: dashes on bar + labels below + chips + badge */
  function renderOverlay(bar, percent, segments, badgeText, rateInfo, rateUnit, projectedPct, projectedLabel, resetLabel, danger, activeIdx) {
    ensureRelative(bar);
    ensureRelative(bar.parentElement);

    // Projection on bar — danger label lives in the badge, not the marker
    if (rateInfo) {
      injectBarMarker(bar, percent, projectedPct, danger, danger ? null : projectedLabel);
    }

    // Segment dashes — FULL bar
    const dashesEl = document.createElement("div");
    dashesEl.className = OVERLAY_CLASS;
    dashesEl.style.cssText = "position:absolute;inset:0;display:flex;pointer-events:none;z-index:10;";
    segments.forEach((s, i) => {
      const seg = document.createElement("div");
      const isActive = i === activeIdx;
      seg.style.cssText = `width:${s.widthPct}%;height:100%;${i < segments.length - 1 ? "border-right:1.5px dashed rgba(59,130,246,0.35);" : ""}${isActive ? "background:rgba(59,130,246,0.10);" : ""}box-sizing:border-box;`;
      dashesEl.appendChild(seg);
    });
    bar.appendChild(dashesEl);

    // Labels — FULL width
    const labelsEl = document.createElement("div");
    labelsEl.className = OVERLAY_CLASS;
    labelsEl.style.cssText = "display:flex;margin-top:4px;margin-bottom:4px;pointer-events:none;";
    segments.forEach((s, i) => {
      const lbl = document.createElement("div");
      const isActive = i === activeIdx;
      lbl.style.cssText = `width:${s.widthPct}%;text-align:center;${isActive ? "font-weight:700;" : ""}`;
      lbl.innerHTML = `<span class="cub-time${isActive ? " cub-time-active" : ""}">${s.label}</span><br><span class="cub-budget">${s.budget}</span>`;
      labelsEl.appendChild(lbl);
    });
    bar.parentElement.insertBefore(labelsEl, bar.nextSibling);

    // Rate chips — always at left
    if (rateInfo) {
      const rateDisplay = rateUnit === "día" ? (rateInfo.rate * 24).toFixed(1) : rateInfo.rate.toFixed(1);
      const ci = rateInfo.confidence === "high" ? "●" : rateInfo.confidence === "medium" ? "◐" : "○";
      const cl = rateInfo.confidence === "high" ? "fiable" : rateInfo.confidence === "medium" ? "estimado" : "aprox.";
      const projText = danger
        ? `⚠️ Vacío ${projectedLabel}`
        : `✓ Llegas al ${resetLabel}`;

      const chipsEl = document.createElement("div");
      chipsEl.className = `${OVERLAY_CLASS} cub-projection`;
      chipsEl.style.cssText = "margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
      chipsEl.innerHTML = `
        <span class="cub-rate-chip ${danger ? "cub-rate-over" : "cub-rate-ok"}">${danger ? "🔥" : "✅"} Ritmo: ${rateDisplay}%/${rateUnit}</span>
        <span class="cub-rate-chip ${danger ? "cub-rate-over" : "cub-rate-muted"}">${projText}</span>
        <span class="cub-rate-confidence" title="${rateInfo.dataPoints} snapshots">${ci} ${cl}</span>
      `;
      labelsEl.after(chipsEl);
    }

    // Badge top-right
    const badge = document.createElement("div");
    badge.className = OVERLAY_CLASS;
    badge.style.cssText = "position:absolute;top:-26px;right:0;z-index:10;pointer-events:none;";
    const dangerSuffix = danger && projectedLabel
      ? `<span class="cub-badge-danger-day">${projectedLabel}</span>`
      : "";
    badge.innerHTML = `<span class="cub-badge">${badgeText}${dangerSuffix}</span>`;
    bar.parentElement.appendChild(badge);
  }

  // ── Session Overlay ─────────────────────────────────────

  async function injectSessionOverlay(bar, percent, hoursLeft) {
    if (percent >= 100 || hoursLeft <= 0) return;

    const elapsedH = SESSION_TOTAL_H - hoursLeft;
    const budgetPerH = 100 / SESSION_TOTAL_H; // always 20%

    // Segments: 5 fixed hours
    const now = new Date();
    const sessionStart = new Date(now.getTime() - elapsedH * 3600000);
    const segments = buildFixedSegments(SESSION_TOTAL_H, i => {
      const t = new Date(sessionStart.getTime() + i * 3600000);
      return fmtTime(t);
    }, budgetPerH);

    // Rate
    const snapshots = await recordSnapshot("session", percent);
    const rateInfo = calcRate(snapshots, percent, elapsedH, 30 * 60 * 1000);

    let projectedPct = percent;
    let projectedLabel = "✓";
    let danger = false;

    if (rateInfo) {
      projectedPct = percent + rateInfo.rate * hoursLeft;
      danger = projectedPct > 100;
      if (danger) {
        const emptyDate = new Date(now.getTime() + ((100 - percent) / rateInfo.rate) * 3600000);
        projectedLabel = fmtTime(emptyDate);
      }
    }

    renderOverlay(bar, percent, segments, `⚡ ${budgetPerH.toFixed(0)}%/h`, rateInfo, "h", projectedPct, projectedLabel, "reset", danger);

    // Save for popup
    try {
      chrome.storage.local.set({
        cubData: {
          percent, hoursLeft,
          rate: rateInfo ? rateInfo.rate : null,
          confidence: rateInfo ? rateInfo.confidence : null,
          timestamp: Date.now(),
        },
      });
    } catch (e) {}
  }

  // ── Weekly Overlay ──────────────────────────────────────

  async function injectWeeklyOverlay(bar, container, percent, label) {
    if (percent >= 100) return;
    const text = container.textContent || "";
    const resetDate = parseWeeklyReset(text);
    if (!resetDate) return;

    const now = new Date();
    const msLeft = resetDate.getTime() - now.getTime();
    if (msLeft <= 0) return;

    const hoursLeft = msLeft / 3600000;
    const daysLeft = hoursLeft / 24;
    const elapsedDays = WEEK_TOTAL_DAYS - daysLeft;
    const budgetPerDay = 100 / WEEK_TOTAL_DAYS; // ~14.3%

    // Segments: 7 fixed days
    const resetDayOfWeek = resetDate.getDay();
    const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const startDay = resetDayOfWeek % 7;
    const todayIdx = ((now.getDay() - startDay) + 7) % 7;
    const segments = buildFixedSegments(WEEK_TOTAL_DAYS, i => {
      const d = (startDay + i) % 7;
      return dayNames[d];
    }, budgetPerDay);

    // Rate
    const snapshots = await recordSnapshot(label, percent);
    const rateInfo = calcRate(snapshots, percent, elapsedDays * 24, 2 * 60 * 60 * 1000);

    let projectedPct = percent;
    let projectedLabel = "✓";
    let danger = false;

    if (rateInfo) {
      projectedPct = percent + rateInfo.rate * hoursLeft;
      danger = projectedPct > 100;
      if (danger) {
        const emptyDate = new Date(now.getTime() + ((100 - percent) / rateInfo.rate) * 3600000);
        projectedLabel = fmtDay(emptyDate);
      }
    }

    const resetDayLabel = fmtDay(resetDate);
    renderOverlay(bar, percent, segments, `📊 ${budgetPerDay.toFixed(1)}%/día`, rateInfo, "día", projectedPct, projectedLabel, resetDayLabel, danger, todayIdx);
  }

  // ── Routine Overlay ─────────────────────────────────────

  function injectRoutineOverlay(bar, used, total) {
    const GROUPS = 5;
    const perGroup = total / GROUPS;
    const pct = total > 0 ? (used / total) * 100 : 0;

    const segments = Array.from({ length: GROUPS }, (_, i) => ({
      label: `${i * perGroup + 1}-${(i + 1) * perGroup}`,
      budget: `${perGroup} runs`,
      widthPct: 100 / GROUPS,
    }));

    renderOverlay(bar, pct, segments, `🔁 ${used}/${total}`, null, null, pct, null, null, false);
  }

  // ── Main Loop ────────────────────────────────────────────

  let retries = 0;
  let lastHash = "";

  async function run() {
    const sections = findUsageSections();
    if (sections.length === 0) {
      retries++;
      if (retries < MAX_RETRIES) setTimeout(run, POLL_INTERVAL);
      return;
    }

    let hashParts = [];
    for (const s of sections) {
      const text = s.container.textContent || "";
      if (s.type === "routine") {
        const rc = parseRoutineCount(text);
        if (rc == null) continue;
        hashParts.push(`r:${rc.used}:${rc.total}`);
      } else {
        const pct = parsePercent(text);
        if (pct == null) continue;
        if (s.type === "session") {
          const h = parseHoursRemaining(text);
          if (h == null) continue;
          hashParts.push(`s:${pct}:${h.toFixed(2)}`);
        } else {
          hashParts.push(`w:${s.label}:${pct}`);
        }
      }
    }

    const hash = hashParts.join("|");
    if (hash === lastHash) {
      // Still record snapshots even if display unchanged
      for (const s of sections) {
        if (s.type === "routine") continue;
        const text = s.container.textContent || "";
        const pct = parsePercent(text);
        if (pct != null) await recordSnapshot(s.label, pct);
      }
      setTimeout(run, POLL_INTERVAL);
      return;
    }

    removeOverlays();
    lastHash = hash;

    for (const s of sections) {
      const text = s.container.textContent || "";
      if (s.type === "routine") {
        const rc = parseRoutineCount(text);
        if (rc == null) continue;
        injectRoutineOverlay(s.bar, rc.used, rc.total);
      } else {
        const pct = parsePercent(text);
        if (pct == null) continue;
        if (s.type === "session") {
          const h = parseHoursRemaining(text);
          if (h == null) continue;
          await injectSessionOverlay(s.bar, pct, h);
        } else {
          await injectWeeklyOverlay(s.bar, s.container, pct, s.label);
        }
      }
    }
    setTimeout(run, POLL_INTERVAL);
  }

  if (document.readyState === "complete") setTimeout(run, 500);
  else window.addEventListener("load", () => setTimeout(run, 500));

  // SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      retries = 0;
      lastHash = "";
      if (/settings/i.test(location.href)) setTimeout(run, 1000);
      else removeOverlays();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
