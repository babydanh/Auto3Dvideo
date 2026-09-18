$ErrorActionPreference = 'Continue'
Set-Location 'D:\Duancanhan\Auto3Dvideo'
$request = 'outputs\two-sum-audit\request.json'
$result = 'outputs\two-sum-audit\worker-result.json'
if (Test-Path -LiteralPath 'outputs\two-sum-audit\script.json') { Remove-Item -LiteralPath 'outputs\two-sum-audit\script.json' -Force }
if (Test-Path -LiteralPath $result) { Remove-Item -LiteralPath $result -Force }
Write-Output ("REQUEST_EXISTS=" + (Test-Path -LiteralPath $request))
& python 'scripts\local_script_worker.py' '--request' $request *> $result
$code = $LASTEXITCODE
Write-Output ("WORKER_EXIT_CODE=" + $code)
if (Test-Path -LiteralPath $result) { Get-Content -LiteralPath $result }
Write-Output ("SCRIPT_EXISTS=" + (Test-Path -LiteralPath 'outputs\two-sum-audit\script.json'))
