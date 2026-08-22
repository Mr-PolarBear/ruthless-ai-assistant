# ======================================================================
# 智能摸鱼 (Ruthless AI) - 发布压缩包打包工具 (支持内网离线版 / 外网 CDN 加速版 / 密码加密保护)
# ======================================================================

param(
    [string]$Mode = "",          # 'offline' or 'cdn'
    [switch]$Encrypt,            # 是否开启加密 (CLI 参数模式)
    [string]$Password = ""       # 加密密码 (CLI 参数模式)
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - Web 发布压缩包打包工具"

$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $toolDir) { $toolDir = (Get-Location).Path }
$projectRoot = (Resolve-Path "$toolDir\..").Path

# ——————————————————————————————————————————————————————————————————————
# 内置 ZipCrypto 打包引擎 (采用 C# 编写标准 PKWARE 算法)
# 为什么这么写：
# 1. Windows 自带的 Compress-Archive 不支持密码加密；
# 2. 内网机或纯净系统往往未预装 7-Zip 或 WinRAR 等第三方软件；
# 3. 本模块利用 PowerShell 自带的 Add-Type 编译标准 ZipCrypto 加密，做到 100% 零依赖；
# 4. 生成的标准加密 ZIP 可被 Windows 资源管理器原生双击解压、Mac、手机解压软件无缝兼容。
# ——————————————————————————————————————————————————————————————————————
$csharpZipEngine = @'
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Collections.Generic;

public static class BuiltinZipPacker {
    private static readonly uint[] CrcTable = new uint[256];

    static BuiltinZipPacker() {
        for (uint i = 0; i < 256; i++) {
            uint entry = i;
            for (int j = 0; j < 8; j++) {
                if ((entry & 1) == 1)
                    entry = (entry >> 1) ^ 0xEDB88320;
                else
                    entry = entry >> 1;
            }
            CrcTable[i] = entry;
        }
    }

    private static uint UpdateCrc(uint crc, byte b) {
        return CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
    }

    public static uint ComputeCrc32(byte[] data) {
        uint crc = 0xFFFFFFFF;
        foreach (byte b in data) {
            crc = UpdateCrc(crc, b);
        }
        return ~crc;
    }

    private class ZipCryptoKeys {
        public uint Key0 = 305419896;
        public uint Key1 = 591751049;
        public uint Key2 = 878082192;

        public ZipCryptoKeys(string password) {
            byte[] pwdBytes = Encoding.UTF8.GetBytes(password);
            foreach (byte b in pwdBytes) {
                UpdateKeys(b);
            }
        }

        public void UpdateKeys(byte b) {
            Key0 = CrcTable[(Key0 ^ b) & 0xFF] ^ (Key0 >> 8);
            Key1 = (Key1 + (Key0 & 0xFF)) * 134775813 + 1;
            Key2 = CrcTable[(Key2 ^ (byte)(Key1 >> 24)) & 0xFF] ^ (Key2 >> 8);
        }

        public byte MagicByte() {
            ushort temp = (ushort)(Key2 | 2);
            return (byte)((temp * (temp ^ 1)) >> 8);
        }

        public byte EncryptByte(byte b) {
            byte c = (byte)(b ^ MagicByte());
            UpdateKeys(b);
            return c;
        }
    }

