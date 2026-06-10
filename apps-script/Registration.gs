// Registration.gs — MCP registration payload (§6): DISPLAY/COPY ONLY in Stage 1. No HTTP
// call, no backend dynamic tenant loading (§6 backend_registration); the optional POST
// /api/register flow (§7) is implemented only if/when that endpoint exists, in a later
// stage. The manifest deliberately omits script.external_request.

function buildRegistrationPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("run this from the bound spreadsheet (Extensions → Apps Script).");
  return {
    company: {
      id: getHrisProperty_("COMPANY_ID"),
      name: getHrisProperty_("COMPANY_NAME"),
    },
    resources: {
      googleSheets: { hrRecruitmentSheetId: ss.getId() },
      googleDrive: { hrKnowledgeFolderId: getHrisProperty_("FOLDER_ID") },
      googleDocs: { jobDescriptionTemplateId: getHrisProperty_("JOB_DESCRIPTION_TEMPLATE_ID") },
    },
    // Apps-Script-only resource (§6 rule): NOT part of the MCP company config — do not add
    // googleForms to the MCP registration unless the backend config schema is extended first.
    future_apps_script_only_resources: {
      googleForms: { applicationFormTemplateId: getHrisProperty_("APPLICATION_FORM_TEMPLATE_ID") },
    },
  };
}

// YAML rendering matching §6 so the operator can paste straight into onboarding notes /
// the company config workflow.
function registrationPayloadYaml_() {
  const p = buildRegistrationPayload();
  return [
    "company:",
    '  id: "' + p.company.id + '"',
    '  name: "' + p.company.name + '"',
    "",
    "resources:",
    "  googleSheets:",
    '    hrRecruitmentSheetId: "' + p.resources.googleSheets.hrRecruitmentSheetId + '"',
    "  googleDrive:",
    '    hrKnowledgeFolderId: "' + p.resources.googleDrive.hrKnowledgeFolderId + '"',
    "  googleDocs:",
    '    jobDescriptionTemplateId: "' + p.resources.googleDocs.jobDescriptionTemplateId + '"',
    "",
    "future_apps_script_only_resources:",
    "  googleForms:",
    '    applicationFormTemplateId: "' +
      p.future_apps_script_only_resources.googleForms.applicationFormTemplateId +
      '"',
  ].join("\n");
}

// Menu entry: shows the payload for copy (HtmlService dialog; alerts truncate).
function showRegistrationPayload() {
  showTextDialog_("MCP registration payload", [
    { title: "YAML (spec §6)", text: registrationPayloadYaml_(), rows: 14 },
    { title: "JSON", text: JSON.stringify(buildRegistrationPayload(), null, 2), rows: 12 },
  ]);
}
