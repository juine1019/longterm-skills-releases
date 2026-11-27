'use strict';
// Windows PowerShell 5.1 must not discover a PowerShell 7 module with the same name first.
// Omit this variable only for the child; powershell.exe reconstructs its own native defaults.
function windowsPowerShellEnvironment(input=process.env){return Object.fromEntries(Object.entries(input).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));}
module.exports={windowsPowerShellEnvironment};
