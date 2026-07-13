// Shared GitHub data layer + SVG helpers for the profile visual generators.

const USER = "mrmushii";

// Repos whose language stats say nothing about engineering ability.
const IGNORED_LANGS = new Set(["HTML", "CSS", "SCSS", "Less"]);

// How many recently-pushed repos to walk for commit history. Enough for a full
// year of rhythm data without burning the unauthenticated rate limit.
const REPO_SCAN_LIMIT = 30;

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
  if (res.status === 403 || res.status === 429) {
    throw new Error(`rate limited on ${path} — set GITHUB_TOKEN`);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const dayKey = (d) => d.toISOString().slice(0, 10);

/**
 * Commit timestamps arrive as ISO strings with the author's own UTC offset
 * (e.g. "2025-06-14T02:11:07+06:00"). To answer "what hour was he actually
 * coding", read the hour off the raw string rather than letting Date coerce
 * it into the runner's timezone.
 */
function localHour(iso) {
  const m = /T(\d{2}):/.exec(iso);
  return m ? Number(m[1]) : 0;
}

async function fetchProfile() {
  const user = await gh(`/users/${USER}`);
  const repos = await gh(`/users/${USER}/repos?per_page=100&sort=pushed`);
  const own = repos.filter((r) => !r.fork);

  const langCount = {};
  for (const r of own) {
    if (r.language && !IGNORED_LANGS.has(r.language)) {
      langCount[r.language] = (langCount[r.language] || 0) + 1;
    }
  }

  return {
    user,
    repos: own,
    stars: own.reduce((n, r) => n + r.stargazers_count, 0),
    followers: user.followers,
    langCount,
  };
}

/** Walk recent repos and collect every commit authored by USER. */
async function fetchCommits(repos) {
  const targets = repos.slice(0, REPO_SCAN_LIMIT);
  const commits = [];

  const results = await Promise.all(
    targets.map(async (r) => {
      try {
        return await gh(
          `/repos/${USER}/${r.name}/commits?author=${USER}&per_page=100`
        );
      } catch (e) {
        // An empty repo 409s and is genuinely fine to skip. A rate limit is NOT:
        // swallowing it would silently undercount and publish a wrong streak.
        if (/rate limited/.test(e.message)) throw e;
        return [];
      }
    })
  );

  for (let i = 0; i < targets.length; i++) {
    for (const c of results[i]) {
      const iso = c.commit?.author?.date;
      if (!iso) continue;
      commits.push({
        repo: targets[i].name,
        iso,
        message: c.commit.message.split("\n")[0],
      });
    }
  }

  commits.sort((a, b) => new Date(b.iso) - new Date(a.iso));
  return commits;
}

/** Streaks, totals, and the hour/weekday rhythm — all from real commits. */
function analyze(commits) {
  const perDay = new Map();
  const hours = new Array(24).fill(0);
  const dows = new Array(7).fill(0);

  for (const c of commits) {
    const d = new Date(c.iso);
    perDay.set(dayKey(d), (perDay.get(dayKey(d)) || 0) + 1);
    hours[localHour(c.iso)]++;
    dows[d.getUTCDay()]++;
  }

  // Current streak: walk backwards from today. Today not yet committed doesn't
  // break the streak — it just hasn't happened yet, so start from yesterday.
  const today = new Date();
  let current = 0;
  const cursor = new Date(today);
  if (!perDay.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (perDay.has(dayKey(cursor))) {
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Longest streak: scan the sorted set of active days for consecutive runs.
  const days = [...perDay.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    const cur = new Date(d + "T00:00:00Z");
    if (prev && (cur - prev) / 86400000 === 1) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = cur;
  }

  const busiestHour = hours.indexOf(Math.max(...hours));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const busiestDay = DOW[dows.indexOf(Math.max(...dows))];

  return {
    total: commits.length,
    activeDays: perDay.size,
    current,
    longest,
    hours,
    dows,
    perDay,
    busiestHour,
    busiestDay,
  };
}

/** Shared chrome: card background, border, and the terminal title bar. */
function card(w, h, title) {
  return `
  <rect width="${w}" height="${h}" rx="12" fill="url(#bg)" stroke="#30363d"/>
  <rect x="1" y="1" width="${w - 2}" height="38" rx="11" fill="#161b22"/>
  <rect x="1" y="30" width="${w - 2}" height="9" fill="#161b22"/>
  <line x1="1" y1="39" x2="${w - 1}" y2="39" stroke="#30363d"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="42" cy="20" r="6" fill="#febc2e"/>
  <circle cx="62" cy="20" r="6" fill="#28c840"/>
  <text x="${w / 2}" y="24" class="ttl" text-anchor="middle">${esc(title)}</text>`;
}

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1117"/>
      <stop offset="1" stop-color="#161b28"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#818cf8"/>
    </linearGradient>
    <style>
      text { font-family:'JetBrains Mono','Fira Code','SF Mono',ui-monospace,monospace; }
      .ttl   { fill:#6e7681; font-size:12px; }
      .lbl   { fill:#8b949e; font-size:11px; letter-spacing:.08em; }
      .num   { fill:#e6edf3; font-size:30px; font-weight:700; }
      .unit  { fill:#38bdf8; font-size:12px; }
      .dim   { fill:#6e7681; font-size:11px; }
      .txt   { fill:#e6edf3; font-size:13px; }
      .acc   { fill:#38bdf8; font-size:13px; }
      .grn   { fill:#3fb950; font-size:13px; }
    </style>
  </defs>`;

const svg = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${DEFS}${inner}
</svg>
`;

module.exports = { USER, gh, esc, fetchProfile, fetchCommits, analyze, card, svg, dayKey };
