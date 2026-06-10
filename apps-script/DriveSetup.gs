// DriveSetup.gs — Drive folder reuse-or-create and service-account sharing.
// Folder name is module-neutral "HRIS - {companyName}" (§3); a legacy
// "HRIS - Recruitment - {companyName}" folder is reused AS-IS (never renamed) when it
// arrives via explicit input or the DocumentProperties cache — §3 says reuse happens via
// input/property only, so no Drive-wide name search is needed (keeps the narrow
// drive.file scope sufficient).

function ensureHrisFolder_(inputFolderId, companyName, warnings) {
  const candidateId = !isBlank_(inputFolderId) ? String(inputFolderId).trim() : getHrisProperty_("FOLDER_ID");
  if (!isBlank_(candidateId)) {
    try {
      return DriveApp.getFolderById(candidateId);
    } catch (err) {
      pushWarning_(
        warnings,
        "folder " + candidateId + " is not accessible (" + err + ") — creating a new HRIS folder."
      );
    }
  }
  return DriveApp.createFolder("HRIS - " + companyName);
}

// Idempotent move: no-op when the file is already inside the target folder.
function moveFileToFolder_(fileId, folder, warnings) {
  try {
    const file = DriveApp.getFileById(fileId);
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return;
    }
    file.moveTo(folder);
  } catch (err) {
    pushWarning_(warnings, "could not move file " + fileId + " into the HRIS folder: " + err);
  }
}

// P0 (§7 key_addendum): the service account needs Editor on the folder and on every
// template file, or MCP cannot copy templates / file generated Docs.
function shareFolderWithServiceAccount_(folder, serviceAccountEmail, warnings) {
  try {
    folder.addEditor(serviceAccountEmail);
  } catch (err) {
    pushWarning_(
      warnings,
      'could not share the HRIS folder with "' + serviceAccountEmail + '": ' + err + " — share it manually (P0)."
    );
  }
}

function shareFileWithServiceAccount_(fileId, serviceAccountEmail, label, warnings) {
  try {
    DriveApp.getFileById(fileId).addEditor(serviceAccountEmail);
  } catch (err) {
    pushWarning_(
      warnings,
      'could not share the ' + label + ' with "' + serviceAccountEmail + '": ' + err + " — share it manually (P0)."
    );
  }
}
