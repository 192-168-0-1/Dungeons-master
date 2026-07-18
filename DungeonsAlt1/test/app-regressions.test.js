import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return app.slice(from, to);
}

test("map geometry is committed and redrawn while RPM progress awaits confirmation", () => {
  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  const geometryCommit = updateMap.indexOf("state.calibration = nextCalibration");
  const transitionHold = updateMap.indexOf("if (!transition.accept)");
  assert.ok(geometryCommit >= 0 && geometryCommit < transitionHold);

  const pendingBranch = updateMap.slice(transitionHold, updateMap.indexOf("if (transition.reset)", transitionHold));
  assert.match(pendingBranch, /renderGameOverlay\(\)/);
  const regressionBranch = updateMap.slice(
    updateMap.indexOf("same-floor-room-regression-held"),
    updateMap.indexOf("const tReadMs"),
  );
  assert.match(regressionBranch, /renderGameOverlay\(\)/);
});

test("lost or stale-scale map locks cannot leave a ghost overlay forever", () => {
  const clearCalibration = sourceBetween("function clearCalibration()", "function sameCalibration");
  assert.match(clearCalibration, /clearGameOverlay\(\)/);

  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  const lostBranch = updateMap.slice(updateMap.indexOf("if (!read)"), updateMap.indexOf("const readableRooms"));
  assert.match(lostBranch, /clearGameOverlay\(\)/);
  assert.doesNotMatch(lostBranch, /pendingFloorReset\s*=\s*null/);
  assert.match(updateMap, /unreadableCaptures \+= 1/);
  assert.match(updateMap, /weakFrameCaptures \+= 1/);
  assert.match(updateMap, /!read\.scoredMap\.validCorners/);
  assert.match(updateMap, /UNREADABLE_CAPTURES_BEFORE_RECALIBRATION/);
});

