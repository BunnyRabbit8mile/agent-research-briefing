// review.js — Content review subagent
// Analyzes papers_store.json for cross-topic duplicates
// Re-classifies each multi-topic paper to its single best-fit topic
// Usage: node review.js [--apply] [--report]
//   --report  Generate Feishu review report (no changes)
//   --apply   Apply best-fit topic reassignments to the store
const fs = require("fs");
const path = require("path");
const { feishuAuth, feishuPush, h1, h2, text, divider } = require("./lib/feishu");

const PROJECT_DIR = __dirname;
const CONFIG = path.join(PROJECT_DIR, "config.json");
const STORE = path.join(PROJECT_DIR, "papers_store.json");

// Topic definitions with keyword scoring
const TOPICS = {
  Agents: {
    keywords: [
      { term: "agent", weight: 3 },
      { term: "multi-agent", weight: 4 },
      { term: "autonomous", weight: 2 },
      { term: "llm agent", weight: 3 },
      { term: "ai agent", weight: 3 },
      { term: "agentic", weight: 4 },
      { term: "cooperation", weight: 1 },
    ],
  },
  Harness: {
    keywords: [
      { term: "harness", weight: 4 },
      { term: "evaluation framework", weight: 4 },
      { term: "benchmark suite", weight: 3 },
      { term: "eval framework", weight: 4 },
      { term: "framework", weight: 1 },
      { term: "benchmark", weight: 2 },
    ],
  },
  "Skill for Agent": {
    keywords: [
      { term: "skill", weight: 3 },
      { term: "tool use", weight: 4 },
      { term: "plugin", weight: 3 },
      { term: "function calling", weight: 4 },
      { term: "tool calling", weight: 4 },
      { term: "action space", weight: 2 },
      { term: "api", weight: 1 },
    ],
  },
  "Loop Engineering": {
    keywords: [
      { term: "loop", weight: 3 },
      { term: "iteration", weight: 3 },
      { term: "feedback", weight: 3 },
      { term: "self-improving", weight: 4 },
      { term: "self-correcting", weight: 4 },
      { term: "iterative", weight: 3 },
      { term: "reinforcement learning", weight: 2 },
    ],
  },
  "Agent-Native Research Artifact": {
    keywords: [
      { term: "research artifact", weight: 5 },
      { term: "agent-native", weight: 5 },
      { term: "reproducible research", weight: 5 },
      { term: "research agent", weight: 4 },
      { term: "paper agent", weight: 4 },
      { term: "agent workflow", weight: 3 },
    ],
  },
  "Prompt Engineering": {
    keywords: [
      { term: "prompt engineering", weight: 5 },
      { term: "in-context learning", weight: 4 },
      { term: "chain-of-thought", weight: 4 },
      { term: "prompt optimization", weight: 4 },
      { term: "dspy", weight: 4 },
      { term: "prompt", weight: 2 },
    ],
  },
  Evaluation: {
    keywords: [
      { term: "evaluation", weight: 4 },
      { term: "benchmark", weight: 3 },
      { term: "eval", weight: 3 },
      { term: "performance", weight: 1 },
      { term: "metric", weight: 2 },
      { term: "score", weight: 1 },
      { term: "accuracy", weight: 1 },
    ],
  },
  Observability: {
    keywords: [
      { term: "observability", weight: 5 },
      { term: "monitoring", weight: 4 },
      { term: "tracing", weight: 4 },
      { term: "logging", weight: 3 },
      { term: "langfuse", weight: 4 },
      { term: "phoenix", weight: 3 },
      { term: "debug", weight: 2 },
    ],
  },
};

