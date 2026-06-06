// Live Gmail connector (OAuth user-delegation). Activated when GOOGLE_CONNECTORS=live AND
// OAuth creds are present — the refresh token must have been consented with the gmail.send
// scope (see scripts/get-oauth-token.mjs). A service account cannot send Gmail without
// domain-wide delegation, so live Gmail = OAuth user-delegation only. The mail is sent AS
// the consenting user.
//
// Raw provider errors are re-typed CONNECTOR_ERROR (same boundary discipline as docsLive.ts /
// sheetsLive.ts) — no provider type leaks to clients. Returns { messageId } on success.
import type { OAuth2Client } from "google-auth-library";
import type { GmailConnector, HealthResult, Logger } from "../../shared/types/contracts.js";
import { connectorError } from "../../core/errors/appError.js";

const GMAIL_SEND_API = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// `client` is an OAuth user-delegation client (OAuth2Client). The connector only uses
// client.request()/getAccessToken(), so it is auth-construction agnostic.
export function createGmailConnectorLive(logger: Logger, client: OAuth2Client): GmailConnector {
  return {
    name: "google.gmail",
    async healthCheck(): Promise<HealthResult> {
      try {
        await client.getAccessToken();
        return { ok: true, detail: "live (oauth gmail.send)" };
      } catch (e) {
        return { ok: false, detail: `auth failed: ${String(e)}` };
      }
    },

    async sendEmail(input, idempotencyKey) {
      try {
        // Gmail's send accepts a base64url-encoded RFC 822 message in `raw`. A Gmail send is
        // not natively idempotent; process-level dedup is the runtime's idempotency store
        // (idempotencyKey threaded here for parity/logging with the simulated connector).
        const raw = toBase64Url(buildRfc822(input));
        const res = await client.request<{ id?: string }>({
          url: GMAIL_SEND_API,
          method: "POST",
          data: { raw },
        });
        const messageId = res.data?.id;
        if (!messageId) throw connectorError("Gmail send returned no message id");
        logger.info("connector.gmail.sendEmail (live)", { messageId, to: input.to, idempotencyKey });
        return { messageId };
      } catch (e) {
        logger.error("connector.gmail.sendEmail failed (live)", { err: String(e) });
        throw connectorError("Gmail send failed");
      }
    },
  };
}

// Minimal RFC 822 text/plain message. Subject is RFC 2047-encoded only when it carries
// non-ASCII (e.g. French accents); the UTF-8 body rides in the base64url envelope.
function buildRfc822(input: { to: string; subject: string; body: string }): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  // RFC 5322 wants CRLF line endings throughout. The body is composed with bare LF upstream,
  // so normalize it (a strict MTA can mangle a message that mixes CRLF headers with LF body).
  const body = input.body.replace(/\r\n|\r|\n/g, "\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// RFC 2047 encoded-word for non-ASCII header values (UTF-8 / base64). ASCII stays literal.
// A long non-ASCII subject is split into multiple encoded-words, each ≤75 chars, folded with
// CRLF + space (RFC 2047 §2/§5) — a single oversized encoded-word is illegal and some strict
// MTAs reject it. Chunking respects UTF-8 char boundaries (never splits a multi-byte char).
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // 39 bytes → 52 base64 chars; "=?UTF-8?B?…?=" = 64 ≤ 75, and even with the "Subject: "
  // label on the first line the physical line stays ≤ 78 (RFC 5322 recommended max).
  const MAX_BYTES = 39;
  const words: string[] = [];
  let chunk: Buffer = Buffer.alloc(0);
  for (const ch of value) {
    const b = Buffer.from(ch, "utf8");
    if (chunk.length > 0 && chunk.length + b.length > MAX_BYTES) {
      words.push(`=?UTF-8?B?${chunk.toString("base64")}?=`);
      chunk = Buffer.alloc(0);
    }
    chunk = Buffer.concat([chunk, b]);
  }
  if (chunk.length > 0) words.push(`=?UTF-8?B?${chunk.toString("base64")}?=`);
  return words.join("\r\n ");
}

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
