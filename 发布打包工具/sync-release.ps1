# ======================================================================
# 智能摸鱼 (Ruthless AI Assistant) - GitHub 发布版同步工具
# ======================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - GitHub 发布版同步工具"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
$sourceRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$parentDir = Split-Path -Parent $sourceRoot
$targetDir = Join-Path $parentDir "智能摸鱼发布版"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         智能摸鱼 (Ruthless AI) - GitHub 发布版同步工具" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  源码目录: $sourceRoot" -ForegroundColor Gray
Write-Host "  目标目录: $targetDir" -ForegroundColor Yellow
Write-Host ""

# 1. 检查并创建目标目录
if (-not (Test-Path $targetDir)) {
    Write-Host "[1/4] 未发现目标发布文件夹，正在新建: $targetDir" -ForegroundColor Green
    New-Item -ItemType Directory -Path $targetDir | Out-Null
} else {
    Write-Host "[1/4] 检测到已存在的目标发布文件夹: $targetDir" -ForegroundColor Green
}

# 2. 检查 Git 仓库初始化
$targetGitDir = Join-Path $targetDir ".git"
if (-not (Test-Path $targetGitDir)) {
    Write-Host "      正在为目标发布文件夹初始化 Git 仓库 (git init)..." -ForegroundColor Cyan
    try {
        & git -C $targetDir init -b main 2>$null
        if ($LASTEXITCODE -ne 0) {
            & git -C $targetDir init
        }
        Write-Host "      Git 仓库初始化完成 (默认分支 main)" -ForegroundColor Green
    } catch {
        Write-Host "      未检测到系统 git 命令，请确保已安装 Git" -ForegroundColor Yellow
    }
} else {
    Write-Host "      目标目录已关联现有 Git 仓库（保留历史与配置）" -ForegroundColor Green
}

# 3. 彻底清空目标目录旧工作树 (除 .git 外全部强制物理删除，确保 0 残留)
Write-Host ""
Write-Host "[2/4] 正在彻底清空目标目录旧工作树 (安全保留 .git)..." -ForegroundColor Green

# 1) 先解除所有非 .git 文件的只读/隐藏属性，防止删除失败
Get-ChildItem -Path $targetDir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.FullName -notmatch '\\\.git($|\\)') {
        try { $_.Attributes = 'Normal' } catch {}
    }
}

