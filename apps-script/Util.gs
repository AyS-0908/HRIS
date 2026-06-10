// Util.gs — logging, the warning collector and small shared helpers.
// Warnings are operator-facing: they are collected into the init output (§5 output.warnings)
// AND logged, so a menu run and an editor run both surface them.

function hrisLog_(message, data) {
  console.log(data === undefined ? message : message + " " + JSON.stringify(data));
}

function pushWarning_(warnings, message) {
  warnings.push(message);
  console.warn("HRIS warning: " + message);
}

function isBlank_(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function requireString_(value, name) {
  if (isBlank_(value)) throw new Error(name + " is required");
  return String(value).trim();
}

function nowIso_() {
  return new Date().toISOString();
}

// Shows long copyable text (init result, registration payload) — ui.alert truncates.
function showTextDialog_(title, sections) {
  const html = sections
    .map(function (s) {
      return (
        "<h3 style=\"font-family:sans-serif;margin:8px 0 4px\">" + escapeHtml_(s.title) + "</h3>" +
        "<textarea readonly style=\"width:100%;height:" + (s.rows || 8) + "em;font-family:monospace\">" +
        escapeHtml_(s.text) +
        "</textarea>"
      );
    })
    .join("");
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(640).setHeight(480),
    title
  );
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
