param(
  [Parameter(Mandatory = $true)][string]$Spec,
  [string]$Plan = '',
  [string]$Phone = '',
  [string]$InstitutionId = '',
  [switch]$Apply,
  [string]$Approve = '',
  [string]$RunDir = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$specPath = (Resolve-Path -LiteralPath $Spec).Path
$sp = Get-Content -Raw -Encoding UTF8 -LiteralPath $specPath | ConvertFrom-Json
if ($Apply -and ($Approve -cne $sp.specHash -or -not $InstitutionId -or ($Phone -replace '\D','').Length -lt 9)) { throw 'Apply requires exact spec hash, verified institution, and CM phone' }
$checkStep = if ($Plan) { 'update' } else { 'all' }
$previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$checked = python -I (Join-Path $PSScriptRoot 'plan-spec-check.py') $specPath --write-step $checkStep 2>&1 | Out-String; $checkExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($checkExit -ne 0) { throw ('Unresolved draft decisions or rule violations; no workflow started: ' + $checked.Trim()) }
if ($Apply) {
  $planned = if ($Plan) { @('needs','cycle','final') } else { @('register') }
  foreach ($stepName in $planned) {
    $block = Get-PlanLedgerBlock $sp $Plan $stepName
    if ($block) { throw ('Workflow blocked before any browser call (' + $stepName + '): ' + $block) }
  }
}
if (-not $RunDir) { $RunDir = Join-Path (Split-Path $specPath -Parent) ('execution-' + $sp.specHash) }
$RunDir = Join-Path $RunDir ($(if ($Apply) { 'apply-' } else { 'dry-' }) + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
if (-not (Test-Path -LiteralPath $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force | Out-Null }
$workflow = Join-Path $RunDir 'workflow-start.json'
Save-PlanJson $workflow @{ specHash = (Get-PlanHash $specPath); plan = $Plan; startedAt = [DateTime]::UtcNow.ToString('o'); mode = $(if ($Apply) {'apply'} else {'dry'}) }
$expectedPath = Join-Path $RunDir 'expected.json'
Save-PlanJson $expectedPath @{ agreeDate = [string]$sp.agree.agreeDate; phone = $Phone; institutionId = $InstitutionId }
$started = [Diagnostics.Stopwatch]::StartNew(); $status = 'failed'; $steps = @(); $verification = ''; $screenTouched = $false; $parked = $false; $stateCalls = 0; $phaseMs = @{}
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runner = Join-Path $root 'caremanager-rfid-check\scripts\run.ps1'
function Invoke-Step([string]$Stage) {
  $argsStage = @{ Spec = $specPath; Plan = $Plan; Step = $Stage; Phone = $Phone; InstitutionId = $InstitutionId; RunDir = $RunDir }
  if ($Apply) { $argsStage.Apply = $true; $argsStage.Approve = $Approve }
  $raw = & (Join-Path $PSScriptRoot 'lt-plan-write.ps1') @argsStage | Out-String -Width 1000000
  return ConvertFrom-PlanResponse $raw
}
try {
  $screenTouched = $true
  if (-not $Plan) {
    $result = Invoke-Step 'register'; $steps += $result.summaryFile
    if (-not $Apply) { $status = 'dry-register-only' } else {
      if (@($result.r.created).Count -ne 1) { throw 'Created plan not uniquely identified' }
      $Plan = [string]$result.r.created[0]
    }
  }
  if ($Plan) {
    foreach ($stage in @('select','writer','needs','cycle','final')) { $result = Invoke-Step $stage; $steps += $result.summaryFile }
    if ($Apply) {
      foreach ($stage in @('select','writer')) { $result = Invoke-Step $stage; $steps += $result.summaryFile }
      $phase = [Diagnostics.Stopwatch]::StartNew(); $stateCalls++
      $state = Invoke-PlanBrowser $runner (Join-Path $PSScriptRoot 'lt-plan-state.js')
      $phaseMs.state = $phase.ElapsedMilliseconds
      if (-not $state.ok) { throw 'Independent state read failed' }
      $statePath = Join-Path $RunDir 'verified-state.json'; Save-PlanJson $statePath $state
      $verification = Join-Path $RunDir 'verification.json'
      $phase.Restart()
      $previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      $raw = python -I (Join-Path $PSScriptRoot 'lt-plan-verify.py') --state $statePath --spec $specPath --plan $Plan --expected $expectedPath 2>&1 | Out-String -Width 1000000
      $verifyExit = $LASTEXITCODE; $ErrorActionPreference = $previousPreference
      $phaseMs.verify = $phase.ElapsedMilliseconds
      $checked = ConvertFrom-PlanResponse $raw; Save-PlanJson $verification $checked
      if ($verifyExit -ne 0 -or -not $checked.ok) { $status = 'verification-mismatch'; throw 'Independent verification mismatch; no automatic retry' }
      $status = 'verified'
    } else { $status = 'dry' }
  }
} finally {
  if ($screenTouched) {
    try { $result = Invoke-Step 'park'; $steps += $result.summaryFile; $parked = $true } catch { $parked = $false }
  }
  $browserCalls = $stateCalls
  $summaryErrors = @()
  foreach ($file in (Get-ChildItem -LiteralPath $RunDir -File -Filter '*-summary-*.json')) {
    try {
      $stepSummary = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName | ConvertFrom-Json -ErrorAction Stop
      if (-not $stepSummary.status) { throw 'Missing step status' }
      if ($Apply -and $status -eq 'failed' -and $stepSummary.status -eq 'unknown') { $status = 'unknown' }
      $browserCalls += $stepSummary.calls
    } catch { $summaryErrors += $file.Name }
  }
  if ($summaryErrors.Count) { $status = if ($Apply) { 'unknown' } else { 'failed' } }
  if ($status -in @('verified','dry','dry-register-only') -and -not $parked) { $status = 'park-failed' }
  Save-PlanJson (Join-Path $RunDir 'workflow-summary.json') @{ status = $status; plan = $Plan; specHash = $sp.specHash; elapsedMs = $started.ElapsedMilliseconds; browserCalls = $browserCalls; phaseMs = $phaseMs; steps = $steps; verificationFile = $verification; parked = $parked; autoRetry = $false; summaryErrors = $summaryErrors }
  Write-Output (@{ ok = ($status -in @('verified','dry','dry-register-only')); status = $status; plan = $Plan; summaryFile = (Join-Path $RunDir 'workflow-summary.json') } | ConvertTo-Json -Compress)
}
if ($status -eq 'park-failed') { throw 'Final park failed; workflow not complete' }
