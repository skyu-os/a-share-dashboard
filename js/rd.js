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
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
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
        document.getElementById('rd-detail-title').textContent = `${data.name} (${stkcd})`;
        this.renderRadar(stkcd);
        this.renderTrend(stkcd);
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

    renderHeatmap() {
        if (!this.heatmapChart) {
            this.heatmapChart = echarts.init(document.getElementById('rd-heatmap-chart'), Utils.getTheme());
        }
        const groups = this.activeGroup === 'all'
            ? Object.keys(RD_INDUSTRY_GROUPS)
            : [this.activeGroup];
        const years = [...new Set(Object.values(RD_SCORES).map(r => r.year))].sort();
        const data = [];
        let maxVal = 0;
        for (const g of groups) {
            const bench = INDUSTRY_RD_BENCHMARK[g];
            if (!bench) continue;
            for (const y of years) {
                const val = bench.rd_intensity_median ?? 0;
                data.push([g, y, val]);
                if (val > maxVal) maxVal = val;
            }
        }
        this.heatmapChart.setOption({
            tooltip: { position: 'top' },
            grid: { left: '14%', right: '5%', top: '5%', bottom: '8%' },
            xAxis: { type: 'category', data: years, splitArea: { show: true } },
            yAxis: {
                type: 'category',
                data: groups.map(g => RD_INDUSTRY_GROUPS[g]?.name || g),
                splitArea: { show: true }
            },
            visualMap: { min: 0, max: maxVal || 1, calculable: true,
                orient: 'horizontal', left: 'center', bottom: '0%',
                inRange: { color: ['#f0f9ff', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7'] }
            },
            series: [{
                type: 'heatmap',
                data: data.map(d => [d[1], d[0], d[2]]),
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
