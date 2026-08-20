import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const targetDir = path.join(projectRoot, 'www');

// 需要打包到 App 内的静态文件与目录清单
const copyItems = [
    'index.html',
    'sidebar.html',
    'modals.html',
    'draw.html',
    'favorite.ico',
    'css',
    'js',
    'libs',
    'font',
    'draw_css',
    'mcp导入模板'
];

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    if (!exists) return;
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((child) => {
            copyRecursiveSync(path.join(src, child), path.join(dest, child));
        });
    } else {
        const parent = path.dirname(dest);
        if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
}

console.log('🔄 正在同步前端资源到 www 目录...');
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

for (const item of copyItems) {
    const srcPath = path.join(projectRoot, item);
    const destPath = path.join(targetDir, item);
    if (fs.existsSync(srcPath)) {
        copyRecursiveSync(srcPath, destPath);
        console.log(`  ✓ 已同步: ${item}`);
    } else {
        console.warn(`  ⚠️ 资源不存在 (跳过): ${item}`);
    }
}

console.log('✅ 前端资源同步完成！');
