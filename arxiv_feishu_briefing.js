// arxiv_feishu_briefing.js
// Daily arXiv papers + GitHub trending repos -> Feishu Docx
// Usage: node arxiv_feishu_briefing.js [--backfill]

const fs = require("fs");
const path = require("path");
const { feishuAuth, feishuPush, h1, h2, text } = require("./lib/feishu");
// ── Self-healing utilities ──
const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "errors.log");

function logError(ctx, err) {
  const ts = new Date().toISOString();
  const msg = "[" + ts + "] " + ctx + ": " + (err?.message || err);
  console.error("  " + msg);
  try { fs.appendFileSync(LOG_FILE, msg + "\n", "utf-8"); } catch(e) {}
}

async function retryFetch(url, options, retries) {
  retries = retries || 3;
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, options);
      return resp;
    } catch (e) {
      if (i < retries - 1) {
        const delay = Math.pow(2, i) * 2000;
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}


// ── Constants ──
const CONFIG = path.join(__dirname, "config.json");
const STORE = path.join(__dirname, "papers_store.json");
const TZ = 8;

const TOPICS = {
  Agents:      'all:agent AND (all:LLM OR all:AI OR all:autonomous OR all:multi-agent)',
  Harness:     'all:(harness OR evaluation) AND all:(framework OR benchmark) AND all:(LLM OR agent)',
  "Skill for Agent": 'all:(skill OR tool OR plugin) AND all:(agent OR LLM OR autonomous)',
  "Loop Engineering": 'all:(loop OR iteration OR feedback) AND all:(agent OR LLM OR self-improving OR self-correcting)',
  "Agent-Native Research Artifact": 'all:"research artifact" OR all:"agent-native" OR all:"reproducible research"',
  "Prompt Engineering": 'all:"prompt engineering" OR all:"in-context learning" OR all:"chain-of-thought prompting"',
  Evaluation:  "all:(evaluation OR benchmark) AND all:(agent OR multi-agent OR autonomous OR LLM)",
  Observability: "all:(observability OR monitoring OR tracing OR logging) AND all:(agent OR multi-agent OR autonomous OR LLM)",
};

const GH_QUERIES = {
  Agents:      "agent (LLM OR multi-agent OR autonomous) language:python",
  Harness:     "(evaluation harness OR eval framework OR benchmark suite) (LLM OR agent) language:python",
  "Skill for Agent": "(agent skill OR agent tool OR agent plugin OR function calling) language:python",
  "Loop Engineering": "(agent loop OR self-improving agent OR self-correcting agent OR iterative agent) language:python",
  "Agent-Native Research Artifact": "(research agent OR paper agent OR agent workflow) language:python",
  "Prompt Engineering": "(prompt engineering OR prompt optimization OR dspy OR guidance) language:python",
  Evaluation:  "(agent evaluation OR LLM benchmark OR agent bench) language:python",
  Observability: "(LLM observability OR agent monitoring OR langfuse OR phoenix tracing) language:python",
};


// ── Dates ──
function todayBJ() { return new Date(Date.now() + TZ * 3600000).toISOString().slice(0, 10); }

// ── Store ──
function loadStore() {
  try {
    if (fs.existsSync(STORE)) return JSON.parse(fs.readFileSync(STORE, "utf-8"));
  } catch (e) {
    logError("Store load", e);
    // Attempt recovery from backup
    const bak = STORE + ".bak";
    if (fs.existsSync(bak)) {
      console.error("  [WARN] papers_store.json corrupt, restoring from backup");
      try {
        const recovered = JSON.parse(fs.readFileSync(bak, "utf-8"));
        fs.copyFileSync(bak, STORE);
        return recovered;
      } catch (e2) {
        logError("Store backup recovery", e2);
      }
    }
    // Last resort: archive corrupt file and start fresh
    try { fs.renameSync(STORE, STORE + ".corrupt." + Date.now()); } catch (_) {}
  }
  return { papers: {}, repos: {} };
}
function saveStore(s) {
  // Atomic write: temp -> rename, then update backup
  const tmp = STORE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, STORE);
  try { fs.copyFileSync(STORE, STORE + ".bak"); } catch (_) {}
}

