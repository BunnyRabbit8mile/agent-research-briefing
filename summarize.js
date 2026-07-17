// summarize.js — Per-topic and per-paper content summarizer
// Generates structured summaries for the daily briefing
// Usage: node summarize.js [--date YYYY-MM-DD]
// Output: JSON summaries on stdout, or writes to papers_store.json summaries section

const fs = require("fs");
const path = require("path");
const { feishuAuth, feishuPush, h1, h2, text } = require("./lib/feishu");

const PROJECT_DIR = __dirname;
const STORE = path.join(PROJECT_DIR, "papers_store.json");

// Stopwords to filter out from keyword extraction
const STOPWORDS = require("./lib/stopwords");

function extractKeywords(text, maxN) {
  maxN = maxN || 8;
  let words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/);
  let freq = {};
  // Also capture bigrams
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  // Sort by frequency
  let sorted = Object.entries(freq).sort(function(a, b) { return b[1] - a[1]; });
  return sorted.slice(0, maxN).map(function(e) { return e[0]; });
}

// Summarize a single paper: extract thesis sentence from abstract
function summarizePaper(paper) {
  let abs = (paper.summary || "").trim();
  if (!abs) return paper.title.slice(0, 100);

  // Try to get first complete sentence (up to 200 chars)
  let sentences = abs.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 0) {
    let first = sentences[0].trim();
    if (first.length > 200) first = first.slice(0, 200) + "...";
    return first;
  }
  return abs.slice(0, 200);
}

// Summarize a topic: find common themes across papers
function summarizeTopic(papers, topicName) {
  if (!papers || papers.length === 0) {
    return { topic: topicName, count: 0, themes: [], summary: "(无新增)" };
  }

  // Collect all titles and abstracts
  let allText = [];
  for (let i = 0; i < papers.length; i++) {
    allText.push(papers[i].title);
    allText.push(papers[i].summary || "");
  }
  let combined = allText.join(" ");

  // Extract keywords
  let keywords = extractKeywords(combined, 15);

  // Group papers by keyword presence to find themes
  let themes = [];
  let usedKeywords = new Set();
  for (let i = 0; i < keywords.length; i++) {
    let kw = keywords[i];
    if (usedKeywords.has(kw)) continue;
    usedKeywords.add(kw);

    // Find papers containing this keyword
    let matching = [];
    for (let j = 0; j < papers.length; j++) {
      let text = (papers[j].title + " " + (papers[j].summary || "")).toLowerCase();
      if (text.indexOf(kw) >= 0) {
        matching.push(j);
      }
    }
    if (matching.length >= 2) {
      themes.push({ keyword: kw, count: matching.length });
      // Mark papers as counted
      for (let k = 0; k < matching.length; k++) usedKeywords.add(keywords[i]); // already added above
    }
  }

  // Deduplicate: merge overlapping themes
  let mergedThemes = [];
  for (let t = 0; t < themes.length && mergedThemes.length < 5; t++) {
    let isNew = true;
    for (let m = 0; m < mergedThemes.length; m++) {
      if (themes[t].keyword.indexOf(mergedThemes[m].keyword) >= 0 ||
          mergedThemes[m].keyword.indexOf(themes[t].keyword) >= 0) {
        isNew = false;
        break;
      }
    }
    if (isNew) mergedThemes.push(themes[t]);
  }

  // Build summary text
  let summary = "";
  if (mergedThemes.length > 0) {
    let themeStrs = mergedThemes.slice(0, 4).map(function(t) { return t.keyword + "(" + t.count + "篇)"; });
    summary = "本周聚焦：" + themeStrs.join("、");
  } else if (keywords.length > 0) {
    summary = "关键词：" + keywords.slice(0, 6).join("、");
  } else {
    summary = "共" + papers.length + "篇新论文";
  }

  return {
    topic: topicName,
    count: papers.length,
    themes: mergedThemes.slice(0, 5),
    keywords: keywords.slice(0, 10),
    summary: summary,
  };
}

