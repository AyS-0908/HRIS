// Protection.gs — FULL protection model (§0 protection_model): technical tabs
// (rec_jobDesc, proc_state, proc_audit) are sheet-protected and the Users key columns
// (mcpKeyHash, mcpKeyStatus, mcpKeyCreatedAt) are range-protected.
//
// P0 (§7 key_addendum service_account_access): every protection's editor list is
// [effective operator, serviceAccountEmail]. MCP writes as the service account — a
// protection that omits it silently breaks MCP writes. When the service-account email is
// missing at init, tabs are protected operator-only and a warning tells the operator to
// re-run init with it before MCP go-live.

function applyAllProtections_(ss, operatorEmail, serviceAccountEmail, warnings) {
  const editors = [operatorEmail];
  if (!isBlank_(serviceAccountEmail)) editors.push(serviceAccountEmail);

  PROTECTED_TECHNICAL_TABS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      pushWarning_(warnings, 'technical tab "' + name + '" not found — protection skipped.');
      return;
    }
    protectWholeSheet_(sheet, editors, warnings);
  });

  protectUsersKeyColumns_(ss, editors, warnings);
}

// Idempotent: reuses the existing sheet protection instead of stacking a new one per run.
function protectWholeSheet_(sheet, editors, warnings) {
  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const protection = existing.length ? existing[0] : sheet.protect();
  protection.setDescription(
    'HRIS technical tab "' + sheet.getName() + '" — MCP-owned; editors: operator + service account'
  );
  setProtectionEditors_(protection, editors, warnings);
}

function protectUsersKeyColumns_(ss, editors, warnings) {
  const sheet = ss.getSheetByName(TAB_USERS);
  if (!sheet) {
    pushWarning_(warnings, "Users tab not found — key-column protections skipped.");
    return;
  }
  const header = readHeaderRow_(sheet);
  const rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);

  USERS_PROTECTED_COLUMNS.forEach(function (colName) {
    const idx = header.indexOf(colName);
    if (idx < 0) {
      pushWarning_(warnings, 'Users column "' + colName + '" not found — its protection was skipped.');
      return;
    }
    const description = 'HRIS protected Users column "' + colName + '" — managed by MCP helper scripts';
    const columnRange = sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1);
    let protection = null;
    for (let i = 0; i < rangeProtections.length; i++) {
      if (rangeProtections[i].getDescription() === description) {
        protection = rangeProtections[i];
        break;
      }
    }
    if (protection) protection.setRange(columnRange); // re-anchor by header text, never fixed index (§7)
    else protection = columnRange.protect().setDescription(description);
    setProtectionEditors_(protection, editors, warnings);
  });
}

// Editor list becomes exactly [operator, service account]: domain edit off, stale editors
// removed, wanted ones added. The protection owner keeps implicit edit rights (Sheets
// behavior); addEditor failures surface as warnings instead of aborting init.
function setProtectionEditors_(protection, editors, warnings) {
  try {
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (err) {
    // consumer accounts have no domain — ignore
  }
  const wanted = editors.filter(function (e) {
    return !isBlank_(e);
  });
  const current = protection.getEditors().map(function (user) {
    return user.getEmail();
  });
  const stale = current.filter(function (email) {
    return !isBlank_(email) && wanted.indexOf(email) < 0;
  });
  if (stale.length) {
    try {
      protection.removeEditors(stale);
    } catch (err) {
      pushWarning_(warnings, "could not remove stale protection editors [" + stale.join(", ") + "]: " + err);
    }
  }
  wanted.forEach(function (email) {
    try {
      protection.addEditor(email);
    } catch (err) {
      pushWarning_(
        warnings,
        'could not add "' + email + '" as protection editor (' + err + ") — share the spreadsheet " +
          "with this account and re-run init. Without the service account here, MCP writes BREAK (P0)."
      );
    }
  });
}