    public static void CreateZip(string sourceDir, string zipPath, string password = null) {
        sourceDir = Path.GetFullPath(sourceDir);
        if (File.Exists(zipPath)) File.Delete(zipPath);

        string[] allFiles = Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories);
        using (FileStream fs = new FileStream(zipPath, FileMode.Create, FileAccess.Write))
        using (BinaryWriter bw = new BinaryWriter(fs)) {
            List<long> localHeaderOffsets = new List<long>();
            List<string> relativePaths = new List<string>();
            List<uint> fileCrcs = new List<uint>();
            List<uint> compressedSizes = new List<uint>();
            List<uint> uncompressedSizes = new List<uint>();
            List<ushort> modTimes = new List<ushort>();
            List<ushort> modDates = new List<ushort>();
            List<ushort> flagsList = new List<ushort>();

            bool isEncrypted = !string.IsNullOrEmpty(password);

            foreach (string file in allFiles) {
                string relPath = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                byte[] rawData = File.ReadAllBytes(file);
                uint crc = ComputeCrc32(rawData);
                DateTime lastWrite = File.GetLastWriteTime(file);
                ushort time = (ushort)((lastWrite.Hour << 11) | (lastWrite.Minute << 5) | (lastWrite.Second / 2));
                ushort date = (ushort)(((lastWrite.Year - 1980) << 9) | (lastWrite.Month << 5) | lastWrite.Day);

                byte[] compressedData;
                using (MemoryStream ms = new MemoryStream()) {
                    using (DeflateStream ds = new DeflateStream(ms, CompressionLevel.Optimal, true)) {
                        ds.Write(rawData, 0, rawData.Length);
                    }
                    compressedData = ms.ToArray();
                }

                ushort flag = (ushort)(1 << 11); // Bit 11: 启用 UTF-8 文件名字编码
                byte[] payload;

                if (isEncrypted) {
                    flag |= 1; // Bit 0: 启用密码加密
                    ZipCryptoKeys keys = new ZipCryptoKeys(password);
                    byte[] encHeader = new byte[12];
                    Random rnd = new Random();
                    rnd.NextBytes(encHeader);
                    // PKWARE 规范：加密头第 12 字节放置 CRC 最高有效字节用于解密密码校验
                    encHeader[11] = (byte)((crc >> 24) & 0xFF);

                    byte[] encHeaderEncrypted = new byte[12];
                    for (int i = 0; i < 12; i++) {
                        encHeaderEncrypted[i] = keys.EncryptByte(encHeader[i]);
                    }

                    byte[] encBody = new byte[compressedData.Length];
                    for (int i = 0; i < compressedData.Length; i++) {
                        encBody[i] = keys.EncryptByte(compressedData[i]);
                    }

                    payload = new byte[12 + encBody.Length];
                    Buffer.BlockCopy(encHeaderEncrypted, 0, payload, 0, 12);
                    Buffer.BlockCopy(encBody, 0, payload, 12, encBody.Length);
                } else {
                    payload = compressedData;
                }

                byte[] pathBytes = Encoding.UTF8.GetBytes(relPath);
                localHeaderOffsets.Add(fs.Position);
                relativePaths.Add(relPath);
                fileCrcs.Add(crc);
                compressedSizes.Add((uint)payload.Length);
                uncompressedSizes.Add((uint)rawData.Length);
                modTimes.Add(time);
                modDates.Add(date);
                flagsList.Add(flag);

                // Local file header (本地文件头)
                bw.Write((uint)0x04034b50);
                bw.Write((ushort)20); // Version needed to extract (2.0)
                bw.Write(flag);
                bw.Write((ushort)8);  // Deflate 压缩
                bw.Write(time);
                bw.Write(date);
                bw.Write(crc);
                bw.Write((uint)payload.Length);
                bw.Write((uint)rawData.Length);
                bw.Write((ushort)pathBytes.Length);
                bw.Write((ushort)0);  // Extra field length
                bw.Write(pathBytes);
                bw.Write(payload);
            }

            long centralDirOffset = fs.Position;
            for (int i = 0; i < allFiles.Length; i++) {
                byte[] pathBytes = Encoding.UTF8.GetBytes(relativePaths[i]);

                // Central directory header (核心目录头)
                bw.Write((uint)0x02014b50);
                bw.Write((ushort)20); // Version made by
                bw.Write((ushort)20); // Version needed to extract
                bw.Write(flagsList[i]);
                bw.Write((ushort)8);  // Deflate
                bw.Write(modTimes[i]);
                bw.Write(modDates[i]);
                bw.Write(fileCrcs[i]);
                bw.Write(compressedSizes[i]);
                bw.Write(uncompressedSizes[i]);
                bw.Write((ushort)pathBytes.Length);
                bw.Write((ushort)0); // Extra field length
                bw.Write((ushort)0); // File comment length
                bw.Write((ushort)0); // Disk number start
                bw.Write((ushort)0); // Internal file attributes
                bw.Write((uint)0);   // External file attributes
                bw.Write((uint)localHeaderOffsets[i]); // Relative offset of local header
                bw.Write(pathBytes);
            }

            long centralDirSize = fs.Position - centralDirOffset;

            // End of central directory record (目录结束记录)
            bw.Write((uint)0x06054b50);
            bw.Write((ushort)0); // Disk number
            bw.Write((ushort)0); // Disk with central directory
            bw.Write((ushort)allFiles.Length); // Total entries on this disk
            bw.Write((ushort)allFiles.Length); // Total entries
            bw.Write((uint)centralDirSize);
            bw.Write((uint)centralDirOffset);
            bw.Write((ushort)0); // Comment length
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'BuiltinZipPacker').Type) {
    Add-Type -TypeDefinition $csharpZipEngine
}

# ——————————————————————————————————————————————————————————————————————
# 交互式菜单引导 (Plan A)
# ——————————————————————————————————————————————————————————————————————
$isInteractive = (-not $PSBoundParameters.ContainsKey('Mode'))

