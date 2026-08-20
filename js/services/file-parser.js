/**
 * @file file-parser.js
 * @description 乌鸦：文件解析服务模块
 * 负责将 Word(.docx)、PDF(.pdf)、Excel(.xlsx/.xls) 等二进制文件
 * 解析为纯文本内容，供附件系统使用。
 * 
 * 依赖库（需在 index.html 中引入）：
 *   - mammoth.js：解析 .docx
 *   - xlsx.js (SheetJS)：解析 .xlsx / .xls
 *   - pdf.js：通过动态 import 加载，解析 .pdf
 */

/**
 * 乌鸦：可解析的文档扩展名列表
 * 用于判断文件是否为可解析的文档类型
 */
/**
 * 乌鸦：可解析的文档扩展名列表
 * 用于判断文件是否为可解析的文档类型
 */
const DOCUMENT_EXTENSIONS = ['docx', 'doc', 'wps', 'pdf', 'xlsx', 'xls', 'et', 'pptx'];

/**
 * 乌鸦：文本内容最大字符数
 * 超出部分将被截断，防止发给 AI 时 Token 超限
 */
const MAX_TEXT_LENGTH = 50000;

/**
 * 乌鸦：文档类型的文件大小限制（10MB）
 * 比普通文本附件的 2MB 限制更宽松
 */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 乌鸦：判断文件是否为可解析的文档类型
 * @param {string} fileName - 文件名（含扩展名）
 * @returns {boolean} 是否为可解析文档
 */
export function isDocumentFile(fileName) {
    if (!fileName) return false;
    const ext = fileName.split('.').pop().toLowerCase();
    return DOCUMENT_EXTENSIONS.includes(ext);
}

/**
 * 乌鸦：获取文档类型标识
 * @param {string} fileName - 文件名
 * @returns {string} 文档类型标识：'word' | 'pdf' | 'excel' | 'unknown'
 */
export function getDocumentType(fileName) {
    if (!fileName) return 'unknown';
    const ext = fileName.split('.').pop().toLowerCase();
    switch (ext) {
        case 'docx':
        case 'doc':
        case 'wps': return 'word';  // 乌鸦：WPS 文字和 Word 共用同一图标
        case 'pdf': return 'pdf';
        case 'xlsx':
        case 'xls':
        case 'et': return 'excel';  // 乌鸦：WPS 表格和 Excel 共用同一图标
        case 'pptx': return 'pptx';
        default: return 'unknown';
    }
}

/**
 * 乌鸦：获取文档类型对应的图标
 * @param {string} docType - 文档类型标识
 * @returns {string} emoji 图标
 */
export function getDocumentIcon(docType) {
    switch (docType) {
        case 'word': return '📄';
        case 'pdf': return '📋';
        case 'excel': return '📊';
        case 'pptx': return '📽️';
        default: return '📎';
    }
}

/**
 * 乌鸦：解析文档文件，提取纯文本内容
 * 这是对外暴露的核心方法，根据文件扩展名分发到对应的解析器
 * 
 * @param {File} file - 用户上传的 File 对象
 * @returns {Promise<{text: string, charCount: number, truncated: boolean, parseTimeMs: number}>}
 * @throws {Error} 解析失败时抛出错误
 */
export async function parseDocumentFile(file) {
    const startTime = performance.now();
    const ext = file.name.split('.').pop().toLowerCase();
    let text = '';

    try {
        switch (ext) {
            case 'docx':
            case 'doc':
            case 'wps':
                text = await inspectAndParseWordOrWps(file);
                break;
            case 'pdf':
                text = await parsePdf(file);
                break;
            case 'xlsx':
            case 'xls':
            case 'et':  // 乌鸦：WPS 表格，SheetJS 原生支持
                text = await parseExcel(file);
                break;
            case 'pptx':
                text = await parsePptx(file);
                break;
            default:
                throw new Error(`不支持的文档格式: .${ext}`);
        }
    } catch (error) {
        console.error(`乌鸦：文件解析失败 [${file.name}]:`, error);
        throw error; // 向上抛出，让调用方处理
    }

    // 乌鸦：检查提取结果是否为空（可能是扫描件 PDF）
    if (!text || !text.trim()) {
        throw new Error('未能从文件中提取到文本内容，该文件可能是扫描件或不包含可识别的文字');
    }

    // 乌鸦：截断过长的文本，防止 Token 超限
    let truncated = false;
    if (text.length > MAX_TEXT_LENGTH) {
        text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[内容过长，已截断至' + MAX_TEXT_LENGTH + '字符]';
        truncated = true;
    }

    const parseTimeMs = Math.round(performance.now() - startTime);
    console.log(`乌鸦：文件解析完成 [${file.name}]，字符数: ${text.length}，耗时: ${parseTimeMs}ms，截断: ${truncated}`);

    return {
        text: text.trim(),
        charCount: text.trim().length,
        truncated,
        parseTimeMs
    };
}