test("results lifecycle probing remains active when automatic table rows are disabled", () => {
  const autoResults = sourceBetween("async function autoCaptureDungeonResults(", "function renderResults");
  const presenceProbe = sourceBetween("async function probeDungeonResultsSentinel()", "function captureCadence");
  const fullRead = sourceBetween("async function readDungeonResultsCapture", "async function probeDungeonResultsSentinel");
  const attachContext = sourceBetween("function attachDungeonResultsContext", "async function readDungeonResultsCapture");
  assert.match(autoResults, /const trackingEnabled = Boolean\(elements\.autoTrackResults\.checked\)/);
  assert.doesNotMatch(autoResults, /lifecycleProbeNeeded/);
  assert.match(autoResults, /now - state\.lastAutoResultScan < RESULTS_AUTO_INTERVAL/);
  assert.match(autoResults, /resultLooksComplete\(capture\.result\)/);
  assert.match(autoResults, /readDungeonResultsCapture/);
  assert.match(autoResults, /const observedResult = capture\?\.result \?\? null/);
  assert.match(autoResults, /nextAutoResultState\(state\.autoResultState, null\)/);
  assert.doesNotMatch(autoResults, /sentinelPresentThisProbe \? \{\} : null/);
  assert.doesNotMatch(autoResults, /autoResultState\?\.visible && state\.autoResultState\?\.handled\) return/);
  assert.match(autoResults, /if \(!trackingEnabled \|\| !capture \|\| !next\.shouldAdd\) return/);
  assert.doesNotMatch(autoResults, /if \(!elements\.autoTrackResults\.checked\)\s*\{[\s\S]*?return;/);
  assert.match(presenceProbe, /createResultsSentinelPlan/);
  assert.match(presenceProbe, /if \(!plan\) \{[\s\S]*?state\.resultSentinelOpen = false;[\s\S]*?present: false/);
  assert.match(presenceProbe, /captureRegion\(plan\.x, plan\.y, plan\.width, plan\.height\)/);
  assert.match(presenceProbe, /const present = resultsSentinelsMatch[\s\S]*?state\.lastResultSentinelProbe = now/);
  assert.match(presenceProbe, /previousProbeExpired[\s\S]*?const rising = present && \(!state\.resultSentinelOpen \|\| previousProbeExpired\)/);
  assert.doesNotMatch(presenceProbe, /state\.awaitingNewFloor = true/);
  assert.doesNotMatch(fullRead, /state\.awaitingNewFloor = true/);
  assert.match(attachContext, /state\.awaitingNewFloor = true/);
  assert.match(app, /activeResultContext/);
  assert.match(app, /mapSnapshotRevision: state\.mapSnapshotRevision/);
  assert.match(app, /lastResultMapSnapshotRevisionConsumed/);
  assert.match(app, /snapshotFingerprint !== state\.mapSnapshotFingerprint/);
  assert.match(app, /mapDataUrl: completionContext\.mapDataUrl/);
  assert.doesNotMatch(app, /lastCommittedResultGeneration/);
});

test("full-client results matches require a second targeted live capture", () => {
  const read = sourceBetween("async function readDungeonResultsCapture", "async function probeDungeonResultsSentinel");
  const discovery = read.indexOf("const discoveryImage = captureFullRuneScape()");
  const targetConfirmation = read.indexOf("image = captureRegion(target.x, target.y, target.width, target.height)", discovery);
  const authoritativeMutation = read.indexOf("state.lastAuthoritativeResultSeenAt = Date.now()", targetConfirmation);
  assert.ok(discovery >= 0);
  assert.ok(targetConfirmation > discovery);
  assert.ok(authoritativeMutation > targetConfirmation);
  assert.match(read, /if \(!capture\) \{[\s\S]*?state\.resultTargetMisses \+= 1;[\s\S]*?return null;/);
  assert.match(read, /authoritativeTarget: true/);
  assert.match(read, /markerSource: source/);
  assert.match(read, /Keep offsets local/);
});

test("automatic results capture cannot hold the map lock during folder or archive writes", () => {
  const autoResults = sourceBetween("async function autoCaptureDungeonResults(", "function renderResults");
  const unlockedCommit = sourceBetween("async function commitDungeonResultsWithoutCaptureLock", "async function captureDungeonResults");
  assert.match(autoResults, /state\.busy \|\| !tryReservePixelCaptureSlot\(\)/);
  assert.match(autoResults, /captureSlotReserved: true/);
  assert.match(autoResults, /commitDungeonResultsWithoutCaptureLock\(capture, "auto"\)/);
  assert.ok(unlockedCommit.indexOf("state.resultsBusy = false")
    < unlockedCommit.indexOf("await commitDungeonResultsCapture"));
  assert.match(unlockedCommit, /state\.resultsCommitBusy = true/);
  assert.match(unlockedCommit, /state\.resultsCommitBusy = false/);
});

test("a fresh positive sentinel bridges expired OCR freshness without arming lifecycle alone", () => {
  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  assert.match(updateMap, /const sentinelPositive = sentinelProbeFresh && state\.resultSentinelOpen/);
  assert.match(updateMap, /resultsScreenVisible = rawResultsScreenVisible[\s\S]*?authoritativeResultFresh \|\| sentinelPositive/);
  assert.match(updateMap, /resultsSentinelAbsent = sentinelProbeFresh && !state\.resultSentinelOpen/);
});

test("every accepted reset retires an old raw results phase, including the normal gate", () => {
  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  const resetStart = updateMap.indexOf("if (transition.reset)");
  const resetBranch = updateMap.slice(resetStart, updateMap.indexOf("} else if", resetStart));
  assert.match(resetBranch, /rawResultsScreenVisible \|\| state\.activeResultContext/);
  assert.match(resetBranch, /retireCurrentResultEvidence\(\)/);
  assert.doesNotMatch(resetBranch, /confirmed-stale-results-override.*retireCurrentResultEvidence/);
});

test("map PNG clipboard action is explicit and independent from folder/archive saving", () => {
  const copy = sourceBetween("async function copyMapPng()", "function resultsPngFilename");
  assert.match(copy, /activeResultContext\?\.mapDataUrl/);
  assert.match(copy, /dataUrlToBlob\(dataUrl\)/);
  assert.match(copy, /writePngBlobToClipboard\(blob, window\)/);
  assert.doesNotMatch(copy, /saveMap|queuePending|writePngToSaveFolder/);
  assert.match(app, /copyMap: document\.querySelector\("#copy-map"\)/);
  assert.match(app, /elements\.copyMap\?\.addEventListener\("click", copyMapPng\)/);
});

test("automatic floor results are discovered faster without weakening the final-value gate", () => {
  assert.match(app, /RESULTS_SENTINEL_CADENCE_MS/);
  assert.match(app, /const RESULTS_AUTO_INTERVAL = 900/);
  assert.match(app, /const RESULTS_SETTLE_INTERVAL = 300/);
  assert.match(app, /resultLooksComplete\(capture\.result\)/);
  assert.match(app, /enforceResultStableDuration/);
  const loop = sourceBetween("async function resultsScanLoop()", "async function partyScanLoop");
  assert.match(loop, /sentinel\.rising/);
  assert.match(loop, /sentinel\.probed && sentinel\.present/);
  assert.match(loop, /resultReaderForceNeeded/);
  assert.match(loop, /readerVisible: Boolean\(state\.autoResultState\?\.visible\)/);
  assert.match(loop, /forceScan: shouldForceRead/);
  assert.match(loop, /captureCadence\(RESULTS_SENTINEL_CADENCE_MS\)/);
  const autoResults = sourceBetween("async function autoCaptureDungeonResults(", "function renderResults");
  assert.match(autoResults, /capture\?\.result \?\? null/);
  assert.doesNotMatch(autoResults, /capture\?\.result \?\? \(state\.resultSentinelOpen/);
});

test("saved calibration input is bounded before its first pixel capture", () => {
  const load = sourceBetween("function loadCalibration()", "function saveCalibration");
  assert.match(load, /parseSavedInterfaceScale/);
  assert.match(load, /saved\.x \+ dimensions\.width > clientWidth/);
  assert.match(load, /saved\.y \+ dimensions\.height > clientHeight/);
});

test("only unverified saved locks require the strict top-right marker", () => {
  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  assert.match(updateMap, /!state\.calibration\.verified && !read\.scoredMap\.validCorners/);
  assert.doesNotMatch(updateMap, /if \(!read\.scoredMap\.validCorners\)/);
  assert.match(updateMap, /unusableCaptures \+= 1/);
});

test("accepted map scale survives clear/recalibrate and protects RPM from scale-change gaps", () => {
  const updateMap = sourceBetween("async function updateMap()", "function updateLocalGatestones");
  assert.match(updateMap, /priorAcceptedScale = Number\(state\.lastAcceptedMapScale\)/);
  assert.match(updateMap, /scaleChanged: calibrationScaleChanged/);
  assert.match(updateMap, /state\.lastAcceptedMapScale = nextCalibration\.scale \|\| 1/);
  const clear = sourceBetween("function clearCalibration()", "function sameCalibration");
  assert.doesNotMatch(clear, /lastAcceptedMapScale/);
});

test("Desktop capture clears and disables native overlays before full-client results pixels", () => {
  const read = sourceBetween("async function readDungeonResultsCapture", "async function probeDungeonResultsSentinel");
  assert.ok(read.indexOf("await prepareDesktopFullCapture()") < read.indexOf("captureFullRuneScape()"));
  const prepare = sourceBetween("async function prepareDesktopFullCapture()", "function tryReservePixelCaptureSlot");
  assert.match(prepare, /clearGameOverlay\(\)/);
  assert.match(prepare, /backendCaptureInterval\(\)/);
  const overlay = sourceBetween("function renderGameOverlay()", "function testGameOverlay");
  assert.match(overlay, /if \(api\.compatEnabled\)/);
  assert.match(overlay, /drawGameOverlayGated\(api, group, \[\]\)/);
});

test("results loop always schedules its next scan after a probe failure", () => {
  const loop = sourceBetween("async function resultsScanLoop()", "async function partyScanLoop");
  assert.match(loop, /try \{/);
  assert.match(loop, /finally \{/);
  assert.match(loop, /setTimeout\(resultsScanLoop/);
  const probeCatch = loop.indexOf("Results sentinel recovered from:");
  const authoritativeRead = loop.indexOf("await autoCaptureDungeonResults");
  assert.ok(probeCatch >= 0);
  assert.ok(authoritativeRead > probeCatch);
});

test("saved calibration is tied to the RuneScape client dimensions", () => {
  assert.match(app, /rsWidth: state\.calibration\.rsWidth/);
  assert.match(app, /rsHeight: state\.calibration\.rsHeight/);
  assert.match(app, /calibrationMatchesLinkedClient/);
  assert.match(app, /RuneScape client size changed/);
});
