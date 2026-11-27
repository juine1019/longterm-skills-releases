function ConvertFrom-PlanResponse([string]$Text) {
  $items = @(); $depth = 0; $start = -1; $quoted = $false; $escaped = $false
  for ($i = 0; $i -lt $Text.Length; $i++) {
    $c = $Text[$i]
    if ($depth -eq 0) { if ($c -eq '{') { $start = $i; $depth = 1; $quoted = $false }; continue }
    if ($quoted) {
      if ($escaped) { $escaped = $false } elseif ($c -eq '\') { $escaped = $true } elseif ($c -eq '"') { $quoted = $false }
      continue
    }
    if ($c -eq '"') { $quoted = $true } elseif ($c -eq '{') { $depth++ } elseif ($c -eq '}') {
      $depth--
      if ($depth -eq 0) {
        try { $item = $Text.Substring($start, $i - $start + 1) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if ($null -ne $item.PSObject.Properties['ok']) { $items += $item }
      }
    }
  }
  if ($depth -ne 0 -or $items.Count -ne 1) { throw 'Expected exactly one complete browser JSON response' }
  if ($items[0].ok -isnot [bool]) { throw 'Browser ok must be boolean' }
  return $items[0]
}
function Save-PlanJson([string]$Path, $Value) {
  $data = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 60 -Compress))
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($data, 0, $data.Length) } finally { $stream.Dispose() }
}
function Get-PlanHash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Get-PlanBytesHash([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '') } finally { $sha.Dispose() }
}
function Get-PlanTextHash([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16) } finally { $sha.Dispose() }
}
function Get-PlanLedgerRecipientDir($SpecJson) { return Join-Path $env:LOCALAPPDATA ('longterm-plan-write\attempts\' + (Get-PlanTextHash ([string]$SpecJson.ltcMgmtNo))) }
function Enter-PlanLedgerLock($SpecJson) {
  $dir = Get-PlanLedgerRecipientDir $SpecJson
  [void][IO.Directory]::CreateDirectory($dir)
  try { return [IO.File]::Open((Join-Path $dir 'write.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  catch [IO.IOException] { throw 'Another operation holds the recipient write lock, or the lock cannot be opened' }
}
function Get-PlanLedgerDir($SpecJson, [string]$Plan, [string]$Step) {
  $target = if ($Step -eq 'register') { 'register' } else { $Plan + '|' + $Step }
  return Join-Path (Get-PlanLedgerRecipientDir $SpecJson) (Get-PlanTextHash $target)
}
function Get-PlanLedgerAttempts([string]$Dir, [switch]$Recurse) {
  if (-not (Test-Path -LiteralPath $Dir)) { return @() }
  return @(Get-ChildItem -LiteralPath $Dir -File -Filter '*.json' -Recurse:$Recurse | Where-Object { $_.Name -notlike '*.outcome.json' } | Sort-Object LastWriteTimeUtc)
}
function Get-PlanLedgerOutcome($Attempt) {
  $path = Join-Path $Attempt.DirectoryName ($Attempt.BaseName + '.outcome.json')
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  try { $outcome = [string](Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json).outcome } catch { return '' }
  if ($outcome -in @('ok', 'not-sent', 'operator-applied', 'operator-not-applied')) { return $outcome }
  return ''
}
function Get-PlanLedgerBlockIn([string]$RecipientDir, [string]$TargetDir, [string]$SpecHash) {
  foreach ($attempt in (Get-PlanLedgerAttempts $RecipientDir -Recurse)) {
    if (-not (Get-PlanLedgerOutcome $attempt)) { return 'unknown write attempt ' + $attempt.BaseName + ' for this recipient; compare the server and record it with lt-plan-resolve.ps1' }
  }
  foreach ($attempt in (Get-PlanLedgerAttempts $TargetDir | Where-Object { $_.BaseName -like ($SpecHash + '-*') })) {
    $outcome = Get-PlanLedgerOutcome $attempt
    if ($outcome -in @('ok', 'operator-applied')) { return 'this approved spec already wrote this step (' + $outcome + ')' }
  }
  return ''
}
function Get-PlanLedgerBlock($SpecJson, [string]$Plan, [string]$Step) {
  if ($Step -eq 'register' -and $SpecJson.creationIntent.requestId) {
    foreach ($attempt in (Get-PlanLedgerAttempts (Get-PlanLedgerDir $SpecJson $Plan $Step))) {
      $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $attempt.FullName | ConvertFrom-Json -ErrorAction Stop
      if ($record.creationRequestId -ceq $SpecJson.creationIntent.requestId -and (Get-PlanLedgerOutcome $attempt) -in @('ok','operator-applied')) {
        return 'this additional-plan request already registered a plan; inspect its recorded new number'
      }
    }
  }
  return Get-PlanLedgerBlockIn (Get-PlanLedgerRecipientDir $SpecJson) (Get-PlanLedgerDir $SpecJson $Plan $Step) ([string]$SpecJson.specHash)
}
function New-PlanLedgerAttempt([string]$Dir, [string]$SpecHash, $Record) {
  if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
  $n = @(Get-PlanLedgerAttempts $Dir | Where-Object { $_.BaseName -like ($SpecHash + '-*') }).Count + 1
  $path = Join-Path $Dir ($SpecHash + '-' + $n + '.json')
  Save-PlanJson $path $Record
  return $path
}
function Set-PlanLedgerOutcome([string]$AttemptPath, $Record) { Save-PlanJson ($AttemptPath -replace '\.json$', '.outcome.json') $Record }
function Invoke-PlanBrowser([string]$Runner, [string]$Script, [hashtable]$Parameters = @{}) {
  $global:LASTEXITCODE = 0
  $output = & $Runner -Script $Script -Params $Parameters 2>&1 | Out-String -Width 1000000
  if ($LASTEXITCODE -ne 0) { throw 'Browser process failed; inspect local run evidence before retry' }
  return ConvertFrom-PlanResponse $output
}
