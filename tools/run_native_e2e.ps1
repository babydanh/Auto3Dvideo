$ErrorActionPreference = 'Continue'
Set-Location 'D:\Duancanhan\Auto3Dvideo\desktop\src-tauri'
$env:AUTO3DVIDEO_RUN_LOCAL_PIPELINE_E2E = '1'
& cargo test --release local_topic_to_video_native_e2e_on_windows -- --ignored --nocapture
Write-Output ("E2E_EXIT_CODE=" + $LASTEXITCODE)
