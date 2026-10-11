param([switch]$SkipArchive, [switch]$ReusePackaged)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$output = Join-Path $project "dist/v$($manifest.version)-shipping"
$installer = Join-Path $output "Via-$($manifest.version)-Setup-x64.exe"
if (Test-Path -LiteralPath $installer) { throw "Release already exists; refusing to overwrite: $installer" }
$env:ELECTRON_BUILDER_CACHE = Join-Path $project '.electron-cache/builder'
$env:ELECTRON_CACHE = Join-Path $project '.electron-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
if (-not $env:ELECTRON_BUILDER_COMPRESSION_LEVEL) { $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '1' }
Push-Location $project
try {
    if ($ReusePackaged) {
        & node 'node_modules/electron-builder/cli.js' --prepackaged (Join-Path $output 'win-unpacked') --config electron-builder.cjs --win nsis --x64 --publish never
    } else {
        & node 'node_modules/electron-builder/cli.js' --config electron-builder.cjs --win nsis --x64 --publish never
    }
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed: $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath $installer)) { throw 'Installer was not generated.' }
    if (-not $SkipArchive) {
        $archive = Join-Path $output "Via-$($manifest.version)-win-x64.zip"
        if (Test-Path -LiteralPath $archive) { throw "Archive already exists; refusing to overwrite: $archive" }
        Compress-Archive -Path (Join-Path $output 'win-unpacked/*') -DestinationPath $archive -CompressionLevel Fastest
    }
    if (-not $SkipArchive) {
        & node 'scripts/audit-release.cjs'
        if ($LASTEXITCODE -ne 0) { throw 'Release audit failed.' }
    }
    $readme = Join-Path $project "release/README-$($manifest.version).md"
    if (Test-Path -LiteralPath $readme) { Copy-Item -LiteralPath $readme -Destination (Join-Path $output 'README.md') }
    Write-Output "RELEASE_DIRECTORY=$output"
} finally { Pop-Location }