// Main: generate summaries for all topics
function generate(store, dateFilter) {
  let papers = store.papers || {};
  let entries = Object.entries(papers);

  // Group papers by topic
  let byTopic = {};
  for (let i = 0; i < entries.length; i++) {
    let paper = entries[i][1];
    let arxivId = entries[i][0];
    let topic = paper.topics[0]; // single topic now
    if (!topic) continue;

    // Optional date filter
    if (dateFilter && paper.first_seen !== dateFilter) continue;

    if (!byTopic[topic]) byTopic[topic] = [];
    byTopic[topic].push(Object.assign({ arxiv_id: arxivId }, paper));
  }

  // Generate summaries
  let topicSummaries = {};
  let paperSummaries = {};

  let topicNames = Object.keys(byTopic).sort();
  for (let t = 0; t < topicNames.length; t++) {
    let tn = topicNames[t];
    let topicPapers = byTopic[tn];

    topicSummaries[tn] = summarizeTopic(topicPapers, tn);

    for (let p = 0; p < topicPapers.length; p++) {
      let paper = topicPapers[p];
      if (!paperSummaries[paper.arxiv_id]) {
        paperSummaries[paper.arxiv_id] = summarizePaper(paper);
      }
    }
  }

  return {
    topics: topicSummaries,
    papers: paperSummaries,
    generated: new Date().toISOString(),
    totalTopics: Object.keys(topicSummaries).length,
    totalPapers: Object.keys(paperSummaries).length,
  };
}


// Build Feishu blocks for the summaries
function buildSummaryBlocks(summaries) {
  let blocks = [];
  blocks.push(h1("\uD83D\uDCCA \u4ECA\u65E5\u5185\u5BB9\u6458\u8981")); // 今日内容摘要

  let topicNames = Object.keys(summaries.topics).sort();
  for (let i = 0; i < topicNames.length; i++) {
    let tn = topicNames[i];
    let ts = summaries.topics[tn];
    blocks.push(h2(tn + " (" + ts.count + "\u7BC7)"));
    blocks.push(text(ts.summary, { italic: true }));
    blocks.push(text(""));
  }

  blocks.push(text("\u751F\u6210\u65F6\u95F4: " + summaries.generated.slice(0, 16).replace("T", " "), { italic: true }));
  return blocks;
}

async function main() {
  let argv = process.argv.slice(2);
  let dateArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) { dateArg = argv[i + 1]; break; }
  }

  console.log("=== Content Summarizer ===");

  let store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
  let summaries = generate(store, dateArg);

  console.log("Topics: " + summaries.totalTopics);
  console.log("Papers summarized: " + summaries.totalPapers);

  // Console output
  let topicNames = Object.keys(summaries.topics).sort();
  for (let i = 0; i < topicNames.length; i++) {
    let ts = summaries.topics[topicNames[i]];
    console.log("\n[" + topicNames[i] + "] (" + ts.count + "篇)");
    console.log("  " + ts.summary);
  }

  // Output JSON for consumption by main script
  let jsonOut = JSON.stringify(summaries, null, 2);
  let outFile = path.join(PROJECT_DIR, "logs", "summaries.json");
  try {
    if (!fs.existsSync(path.join(PROJECT_DIR, "logs"))) fs.mkdirSync(path.join(PROJECT_DIR, "logs"), { recursive: true });
    fs.writeFileSync(outFile, jsonOut, "utf-8");
    console.log("\nSaved: logs/summaries.json");
  } catch (e) { console.error("Save error:", e.message); }

  // Summaries are now integrated into the main briefing (arxiv_feishu_briefing.js)
  // This script outputs JSON only — logs/summaries.json
  console.log("\nDone. Summaries saved to logs/summaries.json");
}

main().catch(function(e) {
  console.error("Summarize fatal:", e);
  process.exit(1);
});
