/**
 * A股财务数据全景仪表盘 - 工具模块
 */

const Utils = {
    charts: new Set(),
    resizeBound: false,

    ensureEcharts() {
        if (typeof echarts !== 'undefined') return true;
        this.showAlert('图表依赖 ECharts 未加载。请确认 vendor/echarts.min.js 已随项目一起部署。');
        return false;
    },

    showAlert(message) {
        const alertEl = document.getElementById('app-alert');
        if (!alertEl) {
            console.error(message);
            return;
        }
        alertEl.textContent = message;
        alertEl.classList.add('active');
    },

    clearAlert() {
        const alertEl = document.getElementById('app-alert');
        if (!alertEl) return;
        alertEl.textContent = '';
        alertEl.classList.remove('active');
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    },

    setEmptyState(container, message) {
        if (!container) return;
        container.innerHTML = `<div class="empty-state">${this.escapeHtml(message)}</div>`;
    },

    // 格式化数值，保留指定小数位数
    formatNumber(val, decimals = 2) {
        if (val === null || val === undefined || isNaN(val)) return '--';
        return Number(val).toLocaleString('zh-CN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    // 格式化大数值 (如 1,234,567,890 -> 12.35 亿)
    formatBigNumber(val) {
        if (val === null || val === undefined || isNaN(val)) return '--';
        const num = Number(val);
        if (Math.abs(num) >= 1e8) {
            return (num / 1e8).toFixed(2) + ' 亿';
        } else if (Math.abs(num) >= 1e4) {
            return (num / 1e4).toFixed(2) + ' 万';
        }
        return num.toFixed(2);
    },

    // 格式化百分比
    formatPercent(val, decimals = 2) {
        if (val === null || val === undefined || isNaN(val)) return '--';
        const num = Number(val);
        return (num * 100).toFixed(decimals) + '%';
    },

    // 自动判断 0~1 比例或已放大的百分比数值
    formatSmartPercent(val, decimals = 2) {
        if (val === null || val === undefined || isNaN(val)) return '--';
        const num = Number(val);
        const scaled = Math.abs(num) <= 1 ? num * 100 : num;
        return scaled.toFixed(decimals) + '%';
    },

    // 格式化无标度百分比 (数据已经是百分比数值，如 12.5 代表 12.5%)
    formatRawPercent(val, decimals = 2) {
        if (val === null || val === undefined || isNaN(val)) return '--';
        return Number(val).toFixed(decimals) + '%';
    },

    // 根据风险等级获取 CSS Badge 样式类
    getRiskLevelClass(level) {
        if (!level) return 'badge-low';
        switch (level.trim()) {
            case '低风险':
                return 'badge-low';
            case '关注':
                return 'badge-watch';
            case '中等风险':
            case '中等':
                return 'badge-medium';
            case '高风险':
                return 'badge-high';
            case '极高风险':
            case '极高':
                return 'badge-extreme';
            default:
                return 'badge-low';
        }
    },

    // ECharts 全局注册主题与配色配置
    getChartTheme() {
        return {
            color: ['#58a6ff', '#bc8cff', '#39d2c0', '#f0883e', '#f778ba', '#79c0ff'],
            backgroundColor: 'transparent',
            textStyle: {
                fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
                color: '#8b949e'
            },
            title: {
                textStyle: { color: '#e6edf3' }
            },
            line: {
                itemStyle: { borderWidth: 2 },
                lineStyle: { width: 3 }
            },
            categoryAxis: {
                axisLine: { lineStyle: { color: '#30363d' } },
                axisTick: { lineStyle: { color: '#30363d' } },
                axisLabel: { color: '#8b949e' },
                splitLine: { show: false }
            },
            valueAxis: {
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: '#8b949e' },
                splitLine: { lineStyle: { color: '#21262d' } }
            },
            legend: {
                textStyle: { color: '#8b949e' }
            },
            tooltip: {
                backgroundColor: '#161b22',
                borderColor: '#30363d',
                textStyle: { color: '#e6edf3' },
                borderWidth: 1,
                borderRadius: 4
            }
        };
    },

    // 模糊检索企业 (Stkcd 或 ShortName)
    searchCompanies(query) {
        if (!query) return [];
        const cleanQuery = query.trim().toLowerCase();
        const results = [];
        if (typeof COMPANY_HISTORY === 'undefined') return results;
        
        for (const code in COMPANY_HISTORY) {
            const info = COMPANY_HISTORY[code];
            const name = String(info.name || '').toLowerCase();
            
            // 匹配代码（以输入开头）或名称（包含输入）
            if (code.startsWith(cleanQuery) || name.includes(cleanQuery)) {
                results.push({
                    code: code,
                    name: info.name,
                    indnme: info.indnme,
                    indcd: info.indcd
                });
            }
            if (results.length >= 20) break; // 最多返回20条联想结果
        }
        return results;
    },

    // 用于全局的 ECharts resize 监听
    initChartResize(chartList) {
        chartList.forEach(chart => {
            if (chart) this.charts.add(chart);
        });

        if (this.resizeBound) return;
        this.resizeBound = true;
        window.addEventListener('resize', () => {
            this.charts.forEach(chart => {
                if (chart && !chart.isDisposed?.()) chart.resize();
            });
        });
    },

    createChart(container, oldChart) {
        if (!container || !this.ensureEcharts()) return null;
        if (oldChart && !oldChart.isDisposed?.()) {
            this.charts.delete(oldChart);
            oldChart.dispose();
        }
        const chart = echarts.init(container, 'terminal');
        this.charts.add(chart);
        return chart;
    },

    resizeChart(chart) {
        if (chart && !chart.isDisposed?.()) {
            requestAnimationFrame(() => chart.resize());
        }
    }
};

// 行业代码映射中文字典 (对应 SECTOR_MAP)
const SECTOR_NAME_MAP = {
    'A': '农林牧渔', 'B': '采矿业', 'C': '制造业', 'D': '电力热力燃气水',
    'E': '建筑业', 'F': '批发零售', 'G': '交运仓储', 'H': '住宿餐饮',
    'I': '信息软件', 'J': '金融业', 'K': '房地产业', 'L': '租赁商务',
    'M': '科研技术', 'N': '水利环境', 'O': '居民服务', 'P': '教育',
    'Q': '卫生', 'R': '文体娱乐', 'S': '综合'
};

// 挂载全局方法，当用户点击代码时弹窗 X-Ray
window.showCompanyDetail = function(stkcd) {
    if (typeof CompanyModule !== 'undefined' && CompanyModule.openDrawer) {
        CompanyModule.openDrawer(stkcd);
    } else {
        console.error('CompanyModule 未加载');
    }
};
