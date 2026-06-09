/**
 * A股财务数据全景仪表盘 - 工具模块
 */

const Utils = {
    charts: new Set(),
    resizeBound: false,

    // ---- 主题管理 ----
    isDarkTheme() {
        return document.documentElement.getAttribute('data-theme') !== 'light';
    },

    // 返回当前主题下图表所需的辅助颜色
    themeColors() {
        const dark = this.isDarkTheme();
        return {
            textMuted:    dark ? '#7f8da6' : '#64748b',
            textSecondary: dark ? '#8b949e' : '#64748b',
            textLight:    dark ? '#eaf0f8' : '#1e293b',
            textBody:     dark ? '#f0f3f6' : '#1a202c',
            axisLine:     dark ? 'rgba(56, 72, 112, 0.3)' : 'rgba(180, 190, 210, 0.5)',
            splitLine:    dark ? 'rgba(56, 72, 112, 0.12)' : 'rgba(203, 213, 225, 0.5)',
            splitLineAlt: dark ? '#21262d' : '#e2e8f0',
            tooltipBg:    dark ? 'rgba(14, 20, 33, 0.95)' : 'rgba(255, 255, 255, 0.96)',
            tooltipBorder: dark ? 'rgba(56, 72, 112, 0.3)' : 'rgba(203, 213, 225, 0.6)',
            tooltipShadow: dark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.08)',
            radarArea1:   dark ? 'rgba(22, 27, 34, 0.3)' : 'rgba(241, 245, 249, 0.5)',
            radarArea2:   dark ? 'rgba(10, 14, 20, 0.5)' : 'rgba(226, 232, 240, 0.5)',
            radarLine:    dark ? 'rgba(48, 54, 61, 0.5)' : 'rgba(203, 213, 225, 0.6)',
            pieBorder:    dark ? '#121824' : '#ffffff',
            treemapBorder: dark ? '#0a0e14' : '#f0f2f5',
            corrMid:      dark ? '#161b22' : '#f1f5f9',
            scatterLabel: dark ? 'rgba(10, 14, 20, 0.8)' : 'rgba(255, 255, 255, 0.9)',
            scatterText:  dark ? '#f0f3f6' : '#1e293b',
        };
    },

    // 切换明暗主题
    toggleTheme() {
        const html = document.documentElement;
        const toLight = html.getAttribute('data-theme') !== 'light';
        html.setAttribute('data-theme', toLight ? 'light' : 'dark');
        try { localStorage.setItem('dashboard-theme', toLight ? 'light' : 'dark'); } catch(e) {}
        this.refreshAllCharts();
    },

    // 初始化主题 (从 localStorage 恢复)
    initTheme() {
        let saved = 'dark';
        try { saved = localStorage.getItem('dashboard-theme') || 'dark'; } catch(e) {}
        if (saved === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    },

    // 主题切换后刷新所有已渲染的图表
    refreshAllCharts() {
        // 1. 释放所有现有 ECharts 实例
        this.charts.forEach(chart => {
            if (chart && !chart.isDisposed?.()) chart.dispose();
        });
        this.charts.clear();

        // 2. 重新初始化当前可见的 Tab 模块
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;
        const tabId = activeTab.id.replace('-tab', '');
        switch (tabId) {
            case 'overview':  if (typeof OverviewModule !== 'undefined')  OverviewModule.init(); break;
            case 'industry':  if (typeof IndustryModule !== 'undefined')  IndustryModule.init(); break;
            case 'crisis':    if (typeof CrisisModule !== 'undefined')    CrisisModule.init(); break;
            case 'risk':      if (typeof RiskModule !== 'undefined')      RiskModule.init(); break;
            case 'factor':    if (typeof FactorModule !== 'undefined')    FactorModule.init(); break;
            case 'company':   if (typeof CompanyModule !== 'undefined')   CompanyModule.initSearchPage(); break;
        }

        // 3. 如果抽屉面板处于打开状态，也刷新个股诊断图表
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList.contains('active')) {
            const codeEl = document.getElementById('drawer-company-code');
            if (codeEl && codeEl.textContent) {
                const stkcd = String(codeEl.textContent).trim();
                setTimeout(() => {
                    if (typeof CompanyModule !== 'undefined') CompanyModule.openDrawer(stkcd);
                }, 150);
            }
        }
    },

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

    // ECharts 深色终端主题配色
    getChartTheme() {
        return {
            color: ['#5b9eff', '#a78bfa', '#2dd4bf', '#f5a623', '#f778ba', '#79c0ff', '#34d399', '#fb923c'],
            backgroundColor: 'transparent',
            textStyle: {
                fontFamily: "'Inter', 'SF Pro Display', 'Noto Sans SC', sans-serif",
                color: '#7f8da6'
            },
            title: {
                textStyle: { color: '#eaf0f8' }
            },
            line: {
                itemStyle: { borderWidth: 2 },
                lineStyle: { width: 2.5 }
            },
            categoryAxis: {
                axisLine: { lineStyle: { color: 'rgba(56, 72, 112, 0.3)' } },
                axisTick: { lineStyle: { color: 'rgba(56, 72, 112, 0.3)' } },
                axisLabel: { color: '#7f8da6', fontSize: 11 },
                splitLine: { show: false }
            },
            valueAxis: {
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: '#7f8da6', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(56, 72, 112, 0.12)' } }
            },
            legend: {
                textStyle: { color: '#7f8da6', fontSize: 11 }
            },
            tooltip: {
                backgroundColor: 'rgba(14, 20, 33, 0.95)',
                borderColor: 'rgba(56, 72, 112, 0.3)',
                textStyle: { color: '#eaf0f8', fontSize: 12 },
                borderWidth: 1,
                borderRadius: 8,
                extraCssText: 'backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.4);'
            }
        };
    },

    // ECharts 浅色终端主题配色
    getLightChartTheme() {
        return {
            color: ['#3b82f6', '#8b5cf6', '#0d9488', '#d97706', '#ec4899', '#60a5fa', '#10b981', '#f59e0b'],
            backgroundColor: 'transparent',
            textStyle: {
                fontFamily: "'Inter', 'SF Pro Display', 'Noto Sans SC', sans-serif",
                color: '#64748b'
            },
            title: {
                textStyle: { color: '#1e293b' }
            },
            line: {
                itemStyle: { borderWidth: 2 },
                lineStyle: { width: 2.5 }
            },
            categoryAxis: {
                axisLine: { lineStyle: { color: 'rgba(180, 190, 210, 0.5)' } },
                axisTick: { lineStyle: { color: 'rgba(180, 190, 210, 0.5)' } },
                axisLabel: { color: '#64748b', fontSize: 11 },
                splitLine: { show: false }
            },
            valueAxis: {
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: '#64748b', fontSize: 11 },
                splitLine: { lineStyle: { color: 'rgba(203, 213, 225, 0.5)' } }
            },
            legend: {
                textStyle: { color: '#64748b', fontSize: 11 }
            },
            tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.96)',
                borderColor: 'rgba(203, 213, 225, 0.6)',
                textStyle: { color: '#1e293b', fontSize: 12 },
                borderWidth: 1,
                borderRadius: 8,
                extraCssText: 'backdrop-filter: blur(12px); box-shadow: 0 8px 32px rgba(0,0,0,0.08);'
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
        const themeName = this.isDarkTheme() ? 'terminal' : 'terminal-light';
        const chart = echarts.init(container, themeName);
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
