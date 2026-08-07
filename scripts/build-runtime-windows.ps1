[CmdletBinding()]
param(
    [ValidateSet('js', 'typescript', 'lua', 'luau', 'all')]
    [string]$Language = 'all'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = if ($env:RUNEWEAVE_DIST_DIR) { [System.IO.Path]::GetFullPath($env:RUNEWEAVE_DIST_DIR) } else { Join-Path $RepoRoot 'dist/runtimes' }
$TargetDir = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $RepoRoot 'target' }
$Package = 'bevy-runeweave-runtime-cdylib'
$Languages = if ($Language -eq 'all') { @('js', 'typescript', 'lua', 'luau') } else { @($Language) }

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

function Get-RustHostTarget {
    $hostLine = rustc -vV | Where-Object { $_ -like 'host: *' } | Select-Object -First 1
    if (-not $hostLine) { throw 'Unable to determine the Rust host target.' }
    return $hostLine.Substring(6).Trim()
}

function Assert-RustTargetInstalled {
    param([string]$Target)
    if ($Target -notin @(rustup target list --installed)) {
        throw "Rust target '$Target' is not installed; run: rustup target add $Target"
    }
}

function Get-AssetDirectory {
    param([string]$RuntimeLanguage)
    $project = if ($RuntimeLanguage -eq 'typescript') { 'ts' } else { $RuntimeLanguage }
    return Join-Path $RepoRoot "projects/$project/assets"
}

function New-PackageDirectory {
    param([string]$RuntimeLanguage, [string]$Target)
    $destination = [System.IO.Path]::GetFullPath((Join-Path $DistRoot "windows/$RuntimeLanguage/$Target"))
    $distPrefix = $DistRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $destination.StartsWith($distPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace output outside $DistRoot"
    }
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $destination 'lib') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'include/game_runtime.h') -Destination $destination
    Copy-Item -LiteralPath (Get-AssetDirectory $RuntimeLanguage) -Destination (Join-Path $destination 'assets') -Recurse
    return $destination
}

function Build-Runtime {
    param([string]$RuntimeLanguage, [string]$Target, [string]$HostTarget)
    Assert-RustTargetInstalled $Target
    $destination = New-PackageDirectory $RuntimeLanguage $Target
    Write-Host "Building windows/$RuntimeLanguage for $Target"

    $buildCommand = 'build'
    if ($Target -ne $HostTarget) {
        if (-not (Get-Command zig -ErrorAction SilentlyContinue)) {
            throw "Zig is required for cross target $Target. Install Zig and cargo-zigbuild."
        }
        Invoke-Checked cargo @('zigbuild', '--help')
        $buildCommand = 'zigbuild'
    }
    Invoke-Checked cargo @(
        $buildCommand, '--release', '--lib', '-p', $Package,
        '--no-default-features', '--features', $RuntimeLanguage, '--target', $Target
    )

    $artifactDirectory = Join-Path $TargetDir "$Target/release"
    $artifacts = @(Get-ChildItem -LiteralPath $artifactDirectory -Filter '*.dll' -File)
    if ($artifacts.Count -eq 0) { throw "No runtime DLLs found in $artifactDirectory" }
    Copy-Item -LiteralPath $artifacts.FullName -Destination (Join-Path $destination 'lib')
    @(
        "package=$Package"
        'platform=windows'
        "language=$RuntimeLanguage"
        "target=$Target"
        'profile=release'
    ) | Set-Content -LiteralPath (Join-Path $destination 'build-info.txt') -Encoding ascii
}

foreach ($requiredCommand in @('cargo', 'rustc', 'rustup')) {
    if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $requiredCommand"
    }
}

$hostTarget = Get-RustHostTarget
$targets = if ($env:WINDOWS_TARGETS) { @($env:WINDOWS_TARGETS.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } else { @($hostTarget) }
New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
foreach ($runtimeLanguage in $Languages) {
    foreach ($target in $targets) { Build-Runtime $runtimeLanguage $target $hostTarget }
}
Write-Host "Runtime packages are available under $DistRoot"
