// nightly_report.js — Daily nighttime review report
// Runs at 21:00 via Windows Task Scheduler
// Always pushes a report to Feishu:
//   - Clean day: status + new paper/repo counts
//   - Error day: error analysis + subagent fix instructions

const fs = require("fs");
const path = require("path");
const { feishuAuth, feishuPush, h1, h2, text, divider } = require("./lib/feishu");

const PROJECT_DIR = __dirname;
const CONFIG = path.join(PROJECT_DIR, "config.json");
const STORE = path.join(PROJECT_DIR, "papers_store.json");
const ERROR_LOG = path.join(PROJECT_DIR, "logs", "errors.log");
const CHECKPOINT = path.join(PROJECT_DIR, "logs", ".nightly_checkpoint");
const TZ = 8;

function todayStr() {
  const d = new Date(Date.now() + TZ * 3600000);
  return d.toISOString().slice(0, 10);
}

function getCheckpoint() {
  try { return parseInt(fs.readFileSync(CHECKPOINT, "utf-8").trim()); } catch { return 0; }
}

function setCheckpoint(pos) {
  fs.writeFileSync(CHECKPOINT, String(pos), "utf-8");
}

function getTodaysErrors() {
  if (!fs.existsSync(ERROR_LOG)) return [];
  const content = fs.readFileSync(ERROR_LOG, "utf-8");
  const cp = getCheckpoint();
  if (cp >= content.length) return [];

  const newText = content.slice(cp);
  const today = todayStr();
  const lines = newText.split("\n").filter(function(l) { return l.trim(); });

  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    let match = lines[i].match(/^\[([^\]]+)\]\s+(.+)/);
    if (match) {
      let date = match[1].slice(0, 10);
      if (date === today) errors.push({ ts: match[1], msg: match[2] });
    }
  }
  setCheckpoint(content.length);
  return errors;
}

function getTodaysStats() {
  try {
    const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
    const today = todayStr();
    const papers = store.papers || {};
    const repos = store.repos || {};

    let newPapers = 0;
    let paperEntries = Object.entries(papers);
    for (let i = 0; i < paperEntries.length; i++) {
      if (paperEntries[i][1].first_seen === today) newPapers++;
    }

    let newRepos = 0;
    let repoEntries = Object.entries(repos);
    for (let j = 0; j < repoEntries.length; j++) {
      if (repoEntries[j][1].first_seen === today) newRepos++;
    }

    return {
      totalPapers: paperEntries.length,
      totalRepos: repoEntries.length,
      newPapers: newPapers,
      newRepos: newRepos,
      lastRun: store.last_run || "unknown",
    };
  } catch (e) {
    return { totalPapers: 0, totalRepos: 0, newPapers: 0, newRepos: 0, lastRun: "error", error: e.message };
  }
}

function classify(msg) {
  if (/rate limit|429|throttl/i.test(msg)) return { cat: "速率限制", level: "observed", fix: "增加请求间隔，检查 GitHub token 配额" };
  if (/token.*expir|auth.*fail|unauthorized|401|403/i.test(msg)) return { cat: "认证失败", level: "observed", fix: "令牌过期，手动运行 auth_feishu.js 刷新" };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) return { cat: "网络错误", level: "observed", fix: "检查代理 (127.0.0.1:7897) 是否在线" };
  if (/JSON.*parse|SyntaxError|Unexpected token/i.test(msg)) return { cat: "数据解析错误", level: "observed", fix: "API 返回异常，检查响应内容" };
  if (/BOM|byte order/i.test(msg)) return { cat: "BOM 编码", level: "observed", fix: "用 Node.js fs.writeFileSync 重写配置文件" };
  if (/timeout|abort/i.test(msg)) return { cat: "请求超时", level: "observed", fix: "增加超时或检查目标服务" };
  return { cat: "其他错误", level: "suspected", fix: "需人工排查" };
}


