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

const HAS_TOKEN = Boolean(process.env.GITHUB_TOKEN);

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`graphql: ${json.errors[0].message}`);
  return json.data;
}

/**
 * GitHub's own contribution calendar — the exact data behind the green squares,
 * including private work when the token carries `read:user` AND the account has
 * "Include private contributions on my profile" enabled.
 *
 * This is the only correct source for a streak. Counting commits off the REST
 * API can't see private repos and misses PRs, reviews and issues entirely.
 */
async function fetchCalendar() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  const data = await graphql(
    `query($user: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $user) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`,
    { user: USER, from: from.toISOString(), to: to.toISOString() }
  );

  const cal = data.user.contributionsCollection.contributionCalendar;
  const perDay = new Map();
  for (const w of cal.weeks) {
    for (const d of w.contributionDays) {
      if (d.contributionCount > 0) perDay.set(d.date, d.contributionCount);
    }
  }
  return { total: cal.totalContributions, perDay };
}

/**
 * Repos for language stats and commit scanning. With a token we ask for the
 * authenticated user's repos so private ones are included; without one we can
 * only see public.
 */
async function fetchProfile() {
  const user = await gh(`/users/${USER}`);
  const repos = HAS_TOKEN
    ? await gh(`/user/repos?per_page=100&affiliation=owner&visibility=all&sort=pushed`)
    : await gh(`/users/${USER}/repos?per_page=100&sort=pushed`);
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
    privateCount: own.filter((r) => r.private).length,
    stars: own.reduce((n, r) => n + r.stargazers_count, 0),
    followers: user.followers,
    langCount,
  };
}

/**
 * Every commit authored by USER across recent repos, public and private.
 *
 * Private repos contribute their TIMESTAMPS only. Names and commit messages of
 * private work are never carried out of this function — they'd be published to
 * a public README, which would leak exactly what "private" is supposed to mean.
 */
async function fetchCommits(repos) {
  const targets = repos.slice(0, REPO_SCAN_LIMIT);

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

  const commits = [];
  for (let i = 0; i < targets.length; i++) {
    const isPrivate = Boolean(targets[i].private);
    for (const c of results[i]) {
      const iso = c.commit?.author?.date;
      if (!iso) continue;
      commits.push({
        iso,
        private: isPrivate,
        repo: isPrivate ? "private repo" : targets[i].name,
        message: isPrivate ? "—" : c.commit.message.split("\n")[0],
      });
    }
  }

  commits.sort((a, b) => new Date(b.iso) - new Date(a.iso));
  return commits;
}

/**
 * Streaks and totals come from the contribution calendar (accurate, includes
 * private work). The hour/weekday rhythm comes from commit timestamps, since
 * the calendar is daily-resolution only.
 */
function analyze(commits, calendar) {
  const perDay = calendar.perDay;
  const hours = new Array(24).fill(0);
  const dows = new Array(7).fill(0);

  for (const c of commits) {
    hours[localHour(c.iso)]++;
    dows[new Date(c.iso).getUTCDay()]++;
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
    total: calendar.total, // contributions incl. private, not just public commits
    activeDays: perDay.size,
    current,
    longest,
    hours,
    dows,
    perDay,
    busiestHour,
    busiestDay,
    scanned: commits.length, // commits behind the rhythm chart
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

module.exports = {
  USER,
  HAS_TOKEN,
  gh,
  esc,
  fetchProfile,
  fetchCommits,
  fetchCalendar,
  analyze,
  card,
  svg,
  dayKey,
};
