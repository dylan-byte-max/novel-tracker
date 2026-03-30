[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
gh run view 23743825701 --repo dylan-byte-max/novel-tracker --log > c:\Users\dylanynsu\WorkBuddy\20260330113751\novel-tracker\action-log.txt 2>&1
Write-Host "Done. Log saved."
