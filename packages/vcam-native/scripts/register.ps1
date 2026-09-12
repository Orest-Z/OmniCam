# Registers (or unregisters with -Unregister) the OmniCam DirectShow filter DLLs.
# Must run elevated. The installer does the same thing; this is for development.
param([switch]$Unregister)
$ErrorActionPreference = 'Stop'
$native = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\apps\desktop\resources\native')
$flag = if ($Unregister) { '/u /s' } else { '/s' }
$targets = @(
  @{ dll = Join-Path $native 'omnicam_vcam.dll';     regsvr = "$env:SystemRoot\System32\regsvr32.exe" },
  @{ dll = Join-Path $native 'x86\omnicam_vcam.dll'; regsvr = "$env:SystemRoot\SysWOW64\regsvr32.exe" }
)
foreach ($t in $targets) {
  if (-not (Test-Path $t.dll)) { Write-Warning "missing $($t.dll) (build first)"; continue }
  Write-Host "$($t.regsvr) $flag $($t.dll)"
  $p = Start-Process -FilePath $t.regsvr -ArgumentList "$flag `"$($t.dll)`"" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "regsvr32 failed ($($p.ExitCode)) for $($t.dll)" }
}
Write-Host ("OmniCam camera driver " + $(if ($Unregister) { 'unregistered' } else { 'registered' }) + '.')
