# photo-coach auto push
# 每 2 分钟由计划任务调用：deploy/ 有变化就同步到 D:\photo-coach-pages 并 push
# 无变化直接退出，不产生任何输出

$ErrorActionPreference = 'SilentlyContinue'

$Src    = 'C:\Users\H2165\WorkBuddy AI\2026-11-11-00-02-04\deploy'
$Repo   = 'D:\photo-coach-pages'
$Key    = Join-Path $Repo '.deploy-key\id_ed25519'
$Log    = 'D:\photo-coach-pages\.push.log'
$Files  = @('index.html', 'app.js', 'rules.js', 'style.css')

function Add-Log([string]$msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $Log -Value "$ts  $msg" -Encoding utf8
    $fi = Get-Item -LiteralPath $Log -ErrorAction SilentlyContinue
    if ($fi -and $fi.Length -gt 512KB) { Set-Content -LiteralPath $Log -Value '' -Encoding utf8 }
}

# 计划任务的 PATH 可能是精简的，自己找 git
$Git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $Git) {
    foreach ($c in @('C:\Program Files\Git\cmd\git.exe',
                     "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
                     'C:\Program Files (x86)\Git\cmd\git.exe')) {
        if (Test-Path -LiteralPath $c) { $Git = $c; break }
    }
}
if (-not $Git) { Add-Log 'skip: git not found'; exit 0 }
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { Add-Log 'skip: repo not found'; exit 0 }
if (Test-Path -LiteralPath (Join-Path $Repo '.git\index.lock')) { Add-Log 'skip: git busy'; exit 0 }
if (-not (Test-Path -LiteralPath $Src)) { Add-Log 'skip: src not found'; exit 0 }

# 逐字节比较，任一不同才继续
$dirty = @()
foreach ($f in $Files) {
    $a = Join-Path $Src $f
    $b = Join-Path $Repo $f
    if (-not (Test-Path -LiteralPath $a)) { continue }
    if (-not (Test-Path -LiteralPath $b)) { $dirty += $f; continue }
    $ha = (Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash
    $hb = (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash
    if ($ha -ne $hb) { $dirty += $f }
}
if ($dirty.Count -eq 0) { exit 0 }

# 等文件稳定，避免拷到写了一半的文件
$prev = ''
$stable = $false
for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 3
    $now = ($Files | ForEach-Object {
        $p = Join-Path $Src $_
        if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } else { 'none' }
    }) -join ','
    if ($now -eq $prev) { $stable = $true; break }
    $prev = $now
}
if (-not $stable) { Add-Log 'skip: files still changing'; exit 0 }

foreach ($f in $Files) {
    $a = Join-Path $Src $f
    if (Test-Path -LiteralPath $a) {
        Copy-Item -LiteralPath $a -Destination (Join-Path $Repo $f) -Force
    }
}

Set-Location -LiteralPath $Repo

# 从 index.html 里读版本号写进提交信息，方便追溯
$ver = ''
$idx = Join-Path $Repo 'index.html'
if (Test-Path -LiteralPath $idx) {
    $m = Select-String -LiteralPath $idx -Pattern 'app\.js\?v=(\d+)' -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($m) { $ver = $m.Matches[0].Groups[1].Value }
}
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$msg = if ($ver) { "v$ver 自动更新 $stamp" } else { "自动更新 $stamp" }

& $Git add -A 2>$null | Out-Null
$staged = @(& $Git diff --cached --name-only 2>$null) | Where-Object { $_ -and $_.Trim() }
if (-not $staged -or $staged.Count -eq 0) { exit 0 }

& $Git commit -q -m $msg 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Add-Log 'skip: commit failed'; exit 0 }

# 用部署密钥走 SSH，禁用其它任何身份
$env:GIT_SSH_COMMAND = "ssh -i `"$Key`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=`"$Repo\.deploy-key\known_hosts`""
$out = & $Git push -q origin main 2>&1
if ($LASTEXITCODE -eq 0) {
    Add-Log "pushed $msg ($($dirty -join ', '))"
} else {
    Add-Log "push FAILED: $($out -join ' | ')"
}