function buildCleanReport(date, stats, cfg) {
  let blocks = [];
  blocks.push(h1("\uD83C\uDF19 \u591C\u95F4\u5BA1\u67E5\u62A5\u544A"));
  blocks.push(text(date, { bold: true }));
  blocks.push(text(""));
  blocks.push(h2("\u2705 \u8FD0\u884C\u6B63\u5E38"));
  blocks.push(text(""));
  // Compute runtime: prefer runtime.json (briefing timer), fallback to watchdog.log
  let runTime = "未知";
  let rtFile = path.join(PROJECT_DIR, "logs", "runtime.json");
  if (fs.existsSync(rtFile)) {
    try {
      let rt = JSON.parse(fs.readFileSync(rtFile, "utf-8"));
      if (rt.date === date && rt.elapsedSec) {
        if (rt.elapsedSec < 120) runTime = rt.elapsedSec + "秒";
        else runTime = Math.floor(rt.elapsedSec / 60) + "分" + (rt.elapsedSec % 60) + "秒";
      }
    } catch(e2) {}
  }
  if (runTime === "未知") {
    let wdLog2 = path.join(PROJECT_DIR, "logs", "watchdog.log");
    if (fs.existsSync(wdLog2)) {
      try {
        let wd2 = fs.readFileSync(wdLog2, "utf-8");
        let wdLines2 = wd2.trim().split("\n");
        let first = null, last = null;
        for (let i2 = 0; i2 < wdLines2.length; i2++) {
          let m2 = wdLines2[i2].match(/^\[([^\]]+)\]/);
          if (m2) { if (!first) first = m2[1]; last = m2[1]; }
        }
        if (first && last) {
          let diffMs = new Date(last) - new Date(first);
          let sec2 = Math.round(diffMs / 1000);
          if (sec2 < 120) runTime = sec2 + "秒";
          else runTime = Math.floor(sec2 / 60) + "分" + (sec2 % 60) + "秒";
        }
      } catch(e2) {}
    }
  }
  blocks.push(text("⏱️ 运行时长：" + runTime + "（今日13:00执行）"));
  blocks.push(text("\uD83D\uDCC4 \u65B0\u589E\u8BBA\u6587\uFF1A" + stats.newPapers + " \u7BC7"));
  blocks.push(text("\uD83D\uDEE0\uFE0F \u65B0\u589E\u4ED3\u5E93\uFF1A" + stats.newRepos + " \u4E2A"));
  blocks.push(text(""));
  blocks.push(text("\uD83D\uDCCA \u77E5\u8BC6\u5E93\uFF1A" + stats.totalPapers + " \u7BC7\u8BBA\u6587 + " + stats.totalRepos + " \u4E2A\u4ED3\u5E93"));
  blocks.push(text(""));
  blocks.push(text("\uD83D\uDD17 Briefing\uFF1Ahttps://" + (cfg.feishu_domain || "YOUR_TENANT.feishu.cn") + "/drive/home/", { italic: true }));
  return blocks;
}

