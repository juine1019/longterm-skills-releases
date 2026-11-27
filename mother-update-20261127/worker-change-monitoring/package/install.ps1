[CmdletBinding()]
param([string]$SkillRoot, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-manifest.json') -Raw | ConvertFrom-Json
if (-not $SkillRoot) {
    $codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
    $SkillRoot = Join-Path $codexRoot 'skills'
}
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
foreach ($entry in $manifest.files) {
    $path = [IO.Path]::GetFullPath((Join-Path $packageRoot $entry.path))
    if (-not $path.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'PACKAGE_PATH_INVALID' }
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PACKAGE_LINK_REJECTED' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('HASH_MISMATCH: ' + $entry.path) }
}
if ($VerifyOnly) { Write-Output 'PACKAGE_VERIFIED'; return }
$target = Join-Path ([IO.Path]::GetFullPath($SkillRoot)) 'care-worker-change-monitoring'
$skillFiles = @($manifest.files | Where-Object { $_.path.StartsWith('care-worker-change-monitoring/') })
if (Test-Path -LiteralPath $target) {
    foreach ($entry in $skillFiles) {
        $relative = $entry.path.Substring('care-worker-change-monitoring/'.Length)
        $existing = Join-Path $target $relative
        if (-not (Test-Path -LiteralPath $existing -PathType Leaf)) { throw 'EXISTING_SKILL_DIFFERS_PRESERVED' }
        if ((Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'EXISTING_SKILL_DIFFERS_PRESERVED' }
    }
    Write-Output ('ALREADY_INSTALLED: ' + $target)
    return
}
New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
foreach ($entry in $skillFiles) {
    $relative = $entry.path.Substring('care-worker-change-monitoring/'.Length)
    $destination = Join-Path $target $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry.path) -Destination $destination -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'INSTALLED_HASH_MISMATCH' }
}
[pscustomobject]@{ status='INSTALLED'; version=$manifest.version; path=$target; workspaceChanged=$false } | ConvertTo-Json
