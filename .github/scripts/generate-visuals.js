// Renders the custom profile visuals into assets/ — every pixel produced here,
// no third-party widgets. Driven by .github/workflows/header.yml.
//
//   stats.svg   commit engine: streak, longest, total, active days
//   rhythm.svg  commits by hour-of-day x day-of-week
//   langs.svg   language distribution as self-drawing rings
//   ticker.svg  live feed of the most recent real commits

const fs = require("fs");
const { esc, fetchProfile, fetchCommits, analyze, card, svg } = require("./lib");

/**
 * SVG can't animate the text content of an element, so a count-up has to be
 * faked: stack every intermediate value at the same coordinates and flip
 * exactly one of them visible at a time. Eased so it decelerates into place.
 */
function countUp(x, y, cls, final, begin, dur = 1.1, frames = 16) {
  if (final === 0) return `<text x="${x}" y="${y}" class="${cls}">0</text>`;

  const step = dur / frames;
  const out = [];
  for (let i = 1; i <= frames; i++) {
    const eased = 1 - Math.pow(1 - i / frames, 3);
    const val = i === frames ? final : Math.round(final * eased);
    const t = (begin + (i - 1) * step).toFixed(2);
    // Every frame but the last is hidden again as the next one appears.
    const hide =
      i < frames
        ? `<set attributeName="opacity" to="0" begin="${(begin + i * step).toFixed(2)}s" />`
        : "";
    out.push(
      `<text x="${x}" y="${y}" class="${cls}" opacity="0">` +
        `<set attributeName="opacity" to="1" begin="${t}s" />${hide}${val}</text>`
    );
  }
  return out.join("");
}

function renderStats(a) {
  const W = 860;
  const H = 190;

  const tiles = [
    { label: "CURRENT STREAK", value: a.current, unit: "days" },
    { label: "LONGEST STREAK", value: a.longest, unit: "days" },
    { label: "TOTAL COMMITS", value: a.total, unit: "tracked" },
    { label: "DAYS SHIPPED", value: a.activeDays, unit: "days" },
  ];

  const body = tiles
    .map((t, i) => {
      const x = 40 + i * 205;
      const begin = 0.3 + i * 0.14;
      return `
  <g>
    <text x="${x}" y="${78}" class="lbl">${t.label}</text>
    ${countUp(x, 116, "num", t.value, begin)}
    <text x="${x}" y="${140}" class="unit" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${(begin + 1.1).toFixed(2)}s" fill="freeze"/>
      ${t.unit}
    </text>
    <rect x="${x}" y="152" width="0" height="3" rx="1.5" fill="url(#accent)">
      <animate attributeName="width" from="0" to="150" dur="0.7s" begin="${begin.toFixed(2)}s"
               fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1" keyTimes="0;1" values="0;150"/>
    </rect>
  </g>`;
    })
    .join("");

  return svg(W, H, card(W, H, "commit-engine — computed from real history") + body);
}

