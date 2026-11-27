$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'package/install.ps1'
$trial = Join-Path $PSScriptRoot ('install-test-' + [guid]::NewGuid().ToString('N'))
& $installer -VerifyOnly
& $installer -SkillRoot $trial
& $installer -SkillRoot $trial
$installedSkill = Join-Path $trial 'care-worker-change-monitoring/SKILL.md'
Add-Content -LiteralPath $installedSkill -Value 'LOCAL CUSTOMIZATION'
$blocked = $false
try { & $installer -SkillRoot $trial } catch {
    if ($_.Exception.Message -ne 'EXISTING_SKILL_DIFFERS_PRESERVED') { throw }
    $blocked = $true
}
if (-not $blocked -or -not ((Get-Content -LiteralPath $installedSkill -Raw).Contains('LOCAL CUSTOMIZATION'))) { throw 'CUSTOMIZATION_NOT_PRESERVED' }
Write-Output 'PASS: verify, fresh installation, repeat installation, customized-skill preservation'
