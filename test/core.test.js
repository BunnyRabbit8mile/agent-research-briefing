// test/core.test.js — Tests for critical pure functions
// Run: node test/core.test.js

const path = require("path");

const ROOT = path.join(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { console.error("  FAIL: " + label); failed++; }
}

function assertEq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { console.error("  FAIL: " + label + " — expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); failed++; }
}

// ═══════════════════════════════════════════════════════════
// Replicated pure functions (matching source behavior exactly)
// ═══════════════════════════════════════════════════════════

// From arxiv_feishu_briefing.js
function tag(xml, t) {
  const re = new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">", "i");
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
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
  return papers;
}

function todayBJ() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

function mergePapers(store, papers, topic, important) {
  const today = todayBJ();
  let n = 0;
  for (const p of papers) {
    if (!p.arxiv_id) continue;
    if (store.papers[p.arxiv_id]) {
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

function translateKw(kw) { return KW_ZH[kw.toLowerCase()] || kw; }

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

// From nightly_report.js
function classify(msg) {
  if (/rate limit|429|throttl/i.test(msg)) return { cat: "速率限制", level: "observed", fix: "增加请求间隔，检查 GitHub token 配额" };
  if (/token.*expir|auth.*fail|unauthorized|401|403/i.test(msg)) return { cat: "认证失败", level: "observed", fix: "令牌过期，手动运行 auth_feishu.js 刷新" };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) return { cat: "网络错误", level: "observed", fix: "检查代理 (127.0.0.1:7897) 是否在线" };
  if (/JSON.*parse|SyntaxError|Unexpected token/i.test(msg)) return { cat: "数据解析错误", level: "observed", fix: "API 返回异常，检查响应内容" };
  if (/BOM|byte order/i.test(msg)) return { cat: "BOM 编码", level: "observed", fix: "用 Node.js fs.writeFileSync 重写配置文件" };
  if (/timeout|abort/i.test(msg)) return { cat: "请求超时", level: "observed", fix: "增加超时或检查目标服务" };
  return { cat: "其他错误", level: "suspected", fix: "需人工排查" };
}

// From review.js
const TOPICS_REVIEW = {
  Agents: {
    keywords: [
      { term: "agent", weight: 3 }, { term: "multi-agent", weight: 4 },
      { term: "autonomous", weight: 2 }, { term: "agentic", weight: 4 },
      { term: "cooperation", weight: 1 },
    ],
  },
  "Prompt Engineering": {
    keywords: [
      { term: "prompt engineering", weight: 5 }, { term: "in-context learning", weight: 4 },
      { term: "chain-of-thought", weight: 4 }, { term: "prompt", weight: 2 },
    ],
  },
  Evaluation: {
    keywords: [
      { term: "evaluation", weight: 4 }, { term: "benchmark", weight: 3 },
      { term: "eval", weight: 3 }, { term: "metric", weight: 2 },
    ],
  },
};

function scorePaper(paper, topicDef) {
  const text = ((paper.title || "") + " " + (paper.summary || "")).toLowerCase();
  let score = 0;
  for (const kw of topicDef.keywords) {
    const escaped = kw.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (text.match(new RegExp(escaped, "gi")) || []).length;
    score += count * kw.weight;
  }
  return score;
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

console.log("=== Core Tests ===\n");

// ── parseAtom ──
console.log("parseAtom:");
const sampleXml = '<?xml version="1.0"?><feed><entry><title>Test Paper</title><summary>This is a test.</summary><id>http://arxiv.org/abs/2501.00001v1</id><published>2025-01-01</published><author><name>Alice</name></author><author><name>Bob</name></author></entry></feed>';
const parsed = parseAtom(sampleXml);
assertEq(parsed.length, 1, "parses one entry");
assertEq(parsed[0].title, "Test Paper", "extracts title");
assertEq(parsed[0].arxiv_id, "2501.00001", "extracts arxiv_id (strip version)");
assertEq(parsed[0].url, "https://arxiv.org/abs/2501.00001", "builds url");

const multiXml = '<feed><entry><title>P1</title><summary>S1</summary><id>http://arxiv.org/abs/2501.1</id><published>2025-01-01</published></entry><entry><title>P2</title><summary>S2</summary><id>http://arxiv.org/abs/2501.2</id><published>2025-01-02</published></entry></feed>';
assertEq(parseAtom(multiXml).length, 2, "parses two entries");

const manyAuthors = '<feed><entry><title>Big Team</title><summary>x</summary><id>http://arxiv.org/abs/2501.3</id><published>2025</published>' + Array(8).fill('<author><name>A</name></author>').join('') + '</entry></feed>';
const bigPaper = parseAtom(manyAuthors)[0];
assert(bigPaper.authors.endsWith(", et al."), "truncates >5 authors with et al.");

// ── tag helper ──
console.log("tag:");
assertEq(tag("<title>Hello</title>", "title"), "Hello", "extracts simple tag");
assertEq(tag("<title attr=\"x\">Hi</title>", "title"), "Hi", "handles attributes");
assertEq(tag("<other>no</other>", "title"), "", "returns empty for missing tag");

// ── mergePapers ──
console.log("mergePapers:");
const store1 = { papers: {}, repos: {} };
const papers = [{ arxiv_id: "2501.1", title: "A", summary: "s", published: "2025", url: "http://x", authors: "X" }];
assertEq(mergePapers(store1, papers, "Agents", false), 1, "adds new paper");
assertEq(Object.keys(store1.papers).length, 1, "store has 1 paper");
assertEq(mergePapers(store1, papers, "Agents", false), 0, "skips duplicate");
assertEq(store1.papers["2501.1"].topics, ["Agents"], "stores single topic");

const store2 = { papers: {}, repos: {} };
mergePapers(store2, papers, "Agents", true);
assertEq(store2.papers["2501.1"].is_important, true, "marks important");

const noId = [{ title: "Nope", summary: "s" }];
const store3 = { papers: {}, repos: {} };
assertEq(mergePapers(store3, noId, "Topic", false), 0, "skips paper without arxiv_id");

// ── paperSummary ──
console.log("paperSummary:");
const p1 = { summary: "We propose a novel method. It works well. Thank you." };
assert(paperSummary(p1).startsWith("We propose"), "extracts first sentence");
const p2 = { summary: "" };
assertEq(paperSummary(p2), "", "empty summary returns empty");

// ── translateKw ──
console.log("translateKw:");
assertEq(translateKw("agent"), "智能体", "translates agent");
assertEq(translateKw("reinforcement"), "强化学习", "translates reinforcement");
assertEq(translateKw("unknownword"), "unknownword", "returns original for unknown");

// ── classify ──
console.log("classify:");
assertEq(classify("rate limit exceeded 429").cat, "速率限制", "classifies rate limit");
assertEq(classify("token expired 401").cat, "认证失败", "classifies auth failure");
assertEq(classify("ENOTFOUND dns error").cat, "网络错误", "classifies network error");
assertEq(classify("JSON parse error").cat, "数据解析错误", "classifies parse error");
assertEq(classify("BOM detected").cat, "BOM 编码", "classifies BOM");
assertEq(classify("request timeout").cat, "请求超时", "classifies timeout");
assertEq(classify("some random unknown error").cat, "其他错误", "fallback for unknown");

// ── scorePaper ──
console.log("scorePaper:");
const agentPaper = { title: "Multi-Agent Cooperation Framework", summary: "An agentic approach to multi-agent systems using autonomous agents." };
const promptPaper = { title: "Chain-of-Thought Prompt Engineering", summary: "We study prompt optimization and in-context learning for LLMs." };
const evalPaper = { title: "A New Evaluation Benchmark", summary: "We propose a benchmark for eval and evaluation metrics." };

const agentScore = scorePaper(agentPaper, TOPICS_REVIEW.Agents);
const promptScore = scorePaper(agentPaper, TOPICS_REVIEW["Prompt Engineering"]);
assert(agentScore > promptScore, "agent paper scores higher for Agents (" + agentScore + " > " + promptScore + ")");

const pScoreForPrompt = scorePaper(promptPaper, TOPICS_REVIEW["Prompt Engineering"]);
const pScoreForAgent = scorePaper(promptPaper, TOPICS_REVIEW.Agents);
assert(pScoreForPrompt > pScoreForAgent, "prompt paper scores higher for Prompt Engineering (" + pScoreForPrompt + " > " + pScoreForAgent + ")");

const eScoreForEval = scorePaper(evalPaper, TOPICS_REVIEW.Evaluation);
const eScoreForAgent = scorePaper(evalPaper, TOPICS_REVIEW.Agents);
assert(eScoreForEval > eScoreForAgent, "eval paper scores higher for Evaluation (" + eScoreForEval + " > " + eScoreForAgent + ")");

// ── Summary ──
console.log("\n" + "=".repeat(50));
console.log("  " + passed + " passed, " + failed + " failed, " + (passed + failed) + " total");
console.log("=".repeat(50));
process.exit(failed > 0 ? 1 : 0);