function renderRhythm(a, commits) {
  const W = 860;
  const H = 300;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Bucket commits into a 7x24 grid keyed by weekday and the author's local hour.
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of commits) {
    const d = new Date(c.iso);
    const h = Number(/T(\d{2}):/.exec(c.iso)[1]);
    grid[d.getUTCDay()][h]++;
  }
  const peak = Math.max(1, ...grid.flat());

  const X0 = 74;
  const Y0 = 76;
  const CW = 30;
  const CH = 25;

  let cells = "";
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const n = grid[d][h];
      const intensity = n / peak;
      // Empty cells stay as faint scaffolding so the shape of the week reads.
      const fill = n === 0 ? "#161b22" : "url(#accent)";
      const op = n === 0 ? 1 : 0.22 + intensity * 0.78;
      const begin = (0.3 + (h * 0.012 + d * 0.05)).toFixed(2);
      cells += `
    <rect x="${X0 + h * CW}" y="${Y0 + d * CH}" width="${CW - 5}" height="${CH - 5}" rx="3"
          fill="${fill}" opacity="0">
      <animate attributeName="opacity" from="0" to="${op.toFixed(2)}" dur="0.5s" begin="${begin}s" fill="freeze"/>
    </rect>`;
    }
  }

  let labels = "";
  for (let d = 0; d < 7; d++) {
    labels += `<text x="${X0 - 12}" y="${Y0 + d * CH + 14}" class="dim" text-anchor="end">${DOW[d]}</text>`;
  }
  for (let h = 0; h < 24; h += 3) {
    labels += `<text x="${X0 + h * CW + 12}" y="${Y0 - 10}" class="dim" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const caption =
    `peak: ${a.busiestDay} @ ${pad(a.busiestHour)}:00 — ` +
    `${a.total} commits mapped by hour of day`;

  const footer = `
    <text x="${X0}" y="${Y0 + 7 * CH + 30}" class="dim" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1.6s" fill="freeze"/>
      ${esc(caption)}
    </text>`;

  return svg(W, H, card(W, H, "when-do-i-code — commits by hour x weekday") + labels + cells + footer);
}

function renderLangs(langCount) {
  const W = 420;
  const H = 300;

  const top = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const total = top.reduce((n, [, c]) => n + c, 0) || 1;

  const COLORS = ["#38bdf8", "#818cf8", "#3fb950", "#f0883e", "#db6d28"];
  const CX = 130;
  const CY = 170;

  let rings = "";
  let legend = "";

  top.forEach(([lang, count], i) => {
    const r = 88 - i * 15;
    const circ = 2 * Math.PI * r;
    const pct = count / total;
    const begin = (0.35 + i * 0.13).toFixed(2);

    // Each ring draws itself by unwinding its dash offset — rotated so all
    // five start from 12 o'clock.
    rings += `
    <circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="#21262d" stroke-width="9"/>
    <circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${COLORS[i]}" stroke-width="9"
            stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${circ.toFixed(1)}">
      <animate attributeName="stroke-dashoffset" from="${circ.toFixed(1)}"
               to="${(circ * (1 - pct)).toFixed(1)}" dur="1.2s" begin="${begin}s"
               fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1" keyTimes="0;1"
               values="${circ.toFixed(1)};${(circ * (1 - pct)).toFixed(1)}"/>
    </circle>`;

    const ly = 84 + i * 30;
    legend += `
    <g opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${begin}s" fill="freeze"/>
      <rect x="248" y="${ly - 10}" width="10" height="10" rx="2" fill="${COLORS[i]}"/>
      <text x="266" y="${ly}" class="txt">${esc(lang)}</text>
      <text x="${W - 30}" y="${ly}" class="dim" text-anchor="end">${Math.round(pct * 100)}%</text>
    </g>`;
  });

  return svg(W, H, card(W, H, "languages") + rings + legend);
}

function renderTicker(commits) {
  const W = 420;
  const H = 300;

  const recent = commits.slice(0, 7);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  const rows = recent
    .map((c, i) => {
      const y = 74 + i * 30;
      const begin = (0.35 + i * 0.1).toFixed(2);
      const when = new Date(c.iso).toISOString().slice(5, 10);
      return `
    <g opacity="0" transform="translate(-14 0)">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${begin}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="translate" from="-14 0" to="0 0"
                        dur="0.5s" begin="${begin}s" fill="freeze"
                        calcMode="spline" keySplines="0.16 1 0.3 1" keyTimes="0;1"/>
      <text x="26" y="${y}" class="grn">+</text>
      <text x="44" y="${y}" class="acc" font-size="11">${esc(when)}</text>
      <text x="90" y="${y}" class="txt" font-size="11">${esc(clip(c.repo, 16))}</text>
      <text x="26" y="${y + 13}" class="dim" font-size="10">${esc(clip(c.message, 46))}</text>
    </g>`;
    })
    .join("");

  return svg(W, H, card(W, H, "git log --oneline — live") + rows);
}

(async () => {
  const { repos, langCount } = await fetchProfile();
  const commits = await fetchCommits(repos);
  if (!commits.length) throw new Error("no commits found — refusing to write empty visuals");
  const a = analyze(commits);

  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/stats.svg", renderStats(a));
  fs.writeFileSync("assets/rhythm.svg", renderRhythm(a, commits));
  fs.writeFileSync("assets/langs.svg", renderLangs(langCount));
  fs.writeFileSync("assets/ticker.svg", renderTicker(commits));

  console.log("wrote 4 visuals", {
    commits: a.total,
    current: a.current,
    longest: a.longest,
    activeDays: a.activeDays,
    peak: `${a.busiestDay} @ ${a.busiestHour}:00`,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
