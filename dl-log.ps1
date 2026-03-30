[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$log = gh run view 23744137987 --repo dylan-byte-max/novel-tracker --log 2>&1
$log | Out-File -FilePath "c:\Users\dylanynsu\WorkBuddy\20260330113751\novel-tracker\log.txt" -Encoding UTF8
$fanqieLines = $log | Where-Object { $_ -match "Scrape Fanqie" }
Write-Host "=== Fanqie lines: $($fanqieLines.Count) ==="
foreach ($line in $fanqieLines) {
    Write-Host $line
}
