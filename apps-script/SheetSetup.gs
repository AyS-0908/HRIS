// SheetSetup.gs — idempotent tab setup, mirroring scripts/setup-company-sheet.ts in the
// MCP repo: create-if-missing → header-if-row1-empty → seed-if-empty →
// warn-on-mismatch-never-overwrite. Non-destructive by construction (§2 hard rules):
// never deletes tabs/rows, never renames/reorders columns, appends missing columns at the
// END only, detects tabs by name and columns by header text (§7 sheet_operations).

function ensureAllTabs_(ss, adminEmail, warnings) {
  const tabsCreated = [];
  const tabsUpdated = [];
  function markUpdated(name) {
    if (tabsCreated.indexOf(name) < 0 && tabsUpdated.indexOf(name) < 0) tabsUpdated.push(name);
  }

  hrisTabSpecs_().forEach(function (spec) {
    const result = ensureTab_(ss, spec, warnings);
    if (result.created) tabsCreated.push(spec.name);
    else if (result.updated) markUpdated(spec.name);
  });

  if (ensureConfigKeys_(ss)) markUpdated(TAB_CONFIG);
  if (ensureUsersAdminSeed_(ss, adminEmail)) markUpdated(TAB_USERS);
  checkForbiddenEmployeeColumns_(ss, warnings);

  return { tabsCreated: tabsCreated, tabsUpdated: tabsUpdated };
}

function ensureTab_(ss, spec, warnings) {
  let sheet = ss.getSheetByName(spec.name);
  let created = false;
  let updated = false;
  if (!sheet) {
    sheet = ss.insertSheet(spec.name);
    created = true;
    sheet.setFrozenRows(1); // §7: freeze row 1 on every created tab
  }

  const current = readHeaderRow_(sheet);
  if (current.length === 0) {
    sheet.getRange(1, 1, 1, spec.header.length).setValues([spec.header]);
    if (!created) {
      updated = true;
      if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
    }
  } else if (headerHasPrefix_(current, spec.header)) {
    // header OK (extra trailing operator columns are tolerated, as in setup-company-sheet)
  } else if (headerHasPrefix_(spec.header, current)) {
    // existing header is a strict prefix of the expected one → append the missing
    // columns at the END only (§2). Example: old 2-column Users → 5-column schema.
    const missing = spec.header.slice(current.length);
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    updated = true;
  } else {
    pushWarning_(
      warnings,
      'tab "' + spec.name + '" header differs from the spec — left intact (never overwritten). ' +
        "Expected: [" + spec.header.join(", ") + "]. Found: [" + current.join(", ") + "]."
    );
  }
  return { created: created, updated: updated };
}

function readHeaderRow_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  const row = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (v) {
      return String(v).trim();
    });
  while (row.length && row[row.length - 1] === "") row.pop();
  return row;
}

// true when `prefix` matches `row` cell-by-cell over the whole prefix length.
function headerHasPrefix_(row, prefix) {
  if (row.length < prefix.length) return false;
  return prefix.every(function (h, i) {
    return row[i] === h;
  });
}

// §4 Config.rule + §2: seed default keys only when absent — existing values are never
// touched, unknown operator-added keys are ignored. Returns true when a key was added.
function ensureConfigKeys_(ss) {
  const sheet = ss.getSheetByName(TAB_CONFIG);
  if (!sheet) return false;
  const lastRow = sheet.getLastRow();
  const existing = {};
  if (lastRow >= 2) {
    sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .forEach(function (r) {
        existing[String(r[0]).trim()] = true;
      });
  }
  let added = false;
  CONFIG_SEED.forEach(function (pair) {
    if (!existing[pair[0]]) {
      sheet.appendRow(pair);
      added = true;
    }
  });
  return added;
}

// §2: seed the first admin in Users only when absent (no data rows yet). Existing Users
// data is never modified — one email = one role stays an operator decision.
function ensureUsersAdminSeed_(ss, adminEmail) {
  const sheet = ss.getSheetByName(TAB_USERS);
  if (!sheet || sheet.getLastRow() > 1) return false;
  sheet.appendRow([adminEmail, "hr_admin", "", "", ""]);
  return true;
}

function checkForbiddenEmployeeColumns_(ss, warnings) {
  const sheet = ss.getSheetByName(TAB_EMPLOYEES);
  if (!sheet) return;
  const header = readHeaderRow_(sheet);
  const found = header.filter(function (h) {
    return EMPLOYEES_FORBIDDEN_COLUMNS.indexOf(h) >= 0;
  });
  if (found.length) {
    pushWarning_(
      warnings,
      'employees tab contains forbidden column(s) [' + found.join(", ") + "] — remove them " +
        "manually (data minimization, spec §4 employees.rule; init never deletes columns)."
    );
  }
}

// §7 sheet_operations: warning-style dropdowns on known role/status columns. Columns are
// located by header text; allowInvalid stays true because the company YAML / MCP config is
// the authoritative value set (e.g. extra roles).
function applyDropdownValidations_(ss) {
  setColumnDropdown_(ss, TAB_USERS, "role", USERS_ROLES);
  setColumnDropdown_(ss, TAB_APPLICATIONS, "status", APPLICATION_STATUSES);
  setColumnDropdown_(ss, TAB_EMPLOYEES, "status", EMPLOYEE_STATUSES);
  setColumnDropdown_(ss, TAB_LIBRARY, "ai_usage", LIBRARY_AI_USAGE);
}

function setColumnDropdown_(ss, tabName, headerName, values) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  const col = readHeaderRow_(sheet).indexOf(headerName) + 1;
  if (col === 0 || sheet.getMaxRows() < 2) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

// §4 library.rule: seed one row per created template (type=template, domain=recruitment,
// ai_usage=autofill). Idempotent by resource_ref — re-runs never duplicate rows.
function seedLibraryTemplates_(ss, templates, adminEmail, warnings) {
  const sheet = ss.getSheetByName(TAB_LIBRARY);
  if (!sheet) return false;
  const header = readHeaderRow_(sheet);
  const refCol = header.indexOf("resource_ref");
  if (refCol < 0) {
    pushWarning_(warnings, 'library tab has no "resource_ref" column — template rows not seeded.');
    return false;
  }
  const lastRow = sheet.getLastRow();
  const existingRefs = {};
  if (lastRow >= 2) {
    sheet
      .getRange(2, refCol + 1, lastRow - 1, 1)
      .getValues()
      .forEach(function (r) {
        existingRefs[String(r[0]).trim()] = true;
      });
  }
  let added = false;
  templates.forEach(function (t) {
    if (existingRefs[t.resourceRef]) return;
    const byName = {
      library_id: t.libraryId,
      title: t.title,
      type: "template",
      domain: "recruitment",
      resource_ref: t.resourceRef,
      owner_email: adminEmail,
      ai_usage: "autofill",
      country_scope: "ALL",
      version: "1",
      valid_from: nowIso_(),
      created_at: nowIso_(),
      updated_at: nowIso_(),
    };
    // row built by header text so operator-reordered/extended headers still land right
    sheet.appendRow(
      header.map(function (h) {
        return byName[h] !== undefined ? byName[h] : "";
      })
    );
    added = true;
  });
  return added;
}
