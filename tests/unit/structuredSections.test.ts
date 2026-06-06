// Unit tests for the deterministic structured-section path (plan P1.2 "hybride borné").
// Drives generate_job_description's handler directly with a stubbed ServiceDeps so we can
// (a) toggle the requireStructuredSections policy via the Config tab and (b) capture exactly
// what the Docs connector receives — without a live Sheet or Doc.
import { describe, it, expect, beforeEach } from "vitest";
import type { ServiceDeps } from "../../src/shared/types/contracts.js";
import { recruitmentModule } from "../../src/modules/hr/recruitment/index.js";
import { __clearRecruitmentPolicyCache } from "../../src/modules/hr/recruitment/policy.js";
import { AppError } from "../../src/core/errors/appError.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

const generateTool = recruitmentModule.tools.find((t) => t.name === "generate_job_description")!;

type DocsInput = Parameters<ServiceDeps["connectors"]["docs"]["createDocument"]>[0];
interface Captured {
  input?: DocsInput;
}

function deps(companyId: string, policyRows: string[][], captured: Captured): ServiceDeps {
  return {
    connectors: {
      docs: {
        async createDocument(input: DocsInput) {
          captured.input = input;
          return { docId: "doc_test", url: "https://docs.google.com/document/d/doc_test/edit" };
        },
      },
      sheets: {
        async getValues() {
          return { values: policyRows };
        },
      },
    },
    logger: noopLogger,
    recordExternal: () => {},
    idempotencyKey: "k",
    ctx: { companyId, actorId: "u1", actorRole: "manager", apiKeyId: "k" },
    resources: { googleSheets: { hrRecruitmentSheetId: "sheet-1" } },
    googleMode: "simulated",
  } as unknown as ServiceDeps;
}

const ctx = { companyId: "c", actorId: "u1", actorRole: "manager", apiKeyId: "k" };

beforeEach(() => __clearRecruitmentPolicyCache());

describe("generate_job_description structured sections", () => {
  it("assembles sections into the doc (headings + named placeholders + real summary)", async () => {
    const captured: Captured = {};
    const res = await generateTool.handler(
      ctx,
      {
        processInstanceId: "p1",
        idempotencyKey: "k",
        targetSummary: "Owns the API",
        mission: "Build the platform",
        responsibilities: "Ship features",
        profile: "Senior engineer",
        context: "Growing team",
      },
      deps("c1", [], captured),
    );
    expect(res.status).toBe("success");
    const sent = captured.input!;
    // {{SUMMARY}} is the real summary, not the title (the prior bug).
    expect(sent.summary).toBe("Owns the API");
    // Named placeholders are filled for precise template placement.
    expect(sent.sections).toMatchObject({
      MISSION: "Build the platform",
      RESPONSIBILITIES: "Ship features",
      PROFILE: "Senior engineer",
      CONTEXT: "Growing team",
    });
    // The composed body renders sections under fixed headings in fixed order.
    expect(sent.content.indexOf("Mission")).toBeLessThan(sent.content.indexOf("Responsabilités"));
    expect(sent.content).toContain("Build the platform");
  });

  it("enforces requireStructuredSections: missing sections ⇒ VALIDATION_ERROR", async () => {
    const captured: Captured = {};
    let code = "<none>";
    try {
      await generateTool.handler(
        ctx,
        { processInstanceId: "p1", idempotencyKey: "k", targetSummary: "x", mission: "only mission" },
        deps("c2", [["requireStructuredSections", "true"]], captured),
      );
    } catch (e) {
      code = e instanceof AppError ? e.code : "<non-app>";
    }
    expect(code).toBe("VALIDATION_ERROR");
    expect(captured.input).toBeUndefined(); // failed before any doc creation
  });

  it("falls back to legacy draftBody when no sections are supplied", async () => {
    const captured: Captured = {};
    await generateTool.handler(
      ctx,
      { processInstanceId: "p1", idempotencyKey: "k", targetSummary: "x", draftBody: "legacy body" },
      deps("c3", [], captured),
    );
    expect(captured.input!.content).toBe("legacy body");
    expect(captured.input!.sections).toEqual({});
  });
});
