// One-time helper: obtains an OAuth refresh token for Docs/Drive user-delegation, so the
// MCP can create a real Google Doc OWNED BY YOU (works on a personal Gmail, where the
// service account cannot own Drive files). Run once; paste the printed token into .env.
//
// Prerequisites (GCP Console, one-time):
//   1. Enable the Google Drive API + Google Docs API in your project.
//   2. APIs & Services -> Credentials -> Create OAuth client ID -> type "Desktop app".
//   3. OAuth consent screen -> External -> add your Google account as a Test user.
//
// Usage (PowerShell):
//   $env:GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
//   $env:GOOGLE_OAUTH_CLIENT_SECRET="..."
//   npm run oauth-token
// Then open the printed URL, approve, and copy GOOGLE_OAUTH_REFRESH_TOKEN into .env.
import http from "node:http";
import { OAuth2Client } from "google-auth-library";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first");
  process.exit(1);
}

// Same scopes the live Docs connector needs (copy a template, edit the copy).
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
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
      console.log("\n✓ Add this to your .env:\n");
      console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
      console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      server.close();
      process.exit(0);
    } catch (e) {
      res.end("error: " + String(e));
      console.error(e);
      process.exit(1);
    }
  });
});
