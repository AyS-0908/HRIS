// Config.gs — every locked constant for the HRIS workspace setup, in one place.
// Source of truth: docs/hris_appscript_spec_final.txt (§0 locked decisions, §3 resources,
// §4 tab contract, §7 addenda). Do not re-decide anything here — change the spec first.
//
// Plain V8 Apps Script: all .gs files share one global scope; these constants and the
// underscore-suffixed helpers are visible from every file.

// ---------- Tab names (§0 tab_naming: shared unprefixed, module rec_*, legacy exceptions) ----------
const TAB_CONFIG = "Config";
const TAB_USERS = "Users";
const TAB_EMPLOYEES = "employees";
const TAB_LIBRARY = "library";
const TAB_REC_JOBDESC = "rec_jobDesc";
const TAB_PROC_STATE = "proc_state";
const TAB_PROC_AUDIT = "proc_audit";
const TAB_REC_PUBLICATIONS = "rec_publications";
const TAB_APPLICATIONS = "Applications"; // legacy spec-locked unprefixed name (§0)
const TAB_ACTIVITIES = "Activities"; // legacy spec-locked unprefixed name (§0)
const TAB_FORM_RESPONSES_RAW = "form_responses_raw"; // owned by Google Forms (§4)

// ---------- Governance tab headers (§4) ----------
const CONFIG_HEADER = ["key", "value"];
const USERS_HEADER = ["email", "role", "mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"];

// MCP-to-Apps-Script handoff tab. Apps Script NEVER changes this header, never adds
// columns, never writes rows — MCP is the only writer (§2 hard rules).
const REC_JOBDESC_HEADER = ["id", "titre", "mgr", "url", "status"];

// KEEP IN SYNC with SHEETS_STORAGE_HEADERS in src/storage/sheetsStorageAdapter.ts (MCP
// repo). The MCP StorageAdapter serializes exactly these columns; Apps Script only mirrors
// them to write the header on an EMPTY tab — it never edits or appends rows (§4
// apps_script_rule). If the MCP side changes, change both files in the same change.
const PROC_STATE_HEADER = [
  "processInstanceId",
  "processId",
  "companyId",
  "currentStatus",
  "currentStep",
  "createdBy",
  "createdAt",
  "updatedAt",
  "lastToolCalled",
  "externalReferences",
  "auditLogId",
];
const PROC_AUDIT_HEADER = [
  "auditLogId",
  "timestamp",
  "companyId",
  "processId",
  "processInstanceId",
  "toolName",
  "actorRole",
  "actorId",
  "inputSummary",
  "externalOutputs",
  "statusBefore",
  "statusAfter",
  "result",
  "errorCode",
];

// ---------- Transversal tab headers (§0 transversal_tabs, §4) ----------
const EMPLOYEES_HEADER = [
  "employee_id",
  "first_name",
  "last_name",
  "work_email",
  "manager_email",
  "department",
  "job_title",
  "employment_type",
  "start_date",
  "status",
  "location_country",
  "created_at",
  "updated_at",
];
const LIBRARY_HEADER = [
  "library_id",
  "title",
  "type",
  "domain",
  "resource_ref",
  "owner_email",
  "ai_usage",
  "ai_usage_notes",
  "country_scope",
  "language",
  "version",
  "valid_from",
  "valid_until",
  "created_at",
  "updated_at",
];

// ---------- Downstream Apps-Script-owned tab headers (§4) ----------
const REC_PUBLICATIONS_HEADER = [
  "publication_id",
  "job_process_id",
  "channel",
  "owner_email",
  "deadline",
  "message_draft",
  "validation_status",
  "reviewer_comment",
  "external_url",
  "updated_at",
];
const APPLICATIONS_HEADER = [
  "application_id",
  "job_process_id",
  "source_response_id",
  "candidate_first_name",
  "candidate_last_name",
  "candidate_email",
  "candidate_phone",
  "cv_file_url",
  "source",
  "status",
  "owner_email",
  "next_step",
  "last_comment",
  "created_at",
  "updated_at",
  "closed_at",
];
const ACTIVITIES_HEADER = [
  "activity_id",
  "application_id",
  "job_process_id",
  "activity_type",
  "title",
  "status",
  "owner_email",
  "external_id",
  "external_url",
  "created_by",
  "created_at",
  "metadata_json",
];

