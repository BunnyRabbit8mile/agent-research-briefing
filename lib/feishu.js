// lib/feishu.js — Shared Feishu API helpers
// Used by: arxiv_feishu_briefing.js, nightly_report.js, review.js, summarize.js

const fs = require("fs");

/**
 * Authenticate with Feishu. Tries user OAuth refresh first,
 * falls back to tenant access token.
 * Mutates cfg with refreshed tokens and writes back to configPath.
 * @param {object} cfg - config object with feishu_app_id, feishu_app_secret, feishu_refresh_token
 * @param {string} configPath - path to config.json for saving refreshed tokens
 * @returns {Promise<string>} access token
 */
async function feishuAuth(cfg, configPath) {
  const { feishu_app_id: appId, feishu_app_secret: secret, feishu_refresh_token: refreshToken } = cfg;

  // Use user token (creates docs under user identity)
  if (refreshToken) {
    try {
      // First get app_access_token needed for OIDC refresh
      const appR = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: secret }),
        signal: AbortSignal.timeout(15000),
      });
      const appD = await appR.json();
      const appToken = appD.app_access_token;
      if (!appToken) throw new Error("No app token");

      // Refresh user token
      const r = await fetch("https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + appToken },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      const userToken = d.data?.access_token;
      if (userToken) {
        cfg.feishu_refresh_token = d.data.refresh_token || refreshToken;
        cfg.feishu_user_token = userToken;
        if (configPath) {
          // Atomic write to avoid corruption on concurrent access
          const tmp = configPath + ".tmp";
          fs.writeFileSync(tmp, JSON.stringify(cfg, null, 4), "utf-8");
          fs.renameSync(tmp, configPath);
        }
        console.log("  Using user identity token");
        return userToken;
      }
      console.error("  [WARN] Refresh failed, falling back to app token");
    } catch (e) { console.error("  [WARN] Refresh error:", e.message); }
  }

  // Fallback: tenant access token
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: secret }),
    signal: AbortSignal.timeout(15000),
  });
  return (await r.json()).tenant_access_token || "";
}

/**
 * Create a Feishu Docx document and push content blocks.
 * @param {string} token - Feishu access token
 * @param {string} title - document title
 * @param {Array} blocks - Feishu block objects
 * @param {string} domain - Feishu domain (e.g. "bytedance.feishu.cn")
 * @returns {Promise<string|null>} document URL or null on failure
 */
async function feishuPush(token, title, blocks, domain) {
  const api = "https://open.feishu.cn/open-apis/docx/v1/documents";
  let r = await fetch(api, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ title }), signal: AbortSignal.timeout(15000),
  });
  const d = await r.json();
  if (d.code !== 0) { console.error("[ERROR] Create doc:", JSON.stringify(d)); return null; }
  const docId = d.data.document.document_id;

  for (let i = 0; i < blocks.length; i += 50) {
    const batch = blocks.slice(i, i + 50);
    for (let retry = 0; retry < 3; retry++) {
      try {
        const r2 = await fetch(api + "/" + docId + "/blocks/" + docId + "/children", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ children: batch, index: i }), signal: AbortSignal.timeout(30000),
        });
        const d2 = await r2.json();
        if (d2.code === 0) { console.log("  Blocks " + (i + 1) + "-" + Math.min(i + 50, blocks.length) + "/" + blocks.length); break; }
        else { console.error("[WARN] Batch " + i + ":", d2.msg); break; }
      } catch (e) { console.error("  Retry " + (retry + 1) + " batch " + i + ": " + e.message); await sleep(2000); }
    }
  }
  return "https://" + (domain || "bytedance.feishu.cn") + "/docx/" + docId;
}

// Feishu Docx block builders
function h1(t) { return { block_type: 3, heading1: { elements: [{ text_run: { content: t } }], style: {} } }; }
function h2(t) { return { block_type: 4, heading2: { elements: [{ text_run: { content: t } }], style: {} } }; }
function text(c, style) {
  const el = { content: c };
  if (style) el.text_element_style = style;
  return { block_type: 2, text: { elements: [{ text_run: el }], style: {} } };
}
function divider() {
  return { block_type: 2, text: { elements: [{ text_run: { content: "————————————————————" } }], style: {} } };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { feishuAuth, feishuPush, h1, h2, text, divider };
