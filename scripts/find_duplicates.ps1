$root = Get-Location
$patterns = @('*.java','*.js','*.html','*.css','*.json','*.md')
$items = Get-ChildItem -Path $root -Recurse -File -Include $patterns -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(build|out|node_modules|\\.git|gradle|history)\\' }
if (!$items) { Write-Output 'NO_FILES_FOUND'; exit 0 }
$hashGroups = @{}
foreach ($it in $items) {
    $h = (Get-FileHash -Algorithm SHA256 -Path $it.FullName).Hash
    if (-not $hashGroups.ContainsKey($h)) { $hashGroups[$h] = @() }
    $hashGroups[$h] += $it.FullName
}
$duplicates = $hashGroups.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 }
if (!$duplicates) { Write-Output 'NO_DUPLICATES'; exit 0 }
$report = @()
foreach($entry in $duplicates) {
    Write-Output "----GROUP $($entry.Key) COUNT=$($entry.Value.Count)"
    foreach($p in $entry.Value) { Write-Output $p }
    $report += [PSCustomObject]@{ hash = $entry.Key; files = $entry.Value }
}
$report | ConvertTo-Json -Depth 5 | Out-File -FilePath "duplicates-report.json" -Encoding UTF8
Write-Output "WROTE duplicates-report.json"