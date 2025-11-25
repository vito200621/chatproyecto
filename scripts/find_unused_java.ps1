$root = Convert-Path .
$paths = @("server/src/main/java","client/src/main/java")
$allCandidates = @()
foreach($p in $paths){
    $full = Join-Path $root $p
    if(-not (Test-Path $full)) { continue }
    $files = Get-ChildItem -Path $full -Recurse -Filter *.java -File -ErrorAction SilentlyContinue
    foreach($f in $files){
        $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
        # skip anonymous or helper files starting with _ or containing 'Helper' maybe
        $content = Get-Content -Raw -Path $f.FullName -ErrorAction SilentlyContinue
        if(-not $content){ continue }
        # Search for simple name in repo excluding its own file and build/out dirs
        $matches = Select-String -Path (Join-Path $root "**\*.java") -Pattern "\b$name\b" -AllMatches -ErrorAction SilentlyContinue | Where-Object { $_.Path -ne $f.FullName -and $_.Path -notmatch '\\(build|out|node_modules|\\.git|gradle|history)\\' }
        $refs = $matches | Select-Object -Unique Path | ForEach-Object { $_.Path }
        $count = ($refs | Measure-Object).Count
        $allCandidates += [PSCustomObject]@{ file = $f.FullName; typeName = $name; refs = $refs; refCount = $count }
    }
}
# Filter likely-unused: refCount -eq 0
$unused = $allCandidates | Where-Object { $_.refCount -eq 0 } | Sort-Object file
if(-not $unused){ Write-Output 'NO_UNUSED_JAVA_FOUND'; exit 0 }
$unused | ConvertTo-Json -Depth 5 | Out-File -FilePath "unused-java-report.json" -Encoding UTF8
Write-Output "WROTE unused-java-report.json"