if ($isInteractive) {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "         📦 智能摸鱼 (Ruthless AI) - 发布打包工具" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [步骤 1/2] 请选择打包版本：" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1] 🏠 内网离线版" -ForegroundColor Yellow
    Write-Host "      - 包含所有本地库与中文字体，适合无外网/纯内网离线环境 (体积约 8.9 MB)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  [2] ⚡ 外网 CDN 加速版 (推荐外网服务器使用)" -ForegroundColor Green
    Write-Host "      - 重型库与字体全部接入公共 CDN，小带宽服务器首屏秒开 (体积约 470 KB)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray

    Write-Host -NoNewline ">>> 请输入版本选项 [1 或 2，默认 1]: " -ForegroundColor White
    $inputChoice = Read-Host
    if ($inputChoice -eq "2") {
        $Mode = "cdn"
    } else {
        $Mode = "offline"
    }

    Write-Host ""
    Write-Host "  [步骤 2/2] 是否需要密码加密压缩包？" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1] 🔓 普通压缩包 (无密码，默认)" -ForegroundColor Gray
    Write-Host "  [2] 🔒 加密压缩包 (默认密码: cc3@1)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray

    Write-Host -NoNewline ">>> 请选择是否加密 [1 或 2 / y/N，默认 1]: " -ForegroundColor White
    $encChoice = Read-Host
    if ($encChoice -in @("2", "y", "Y", "yes", "YES")) {
        $Encrypt = $true
        Write-Host -NoNewline ">>> 请输入解压密码 [直接回车使用默认 cc3@1]: " -ForegroundColor White
        $inputPwd = Read-Host
        if ([string]::IsNullOrWhiteSpace($inputPwd)) {
            $Password = "cc3@1"
        } else {
            $Password = $inputPwd
        }
    }
} else {
    # 命令行指定了 -Mode 参数运行
    if ($Encrypt -and [string]::IsNullOrWhiteSpace($Password)) {
        $Password = "cc3@1"
    }
}


$dt = Get-Date -Format 'yyyyMMdd_HHmmss'
$isCdn = ($Mode -eq "cdn")
$isEncrypted = (-not [string]::IsNullOrEmpty($Password))

if ($isCdn) {
    $modeText = "外网 CDN 加速版"
    $zipPrefix = "ruthless-ai-assistant_cdn_$dt"
} else {
    $modeText = "内网离线版"
    $zipPrefix = "ruthless-ai-assistant_offline_$dt"
}

$zipName = if ($isEncrypted) { "${zipPrefix}_enc.zip" } else { "${zipPrefix}.zip" }
$destZip = Join-Path $projectRoot $zipName
$tempDir = Join-Path $projectRoot "_dist_build_temp"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
if ($isEncrypted) {
    Write-Host "  🎯 正在生成 [$modeText] (🔒 密码保护模式: $Password)..." -ForegroundColor Green
} else {
    Write-Host "  🎯 正在生成 [$modeText] (🔓 无密码)..." -ForegroundColor Green
}
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

$excludeNames = @(
    '.git', '.idea', '.windsurf', 'android', 'node_modules', 'www',
    '手机端打包工具', '发布打包工具', '_dist_build_temp', 'clearDB',
    'mcp导入模板', '预设角色导入包.json', '功能说明', 'package.json', 'package-lock.json',
    'ruthless-ai-assistant', '_test_unpacked_dist', '_test_cdn_dist', '_test_verify_cdn'
)

# 外网 CDN 版额外排除重型本地库和本地字体文件夹
if ($isCdn) {
    $excludeNames += @('libs', 'font')
}

$includeLauncherFiles = @('启动智能摸鱼.bat', 'start.bat', 'server.ps1')

Write-Host "[1/3] 正在扫描并过滤纯净源码文件..." -ForegroundColor Green

Get-ChildItem -Path $projectRoot | Where-Object {
    $name = $_.Name
    $ext = $_.Extension
    if ($name -match '^\.') { return $false }
    if ($excludeNames -contains $name) { return $false }
    if ($includeLauncherFiles -contains $name) { return $true }
    if ($ext -in @('.md', '.bat', '.ps1', '.zip', '.apk', '.log')) { return $false }
    return $true
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $tempDir $_.Name) -Recurse -Force
}