// ── Config ──
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf-8")); }
  catch (e) { return {}; }
}

// ═══════════════════════════════════════════════════════════
// arXiv
// ═══════════════════════════════════════════════════════════
async function fetchArxiv(query, count, sortBy) {
  const url = "http://export.arxiv.org/api/query?" + new URLSearchParams({
    search_query: query, sortBy, sortOrder: "descending", max_results: String(count),
  });
  const label = sortBy === "relevance" ? "[important]" : "[latest]";
  console.log("  " + label + " " + query.substring(0, 55) + "...");
  try {
    const r = await retryFetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) { console.error("  [WARN] arXiv " + r.status); return []; }
    return parseAtom(await r.text());
  } catch (e) { console.error("  [WARN] " + e.message); return []; }
}

function parseAtom(xml) {
  const papers = [];
  for (const e of xml.split("<entry>").slice(1)) {
    const title = tag(e, "title"), summary = tag(e, "summary");
    const idUrl = tag(e, "id"), published = tag(e, "published");
    const arxivId = idUrl.includes("/abs/") ? idUrl.split("/abs/").pop().replace(/v\d+$/, "") : "";
    const authors = [];
    for (const ab of e.split("<author>").slice(1)) {
      const n = tag(ab, "name"); if (n) authors.push(n);
    }
    papers.push({
      title: title.replace(/\s+/g, " ").trim(),
      authors: authors.slice(0, 5).join(", ") + (authors.length > 5 ? ", et al." : ""),
      summary: summary.replace(/\s+/g, " ").trim(),
      published: published.trim(),
      url: "https://arxiv.org/abs/" + arxivId,
      arxiv_id: arxivId,
    });
  }
  console.log("  -> " + papers.length + " papers");
  return papers;
}

// ═══════════════════════════════════════════════════════════
// GitHub
// ═══════════════════════════════════════════════════════════
async function fetchGitHub(query, count, token) {
  const q = encodeURIComponent(query.replace(/\+/g, " "));
  const url = "https://api.github.com/search/repositories?q=" + q + "&sort=stars&order=desc&per_page=" + count;
  console.log("  [github] " + query.substring(0, 50) + "...");
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "arXivBriefing/1.0" };
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const r = await retryFetch(url, { headers, signal: AbortSignal.timeout(30000) }).catch(e => { logError("GitHub", e); return null; });
    if (!r || !r.ok) { logError("GitHub status", r?.status || "no response"); return []; }
    const data = await r.json();
    const repos = (data.items || []).map(r => ({
      full_name: r.full_name, description: r.description || "",
      stars: r.stargazers_count, language: r.language || "", url: r.html_url,
    }));
    console.log("  -> " + repos.length + " repos");
    return repos;
  } catch (e) { console.error("  [WARN] GitHub: " + e.message); return []; }
}

// ═══════════════════════════════════════════════════════════
// XML helper
// ═══════════════════════════════════════════════════════════
function tag(xml, t) {
  const re = new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">", "i");
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

// ═══════════════════════════════════════════════════════════
// Dedup & Merge
// ═══════════════════════════════════════════════════════════
function mergePapers(store, papers, topic, important) {
  const today = todayBJ();
  let n = 0;
  for (const p of papers) {
    if (!p.arxiv_id) continue;
    if (store.papers[p.arxiv_id]) {
      // Already exists in another topic — do NOT duplicate
      // Review subagent (review.js) handles reclassification if needed
      const e = store.papers[p.arxiv_id];
      if (important) e.is_important = true;
      continue;
    }
    store.papers[p.arxiv_id] = {
      title: p.title, authors: p.authors, summary: p.summary,
      published: p.published, url: p.url,
      topics: [topic], first_seen: today, is_important: !!important,
    };
    n++;
  }
  return n;
}

