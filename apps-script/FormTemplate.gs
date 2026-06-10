// FormTemplate.gs — Application Form template (§3): one template per company, copied once
// per approved job later (Stage 2). Per-job questions are injected into the COPY at copy
// time, never into this template. Responses are linked to the company spreadsheet and the
// raw tab is renamed form_responses_raw (§7 application_form_template).

function ensureApplicationFormTemplate_(ss, folder, companyName, serviceAccountEmail, warnings) {
  const name = "Application Form Template - " + companyName;
  const cachedId = getHrisProperty_("APPLICATION_FORM_TEMPLATE_ID");

  let form = null;
  if (!isBlank_(cachedId)) {
    try {
      form = FormApp.openById(cachedId);
    } catch (err) {
      pushWarning_(warnings, "cached form template " + cachedId + " is not accessible (" + err + ") — creating a new one.");
    }
  }
  if (!form) {
    form = FormApp.create(name);
    form.setDescription(
      "HRIS application form template — copied once per approved job; per-job questions are added to the copy, never here."
    );
  }

  ensureFormQuestions_(form, warnings);
  checkForbiddenFormQuestions_(form, warnings);
  ensureFormDestination_(form, ss, warnings);
  moveFileToFolder_(form.getId(), folder, warnings);
  if (!isBlank_(serviceAccountEmail)) {
    shareFileWithServiceAccount_(form.getId(), serviceAccountEmail, "application form template", warnings);
  }
  return { id: form.getId(), url: form.getEditUrl(), name: form.getTitle() };
}

// Adds the §3 required/optional questions that are missing (matched by title, the Stage 2
// normalization key). cv_upload is REQUIRED by §0/§3 but neither FormApp nor the Forms API
// can CREATE file-upload items — the operator adds "CV (PDF)" once by hand; init verifies
// its presence (by item type) and warns until it exists.
function ensureFormQuestions_(form, warnings) {
  const existingTitles = {};
  form.getItems().forEach(function (item) {
    existingTitles[item.getTitle()] = true;
  });

  APPLICATION_FORM_QUESTIONS.forEach(function (q) {
    if (existingTitles[q.title]) return;
    const item = form.addTextItem().setTitle(q.title).setRequired(q.required === true);
    if (q.validation === "email") {
      item.setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
    } else if (q.validation === "number") {
      item.setValidation(FormApp.createTextValidation().requireNumber().build());
    }
  });

  if (form.getItems(FormApp.ItemType.FILE_UPLOAD).length === 0) {
    pushWarning_(
      warnings,
      'form template is missing the REQUIRED file-upload question "' + FORM_CV_QUESTION_TITLE + '" — add it ' +
        "manually in the Form editor (Apps Script cannot create file-upload questions), then re-run init " +
        "to clear this warning. See apps-script/README.md."
    );
  }
}

// Guard, not a filter: exact match on normalized titles against §3 forbidden_questions.
// Init never deletes questions, so a hit is a warning for the operator.
function checkForbiddenFormQuestions_(form, warnings) {
  const found = [];
  form.getItems().forEach(function (item) {
    const normalized = item
      .getTitle()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_");
    if (FORM_FORBIDDEN_QUESTIONS.indexOf(normalized) >= 0) found.push(item.getTitle());
  });
  if (found.length) {
    pushWarning_(
      warnings,
      "form template contains forbidden question(s) [" + found.join(", ") + "] — delete them manually (§3)."
    );
  }
}

// Links responses to the company spreadsheet and renames the raw tab to
// form_responses_raw. The fresh tab is identified by diffing tab names around
// setDestination (sheet.getFormUrl() exposes the published form id, not the file id, so a
// URL match is unreliable). On re-runs where the tab is already named, this is a no-op.
function ensureFormDestination_(form, ss, warnings) {
  let destinationId = null;
  try {
    destinationId = form.getDestinationId(); // throws when no destination is set
  } catch (err) {
    destinationId = null;
  }

  if (destinationId === ss.getId()) {
    ensureRawResponsesTabName_(ss, null, warnings);
    return;
  }
  const tabNamesBefore = ss.getSheets().map(function (sheet) {
    return sheet.getName();
  });
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  ensureRawResponsesTabName_(ss, tabNamesBefore, warnings);
}

function ensureRawResponsesTabName_(ss, tabNamesBefore, warnings) {
  if (ss.getSheetByName(TAB_FORM_RESPONSES_RAW)) return;
  if (tabNamesBefore) {
    const fresh = ss.getSheets().filter(function (sheet) {
      return tabNamesBefore.indexOf(sheet.getName()) < 0;
    });
    if (fresh.length === 1) {
      fresh[0].setName(TAB_FORM_RESPONSES_RAW);
      return;
    }
  }
  pushWarning_(
    warnings,
    'could not identify the form response tab — rename it manually to "' + TAB_FORM_RESPONSES_RAW + '" (§3).'
  );
}
