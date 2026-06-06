// Unit test for the live Gmail connector (T1). Mocks the OAuth client's request() so we can
// assert the RFC822/base64url envelope and the error mapping — without a live Gmail account.
import { describe, it, expect } from "vitest";
import type { OAuth2Client } from "google-auth-library";
import { createGmailConnectorLive } from "../../src/connectors/google/gmailLive.js";
import { AppError } from "../../src/core/errors/appError.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

type RequestConfig = Parameters<OAuth2Client["request"]>[0];
function fakeClient(request: (cfg: RequestConfig) => Promise<{ data: unknown }>): OAuth2Client {
  return {
    request,
    getAccessToken: async () => ({ token: "tok" }),
  } as unknown as OAuth2Client;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "<no-throw>";
  } catch (e) {
    return e instanceof AppError ? e.code : "<non-app-error>";
  }
}

describe("gmailLive connector", () => {
  it("builds a base64url RFC822 message and posts to users.messages.send", async () => {
    let captured: RequestConfig | undefined;
    const client = fakeClient(async (cfg) => {
      captured = cfg;
      return { data: { id: "m123" } };
    });
    const gmail = createGmailConnectorLive(noopLogger, client);

    const res = await gmail.sendEmail(
      { to: "hr@acme.test", subject: "Fiche de poste à publier : Élève", body: "Bonjour à toi" },
      "idem-1",
    );

    expect(res.messageId).toBe("m123");
    expect(String(captured!.url)).toContain("/gmail/v1/users/me/messages/send");
    expect(captured!.method).toBe("POST");

    const raw = (captured!.data as { raw: string }).raw;
    expect(raw).not.toMatch(/[+/=]/); // base64url alphabet only (no +, /, padding)
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("To: hr@acme.test");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Bonjour à toi");
    // Non-ASCII subject is RFC 2047-encoded (UTF-8 / base64 encoded-word).
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("leaves an ASCII subject literal", async () => {
    let captured: RequestConfig | undefined;
    const gmail = createGmailConnectorLive(noopLogger, fakeClient(async (cfg) => {
      captured = cfg;
      return { data: { id: "m1" } };
    }));
    await gmail.sendEmail({ to: "a@b.c", subject: "Plain Subject", body: "x" }, "k");
    const raw = (captured!.data as { raw: string }).raw;
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("Subject: Plain Subject");
  });

  it("folds a long non-ASCII subject into encoded-words each ≤75 chars and CRLFs the body", async () => {
    let captured: RequestConfig | undefined;
    const gmail = createGmailConnectorLive(noopLogger, fakeClient(async (cfg) => {
      captured = cfg;
      return { data: { id: "m1" } };
    }));
    await gmail.sendEmail(
      {
        to: "hr@acme.test",
        subject: "Fiche de poste à publier : Responsable des Opérations et de la Coordination Générale",
        body: "Ligne 1\nLigne 2 accentuée à\nLigne 3",
      },
      "k",
    );
    const raw = (captured!.data as { raw: string }).raw;
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const subjectBlock = decoded.slice(decoded.indexOf("Subject:"), decoded.indexOf("\r\nMIME-Version"));
    // Every physical line of the (folded) Subject header stays within the 76-char RFC limit.
    for (const line of subjectBlock.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    // At least one continuation line ⇒ the long subject was actually folded.
    expect(subjectBlock).toMatch(/\r\n =\?UTF-8\?B\?/);
    // Body line endings are normalized to CRLF (no bare LF survives).
    const bodyPart = decoded.slice(decoded.indexOf("\r\n\r\n") + 4);
    expect(bodyPart).not.toMatch(/[^\r]\n/);
    expect(bodyPart).toContain("Ligne 2 accentuée à");
  });

  it("maps a provider error to CONNECTOR_ERROR (no provider leak)", async () => {
    const gmail = createGmailConnectorLive(noopLogger, fakeClient(async () => {
      throw new Error("403 insufficientPermissions");
    }));
    expect(await codeOf(gmail.sendEmail({ to: "x@y.z", subject: "s", body: "b" }, "k"))).toBe("CONNECTOR_ERROR");
  });

  it("treats a missing message id as CONNECTOR_ERROR", async () => {
    const gmail = createGmailConnectorLive(noopLogger, fakeClient(async () => ({ data: {} })));
    expect(await codeOf(gmail.sendEmail({ to: "x@y.z", subject: "s", body: "b" }, "k"))).toBe("CONNECTOR_ERROR");
  });

  it("health check is ok when an access token can be obtained", async () => {
    const gmail = createGmailConnectorLive(noopLogger, fakeClient(async () => ({ data: {} })));
    expect((await gmail.healthCheck()).ok).toBe(true);
  });
});
