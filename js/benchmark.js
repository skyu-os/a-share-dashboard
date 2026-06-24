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
                this.renderL2Panel();
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
        const allL2Codes = Object.keys(INDUSTRY_L2_BENCHMARK).sort();
        this._renderL2Table(allL2Codes);
    },

    renderL2Panel() {
        if (!this.selectedL1) { this.renderL2All(); return; }
        // Get L2 codes belonging to this L1 from INDUSTRY_HIERARCHY
        const l2Map = (INDUSTRY_HIERARCHY[this.selectedL1] || {}).level2 || {};
        const l2Codes = Object.keys(l2Map).filter(k => INDUSTRY_L2_BENCHMARK[k]).sort();
        this._renderL2Table(l2Codes);
    },

    // ========== L2 表格渲染 (内部) ==========
    _renderL2Table(l2Codes) {
        const thead = document.getElementById('benchmark-l2-thead');
        const tbody = document.getElementById('benchmark-l2-tbody');
        const tableW = document.getElementById('benchmark-l2-table-wrapper');
        const radarDom = document.getElementById('benchmark-l2-radar');
        const titleEl = document.getElementById('benchmark-l2-title');

        // Update title
        if (this.selectedL1) {
            const l1Name = (INDUSTRY_HIERARCHY[this.selectedL1] || {}).name || this.selectedL1;
            titleEl.textContent = '二级细分对比 — ' + l1Name;
        } else {
            titleEl.textContent = '二级细分对比 — 全部行业';
        }

        // Handle dual mode: table vs radar
        if (this.l2ViewMode === 'radar' && l2Codes.length >= 2) {
            tableW.classList.add('hidden');
            radarDom.classList.remove('hidden');
            this._renderL2Radar(l2Codes);
            if (l2Codes.length === 0) return; // radar handles empty
        } else {
            tableW.classList.remove('hidden');
            radarDom.classList.add('hidden');
        }

        const dim = this.activeDim;
        const metrics = this.dimMetrics[dim];

        // Build table header
        let html = '<tr><th>排名</th><th>行业</th><th>样本</th>';
        metrics.forEach(mk => {
            html += '<th>' + (this.metricLabels[mk] || mk) + '</th>';
        });
        html += '</tr>';
        thead.innerHTML = html;

        // Handle empty
        if (l2Codes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="' + (3 + metrics.length) + '" style="text-align:center;color:var(--text-muted);">该行业下暂无细分数据</td></tr>';
            return;
        }

        // Build data rows with sort key
        const rows = [];
        l2Codes.forEach(code => {
            const info = INDUSTRY_L2_BENCHMARK[code];
            if (!info) return;
            const meds = info.medians || {};

            // Compute sort value based on active dimension
            let sortVal = null;
            if (dim === 'composite') {
                // Average of all available medians as composite proxy
                const availMedians = [];
                ['roe', 'roa', 'revenue_cagr3', 'profit_cagr3', 'mscore', 'revenue'].forEach(mk => {
                    if (meds[mk] != null) availMedians.push(meds[mk]);
                });
                sortVal = availMedians.length > 0 ? availMedians.reduce((a, b) => a + b, 0) / availMedians.length : null;
            } else {
                const mainMk = metrics[0];
                sortVal = meds[mainMk];
            }

            rows.push({ code, info, meds, sortVal });
        });

        // Sort descending
        rows.sort((a, b) => (b.sortVal || -Infinity) - (a.sortVal || -Infinity));

        // Render table rows
        html = '';
        rows.forEach((r, idx) => {
            const isSelected = r.code === this.selectedL2;
            const cls = isSelected ? ' class="selected"' : '';
            html += '<tr' + cls + ' data-l2="' + Utils.escapeHtml(r.code) + '">';
            html += '<td>' + (idx + 1) + '</td>';
            html += '<td>' + Utils.escapeHtml(r.info.name || r.code) + '</td>';
            html += '<td>' + r.info.sample_size + '</td>';
            metrics.forEach(mk => {
                let val = null;
                if (mk === 'cr5') val = r.info.concentration_cr5;
                else if (mk === 'composite') val = r.sortVal;
                else val = r.meds[mk];
                if (val != null) {
                    html += '<td class="' + this.dimColor(val) + '">' + parseFloat(val.toFixed(1)) + '</td>';
                } else {
                    html += '<td class="perc-na">--</td>';
                }
            });
            html += '</tr>';
        });
        tbody.innerHTML = html;

        // Bind click to drill into L2
        var self = this;
        tbody.querySelectorAll('tr').forEach(function(tr) {
            tr.addEventListener('click', function() {
                var l2Code = tr.getAttribute('data-l2');
                if (l2Code) self.drillL2(l2Code);
            });
        });
    },

    // ========== L2 雷达图渲染 ==========
    _renderL2Radar(l2Codes) {
        var dom = document.getElementById('benchmark-l2-radar');
        if (!dom) return;
        this.radarChart = Utils.createChart(dom, this.radarChart);
        if (!this.radarChart) return;

        var tc = Utils.themeColors();
        // Radar metrics: key financial dimensions
        var metrics = ['roe', 'roa', 'revenue_cagr3', 'profit_cagr3', 'mscore', 'total_assets'];

        // Show max 5 industries on radar
        var displayCodes = l2Codes.slice(0, 5);
        var indicators = metrics.map(function(mk) {
            return { name: BenchmarkModule.metricLabels[mk] || mk, max: 100 };
        });

        var colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de'];
        var seriesData = displayCodes.map(function(code, idx) {
            var info = INDUSTRY_L2_BENCHMARK[code];
            var meds = info ? (info.medians || {}) : {};
            var data = metrics.map(function(mk) {
                var v = meds[mk];
                return v != null ? parseFloat(v.toFixed(1)) : 0;
            });
            return {
                type: 'radar',
                data: [{ value: data, name: info ? info.name : code }],
                lineStyle: { color: colors[idx % colors.length] },
                areaStyle: { color: colors[idx % colors.length], opacity: 0.08 },
                symbol: 'circle',
                symbolSize: 4
            };
        });

        this.radarChart.setOption({
            tooltip: { trigger: 'item' },
            legend: {
                data: displayCodes.map(function(c) {
                    var info = INDUSTRY_L2_BENCHMARK[c];
                    return info ? info.name : c;
                }),
                bottom: 0,
                textStyle: { color: tc.textBody, fontSize: 11 }
            },
            radar: {
                indicator: indicators,
                axisName: { color: tc.textSecondary, fontSize: 10 },
                splitArea: {
                    areaStyle: { color: [tc.radarArea1 || 'rgba(22,27,34,0.3)', tc.radarArea2 || 'rgba(10,14,20,0.5)'] }
                },
                splitLine: { lineStyle: { color: tc.splitLine || 'rgba(56,72,112,0.12)' } },
                axisLine: { lineStyle: { color: tc.axisLine || 'rgba(56,72,112,0.3)' } }
            },
            series: seriesData
        }, true);
    },

    // ========== 下钻到二级行业 ==========
    drillL2(l2Code) {
        this.selectedL2 = l2Code;
        var l2Info = INDUSTRY_L2_BENCHMARK[l2Code];
        if (l2Info && l2Info.ind1) {
            this.selectedL1 = l2Info.ind1;
        }
        this.updateBreadcrumb();
        this.renderHeatmap();
        this.renderL2Panel();
        this.renderCompanyRank();
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