// ======================== 内部解析器 ========================

/**
 * — 为什么这么写 —
 * 1. 用户上传的 .docx / .doc / .wps 文件可能是 ZIP 压缩包 (OOXML)，也可能是老版 OLE2 二进制、RTF 格式或文本改名。
 * 2. mammoth.js 只支持解压 OOXML (文件头为 50 4B 03 04)，传二进制会抛出 "Could not find zip header"。
 * 3. 采用先读取文件头 Magic Number 进行判断：
 *    - 如果是 PK\x03\x04 (ZIP)：正常调用 mammoth 解析。
 *    - 如果是 {\rtf (RTF)：提取 RTF 文本。
 *    - 如果是 D0 CF 11 E0 (OLE2 二进制)：引导用户将其在 WPS/Word 中另存为 .docx 上传。
 *    - 其他类型尝试 UTF-8 / GBK 容错读取。
 * 
 * @param {File} file - .docx / .doc / .wps 文件
 * @returns {Promise<string>} 提取的纯文本
 */
async function inspectAndParseWordOrWps(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer.slice(0, 8));

    // 检查 ZIP 魔数：50 4B 03 04 (PK\x03\x04)
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    // 检查 OLE2 二进制 Word 97-2003 / 老版 WPS 魔数：D0 CF 11 E0
    const isOle2 = bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
    // 检查 RTF 魔数：7B 5C 72 74 66 ({\rtf)
    const isRtf = bytes[0] === 0x7B && bytes[1] === 0x5C && bytes[2] === 0x72 && bytes[3] === 0x74 && bytes[4] === 0x66;

    if (isZip) {
        try {
            return await parseDocx(file);
        } catch (err) {
            console.warn(`乌鸦：[${file.name}] ZIP 结构解析失败，尝试回退`, err);
        }
    }

    if (isRtf) {
        return parseRtfText(buffer);
    }

    if (isOle2) {
        throw new Error(`【格式解密建议】"${file.name}" 为老版本二进制 Word/WPS 格式 (.doc/.wps)，纯前端浏览器无法直接解析。请在 WPS 或 Word 中打开该文件，将其【另存为 .docx 格式】后再上传。`);
    }

    // 容错处理：尝试按 UTF-8 / GBK 读取纯文本（应对把文本文件改名 .wps/.doc 的情况）
    try {
        const textDecoder = new TextDecoder('utf-8', { fatal: true });
        const text = textDecoder.decode(buffer);
        if (text && text.trim()) return text;
    } catch (e) {
        try {
            const gbkDecoder = new TextDecoder('gbk', { fatal: true });
            const gbkText = gbkDecoder.decode(buffer);
            if (gbkText && gbkText.trim()) return gbkText;
        } catch (gbkErr) {
            // 忽略
        }
    }

    throw new Error(`【解析失败】"${file.name}" 并非有效的 .docx 文档。若为 WPS/Word 文件，请将其【另存为 .docx 格式】后再上传。`);
}

/**
 * 乌鸦：提取 RTF 格式文件中的纯文本
 */
function parseRtfText(arrayBuffer) {
    const decoder = new TextDecoder('utf-8');
    const raw = decoder.decode(arrayBuffer);
    let cleanText = raw.replace(/\\rtf1[\s\S]*?\\fonttbl[\s\S]*?\\stylesheet[\s\S]*?\\/g, '')
                       .replace(/\\[a-z0-9]+\s?/gi, '')
                       .replace(/[{}]/g, '')
                       .trim();
    if (!cleanText) {
        throw new Error('未能从 RTF 格式文件中提取到有效文字');
    }
    return cleanText;
}

/**
 * 乌鸦：解析 Word (.docx) 文件
 * 使用 mammoth.js 提取纯文本内容
 */
async function parseDocx(file) {
    if (typeof mammoth === 'undefined') {
        throw new Error('Word 解析库(mammoth.js)尚未加载完成，请稍后重试');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    if (result.messages && result.messages.length > 0) {
        console.warn('乌鸦：Word 解析警告:', result.messages);
    }

    return result.value || '';
}

/**
 * 乌鸦：解析 PDF 文件
 * 使用 pdf.js 逐页提取文本内容
 * 
 * @param {File} file - .pdf 文件
 * @returns {Promise<string>} 提取的纯文本
 */
async function parsePdf(file) {
    // 乌鸦：动态加载 pdf.js（ES Module 模式）
    // 先检查全局是否已有 pdfjsLib（通过 script 标签加载的情况）
    let pdfjsLib = window.pdfjsLib;
    
    if (!pdfjsLib) {
        throw new Error('PDF 解析库(pdf.js)尚未加载完成，请稍后重试');
    }

    // 乌鸦：自动配置 PDF.js 的 Worker 路径（自适应本地离线版与公网 CDN 版）
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        const workerScript = document.querySelector('script[src*="pdf.worker"]');
        if (workerScript && workerScript.src) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerScript.src;
        } else {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }

    const arrayBuffer = await file.arrayBuffer();
    
    // 乌鸦：加载 PDF 文档
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    const totalPages = pdf.numPages;
    const textParts = [];

    // 乌鸦：逐页提取文本
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // 乌鸦：将每个文本项的内容拼接起来
        // items 中的 str 按阅读顺序排列，hasEOL 标识行尾
        const pageText = textContent.items
            .map(item => item.str)
            .join('');
        
        if (pageText.trim()) {
            textParts.push(pageText);
        }
    }

    return textParts.join('\n\n');
}