function mergeRepos(store, repos, topic) {
  const today = todayBJ();
  let n = 0;
  for (const r of repos) {
    if (!r.full_name) continue;
    if (store.repos[r.full_name]) {
      // Already exists in another topic — do NOT duplicate
      continue;
    }
    store.repos[r.full_name] = {
      full_name: r.full_name, description: r.description,
      stars: r.stars, language: r.language, url: r.url,
      topics: [topic], first_seen: today,
    };
    n++;
  }
  return n;
}

function todayPapers(store, topic, date) {
  return Object.entries(store.papers)
    .filter(([_, p]) => p.topics[0] === topic && p.first_seen === date && !p.is_important)
    .map(([id, p]) => ({ ...p, arxiv_id: id }));
}

function todayRepos(store, topic, date) {
  return Object.entries(store.repos || {})
    .filter(([_, r]) => r.topics[0] === topic && r.first_seen === date)
    .map(([id, r]) => ({ ...r, full_name: id }))
    .sort((a, b) => b.stars - a.stars);
}

function getImportant(store, topic) {
  return Object.entries(store.papers)
    .filter(([_, p]) => p.is_important && p.topics.includes(topic))
    .map(([id, p]) => ({ ...p, arxiv_id: id }))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, 5);
}


// ═══════════════════════════════════════════════════════════

// Blog News
const BLOG_KW = /agent|LLM|GPT|Claude|reasoning|multi.agent|autonomous|alignment|RLHF|function call|tool use|open.source.*model|benchmark|safety/i;

async function fetchBlogNews() {
  const items = [];
  // Hacker News (replaces Reddit - free API, high quality)
  try {
    const topR = await retryFetch("https://hacker-news.firebaseio.com/v0/topstories.json", { signal: AbortSignal.timeout(15000) });
    const ids = (await topR.json()).slice(0, 50);
    for (const id of ids) {
      try {
        const sr = await fetch("https://hacker-news.firebaseio.com/v0/item/" + id + ".json", { signal: AbortSignal.timeout(5000) });
        const s = await sr.json();
        if (s && s.title && BLOG_KW.test(s.title) && s.score >= 10) {
          items.push({
            title: s.title.replace(/\s+/g, " ").trim(),
            url: s.url || ("https://news.ycombinator.com/item?id=" + id),
            source: "Hacker News",
            date: new Date(s.time * 1000).toISOString(),
            desc: "⭐" + s.score + " 💬" + (s.descendants || 0),
          });
          if (items.filter(i => i.source === "Hacker News").length >= 5) break;
        }
      } catch (e) {}
    }
  } catch (e) { console.error("  [WARN] HN:", e.message); }

  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}
// Doc Blocks
// ═══════════════════════════════════════════════════════════

// Summarization helpers
const STOPWORDS = require("./lib/stopwords");

function paperSummary(p) {
  const abs = (p.summary || "").trim();
  if (!abs) return "";
  const sents = abs.match(/[^.!?]+[.!?]+/g);
  if (sents && sents.length > 0) {
    let s = sents[0].trim();
    if (s.length > 150) s = s.slice(0, 150) + "...";
    return s;
  }
  return abs.slice(0, 150);
}

function paperKeywords(p) {
  // Extract bilingual keywords from title + abstract
  const text = ((p.title || "") + " " + (p.summary || "").slice(0, 300)).toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const words = text.split(/\s+/);
  const freq = {};
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq).filter(e => e[1] >= 2).sort((a,b) => b[1] - a[1]).slice(0, 4);
  if (top.length === 0) return "";
  const zh = top.map(e => translateKw(e[0])).join(" · ");
  const en = top.map(e => e[0]).join(" · ");
  if (zh === en) return ""; // no translations found
  return "\uD83C\uDDE8\uD83C\uDDF3 " + zh + "\n\uD83C\uDDFA\uD83C\uDDF8 " + en;
}

