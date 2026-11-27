param(
  [Parameter(Mandatory = $true)][string]$Spec,
  [string]$Plan = '',
  [Parameter(Mandatory = $true)][ValidateSet('register', 'needs', 'cycle', 'final')][string]$Step,
  [Parameter(Mandatory = $true)][ValidateSet('applied', 'not-applied')][string]$Outcome,
  [Parameter(Mandatory = $true)][string]$StateFile,
  [string]$Note = ''
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$specJson = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Spec))).TrimStart([char]0xFEFF) | ConvertFrom-Json -ErrorAction Stop
if ($Step -ne 'register' -and -not $Plan) { throw 'The exact plan number is required' }
if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) { throw 'A fresh server state file is required (read the server after the attempt)' }
$lock = Enter-PlanLedgerLock $specJson
try {
  $dir = Get-PlanLedgerDir $specJson $Plan $Step
  $pending = @(Get-PlanLedgerAttempts $dir | Where-Object { $_.BaseName -like ($specJson.specHash + '-*') -and -not (Get-PlanLedgerOutcome $_) })
  if ($pending.Count -ne 1) { throw 'No unknown write attempt uniquely matches this approved spec and step' }
  $attempt = $pending[0]
  $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $attempt.FullName | ConvertFrom-Json -ErrorAction Stop
  if ($record.specHash -cne $specJson.specHash -or $record.specFileHash -cne (Get-PlanHash $Spec) -or $record.step -ne $Step -or [string]$record.plan -cne $Plan) {
    throw 'The attempt does not match this approved spec and target'
  }
  if (Test-Path -LiteralPath ($attempt.FullName -replace '\.json$', '.outcome.json')) { throw 'An unreadable outcome already exists. Preserve the record for manual review' }
  $state = Get-Item -LiteralPath $StateFile
  $bytes = [IO.File]::ReadAllBytes($state.FullName)
  $reader = [IO.StreamReader]::new([IO.MemoryStream]::new($bytes), [Text.Encoding]::UTF8, $true)
  try { $read = ConvertFrom-PlanResponse ($reader.ReadToEnd()) } catch { throw 'StateFile is not a server state read (lt-plan-state.js output)' }
  finally { $reader.Dispose() }
  $r = $read.r
  if (-not $read.ok -or -not $r.dtl -or $r.plans -isnot [array] -or $r.needs -isnot [array] -or $r.groups -isnot [array] -or $r.subGoals -isnot [array]) { throw 'StateFile is not a complete server state read (lt-plan-state.js output)' }
  if (-not $record.institutionId -or [string]$r.institutionId -cne [string]$record.institutionId) { throw 'StateFile institution does not match the write attempt' }
  if ([string]$r.dtl.ltc -cne [string]$specJson.ltcMgmtNo) { throw 'StateFile shows another recipient than the spec' }
  if ($Step -ne 'register' -and ([string]$r.dtl.no -cne $Plan -or @($r.plans | Where-Object no -CEQ $Plan).Count -ne 1)) { throw 'StateFile shows another plan than the one to resolve' }
  if ($state.LastWriteTimeUtc -le $attempt.LastWriteTimeUtc) { throw 'The state file is older than the unknown attempt; read the server again first' }
  $stateHash = Get-PlanBytesHash $bytes
  Set-PlanLedgerOutcome $attempt.FullName @{ outcome = 'operator-' + $Outcome; stateFile = $state.FullName; stateHash = $stateHash; note = $Note; resolvedAt = [DateTime]::UtcNow.ToString('o') }
  Write-Output (@{ ok = $true; resolved = 1; outcome = 'operator-' + $Outcome } | ConvertTo-Json -Compress)
} finally { $lock.Dispose() }
