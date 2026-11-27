param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$WriteDate = '',
  [string]$From = '',
  [string]$Visits = '',
  [string]$Diff = '',
  [Parameter(Mandatory=$true)][string]$Writer,
  [Parameter(Mandatory=$true)][string]$Job,
  [string]$OutDir = '',
  [string]$PlanNo = '',
  [string]$Reason = '',
  [string]$To = '',
  [switch]$NewContract,
  [string]$OrgName = '',
  [string]$DumpFile = '',
  [string]$ManifestFile = '',
  [string]$ContentFile = '',
  [string]$ContractEnd = '',
  [string]$UtilPlanManifest = '',
  [string]$UtilPlanFile = '',
  [string]$ExistingPeriod = ''
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$skillRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$run = Join-Path $skillRoot 'caremanager-rfid-check\scripts\run.ps1'
$base = Split-Path $PSScriptRoot -Parent
$outDir = if ($OutDir) { $OutDir } else { Join-Path $base 'output' }
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$reused = [bool]$DumpFile
if ($ManifestFile -and -not $DumpFile) { throw 'ManifestFile requires DumpFile' }
if ([string]::IsNullOrWhiteSpace($OrgName)) { throw 'OrgName (the institution confirmed by the operator) is required' }
$today = if ($WriteDate) { $WriteDate } else { (Get-Date).ToString('yyyy-MM-dd') }
$rules = @{}
foreach ($f in @('SKILL.md','references\rules.md','scripts\plan_draft.py','scripts\plan_duration.py','scripts\plan-spec-check.py','scripts\plan-draft.ps1','scripts\plan-common.ps1')) {
  $p = Join-Path $base $f
  if (Test-Path -LiteralPath $p -PathType Leaf) { $rules[$f] = Get-PlanHash $p }
}
foreach($file in @('cm-req-2025-labels.json','lt-need-catalog.json')) { $p=Join-Path (Join-Path $PSScriptRoot '../../../assets/static') $file; $rules['static/'+$file]=Get-PlanHash $p }
if ($reused) {
  if (-not $ManifestFile) { $ManifestFile = Join-Path (Split-Path $DumpFile -Parent) 'evidence.json' }
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestFile | ConvertFrom-Json
  if ($manifest.version -ne 1 -or $manifest.orgName -cne $OrgName -or $manifest.name -cne $Name -or $manifest.sourceHash -ne (Get-PlanHash $DumpFile)) { throw 'Source manifest identity/hash mismatch' }
  if (-not $manifest.collectedAt -or -not $manifest.ltc) { throw 'Source provenance missing' }
  if ([string]$manifest.today -cne $today) { throw ('Reused source was collected for another write date (' + $manifest.today + '); collect again for ' + $today) }
  if (@($manifest.rules.PSObject.Properties).Count -ne $rules.Count) { throw 'Generation rules changed' }
  foreach ($key in $rules.Keys) { if ($manifest.rules.$key -ne $rules[$key]) { throw 'Generation rules changed' } }
  $j = Get-Content -Raw -Encoding UTF8 -LiteralPath $DumpFile | ConvertFrom-Json
} else {
  $j = Invoke-PlanBrowser $run (Join-Path $PSScriptRoot 'cm-plan-dump.js') @{ name = $Name; today = $today }
}
if (-not $j.ok -or @($j.r.out).Count -ne 1) { throw ('수급자 ' + $Name + ' 를 정확히 1명 읽지 못했다') }
if ($j.r.out[0].name -cne $Name -or -not $j.r.out[0].ltc) { throw 'Source recipient mismatch' }
if ($reused -and $j.r.out[0].ltc -cne $manifest.ltc) { throw 'Source recipient key changed' }
$outDir = Join-Path $outDir ('draft-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $outDir | Out-Null
$tmp = Join-Path $outDir 'source.json'
if($reused){Copy-Item -LiteralPath $DumpFile -Destination $tmp -ErrorAction Stop}else{Save-PlanJson $tmp $j}
$collectedAt = if ($reused) { $manifest.collectedAt } else { [DateTime]::UtcNow.ToString('o') }
Save-PlanJson (Join-Path $outDir 'evidence.json') @{ version = 1; orgName = $OrgName; orgBasis = 'operator-confirmed-not-browser-verified'; name = $Name; ltc = $j.r.out[0].ltc; collectedAt = $collectedAt; today = $today; sourceHash = (Get-PlanHash $tmp); rules = $rules; reused = $reused }
if(-not $ContentFile){
 [ordered]@{ok=$true;status='source-collected-needs-draft-content';sourceFile=$tmp;manifestFile=(Join-Path $outDir 'evidence.json');orgName=$OrgName;name=$Name}|ConvertTo-Json -Depth 30
 return
}
if(-not $OrgName){throw 'Current institution name required'}
$catalog = ''
$argsPy = @('-I', (Join-Path $PSScriptRoot 'plan_draft.py'), '--dump', $tmp, '--out', $outDir, '--writer', $Writer, '--job', $Job, '--content', $ContentFile, '--org-name', $OrgName)
$argsPy += @('--write-date', $today)
if ($From) { $argsPy += @('--from', $From) }
if ($Visits) { $argsPy += @('--visits', $Visits) }
if ($Diff) { $argsPy += @('--diff', $Diff) }
if ($PlanNo) { $argsPy += @('--plan-no', $PlanNo) }
if ($Reason) { $argsPy += @('--reason', $Reason) }
if ($To) { $argsPy += @('--to', $To) }
if ($NewContract) { $argsPy += @('--new-contract') }
if ($ContractEnd) { $argsPy += @('--contract-end', $ContractEnd) }
$utilManifestHash = ''
if ($UtilPlanManifest) {
  $utilPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($UtilPlanManifest)
  $argsPy += @('--util-plan-manifest', $utilPath)
  try { $utilManifestHash = Get-PlanHash $utilPath } catch { }
}
if ($UtilPlanFile) { $argsPy += @('--util-plan-file', $UtilPlanFile) }
if ($ExistingPeriod) { $argsPy += @('--existing-period', $ExistingPeriod) }
if ($catalog -and (Test-Path -LiteralPath $catalog)) { $argsPy += @('--catalog', $catalog) }
$previousPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$raw = python @argsPy 2>&1 | Out-String -Width 1000000; $generationExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($generationExit -ne 0) {
  $reason = @($raw -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last 1
  throw ('Draft generation failed; source evidence preserved: ' + $reason)
}
$result = $raw | ConvertFrom-Json -ErrorAction Stop
if(-not $result.info.inputReady){Write-Verbose 'Draft preserved; input spec withheld until actual facts are confirmed'}
$outputs = @{}
foreach ($file in @($result.file, $result.info.spec) | Where-Object {$_}) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Draft output missing' }
  $outputs[(Split-Path $file -Leaf)] = Get-PlanHash $file
}
Save-PlanJson (Join-Path $outDir 'generation.json') @{ contentHash = (Get-PlanHash $ContentFile); sourceHash = (Get-PlanHash $tmp); rules = $rules; arguments = @{ writeDate = $WriteDate; from = $From; to = $To; visits = $Visits; diff = $Diff; writer = $Writer; job = $Job; planNo = $PlanNo; reason = $Reason; newContract = [bool]$NewContract; contractEnd = $ContractEnd; existingPeriod = $ExistingPeriod; utilPlanFile = $UtilPlanFile; utilPlanManifest = $UtilPlanManifest; utilPlanManifestHash = $utilManifestHash }; outputs = $outputs; reused = $reused; generatedAt = [DateTime]::UtcNow.ToString('o') }
$result | Add-Member -NotePropertyName reused -NotePropertyValue $reused
$result | Add-Member -NotePropertyName sourceFile -NotePropertyValue $tmp
$result | Add-Member -NotePropertyName manifestFile -NotePropertyValue (Join-Path $outDir 'evidence.json')
$result | ConvertTo-Json -Depth 30