function paperAbstractZH(p) {
  const abs = (p.summary || "").toLowerCase().replace(/[^a-z0-9\\s-]/g, " ");
  const words = abs.split(/\\s+/);
  const freq = {};
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    const zh = translateKw(w);
    if (zh !== w) freq[zh] = (freq[zh] || 0) + 1;
  }
  const top = Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  if (top.length < 2) return "";
  return "\uD83C\uDDE8\uD83C\uDDF3 \u6458\u8981\uFF1A\u672C\u6587\u805A\u7126" + top.slice(0, 2).join("\u3001") + "\uFF0C\u6D89\u53CA" + top.slice(2).join("\u3001") + "\u7B49\u65B9\u5411\u3002";
}


// Keyword translation map (EN → ZH)
const KW_ZH = {
  "agents": "智能体", "agent": "智能体", "multi-agent": "多智能体", "agentic": "智能体化",
  "reasoning": "推理", "llm": "大语言模型", "benchmark": "基准测试", "benchmarks": "基准测试",
  "evaluation": "评估", "eval": "评估", "models": "模型", "learning": "学习",
  "feedback": "反馈", "scaling": "规模化", "skills": "技能", "tools": "工具",
  "tool": "工具", "planning": "规划", "cooperation": "协作", "coordination": "协调",
  "safety": "安全", "alignment": "对齐", "retrieval": "检索", "rag": "检索增强生成",
  "generation": "生成", "code": "代码", "search": "搜索", "web": "网络",
  "memory": "记忆", "knowledge": "知识", "graph": "图", "reinforcement": "强化学习",
  "rl": "强化学习", "communication": "通信", "vision": "视觉", "language": "语言",
  "training": "训练", "inference": "推理", "prompt": "提示", "prompting": "提示工程",
  "instruction": "指令", "fine-tuning": "微调", "privacy": "隐私", "security": "安全",
  "optimization": "优化", "deployment": "部署", "orchestration": "编排",
  "observability": "可观测性", "monitoring": "监控", "tracing": "追踪",
  "self-improving": "自我改进", "self-correcting": "自我纠正",
  "function": "函数", "robotics": "机器人", "simulation": "仿真",
};

function translateKw(kw) {
  return KW_ZH[kw.toLowerCase()] || kw;
}

