# 로그인된 PC에서 실행. 태그 가져오기 후 RFID만 읽으며 AI·계획서·일지 조회를 하지 않는다.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^20\d{2}-(0[1-9]|1[0-2])$')][string]$Month,
  [Parameter(Mandatory=$true)][string]$OrgName,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [string]$WorkerMap = ''
)
$ErrorActionPreference = 'Stop'
$taskCommon = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../skills'))
$taskRun = Join-Path $taskCommon 'caremanager-rfid-check\scripts\run.ps1'
$taskStep = Join-Path $taskCommon 'care-visit-review\scripts\run-step.ps1'
if (-not (Test-Path -LiteralPath $taskStep)) { throw '독립 설치본의 공통 스킬을 확인하세요.' }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$taskRaw = Join-Path $OutDir ('rfid-' + $taskStamp + '.json')
$taskExport = Join-Path $OutDir ('worker-notes-' + $Month + '-' + $taskStamp + '.json')
$taskImportRaw = & $taskRun -Script (Join-Path $taskCommon 'caremanager-rfid-check\scripts\import-tags.js') -Params @{exc=''} | Out-String
$taskImportLine = ($taskImportRaw -split "`r?`n" | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
if (-not $taskImportLine -or -not ($taskImportLine | ConvertFrom-Json).ok) { throw '태그 가져오기를 완료하지 못했습니다. 자료를 내보내지 않습니다.' }
$taskDate = [DateTime]::ParseExact($Month + '-01', 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$taskCollected = & $taskStep -Step collect-cm-rfid -Params @{year=$taskDate.ToString('yyyy');month=$taskDate.ToString('MM');from=$taskDate.ToString('yyyy-MM-dd');to=$taskDate.AddMonths(1).AddDays(-1).ToString('yyyy-MM-dd')} -Out $taskRaw | ConvertFrom-Json
if (-not $taskCollected.ok) { throw 'RFID 자료를 읽지 못했습니다.' }
$taskArgs = @((Join-Path $PSScriptRoot 'prepare-worker-notes.js'), $taskRaw, $Month, $OrgName, $taskExport)
if ($WorkerMap) { $taskArgs += $WorkerMap }
& node @taskArgs
if ($LASTEXITCODE -ne 0) { throw '가져오기 파일 변환 실패. 원자료는 보존했습니다.' }
Write-Output ('업무데스크에서 선택할 파일: ' + $taskExport)
