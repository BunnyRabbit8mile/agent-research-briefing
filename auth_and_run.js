// auth_and_run.js — One-time OAuth + generate today's briefing
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const CONFIG = path.join(__dirname, "config.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
const PORT = 18080;
const REDIRECT = "http://127.0.0.1:" + PORT + "/callback";

const AUTH_URL = "https://open.feishu.cn/open-apis/authen/v1/authorize?" +
  "app_id=" + cfg.feishu_app_id +
  "&redirect_uri=" + encodeURIComponent(REDIRECT);

console.log("\n=== Opening browser for ONE-TIME authorization ===\n");
console.log("URL: " + AUTH_URL + "\n");

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const code = u.searchParams.get("code");
  if (!code) { res.end("Waiting..."); return; }

  console.log("Got code, exchanging for token...");
  try {
    const appR = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: cfg.feishu_app_id, app_secret: cfg.feishu_app_secret }),
    });
    const appD = await appR.json();

    const r = await fetch("https://open.feishu.cn/open-apis/authen/v1/oidc/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + appD.app_access_token },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const d = await r.json();
    const token = d.data?.access_token;
    const refresh = d.data?.refresh_token;

    if (!token) {
      console.error("Auth failed:", JSON.stringify(d));
      res.end("Failed. Check console.");
      server.close(); process.exit(1);
    }

    cfg.feishu_user_token = token;
    cfg.feishu_refresh_token = refresh;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 4), "utf-8");
    console.log("Token saved!\n");
    res.end("<h1>Authorization successful! Running briefing...</h1>");
    server.close();

    // Now run the briefing script
    console.log("Running briefing script...\n");
    const { spawn } = require("child_process");
    const node = "process.execPath";
    const script = path.join(__dirname, "arxiv_feishu_briefing.js");
    const proc = spawn(node, [script, "--force"], {
      cwd: __dirname,
      stdio: "inherit",
      env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
    });
    proc.on("close", (code) => process.exit(code));
  } catch (e) {
    console.error(e);
    res.end("Error");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1");
exec('start "" "' + AUTH_URL + '"');
console.log("Waiting for authorization (2 min timeout)...\n");
setTimeout(() => { console.log("Timed out"); server.close(); process.exit(1); }, 120000);