function scorePaper(paper, topicDef) {
  let text = ((paper.title || "") + " " + (paper.summary || "")).toLowerCase();
  let score = 0;
  for (let i = 0; i < topicDef.keywords.length; i++) {
    let kw = topicDef.keywords[i];
    let count = (text.match(new RegExp(kw.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length;
    score += count * kw.weight;
  }
  return score;
}

function findBestTopic(paper, candidateTopics) {
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < candidateTopics.length; i++) {
    let t = candidateTopics[i];
    if (!TOPICS[t]) continue;
    let s = scorePaper(paper, TOPICS[t]);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return { topic: best, score: bestScore };
}

function analyze(store) {
  let papers = store.papers || {};
  let entries = Object.entries(papers);

  // Find multi-topic papers
  let multi = entries.filter(function(e) { return e[1].topics.length > 1; });

  // Collect all actual topic names from the store
  let allTopics = new Set();
  for (let i = 0; i < entries.length; i++) {
    let ts = entries[i][1].topics;
    for (let j = 0; j < ts.length; j++) allTopics.add(ts[j]);
  }
  let topicNames = Array.from(allTopics).sort();

  // Topic overlap matrix
  let overlap = {};
  for (let i = 0; i < topicNames.length; i++) {
    overlap[topicNames[i]] = {};
    for (let j = 0; j < topicNames.length; j++) {
      overlap[topicNames[i]][topicNames[j]] = 0;
    }
  }

  // Per-paper reassignments
  let reassignments = [];
  let changesByTopic = {};
  for (let i = 0; i < topicNames.length; i++) { changesByTopic[topicNames[i]] = { lost: 0, gained: 0 }; }

  for (let i = 0; i < multi.length; i++) {
    let entry = multi[i];
    let id = entry[0];
    let paper = entry[1];
    let currentTopics = paper.topics;

    // Fill overlap matrix
    for (let a = 0; a < currentTopics.length; a++) {
      for (let b = a + 1; b < currentTopics.length; b++) {
        let ta = currentTopics[a];
        let tb = currentTopics[b];
        if (overlap[ta] && overlap[ta][tb] !== undefined) overlap[ta][tb]++;
        if (overlap[tb] && overlap[tb][ta] !== undefined) overlap[tb][ta]++;
      }
    }

    // Find best topic
    let result = findBestTopic(paper, currentTopics);
    if (result.topic && result.topic !== currentTopics[0]) {
      reassignments.push({
        arxiv_id: id,
        title: paper.title,
        from: currentTopics[0],
        to: result.topic,
        allTopics: currentTopics,
        score: result.score,
        published: paper.published,
      });
      changesByTopic[currentTopics[0]].lost++;
      changesByTopic[result.topic].gained++;
    }
  }

  // Stats
  let stats = {
    total: entries.length,
    multiTopic: multi.length,
    multiPercent: (multi.length / entries.length * 100).toFixed(1),
    reassignments: reassignments.length,
    reassignPercent: (reassignments.length / entries.length * 100).toFixed(1),
  };

  return { stats: stats, overlap: overlap, reassignments: reassignments, changesByTopic: changesByTopic };
}

function applyReassignments(store, reassignments) {
  let applied = 0;
  for (let i = 0; i < reassignments.length; i++) {
    let r = reassignments[i];
    let paper = store.papers[r.arxiv_id];
    if (!paper) continue;
    // Each paper belongs to exactly ONE topic — strip all secondary topics
    paper.topics = [r.to];
    applied++;
  }
  // Also strip secondary topics from ALL other papers AND repos
  // to ensure ZERO cross-topic duplicates
  let paperEntries = Object.entries(store.papers);
  for (let j = 0; j < paperEntries.length; j++) {
    let p = paperEntries[j][1];
    if (p.topics.length > 1) { p.topics = [p.topics[0]]; }
  }
  let repoEntries = Object.entries(store.repos || {});
  for (let k = 0; k < repoEntries.length; k++) {
    let r = repoEntries[k][1];
    if (r.topics && r.topics.length > 1) { r.topics = [r.topics[0]]; }
  }
  return applied;
}

function buildReportText(analysis) {
  let lines = [];
  let s = analysis.stats;
  lines.push("=== 内容审核报告 ===");
  lines.push("总论文数: " + s.total);
  lines.push("跨主题论文: " + s.multiTopic + " (" + s.multiPercent + "%)");
  lines.push("建议重分配: " + s.reassignments + " (" + s.reassignPercent + "%)");
  lines.push("");

  // Overlap matrix (top overlaps)
  lines.push("--- 主题重叠矩阵 (top 10) ---");
  let pairs = [];
  let tn = Object.keys(analysis.overlap);
  for (let i = 0; i < tn.length; i++) {
    for (let j = i + 1; j < tn.length; j++) {
      if (analysis.overlap[tn[i]][tn[j]] > 0) {
        pairs.push({ a: tn[i], b: tn[j], count: analysis.overlap[tn[i]][tn[j]] });
      }
    }
  }
  pairs.sort(function(a, b) { return b.count - a.count; });
  for (let i = 0; i < Math.min(pairs.length, 10); i++) {
    lines.push("  " + pairs[i].a + " <-> " + pairs[i].b + ": " + pairs[i].count + " papers");
  }
  lines.push("");

  // Changes by topic
  lines.push("--- 主题变更统计 ---");
  for (let i = 0; i < tn.length; i++) {
    let c = analysis.changesByTopic[tn[i]];
    if (c.lost > 0 || c.gained > 0) {
      lines.push("  " + tn[i] + ": -" + c.lost + " / +" + c.gained);
    }
  }
  lines.push("");

  // Sample reassignments
  lines.push("--- 建议重分配样例 (top 15) ---");
  let sorted = analysis.reassignments.slice().sort(function(a, b) { return b.score - a.score; });
  for (let i = 0; i < Math.min(sorted.length, 15); i++) {
    let r = sorted[i];
    let title = r.title.length > 70 ? r.title.slice(0, 70) + "..." : r.title;
    lines.push("  [" + r.arxiv_id + "] " + r.from + " -> " + r.to + " (score: " + r.score + ")");
    lines.push("    " + title);
  }

  return lines.join("\n");
}


async function pushReport(cfg, analysis) {
  let blocks = [];
  let s = analysis.stats;
  let date = new Date().toISOString().slice(0, 10);
  let domain = cfg.feishu_domain || "bytedance.feishu.cn";

  blocks.push(h1("\uD83D\uDD0D 内容审核报告"));
  blocks.push(text(date, { bold: true }));
  blocks.push(text(""));
  blocks.push(text("\uD83D\uDCCA 总论文: " + s.total + " | 跨主题: " + s.multiTopic + " (" + s.multiPercent + "%) | 建议重分配: " + s.reassignments));
  blocks.push(text(""));

  // Overlap matrix
  blocks.push(h2("\uD83D\uDD17 主题重叠 Top 5"));
  let pairs = [];
  let tn = Object.keys(analysis.overlap);
  for (let i = 0; i < tn.length; i++) {
    for (let j = i + 1; j < tn.length; j++) {
      if (analysis.overlap[tn[i]][tn[j]] > 0) {
        pairs.push({ a: tn[i], b: tn[j], count: analysis.overlap[tn[i]][tn[j]] });
      }
    }
  }
  pairs.sort(function(a, b) { return b.count - a.count; });
  for (let i = 0; i < Math.min(pairs.length, 5); i++) {
    blocks.push(text("  \u2022 " + pairs[i].a + " \u2194 " + pairs[i].b + ": " + pairs[i].count + " \u7BC7"));
  }
  blocks.push(text(""));

  // Changes by topic
  blocks.push(h2("\uD83D\uDCC8 主题变更统计"));
  for (let i = 0; i < tn.length; i++) {
    let c = analysis.changesByTopic[tn[i]];
    if (c.lost > 0 || c.gained > 0) {
      blocks.push(text("  " + tn[i] + ": -" + c.lost + " / +" + c.gained));
    }
  }
  blocks.push(text(""));

  // Sample reassignments
  blocks.push(h2("\uD83D\uDCCB 建议重分配样例"));
  let sorted = analysis.reassignments.slice().sort(function(a, b) { return b.score - a.score; });
  for (let i = 0; i < Math.min(sorted.length, 10); i++) {
    let r = sorted[i];
    let title = r.title.length > 80 ? r.title.slice(0, 80) + "..." : r.title;
    blocks.push(text("\u2022 " + r.from + " \u2192 " + r.to + " (score: " + r.score + ")"));
    blocks.push(text("  " + title, { italic: true }));
  }

  let token = await feishuAuth(cfg, CONFIG);
  if (!token) { console.error("[FATAL] Auth failed"); return null; }
  return await feishuPush(token, "\uD83D\uDD0D Content Review Report " + date, blocks, domain);
}

async function main() {
  let argv = process.argv.slice(2);
  let doApply = argv.includes("--apply");
  let doReport = argv.includes("--report") || !doApply; // report by default

  console.log("=== Content Review ===");

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8")); } catch (e) {}
  let store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
  if (!store.papers) store.papers = {};

  let analysis = analyze(store);

  // Console output
  console.log("\n" + buildReportText(analysis));

  if (doApply) {
    let applied = applyReassignments(store, analysis.reassignments);
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2), "utf-8");
    console.log("\n[DONE] Applied " + applied + " reassignments. Store saved.");
  }

  if (doReport && cfg.feishu_app_id && analysis.stats.multiTopic > 0) {
    console.log("\nPushing report to Feishu...");
    let url = await pushReport(cfg, analysis);
    if (url) console.log("  Report: " + url);
  }

  console.log("\nDone.");
}

main().catch(function(e) {
  console.error("Review fatal:", e);
  process.exit(1);
});
