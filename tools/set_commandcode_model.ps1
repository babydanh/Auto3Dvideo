$ErrorActionPreference = 'Stop'
$envPath = 'D:\Duancanhan\Auto3Dvideo\.env'
$model = 'cmd/MiniMaxAI/MiniMax-M2.5'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Không tìm thấy file .env cục bộ.' }
$lines = Get-Content -LiteralPath $envPath
$found = $false
$out = foreach ($line in $lines) {
  if ($line -match '^\s*AUTO3DVIDEO_LLM_MODEL\s*=') {
    $found = $true
    "AUTO3DVIDEO_LLM_MODEL=$model"
  } else { $line }
}
if (-not $found) { $out += "AUTO3DVIDEO_LLM_MODEL=$model" }
Set-Content -LiteralPath $envPath -Value $out -Encoding UTF8
Write-Output 'MODEL_UPDATED=cmd/MiniMaxAI/MiniMax-M2.5'
