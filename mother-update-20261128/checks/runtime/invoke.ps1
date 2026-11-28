# Called only by the workspace controller; credentials never travel in these parameters.
param([Parameter(Mandatory=$true)][string]$Script,[Parameter(Mandatory=$true)][string]$ParameterFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
function ConvertTo-TaskHashtable($Value){
 if($null -eq $Value){return $null}
 if($Value -is [System.Management.Automation.PSCustomObject]){$table=@{};foreach($p in $Value.PSObject.Properties){$table[$p.Name]=ConvertTo-TaskHashtable $p.Value};return $table}
 if($Value -is [array]){return ,@($Value|ForEach-Object {ConvertTo-TaskHashtable $_})}
 return $Value
}
$taskParameters=ConvertTo-TaskHashtable (Get-Content -Raw -Encoding UTF8 -LiteralPath $ParameterFile|ConvertFrom-Json)
if($taskParameters -isnot [hashtable]){throw 'PARAMETERS_OBJECT_REQUIRED'}
$taskTokens=$null;$taskErrors=$null
$taskAst=[System.Management.Automation.Language.Parser]::ParseFile($Script,[ref]$taskTokens,[ref]$taskErrors)
if($taskErrors){throw 'INSTALLED_SCRIPT_PARSE_FAILED'}
foreach($taskParam in $taskAst.ParamBlock.Parameters){
 $taskParamName=$taskParam.Name.VariablePath.UserPath
 $taskSwitch=@($taskParam.Attributes|Where-Object {$_ -is [System.Management.Automation.Language.TypeConstraintAst] -and $_.TypeName.FullName -in @('switch','System.Management.Automation.SwitchParameter')}).Count -gt 0
 if($taskSwitch -and $taskParameters.ContainsKey($taskParamName) -and $taskParameters[$taskParamName] -isnot [bool]){throw ('SWITCH_REQUIRES_JSON_BOOLEAN: '+$taskParamName)}
}
& $Script @taskParameters
if($LASTEXITCODE -and $LASTEXITCODE -ne 0){exit $LASTEXITCODE}