# 2) 强制删除所有根目录非 .git 文件和子文件夹
Get-ChildItem -Path $targetDir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.git' } | ForEach-Object {
    try {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Host "      ⚠️ 警告: 删除旧文件失败: $($_.FullName) - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 3) 校验是否清空彻底
$remainingItems = Get-ChildItem -Path $targetDir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.git' }
if ($remainingItems.Count -eq 0) {
    Write-Host "      ✅ 旧工作树已彻底清空 (除 .git 外 0 残留)" -ForegroundColor Green
} else {
    Write-Host "      ⚠️ 注意: 仍有 $($remainingItems.Count) 个残留项未能删除，请检查是否有进程占用" -ForegroundColor Yellow
}

# 4. 扫描并同步源码文件
Write-Host ""
Write-Host "[3/4] 正在复制纯净源代码并排除开发/临时/编译文件..." -ForegroundColor Green

$excludeExactNames = @(
    '.git', '.idea', '.vscode', '.windsurf', 'node_modules', '_dist_build_temp',
    'local.properties', '.gradle', 'build', 'intermediates', 'CLAUDE.md', 'GEMINI.md'
)

$excludeExtensions = @('.zip', '.apk', '.log', '.tmp', '.iml')

function Copy-CleanTree([string]$src, [string]$dst) {
    if (-not (Test-Path $dst)) {
        New-Item -ItemType Directory -Path $dst | Out-Null
    }

    Get-ChildItem -Path $src -Force | ForEach-Object {
        $item = $_
        $name = $item.Name
        $ext = $item.Extension.ToLower()

        if ($excludeExactNames -contains $name) { return }
        if ($name -match '^\.git') { return }

        if ($src -match '\\android\\' -and ($name -in @('build', '.gradle', 'intermediates', 'local.properties'))) { return }

        if ($item.PSIsContainer) {
            $subDst = Join-Path $dst $name
            Copy-CleanTree -src $item.FullName -dst $subDst
        } else {
            if ($excludeExtensions -contains $ext) { return }
            Copy-Item -Path $item.FullName -Destination (Join-Path $dst $name) -Force
        }
    }
}

Copy-CleanTree -src $sourceRoot -dst $targetDir

# 确保目标目录拥有标准的 .gitignore
$gitignorePath = Join-Path $targetDir ".gitignore"
if (-not (Test-Path $gitignorePath)) {
    Copy-Item -Path (Join-Path $sourceRoot ".gitignore") -Destination $gitignorePath -Force
}

# 确保目标目录拥有 README.md
$targetReadme = Join-Path $targetDir "README.md"
if (-not (Test-Path $targetReadme)) {
    Copy-Item -Path (Join-Path $sourceRoot "README.md") -Destination $targetReadme -Force
}

# 确保目标目录拥有 LICENSE
$targetLicense = Join-Path $targetDir "LICENSE"
if (-not (Test-Path $targetLicense)) {
    Copy-Item -Path (Join-Path $sourceRoot "LICENSE") -Destination $targetLicense -Force
}

# 5. 快速敏感性自检
Write-Host ""
Write-Host "[4/4] 正在对发布版目录进行敏感数据安全自检..." -ForegroundColor Green
$sensitiveIssues = @()

Get-ChildItem -Path $targetDir -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' } | ForEach-Object {
    $file = $_
    $rel = $file.FullName.Substring($targetDir.Length + 1)
    $ext = $file.Extension.ToLower()

    if ($ext -in @('.js', '.json', '.html', '.css', '.md', '.ps1', '.bat', '.properties', '.gradle')) {
        $txt = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
        if ($txt -match '\b(192\.168\.(?!1\.100)\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b') {
            $sensitiveIssues += "警告: 发现可能未脱敏的内网 IP: $rel -> $($Matches[0])"
        }
        if ($txt -match 'sk-[a-zA-Z0-9_\-]{20,}') {
            $sensitiveIssues += "警告: 发现疑似真实 API Key: $rel -> $($Matches[0])"
        }
    }
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
if ($sensitiveIssues.Count -gt 0) {
    Write-Host "  安全自检提示:" -ForegroundColor Yellow
    foreach ($issue in $sensitiveIssues) {
        Write-Host "    $issue" -ForegroundColor Red
    }
} else {
    Write-Host "  安全自检通过！未检测到任何私网真实 IP 或有效 API Key 泄漏。" -ForegroundColor Green
}
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$fileCount = (Get-ChildItem -Path $targetDir -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' }).Count
Write-Host "  ✅ 同步成功！共导出 $fileCount 个纯净开源文件至: $targetDir" -ForegroundColor Green
Write-Host ""

# ——————————————————————————————————————————————————————————————————————
# 6. 自动化 Git 提交流程与推送 (Plan B: 带推送确认)
# ——————————————————————————————————————————————————————————————————————
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         🚀 发布仓库 Git 自动提交与推送" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否有 git 命令
$gitAvailable = $false
try {
    $null = & git --version 2>&1
    if ($LASTEXITCODE -eq 0) { $gitAvailable = $true }
} catch {}

if (-not $gitAvailable) {
    Write-Host "  ⚠️ 未检测到系统 Git 环境，已跳过自动提交与推送。" -ForegroundColor Yellow
    Write-Host "     请在安装 Git 后手动进入发布文件夹提交。" -ForegroundColor Gray
} else {
    # 1. 暂存所有文件变动
    Write-Host "  ⏳ 正在暂存文件变动 (git add -A)..." -ForegroundColor Gray
    & git -C $targetDir add -A

    # 2. 检查工作区是否有任何变动（暂存区或未跟踪）
    $statusOutput = & git -C $targetDir status --porcelain 2>&1
    if ([string]::IsNullOrWhiteSpace($statusOutput)) {
        Write-Host "  ℹ️ 工作区与远程代码一致，未检测到任何文件变更，无需提交。" -ForegroundColor Green
    } else {
        # 3. 获取提交说明
        $defaultMsg = "更新 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        Write-Host ""
        Write-Host -NoNewline ">>> 请输入 Git 提交信息 [直接回车默认: $defaultMsg]: " -ForegroundColor White
        $inputCommitMsg = Read-Host
        $commitMsg = if ([string]::IsNullOrWhiteSpace($inputCommitMsg)) { $defaultMsg } else { $inputCommitMsg.Trim() }

        # 4. 执行 Commit
        Write-Host ""
        Write-Host "  ⏳ 正在提交版本: $commitMsg ..." -ForegroundColor Gray
        & git -C $targetDir commit -m "$commitMsg"

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✅ 本地提交成功！" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️ 本地提交遇到异常，请检查 Git 状态。" -ForegroundColor Yellow
        }

        # 5. Plan B：询问是否立即推送到远程仓库
        Write-Host ""
        Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host -NoNewline ">>> 是否立即推送到远程仓库？[Y/n，直接回车默认 Y]: " -ForegroundColor White
        $pushChoice = Read-Host
        if ([string]::IsNullOrWhiteSpace($pushChoice) -or ($pushChoice -in @("y", "Y", "yes", "YES"))) {
            Write-Host ""
            Write-Host "  🚀 正在推送到远程仓库 (git push)..." -ForegroundColor Cyan
            & git -C $targetDir push
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "======================================================================" -ForegroundColor Green
                Write-Host "  🎉 同步、本地提交与远程推送已全部圆满完成！" -ForegroundColor Green
                Write-Host "======================================================================" -ForegroundColor Green
            } else {
                Write-Host ""
                Write-Host "======================================================================" -ForegroundColor Yellow
                Write-Host "  ⚠️ 远程推送失败 (错误码 $LASTEXITCODE)" -ForegroundColor Yellow
                Write-Host "     可能原因: 网络连接超时、未配置 SSH/凭据、或需要拉取冲突。" -ForegroundColor Gray
                Write-Host "     提示: 本地 Commit 已成功保留，大爷可稍后在发布文件夹中手动执行 git push。" -ForegroundColor Gray
                Write-Host "======================================================================" -ForegroundColor Yellow
            }
        } else {
            Write-Host ""
            Write-Host "  ℹ️ 已跳过远程推送。本地提交已保留在: $targetDir" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "按回车退出..."
$null = Read-Host
