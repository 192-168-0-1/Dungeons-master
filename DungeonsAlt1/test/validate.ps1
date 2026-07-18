$ErrorActionPreference = 'Stop'

$appRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $appRoot -Parent

Add-Type -AssemblyName System.Drawing

$mapCore = Get-Content (Join-Path $appRoot 'src\map-core.js') -Raw
$signatureMatches = [regex]::Matches(
    $mapCore,
    '\["(?<name>(?:Room|Crit|Mystery)[A-Z]+)",\s*"(?<signature>[0-9,;]+)"\]')

$signatureErrors = @()
foreach ($match in $signatureMatches) {
    $name = $match.Groups['name'].Value
    $resourceFolder = if ($name.StartsWith('Crit')) {
        Join-Path $repoRoot 'Common\Resources\Crit'
    }
    elseif ($name.StartsWith('Mystery')) {
        Join-Path $repoRoot 'Common\Resources\Mystery'
    }
    else {
        Join-Path $repoRoot 'Common\Resources'
    }

    $bitmap = [System.Drawing.Bitmap]::FromFile((Join-Path $resourceFolder ($name + '.png')))
    try {
        $actual = foreach ($point in @(@(6, 7), @(7, 7), @(6, 8), @(7, 8))) {
            $color = $bitmap.GetPixel($point[0], $point[1])
            '{0},{1},{2}' -f $color.R, $color.G, $color.B
        }
        if (($actual -join ';') -ne $match.Groups['signature'].Value) {
            $signatureErrors += $name
        }
    }
    finally {
        $bitmap.Dispose()
    }
}

if ($signatureMatches.Count -ne 34 -or $signatureErrors.Count -ne 0) {
    throw "Room signatures invalid. Found=$($signatureMatches.Count), mismatches=$($signatureErrors -join ', ')"
}

function Get-WebPalette([string]$name) {
    $block = [regex]::Match(
        $mapCore,
        ('const ' + [regex]::Escape($name) + ' = new Set\(\[(?<colors>[\s\S]*?)\]\);'))
    if (-not $block.Success) {
        throw "Palette $name is missing from map-core.js."
    }
    $palette = [System.Collections.Generic.HashSet[int]]::new()
    [regex]::Matches($block.Groups['colors'].Value, '0x[0-9A-Fa-f]{6}') | ForEach-Object {
        [void]$palette.Add([Convert]::ToInt32($_.Value.Substring(2), 16))
    }
    return ,$palette
}

function Get-AssetPalette([string]$path) {
    $palette = [System.Collections.Generic.HashSet[int]]::new()
    $bitmap = [System.Drawing.Bitmap]::FromFile($path)
    try {
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $color = $bitmap.GetPixel($x, $y)
                $max = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
                $min = [Math]::Min($color.R, [Math]::Min($color.G, $color.B))
                if ($color.A -gt 160 -and $max -ge 35 -and $max -le 220 -and ($max - $min) -ge 25) {
                    # Match JavaScript Math.floor and C# integer division. A
                    # PowerShell [int] cast rounds and previously hid a real
                    # runtime palette mismatch.
                    $red = [int][Math]::Floor($color.R / 16)
                    $green = [int][Math]::Floor($color.G / 16)
                    $blue = [int][Math]::Floor($color.B / 16)
                    $bucket = ($red -shl 16) -bor ($green -shl 8) -bor $blue
                    [void]$palette.Add($bucket)
                }
            }
        }
    }
    finally {
        $bitmap.Dispose()
    }
    return ,$palette
}

$paletteSpecs = @(
    @('PERSONAL_GATESTONE_1_PALETTE', 'Common\Resources\Gatestones\PersonalGatestone1.png'),
    @('PERSONAL_GATESTONE_2_PALETTE', 'Common\Resources\Gatestones\PersonalGatestone2.png'),
    @('GROUP_GATESTONE_PALETTE', 'Common\Resources\Gatestones\GroupGatestone.png'),
    @('BOSS_MARKER_PALETTE', 'Common\Resources\BossOverlay.png')
)
$paletteColorCount = 0
foreach ($spec in $paletteSpecs) {
    $webPalette = Get-WebPalette $spec[0]
    $assetPalette = Get-AssetPalette (Join-Path $repoRoot $spec[1])
    if (-not $webPalette.SetEquals($assetPalette)) {
        throw "$($spec[0]) mismatch. Web=$($webPalette.Count), asset=$($assetPalette.Count)"
    }
    $paletteColorCount += $webPalette.Count
}

if (($mapCore -notmatch 'function isBossMarkerAt\(image, originX, originY\)') -or
    ($mapCore -notmatch 'BOSS_RED_PROBES') -or
    ($mapCore -notmatch 'BOSS_JAW_PROBES') -or
    ($mapCore -notmatch 'BOSS_HOLE_PROBES') -or
    ($mapCore -notmatch 'offsetX = -4') -or
    ($mapCore -notmatch 'jawMatches < 2 && redMatches < 10') -or
    ($mapCore -notmatch 'unexploredRoomCount')) {
    throw 'Shift-tolerant boss-skull detection or the unexplored-room denominator is missing from map-core.js.'
}

