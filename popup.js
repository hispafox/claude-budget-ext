function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

document.getElementById("ext-version").textContent =
  "v" + chrome.runtime.getManifest().version;

chrome.storage.local.get(["cubData"], (result) => {
  const data = result.cubData;
  const pctEl = document.getElementById("s-pct");
  const timeEl = document.getElementById("s-time");
  const rateEl = document.getElementById("r-value");
  const projEl = document.getElementById("r-proj");
  const confEl = document.getElementById("r-conf");

  if (!data || !data.timestamp || Date.now() - data.timestamp > 600000) {
    pctEl.textContent = "Sin datos";
    pctEl.className = "value muted";
    return;
  }

  const h = Math.floor(data.hoursLeft);
  const m = Math.round((data.hoursLeft - h) * 60);
  pctEl.textContent = `${data.percent}% usado`;
  pctEl.className = "value " + (data.percent > 70 ? "red" : data.percent > 40 ? "amber" : "green");
  timeEl.textContent = `${h}h ${m}m`;

  if (data.rate != null) {
    const budgetPerH = 20;
    const isOver = data.rate > budgetPerH;
    rateEl.textContent = `${data.rate.toFixed(1)}%/h`;
    rateEl.className = "value " + (isOver ? "red" : "green");

    const projPct = data.percent + data.rate * data.hoursLeft;
    if (projPct > 100) {
      const emptyTs = Date.now() + ((100 - data.percent) / data.rate) * 3600000;
      projEl.textContent = `⚠️ Vacío a las ${fmtTime(emptyTs)}`;
      projEl.className = "value red";
    } else {
      projEl.textContent = "✓ Llegas al reset";
      projEl.className = "value green";
    }

    const confMap = { high: "● Fiable", medium: "◐ Estimado", low: "○ Aprox." };
    confEl.textContent = confMap[data.confidence] || "—";
  } else {
    rateEl.textContent = "Recopilando...";
    rateEl.className = "value muted";
    projEl.textContent = "Abre Uso ~2 min";
    projEl.className = "value muted";
  }
});
