// auth_feishu.js — One-time OAuth to get user refresh token
// Run this ONCE to authorize the app to create docs under your account.
// Stores refresh_token in config.json.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const CONFIG = path.join(__dirname, "config.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
const PORT = 18080;
const REDIRECT = "http://localhost:" + PORT + "/callback";

const AUTH_URL = "https://open.feishu.cn/open-apis/authen/v1/authorize?" +
  "app_id=" + cfg.feishu_app_id +
  "&redirect_uri=" + encodeURIComponent(REDIRECT) +
  "&scope=docx%3Adocument%3Acreate%20docx%3Adocument%3Areadonly%20drive%3Adrive%3Areadonly" + "&state=" + oauthState;

console.log("\nOpening browser for Feishu authorization...\n");
console.log("After authorizing, the page will redirect to localhost.\n");

const oauthState = crypto.randomBytes(16).toString("hex");

// Open browser
const platformCmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", AUTH_URL]] : ["open", [AUTH_URL]];
spawn(platformCmd[0], platformCmd[1], { detached: true, stdio: "ignore" }).unref();

// Start local server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const code = url.searchParams.get("code");
  const recvState = url.searchParams.get("state");
  if (recvState !== oauthState) { res.end("Invalid state"); server.close(); return; }

  if (!code) {
    res.end("No auth code received. Please try again.");
    server.close();
    return;
  }

  // Exchange code for tokens
  try {
    const r = await fetch("https://open.feishu.cn/open-apis/authen/v1/oidc/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code,
      }),
    });
    const data = await r.json();

    if (data.access_token) {
      cfg.feishu_refresh_token = data.refresh_token;
      cfg.feishu_user_token = data.access_token;
      fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 4), "utf-8");
      console.log("\nAuthorization successful!");
      console.log("Refresh token saved to config.json\n");
      res.end("<h1>Authorization successful! You can close this page.</h1>");
    } else {
      console.error("Auth failed:", JSON.stringify(data));
      res.end("<h1>Authorization failed. Check console.</h1>");
    }
  } catch (e) {
    console.error("Error:", e.message);
    res.end("<h1>Error. Check console.</h1>");
  }
  server.close();
  process.exit(0);
});

server.listen(PORT, () => console.log("Waiting for authorization..."));