/**
 * 乌鸦：解析 Excel (.xlsx / .xls) 文件
 * 使用 SheetJS 读取表格数据并转为可读的文本格式
 * 
 * @param {File} file - .xlsx 或 .xls 文件
 * @returns {Promise<string>} 提取的文本内容（CSV 格式，多 Sheet 分隔）
 */
async function parseExcel(file) {
    // 乌鸦：检查 SheetJS 库是否已加载
    if (typeof XLSX === 'undefined') {
        throw new Error('Excel 解析库(SheetJS)尚未加载完成，请稍后重试');
    }

    const arrayBuffer = await file.arrayBuffer();
    
    // 乌鸦：读取 Excel 文件
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    const textParts = [];
    
    // 乌鸦：遍历所有 Sheet，逐个转为文本
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        
        // 乌鸦：使用 sheet_to_csv 转为 CSV 格式文本
        // 分隔符用 ' | ' 使表格更易读
        const csvText = XLSX.utils.sheet_to_csv(sheet, { FS: ' | ' });
        
        if (csvText.trim()) {
            // 乌鸦：多 Sheet 时添加 Sheet 名称作为分隔
            if (workbook.SheetNames.length > 1) {
                textParts.push(`=== Sheet: ${sheetName} ===\n${csvText}`);
            } else {
                textParts.push(csvText);
            }
        }
    }

    return textParts.join('\n\n');
}

/**
 * 乌鸦：解析 PowerPoint (.pptx) 文件
 * 使用 JSZip 解压后用浏览器原生 DOMParser 提取每页幻灯片的文字内容
 * 
 * pptx 文件本质是 ZIP 包，结构为：
 *   ppt/slides/slide1.xml, slide2.xml ... 
 *   文字存储在 <a:t> 标签中（命名空间 drawingml/2006/main）
 * 
 * @param {File} file - .pptx 文件
 * @returns {Promise<string>} 提取的纯文本
 */
async function parsePptx(file) {
    // 乌鸦：检查 JSZip 库是否已加载
    if (typeof JSZip === 'undefined') {
        throw new Error('PPTX 解析库(JSZip)尚未加载完成，请稍后重试');
    }

    const arrayBuffer = await file.arrayBuffer();
    
    // 乌鸦：用 JSZip 解压 .pptx 文件（本质是 ZIP 包）
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // 乌鸦：筛选出幻灯片 XML 文件 (ppt/slides/slide1.xml, slide2.xml ...)
    const slideFiles = Object.keys(zip.files)
        .filter(name => /ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            // 乌鸦：按幻灯片编号排序，确保顺序正确
            const numA = parseInt(a.match(/slide(\d+)/)[1]);
            const numB = parseInt(b.match(/slide(\d+)/)[1]);
            return numA - numB;
        });
    
    if (slideFiles.length === 0) {
        throw new Error('PPTX 文件中未找到幻灯片内容');
    }
    
    const textParts = [];
    const parser = new DOMParser();
    
    // 乌鸦：逐页提取文字
    for (let i = 0; i < slideFiles.length; i++) {
        const xmlContent = await zip.files[slideFiles[i]].async('string');
        const doc = parser.parseFromString(xmlContent, 'application/xml');
        
        // 乌鸦：提取所有 <a:t> 标签中的文字（这是 PPTX XML 中存储文本的标准标签）
        // 使用 getElementsByTagNameNS 以正确匹配命名空间
        const textNodes = doc.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/drawingml/2006/main', 't'
        );
        
        const slideTexts = [];
        for (let j = 0; j < textNodes.length; j++) {
            const text = textNodes[j].textContent;
            if (text && text.trim()) {
                slideTexts.push(text);
            }
        }
        
        if (slideTexts.length > 0) {
            // 乌鸦：每页幻灯片用分隔线标记
            textParts.push(`--- 第${i + 1}页 ---\n${slideTexts.join(' ')}`);
        }
    }
    
    return textParts.join('\n\n');
}
