param(
 [Parameter(Mandatory=$true)][string]$Script,
 [hashtable]$Params=@{}
)
$ErrorActionPreference='Stop'
$utf8=[System.Text.UTF8Encoding]::new($false)
$OutputEncoding=$utf8
[Console]::InputEncoding=$utf8
[Console]::OutputEncoding=$utf8
$runner=Join-Path $PSScriptRoot '../../../runtime/legacy-runner.cjs'
if(-not(Test-Path -LiteralPath $runner -PathType Leaf)){throw 'Standalone runtime missing'}
# Node 자식의 환경 변경은 부모 PowerShell로 돌아오지 않으므로 공용 pin 결과를 부모에서 보관한다.
if($env:LONGTERM_WORKSPACE){
 $bindingHelper=Join-Path $PSScriptRoot '../../longterm-past-schedule/scripts/browser-binding.cjs'
 if(-not(Test-Path -LiteralPath $bindingHelper -PathType Leaf)){throw 'Standalone binding helper missing'}
 $pinCommand='pin-scope'
 if((Split-Path (Split-Path $PSScriptRoot -Parent) -Leaf) -eq 'longterm-past-schedule'){$pinCommand='pin'}
 $pinLine=& node $bindingHelper $pinCommand | Select-Object -Last 1
 if($LASTEXITCODE -ne 0 -or !$pinLine){throw 'BROWSER_BINDING_UNCONFIRMED: browser not called'}
 $pin=$pinLine | ConvertFrom-Json
 if([string]$pin.fingerprint -notmatch '^[a-f0-9]{64}$'){throw 'BROWSER_BINDING_INVALID: browser not called'}
 $env:LONGTERM_BINDING_SHA256=[string]$pin.fingerprint
}
$payload=@{script=$Script;params=$Params}|ConvertTo-Json -Depth 12 -Compress
$payload|& node $runner --start $PSScriptRoot
if($LASTEXITCODE -ne 0){throw 'Standalone browser transport failed; inspect retained run evidence before retry'}