# 兜底清理临时目录子文件夹中的非必要 markdown 和临时文件
Get-ChildItem -Path $tempDir -Recurse | Where-Object {
    $name = $_.Name
    if ($includeLauncherFiles -contains $name) { return $false }
    $_.Extension -in @('.md', '.bat', '.ps1', '.zip', '.apk', '.log')
} | Remove-Item -Force -ErrorAction SilentlyContinue

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# --- 外网 CDN 模式下的资源替换处理 ---
if ($isCdn) {
    Write-Host "[2/3] 正在将静态资源路径转换为公网 CDN 高速链接并进行完整性自检..." -ForegroundColor Green

    # 1. 转换 index.html (采用鲁棒正则，避免属性顺序或微小差异导致漏替)
    $tempIndex = Join-Path $tempDir "index.html"
    if (Test-Path $tempIndex) {
        $idxHtml = [System.IO.File]::ReadAllText($tempIndex, [System.Text.Encoding]::UTF8)

        # 替换 CSS 库
        $idxHtml = $idxHtml -replace '<link\s+[^>]*href=["''](?:\./)?libs/atom-one-dark\.min\.css[^"'']*["''][^>]*>', '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" id="hljs-theme">'
        $idxHtml = $idxHtml -replace '<link\s+[^>]*href=["''](?:\./)?libs/cropper\.min\.css[^"'']*["''][^>]*>', '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css">'

        # 替换 JS 库
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/cropper\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js"></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/marked\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/highlight\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?draw_css/mermaid\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/echarts\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/mammoth\.browser\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/xlsx\.full\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/pdf\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/pdf\.worker\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" defer></script>'
        $idxHtml = $idxHtml -replace '<script\s+[^>]*src=["''](?:\./)?libs/jszip\.min\.js[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" defer></script>'

        [System.IO.File]::WriteAllText($tempIndex, $idxHtml, $utf8NoBom)

        # 校验 index.html 是否还有残留的本地相对路径 libs/ 引用
        if ($idxHtml -match 'src=["''](?:\./)?libs/|href=["''](?:\./)?libs/') {
            Write-Host "      ⚠️ 警告: index.html 中可能存在未被替换的本地 libs 引用!" -ForegroundColor Yellow
        } else {
            Write-Host "      ✅ index.html 所有第三方库已全部成功转换为 CDN 高速链接 (0 个本地残留)" -ForegroundColor Gray
        }
    }

    # 2. 转换 draw.html
    $tempDraw = Join-Path $tempDir "draw.html"
    if (Test-Path $tempDraw) {
        $drawHtml = [System.IO.File]::ReadAllText($tempDraw, [System.Text.Encoding]::UTF8)

        $drawHtml = $drawHtml -replace '<script\s+[^>]*src=["''](?:\./)?draw_css/tailwindcss[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdn.tailwindcss.com/3.4.17"></script>'
        $drawHtml = $drawHtml -replace '<script\s+[^>]*src=["''](?:\./)?draw_css/vue\.global[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.4.21/vue.global.prod.min.js"></script>'
        $drawHtml = $drawHtml -replace '<script\s+[^>]*src=["''](?:\./)?draw_css/mermaid[^"'']*["''][^>]*>\s*</script>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js"></script>'

        # 移除 draw.html 中的本地字体 PingFangSC_0.ttf
        $drawHtml = $drawHtml -replace '(?s)@font-face\s*\{[^}]*PingFangSC_0\.ttf[^}]*\}', ''
        # 字体栈换为系统原生
        $drawHtml = $drawHtml -replace 'body,\s*button,\s*input,\s*select,\s*textarea\s*\{\s*font-family:\s*[^;]+;', 'body, button, input, select, textarea { font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;'

        [System.IO.File]::WriteAllText($tempDraw, $drawHtml, $utf8NoBom)
        Write-Host "      ✅ draw.html 依赖库与字体已成功优化为 CDN 模式" -ForegroundColor Gray
    }

    # 3. 转换 css/base.css 移除本地大字体 PingFangSC_0.ttf
    $tempBaseCss = Join-Path $tempDir "css\base.css"
    if (Test-Path $tempBaseCss) {
        $baseCss = [System.IO.File]::ReadAllText($tempBaseCss, [System.Text.Encoding]::UTF8)
        $baseCss = $baseCss -replace '(?s)@font-face\s*\{[^}]*PingFangSC_0\.ttf[^}]*\}', '/* PingFangSC: 使用系统原生高质量字体栈 */'
        $baseCss = $baseCss -replace 'font-family:\s*"PingFangSC",\s*', 'font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, '
        [System.IO.File]::WriteAllText($tempBaseCss, $baseCss, $utf8NoBom)
        Write-Host "      ✅ css/base.css 字体栈优化完成 (已移除 4.2MB 本地字体包)" -ForegroundColor Gray
    }

    # 4. 清理 draw_css 中不需要的超大文件（只保留必要的纯 CSS）
    $tempDrawCss = Join-Path $tempDir "draw_css"
    if (Test-Path $tempDrawCss) {
        Remove-Item (Join-Path $tempDrawCss "mermaid.min.js") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $tempDrawCss "tailwindcss.3.4.17.js") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $tempDrawCss "vue.global.js") -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[2/3] 内网离线模式：保留全部本地库与内置字体文件..." -ForegroundColor Green

    # 内网离线版专属处理：移除开源代码仓库地址（GitHub/Gitee）
    $tempModals = Join-Path $tempDir "modals.html"
    if (Test-Path $tempModals) {
        $modalsHtml = [System.IO.File]::ReadAllText($tempModals, [System.Text.Encoding]::UTF8)
        # 移除带注释标记的开源代码仓库区块
        $modalsHtml = $modalsHtml -replace '(?s)<!--\s*PROJECT_REPO_LINKS_START\s*-->.*?<!--\s*PROJECT_REPO_LINKS_END\s*-->\r?\n?', ''
        [System.IO.File]::WriteAllText($tempModals, $modalsHtml, $utf8NoBom)
        Write-Host "      ✅ 已按内网离线版规范隐藏/移除开源代码仓库地址 (GitHub/Gitee)" -ForegroundColor Gray
    }
}

