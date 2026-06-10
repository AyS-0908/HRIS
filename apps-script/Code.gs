// Code.gs — entry points: initializeHrisWorkspace(input) (§5 interface) plus the operator
// menu. Idempotent, non-destructive, safe to run multiple times, bound-first (§5 behavior).
//
// Boundary reminders (§1/§2): this layer never calls MCP tools, never sends emails, never
// publishes externally, never writes rows to rec_jobDesc/proc_state/proc_audit
// (headers-if-empty only), and never stores raw MCP API keys in cells.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("HRIS Setup")
    .addItem("Initialize / upgrade workspace…", "runInitFromMenu")
    .addItem("Show MCP registration payload", "showRegistrationPayload")
    .addToUi();
}

// §5 interface. input: { companyId, companyName, adminEmail?, spreadsheetId?, folderId?,
// serviceAccountEmail? } — see the spec for the output shape.
function initializeHrisWorkspace(input) {
  input = input || {};
  const warnings = [];

  const companyId = requireString_(input.companyId, "companyId");
  if (!/^[a-z0-9-_]+$/.test(companyId)) {
    throw new Error("companyId must match ^[a-z0-9-_]+$ (§7 validation)");
  }
  const companyName = requireString_(input.companyName, "companyName");
  const adminEmail = isBlank_(input.adminEmail)
    ? Session.getActiveUser().getEmail() // §5 default
    : String(input.adminEmail).trim();
  if (isBlank_(adminEmail)) {
    throw new Error("adminEmail is required (it could not be derived from the session)");
  }
  const serviceAccountEmail = isBlank_(input.serviceAccountEmail)
    ? getHrisProperty_("SERVICE_ACCOUNT_EMAIL")
    : String(input.serviceAccountEmail).trim();
  if (isBlank_(serviceAccountEmail)) {
    // §0 protection_model: still protect (operator-only) and tell the operator to re-run.
    pushWarning_(
      warnings,
      "serviceAccountEmail absent — protections list the operator only; re-run init with it before MCP go-live."
    );
  }

  // Spreadsheet: explicit input id (standalone/re-targeting, P0 reuse order) → bound
  // active spreadsheet (§0 bound-first) → create new.
  let ss = null;
  let createdSpreadsheet = false;
  if (!isBlank_(input.spreadsheetId)) ss = SpreadsheetApp.openById(String(input.spreadsheetId).trim());
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create("HRIS - " + companyName);
    createdSpreadsheet = true;
  }

  // Drive folder (input → DocumentProperties → create; legacy name reused as-is, §3).
  const folder = ensureHrisFolder_(input.folderId, companyName, warnings);
  if (createdSpreadsheet) moveFileToFolder_(ss.getId(), folder, warnings);

  // Service-account access FIRST (P0 §7 key_addendum): the spreadsheet share must exist
  // before the protections can list the service account as editor.
  if (!isBlank_(serviceAccountEmail)) {
    try {
      ss.addEditor(serviceAccountEmail);
    } catch (err) {
      pushWarning_(
        warnings,
        'could not share the spreadsheet with "' + serviceAccountEmail + '": ' + err + " — share it manually (P0)."
      );
    }
    shareFolderWithServiceAccount_(folder, serviceAccountEmail, warnings);
  }

  // Tabs (§5 tabs_in_scope: governance + transversal + MCP-owned + downstream).
  const tabs = ensureAllTabs_(ss, adminEmail, warnings);
  applyDropdownValidations_(ss);

  // Templates (§3), then the library seed rows pointing at them (§4 library.rule).
  const jdTemplate = ensureJobDescriptionTemplate_(folder, companyName, serviceAccountEmail, warnings);
  const formTemplate = ensureApplicationFormTemplate_(ss, folder, companyName, serviceAccountEmail, warnings);
  if (
    seedLibraryTemplates_(
      ss,
      [
        { libraryId: "tpl_job_description", title: jdTemplate.name, resourceRef: jdTemplate.id },
        { libraryId: "tpl_application_form", title: formTemplate.name, resourceRef: formTemplate.id },
      ],
      adminEmail,
      warnings
    ) &&
    tabs.tabsCreated.indexOf(TAB_LIBRARY) < 0 &&
    tabs.tabsUpdated.indexOf(TAB_LIBRARY) < 0
  ) {
    tabs.tabsUpdated.push(TAB_LIBRARY);
  }

  // Protections last: tabs exist and the service account already has file access (§0).
  applyAllProtections_(ss, effectiveOperatorEmail_(adminEmail), serviceAccountEmail, warnings);

  // Persist ids for idempotent reuse on the next run (P0 §7 key_addendum).
  saveWorkspaceProperties_({
    COMPANY_ID: companyId,
    COMPANY_NAME: companyName,
    FOLDER_ID: folder.getId(),
    JOB_DESCRIPTION_TEMPLATE_ID: jdTemplate.id,
    APPLICATION_FORM_TEMPLATE_ID: formTemplate.id,
    SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
  });

  const output = {
    companyId: companyId,
    companyName: companyName,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    jobDescriptionTemplateId: jdTemplate.id,
    jobDescriptionTemplateUrl: jdTemplate.url,
    applicationFormTemplateId: formTemplate.id,
    applicationFormTemplateUrl: formTemplate.url,
    tabsCreated: tabs.tabsCreated,
    tabsUpdated: tabs.tabsUpdated,
    warnings: warnings,
  };
  hrisLog_("initializeHrisWorkspace done", output);
  return output;
}

