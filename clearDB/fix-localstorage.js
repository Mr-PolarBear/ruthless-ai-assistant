/**
 * 乌鸦：LocalStorage数据兼容性修复工具
 * 使用说明：在浏览器控制台(F12)中复制粘贴此代码并回车执行
 */

console.log('🔧 开始检查和修复localStorage数据...');

// 乌鸦：需要检查的localStorage键名
const MCP_KEYS = [
    'ai-chat-mcp-settings-v1',
    'ai-chat-mcp-custom-tools-v1', 
    'ai-chat-mcp-tool-states-v1'
];

const OTHER_KEYS = [
    'ai-chat-personas-v1',
    'ai-chat-worldbook-v1',
    'ai-chat-api-endpoints-v1',
    'ai-chat-regex-rules-v1',
    'ai-chat-hide-summary-v1',
    'ai-chat-appsettings-v2',
    'ai-chat-message-limit'
];

// 乌鸦：备份原有数据
const backup = {};
let hasCorruptedData = false;

console.log('📋 检查现有数据...');

// 乌鸦：检查MCP相关数据
MCP_KEYS.forEach(key => {
    try {
        const value = localStorage.getItem(key);
        if (value) {
            backup[key] = value;
            JSON.parse(value); // 尝试解析JSON
            console.log(`✅ ${key}: 数据格式正常`);
        } else {
            console.log(`ℹ️ ${key}: 不存在`);
        }
    } catch (error) {
        console.error(`❌ ${key}: 数据格式错误`, error);
        hasCorruptedData = true;
        backup[key] = localStorage.getItem(key); // 仍然备份损坏的数据
    }
});

// 乌鸦：检查其他数据
OTHER_KEYS.forEach(key => {
    try {
        const value = localStorage.getItem(key);
        if (value) {
            if (key === 'ai-chat-message-limit') {
                // 这个是数字，不是JSON
                parseInt(value);
                console.log(`✅ ${key}: ${value}`);
            } else {
                JSON.parse(value);
                console.log(`✅ ${key}: 数据格式正常`);
            }
        }
    } catch (error) {
        console.error(`❌ ${key}: 数据格式错误`, error);
        hasCorruptedData = true;
    }
});

if (hasCorruptedData) {
    console.log('🚨 发现损坏的数据，开始修复...');
    
    // 乌鸦：修复方案1 - 重置MCP设置为默认值
    const defaultMCPSettings = {
        enabled: false,
        selectedTools: []
    };
    
    const defaultMCPCustomTools = {};
    const defaultMCPToolStates = {};
    
    try {
        localStorage.setItem('ai-chat-mcp-settings-v1', JSON.stringify(defaultMCPSettings));
        localStorage.setItem('ai-chat-mcp-custom-tools-v1', JSON.stringify(defaultMCPCustomTools));
        localStorage.setItem('ai-chat-mcp-tool-states-v1', JSON.stringify(defaultMCPToolStates));
        
        console.log('🔧 MCP数据已重置为默认值');
        console.log('✅ 修复完成！请刷新页面重试');
        
        // 乌鸦：显示备份信息
        console.log('💾 原始数据已备份到window.mcpBackup，如需恢复可手动操作');
        window.mcpBackup = backup;
        
    } catch (error) {
        console.error('❌ 修复失败:', error);
        console.log('🆘 建议完全清理localStorage后重新配置');
    }
    
} else {
    console.log('✅ 所有数据格式正常，问题可能在其他地方');
    
    // 乌鸦：检查可能的问题
    console.log('🔍 进一步诊断...');
    
    // 检查MCP设置结构
    try {
        const mcpSettings = JSON.parse(localStorage.getItem('ai-chat-mcp-settings-v1') || '{}');
        if (!Array.isArray(mcpSettings.selectedTools)) {
            console.log('🔧 修复selectedTools数组格式...');
            mcpSettings.selectedTools = [];
            localStorage.setItem('ai-chat-mcp-settings-v1', JSON.stringify(mcpSettings));
        }
    } catch (e) {
        console.error('修复selectedTools失败:', e);
    }
    
    console.log('🎯 建议检查浏览器控制台是否有JavaScript错误');
}

// 乌鸦：提供清理函数
window.clearMCPData = function() {
    console.log('🧹 清理所有MCP相关数据...');
    MCP_KEYS.forEach(key => {
        localStorage.removeItem(key);
        console.log(`🗑️ 已删除 ${key}`);
    });
    console.log('✅ MCP数据清理完成，请刷新页面');
};

window.clearAllLocalStorage = function() {
    if (confirm('⚠️ 确定要清理所有localStorage数据吗？这将重置所有设置！')) {
        localStorage.clear();
        console.log('🧹 所有localStorage数据已清理，请刷新页面');
    }
};

console.log('🛠️ 可用命令:');
console.log('- clearMCPData() : 仅清理MCP相关数据');
console.log('- clearAllLocalStorage() : 清理所有localStorage数据');