$html = Get-Content (Join-Path $appRoot 'index.html') -Raw
$styles = Get-Content (Join-Path $appRoot 'styles.css') -Raw
$app = Get-Content (Join-Path $appRoot 'app.js') -Raw
$capture = Get-Content (Join-Path $appRoot 'src\alt1-capture.js') -Raw
$overlay = Get-Content (Join-Path $appRoot 'src\alt1-overlay.js') -Raw
$partyCore = Get-Content (Join-Path $appRoot 'src\party-core.js') -Raw
$partyInterface = Get-Content (Join-Path $appRoot 'src\party-interface.js') -Raw
$teamSync = Get-Content (Join-Path $appRoot 'src\team-sync.js') -Raw
$teamGates = Get-Content (Join-Path $appRoot 'src\team-gates.js') -Raw
$partyMenu = Get-Content (Join-Path $appRoot 'src\party-menu.js') -Raw
$resultsCore = Get-Content (Join-Path $appRoot 'src\results-core.js') -Raw
$resultsCapture = Get-Content (Join-Path $appRoot 'src\results-capture.js') -Raw
$clipboard = Get-Content (Join-Path $appRoot 'src\clipboard.js') -Raw
$fileSaver = Get-Content (Join-Path $appRoot 'src\file-saver.js') -Raw
$captureArchive = Get-Content (Join-Path $appRoot 'src\capture-archive.js') -Raw
$winterface = Get-Content (Join-Path $appRoot 'src\winterface.js') -Raw
$mapLocator = Get-Content (Join-Path $appRoot 'src\alt1-map-locator.js') -Raw
$rpmState = Get-Content (Join-Path $appRoot 'src\rpm-state.js') -Raw
$partyAnchor = Get-Content (Join-Path $appRoot 'src\party-anchor.js') -Raw
$interfaceScale = Get-Content (Join-Path $appRoot 'src\interface-scale.js') -Raw
$resultsSentinel = Get-Content (Join-Path $appRoot 'src\results-sentinel.js') -Raw
$nativeOverlaySource = $app + "`n" + $overlay
$runtimeSource = $app + "`n" + $capture + "`n" + $overlay + "`n" + $partyCore + "`n" + $partyInterface + "`n" + $teamSync + "`n" + $teamGates + "`n" + $partyMenu + "`n" + $resultsCore + "`n" + $resultsCapture + "`n" + $clipboard + "`n" + $fileSaver + "`n" + $captureArchive + "`n" + $winterface + "`n" + $mapLocator + "`n" + $rpmState + "`n" + $partyAnchor + "`n" + $interfaceScale + "`n" + $resultsSentinel
$domIds = @([regex]::Matches($app, 'querySelector\("#(?<id>[a-z0-9-]+)"\)') | ForEach-Object { $_.Groups['id'].Value })
$missingDomIds = @($domIds | Where-Object { $html -notmatch ('id="' + [regex]::Escape($_) + '"') })
if ($missingDomIds.Count -ne 0) {
    throw "Missing DOM ids: $($missingDomIds -join ', ')"
}