function topicSummary(papers) {

  if (!papers || papers.length < 2) return "";
  const allText = papers.map(p => (p.title||"") + " " + (p.summary||"")).join(" ");
  const words = allText.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/);
  const freq = {};
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq).filter(e => e[1] >= 2).sort((a,b) => b[1] - a[1]).slice(0, 4);
  if (top.length === 0) return "";
  const zh = top.map(e => translateKw(e[0]) + "(" + e[1] + "篇)").join("、");
  const en = top.map(e => e[0] + "(" + e[1] + ")").join(", ");
  return "🇨🇳 " + zh + "\n🇺🇸 Focus: " + en + "\n";
}
function buildBlocks(date, papersByTopic, reposByTopic, store, blogItems) {
  const b = [];

  // Title
  b.push(h1("arXiv & GitHub 每日简报 — " + date));

  // Blog news section
  if (blogItems && blogItems.length) {
    b.push(h1("📰 Hacker News — Agent 相关热门"));
    blogItems.forEach((item, i) => {
      const el = [
        { text_run: { content: (i + 1) + ". ", text_element_style: {} } },
        { text_run: { content: "[" + item.source + "] " + item.title, text_element_style: { bold: true, link: { url: item.url } } } },
      ];
      b.push({ block_type: 2, text: { elements: el, style: {} } });
      if (item.desc) b.push(text("   " + item.desc.substring(0, 200) + "\n"));
    });
    b.push(text("\n"));
  }
  const tp = Object.values(papersByTopic).reduce((s, v) => s + v.length, 0);
  const tr = Object.values(reposByTopic).reduce((s, v) => s + v.length, 0);
  b.push(text("论文 " + tp + " 篇 | 仓库 " + tr + " 个 | 知识库 " + Object.keys(store.papers).length + " 篇论文 + " + Object.keys(store.repos || {}).length + " 个仓库\n"));

  // GitHub section
  if (tr > 0) {
    b.push(h1("🔥 GitHub Trending Agent Repos"));
    for (const [topic, repos] of Object.entries(reposByTopic)) {
      if (!repos.length) continue;
      b.push(h2(topic + " (" + repos.length + "个)"));
      repos.forEach((r, i) => {
        const el = [
          { text_run: { content: (i + 1) + ". ", text_element_style: {} } },
          { text_run: { content: r.full_name, text_element_style: { bold: true, link: { url: r.url } } } },
          { text_run: { content: " ⭐" + r.stars.toLocaleString(), text_element_style: {} } },
        ];
        b.push({ block_type: 2, text: { elements: el, style: {} } });
        if (r.description) {
          const desc = r.description.length > 200 ? r.description.substring(0, 200) + "..." : r.description;
          b.push(text("   " + desc + "\n"));
        }
      });
      b.push(text("\n"));
    }
  }

  // Papers section
  b.push(h1("📄 arXiv Papers"));
  for (const [topic, papers] of Object.entries(papersByTopic)) {
    b.push(h2("🔩 " + topic + " (" + papers.length + "篇)"));

    // Pinned important papers
    const imp = getImportant(store, topic);
    if (imp.length) {
      b.push(text("📌 知识库重要论文：", { bold: true }));
      imp.forEach(p => {
        const el = [
          { text_run: { content: "  ★ ", text_element_style: {} } },
          { text_run: { content: p.title, text_element_style: { bold: true, link: { url: p.url } } } },
        ];
        b.push({ block_type: 2, text: { elements: el, style: {} } });
      });
      b.push(text("\n"));
    }

    if (!papers.length) { b.push(text("（无新增）\n")); continue; }
    const ts = topicSummary(papers);
    if (ts) { b.push(text(ts, { bold: true })); b.push(text("")); }
    papers.forEach((p, i) => {
      const el = [
        { text_run: { content: (i + 1) + ". ", text_element_style: {} } },
        { text_run: { content: p.title, text_element_style: { bold: true, link: { url: p.url } } } },
      ];
      b.push({ block_type: 2, text: { elements: el, style: {} } });
      b.push(text("   " + p.authors, { italic: true }));
      const pk = paperKeywords(p);
      if (pk) b.push(text("   " + pk, { italic: true }));
      const ps = paperSummary(p);
      if (ps) b.push(text("   💡 " + ps, { italic: true }));
      const zhAbs = paperAbstractZH(p);
      if (zhAbs) b.push(text("   " + zhAbs, { italic: true }));
      const abs = p.summary.length > 300 ? p.summary.substring(0, 300) + "..." : p.summary;
      b.push(text("   🇺🇸 " + abs + "\n"));
    });
    b.push(text("\n"));
  }
  return b;
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════
async function main() {
  const mainStartTime = Date.now();
  try {
  const backfill = process.argv.includes("--backfill");
  const store = loadStore();
  if (!store.repos) store.repos = {};
  const date = todayBJ();
  const force = process.argv.includes("--force");

  // ── Singleton: run once per day ──
  if (!force && !backfill && store.last_run && store.last_run === date) {
    console.log("⚠ Already ran today (" + date + "). Use --force to override.\n");
    process.exit(0);
  }
  const cfg = loadConfig();

  console.log("");
  console.log("=".repeat(60));
  console.log("  arXiv & GitHub Daily Briefing — " + date);
  console.log("  Store: " + Object.keys(store.papers).length + " papers, " + Object.keys(store.repos).length + " repos");
  console.log("=".repeat(60) + "\n");

  // Backfill (first run only)
  if (backfill && !Object.keys(store.papers).length) {
    console.log("🔄 首次运行：拉取历史重要论文...\n");
    for (const [topic, query] of Object.entries(TOPICS)) {
      console.log("[" + topic + "]");
      const papers = await fetchArxiv(query, 40, "relevance");
      const n = mergePapers(store, papers, topic, true);
      console.log("  新增重要论文: " + n + "\n");
      saveStore(store);
      await sleep(4000);
    }
  }

  // Daily: arXiv
  const papersByTopic = {};
  let papersNew = 0;
  for (const [topic, query] of Object.entries(TOPICS)) {
    console.log("[arXiv " + topic + "]");
    const papers = await fetchArxiv(query, 20, "submittedDate");
    const n = mergePapers(store, papers, topic, false);
    papersNew += n;
    papersByTopic[topic] = todayPapers(store, topic, date);
    console.log("  新增: " + n + "\n");
    saveStore(store);
    await sleep(4000);
  }

  // Daily: GitHub
  const reposByTopic = {};
  let reposNew = 0;
  const ghToken = cfg.github_token || "";
  for (const [topic, query] of Object.entries(GH_QUERIES)) {
    console.log("[GitHub " + topic + "]");
    const repos = await fetchGitHub(query, 10, ghToken);
    const n = mergeRepos(store, repos, topic);
    reposNew += n;
    reposByTopic[topic] = todayRepos(store, topic, date);
    console.log("  新增: " + n + "\n");
    saveStore(store);
    await sleep(3000);
  }

  // Summary
  console.log("-".repeat(60) + "\n  Summary\n" + "-".repeat(60));
  for (const [t, p] of Object.entries(papersByTopic)) console.log("  " + t + ": " + p.length + " papers");
  for (const [t, r] of Object.entries(reposByTopic)) console.log("  GitHub " + t + ": " + r.length + " repos");
  console.log("\n  Papers new: " + papersNew + " | Repos new: " + reposNew);
  console.log("  Store: " + Object.keys(store.papers).length + " papers, " + Object.keys(store.repos).length + " repos");

  // Blog news
  console.log("[Blog News]");
  const blogItems = await fetchBlogNews();
  console.log("  -> " + blogItems.length + " agent-related posts\n");

  // Feishu (skip if nothing new)
  if (!force && papersNew === 0 && reposNew === 0) {
    console.log("\n  ⏭ Nothing new today. Skipping Feishu push.\n");
  } else if (cfg.feishu_app_id && cfg.feishu_app_secret) {
    console.log("\n" + "-".repeat(60) + "\n  Pushing to Feishu...\n" + "-".repeat(60));
    const token = await feishuAuth(cfg, CONFIG);
    if (token) {
      const blocks = buildBlocks(date, papersByTopic, reposByTopic, store, blogItems);
      const url = await feishuPush(token, "arXiv & GitHub Daily Briefing " + date, blocks, cfg.feishu_domain);
      if (url) console.log("\n  Feishu: " + url);
    }
  }
  store.last_run = date; saveStore(store);
  if (Object.keys(store.papers).length > 5000) {
    console.warn("  [WARN] Store has " + Object.keys(store.papers).length + " papers. Consider archiving older entries.");
  }
  const elapsed = Math.round((Date.now() - mainStartTime) / 1000);
  try { fs.writeFileSync(path.join(LOG_DIR, "runtime.json"), JSON.stringify({ date: date, start: new Date(mainStartTime).toISOString(), elapsedSec: elapsed }), "utf-8"); } catch(_) {}
  console.log("\n" + "=".repeat(60) + "\n  Done (" + elapsed + "s).\n" + "=".repeat(60) + "\n");
  } catch (e) {
    logError("FATAL", e);
    console.error("Script crashed but log saved. Check logs/errors.log");
    process.exit(1);
  }
}


function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