Write-Host "[3/3] 正在压缩打包为 ZIP 文件..." -ForegroundColor Green

# ——————————————————————————————————————————————————————————————————————
# 压缩打包逻辑（自适应双引擎支持）
# ——————————————————————————————————————————————————————————————————————
# 1. 查找系统是否安装了 7-Zip (支持标准 ZIP 密码打包)
$7zCommand = $null
$possible7zPaths = @(
    "7z.exe",
    "7za.exe",
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe",
    "C:\Program Files\NVIDIA Corporation\NVIDIA app\7z.exe"
)

foreach ($path in $possible7zPaths) {
    if (Get-Command $path -ErrorAction SilentlyContinue) {
        $7zCommand = $path
        break
    } elseif (Test-Path $path) {
        $7zCommand = $path
        break
    }
}

if ($isEncrypted) {
    if ($7zCommand) {
        Write-Host "      使用 7-Zip 引擎生成加密包 (PKWARE ZipCrypto 兼容标准)..." -ForegroundColor Gray
        if (Test-Path $destZip) { Remove-Item -Force $destZip }
        # 使用 -mem=ZipCrypto 确保 Windows 资源管理器自带解压和第三方工具均能无缝解压
        & $7zCommand a -tzip -p"$Password" -mem=ZipCrypto "$destZip" "$tempDir\*" | Out-Null
    } else {
        Write-Host "      使用内置 C# ZipCrypto 引擎生成加密包 (零依赖/全兼容)..." -ForegroundColor Gray
        [BuiltinZipPacker]::CreateZip($tempDir, $destZip, $Password)
    }
} else {
    # 未加密情况：直接使用内置快速打包
    [BuiltinZipPacker]::CreateZip($tempDir, $destZip, $null)
}

Write-Host "      正在清理临时构建缓存..." -ForegroundColor Gray
Remove-Item -Recurse -Force $tempDir

if (Test-Path $destZip) {
    $zipItem = Get-Item $destZip
    $zipSizeMB = [math]::Round($zipItem.Length / 1MB, 2)
    $zipSizeKB = [math]::Round($zipItem.Length / 1KB, 1)
    $displaySize = if ($zipSizeMB -ge 1) { "$zipSizeMB MB" } else { "$zipSizeKB KB" }

    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  🎉 $modeText 生成成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "  📌 压缩包路径 : $destZip ($displaySize)" -ForegroundColor Yellow
    if ($isEncrypted) {
        Write-Host "  🔒 加密保护   : 已启用 (标准 ZIP 密码保护)" -ForegroundColor Yellow
        Write-Host "  🔑 解压密码   : $Password" -ForegroundColor Magenta
    } else {
        Write-Host "  🔓 加密保护   : 未加密" -ForegroundColor Gray
    }
    Write-Host "  🕒 生成时间   : $($zipItem.LastWriteTime.ToString('yyyy/MM/dd HH:mm:ss'))" -ForegroundColor Gray
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host ""
}

# 如果是交互式双击运行（未指定任何 CLI 模式参数），等待回车退出避免控制台窗口闪退
if (-not $PSBoundParameters.ContainsKey('Mode')) {
    Write-Host "按回车退出..."
    $null = Read-Host
}

