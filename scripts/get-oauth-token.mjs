// One-time helper: obtains an OAuth refresh token for Docs/Drive user-delegation, so the
// MCP can create a real Google Doc OWNED BY YOU (works on a personal Gmail, where the
// service account cannot own Drive files). Run once; paste the printed token into .env.
//
// Prerequisites (GCP Console, one-time):
//   1. Enable the Google Drive API + Google Docs API + Gmail API in your project.
//   2. APIs & Services -> Credentials -> Create OAuth client ID -> type "Desktop app".
//   3. OAuth consent screen -> External -> add your Google account as a Test user.
//
// Usage:
//   1. Put GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env (Desktop-app client).
//   2. npm run oauth-token   (loads .env via node --env-file)
//   3. Open the printed URL, approve the consent (incl. gmail.send), and copy the printed
//      GOOGLE_OAUTH_REFRESH_TOKEN into .env.
import http from "node:http";
import { OAuth2Client } from "google-auth-library";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first");
  process.exit(1);
}

// Scopes the live connectors need: Docs (copy a template, edit the copy) + Drive, plus
// gmail.send so the same refresh token can send the HR notification email at approve (D1).
// The Gmail API must also be enabled in the GCP project (APIs & Services -> Library).
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.send",
];

const server = http.createServer();
server.listen(0, () => {
  const { port } = server.address();
  const redirectUri = `http://localhost:${port}`;
  const oauth = new OAuth2Client({ clientId, clientSecret, redirectUri });
  const url = oauth.generateAuthUrl({
    access_type: "offline", // request a refresh token
    prompt: "consent", // force a refresh token even on re-consent
    scope: SCOPES,
  });
  console.log(`\nMake sure ${redirectUri} is an "Authorized redirect URI" on your OAuth client.`);
  console.log("\nOpen this URL in your browser and approve:\n");
  console.log(url + "\n");

  server.on("request", async (req, res) => {
    try {
      const u = new URL(req.url, redirectUri);
      const code = u.searchParams.get("code");
      if (!code) {
        res.end("waiting for the OAuth code…");
        return;
      }
      const { tokens } = await oauth.getToken(code);
      res.end("Done — you can close this tab and return to the terminal.");
      if (!tokens.refresh_token) {
        console.error("\nNo refresh_token returned. Revoke the app's access and retry (prompt=consent).");
        process.exit(1);
      }

      // Verify the refresh token actually REDEEMS before we trust it. A token can be valid at
      // mint yet revoked moments later (a later consent supersedes earlier ones on a Testing
      // app) — verifying here catches that immediately instead of at first live call.
      const verify = new OAuth2Client({ clientId, clientSecret });
      verify.setCredentials({ refresh_token: tokens.refresh_token });
      const at = await verify.getAccessToken();
      const info = await verify.getTokenInfo(at.token);
      const hasGmail = (info.scopes ?? []).includes("https://www.googleapis.com/auth/gmail.send");
      console.log(`\n✓ Refresh token verified (redeems OK). scopes: ${(info.scopes ?? []).join(" ")}`);
      if (!hasGmail) {
        console.error("⚠ gmail.send NOT granted — re-run and tick the 'Send email' permission.");
      }

      // Write it straight into .env (update the line in place, or append) so there is no
      // copy-paste / stale-token risk. The file lives in the cwd (run from the repo root).
      const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
      const envPath = ".env";
      const line = `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`;
      let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(env)) {
        env = env.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, line);
      } else {
        env += (env.endsWith("\n") || env === "" ? "" : "\n") + line + "\n";
      }
      writeFileSync(envPath, env);
      console.log(`✓ Wrote GOOGLE_OAUTH_REFRESH_TOKEN into ${envPath}. You're ready — no copy-paste needed.\n`);
      server.close();
      process.exit(0);
    } catch (e) {
      res.end("error: " + String(e));
      console.error(e);
      process.exit(1);
    }
  });
});
