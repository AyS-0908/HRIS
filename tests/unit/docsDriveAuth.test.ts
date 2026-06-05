// Unit tests for the two Docs/Drive auth modes (both yield an OAuth2Client the connector
// can use): service account (default, Shared Drive path) and OAuth user-delegation (the
// personal-Gmail path where the user owns the created Doc).
import { describe, it, expect } from "vitest";
import { createDocsDriveJwt, createDocsDriveOAuthClient } from "../../src/connectors/google/auth.js";

const FAKE_SA = JSON.stringify({
  client_email: "svc@example.iam.gserviceaccount.com",
  private_key: "fake-key",
});

describe("Docs/Drive auth modes", () => {
  it("service-account mode labels itself with the client_email", () => {
    const { client, detail } = createDocsDriveJwt(FAKE_SA);
    expect(detail).toContain("svc@example.iam.gserviceaccount.com");
    expect(typeof client.request).toBe("function");
  });

  it("oauth mode sets the refresh token and labels itself as delegation", () => {
    const { client, detail } = createDocsDriveOAuthClient({
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "secret",
      refreshToken: "refresh-123",
    });
    expect(detail).toBe("oauth user-delegation");
    expect(client.credentials.refresh_token).toBe("refresh-123");
    expect(typeof client.request).toBe("function");
  });

  it("malformed service-account JSON throws", () => {
    expect(() => createDocsDriveJwt("not json")).toThrow();
  });
});
