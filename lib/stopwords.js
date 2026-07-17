// lib/stopwords.js — Shared stopwords for keyword extraction
// Merged from arxiv_feishu_briefing.js and summarize.js

const STOPWORDS = new Set([
  "a", "about", "above", "across", "after", "again", "aim", "aimed", "aims",
  "all", "along", "also", "an", "and", "approach", "are", "art", "as", "at",
  "be", "been", "before", "being", "best", "better", "between", "both", "but",
  "by", "can", "cannot", "challenge", "challenges", "compare", "compared",
  "could", "data", "demonstrate", "demonstrated", "demonstrates",
  "demonstration", "did", "do", "does", "domain", "domains", "due", "during",
  "each", "early", "effective", "effectively", "efficiency", "efficient",
  "enable", "enabled", "enables", "even", "example", "examples", "explore",
  "explored", "explores", "few", "find", "finds", "first", "focus", "focused",
  "focuses", "for", "found", "framework", "from", "further", "hand", "has",
  "have", "he", "here", "high", "how", "however", "human", "if", "improve",
  "improved", "improving", "in", "including", "instance", "instances",
  "into", "introduce", "introduces", "is", "it", "its", "key", "knowledge",
  "large", "leveraging", "log", "low", "made", "make", "makes", "many",
  "may", "method", "might", "model", "more", "most", "multiple", "need",
  "needs", "new", "no", "nor", "not", "novel", "novelty", "number", "of",
  "often", "on", "one", "only", "or", "order", "other", "our", "outperform",
  "outperforms", "over", "own", "paper", "part", "parts", "perform",
  "performed", "performance", "performs", "present", "presents", "propose",
  "proposed", "proposes", "proposing", "provide", "provided", "real",
  "recent", "requires", "result", "results", "same", "set", "several",
  "shall", "she", "should", "show", "shown", "shows", "significantly",
  "significant", "single", "so", "some", "state", "still", "such", "system",
  "systems", "task", "tasks", "term", "terms", "textbf", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "three", "through", "to", "too", "toward", "towards", "trained", "training",
  "two", "under", "use", "used", "using", "various", "very", "was", "we",
  "well", "were", "when", "where", "which", "while", "who", "whom", "why",
  "will", "with", "within", "without", "work", "world", "would", "yet",
]);

module.exports = STOPWORDS;
