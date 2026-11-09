# Registers (or unregisters with -Unregister) the OmniCam DirectShow filter DLLs.
# -Extra lists (or with -Unregister, unlists) cameras 2–4 as well, like the "Extra cameras" switch.
# Must run elevated. The installer does the same thing; this is for development.
param([switch]$Unregister, [switch]$Extra)
$ErrorActionPreference = 'Stop'
$native = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\apps\desktop\resources\native')
$flag = if ($Unregister) { '/u /s' } else { '/s' }
$targets = @(
  @{ dll = Join-Path $native 'omnicam_vcam.dll';     regsvr = "$env:SystemRoot\System32\regsvr32.exe" },
  @{ dll = Join-Path $native 'x86\omnicam_vcam.dll'; regsvr = "$env:SystemRoot\SysWOW64\regsvr32.exe" }
)
# Extra cameras need the usual registration first; unlisting them leaves camera 1 alone.
$passes = if (-not $Extra) { @($flag) } elseif ($Unregister) { @("$flag /n /i:extra") } else { @($flag, "$flag /n /i:extra") }
foreach ($t in $targets) {
  if (-not (Test-Path $t.dll)) { Write-Warning "missing $($t.dll) (build first)"; continue }
  foreach ($f in $passes) {
    Write-Host "$($t.regsvr) $f $($t.dll)"
    $p = Start-Process -FilePath $t.regsvr -ArgumentList "$f `"$($t.dll)`"" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "regsvr32 failed ($($p.ExitCode)) for $($t.dll)" }
  }
}
$what = if ($Extra) { 'OmniCam 2-4' } else { 'OmniCam camera driver' }
Write-Host ("$what " + $(if ($Unregister) { 'unregistered' } else { 'registered' }) + '.')
