# AGENTS.md — agent-research-daily-report

## Project Overview

Daily automated briefing that fetches the latest AI agent research from arXiv, GitHub, and Hacker News, then pushes a formatted report to Feishu Docx under the user's identity.

## Files

| File | Purpose |
|---|---|
| `arxiv_feishu_briefing.js` | Main script: fetch → dedup → bilingual summaries → push |
| `config.json` | Credentials (Feishu app, GitHub token, OAuth) |
| `config.example.json` | Template with all config fields documented |
| `papers_store.json` | Dedup store: `{ papers: { arxiv_id: ... }, repos: { full_name: ... }, last_run: "YYYY-MM-DD" }` |
| `run_briefing.bat` | Batch wrapper with `NODE_OPTIONS=--use-system-ca` |
| `run_review.bat` | Batch wrapper for content review |
| `setup_scheduled_task.ps1` | Register Windows Task Scheduler (daily at 13:00) |
| `nightly_report.js` | Nightly review: daily status + error analysis → Feishu |
| `review.js` | Content audit: cross-topic dedup + keyword reclassify |
| `summarize.js` | Standalone summarizer → `logs/summaries.json` |
| `watchdog.js` | Post-briefing error checker + Codex auto-fix |
| `auth_and_run.js` | One-time OAuth + run briefing |
| `auth_feishu.js` | One-time OAuth to get user refresh token |
| `setup_nightly_report.ps1` | Register NightlyErrorReport task (daily at 21:00) |
| `lib/feishu.js` | Shared Feishu API helpers (auth, push, block builders) |
| `lib/stopwords.js` | Shared stopwords for keyword extraction |
| `test/core.test.js` | Tests for parseAtom, mergePapers, classify, scorePaper |

## How to Run

```
# Manual run (idempotent — skips if no new content unless --force)
D:\nvm\v26.3.1\node.exe arxiv_feishu_briefing.js --force

# First run with backfill (seeds important historical papers)
D:\nvm\v26.3.1\node.exe arxiv_feishu_briefing.js --backfill
```

## Data Sources

| Source | Method | Rate Limit |
|---|---|---|
| arXiv API | `export.arxiv.org/api/query` | None (be polite: 4s delay) |
| GitHub Search API | Token in config | 5000/hr with token |
| Hacker News | `firebaseio.com/v0/topstories` | Free, no key needed |
| Feishu Docx API | User OAuth token (auto-refresh) | Depends on tenant |

## Topics

8 curated topics, each with arXiv + GitHub queries:

1. Agents
2. Harness
3. Skill for Agent
4. Loop Engineering
5. Agent-Native Research Artifact
6. Prompt Engineering
7. Evaluation
8. Observability

## Key Design Decisions

- **Dedup by ID**: Papers by `arxiv_id`, repos by `full_name`. Never duplicates.
- **Singleton per day**: `store.last_run` prevents multiple runs on the same day. Use `--force` to override.
- **User identity**: Docs created under the user's Feishu account via OAuth refresh token (expires 30 days, auto-renews).
- **No NPM dependencies**: Uses only Node.js stdlib (`fs`, `path`, `http`) and built-in `fetch`.
- **No proxy**: All APIs accessible directly without proxy.

## Rules

1. **Think before coding.** When asked a question or feature request, first present analysis, tradeoffs, or a proposed solution. Then explicitly ask whether to proceed with implementation. Never jump straight into code changes without confirmation.

## Conventions

- PowerShell heredocs `@"..."@` mangle `$` and `\\` in regex. When modifying the script, use `.js` patch files via `node -e` or write to temp files.
- `config.json` must not have BOM (PowerShell `Set-Content -Encoding UTF8` adds it; use Node.js `fs.writeFileSync` instead).
- GitHub token is a classic PAT with no scopes (`ghp_` prefix).
- Feishu OAuth redirect URL: `https://ycn00b2861nl.feishu.cn/drive/home/`.