// Prompt-driven init for the operator (menu "HRIS Setup"). Cached values are offered as
// defaults so a re-run only needs Enter.
function runInitFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const companyId = promptValue_(ui, "Company id", 'Lowercase id, e.g. "acme" (allowed: a-z 0-9 - _).', getHrisProperty_("COMPANY_ID"));
  if (companyId === null) return;
  const companyName = promptValue_(ui, "Company name", 'Display name, e.g. "ACME SAS".', getHrisProperty_("COMPANY_NAME"));
  if (companyName === null) return;
  const adminEmail = promptValue_(ui, "Admin email", "First hr_admin in the Users tab.", Session.getActiveUser().getEmail());
  if (adminEmail === null) return;
  const serviceAccountEmail = promptValue_(
    ui,
    "Service account email (optional)",
    "MCP service-account email. Leave empty to set it later — protections will then list the operator only.",
    getHrisProperty_("SERVICE_ACCOUNT_EMAIL")
  );
  if (serviceAccountEmail === null) return;

  const output = initializeHrisWorkspace({
    companyId: companyId,
    companyName: companyName,
    adminEmail: adminEmail,
    serviceAccountEmail: serviceAccountEmail,
  });

  showTextDialog_("HRIS workspace initialized", [
    {
      title:
        "Summary — created: [" + output.tabsCreated.join(", ") + "] · updated: [" + output.tabsUpdated.join(", ") + "]",
      text: output.warnings.length ? "WARNINGS:\n- " + output.warnings.join("\n- ") : "No warnings.",
      rows: 6,
    },
    { title: "Full output (JSON)", text: JSON.stringify(output, null, 2), rows: 12 },
    { title: "MCP registration payload (YAML, spec §6)", text: registrationPayloadYaml_(), rows: 12 },
  ]);
}

// null = operator cancelled; empty answer falls back to the offered default.
function promptValue_(ui, title, help, defaultValue) {
  const message = help + (isBlank_(defaultValue) ? "" : '\n\nLeave empty to keep: "' + defaultValue + '"');
  const response = ui.prompt("HRIS Setup — " + title, message, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const text = response.getResponseText().trim();
  return text !== "" ? text : isBlank_(defaultValue) ? "" : defaultValue;
}

// Protections name the user actually running init; adminEmail is the fallback when the
// session email is unavailable (some auth modes return "").
function effectiveOperatorEmail_(adminEmail) {
  const sessionEmail = Session.getEffectiveUser().getEmail();
  return isBlank_(sessionEmail) ? adminEmail : sessionEmail;
}
