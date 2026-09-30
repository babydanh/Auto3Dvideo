[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$PinnedCommit = "56d9501526767f9eaa71d9155608719414ac0e24"
$VendorRoot = Join-Path $ProjectRoot "vendor\gflow-cli"
$RuntimeRoot = Join-Path $ProjectRoot ".auto3dvideo\runtimes\gflow-cli"
$PythonRoot = Join-Path $RuntimeRoot "venv"
$GflowExe = Join-Path $PythonRoot "Scripts\gflow.exe"

if (-not (Test-Path (Join-Path $VendorRoot ".git"))) {
    throw "Pinned vendor checkout is missing: $VendorRoot"
}

$actualCommit = (& git -C $VendorRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $PinnedCommit) {
    throw "vendor/gflow-cli is not pinned to $PinnedCommit (found $actualCommit). No install was performed."
}

if (-not $Force -and (Test-Path $GflowExe)) {
    Write-Host "Existing isolated runtime found: $RuntimeRoot"
} else {
    $python = Get-Command py -ErrorAction SilentlyContinue
    if ($null -eq $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
    if ($null -eq $python) { throw "Python 3.11+ is required; install it before running setup." }

    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    if ($Force -and (Test-Path $PythonRoot)) { Remove-Item -LiteralPath $PythonRoot -Recurse -Force }
    & $python.Source -3.11 -m venv $PythonRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not create the isolated Python runtime." }

    $venvPython = Join-Path $PythonRoot "Scripts\python.exe"
    & $venvPython -m pip install --disable-pip-version-check --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Could not bootstrap pip in the isolated runtime." }
    & $venvPython -m pip install --disable-pip-version-check --editable $VendorRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not install the pinned gflow-cli checkout." }
}

if (-not (Test-Path $GflowExe)) { throw "gflow executable was not created at $GflowExe" }
$help = & $GflowExe --help 2>&1
if ($LASTEXITCODE -ne 0) { throw "The installed gflow executable failed --help." }
if (-not (($help -join "`n") -match "gflow")) { throw "gflow --help returned unexpected output." }

Write-Host "gflow-cli runtime ready (credits-free verification)."
Write-Host "Pinned commit: $PinnedCommit"
Write-Host "Install path: $RuntimeRoot"
Write-Host "Executable: $GflowExe"
Write-Host "Next human step (after starting the app): run '$GflowExe auth login --browser chrome' and complete Google login in the dedicated gflow window."
Write-Host "No login, browser profile read, browser focus, or video generation was performed by setup."
