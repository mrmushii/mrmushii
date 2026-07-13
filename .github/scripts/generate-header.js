// Renders assets/header.svg — an animated terminal session driven by live GitHub data.
// Run by .github/workflows/header.yml on a daily schedule.

const USER = "mrmushii";
const OUT = "assets/header.svg";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function relativeTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function collect() {
  const user = await gh(`/users/${USER}`);
  const repos = await gh(`/users/${USER}/repos?per_page=100&sort=pushed`);
  const own = repos.filter((r) => !r.fork);
  const stars = own.reduce((n, r) => n + r.stargazers_count, 0);

  // Markup/style languages aren't a signal — they're just what old coursework repos are made of.
  const IGNORED_LANGS = new Set(["HTML", "CSS", "SCSS"]);
  const langs = {};
  for (const r of own) {
    if (r.language && !IGNORED_LANGS.has(r.language))
      langs[r.language] = (langs[r.language] || 0) + 1;
  }
  const topLangs = Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([l]) => l);

  // Skip the profile repo itself — "I pushed to my README" is not news.
  const latest = own.find((r) => r.name !== USER);

  return {
    repos: own.length,
    stars,
    followers: user.followers,
    topLangs,
    latestName: latest ? latest.name : "—",
    latestWhen: latest ? relativeTime(latest.pushed_at) : "—",
  };
}

// Each line reveals itself in sequence: a typing wipe for commands, a fade for output.
function render(d) {
  const lines = [
    { kind: "cmd", text: "whoami" },
    { kind: "out", text: "Mushfiqur Rahman — full-stack engineer", accent: true },
    { kind: "out", text: "CSE @ IIUC '27 · Chittagong, Bangladesh" },
    { kind: "gap" },
    { kind: "cmd", text: "cat stack.txt" },
    { kind: "out", text: `${d.topLangs.join(" · ")} · Next.js · FastAPI · MongoDB` },
    { kind: "gap" },
    { kind: "cmd", text: "git log --oneline -1 --all" },
    { kind: "out", text: `${d.latestName} — pushed ${d.latestWhen}`, accent: true },
    { kind: "gap" },
    { kind: "cmd", text: "gh api /user --jq .stats" },
    {
      kind: "out",
      text: `${d.repos} repos · ${d.stars} stars · ${d.followers} followers`,
    },
    { kind: "gap" },
    { kind: "cmd", text: "status", cursor: true },
  ];

  const X = 34;
  const TOP = 74;
  const LH = 25;
  const CHAR = 8.4; // monospace advance at 14px
  const TYPE = 0.5; // seconds to type a command
  const PAUSE = 0.32; // beat after each line

  let t = 0.6;
  let y = TOP;
  const body = [];

  for (const line of lines) {
    if (line.kind === "gap") {
      y += 12;
      continue;
    }

    if (line.kind === "cmd") {
      const w = (line.text.length + 2) * CHAR;
      const id = `clip${Math.round(y)}`;
      body.push(`
    <clipPath id="${id}">
      <rect x="${X}" y="${y - 14}" width="0" height="20">
        <animate attributeName="width" from="0" to="${w}" dur="${TYPE}s"
                 begin="${t.toFixed(2)}s" fill="freeze" calcMode="discrete"
                 values="${Array.from({ length: line.text.length + 1 }, (_, i) => i * CHAR + 2 * CHAR).join(";")}" />
      </rect>
    </clipPath>
    <g clip-path="url(#${id})">
      <text x="${X}" y="${y}" class="p">❯</text>
      <text x="${X + 2 * CHAR}" y="${y}" class="c">${esc(line.text)}</text>
    </g>`);

      if (line.cursor) {
        body.push(`
    <rect x="${X + (line.text.length + 2.4) * CHAR}" y="${y - 12}" width="8" height="16" class="cur" opacity="0">
      <animate attributeName="opacity" values="0;1" dur="0.01s" begin="${(t + TYPE).toFixed(2)}s" fill="freeze" />
      <animate attributeName="opacity" values="1;1;0;0;1" dur="1.1s" begin="${(t + TYPE + 0.01).toFixed(2)}s" repeatCount="indefinite" />
    </rect>`);
      }
      t += TYPE + PAUSE;
    } else {
      body.push(`
    <text x="${X}" y="${y}" class="${line.accent ? "a" : "o"}" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.28s" begin="${t.toFixed(2)}s" fill="freeze" />
      ${esc(line.text)}
    </text>`);
      t += 0.24 + PAUSE * 0.5;
    }
    y += LH;
  }

  const H = y + 26;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="${H}" viewBox="0 0 860 ${H}" font-family="'JetBrains Mono','Fira Code','SF Mono',ui-monospace,monospace">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1117"/>
      <stop offset="1" stop-color="#161b28"/>
    </linearGradient>
    <style>
      .c { fill:#e6edf3; font-size:14px; }
      .o { fill:#8b949e; font-size:14px; }
      .a { fill:#38bdf8; font-size:14px; }
      .p { fill:#3fb950; font-size:14px; font-weight:700; }
      .cur { fill:#38bdf8; }
      .ttl { fill:#6e7681; font-size:12px; }
    </style>
  </defs>

  <rect width="860" height="${H}" rx="12" fill="url(#bg)" stroke="#30363d"/>
  <rect x="1" y="1" width="858" height="38" rx="11" fill="#161b22"/>
  <rect x="1" y="30" width="858" height="9" fill="#161b22"/>
  <line x1="1" y1="39" x2="859" y2="39" stroke="#30363d"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="42" cy="20" r="6" fill="#febc2e"/>
  <circle cx="62" cy="20" r="6" fill="#28c840"/>
  <text x="430" y="24" class="ttl" text-anchor="middle">mushfiqur@github — zsh</text>
${body.join("\n")}
</svg>
`;
}

const fs = require("fs");
collect()
  .then((d) => {
    fs.mkdirSync("assets", { recursive: true });
    fs.writeFileSync(OUT, render(d));
    console.log(`wrote ${OUT}`, d);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