if ($nativeOverlaySource -match 'api\.rs[XY]' -or $nativeOverlaySource -match 'clientToOverlay') {
    throw 'Native Alt1 overlays must use RuneScape-client capture coordinates directly, without rsX/rsY offsets.'
}
if ($nativeOverlaySource -match 'overLayTextEx\([^;]*undefined' -or $overlay -notmatch 'font:\s*""') {
    throw 'Native Alt1 overlay text must pass an explicit font string to overLayTextEx.'
}
if ($overlay -notmatch 'function mixColor\(r, g, b, a = 255\)' -or $overlay -notmatch '\(a << 24\)') {
    throw 'Native Alt1 overlay colors must use the official signed 32-bit ARGB format with an opaque default alpha.'
}
if ($overlay -notmatch 'overLayFreezeGroup' -or $overlay -notmatch 'overLayRefreshGroup') {
    throw 'Native Alt1 overlay groups must use the proven freeze-and-refresh lifecycle.'
}
if ($overlay -notmatch 'overLaySetGroup\(""\)') {
    throw 'Native Alt1 overlay rendering must reset the active group after drawing.'
}
if ($app -notmatch 'gatestones:\s*hideMapDetails \? \[\] : collectGatestoneMarkers' -or
    $overlay -notmatch 'for \(const marker of gatestones\)') {
    throw 'Native RuneScape overlay must draw gatestones normally and suppress them in RPM-only mode.'
}
if (($overlay -notmatch 'sizeScale') -or
    ($overlay -notmatch 'size = scale \* overlayScaleValue\(sizeScale\)') -or
    ($app -notmatch 'statsScale: 1') -or
    ($app -notmatch 'statsFree: state\.statsFree') -or
    ($app -notmatch 'function setStatsFree') -or
    ($app -notmatch 'onAlt1Event\("alt1pressed"') -or
    ($app -notmatch 'function onAlt1Event') -or
    ($app -match 'window\.addEventListener\("(alt1pressed|permissionchanged)"') -or
    ($app -notmatch 'mouseRs') -or
    ($html -notmatch 'id="interface-scale-status"') -or
    ($html -match 'id="stats-scale"') -or
    ($html -notmatch 'id="stats-place"') -or
    ($html -notmatch 'data-stats-nudge')) {
    throw 'The in-game RPM/stats overlay must auto-scale, remain freely movable and be Alt+1 placeable.'
}
if (([regex]::Matches($html, 'class="party-slot" data-slot="[1-5]"')).Count -ne 5) {
    throw 'The Dungeoneering party interface must contain exactly five visible slots.'
}
if (($partyCore -notmatch 'PARTY_SIZE = 5') -or
    ([regex]::Matches($partyCore, 'color: "#[0-9a-f]{6}"').Count -ne 5)) {
    throw 'The fixed five-player color palette is missing from party-core.js.'
}
if (($teamSync -notmatch 'send\("ROSTER"') -or
    ($teamSync -notmatch 'send\("FULL"') -or
    ($teamSync -notmatch 'this\.slot \?\? 0')) {
    throw 'Team-sync must distribute the five-player roster and sender slot metadata.'
}
if (($app -notmatch 'ownerColor\(annotation\.ownerId') -or
    ($overlay -notmatch 'hexToOverlayColor\(annotation\.color')) {
    throw 'Both canvas and native annotations must use their owner party color.'
}
if (($partyInterface -notmatch 'function findPartyPanel') -or
    ($partyInterface -notmatch 'ocr\.findReadLine') -or
    ($partyCore -notmatch 'function observedPartySlot') -or
    ($teamSync -notmatch 'send\("PARTY"') -or
    ($app -notmatch 'scanPartyInterface')) {
    throw 'RuneScape party-interface detection, OCR and slot matching must remain connected.'
}
if (($html -notmatch 'id="experimental-features"') -or
    ($html -notmatch 'id="experimental-auto-room"') -or
    ($html -match 'id="experimental-features"[^>]*\bchecked') -or
    ($html -match 'id="experimental-auto-room"[^>]*\bchecked') -or
    ($app -notmatch 'maybeAutoJoinFromParty') -or
    ($app -notmatch 'experimentalAutoRoom')) {
    throw 'Experimental party-room auto-join must be an opt-in feature behind the experimental toggle and default to off.'
}
if (($html -notmatch 'id="party-forget"') -or
    ($partyCore -notmatch 'function mergeObservedPartyCache') -or
    ($app -notmatch 'partyAutoScan') -or
    ($app -notmatch 'manual room order unchanged')) {
    throw 'RuneScape party scanning must remain a helper that does not replace manual room order.'
}
if (($html -notmatch 'id="party-context-menu"') -or
    ($html -notmatch 'Choose Option') -or
    ($html -notmatch 'data-action="inspect"') -or
    ($html -notmatch 'data-action="kick"') -or
    ($html -notmatch 'data-action="promote"') -or
    ($html -notmatch 'data-action="cancel"') -or
    ($app -notmatch 'showPartyContextMenu') -or
    ($app -notmatch 'mouseleave') -or
    ($partyMenu -notmatch 'clampContextMenuPosition')) {
    throw 'The RuneScape-style party context menu and viewport clamping are incomplete.'
}
if (($teamSync -notmatch 'send\("KICK"') -or
    ($teamSync -notmatch 'NAME_TAKEN') -or
    ($teamSync -notmatch 'promoteMember') -or
    ($teamSync -notmatch 'kickMember') -or
    ($teamSync -notmatch 'senderInRoster') -or
    ($app -notmatch 'Only the party leader can kick players') -or
    ($app -notmatch 'Only the party leader can promote players')) {
    throw 'Manual host roster controls must support promote, kick and sender filtering.'
}
if (($partyCore -notmatch 'duplicate: true') -or
    ($teamSync -notmatch 'duplicate RSN') -or
    ($teamSync -notmatch 'already in this team room')) {
    throw 'Manual room rosters must reject duplicate RuneScape names.'
}
if (($html -notmatch 'id="party-interface" type="checkbox" checked') -or
    ($html -notmatch 'id="experimental-tools"') -or
    ($html -notmatch 'experimental-tools" hidden') -or
    ($styles -notmatch '\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}') -or
    ($html -notmatch 'id="party-scan"') -or
    ($html -notmatch 'id="party-forget"') -or
    ($app -notmatch 'partyInterface\.checked') -or
    ($app -notmatch 'state\.experimentalEnabled')) {
    throw 'RuneScape party scanning must live in the experimental tools section, gated behind the experimental toggle.'
}
if (($app -notmatch 'function installedInAlt1') -or
    ($app -notmatch 'installLink\.hidden') -or
    ($app -notmatch 'permissionchanged')) {
    throw 'The install link must hide when the Alt1 app is already installed/permissioned.'
}
if (($html -notmatch 'id="auto-track-results" type="checkbox"') -or
    ($html -notmatch 'id="auto-save-map-png" type="checkbox"') -or
    ($html -notmatch 'id="auto-save-results-png" type="checkbox"') -or
    ($html -notmatch 'id="rpm-only" type="checkbox"') -or
    ($html -notmatch 'id="result-batch-size"') -or
    ($html -notmatch 'id="result-floor-filter"') -or
    ($html -notmatch 'id="result-batch-mode"') -or
    ($html -notmatch 'id="reset-result-batch"') -or
    ($html -notmatch 'id="result-batch-summary"') -or
    ($html -notmatch 'id="choose-map-save-folder"') -or
    ($html -notmatch 'id="clear-map-save-folder"') -or
    ($html -notmatch 'id="map-save-folder-status"') -or
    ($html -notmatch 'id="choose-results-save-folder"') -or
    ($html -notmatch 'id="clear-results-save-folder"') -or
    ($html -notmatch 'id="results-save-folder-status"') -or
    ($html -notmatch 'id="download-capture-archive"') -or
    ($html -notmatch 'id="clear-capture-archive"') -or
    ($html -notmatch 'id="capture-archive-status"') -or
    ($html -notmatch 'id="copy-map"') -or
    ($html -match 'id="auto-track-results"[^>]*checked') -or
    ($html -match 'id="auto-save-map-png"[^>]*checked') -or
    ($html -match 'id="auto-save-results-png"[^>]*checked') -or
    ($html -match 'id="rpm-only"[^>]*checked')) {
    throw 'Dungeon results auto tracking and PNG export options must exist and default off.'
}
if (($app -notmatch 'autoCaptureDungeonResults') -or
    ($app -notmatch 'readDungeonResultsCapture') -or
    ($app -notmatch 'probeDungeonResultsSentinel') -or
    ($app -notmatch 'createResultsSentinelPlan') -or
    ($app -notmatch 'resultsSentinelsMatch') -or
    ($app -notmatch 'captureCadence\(RESULTS_SENTINEL_CADENCE_MS\)') -or
    ($resultsSentinel -notmatch 'RESULTS_SENTINEL_CADENCE_MS\s*=\s*250') -or
    ($resultsSentinel -notmatch 'ZONE_MIN_HITS\s*=\s*5') -or
    ($resultsSentinel -notmatch 'title-gold') -or
    ($resultsSentinel -notmatch 'dark-interior') -or
    ($resultsSentinel -notmatch 'ready-orange') -or
    ($app -notmatch 'saveResultArtifacts') -or
    ($app -notmatch 'cropImageData') -or
    ($app -notmatch 'writePngToSaveFolder') -or
    ($app -notmatch 'writePngBlobToClipboard') -or
    ($resultsCapture -notmatch 'function resultCaptureTarget') -or
    ($resultsCapture -notmatch 'function resultLifecycleObservation') -or
    ($clipboard -notmatch 'function writePngBlobToClipboard') -or
    ($app -match 'downloadDataUrl') -or
    ($app -match '\.download\s*=') -or
    ($app -match '\.click\(\)') -or
    ($fileSaver -notmatch 'showDirectoryPicker') -or
    ($fileSaver -notmatch 'indexedDB') -or
    ($fileSaver -notmatch 'writeDataUrlToFolder') -or
    ($fileSaver -notmatch 'showDirectoryPicker\(\{ id: saveFolderKey\(key\), mode: "readwrite" \}\)') -or
    ($fileSaver -notmatch 'return "unknown"') -or
    ($fileSaver -notmatch 'TimeoutError') -or
    ($fileSaver -notmatch 'isSaveFolderPermissionError') -or
    ($fileSaver -notmatch 'knownAlt1FolderWritesUnsupported') -or
    ($captureArchive -notmatch 'indexedDB') -or
    ($captureArchive -notmatch 'buildCaptureZip') -or
    ($captureArchive -notmatch 'triggerBlobDownload') -or
    ($captureArchive -notmatch 'upsertCaptureArchive') -or
    ($captureArchive -notmatch 'deleteCaptureArchiveRecords') -or
    ($captureArchive -notmatch 'MAX_CAPTURE_ARCHIVE_ITEMS') -or
    ($app -notmatch 'folder\.permission = "granted"') -or
    ($app -match 'save folder permission was not granted') -or
    ($app -notmatch 'function canRequestSaveFolderPermission') -or
    ($app -notmatch 'permission === "prompt" \|\| permission === "denied"') -or
    ($app -notmatch 'queuePendingMapPng\(artifact\)') -or
    ($app -notmatch 'map-folder') -or
    ($app -notmatch 'results-folder') -or
    ($app -notmatch 'resultsBusy') -or
    ($app -notmatch 'commitDungeonResultsCapture') -or
    ($app -notmatch 'prepareResultBatch') -or
    ($resultsCore -notmatch 'averageResultTime') -or
    ($resultsCore -notmatch 'resultMatchesFloorFilter') -or
    ($resultsCore -notmatch 'RESULT_THEME_RANGES') -or
    ($resultsCore -notmatch 'resultBatchStatus') -or
    ($resultsCore -notmatch 'resultAlreadyRecorded') -or
    ($resultsCore -notmatch 'normalizeStoredResults') -or
    ($app -notmatch 'function persistResults') -or
    ($app -notmatch 'auto-track-results') -or
    ($app -notmatch 'resultAlreadyRecorded\(state\.results, result\)') -or
    ($resultsCore -notmatch 'nextAutoResultState') -or
    ($resultsCore -notmatch 'AUTO_RESULT_MISSES_BEFORE_HIDDEN') -or
    ($resultsCore -notmatch 'AUTO_RESULT_STABLE_SCANS') -or
    ($resultsCore -notmatch 'AUTO_RESULT_STABLE_SCANS = 3') -or
    ($resultsCore -notmatch '"Timestamp", "Time", "Roomcount", "DeadEnds"') -or
    ($resultsCore -notmatch 'stableScansRequired') -or
    ($app -notmatch 'missing:\s*next\.missing') -or
    ($app -notmatch 'stable:\s*next\.stable') -or
    ($resultsCore -notmatch 'resultStabilityKey') -or
    ($resultsCore -notmatch 'resultLooksComplete') -or
    ($app -notmatch 'resultLooksComplete') -or
    ($app -notmatch 'readSettledDungeonResultsCapture') -or
    ($app -notmatch 'pendingResultsPngs') -or
    ($app -notmatch 'enforceCaptureArchiveItemLimit') -or
    ($app -notmatch 'retryPendingResultsPngs') -or
    ($app -notmatch 'pendingMapPngs') -or
    ($app -notmatch 'retryPendingMapPngs') -or
    ($app -notmatch 'activeResultContext') -or
    ($app -notmatch 'mapGeneration: completionContext\.mapGeneration') -or
    ($app -notmatch 'mapDataUrl: completionContext\.mapDataUrl') -or
    ($app -notmatch 'claimResultMapSnapshot') -or
    ($app -notmatch 'lastResultMapGenerationConsumed') -or
    ($app -notmatch 'lastResultMapSnapshotRevisionConsumed') -or
    ($app -notmatch 'mapSnapshotRevision: completionContext\.mapSnapshotRevision') -or
    ($resultsCore -notmatch 'function mapSnapshotFingerprint') -or
    ($resultsCore -notmatch 'function resultMapSnapshotMatchesGeneration') -or
    ($resultsCore -notmatch 'enforceResultStableDuration') -or
    ($resultsCore -notmatch 'RESULT_STABLE_MIN_MS = 1200') -or
    ($app -notmatch 'RESULTS_AUTO_INTERVAL = 900') -or
    ($app -notmatch 'RESULTS_SETTLE_INTERVAL = 300') -or
    ($app -notmatch 'RESULTS_SCALE_FALLBACK_IDLE_INTERVAL = 30000') -or
    ($resultsCore -notmatch 'plannedResultExports')) {
    throw 'Automatic dungeon-results capture, dedupe, stability gate and folder-based PNG export are incomplete.'
}
if (($resultsCore -notmatch 'RESULT_DISPLAY_COLUMNS') -or
    ($resultsCore -notmatch 'function orderedResultsForDisplay') -or
    ($app -notmatch 'RESULT_DISPLAY_COLUMNS') -or
    ($app -notmatch 'orderedResultsForDisplay\(state\.results\)') -or
    ($html -notmatch '<th>#</th>') -or
    ($html -notmatch '<th>Final XP</th>')) {
    throw 'The floor-tracking table must render the compact, numbered display columns.'
}
if (($winterface -notmatch 'readWithOffset') -or
    ($winterface -notmatch 'WINTERFACE_WIDTH = 512') -or
    ($winterface -notmatch 'WINTERFACE_HEIGHT = 334') -or
    ($winterface -notmatch 'fallbackInterfaceScales') -or
    ($winterface -notmatch 'allowScaleFallback') -or
    ($winterface -notmatch 'HINTED_MARKER_TRUST_SCORE') -or
    ($winterface -notmatch 'defaultCropFits') -or
    ($winterface -notmatch 'normalizeInterfaceRegion') -or
    ($winterface -notmatch 'rawOffset') -or
    ($winterface -notmatch 'rawWidth') -or
    ($winterface -notmatch 'rawHeight') -or
    ($resultsCore -notmatch 'function resultCaptureRect') -or
    ($app -notmatch 'resultCaptureRect\(capture\)')) {
    throw 'Winterface reads must expose their offset so the cropped results PNG matches the detected interface.'
}
if (($capture -notmatch 'bindRegion\(x, y, width, height\)') -or
    ($capture -notmatch 'bindGetRegion') -or
    ($capture -notmatch 'transferRegionInRows')) {
    throw 'Large results captures must bind one RuneScape frame before transferring image stripes.'
}
if (($winterface -notmatch 'function deriveFloorSize') -or
    ($winterface -notmatch '\+500') -or
    ($winterface -notmatch 'detected: extra\.floorSize') -or
    ($app -notmatch 'floorSize: state\.gameMap\?\.floor\?\.name')) {
    throw 'Floor size must come from detected map geometry, not the stale Dungeon Size XP modifier text.'
}
if (($rpmState -notmatch 'function evaluateMapTransition') -or
    ($rpmState -notmatch 'pending-\$\{candidateReason\}') -or
    ($rpmState -notmatch 'confirmed-base-change') -or
    ($rpmState -notmatch 'roomCountDropped') -or
    ($rpmState -notmatch 'confirmed-room-collapse') -or
    ($rpmState -notmatch 'map-gap-regression') -or
    ($rpmState -notmatch 'results-lifecycle') -or
    ($rpmState -notmatch 'mapGapMs >= 2_000') -or
    ($rpmState -notmatch 'lastFloorName') -or
    ($rpmState -notmatch 'resetRoomCount') -or
    ($rpmState -notmatch 'function trackedBaseAfterTransition') -or
    ($rpmState -notmatch 'firstSeenAt') -or
    ($rpmState -notmatch 'function floorPaceStatus') -or
    ($rpmState -notmatch 'function parseFloorTargetSeconds') -or
    ($app -notmatch 'currentFloorPace') -or
    ($app -notmatch 'unexploredRoomCount') -or
    ($rpmState -notmatch 'resetAt') -or
    ($rpmState -notmatch 'FLOOR_START_OFFSET_MS = 2000') -or
    ($rpmState -notmatch 'MAX_RESET_RPM = 8') -or
    ($rpmState -notmatch 'function rpmValue') -or
    ($app -notmatch 'evaluateMapTransition') -or
    ($app -notmatch 'resetFloor\(transition\.resetAt \?\? now, transition\.resetRoomCount \?\? gameMap\.openedRoomCount\)') -or
    ($app -notmatch 'trackedBaseAfterTransition') -or
    ($app -notmatch 'awaitingNewFloor: state\.awaitingNewFloor') -or
    ($app -notmatch 'state\.awaitingNewFloor = true') -or
    ($app -notmatch 'same-floor-room-regression-held') -or
    ($app -notmatch 'transition\.accept') -or
    ($app -notmatch 'transition\.resetAt') -or
    ($app -notmatch 'Possible new floor detected') -or
    ($overlay -notmatch 'predictedSeconds') -or
    ($overlay -notmatch 'rpmValue')) {
    throw 'RPM state must be centralized and must gate suspicious floor resets before updating visible stats.'
}
if (($app -notmatch 'map-core\.js\?v=20260718-39') -or
    ($app -notmatch 'alt1-map-locator\.js\?v=20260718-39') -or
    ($app -notmatch 'alt1-capture\.js\?v=20260718-39') -or
    ($app -notmatch 'capture-scheduler\.js\?v=20260718-39') -or
    ($app -notmatch 'interface-scale\.js\?v=20260718-39') -or
    ($app -notmatch 'alt1-overlay\.js\?v=20260718-39') -or
    ($app -notmatch 'rpm-state\.js\?v=20260718-39') -or
    ($app -notmatch 'team-sync\.js\?v=20260718-39') -or
    ($app -notmatch 'party-core\.js\?v=20260718-39') -or
    ($app -notmatch 'party-interface\.js\?v=20260718-39') -or
    ($app -notmatch 'results-core\.js\?v=20260718-39') -or
    ($app -notmatch 'results-capture\.js\?v=20260718-39') -or
    ($app -notmatch 'clipboard\.js\?v=20260718-39') -or
    ($app -notmatch 'party-menu\.js\?v=20260718-39') -or
    ($app -notmatch 'team-gates\.js\?v=20260718-39') -or
    ($app -notmatch 'file-saver\.js\?v=20260718-39') -or
    ($app -notmatch 'capture-archive\.js\?v=20260718-39') -or
    ($app -notmatch 'party-anchor\.js\?v=20260718-39') -or
    ($app -notmatch 'winterface\.js\?v=20260718-39') -or
    ($app -notmatch 'results-sentinel\.js\?v=20260718-39') -or
    ($overlay -notmatch 'map-core\.js\?v=20260718-39') -or
    ($overlay -notmatch 'rpm-state\.js\?v=20260718-39') -or
    ($teamSync -notmatch 'party-core\.js\?v=20260718-39') -or
    ($teamGates -notmatch 'party-core\.js\?v=20260718-39') -or
    ($teamGates -notmatch 'alt1-overlay\.js\?v=20260718-39') -or
    ($partyAnchor -notmatch 'party-interface\.js\?v=20260718-39') -or
    ($partyAnchor -notmatch 'chatbox-font-data\.js\?v=20260718-39') -or
    ($resultsCapture -notmatch 'results-core\.js\?v=20260718-39') -or
    ($resultsCapture -notmatch 'winterface\.js\?v=20260718-39') -or
    ($mapLocator -notmatch 'map-core\.js\?v=20260718-39')) {
    throw 'Changed Alt1 runtime modules must be cache-busted for existing Alt1 installations.'
}
if (($app -notmatch 'buildVisibleRemoteGatestones') -or
    ($teamGates -notmatch 'source: "team"') -or
    ($teamGates -match 'source: "local"') -or
    ($app -notmatch 'local gates detected .*synced') -or
    ($app -notmatch 'remote gates visible')) {
    throw 'Local gatestones must sync without being included in either visible map overlay.'
}
if (($app -notmatch 'function renderRoomStatus') -or
    ($partyCore -notmatch 'function roomStatusLine') -or
    ($app -notmatch 'roomStatusLine\(') -or
    ($html -notmatch 'id="room-status"') -or
    ($app -notmatch 'addEventListener\("connected"')) {
    throw 'The experimental panel must show a persistent, event-driven room-join indicator.'
}
$alt1OcrScripts = [regex]::Matches(
    $html,
    '\["https://unpkg\.com/alt1@0\.1\.3/dist/[^\"]+", "sha(256|384)-[A-Za-z0-9+/=]+"\]')
