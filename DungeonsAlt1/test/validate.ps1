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
    ($mapCore -notmatch 'jawMatches < 2 && redMatches < 10')) {
    throw 'Shift-tolerant boss-skull detection is missing from map-core.js.'
}

$html = Get-Content (Join-Path $appRoot 'index.html') -Raw
$styles = Get-Content (Join-Path $appRoot 'styles.css') -Raw
$app = Get-Content (Join-Path $appRoot 'app.js') -Raw
$overlay = Get-Content (Join-Path $appRoot 'src\alt1-overlay.js') -Raw
$partyCore = Get-Content (Join-Path $appRoot 'src\party-core.js') -Raw
$partyInterface = Get-Content (Join-Path $appRoot 'src\party-interface.js') -Raw
$teamSync = Get-Content (Join-Path $appRoot 'src\team-sync.js') -Raw
$teamGates = Get-Content (Join-Path $appRoot 'src\team-gates.js') -Raw
$partyMenu = Get-Content (Join-Path $appRoot 'src\party-menu.js') -Raw
$resultsCore = Get-Content (Join-Path $appRoot 'src\results-core.js') -Raw
$fileSaver = Get-Content (Join-Path $appRoot 'src\file-saver.js') -Raw
$winterface = Get-Content (Join-Path $appRoot 'src\winterface.js') -Raw
$mapLocator = Get-Content (Join-Path $appRoot 'src\alt1-map-locator.js') -Raw
$nativeOverlaySource = $app + "`n" + $overlay
$runtimeSource = $app + "`n" + $overlay + "`n" + $partyCore + "`n" + $partyInterface + "`n" + $teamSync + "`n" + $teamGates + "`n" + $partyMenu + "`n" + $resultsCore + "`n" + $fileSaver + "`n" + $winterface + "`n" + $mapLocator
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
if ($app -notmatch 'gatestones:\s*elements\.rpmOnly\.checked \? \[\] : collectGatestoneMarkers' -or
    $overlay -notmatch 'for \(const marker of gatestones\)') {
    throw 'Native RuneScape overlay must draw gatestones normally and suppress them in RPM-only mode.'
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
if (($html -match 'id="auto-room"') -or
    ($app -match 'syncAutomaticPartyRoom') -or
    ($app -match 'teamSync\.connect\(status\.roomCode')) {
    throw 'Automatic party-room joining must stay removed from the active Alt1 UI and app workflow.'
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
    ($html -notmatch 'party-scan-option" hidden') -or
    ($html -notmatch 'party-scan-tools" hidden') -or
    ($styles -notmatch '\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}') -or
    ($html -notmatch 'id="party-scan"') -or
    ($html -notmatch 'id="party-forget"') -or
    ($app -notmatch 'partyInterface\.checked')) {
    throw 'RuneScape party-position helper code must remain available while the helper UI stays hidden.'
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
    ($html -match 'id="auto-track-results"[^>]*checked') -or
    ($html -match 'id="auto-save-map-png"[^>]*checked') -or
    ($html -match 'id="auto-save-results-png"[^>]*checked') -or
    ($html -match 'id="rpm-only"[^>]*checked')) {
    throw 'Dungeon results auto tracking and PNG export options must exist and default off.'
}
if (($app -notmatch 'autoCaptureDungeonResults') -or
    ($app -notmatch 'readDungeonResultsCapture') -or
    ($app -notmatch 'saveResultArtifacts') -or
    ($app -notmatch 'cropImageData') -or
    ($app -notmatch 'writePngToSaveFolder') -or
    ($app -match 'downloadDataUrl') -or
    ($app -match '\.download\s*=') -or
    ($app -match '\.click\(\)') -or
    ($fileSaver -notmatch 'showDirectoryPicker') -or
    ($fileSaver -notmatch 'indexedDB') -or
    ($fileSaver -notmatch 'writeDataUrlToFolder') -or
    ($app -notmatch 'map-folder') -or
    ($app -notmatch 'results-folder') -or
    ($app -notmatch 'resultsBusy') -or
    ($app -notmatch 'autoResultKeys') -or
    ($app -notmatch 'commitDungeonResultsCapture') -or
    ($app -notmatch 'prepareResultBatch') -or
    ($resultsCore -notmatch 'averageResultTime') -or
    ($resultsCore -notmatch 'resultMatchesFloorFilter') -or
    ($resultsCore -notmatch 'RESULT_THEME_RANGES') -or
    ($resultsCore -notmatch 'resultBatchStatus') -or
    ($resultsCore -notmatch 'nextAutoResultState') -or
    ($resultsCore -notmatch 'plannedResultExports')) {
    throw 'Automatic dungeon-results capture, dedupe and folder-based PNG export are incomplete.'
}
if (($winterface -notmatch 'readWithOffset') -or
    ($winterface -notmatch 'WINTERFACE_WIDTH = 512') -or
    ($winterface -notmatch 'WINTERFACE_HEIGHT = 334') -or
    ($app -notmatch 'offset\.x, offset\.y, width, height')) {
    throw 'Winterface reads must expose their offset so the cropped results PNG matches the detected interface.'
}
if (($app -notmatch 'map-core\.js\?v=20260624-1') -or
    ($app -notmatch 'alt1-map-locator\.js\?v=20260624-1') -or
    ($app -notmatch 'team-sync\.js\?v=20260624-1') -or
    ($app -notmatch 'party-core\.js\?v=20260624-1') -or
    ($app -notmatch 'results-core\.js\?v=20260624-1') -or
    ($app -notmatch 'party-menu\.js\?v=20260624-1') -or
    ($app -notmatch 'team-gates\.js\?v=20260624-1') -or
    ($app -notmatch 'file-saver\.js\?v=20260624-1') -or
    ($teamSync -notmatch 'party-core\.js\?v=20260624-1') -or
    ($teamGates -notmatch 'party-core\.js\?v=20260624-1') -or
    ($teamGates -notmatch 'alt1-overlay\.js\?v=20260624-1') -or
    ($mapLocator -notmatch 'map-core\.js\?v=20260624-1')) {
    throw 'Changed Alt1 runtime modules must be cache-busted for existing Alt1 installations.'
}
if (($app -notmatch 'buildVisibleRemoteGatestones') -or
    ($teamGates -notmatch 'source: "team"') -or
    ($teamGates -match 'source: "local"') -or
    ($app -notmatch 'local gates detected .*synced') -or
    ($app -notmatch 'remote gates visible')) {
    throw 'Local gatestones must sync without being included in either visible map overlay.'
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
    ($app -notmatch 'scoreMapCandidate') -or
    ($app -notmatch 'normalizeMapCapture') -or
    ($app -notmatch 'MAP_SCALE_CANDIDATES') -or
    ($app -notmatch 'function findMapInRuneScapeClient') -or
    ($mapLocator -notmatch 'MAP_ANCHOR') -or
    ($mapLocator -notmatch 'MAP_SCALE_CANDIDATES') -or
    ($mapLocator -notmatch 'createExeScaleCandidates') -or
    ($mapLocator -notmatch 'findMapByScaledCorners') -or
    ($mapLocator -notmatch 'normalizeMapCapture') -or
    ($mapCore -notmatch 'findMapCandidatesByCorners') -or
    ($mapCore -notmatch 'scales = \[1\]') -or
    ($mapCore -notmatch 'rightX \+ 1 < image\.width') -or
    ($mapLocator -notmatch 'bindFindSubImg') -or
    ($mapLocator -notmatch 'readableRooms')) {
    throw 'Scale-aware anchor-first Alt1 map location with readable-room validation is missing.'
}
if (($mapLocator -notmatch 'readableRooms === 1 && !gameMap\.base') -or
    ($app -notmatch 'singleBaseRoom') -or
    ($app -notmatch 'pendingFloorReset') -or
    ($app -notmatch 'function shouldResetForNewFloor')) {
    throw 'Map detection must reject one-room non-base false positives and only reset floors on a single base room.'
}
if (($overlay -notmatch 'overlayScale') -or
    ($overlay -notmatch 'floor\.imageHeight \* scale') -or
    ($app -notmatch 'overlayScale:\s*state\.calibration\.scale') -or
    ($app -notmatch 'state\.calibration\?\.captureHeight \?\? state\.calibration\?\.floor\.imageHeight')) {
    throw 'Native overlays must use the calibrated UI scale so the stats strip is placed under scaled RuneScape maps.'
}
if (-not (Test-Path (Join-Path $appRoot 'THIRD_PARTY_NOTES.md')) -or
    ((Get-Content (Join-Path $appRoot 'THIRD_PARTY_NOTES.md') -Raw) -notmatch 'Sleepy-meh-alt-1/dg-map')) {
    throw 'Third-party attribution for the adapted map-anchor locator is missing.'
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
