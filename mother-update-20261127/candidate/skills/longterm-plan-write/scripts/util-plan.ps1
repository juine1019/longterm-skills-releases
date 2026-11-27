param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$OutDir, [string]$FileIds = '')
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$skillRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$run = Join-Path $skillRoot 'caremanager-rfid-check\scripts\run.ps1'
try {
  $j = Invoke-PlanBrowser $run (Join-Path $PSScriptRoot 'cm-utilplan-fetch.js') @{ name = $Name; fileIds = $FileIds }
  if (-not $j.ok) { throw 'CM download failed' }
  $r = $j.out
  if ($r.status -in @('missing', 'selection-required')) { Write-Output (@{ status = $r.status; files = @($r.files) } | ConvertTo-Json -Depth 8 -Compress); return }
  if ($r.status -ne 'found' -or -not @($r.pdfs).Count) { throw 'No verified PDF response' }
  $folder = Join-Path $OutDir ('pdf-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $folder -Force -ErrorAction Stop | Out-Null
  $results = @(); $k = 0
  foreach ($f in @($r.pdfs)) {
    $k++; $pdf = Join-Path $folder ('file-' + $k + '.pdf')
    [IO.File]::WriteAllBytes($pdf, [Convert]::FromBase64String($f.b64))
    $raw = python -I (Join-Path $PSScriptRoot 'util-plan-render.py') $pdf (Join-Path $folder ('file-' + $k)) 2>&1 | Out-String -Width 1000000
    if ($LASTEXITCODE -ne 0) { throw 'PDF extraction failed; no successful result issued' }
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    if (-not @($parsed.pages).Count) { throw 'PDF pages missing' }
    foreach ($page in $parsed.pages) {
      if (-not $page.text -and (-not $page.png -or -not (Test-Path -LiteralPath $page.png -PathType Leaf))) { throw 'Missing rendered page' }
    }
    $results += @{ id = $f.id; name = $f.name; pdf = $pdf; sha256 = $parsed.sha256; pages = @($parsed.pages) }
  }
  $result = @{ status = 'found'; ltc = $r.ltc; collectedAt = [DateTime]::UtcNow.ToString('o'); files = @($r.files); pdfs = $results; selectionRequired = $true }
  Save-PlanJson (Join-Path $folder 'pdf-manifest.json') $result
  Write-Output ($result | ConvertTo-Json -Depth 20 -Compress)
} catch {
  Write-Output (@{ status = 'error'; reason = $_.Exception.Message } | ConvertTo-Json -Compress)
  throw
}
