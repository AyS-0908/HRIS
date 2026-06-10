// Properties.gs — DocumentProperties cache for idempotent resource reuse (spec §7
// key_addendum idempotent_resource_reuse, P0). Reuse order is: explicit input IDs →
// these cached IDs → create new. Raw MCP API keys are NEVER stored in Sheet cells; if a
// future registration flow returns one, DocumentProperties is the only allowed store (§6).

const HRIS_PROPERTY_KEYS = [
  "COMPANY_ID",
  "COMPANY_NAME",
  "FOLDER_ID",
  "JOB_DESCRIPTION_TEMPLATE_ID",
  "APPLICATION_FORM_TEMPLATE_ID",
  "SERVICE_ACCOUNT_EMAIL",
];

// Bound-first (§0): DocumentProperties exist when the script is bound to the spreadsheet.
// ScriptProperties is the fallback for the standalone/re-targeting mode, where
// getDocumentProperties() returns null.
function hrisProps_() {
  return PropertiesService.getDocumentProperties() || PropertiesService.getScriptProperties();
}

function getHrisProperty_(key) {
  return hrisProps_().getProperty(key) || "";
}

function saveWorkspaceProperties_(values) {
  const store = hrisProps_();
  HRIS_PROPERTY_KEYS.forEach(function (key) {
    if (!isBlank_(values[key])) store.setProperty(key, String(values[key]).trim());
  });
}
