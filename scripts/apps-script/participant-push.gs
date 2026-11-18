/**
 * LEAD Participant List -> LEAD CRM.
 *
 * Paste this into the sheet: Extensions > Apps Script. It runs as the sheet's
 * owner, so nothing is shared with anyone new. Setup, once:
 *   1. Project Settings > Script properties > add two:
 *      PARTICIPANT_SYNC_KEY  the same value as the CRM's PARTICIPANT_SYNC_KEY.
 *                            Never put it in a cell.
 *      CRM_URL               the CRM's address followed by /api/sync/participants
 *                            (kept here, not in the code, so the repo never holds it).
 *   2. Run install() once and accept the permission prompt. It adds the hourly
 *      and nightly triggers and a "LEAD CRM" menu to the sheet.
 *   3. Menu > Check what the CRM is missing (nothing is written), then
 *      Menu > Load history once.
 *
 * Columns are found by their header, so their order does not matter:
 * Name, Company, Email, Mobile Number, HRDC, Classes Attended,
 * Latest Class Date, and optionally "Source" (what the student says brought
 * them: Facebook ad, WhatsApp ad, Referral, Returning student, Google, Other).
 * The sheet lists newest rows first, so the hourly run sends only the top
 * rows and the nightly run sends them all.
 */

var CFG = {
  TAB: 'Participants',
  CHUNK: 50,
  RECENT_ROWS: 300,
  BUDGET_MS: 5 * 60 * 1000, // Apps Script stops a run at 6 minutes
  TZ: 'Asia/Kuala_Lumpur'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LEAD CRM')
    .addItem('Check what the CRM is missing (no changes)', 'checkOnly')
    .addItem('Load history once', 'backfillHistory')
    .addItem('Send the newest rows now', 'syncRecent')
    .addToUi();
}

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncRecent').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncAll').timeBased().atHour(3).everyDays(1).inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('onOpen').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
}

function syncRecent() { run_('sync', false, CFG.RECENT_ROWS, 'NEXT_RECENT'); }
function syncAll() { run_('sync', false, 0, 'NEXT_ALL'); }
function backfillHistory() { run_('backfill', false, 0, 'NEXT_BACKFILL'); }
function checkOnly() { run_('sync', true, 0, 'NEXT_CHECK'); }

function url_() {
  var u = PropertiesService.getScriptProperties().getProperty('CRM_URL');
  if (!u) throw new Error('Add CRM_URL under Project Settings > Script properties.');
  return u;
}

function key_() {
  var k = PropertiesService.getScriptProperties().getProperty('PARTICIPANT_SYNC_KEY');
  if (!k) throw new Error('Add PARTICIPANT_SYNC_KEY under Project Settings > Script properties.');
  return k;
}

function readRows_(limit) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CFG.TAB);
  var values = sheet.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (name) { return head.indexOf(name); };
  var c = {
    name: col('name'), email: col('email'), mobile: col('mobile number'),
    classes: col('classes attended'), latest: col('latest class date'), source: col('source')
  };
  ['name', 'email', 'mobile', 'classes', 'latest'].forEach(function (k) {
    if (c[k] < 0) throw new Error('Column not found for: ' + k);
  });
  var cell = function (row, i) {
    var v = i < 0 ? '' : row[i];
    if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
    return String(v == null ? '' : v);
  };
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!cell(row, c.name).trim()) continue;
    rows.push({
      name: cell(row, c.name), email: cell(row, c.email), mobile: cell(row, c.mobile),
      classes: cell(row, c.classes), latestClassDate: cell(row, c.latest),
      source: cell(row, c.source)
    });
    if (limit && rows.length >= limit) break;
  }
  return rows;
}

function post_(mode, dryRun, rows) {
  var res = UrlFetchApp.fetch(url_(), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Api-Key': key_() },
    payload: JSON.stringify({ mode: mode, dryRun: dryRun, rows: rows }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200)
    throw new Error('CRM answered ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// Sends rows in chunks and remembers how far it got, so a run cut off by the
// 6-minute limit carries on from there next time instead of starting over.
function run_(mode, dryRun, limit, progressKey) {
  var props = PropertiesService.getScriptProperties();
  var rows = readRows_(limit);
  var from = Number(props.getProperty(progressKey) || 0);
  if (from >= rows.length) from = 0;
  var started = Date.now();
  var total = {};
  var i = from;
  for (; i < rows.length; i += CFG.CHUNK) {
    if (Date.now() - started > CFG.BUDGET_MS) break;
    var r = post_(mode, dryRun, rows.slice(i, i + CFG.CHUNK));
    ['rows', 'matchedPeople', 'newPeople', 'newEntries', 'knownEntries', 'sheetOnly', 'unmappedLabels', 'undatedLabels']
      .forEach(function (k) { total[k] = (total[k] || 0) + (r[k] || 0); });
  }
  var done = i >= rows.length;
  if (done) props.deleteProperty(progressKey); else props.setProperty(progressKey, String(i));
  var msg = (done ? 'Done. ' : 'Stopped at row ' + i + ' of ' + rows.length + ' - run it again to continue. ') +
    JSON.stringify(total);
  Logger.log(msg);
  if (dryRun || mode === 'backfill') {
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from a trigger: no screen */ }
  }
}
