/**
 * A股财务数据全景仪表盘 - 研发竞争力 (R&D Competitiveness) 模块
 * 7维加权评分：强度/增速/健康度/持续性/效率/定价权/无形资产
 * 左栏：行业组+权重控制 | 中栏：ECharts 评分柱状图 | 右栏：雷达+趋势+护城河 | 底：热力图
 */
const RDModule = {
    activeGroup: 'all',
    activeYear: null,
    weights: { ...RD_DEFAULT_WEIGHTS },
    selectedStkcd: null,
    initialized: false,
    barChart: null,
    radarChart: null,
    trendChart: null,
    heatmapChart: null,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        if (typeof RD_SCORES === 'undefined' || typeof RD_INDUSTRY_GROUPS === 'undefined') {
            console.warn('研发竞争力数据未加载');
            return;
        }
        if (!Utils.ensureEcharts()) return;
        // Determine latest year
        const years = new Set();
        Object.values(RD_SCORES).forEach(r => { if (r.year) years.add(r.year); });
        this.activeYear = Math.max(...years);
        this.renderGroupButtons();
        this.renderWeightSliders();
        this.renderYearSelect(years);
        this.renderBarChart();
        this.renderHeatmap();
        this.bindEvents();
        if (typeof MoatModule !== 'undefined') MoatModule.refreshCoverage();
    },

    _checkDataAvailability() {
        const total = Object.values(RD_SCORES).filter(r => r.rd_applicable).length;
        if (total === 0) {
            document.getElementById('rd-bar-chart').innerHTML =
                '<div style="text-align:center;padding:40px;color:var(--text-secondary);">暂无研发数据</div>';
            return false;
        }
        const current = Object.values(RD_SCORES).filter(r => r.rd_applicable && r.year === this.activeYear).length;
        if (current === 0) {
            document.getElementById('rd-bar-chart').innerHTML =
                `<div style="text-align:center;padding:40px;color:var(--text-secondary);">${this.activeYear} 年暂无数据，请切换年份</div>`;
            return false;
        }
        return true;
    },

    renderGroupButtons() {
        const container = document.getElementById('rd-group-buttons');
        let html = '<button class="rd-group-btn active" data-group="all">全部</button>';
        for (const [key, cfg] of Object.entries(RD_INDUSTRY_GROUPS)) {
            html += `<button class="rd-group-btn" data-group="${key}">${cfg.name}</button>`;
        }
        container.innerHTML = html;
    },

    renderWeightSliders() {
        const labels = {
            rd_intensity: '研发强度', rd_cagr: '增速',
            cap_rate: '健康度', persistence: '持续性',
            efficiency: '效率', pricing_power: '定价权',
            intang_ratio: '无形资产'
        };
        const container = document.getElementById('rd-weight-sliders');
        let html = '';
        for (const [key, w] of Object.entries(this.weights)) {
            html += `<div class="rd-slider-row">
                <label>${labels[key] || key}</label>
                <input type="range" min="0" max="100" value="${w}" data-dim="${key}">
                <span class="rd-slider-val">${w}</span>
            </div>`;
        }
        container.innerHTML = html;
    },

    renderYearSelect(years) {
        const sel = document.getElementById('rd-year-select');
        sel.innerHTML = '';
        [...years].sort((a, b) => b - a).forEach(y => {
            sel.innerHTML += `<option value="${y}" ${y === this.activeYear ? 'selected' : ''}>${y}</option>`;
        });
    },

    bindEvents() {
        document.querySelectorAll('.rd-group-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rd-group-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeGroup = btn.dataset.group;
                this.renderBarChart();
                this.renderHeatmap();
                if (typeof MoatModule !== 'undefined') MoatModule.refreshCoverage();
            });
        });
        document.querySelectorAll('.rd-slider-row input').forEach(slider => {
            slider.addEventListener('input', () => {
                const dim = slider.dataset.dim;
                const val = parseInt(slider.value);
                this.weights[dim] = val;
                slider.nextElementSibling.textContent = val;
                this.renderBarChart();
            });
        });
        document.getElementById('rd-year-select').addEventListener('change', (e) => {
            this.activeYear = parseInt(e.target.value);
            this.renderBarChart();
            this.renderHeatmap();
        });
        document.getElementById('rd-top-n').addEventListener('change', () => {
            this.renderBarChart();
        });
    },

    getFilteredCompanies() {
        const results = [];
        for (const [stkcd, data] of Object.entries(RD_SCORES)) {
            if (!data.rd_applicable) continue;
            if (data.year !== this.activeYear) continue;
            if (this.activeGroup !== 'all' && data.group !== this.activeGroup) continue;
            if (data.flags.includes('insufficient_data')) continue;
            results.push({ stkcd, ...data });
        }
        // Recalculate score with current weights
        results.forEach(r => {
            let score = 0, totalW = 0;
            for (const [dim, w] of Object.entries(this.weights)) {
                const val = r.dimensions[dim];
                if (val != null) { score += val * w; totalW += w; }
            }
            r.weightedScore = totalW > 0 ? Math.round(score / totalW * 10) / 10 : null;
        });
        results.sort((a, b) => (b.weightedScore ?? -1) - (a.weightedScore ?? -1));
        const topN = parseInt(document.getElementById('rd-top-n')?.value || '20');
        return results.slice(0, topN);
    },

    getBarOption() {
        const data = this.getFilteredCompanies();
        // Horizontal bar chart
        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params) => {
                    const data = this.getFilteredCompanies();
                    const idx = data.length - 1 - params[0].dataIndex;
                    const item = data[idx];
                    if (!item) return '';
                    let html = `<strong>${item.name}</strong> (${item.stkcd || ''})<br/>`;
                    html += `综合评分: ${item.weightedScore}<br/>`;
                    const dimLabels = {
                        rd_intensity: '研发强度', rd_cagr: '增速',
                        cap_rate: '健康度', persistence: '持续性',
                        efficiency: '效率', pricing_power: '定价权',
                        intang_ratio: '无形资产'
                    };
                    for (const [dim, val] of Object.entries(item.dimensions)) {
                        if (val != null) html += `  ${dimLabels[dim] || dim}: ${val}<br/>`;
                    }
                    if (item.flags.length > 0) {
                        html += `<br/>⚠️ 排雷标记: ${item.flags.join(', ')}`;
                    }
                    if (typeof MoatModule !== 'undefined' && MoatModule.hasNotes(item.stkcd)) {
                        const moat = MoatModule.getMoat(item.stkcd);
                        if (moat.barrier_level >= 4 && moat.irreplaceability >= 4) html += '<br/>🛡️ 深护城河';
                        else if (moat.barrier_level >= 3 || moat.irreplaceability >= 3) html += '<br/>🔒 有壁垒';
                    }
                    return html;
                }
            },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'value', name: '综合评分', max: 100 },
            yAxis: {
                type: 'category',
                inverse: true,
                axisLabel: {
                    formatter: (v) => v.length > 6 ? v.slice(0, 5) + '..' : v,
                    fontSize: 11
                },
                data: data.map(r => `${r.name}`).reverse(),
            },
            series: [{
                type: 'bar',
                data: data.map(r => ({
                    value: r.weightedScore,
                    itemStyle: {
                        color: r.flags.includes('double_kill') ? '#ef4444'
                            : r.flags.includes('rd_cliff') ? '#f97316'
                            : r.flags.includes('cap_aggressive') ? '#eab308'
                            : '#3b82f6'
                    }
                })).reverse(),
                label: { show: true, position: 'right', fontSize: 10, formatter: '{c}' },
                barMaxWidth: 24,
            }]
        };
    },

    renderBarChart() {
        if (!this._checkDataAvailability()) return;
        if (!this.barChart) {
            this.barChart = echarts.init(document.getElementById('rd-bar-chart'), Utils.getTheme());
        }
        this.barChart.setOption(this.getBarOption());
        // Click handler
        this.barChart.off('click');
        this.barChart.on('click', (params) => {
            const idx = params.dataIndex;
            const data = this.getFilteredCompanies();
            const item = data[data.length - 1 - idx];
            if (item) this.showDetail(item.stkcd);
        });
    },

    showDetail(stkcd) {
        this.selectedStkcd = stkcd;
        const data = RD_SCORES[stkcd];
        if (!data) return;
        document.getElementById('rd-detail-title').textContent = `${data.name} (${stkcd})`;
        this.renderRadar(stkcd);
        this.renderTrend(stkcd);
        this.renderScoreHistory(stkcd);
        if (typeof MoatModule !== 'undefined') MoatModule.renderMoat(stkcd);
    },

    renderRadar(stkcd) {
        if (!this.radarChart) {
            this.radarChart = echarts.init(document.getElementById('rd-radar-chart'), Utils.getTheme());
        }
        const data = RD_SCORES[stkcd];
        const labels = {
            rd_intensity: '研发强度', rd_cagr: '增速',
            cap_rate: '健康度', persistence: '持续性',
            efficiency: '效率', pricing_power: '定价权',
            intang_ratio: '无形资产'
        };
        const indicator = Object.entries(labels).map(([k, v]) => ({ name: v, max: 100 }));
        const values = Object.entries(labels).map(([k]) => data.dimensions[k] ?? 0);
        this.radarChart.setOption({
            tooltip: {},
            legend: { data: [data.name], bottom: 0 },
            radar: { indicator, center: ['50%', '55%'], radius: '65%' },
            series: [{ type: 'radar', data: [{ value: values, name: data.name, areaStyle: { opacity: 0.15 } }] }]
        });
    },

    renderTrend(stkcd) {
        if (!this.trendChart) {
            this.trendChart = echarts.init(document.getElementById('rd-trend-chart'), Utils.getTheme());
        }
        const history = RD_HISTORY[stkcd] || [];
        const years = history.map(h => h.year);
        const intensities = history.map(h => h.rd_intensity);
        this.trendChart.setOption({
            tooltip: { trigger: 'axis' },
            grid: { left: '10%', right: '5%', top: '10%', bottom: '10%' },
            xAxis: { type: 'category', data: years },
            yAxis: { type: 'value', name: '研发强度%' },
            series: [{
                type: 'line', data: intensities, smooth: true,
                areaStyle: { opacity: 0.1 },
                lineStyle: { color: '#3b82f6' },
                itemStyle: { color: '#3b82f6' }
            }]
        });
    },

    computeHistoryScores(stkcd) {
        const history = RD_HISTORY[stkcd];
        if (!history || history.length < 1) return [];
        return history.map(h => ({
            year: h.year,
            rd_intensity: h.rd_intensity,
            rd_expense: h.rd_expense
        }));
    },

    renderScoreHistory(stkcd) {
        const histScores = this.computeHistoryScores(stkcd);
        const recent = histScores.slice(-5);
        const container = document.getElementById('rd-score-history');
        if (!container) return;
        if (recent.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">暂无历史数据</div>';
            return;
        }
        let html = '<table class="rd-history-table"><thead><tr><th>年份</th><th>研发强度%</th><th>研发费用(亿)</th></tr></thead><tbody>';
        for (const row of recent) {
            html += `<tr><td>${row.year}</td><td>${row.rd_intensity != null ? row.rd_intensity.toFixed(2) : '-'}</td><td>${row.rd_expense != null ? row.rd_expense.toFixed(2) : '-'}</td></tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    },

    renderHeatmap() {
        if (!this.heatmapChart) {
            this.heatmapChart = echarts.init(document.getElementById('rd-heatmap-chart'), Utils.getTheme());
        }
        if (typeof RD_HEATMAP_DATA === 'undefined') {
            console.warn('热力图数据未加载');
            return;
        }
        const groupsToShow = this.activeGroup === 'all'
            ? Object.keys(RD_INDUSTRY_GROUPS)
            : [this.activeGroup];
        const groupNames = groupsToShow.map(g => RD_INDUSTRY_GROUPS[g]?.name || g);
        const years = [...new Set(RD_HEATMAP_DATA.map(d => d.year))].sort();
        const heatData = [];
        let maxVal = 0;
        for (const d of RD_HEATMAP_DATA) {
            if (!groupsToShow.includes(d.group)) continue;
            heatData.push([d.year, d.group, d.median]);
            if (d.median > maxVal) maxVal = d.median;
        }
        this.heatmapChart.setOption({
            tooltip: {
                position: 'top',
                formatter: (params) => {
                    const d = RD_HEATMAP_DATA.find(x => x.year === params.value[0] && x.group === params.value[1]);
                    return `${RD_INDUSTRY_GROUPS[d.group]?.name || d.group} ${d.year}<br/>研发强度中位数: ${d.median}%<br/>样本: ${d.n} 家公司`;
                }
            },
            grid: { left: '14%', right: '5%', top: '5%', bottom: '14%' },
            xAxis: { type: 'category', data: years, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
            yAxis: {
                type: 'category',
                data: groupNames,
                splitArea: { show: true },
                axisLabel: { fontSize: 11 }
            },
            visualMap: {
                min: 0,
                max: maxVal || 1,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: '0%',
                inRange: { color: ['#f0f9ff', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7'] }
            },
            series: [{
                type: 'heatmap',
                data: heatData,
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
            }]
        });
    },

    /** Expose resize handler */
    resize() {
        [this.barChart, this.radarChart, this.trendChart, this.heatmapChart]
            .forEach(c => c?.resize());
    }
};

window.addEventListener('resize', () => {
    if (RDModule.initialized) RDModule.resize();
});
