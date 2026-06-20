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

$html = Get-Content (Join-Path $appRoot 'index.html') -Raw
$app = Get-Content (Join-Path $appRoot 'app.js') -Raw
$domIds = @([regex]::Matches($app, 'querySelector\("#(?<id>[a-z0-9-]+)"\)') | ForEach-Object { $_.Groups['id'].Value })
$missingDomIds = @($domIds | Where-Object { $html -notmatch ('id="' + [regex]::Escape($_) + '"') })
if ($missingDomIds.Count -ne 0) {
    throw "Missing DOM ids: $($missingDomIds -join ', ')"
}

if ($app -match 'api\.rs[XY]\s*\+\s*state\.calibration') {
    throw 'Native Alt1 overlays must use RuneScape-client-relative coordinates, not rsX/rsY screen offsets.'
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

Write-Output "Validated $($signatureMatches.Count) room signatures, $($domIds.Count) DOM references, the Alt1 manifest and $($ocrAssets.Count) OCR assets."
