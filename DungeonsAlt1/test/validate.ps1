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

$paletteBlock = [regex]::Match(
    $mapCore,
    'const GROUP_GATESTONE_PALETTE = new Set\(\[(?<colors>[\s\S]*?)\]\);')
if (-not $paletteBlock.Success) {
    throw 'The group gatestone palette is missing from map-core.js.'
}

$webPalette = [System.Collections.Generic.HashSet[int]]::new()
[regex]::Matches($paletteBlock.Groups['colors'].Value, '0x[0-9A-Fa-f]{6}') | ForEach-Object {
    [void]$webPalette.Add([Convert]::ToInt32($_.Value.Substring(2), 16))
}

$assetPalette = [System.Collections.Generic.HashSet[int]]::new()
$groupGatestone = [System.Drawing.Bitmap]::FromFile((Join-Path $repoRoot 'Common\Resources\Gatestones\GroupGatestone.png'))
try {
    for ($y = 0; $y -lt $groupGatestone.Height; $y++) {
        for ($x = 0; $x -lt $groupGatestone.Width; $x++) {
            $color = $groupGatestone.GetPixel($x, $y)
            $max = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
            $min = [Math]::Min($color.R, [Math]::Min($color.G, $color.B))
            if ($color.A -gt 160 -and $max -ge 35 -and $max -le 220 -and ($max - $min) -ge 25) {
                $bucket = (([int]($color.R / 16)) -shl 16) -bor (([int]($color.G / 16)) -shl 8) -bor [int]($color.B / 16)
                [void]$assetPalette.Add($bucket)
            }
        }
    }
}
finally {
    $groupGatestone.Dispose()
}

if (-not $webPalette.SetEquals($assetPalette)) {
    throw "Group gatestone palette mismatch. Web=$($webPalette.Count), asset=$($assetPalette.Count)"
}

$html = Get-Content (Join-Path $appRoot 'index.html') -Raw
$app = Get-Content (Join-Path $appRoot 'app.js') -Raw
$domIds = @([regex]::Matches($app, 'querySelector\("#(?<id>[a-z0-9-]+)"\)') | ForEach-Object { $_.Groups['id'].Value })
$missingDomIds = @($domIds | Where-Object { $html -notmatch ('id="' + [regex]::Escape($_) + '"') })
if ($missingDomIds.Count -ne 0) {
    throw "Missing DOM ids: $($missingDomIds -join ', ')"
}

if ($app -match 'api\.rs[XY]' -or $app -match 'clientToOverlay') {
    throw 'Native Alt1 overlays must use RuneScape-client capture coordinates directly, without rsX/rsY offsets.'
}
if ($app -match 'overLayTextEx\([^;]*undefined') {
    throw 'Native Alt1 overlay text must pass an explicit font string to overLayTextEx.'
}
if ($app -notmatch 'function mixColor\(r, g, b\)' -or $app -match 'mixColor\([^\)]*,[^\)]*,[^\)]*,[^\)]*\)') {
    throw 'Native Alt1 overlay colors must use 24-bit RGB values without an alpha channel.'
}
if ($app -notmatch 'overLayFreezeGroup' -or $app -notmatch 'overLayRefreshGroup') {
    throw 'Native Alt1 overlay groups must use the proven freeze-and-refresh lifecycle.'
}
if ($app -notmatch 'overLaySetGroup\(""\)') {
    throw 'Native Alt1 overlay rendering must reset the active group after drawing.'
}

$manifest = Get-Content (Join-Path $appRoot 'appconfig.json') -Raw | ConvertFrom-Json
foreach ($relativePath in $manifest.appUrl, $manifest.configUrl, $manifest.iconUrl) {
    if (-not (Test-Path (Join-Path $appRoot $relativePath))) {
        throw "Manifest target does not exist: $relativePath"
    }
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

Write-Output "Validated $($signatureMatches.Count) room signatures, $($webPalette.Count) gatestone colors, $($domIds.Count) DOM references, the Alt1 manifest and $($ocrAssets.Count) OCR assets."
