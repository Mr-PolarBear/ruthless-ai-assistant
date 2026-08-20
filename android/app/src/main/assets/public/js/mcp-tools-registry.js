/**
 * @file mcp-tools-registry.js
 * @description MCP工具注册表 - 定义可用的外部API工具
 */

// 乌鸦：风险级别定义
export const RISK_LEVELS = {
    READ: 'read',           // 只读操作，无需确认
    WRITE_LOW: 'write_low', // 低风险写入，简单确认
    WRITE_HIGH: 'write_high', // 高风险写入，详细确认
    ADMIN: 'admin'          // 管理员操作，需要特殊权限
};

// 乌鸦：默认工具配置 - 从安全的只读API开始
export const DEFAULT_TOOLS = {
    'weather_query': {
        id: 'weather_query',
        name: '天气查询',
        description: '根据城市名称查询当前天气信息，包括温度、湿度、风速等。当用户询问天气情况时使用此工具。',
        category: 'information',
        riskLevel: RISK_LEVELS.READ,
        enabled: true,
        sort: 10,
        parameters: {
            city: {
                type: 'string',
                description: '要查询天气的城市名称，支持中英文，如"北京"、"Shanghai"',
                required: true,
                example: '北京'
            }
        },
        endpoint: {
            url: 'https://wttr.in/{city}?format=j1',
            method: 'GET',
            headers: {
                'User-Agent': 'curl/7.68.0'
            }
        }
    },

    'exchange_rate': {
        id: 'exchange_rate',
        name: '汇率查询',
        description: '查询实时汇率信息，支持主要货币之间的汇率转换。当用户询问汇率或货币换算时使用。',
        category: 'finance',
        riskLevel: RISK_LEVELS.READ,
        enabled: true,
        sort: 20,
        parameters: {
            from: {
                type: 'string',
                description: '源货币代码，如USD、CNY、EUR',
                required: true,
                example: 'USD'
            },
            to: {
                type: 'string',
                description: '目标货币代码，如USD、CNY、EUR',
                required: true,
                example: 'CNY'
            }
        },
        endpoint: {
            url: 'https://api.fxratesapi.com/latest?base={from}&symbols={to}',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    },

    'ip_location': {
        id: 'ip_location',
        name: 'IP位置查询',
        description: '查询IP地址的地理位置信息，包括国家、城市、运营商等。当用户询问IP位置或地理信息时使用。',
        category: 'network',
        riskLevel: RISK_LEVELS.READ,
        enabled: true,
        sort: 30,
        parameters: {
            ip: {
                type: 'string',
                description: 'IP地址，如果不提供则查询当前用户的IP',
                required: false,
                example: '8.8.8.8'
            }
        },
        endpoint: {
            url: 'https://ipapi.co/{ip}/json/',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    },

    'db_visualizer': {
        id: 'db_visualizer',
        name: '数据库可视化 (Mermaid)',
        description: '数据库可视化渲染工具。当用户要求生成ER图或可视化表结构时，AI应根据上下文中的表结构信息，生成标准的 Mermaid 代码（如 erDiagram），并将其作为参数传递给此工具。请务必在关系描述或备注中加上字段的中文备注(如有)，以便用户理解（例如：`USER ||--o{ ORDER : "拥有"`，"perent_id(父id)"’）。⚠️ Mermaid语法注意事项：1.note内容必须简短，禁止包含换行符(\\n)、编号列表(1. 2.)或长段落 2.实体名和关系标签只能用字母数字和引号内的中文 3.避免在标签中使用冒号、括号等特殊符号',
        category: 'database',
        riskLevel: RISK_LEVELS.READ,
        enabled: true,
        sort: 40,
        parameters: {
            mermaid_code: {
                type: 'string',
                description: '完整的 Mermaid 图表代码，不包含 markdown 代码块标记。请在关系连线或实体注释中使用中文描述。',
                required: true,
                example: 'erDiagram\n    USER ||--o{ ORDER : "下单"\n    USER { string name "姓名" }'
            }
        },
        // 乌鸦：特殊工具，不发送 HTTP 请求，由前端逻辑拦截
        endpoint: {
            type: 'client_side',
            handler: 'render_mermaid'
        }
    },

    'chart_renderer': {
        id: 'chart_renderer',
        name: '数据图表渲染 (ECharts)',
        description: '使用 ECharts 渲染交互式数据图表。当用户要求将数据可视化、画柱状图/折线图/饼图时使用。AI 应根据上下文数据生成标准的 ECharts option 配置对象。',
        category: 'visualization',
        riskLevel: RISK_LEVELS.READ,
        enabled: true,
        sort: 41,
        parameters: {
            chart_type: {
                type: 'string',
                description: '图表类型 (bar, line, pie, scatter, radar)',
                required: true,
                enum: ['bar', 'line', 'pie', 'scatter', 'radar']
            },
            title: {
                type: 'string',
                description: '图表标题',
                required: true
            },
            option: {
                type: 'object',
                description: '完整的 ECharts 配置对象 (JSON格式)，包含 xAxis, yAxis, series 等',
                required: true
            }
        },
        // 特殊标记：客户端本地处理
        endpoint: {
            type: 'client_side',
            handler: 'render_echarts'
        }
    }
};

/**
 * 乌鸦：工具注册管理器
 */
export class MCPToolsRegistry {
    constructor() {
        this.tools = new Map();
        this.loadDefaultTools();
    }

    /**
     * 加载默认工具
     */
    loadDefaultTools() {
        Object.values(DEFAULT_TOOLS).forEach(tool => {
            this.registerTool(tool);
        });
    }

    /**
     * 注册工具
     * @param {Object} toolConfig - 工具配置
     */
    registerTool(toolConfig) {
        // 乌鸦：验证工具配置完整性
        if (!toolConfig.id || !toolConfig.name || !toolConfig.description) {
            throw new Error('工具配置不完整：缺少必需字段');
        }

        this.tools.set(toolConfig.id, toolConfig);
    }

    /**
     * 获取工具
     * @param {string} toolId - 工具ID
     * @returns {Object|null}
     */
    getTool(toolId) {
        return this.tools.get(toolId) || null;
    }

    /**
     * 获取所有启用的工具
     * @returns {Array}
     */
    getEnabledTools() {
        return Array.from(this.tools.values()).filter(tool => tool.enabled);
    }

    /**
     * 根据风险级别获取工具
     * @param {string} riskLevel - 风险级别
     * @returns {Array}
     */
    getToolsByRiskLevel(riskLevel) {
        return Array.from(this.tools.values()).filter(tool => tool.riskLevel === riskLevel);
    }

    /**
     * 根据分类获取工具
     * @param {string} category - 工具分类
     * @returns {Array}
     */
    getToolsByCategory(category) {
        return Array.from(this.tools.values()).filter(tool => tool.category === category);
    }
}