// ---------- Seeds (§4: Config keys seeded only when absent) ----------
const CONFIG_SEED = [
  ["requireJustification", "false"],
  ["requireProofDoc", "false"],
  ["extraValidationStep", "false"],
  ["requireStructuredSections", "false"],
  ["hrNotifyEmail", ""],
];

// ---------- Dropdown validations (§7 sheet_operations, warning-style) ----------
// Advisory lists: the company YAML / MCP config stays authoritative for roles, so the
// validations allow other values (setAllowInvalid(true)) and only guide the HR user.
const USERS_ROLES = ["hr_admin", "manager", "employee", "admin_user"];
const APPLICATION_STATUSES = ["new", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];
const EMPLOYEE_STATUSES = ["onboarding", "active", "on_leave", "offboarded"];
const LIBRARY_AI_USAGE = ["autofill", "reference_only", "forbidden"];

// ---------- Protections (§0 protection_model, §4) ----------
const PROTECTED_TECHNICAL_TABS = [TAB_REC_JOBDESC, TAB_PROC_STATE, TAB_PROC_AUDIT];
const USERS_PROTECTED_COLUMNS = ["mcpKeyHash", "mcpKeyStatus", "mcpKeyCreatedAt"];

// ---------- Forbidden fields (§2 must_not, §3 forbidden_questions, §4 employees.rule) ----------
const EMPLOYEES_FORBIDDEN_COLUMNS = [
  "age",
  "birth_date",
  "health",
  "religion",
  "family_status",
  "photo",
  "salary_history",
  "personal_id_number",
];
const FORM_FORBIDDEN_QUESTIONS = [
  "age",
  "birth_date",
  "health",
  "family_status",
  "photo",
  "salary_history",
  "personality_score",
  "fit_score",
];

// ---------- Templates (§3) ----------
const JD_PLACEHOLDERS = [
  "{{TITLE}}",
  "{{SUMMARY}}",
  "{{BODY}}",
  "{{MISSION}}",
  "{{RESPONSIBILITIES}}",
  "{{PROFILE}}",
  "{{CONTEXT}}",
];

// Question titles double as the normalization keys the Stage 2 downstream workflow will
// read from form_responses_raw — keep them stable once the template is in use.
// cv_upload is required by §3 but FormApp/Forms API cannot CREATE file-upload items: the
// operator adds it once by hand and init verifies it (see ensureFormQuestions_).
const FORM_CV_QUESTION_TITLE = "CV (PDF)";
const APPLICATION_FORM_QUESTIONS = [
  { key: "candidate_first_name", title: "First name", required: true },
  { key: "candidate_last_name", title: "Last name", required: true },
  { key: "candidate_email", title: "Email", required: true, validation: "email" },
  { key: "candidate_phone", title: "Phone", required: false },
  { key: "source", title: "How did you hear about this job?", required: false },
  { key: "years_of_experience", title: "Years of experience", required: false, validation: "number" },
];

// ---------- Tab contract used by SheetSetup.gs (§5 tabs_in_scope) ----------
function hrisTabSpecs_() {
  return [
    // governance
    { name: TAB_CONFIG, header: CONFIG_HEADER },
    { name: TAB_USERS, header: USERS_HEADER },
    // transversal (created at init; module logic later — §0)
    { name: TAB_EMPLOYEES, header: EMPLOYEES_HEADER },
    { name: TAB_LIBRARY, header: LIBRARY_HEADER },
    // MCP-owned (headers-if-empty only, never rows)
    { name: TAB_REC_JOBDESC, header: REC_JOBDESC_HEADER },
    { name: TAB_PROC_STATE, header: PROC_STATE_HEADER },
    { name: TAB_PROC_AUDIT, header: PROC_AUDIT_HEADER },
    // downstream Apps-Script-owned (recruitment module)
    { name: TAB_REC_PUBLICATIONS, header: REC_PUBLICATIONS_HEADER },
    { name: TAB_APPLICATIONS, header: APPLICATIONS_HEADER },
    { name: TAB_ACTIVITIES, header: ACTIVITIES_HEADER },
  ];
}
