// DocTemplate.gs — Job Description Google Doc template with the 7 placeholders (§3).
// Reuse order (P0): DocumentProperties cached id → create new (the §5 input has no
// template-id field, so explicit input does not apply here).

function ensureJobDescriptionTemplate_(folder, companyName, serviceAccountEmail, warnings) {
  const name = "Job Description Template - " + companyName;
  const cachedId = getHrisProperty_("JOB_DESCRIPTION_TEMPLATE_ID");

  let id = null;
  let url = null;
  let docName = name;
  if (!isBlank_(cachedId)) {
    try {
      const doc = DocumentApp.openById(cachedId);
      id = doc.getId();
      url = doc.getUrl();
      docName = doc.getName();
      verifyJdPlaceholders_(doc, warnings);
    } catch (err) {
      pushWarning_(warnings, "cached JD template " + cachedId + " is not accessible (" + err + ") — creating a new one.");
    }
  }
  if (!id) {
    const doc = DocumentApp.create(name);
    writeJdTemplateBody_(doc.getBody());
    id = doc.getId();
    url = doc.getUrl();
    doc.saveAndClose();
  }

  moveFileToFolder_(id, folder, warnings);
  if (!isBlank_(serviceAccountEmail)) {
    shareFileWithServiceAccount_(id, serviceAccountEmail, "JD template", warnings);
  }
  return { id: id, url: url, name: docName };
}

// Layout is free (the spec only locks the placeholder set): one heading per structured
// section plus the {{BODY}} fallback the MCP Docs connector fills when structured
// sections are off.
function writeJdTemplateBody_(body) {
  body.appendParagraph("{{TITLE}}").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendJdSection_(body, "Summary", "{{SUMMARY}}");
  appendJdSection_(body, "Mission", "{{MISSION}}");
  appendJdSection_(body, "Responsibilities", "{{RESPONSIBILITIES}}");
  appendJdSection_(body, "Profile", "{{PROFILE}}");
  appendJdSection_(body, "Context", "{{CONTEXT}}");
  body.appendParagraph("{{BODY}}");
}

function appendJdSection_(body, title, placeholder) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(placeholder);
}

// A reused template may have been hand-edited; a missing placeholder breaks MCP JD
// generation, so warn (never rewrite an existing doc).
function verifyJdPlaceholders_(doc, warnings) {
  const text = doc.getBody().getText();
  const missing = JD_PLACEHOLDERS.filter(function (p) {
    return text.indexOf(p) < 0;
  });
  if (missing.length) {
    pushWarning_(
      warnings,
      "JD template is missing placeholder(s) [" + missing.join(", ") + "] — restore them or MCP generation breaks."
    );
  }
}
