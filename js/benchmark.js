/**
 * A股财务数据全景仪表盘 - 行业对标 (Industry Benchmarking) 模块
 * 左栏：一级行业热力图 | 中栏：二级细分对比 | 右栏：个股分位排名
 */

const BenchmarkModule = {
    activeDim: 'composite',
    selectedL1: null,
    selectedL2: null,
    heatmapChart: null,
    radarChart: null,
    l2ViewMode: 'table',
    initialized: false,

    // 维度 → 显示的指标集合
    dimMetrics: {
        composite: ['composite'],
        profit: ['roe', 'roa', 'asset_turnover'],
        growth: ['revenue_cagr3', 'profit_cagr3', 'asset_growth'],
        risk: ['mscore'],
        scale: ['revenue', 'total_assets', 'cr5']
    },

    // 指标中文标签
    metricLabels: {
        composite: '综合分位', roe: 'ROE%', roa: 'ROA%', asset_turnover: '周转率',
        revenue_cagr3: '营收CAGR%', profit_cagr3: '净利CAGR%', asset_growth: '资产增速%',
        mscore: 'M-Score', revenue: '营收(亿)', total_assets: '总资产(亿)', cr5: 'CR5%'
    },

    // ========== 初始化入口 ==========
    init() {
        if (this.initialized) return;
        this.initialized = true;

        if (typeof INDUSTRY_HIERARCHY === 'undefined' || typeof INDUSTRY_L1_BENCHMARK === 'undefined') {
            console.warn('行业对标数据未加载');
            return;
        }
        if (!Utils.ensureEcharts()) return;

        this.bindToolbarEvents();
        this.renderHeatmap();
        this.renderL2All();
        this.clearCompanyPanel();
        Utils.initChartResize([this.heatmapChart, this.radarChart]);
    },

    // ========== 工具栏事件绑定 ==========
    bindToolbarEvents() {
        if (this._eventsBound) return;
        this._eventsBound = true;

        // 维度切换按钮
        const toolbar = document.querySelector('.benchmark-toolbar');
        if (!toolbar) return;

        toolbar.querySelectorAll('[data-dim]').forEach(btn => {
            if (btn.dataset.benchBound === 'true') return;
            btn.dataset.benchBound = 'true';
            btn.addEventListener('click', () => {
                const dim = btn.getAttribute('data-dim');
                if (dim) this.switchDim(dim);
            });
        });

        // 二级视图模式切换
        const viewMode = document.getElementById('l2-view-mode');
        if (viewMode) {
            viewMode.addEventListener('change', () => {
                this.l2ViewMode = viewMode.value;
                if (this.selectedL1) this.renderL2Panel();
            });
        }

        // 个股 Top-N
        const topN = document.getElementById('company-top-n');
        if (topN) {
            topN.addEventListener('change', () => {
                if (this.selectedL2) this.renderCompanyRank();
            });
        }
    },

    // ========== 维度切换 ==========
    switchDim(dim) {
        if (this.activeDim === dim) return;
        this.activeDim = dim;

        // 更新按钮 active 状态
        const toolbar = document.querySelector('.benchmark-toolbar');
        if (toolbar) {
            toolbar.querySelectorAll('[data-dim]').forEach(btn => {
                btn.classList.toggle('btn-active', btn.getAttribute('data-dim') === dim);
            });
        }

        // 重新渲染
        this.renderHeatmap();
        if (this.selectedL1) this.renderL2Panel();
        if (this.selectedL2) this.renderCompanyRank();
    },

    // ========== 热力图 (左栏) ==========
    renderHeatmap() {
        const container = document.getElementById('benchmark-heatmap');
        if (!container) return;

        const themes = Utils.themeColors();
        const chart = Utils.createChart(container, this.heatmapChart);
        if (!chart) return;
        this.heatmapChart = chart;

        const metrics = this.dimMetrics[this.activeDim];
        const allL1Codes = Object.keys(INDUSTRY_HIERARCHY)
            .filter(k => INDUSTRY_L1_BENCHMARK[k])
            .sort();

        const yData = [];
        const heatData = [];
        const xData = metrics.map(m => this.metricLabels[m] || m);

        allL1Codes.forEach((l1Code, rowIdx) => {
            const info = INDUSTRY_L1_BENCHMARK[l1Code];
            yData.push((info.name || l1Code) + ' (' + (info.sample_size || 0) + ')');

            metrics.forEach((metric, colIdx) => {
                let value = null;

                if (metric === 'composite') {
                    // 综合分位：取该行业所有可用中位数的均值
                    const meds = info.medians;
                    const vals = Object.values(meds).filter(v => v !== null && v !== undefined);
                    value = vals.length > 0
                        ? vals.reduce((s, v) => s + v, 0) / vals.length
                        : null;
                } else if (metric === 'cr5') {
                    value = info.concentration_cr5;
                } else {
                    value = info.medians ? info.medians[metric] : null;
                }

                if (value !== null && value !== undefined) {
                    const isSelected = this.selectedL1 && l1Code === this.selectedL1;
                    const isDimmed = this.selectedL1 && l1Code !== this.selectedL1;
                    heatData.push({
                        value: [colIdx, rowIdx, Number(value)],
                        itemStyle: {
                            opacity: isDimmed ? 0.18 : 0.88,
                            borderColor: isSelected ? themes.textLight : 'transparent',
                            borderWidth: isSelected ? 1.5 : 0
                        }
                    });
                }
            });
        });

        const option = {
            tooltip: {
                position: 'top',
                backgroundColor: themes.tooltipBg,
                borderColor: themes.tooltipBorder,
                textStyle: { color: themes.textLight, fontSize: 12 },
                formatter: function (params) {
                    const rowName = yData[params.data.value[1]] || '';
                    const colName = xData[params.data.value[0]] || '';
                    const val = params.data.value[2];
                    return rowName + '<br/>' + colName + '：<b>' + val.toFixed(2) + '</b>';
                }
            },
            grid: {
                left: 130,
                right: 60,
                top: 10,
                bottom: 30
            },
            xAxis: {
                type: 'category',
                data: xData,
                position: 'top',
                axisLine: { lineStyle: { color: themes.axisLine } },
                axisTick: { show: false },
                axisLabel: {
                    color: themes.textMuted,
                    fontSize: 10,
                    interval: 0
                },
                splitArea: { show: true }
            },
            yAxis: {
                type: 'category',
                data: yData,
                axisLine: { lineStyle: { color: themes.axisLine } },
                axisTick: { show: false },
                axisLabel: {
                    color: themes.textSecondary,
                    fontSize: 11,
                    width: 110,
                    overflow: 'truncate'
                },
                splitArea: { show: true }
            },
            visualMap: {
                min: 0,
                max: 100,
                calculable: true,
                orient: 'vertical',
                right: 0,
                top: 'center',
                itemWidth: 10,
                itemHeight: 180,
                textStyle: { color: themes.textMuted, fontSize: 10 },
                inRange: {
                    color: ['#ef4444', '#eab308', '#22c55e']
                }
            },
            series: [{
                name: this.metricLabels[this.activeDim] || this.activeDim,
                type: 'heatmap',
                data: heatData,
                label: {
                    show: true,
                    fontSize: 9,
                    color: themes.textLight,
                    formatter: function (p) {
                        const v = p.data.value ? p.data.value[2] : p.value[2];
                        if (v == null) return '';
                        return v.toFixed(1);
                    }
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 8,
                        shadowColor: 'rgba(0, 0, 0, 0.3)'
                    }
                }
            }]
        };

        chart.setOption(option, true);

        // ---- 点击事件：下钻到 L1 ----
        chart.off('click');
        chart.on('click', (params) => {
            if (!params.data || !params.data.value) return;
            const rowIdx = Array.isArray(params.data.value) ? params.data.value[1] : params.value[1];
            if (rowIdx === undefined) return;
            const l1Code = allL1Codes[rowIdx];
            if (l1Code) this.drillL1(l1Code);
        });
    },

    // ========== 下钻到一级行业 ==========
    drillL1(l1Code) {
        this.selectedL1 = l1Code;
        this.selectedL2 = null;
        this.updateBreadcrumb();
        this.renderHeatmap();
        this.renderL2Panel();
        this.clearCompanyPanel();
    },

    // ========== 二级细分面板 (中栏) ==========
    renderL2All() {
        const thead = document.getElementById('benchmark-l2-thead');
        const tbody = document.getElementById('benchmark-l2-tbody');
        const title = document.getElementById('benchmark-l2-title');
        if (title) title.textContent = '二级细分对比 — 全部行业';

        if (thead) {
            thead.innerHTML = '<tr><th>排名</th><th>行业</th><th>样本量</th><th>指标值</th></tr>';
        }
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">二级细分数据加载中 — 将在任务5实现</td></tr>';
        }

        // 隐藏雷达图，显示表格
        const radar = document.getElementById('benchmark-l2-radar');
        const tableWrapper = document.getElementById('benchmark-l2-table-wrapper');
        if (radar) radar.classList.add('hidden');
        if (tableWrapper) tableWrapper.classList.remove('hidden');
    },

    renderL2Panel() {
        if (!this.selectedL1) {
            this.renderL2All();
            return;
        }
        // 占位：任务5实现实际的 L2 数据渲染
        this.renderL2All();
    },

    // ========== 个股排名 (右栏) ==========
    renderCompanyRank() {
        if (!this.selectedL2) {
            this.clearCompanyPanel();
            return;
        }
        // 占位：任务6实现
        document.getElementById('benchmark-company-title').textContent = '个股排名 — 任务6实现';
        document.getElementById('benchmark-company-tbody').innerHTML = '';
    },

    // ========== 面包屑导航 ==========
    updateBreadcrumb() {
        const crumbL1 = document.querySelector('.crumb[data-level="l1"]');
        const crumbL2 = document.querySelector('.crumb[data-level="l2"]');
        const crumbCmp = document.querySelector('.crumb[data-level="company"]');
        const sep1 = document.querySelector('.crumb-sep[data-level="sep1"]');
        const sep2 = document.querySelector('.crumb-sep[data-level="sep2"]');

        if (!this.selectedL1) {
            // 顶层：显示 "全行业"
            if (crumbL1) {
                crumbL1.textContent = '全行业';
                crumbL1.classList.add('active');
            }
            if (crumbL2) {
                crumbL2.textContent = '--';
                crumbL2.classList.add('hidden');
                crumbL2.classList.remove('active');
            }
            if (crumbCmp) {
                crumbCmp.textContent = '--';
                crumbCmp.classList.add('hidden');
                crumbCmp.classList.remove('active');
            }
            if (sep1) sep1.classList.add('hidden');
            if (sep2) sep2.classList.add('hidden');
        } else {
            // L1 选中
            const l1Info = INDUSTRY_L1_BENCHMARK[this.selectedL1];
            const l1Name = l1Info ? l1Info.name : this.selectedL1;

            if (crumbL1) {
                crumbL1.textContent = l1Name;
                crumbL1.classList.toggle('active', !this.selectedL2);
            }
            if (crumbL2) {
                crumbL2.classList.remove('hidden');
            }
            if (sep1) sep1.classList.remove('hidden');

            if (this.selectedL2) {
                const l2Info = INDUSTRY_L2_BENCHMARK[this.selectedL2];
                const l2Name = l2Info ? l2Info.name : this.selectedL2;

                if (crumbL2) {
                    crumbL2.textContent = l2Name;
                    crumbL2.classList.add('active');
                    crumbL2.classList.remove('hidden');
                }
                if (crumbCmp) {
                    crumbCmp.textContent = '个股排名';
                    crumbCmp.classList.remove('hidden');
                }
                if (sep2) sep2.classList.remove('hidden');
            } else {
                if (crumbL2) {
                    crumbL2.textContent = '选择二级行业';
                    crumbL2.classList.remove('active');
                }
                if (crumbCmp) {
                    crumbCmp.classList.add('hidden');
                }
                if (sep2) sep2.classList.add('hidden');
            }

            // 点击 L1 crumb 回到顶层
            if (crumbL1 && !this._crumbL1Bound) {
                this._crumbL1Bound = true;
                crumbL1.addEventListener('click', () => {
                    BenchmarkModule.selectedL1 = null;
                    BenchmarkModule.selectedL2 = null;
                    BenchmarkModule.renderHeatmap();
                    BenchmarkModule.renderL2All();
                    BenchmarkModule.clearCompanyPanel();
                    BenchmarkModule.updateBreadcrumb();
                });
            }
        }
    },

    // ========== 清空个股面板 ==========
    clearCompanyPanel() {
        const thead = document.getElementById('benchmark-company-thead');
        const tbody = document.getElementById('benchmark-company-tbody');
        const title = document.getElementById('benchmark-company-title');
        if (thead) thead.innerHTML = '';
        if (tbody) tbody.innerHTML = '';
        if (title) title.textContent = '个股分位排名 — 请先选择行业';
    },

    // ========== 分位值颜色标记 ==========
    dimColor(val) {
        if (val == null) return 'perc-na';
        if (val >= 75) return 'perc-high';
        if (val >= 25) return 'perc-mid';
        return 'perc-low';
    }
};

// ========== 键盘导航：Escape 逐级返回 ==========
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const benchTab = document.getElementById('benchmark-tab');
    if (!benchTab || !benchTab.classList.contains('active')) return;

    if (BenchmarkModule.selectedL2) {
        BenchmarkModule.selectedL2 = null;
        BenchmarkModule.renderL2Panel();
        BenchmarkModule.clearCompanyPanel();
        BenchmarkModule.updateBreadcrumb();
    } else if (BenchmarkModule.selectedL1) {
        BenchmarkModule.selectedL1 = null;
        BenchmarkModule.renderHeatmap();
        BenchmarkModule.renderL2All();
        BenchmarkModule.clearCompanyPanel();
        BenchmarkModule.updateBreadcrumb();
    }
});
