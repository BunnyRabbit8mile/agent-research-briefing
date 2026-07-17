// watchdog.js - Daily error checker & Codex-powered auto-fixer
// Runs at 1:30 AM via Windows Task Scheduler
// Detects new errors in logs/errors.log, invokes codex exec to fix

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Hardcoded - watchdog may run from a different directory than the project
const PROJECT_DIR = "C:\\Users\\hotsa\\Documents\\agent-research-daily-report";
const ERROR_LOG = path.join(PROJECT_DIR, "logs", "errors.log");
const CHECKPOINT = path.join(PROJECT_DIR, "logs", ".last_checkpoint");
const WATCHDOG_LOG = path.join(PROJECT_DIR, "logs", "watchdog.log");
const NEEDS_ATTENTION = path.join(PROJECT_DIR, "logs", "needs_attention.md");
const CODEX = "C:\\Users\\hotsa\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const MAX_ERROR_BYTES = 50000;

function log(msg) {
  const ts = new Date().toISOString();
  const line = "[" + ts + "] " + msg;
  console.log(line);
  try { fs.appendFileSync(WATCHDOG_LOG, line + "\n", "utf-8"); } catch (e) {}
}

function getCheckpoint() {
  try { return parseInt(fs.readFileSync(CHECKPOINT, "utf-8").trim()); } catch { return 0; }
}

function setCheckpoint(pos) {
  try { fs.writeFileSync(CHECKPOINT, String(pos), "utf-8"); } catch (e) {}
}

function getNewErrors() {
  if (!fs.existsSync(ERROR_LOG)) return { text: "", size: 0 };
  const stat = fs.statSync(ERROR_LOG);
  if (stat.size === 0) return { text: "", size: 0 };
  const content = fs.readFileSync(ERROR_LOG, "utf-8");
  const cp = getCheckpoint();
  if (cp >= content.length) return { text: "", size: content.length };
  const newErrors = content.slice(cp);
  setCheckpoint(content.length);
  return { text: newErrors, size: content.length };
}

function buildPrompt(errors) {
  let agentsMd = "";
  try {
    agentsMd = fs.readFileSync(path.join(PROJECT_DIR, "AGENTS.md"), "utf-8");
  } catch (e) {
    agentsMd = "(AGENTS.md not found)";
  }

  const errorText = errors.length > MAX_ERROR_BYTES
    ? errors.slice(0, MAX_ERROR_BYTES) + "\n... (truncated, " + errors.length + " bytes total)"
    : errors;

  return "You are an autonomous error-fixing agent for the \"agent-research-daily-report\" project.\n\n## Full Project Context (AGENTS.md)\n" + agentsMd + "\n\n## Error Log (new errors since last check)\n```\n" + (errorText.trim() || "(no errors)") + "\n```\n\n## Fix Protocol (try in that order)\n1. GitHub rate limit / API error -> verify token validity, adjust delay/retry, add exponential backoff\n2. Config JSON parse error -> strip BOM with Node.js fs.writeFileSync (NEVER use PowerShell Set-Content which adds BOM)\n3. papers_store.json corrupt -> backup to papers_store.json.bak, recreate with { \"papers\": {}, \"repos\": {} }\n4. Feishu auth error (token expired / refresh failed) -> CANNOT auto-fix. Write a clear report to logs/needs_attention.md with:\n   - Error details\n   - What human must do: re-run auth_feishu.js to get fresh tokens, update config.json\n5. Network/proxy error (127.0.0.1:7897) -> add fallback path that bypasses proxy on retry\n6. Any other error -> diagnose root cause, apply minimal surgical fix\n\n## Unfixable Errors -> Notification\nIf you cannot fix an error, write a clear standalone report to:\n  logs/needs_attention.md\n\nUse this format:\n```markdown\n# Needs Attention — YYYY-MM-DD\n\n## [Error Category]\n- **Error:** exact error message\n- **Action Required:** specific steps for human\n```\n\n## Rules\n- Only modify files within C:\\Users\\hotsa\\Documents\\agent-research-daily-report\n- Never expose secrets (feishu_app_secret, tokens) in any output or log\n- Keep changes minimal — fix the error, do not refactor unrelated code\n- config.json must NOT have BOM\n- After fixing, verify the fix by re-reading changed lines\n\n## Output\nSummarize: what errors were found, what you fixed, and what still needs human attention.";
}

async function main() {
  log("=== Watchdog started ===");

  const errors = getNewErrors();
  if (!errors.text.trim()) {
    log("No new errors since last check. Done.");
    return;
  }

  const errorLines = errors.text.split("\n").filter(function(l) { return l.trim(); }).length;
  log("Found " + errorLines + " new error line(s) (" + errors.text.length + " bytes). Launching Codex...");

  const prompt = buildPrompt(errors.text);
  const promptFile = path.join(require("os").tmpdir(), ".watchdog_prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf-8");
  log("Prompt written (" + prompt.length + " chars)");
  const cmd = "type \"" + promptFile + "\" | \"" + CODEX + "\" exec -C \"" + PROJECT_DIR + "\" --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral -";

  log("Executing: codex exec -C " + PROJECT_DIR + " ...");
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 900000,
      maxBuffer: 20 * 1024 * 1024,
      cwd: PROJECT_DIR
    });
    log("Codex exec completed successfully.");
    if (output && output.trim()) {
      try { fs.appendFileSync(WATCHDOG_LOG, "--- codex output ---\n" + output.trim() + "\n--- end codex ---\n", "utf-8"); } catch (e) {}
    }
  } catch (e) {
    log("Codex exec FAILED: " + (e.message || String(e)));
    if (e.stdout) { try { fs.appendFileSync(WATCHDOG_LOG, "--- stdout ---\n" + String(e.stdout).trim() + "\n", "utf-8"); } catch (_) {} }
    if (e.stderr) { try { fs.appendFileSync(WATCHDOG_LOG, "--- stderr ---\n" + String(e.stderr).trim() + "\n", "utf-8"); } catch (_) {} }
    try {
      let attn = "# Needs Attention — " + new Date().toISOString().slice(0, 10) + "\n\n";
      attn += "## Watchdog: codex exec failed\n";
      attn += "- **Error:** " + (e.message || "unknown") + "\n";
      attn += "- **Action Required:** Check logs/watchdog.log for details. Manually run codex exec.\n";
      fs.appendFileSync(NEEDS_ATTENTION, attn, "utf-8");
    } catch (_) {}
  }

  try { fs.unlinkSync(promptFile); } catch (_) {}

  log("=== Watchdog finished ===");
}

main().catch(function(e) {
  console.error("Watchdog fatal:", e);
  try { fs.appendFileSync(WATCHDOG_LOG, "[FATAL] " + (e.message || String(e)) + "\n", "utf-8"); } catch (_) {}
  process.exit(1);
});
