param(
  [Parameter(Mandatory = $true)][string]$Spec,
  [string]$Plan = '',
  [Parameter(Mandatory = $true)][ValidateSet('register', 'select', 'park', 'writer', 'needs', 'cycle', 'final', 'read')][string]$Step,
  [switch]$Apply,
  [string]$Approve = '',
  [string]$Phone = '',
  [string]$ForceMissing = '',
  [switch]$AllowRemove,
  [string]$RunDir = '',
  [string]$InstitutionId = ''
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$skillRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$run = Join-Path $skillRoot 'caremanager-rfid-check\scripts\run.ps1'
$bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Spec))
$sourceHash = Get-PlanBytesHash $bytes
$specJson = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
$writing = $Apply -and $Step -in @('register','needs','cycle','final')
$checkArgs = @('-I', (Join-Path $PSScriptRoot 'plan-spec-check.py'), $Spec)
if ($writing) { $checkArgs += @('--write-step', $Step) }
$previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$checked = python @checkArgs 2>&1 | Out-String; $checkExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($checkExit -ne 0) { throw ('Spec check failed; browser not called: ' + $checked.Trim()) }
if ($checked.Trim() -cne $specJson.specHash) { throw 'Spec content/hash mismatch; browser not called' }
if ($Apply -and $Approve -cne $specJson.specHash) { throw 'Apply requires the exact spec hash' }
if ($Apply -and -not $InstitutionId) { throw 'Apply requires the currently verified InstitutionId' }
if ($Step -eq 'register' -and -not $specJson.reason) { throw 'Writing reason not selected; browser not called' }
if ($Step -in @('select','writer','needs','cycle','final') -and -not $Plan) { throw 'The exact plan number is required' }
$ledgerDir = Get-PlanLedgerDir $specJson $Plan $Step
if ($writing) { $block = Get-PlanLedgerBlock $specJson $Plan $Step; if ($block) { throw ('Write blocked before any browser call: ' + $block) } }
if (-not $RunDir) { $RunDir = Join-Path (Split-Path (Resolve-Path $Spec) -Parent) ('execution-' + $specJson.specHash) }
if (-not (Test-Path -LiteralPath $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force | Out-Null }
$bindingPath = Join-Path $RunDir 'binding.json'
if (Test-Path -LiteralPath $bindingPath) {
  $binding = Get-Content -Raw -Encoding UTF8 -LiteralPath $bindingPath | ConvertFrom-Json
  if ($binding.specHash -cne $sourceHash) { throw 'Run directory belongs to a different spec' }
} else { Save-PlanJson $bindingPath @{ specHash = $sourceHash; createdAt = [DateTime]::UtcNow.ToString('o') } }
$attemptPath = ''; $ledgerAttempt = ''; $ledgerLock = $null
$ms = New-Object IO.MemoryStream; $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress); $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
$b64 = 'gz:' + [Convert]::ToBase64String($ms.ToArray())
$mode = if ($Apply) { 'apply' } else { 'dry' }
$scriptJs = if ($Step -eq 'register') { 'lt-plan-register.js' } elseif ($Step -eq 'park') { 'lt-plan-park.js' } else { 'lt-plan-step.js' }
$clock = [Diagnostics.Stopwatch]::StartNew(); $calls = 0; $phaseMs = @{}; $status = 'failed-before-write'; $resultFile = ''
$summaryFile = Join-Path $RunDir ($Step + '-summary-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  if ($writing) {
    $ledgerLock = Enter-PlanLedgerLock $specJson
    $block = Get-PlanLedgerBlock $specJson $Plan $Step
    if ($block) { throw ('Write blocked: ' + $block) }
  }
  $phase = [Diagnostics.Stopwatch]::StartNew(); $calls++
  $opened = Invoke-PlanBrowser $run (Join-Path $PSScriptRoot 'lt-plan-open.js')
  $phaseMs.open = $phase.ElapsedMilliseconds
  if (-not $opened.ok) { throw 'LT screen open failed' }
  if ($InstitutionId -and $opened.r.institutionId -cne $InstitutionId) { throw 'LT institution mismatch' }
  if ((Get-PlanHash $Spec) -cne $sourceHash) { throw 'Spec changed after validation' }
  if ($writing) {
    $status = 'unknown'
    $ledgerAttempt = New-PlanLedgerAttempt $ledgerDir $specJson.specHash @{ step = $Step; plan = $Plan; specHash = $specJson.specHash; specFileHash = $sourceHash; creationRequestId = [string]$specJson.creationIntent.requestId; runDir = $RunDir; institutionId = $InstitutionId; startedAt = [DateTime]::UtcNow.ToString('o') }
    $attemptPath = Join-Path $RunDir ($Step + '-attempt-' + (Split-Path $ledgerAttempt -Leaf))
    Save-PlanJson $attemptPath @{ step = $Step; plan = $Plan; specHash = $sourceHash; ledger = $ledgerAttempt; startedAt = [DateTime]::UtcNow.ToString('o'); status = 'started-outcome-unconfirmed' }
  }
  $phase.Restart(); $calls++
  $j = Invoke-PlanBrowser $run (Join-Path $PSScriptRoot $scriptJs) @{ step = $Step; mode = $mode; plan = $Plan; spec = $b64; approve = $Approve; phone = $Phone; institutionId = $InstitutionId; forceMissing = $ForceMissing; allowRemove = $(if ($AllowRemove) { '1' } else { '0' }) }
  $phaseMs.step = $phase.ElapsedMilliseconds
  $resultFile = Join-Path $RunDir ($Step + '-result-' + [guid]::NewGuid().ToString('N') + '.json')
  Save-PlanJson $resultFile $j
  if ($writing) {
    $trace = $j.r.log
    $notSent = $trace -and $trace.saveCalled -is [bool] -and -not $trace.saveCalled -and -not $trace.uncertain -and $trace.sent -is [array] -and $trace.sent.Count -eq 0
    if ($j.ok -and $j.r.status -eq 'ok') { Set-PlanLedgerOutcome $ledgerAttempt @{ outcome = 'ok'; created = @($j.r.created); resultFile = $resultFile; at = [DateTime]::UtcNow.ToString('o') } }
    elseif ($notSent) { Set-PlanLedgerOutcome $ledgerAttempt @{ outcome = 'not-sent'; reason = [string]$j.r.reason; resultFile = $resultFile; at = [DateTime]::UtcNow.ToString('o') }; $status = 'failed-not-sent' }
  }
  if (-not $j.ok -or $j.r.status -ne 'ok') { throw 'Step failed; inspect local result and compare server before any retry' }
  $status = if ($writing) { 'step-ok-needs-independent-verification' } else { 'ok' }
  $j | Add-Member -NotePropertyName resultFile -NotePropertyValue $resultFile
  $j | Add-Member -NotePropertyName summaryFile -NotePropertyValue $summaryFile
  $j.r.PSObject.Properties.Remove('telCols')
  $j.r.PSObject.Properties.Remove('log')
  $j | ConvertTo-Json -Depth 30 -Compress
} finally {
  if ($ledgerLock) { $ledgerLock.Dispose() }
  Save-PlanJson $summaryFile @{ step = $Step; mode = $mode; plan = $Plan; specHash = $sourceHash; status = $status; calls = $calls; phaseMs = $phaseMs; elapsedMs = $clock.ElapsedMilliseconds; resultFile = $resultFile; attemptFile = $(if ($writing) { $attemptPath } else { '' }) }
}