if ($alt1OcrScripts.Count -ne 6) {
    throw 'The six official Alt1 OCR scripts must be loaded in the background, version-pinned and protected by SRI.'
}
if (($html -notmatch 'function loadOcrScript') -or
    ($html -notmatch '__dungeonsOcrReady') -or
    ($html -notmatch 'OCR dependency timed out')) {
    throw 'Alt1 OCR dependencies must load in the background with bounded failure handling.'
}

$manifest = Get-Content (Join-Path $appRoot 'appconfig.json') -Raw | ConvertFrom-Json
foreach ($relativePath in $manifest.appUrl, $manifest.configUrl, $manifest.iconUrl) {
    $localPath = ($relativePath -split '[?#]', 2)[0]
    if (-not (Test-Path (Join-Path $appRoot $localPath))) {
        throw "Manifest target does not exist: $relativePath"
    }
}
if ($html -notmatch 'fetch\("\./version\.json\?ts=" \+ Date\.now\(\), \{ cache: "no-store" \}\)' -or
    -not (Test-Path (Join-Path $appRoot 'version.json'))) {
    throw 'The Alt1 bootstrap must fetch version.json without cache so installed apps update without reinstalling.'
}
if ($html -notmatch '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">') {
    throw 'index.html must disable document caching for existing Alt1 installations.'
}
if (($html -notmatch 'var fallbackVersion = "[0-9-]+"') -or
    ($html -notmatch 'setTimeout\(function \(\) \{\s*startApp\(fallbackVersion\);\s*\}, 2500\)') -or
    ($html -notmatch 'appScript\.onerror')) {
    throw 'The Alt1 bootstrap must start from a bounded local fallback and expose core module load failures.'
}
if (($html -notmatch 'window\.__dungeonsAppReady') -or
    ($html -notmatch 'Dungeons startup error:') -or
    ($html -notmatch '\}, 12000\)') -or
    ($app -notmatch 'window\.__dungeonsAppReady = true;')) {
    throw 'The Alt1 bootstrap must detect modules that never finish initializing.'
}
if (($app -notmatch 'function storageGet') -or
    ($app -match '(?<!window\.)localStorage\.')) {
    throw 'Alt1 startup must not depend on direct localStorage access.'
}
if ($runtimeSource -match '\.replaceAll\(' -or
    $runtimeSource -match '\.at\(-1\)') {
    throw 'Runtime Alt1 modules must avoid replaceAll() and at(-1) for older Alt1 Chromium builds.'
}
if (($app -notmatch 'findMapByAlt1Anchor') -or
    ($app -notmatch 'findMapByScaledCorners') -or
    ($app -notmatch 'readMapAtCalibration') -or
    ($mapLocator -notmatch 'scoreMapCandidate') -or
    ($mapLocator -notmatch 'function readMapAtCalibration') -or
    ($app -notmatch 'MAP_SCALE_CANDIDATES') -or
    ($app -notmatch 'function findMapInRuneScapeClient') -or
    ($mapLocator -notmatch 'MAP_ANCHOR') -or
    ($mapLocator -notmatch 'MAP_SCALE_CANDIDATES') -or
    ($mapLocator -notmatch 'createExeScaleCandidates') -or
    ($mapLocator -notmatch 'findMapByScaledCorners') -or
    ($mapLocator -notmatch 'limit = Number\.POSITIVE_INFINITY') -or
    ($mapLocator -notmatch 'isValidInGameMapFrame') -or
    ($mapCore -notmatch 'function isValidInGameMapFrame') -or
    ($mapLocator -notmatch 'normalizeMapCapture') -or
    ($mapCore -notmatch 'findMapCandidatesByCorners') -or
    ($mapCore -notmatch 'scales = \[1\]') -or
    ($mapCore -notmatch 'rightX \+ 1 < image\.width') -or
    ($mapLocator -notmatch 'bindFindSubImg') -or
    ($mapLocator -notmatch 'readableRooms')) {
    throw 'Scale-aware anchor-first Alt1 map location with readable-room validation is missing.'
}
if (($mapLocator -notmatch 'allowEmpty') -or
    ($mapCore -notmatch 'tolerant') -or
    ($app -notmatch 'rooms unreadable')) {
    throw 'Scaled-client map locking (allowEmpty), tolerant room classification and the framed-but-unreadable hold are missing.'
}
if (($mapLocator -notmatch 'readableRooms === 1 && !gameMap\.base') -or
    ($rpmState -notmatch 'singleBaseAfterProgress') -or
    ($app -notmatch 'pendingFloorReset') -or
    ($app -notmatch 'evaluateMapTransition')) {
    throw 'Map detection must reject one-room non-base false positives and only reset floors on a single base room.'
}
if (($overlay -notmatch 'overlayScale') -or
    ($overlay -notmatch 'floor\.imageHeight \* scale') -or
    ($app -notmatch 'overlayScale:\s*state\.calibration\.scale') -or
    ($app -notmatch 'state\.calibration\?\.captureHeight \?\? state\.calibration\?\.floor\.imageHeight')) {
    throw 'Native overlays must use the calibrated UI scale so the stats strip is placed under scaled RuneScape maps.'
}
if (-not (Test-Path (Join-Path $appRoot 'THIRD_PARTY_NOTES.md')) -or
    ((Get-Content (Join-Path $appRoot 'THIRD_PARTY_NOTES.md') -Raw) -notmatch 'Sleepy-meh-alt-1/dg-map') -or
    ((Get-Content (Join-Path $appRoot 'THIRD_PARTY_NOTES.md') -Raw) -notmatch 'miseenplac/dghelper') -or
    ((Get-Content (Join-Path $appRoot 'THIRD_PARTY_NOTES.md') -Raw) -notmatch '80c9c6ced28c9a591d237749ef8c0ca06c6db615')) {
    throw 'Third-party attribution for adapted map/results detection is missing.'
}
if (($partyAnchor -notmatch 'function readPartyByAnchor') -or
    ($partyAnchor -notmatch 'function findDgIcon') -or
    ($partyAnchor -notmatch 'function locatePartyRows') -or
    ($partyAnchor -notmatch 'bindFindSubImg') -or
    ($partyAnchor -notmatch 'CHATBOX_FONT_CONFIG') -or
    ($app -notmatch 'readPartyByAnchor') -or
    ($app -notmatch 'loadChatboxFont')) {
    throw 'The sprite-anchor party reader (dg-map approach) and chatbox font loader must stay wired into the app.'
}
if (-not (Test-Path (Join-Path $appRoot 'assets\fonts\chatbox\12pt.data.png'))) {
    throw 'The chatbox OCR font asset is missing.'
}

$ocrAssets = @('WinterfaceMarker.png')
$ocrAssets += 0..9 | ForEach-Object { "Base$_.png" }
$ocrAssets += 0..9 | ForEach-Object { "Small$_.png" }
$ocrAssets += @('SmallPlus.png', 'SmallMinus.png', 'SmallColon.png')
$ocrAssets += 0..9 | ForEach-Object { "Large$_.png" }
$ocrAssets += 'LargeComma.png'
$missingAssets = @($ocrAssets | Where-Object { -not (Test-Path (Join-Path $appRoot "assets\winterface\$_")) })
if ($missingAssets.Count -ne 0) {
    throw "Missing OCR assets: $($missingAssets -join ', ')"
}

Write-Output "Validated $($signatureMatches.Count) room signatures, $paletteColorCount marker colors, $($domIds.Count) DOM references, the Alt1 manifest and $($ocrAssets.Count) OCR assets."
