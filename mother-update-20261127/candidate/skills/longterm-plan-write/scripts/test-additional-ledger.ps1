$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'plan-common.ps1')
$testRoot=Join-Path $PSScriptRoot ('ledger-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'register') -Force | Out-Null
function Get-PlanLedgerRecipientDir($SpecJson) { return $testRoot }
function Get-PlanLedgerDir($SpecJson,[string]$Plan,[string]$Step) { return Join-Path $testRoot 'register' }
$spec=[pscustomobject]@{specHash='NEW-CONTENT';creationIntent=[pscustomobject]@{requestId='test-request'}}
if(Get-PlanLedgerBlock $spec '' 'register'){throw 'Empty fixture blocked'}
$path=New-PlanLedgerAttempt (Join-Path $testRoot 'register') 'OLD-CONTENT' @{creationRequestId='test-request'}
if(-not (Get-PlanLedgerBlock $spec '' 'register')){throw 'Unknown request must block'}
Set-PlanLedgerOutcome $path @{outcome='ok'}
if(-not (Get-PlanLedgerBlock $spec '' 'register')){throw 'Same request with changed spec must block'}
$spec.creationIntent.requestId='genuinely-new-request'
if(Get-PlanLedgerBlock $spec '' 'register'){throw 'Explicit new request should not be blocked by previous completed content'}
$second=New-PlanLedgerAttempt (Join-Path $testRoot 'register') 'SECOND-CONTENT' @{creationRequestId='genuinely-new-request'}
Set-PlanLedgerOutcome $second @{outcome='not-sent'}
if(Get-PlanLedgerBlock $spec '' 'register'){throw 'Proven not-sent may retry same request'}
'Additional request ledger: 5 cases passed; only synthetic fixture written'
