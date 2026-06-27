/**
 * A股财务数据全景仪表盘 - AI 产业链模块
 * 前端派生口径：行业映射 + 财务质量/成长/R&D 代理指标。
 * 注意：chainScore 仅表示候选热度，不代表产业链收入或风险已被验证。
 */
const AIChainModule = {
    activeLayer: 'all',
    sortKey: 'chainScore',
    initialized: false,
    layerChart: null,
    scatterChart: null,
    companies: [],

    layers: {
        chip: {
            name: '算力芯片',
            color: '#ef4444',
            ind2: ['1036', '1039', '459', '1038'],
            keywords: ['半导体', '电子化学品', '元件', '光学光电子']
        },
        server: {
            name: '服务器设备',
            color: '#f59e0b',
            ind2: ['735', '448', '1037', '1223'],
            keywords: ['计算机设备', '通信设备', '消费电子', '其他电子']
        },
        optical: {
            name: '光通信',
            color: '#22c55e',
            ind2: ['448', '1038', '459'],
            keywords: ['通信设备', '光学光电子', '元件']
        },
        cloud: {
            name: '数据中心/云',
            color: '#38bdf8',
            ind2: ['1238', '736', '1268'],
            keywords: ['IT服务', '通信服务', '互联网']
        },
        software: {
            name: '软件模型应用',
            color: '#8b5cf6',
            ind2: ['737', '1238', '1046', '1221'],
            keywords: ['软件开发', 'IT服务', '游戏', '数字媒体']
        },
        automation: {
            name: '自动化终端',
            color: '#14b8a6',
            ind2: ['1237', '910', '545', '1030', '481'],
            keywords: ['自动化设备', '专用设备', '通用设备', '电机', '汽车零部件']
        }
    },

    init() {
        if (this.initialized) {
            this.renderAll();
            return;
        }
        this.initialized = true;

        if (typeof COMPANY_METRICS === 'undefined') {
            console.warn('AI 产业链依赖 COMPANY_METRICS 未加载');
            return;
        }
        if (!Utils.ensureEcharts()) return;

        this.companies = this.buildCompanies();
        this.renderLayerButtons();
        this.bindEvents();
        this.renderAll();
    },

    buildCompanies() {
        const rows = [];
        for (const [code, metrics] of Object.entries(COMPANY_METRICS)) {
            const layerKey = this.matchLayer(code, metrics);
            if (!layerKey) continue;

            const rd = typeof RD_SCORES !== 'undefined' ? RD_SCORES[code] : null;
            const rdScore = rd && rd.rd_applicable && rd.score != null ? Number(rd.score) : null;
            const mscore = this.toNum(metrics.mscore);
            const score = this.scoreCompany(metrics, rdScore);
            const gate = this.evaluateGate(metrics, rdScore);

            rows.push({
                code,
                name: metrics.name || code,
                ind1: metrics.ind1,
                ind2: String(metrics.ind2 || ''),
                indnme: this.getIndustryName(metrics),
                layerKey,
                layerName: this.layers[layerKey].name,
                chainScore: score,
                rdScore,
                revenueCagr: this.toNum(metrics.revenue_cagr3),
                profitCagr: this.toNum(metrics.profit_cagr3),
                roe: this.toNum(metrics.roe),
                mscore,
                revenue: this.toNum(metrics.revenue),
                totalAssets: this.toNum(metrics.total_assets),
                riskLevel: metrics.risk_level || '--',
                riskSafe: gate.phase1Safe,
                gateStatus: gate.status,
                gateReason: gate.reason,
                phase: gate.phase,
                evidenceStatus: gate.evidenceStatus
            });
        }
        rows.sort((a, b) => b.chainScore - a.chainScore);
        return rows;
    },

    matchLayer(code, metrics) {
        const ind2 = String(metrics.ind2 || '');
        const indnme = this.getIndustryName(metrics);
        const candidates = [];

        for (const [key, layer] of Object.entries(this.layers)) {
            const indHit = layer.ind2.includes(ind2);
            const kwHit = layer.keywords.some(kw => indnme.includes(kw));
            if (!indHit && !kwHit) continue;

            let priority = layer.ind2.indexOf(ind2);
            if (priority < 0) priority = 99;
            candidates.push({ key, priority });
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.priority - b.priority);
        return candidates[0].key;
    },

    getIndustryName(metrics) {
        const ind2 = String(metrics.ind2 || '');
        if (typeof INDUSTRY_HIERARCHY !== 'undefined') {
            for (const l1 of Object.values(INDUSTRY_HIERARCHY)) {
                if (l1.level2 && l1.level2[ind2]) return String(l1.level2[ind2]);
            }
        }
        return String(metrics.indnme || ind2);
    },

    scoreCompany(metrics, rdScore) {
        const revenueCagr = this.clamp(this.toNum(metrics.revenue_cagr3), -30, 60);
        const profitCagr = this.clamp(this.toNum(metrics.profit_cagr3), -50, 80);
        const roe = this.clamp(this.toNum(metrics.roe), -20, 25);
        const mscore = this.toNum(metrics.mscore);
        const revenue = this.toNum(metrics.revenue);
        const riskLevel = metrics.risk_level || '';

        const growthScore = revenueCagr == null ? 45 : (revenueCagr + 30) / 90 * 100;
        const profitScore = profitCagr == null ? 45 : (profitCagr + 50) / 130 * 100;
        const roeScore = roe == null ? 45 : (roe + 20) / 45 * 100;
        const scaleScore = revenue == null ? 45 : this.clamp(Math.log10(Math.max(revenue, 1)) / 3 * 100, 0, 100);
        const rdPart = rdScore == null ? 50 : rdScore;
        const qualityScore = mscore == null ? 50 : this.clamp((-mscore - 1.78) / 3.5 * 100, 0, 100);
        const riskPenalty = riskLevel === '高风险' || riskLevel === '极高风险' ? 18 : riskLevel === '中等风险' ? 8 : 0;

        const score = growthScore * 0.22 + profitScore * 0.13 + roeScore * 0.16 +
            scaleScore * 0.12 + rdPart * 0.25 + qualityScore * 0.12 - riskPenalty;
        return Math.round(this.clamp(score, 0, 100) * 10) / 10;
    },

    evaluateGate(metrics, rdScore) {
        const riskLevel = metrics.risk_level || '';
        const mscore = this.toNum(metrics.mscore);
        const revenueCagr = this.toNum(metrics.revenue_cagr3);
        const profitCagr = this.toNum(metrics.profit_cagr3);
        const roe = this.toNum(metrics.roe);

        if (riskLevel === '极高风险' || riskLevel === '高风险') {
            return {
                status: '淘汰',
                phase: 'P1 硬排雷',
                reason: riskLevel,
                evidenceStatus: 'INFERRED',
                phase1Safe: false
            };
        }

        const warnings = [];
        if (riskLevel === '中等风险') warnings.push('中等风险');
        if (mscore != null && mscore > -1.78) warnings.push('M-Score偏高');
        if (profitCagr != null && profitCagr < -20) warnings.push('利润下滑');
        if (roe != null && roe < 0) warnings.push('ROE为负');

        if (warnings.length > 0) {
            return {
                status: '关注',
                phase: 'P1 硬排雷',
                reason: warnings.slice(0, 2).join(' / '),
                evidenceStatus: 'INFERRED',
                phase1Safe: true
            };
        }

        const missing = [];
        if (mscore == null) missing.push('M-Score');
        if (revenueCagr == null) missing.push('营收CAGR');
        if (rdScore == null) missing.push('R&D');
        if (missing.length > 0) {
            return {
                status: '数据不足',
                phase: 'P1 硬排雷',
                reason: `缺${missing.slice(0, 2).join('/')}`,
                evidenceStatus: 'UNVERIFIED',
                phase1Safe: false
            };
        }

        return {
            status: '数据不足',
            phase: 'P2 交叉验证',
            reason: '缺收入/客户证据',
            evidenceStatus: 'UNVERIFIED',
            phase1Safe: true
        };
    },

    renderLayerButtons() {
        const container = document.getElementById('ai-chain-layer-buttons');
        if (!container) return;
        let html = '<button class="btn btn-active" data-layer="all">全部</button>';
        for (const [key, layer] of Object.entries(this.layers)) {
            html += `<button class="btn" data-layer="${key}">${layer.name}</button>`;
        }
        container.innerHTML = html;
    },

    bindEvents() {
        const layerBox = document.getElementById('ai-chain-layer-buttons');
        if (layerBox && layerBox.dataset.bound !== 'true') {
            layerBox.dataset.bound = 'true';
            layerBox.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-layer]');
                if (!btn) return;
                this.activeLayer = btn.dataset.layer || 'all';
                layerBox.querySelectorAll('[data-layer]').forEach(item => {
                    item.classList.toggle('btn-active', item === btn);
                });
                this.renderAll();
            });
        }

        const sortSelect = document.getElementById('ai-chain-sort');
        if (sortSelect && sortSelect.dataset.bound !== 'true') {
            sortSelect.dataset.bound = 'true';
            sortSelect.addEventListener('change', () => {
                this.sortKey = sortSelect.value;
                this.renderTable();
            });
        }

        const topN = document.getElementById('ai-chain-top-n');
        if (topN && topN.dataset.bound !== 'true') {
            topN.dataset.bound = 'true';
            topN.addEventListener('change', () => this.renderTable());
        }
    },

    renderAll() {
        this.renderKpis();
        this.renderLayerChart();
        this.renderScatter();
        this.renderTable();
        this.renderProfile();
    },

    getFilteredCompanies() {
        const rows = this.activeLayer === 'all'
            ? this.companies.slice()
            : this.companies.filter(item => item.layerKey === this.activeLayer);
        rows.sort((a, b) => (b[this.sortKey] ?? -Infinity) - (a[this.sortKey] ?? -Infinity));
        return rows;
    },

    getLayerStats() {
        const stats = {};
        for (const key of Object.keys(this.layers)) {
            const rows = this.companies.filter(c => c.layerKey === key);
            stats[key] = {
                count: rows.length,
                avgScore: this.avg(rows, 'chainScore'),
                avgRd: this.avg(rows.filter(r => r.rdScore != null), 'rdScore'),
                avgGrowth: this.avg(rows, 'revenueCagr'),
                safeRate: rows.length ? rows.filter(r => r.riskSafe).length / rows.length * 100 : null,
                revenueSum: rows.reduce((sum, r) => sum + (r.revenue || 0), 0)
            };
        }
        return stats;
    },

    renderKpis() {
        const rows = this.getFilteredCompanies();
        const rdRows = rows.filter(r => r.rdScore != null);
        const safeRows = rows.filter(r => r.riskSafe);
        this.setText('ai-chain-kpi-count', rows.length);
        this.setText('ai-chain-kpi-count-sub', this.activeLayer === 'all' ? '覆盖全部 AI 映射环节' : this.layers[this.activeLayer].name);
        this.setText('ai-chain-kpi-score', this.formatNumber(this.avg(rows, 'chainScore'), 1));
        this.setText('ai-chain-kpi-rd', rows.length ? Math.round(rdRows.length / rows.length * 100) : '--');
        this.setText('ai-chain-kpi-safe', rows.length ? Math.round(safeRows.length / rows.length * 100) : '--');
    },

    renderLayerChart() {
        const dom = document.getElementById('ai-chain-layer-chart');
        if (!dom) return;
        this.layerChart = Utils.createChart(dom, this.layerChart);
        if (!this.layerChart) return;

        const tc = Utils.themeColors();
        const stats = this.getLayerStats();
        const keys = Object.keys(this.layers);
        const names = keys.map(k => this.layers[k].name);
        const values = keys.map(k => stats[k].avgScore || 0);
        const counts = keys.map(k => stats[k].count || 0);

        this.layerChart.setOption({
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params) => {
                    const idx = params[0].dataIndex;
                    const key = keys[idx];
                    const stat = stats[key];
                    return `${this.layers[key].name}<br/>候选: ${stat.count} 家<br/>平均候选热度: ${this.formatNumber(stat.avgScore, 1)}<br/>研发均值: ${this.formatNumber(stat.avgRd, 1)}<br/>排雷通过/关注: ${this.formatNumber(stat.safeRate, 1)}%`;
                }
            },
            grid: { left: 90, right: 18, top: 14, bottom: 28 },
            xAxis: {
                type: 'value',
                max: 100,
                axisLabel: { color: tc.textMuted, fontSize: 11 },
                splitLine: { lineStyle: { color: tc.splitLine } }
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisLabel: { color: tc.textSecondary, fontSize: 11 }
            },
            series: [{
                type: 'bar',
                data: values.map((value, idx) => ({
                    value,
                    itemStyle: { color: this.layers[keys[idx]].color },
                    label: { formatter: `${value.toFixed(1)} / ${counts[idx]}家` }
                })),
                barMaxWidth: 24,
                label: { show: true, position: 'right', color: tc.textLight, fontSize: 10 }
            }]
        }, true);

        this.layerChart.off('click');
        this.layerChart.on('click', params => {
            const key = keys[params.dataIndex];
            if (!key) return;
            this.activeLayer = key;
            document.querySelectorAll('#ai-chain-layer-buttons [data-layer]').forEach(btn => {
                btn.classList.toggle('btn-active', btn.dataset.layer === key);
            });
            this.renderAll();
        });
    },

    renderScatter() {
        const dom = document.getElementById('ai-chain-scatter-chart');
        if (!dom) return;
        this.scatterChart = Utils.createChart(dom, this.scatterChart);
        if (!this.scatterChart) return;

        const tc = Utils.themeColors();
        const rows = this.getFilteredCompanies().filter(r => r.revenueCagr != null && r.rdScore != null);
        const grouped = {};
        rows.forEach(row => {
            if (!grouped[row.layerKey]) grouped[row.layerKey] = [];
            grouped[row.layerKey].push(row);
        });

        const series = Object.keys(grouped).map(key => ({
            name: this.layers[key].name,
            type: 'scatter',
            data: grouped[key].map(row => [row.revenueCagr, row.rdScore, row.revenue || 0, row.chainScore, row.code, row.name]),
            symbolSize: value => this.clamp(Math.sqrt(Math.max(value[2], 1)) * 2.2, 7, 38),
            itemStyle: { color: this.layers[key].color, opacity: 0.76 }
        }));

        this.scatterChart.setOption({
            tooltip: {
                formatter: params => {
                    const v = params.value;
                    return `<strong>${Utils.escapeHtml(v[5])}</strong> (${v[4]})<br/>环节: ${params.seriesName}<br/>营收CAGR: ${this.formatNumber(v[0], 1)}%<br/>R&D评分: ${this.formatNumber(v[1], 1)}<br/>候选热度: ${this.formatNumber(v[3], 1)}<br/>营收: ${this.formatNumber(v[2], 1)} 亿`;
                }
            },
            legend: {
                type: 'scroll',
                top: 0,
                textStyle: { color: tc.textMuted, fontSize: 11 }
            },
            grid: { left: 54, right: 18, top: 42, bottom: 42 },
            xAxis: {
                type: 'value',
                name: '营收CAGR%',
                axisLabel: { color: tc.textMuted, fontSize: 11 },
                splitLine: { lineStyle: { color: tc.splitLine } }
            },
            yAxis: {
                type: 'value',
                name: 'R&D评分',
                max: 100,
                axisLabel: { color: tc.textMuted, fontSize: 11 },
                splitLine: { lineStyle: { color: tc.splitLine } }
            },
            series
        }, true);

        this.scatterChart.off('click');
        this.scatterChart.on('click', params => {
            const code = params.value && params.value[4];
            if (code && typeof CompanyModule !== 'undefined') CompanyModule.openDrawer(code);
        });
    },

    renderTable() {
        const tbody = document.getElementById('ai-chain-company-tbody');
        const title = document.getElementById('ai-chain-table-title');
        if (!tbody) return;

        const topN = parseInt(document.getElementById('ai-chain-top-n')?.value || '20');
        const rows = this.getFilteredCompanies().slice(0, topN);
        if (title) {
            const label = this.activeLayer === 'all' ? 'AI 产业链候选标的' : `${this.layers[this.activeLayer].name}候选标的`;
            title.textContent = `${label} — ${rows.length} 家`;
        }

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);">暂无匹配样本</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map((row, idx) => {
            const badgeClass = Utils.getRiskLevelClass(row.riskLevel);
            const gateClass = this.gateClass(row.gateStatus);
            return `<tr data-code="${Utils.escapeHtml(row.code)}">
                <td>${idx + 1}</td>
                <td class="font-mono">${Utils.escapeHtml(row.code)}</td>
                <td>${Utils.escapeHtml(row.name)}</td>
                <td><span class="ai-chain-layer-pill" style="--layer-color:${this.layers[row.layerKey].color};">${Utils.escapeHtml(row.layerName)}</span></td>
                <td><span class="ai-chain-phase">${Utils.escapeHtml(row.phase)}</span></td>
                <td><span class="ai-chain-gate ${gateClass}" title="${Utils.escapeHtml(row.gateReason)}">${Utils.escapeHtml(row.gateStatus)}</span></td>
                <td class="${this.scoreClass(row.chainScore)}">${this.formatNumber(row.chainScore, 1)}</td>
                <td>${row.rdScore == null ? '--' : this.formatNumber(row.rdScore, 1)}</td>
                <td>${row.revenueCagr == null ? '--' : this.formatNumber(row.revenueCagr, 1) + '%'}</td>
                <td><span class="badge ${badgeClass}">${Utils.escapeHtml(row.riskLevel)}</span></td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('tr[data-code]').forEach(tr => {
            tr.addEventListener('click', () => {
                const code = tr.dataset.code;
                if (code && typeof CompanyModule !== 'undefined') CompanyModule.openDrawer(code);
            });
        });
    },

    renderProfile() {
        const container = document.getElementById('ai-chain-profile');
        const subtitle = document.getElementById('ai-chain-profile-subtitle');
        if (!container) return;

        const rows = this.getFilteredCompanies();
        const stats = this.getLayerStats();
        const layerName = this.activeLayer === 'all' ? '全部' : this.layers[this.activeLayer].name;
        if (subtitle) subtitle.textContent = `当前：${layerName}`;

        const topRows = rows.slice(0, 5);
        const gateCounts = this.countBy(rows, 'gateStatus');
        const statRows = this.activeLayer === 'all'
            ? Object.keys(this.layers).map(k => ({ key: k, ...stats[k] }))
            : [{ key: this.activeLayer, ...stats[this.activeLayer] }];

        container.innerHTML = `
            <div class="ai-chain-note">
                口径：先用行业映射建立 Phase 0 候选池，再用 M-Score、风险等级、成长、盈利和 R&D 做 Phase 1 财务排雷代理。候选热度不是最终验证结论；收入、客户、产品和反共识证据仍需独立补充。
            </div>
            <div class="ai-chain-method">
                <div><strong>筛选流水线</strong></div>
                <span>0 范围</span><span>1 排雷</span><span>2 交叉验证</span><span>3 反证</span><span>4 估值时机</span><span>5 后验仓位</span><span>6 监控纠错</span>
            </div>
            <div class="ai-chain-profile-grid">
                ${['通过', '关注', '数据不足', '淘汰'].map(status => `<div class="ai-chain-profile-row">
                    <span>${Utils.escapeHtml(status)}</span>
                    <strong>${gateCounts[status] || 0}</strong>
                    <em>${rows.length ? Math.round((gateCounts[status] || 0) / rows.length * 100) : 0}%</em>
                </div>`).join('')}
            </div>
            <div class="ai-chain-profile-grid">
                ${statRows.map(s => `<div class="ai-chain-profile-row">
                    <span><i style="background:${this.layers[s.key].color};"></i>${Utils.escapeHtml(this.layers[s.key].name)}</span>
                    <strong>${this.formatNumber(s.avgScore, 1)}</strong>
                    <em>${s.count} 家</em>
                </div>`).join('')}
            </div>
            <div class="ai-chain-mini-title">Top 标的</div>
            <div class="ai-chain-top-list">
                ${topRows.map((r, idx) => `<button class="ai-chain-top-item" data-code="${Utils.escapeHtml(r.code)}">
                    <span>${idx + 1}</span>
                    <strong>${Utils.escapeHtml(r.name)}</strong>
                    <em>${this.formatNumber(r.chainScore, 1)}</em>
                </button>`).join('')}
            </div>
        `;

        container.querySelectorAll('[data-code]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof CompanyModule !== 'undefined') CompanyModule.openDrawer(btn.dataset.code);
            });
        });
    },

    gateClass(status) {
        switch (status) {
            case '通过': return 'gate-pass';
            case '关注': return 'gate-watch';
            case '淘汰': return 'gate-fail';
            case '数据不足':
            default: return 'gate-unknown';
        }
    },

    scoreClass(value) {
        if (value >= 70) return 'perc-high';
        if (value >= 45) return 'perc-mid';
        return 'perc-low';
    },

    setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    avg(rows, key) {
        const vals = rows.map(r => r[key]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    },

    countBy(rows, key) {
        return rows.reduce((acc, row) => {
            const value = row[key] || '--';
            acc[value] = (acc[value] || 0) + 1;
            return acc;
        }, {});
    },

    toNum(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    },

    clamp(value, min, max) {
        if (value === null || value === undefined || Number.isNaN(value)) return null;
        return Math.max(min, Math.min(max, value));
    },

    formatNumber(value, decimals = 1) {
        if (value === null || value === undefined || Number.isNaN(value)) return '--';
        return Number(value).toFixed(decimals);
    },

    resize() {
        [this.layerChart, this.scatterChart].forEach(chart => chart?.resize());
    }
};

window.addEventListener('resize', () => {
    if (AIChainModule.initialized) AIChainModule.resize();
});
