$ErrorActionPreference = "SilentlyContinue"

function First-Line([object]$value) {
  if ($null -eq $value) { return $null }
  return (($value | Select-Object -First 1).ToString()).Trim()
}

$cargoPath = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
$rustupPath = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"
$vswherePath = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
$linkCommand = Get-Command link.exe
$ffmpegCommand = Get-Command ffmpeg
$ffprobeCommand = Get-Command ffprobe
$blenderCommand = Get-Command blender

$visualStudioPath = $null
if (Test-Path $vswherePath) {
  $visualStudioPath = First-Line (& $vswherePath -latest -products "*" -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
}

$activeToolchain = $null
if (Test-Path $rustupPath) {
  $activeToolchain = First-Line (& $rustupPath show active-toolchain)
}

$result = [ordered]@{
  cargo = if (Test-Path $cargoPath) { First-Line (& $cargoPath --version) } else { "missing" }
  rustup = if (Test-Path $rustupPath) { First-Line (& $rustupPath --version) } else { "missing" }
  activeToolchain = if ($activeToolchain) { $activeToolchain } else { "unknown" }
  msvcLinker = if ($linkCommand) { $linkCommand.Source } else { "missing" }
  visualStudioWithCpp = if ($visualStudioPath) { $visualStudioPath } else { "missing" }
  cFreeGB = [math]::Round((Get-PSDrive C).Free / 1GB, 2)
  dFreeGB = [math]::Round((Get-PSDrive D).Free / 1GB, 2)
  ffmpeg = if ($ffmpegCommand) { $ffmpegCommand.Source } else { "missing" }
  ffprobe = if ($ffprobeCommand) { $ffprobeCommand.Source } else { "missing" }
  blender = if ($blenderCommand) { $blenderCommand.Source } else { "missing" }
  installerStarted = $false
  networkProbePerformed = $false
}

$result | ConvertTo-Json -Compress
