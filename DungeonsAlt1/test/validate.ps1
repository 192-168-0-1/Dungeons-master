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
$app = Get-Content (Join-Path $appRoot 'app.js') -Raw
$overlay = Get-Content (Join-Path $appRoot 'src\alt1-overlay.js') -Raw
$partyCore = Get-Content (Join-Path $appRoot 'src\party-core.js') -Raw
$partyInterface = Get-Content (Join-Path $appRoot 'src\party-interface.js') -Raw
$teamSync = Get-Content (Join-Path $appRoot 'src\team-sync.js') -Raw
$teamGates = Get-Content (Join-Path $appRoot 'src\team-gates.js') -Raw
$partyMenu = Get-Content (Join-Path $appRoot 'src\party-menu.js') -Raw
$mapLocator = Get-Content (Join-Path $appRoot 'src\alt1-map-locator.js') -Raw
$nativeOverlaySource = $app + "`n" + $overlay
$runtimeSource = $app + "`n" + $overlay + "`n" + $partyCore + "`n" + $partyInterface + "`n" + $teamSync + "`n" + $teamGates + "`n" + $partyMenu + "`n" + $mapLocator
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
if ($app -notmatch 'gatestones:\s*collectGatestoneMarkers' -or $overlay -notmatch 'for \(const marker of gatestones\)') {
    throw 'Local and team gatestones must be included in the native RuneScape overlay.'
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
    ($teamSync -notmatch 'promoteMember') -or
    ($teamSync -notmatch 'kickMember') -or
    ($teamSync -notmatch 'senderInRoster') -or
    ($app -notmatch 'Only the red host can kick players') -or
    ($app -notmatch 'Only the red host can promote players')) {
    throw 'Manual host roster controls must support promote, kick and sender filtering.'
}
if (($app -notmatch 'team-sync\.js\?v=20260622-12') -or
    ($app -notmatch 'party-core\.js\?v=20260622-12') -or
    ($app -notmatch 'party-menu\.js\?v=20260622-12') -or
    ($app -notmatch 'team-gates\.js\?v=20260622-12') -or
    ($teamSync -notmatch 'party-core\.js\?v=20260622-12') -or
    ($teamGates -notmatch 'party-core\.js\?v=20260622-12')) {
    throw 'Changed team-sync modules must be cache-busted for existing Alt1 installations.'
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
    ($app -notmatch 'scoreMapCandidate') -or
    ($app -notmatch 'function findMapInRuneScapeClient') -or
    ($mapLocator -notmatch 'MAP_ANCHOR') -or
    ($mapLocator -notmatch 'bindFindSubImg') -or
    ($mapLocator -notmatch 'readableRooms')) {
    throw 'Anchor-first Alt1 map location with readable-room validation is missing.'
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
