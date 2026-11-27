param(
 [Parameter(Mandatory=$true)][string]$Spec,
 [Parameter(Mandatory=$true)][string]$Plan,
 [Parameter(Mandatory=$true)][string]$Phone,
 [Parameter(Mandatory=$true)][string]$InstitutionId,
 [Parameter(Mandatory=$true)][string]$OutDir
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$sp=Get-Content -Raw -Encoding UTF8 -LiteralPath $Spec | ConvertFrom-Json
$folder=Join-Path $OutDir ('audit-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
$expected=Join-Path $folder 'expected.json'
Save-PlanJson $expected @{agreeDate=[string]$sp.agree.agreeDate;phone=$Phone;institutionId=$InstitutionId}
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runner=Join-Path $root 'caremanager-rfid-check\scripts\run.ps1'
$parked=$false
try {
 foreach($step in @('select','writer')) {
  $raw=& (Join-Path $PSScriptRoot 'lt-plan-write.ps1') -Spec $Spec -Plan $Plan -Step $step -Phone $Phone -InstitutionId $InstitutionId -RunDir $folder | Out-String -Width 1000000
  $result=ConvertFrom-PlanResponse $raw
  if(-not $result.ok){throw ('Read-only selection failed: '+$step)}
 }
 $state=Invoke-PlanBrowser $runner (Join-Path $PSScriptRoot 'lt-plan-state.js')
 if(-not $state.ok){throw 'Independent state read failed'}
 $statePath=Join-Path $folder 'state.json';Save-PlanJson $statePath $state
 $previous=$ErrorActionPreference;$ErrorActionPreference='Continue'
 $raw=python -I (Join-Path $PSScriptRoot 'lt-plan-verify.py') --state $statePath --spec $Spec --plan $Plan --expected $expected 2>&1 | Out-String -Width 1000000
 $code=$LASTEXITCODE;$ErrorActionPreference=$previous
 $verified=ConvertFrom-PlanResponse $raw
 Save-PlanJson (Join-Path $folder 'verification.json') $verified
 if($code -ne 0 -or -not $verified.ok){throw 'Independent read-only audit mismatch'}
} finally {
 $raw=& (Join-Path $PSScriptRoot 'lt-plan-write.ps1') -Spec $Spec -Plan $Plan -Step park -Phone $Phone -InstitutionId $InstitutionId -RunDir $folder | Out-String -Width 1000000
 $parked=(ConvertFrom-PlanResponse $raw).ok
}
if(-not $parked){throw 'Read-only audit park failed'}
Write-Output (@{ok=$true;status='independently-verified';plan=$Plan;auditDir=$folder;siteWrites=0;parked=$parked}|ConvertTo-Json -Compress)