function buildErrorReport(date, stats, errors) {
  let blocks = [];
  blocks.push(h1("\uD83C\uDF19 \u591C\u95F4\u5BA1\u67E5\u62A5\u544A"));
  blocks.push(text(date, { bold: true }));
  blocks.push(text(""));
  blocks.push(h2("\u26A0\uFE0F \u53D1\u73B0 " + errors.length + " \u6761\u9519\u8BEF"));
  blocks.push(text(""));

  // Stats
  blocks.push(text("\u23F0 \u4ECA\u65E5\u6267\u884C\uFF1A13:00 | \u65B0\u589E\u8BBA\u6587\uFF1A" + stats.newPapers + " \u7BC7 | \u65B0\u589E\u4ED3\u5E93\uFF1A" + stats.newRepos + " \u4E2A"));
  blocks.push(text(""));

  // Group errors
  if (errors.length > 0) {
    let groups = {};
    for (let i = 0; i < errors.length; i++) {
      let c = classify(errors[i].msg);
      let key = c.cat;
      if (!groups[key]) groups[key] = { cat: key, level: c.level, fix: c.fix, errors: [] };
      groups[key].errors.push(errors[i]);
    }

    let catNames = Object.keys(groups);
    for (let ci = 0; ci < catNames.length; ci++) {
      let g = groups[catNames[ci]];
      let tag = g.level === "observed" ? "\uD83D\uDD34 \u5DF2\u89C2\u5BDF\u5230" : "\uD83D\uDFE1 \u7591\u4F3C";
      blocks.push(h2(tag + " — " + g.cat));
      for (let ei = 0; ei < Math.min(g.errors.length, 2); ei++) {
        let msg = g.errors[ei].msg;
        blocks.push(text("  \u2022 " + (msg.length > 150 ? msg.slice(0, 150) + "..." : msg)));
      }
      if (g.errors.length > 2) blocks.push(text("  \u2026 \u8FD8\u6709 " + (g.errors.length - 2) + " \u6761\u540C\u7C7B\u9519\u8BEF"));
      blocks.push(text("\uD83D\uDCA1 \u5EFA\u8BAE\u4FEE\u590D\uFF1A" + g.fix, { italic: true }));
      blocks.push(text(""));
    }
  }

  // Subagent section: embed watchdog log + needs_attention content
  blocks.push(divider());
  blocks.push(h2("🤖 Subagent 自动修复"));
  blocks.push(text("已请求分析 error 日志，并尝试自动修复。"));
  blocks.push(text(""));

  // Embed watchdog log
  let wdLog = path.join(PROJECT_DIR, "logs", "watchdog.log");
  if (fs.existsSync(wdLog)) {
    try {
      let wd = fs.readFileSync(wdLog, "utf-8");
      if (wd.trim()) {
        let wdLines = wd.trim().split("\n");
        let wdRecent = wdLines.slice(-15).join("\n");
        if (wdRecent.length > 1000) wdRecent = wdRecent.slice(-1000);
        blocks.push(h2("📋 Watchdog 日志"));
        blocks.push(text(wdRecent, { italic: true }));
        blocks.push(text(""));
      }
    } catch(e) {}
  }

  // Embed needs_attention.md
  let naFile = path.join(PROJECT_DIR, "logs", "needs_attention.md");
  if (fs.existsSync(naFile)) {
    try {
      let na = fs.readFileSync(naFile, "utf-8");
      if (na.trim()) {
        blocks.push(h2("⚠️ 需人工关注"));
        let naLines = na.trim().split("\n").slice(0, 15);
        for (let n = 0; n < naLines.length; n++) {
          blocks.push(text(naLines[n].slice(0, 250), { italic: true }));
        }
        blocks.push(text(""));
      }
    } catch(e) {}
  }

  if (stats.error) {
    blocks.push(text("papers_store.json 读取失败：" + stats.error, { italic: true }));
  }

  return blocks;
}

async function main() {
  console.log("=== Nightly Review [" + todayStr() + "] ===");

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8")); } catch (e) {}

  if (!cfg.feishu_app_id || !cfg.feishu_app_secret) {
    console.log("  Feishu not configured. Exiting.");
    return;
  }

  let date = todayStr();
  let stats = getTodaysStats();
  let errors = getTodaysErrors();

  console.log("  Stats: " + stats.newPapers + " new papers, " + stats.newRepos + " new repos");
  console.log("  Errors: " + errors.length);

  let blocks;
  let title;
  if (errors.length === 0) {
    title = "\uD83C\uDF19 \u591C\u95F4\u5BA1\u67E5 " + date + " \u2705";
    blocks = buildCleanReport(date, stats, cfg);
  } else {
    title = "\uD83C\uDF19 \u591C\u95F4\u5BA1\u67E5 " + date + " \u26A0\uFE0F";
    blocks = buildErrorReport(date, stats, errors);
  }

  console.log("  Pushing to Feishu...");
  let token = await feishuAuth(cfg, CONFIG);
  if (!token) { console.error("[FATAL] Auth failed"); return; }

  let url = await feishuPush(token, title, blocks, cfg.feishu_domain);
  if (url) {
    console.log("  Report: " + url);
    try { fs.appendFileSync(path.join(PROJECT_DIR, "logs", "nightly_report.log"), "[" + new Date().toISOString() + "] " + url + " | errors:" + errors.length + "\n", "utf-8"); } catch (_) {}
  }
  console.log("Done.");
}


main().catch(function(e) {
  console.error("Nightly review fatal:", e);
  process.exit(1);
});
