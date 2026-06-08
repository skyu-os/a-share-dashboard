/**
 * A股财务数据全景仪表盘 - 指挥中心 (Overview) 模块
 */

const OverviewModule = {
    trendChart: null,
    distChart: null,
    treemapChart: null,
    initialized: false,

    init() {
        console.log("初始化指挥中心模块...");
        if (!Utils.ensureEcharts()) return;
        this.renderKPIs();
        this.renderTrendChart();
        this.renderDistChart();
        this.renderTreemapChart();
        
        // 绑定全局 resize
        Utils.initChartResize([this.trendChart, this.distChart, this.treemapChart]);
        this.initialized = true;
    },

    // 1. 渲染顶部 KPI 指标
    renderKPIs() {
        // 总公司数
        const kpiComp = document.getElementById('kpi-companies');
        if (kpiComp) {
            kpiComp.innerText = Utils.formatNumber(SCREENING_SUMMARY.total_companies, 0);
        }

        // M得分
        const kpiMscore = document.getElementById('kpi-mscore');
        if (kpiMscore) {
            kpiMscore.innerText = Utils.formatNumber(SCREENING_SUMMARY.avg_mscore_latest, 3);
        }

        // 较高风险占比 (最新关注、中等、高风险数之和)
        const kpiHigh = document.getElementById('kpi-highrisk');
        const watch = SCREENING_SUMMARY.risk_levels["关注"] || 0;
        const medium = SCREENING_SUMMARY.risk_levels["中等风险"] || 0;
        const high = SCREENING_SUMMARY.risk_levels["高风险"] || 0;
        const extreme = SCREENING_SUMMARY.risk_levels["极高风险"] || 0;
        const totalHigh = watch + medium + high + extreme;
        if (kpiHigh) {
            kpiHigh.innerText = totalHigh;
        }
        
        // 重述率
        const kpiRestate = document.getElementById('kpi-restate');
        if (kpiRestate) {
            let total_samples = 0;
            let total_restate_samples = 0;
            INDUSTRY_SUMMARY.forEach(item => {
                total_samples += item.样本数 || 0;
                total_restate_samples += (item.样本数 || 0) * ((item.重述率 || 0) / 100);
            });
            const avgRestate = total_samples > 0 ? (total_restate_samples / total_samples) * 100 : 0;
            kpiRestate.innerText = avgRestate.toFixed(2) + '%';
        }
    },

    // 2. 渲染盈余质量年度演变趋势 (双轴)
    renderTrendChart() {
        const chartDom = document.getElementById('overview-trend-chart');
        if (!chartDom) return;
        
        this.trendChart = Utils.createChart(chartDom, this.trendChart);
        if (!this.trendChart) return;

        const years = ANNUAL_TRENDS.map(d => d.year);
        const mscores = ANNUAL_TRENDS.map(d => d.avg_mscore);
        const riskRatios = ANNUAL_TRENDS.map(d => d.high_risk_ratio * 100);

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['平均 M-Score', '高风险占比']
            },
            grid: {
                left: '4%',
                right: '4%',
                bottom: '6%',
                top: '10%',
                containLabel: true
            },
            xAxis: [
                {
                    type: 'category',
                    data: years,
                    axisPointer: { type: 'shadow' }
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    name: 'M-Score',
                    min: -3,
                    max: -1,
                    position: 'left',
                    axisLabel: {
                        formatter: '{value}'
                    }
                },
                {
                    type: 'value',
                    name: '高风险占比 (%)',
                    min: 0,
                    max: Math.max(1, Math.ceil(Math.max(...riskRatios) * 10) / 10),
                    position: 'right',
                    axisLabel: {
                        formatter: '{value}%'
                    }
                }
            ],
            series: [
                {
                    name: '平均 M-Score',
                    type: 'line',
                    data: mscores,
                    smooth: true,
                    showSymbol: true,
                    symbolSize: 6,
                    lineStyle: {
                        color: '#58a6ff',
                        width: 3
                    },
                    itemStyle: {
                        color: '#58a6ff'
                    }
                },
                {
                    name: '高风险占比',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: riskRatios,
                    itemStyle: {
                        color: 'rgba(248, 81, 73, 0.65)',
                        borderRadius: [3, 3, 0, 0]
                    },
                    barWidth: '40%'
                }
            ]
        };

        this.trendChart.setOption(option);
    },

    // 3. 最新风险等级分布环形图
    renderDistChart() {
        const chartDom = document.getElementById('overview-dist-chart');
        if (!chartDom) return;

        this.distChart = Utils.createChart(chartDom, this.distChart);
        if (!this.distChart) return;

        const levels = SCREENING_SUMMARY.risk_levels;
        const total = SCREENING_SUMMARY.latest_companies;

        const data = [
            { value: levels["低风险"] || 0, name: '低风险' },
            { value: levels["关注"] || 0, name: '关注' },
            { value: levels["中等风险"] || 0, name: '中等风险' },
            { value: levels["高风险"] || 0, name: '高风险' },
            { value: levels["极高风险"] || 0, name: '极高风险' }
        ].filter(d => d.value > 0);

        const option = {
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} 家 ({d}%)'
            },
            legend: {
                orient: 'horizontal',
                bottom: '0%',
                left: 'center',
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { fontSize: 10 }
            },
            series: [
                {
                    name: '风险等级',
                    type: 'pie',
                    radius: ['40%', '65%'],
                    center: ['50%', '44%'],
                    avoidLabelOverlap: false,
                    itemStyle: {
                        borderRadius: 4,
                        borderColor: '#121824',
                        borderWidth: 2
                    },
                    label: {
                        show: false,
                        position: 'center'
                    },
                    emphasis: {
                        label: {
                            show: true,
                            fontSize: 14,
                            fontWeight: 'bold',
                            formatter: '{b}\n{d}%'
                        }
                    },
                    labelLine: {
                        show: false
                    },
                    data: data,
                    color: ['#3fb950', '#d29922', '#db6d28', '#f85149', '#ea3939']
                }
            ],
            graphic: [
                {
                    type: 'text',
                    left: 'center',
                    top: '40%',
                    style: {
                        text: total + '\n样本企业',
                        textAlign: 'center',
                        fill: '#f0f3f6',
                        fontSize: 14,
                        fontWeight: 'bold'
                    }
                }
            ]
        };

        this.distChart.setOption(option);
    },

    // 4. 行业风险 Treemap
    renderTreemapChart() {
        const chartDom = document.getElementById('overview-treemap-chart');
        if (!chartDom) return;

        this.treemapChart = Utils.createChart(chartDom, this.treemapChart);
        if (!this.treemapChart) return;

        // 将 INDUSTRY_ANALYSIS 组装为 Treemap 数据
        const treeData = INDUSTRY_ANALYSIS.map(item => ({
            name: `${item.Indnme}\n(${item.Indcd})`,
            value: item.样本数,
            riskIndex: item.风险指数,
            indcd: item.Indcd
        })).filter(d => d.value > 0);

        const option = {
            tooltip: {
                formatter: function (info) {
                    const data = info.data || {};
                    return [
                        `<div style="font-size:14px; font-weight:bold; margin-bottom:4px;">${Utils.escapeHtml(String(data.name || '').split('\n')[0])}</div>`,
                        `行业代码: ${Utils.escapeHtml(data.indcd)}<br/>`,
                        `样本数: ${Utils.formatNumber(data.value, 0)} 家<br/>`,
                        `风险指数: <span style="color:#f85149;font-weight:bold;">${Utils.formatNumber(data.riskIndex, 2)}</span>`
                    ].join('');
                }
            },
            visualMap: {
                show: true,
                min: 0,
                max: 30,
                dimension: 'riskIndex',
                left: 'right',
                top: 'center',
                text: ['高风险', '低风险'],
                inRange: {
                    color: ['rgba(63,185,80,0.85)', 'rgba(210,153,34,0.85)', 'rgba(248,81,73,0.85)']
                },
                textStyle: { color: '#8b949e' }
            },
            series: [
                {
                    name: '行业大类分布',
                    type: 'treemap',
                    visibleMin: 20,
                    data: treeData,
                    leafDepth: 1,
                    label: {
                        show: true,
                        formatter: '{b}',
                        fontSize: 11
                    },
                    itemStyle: {
                        borderColor: '#0a0e14',
                        borderWidth: 1,
                        gapWidth: 1
                    },
                    breadcrumb: {
                        show: false
                    }
                }
            ]
        };

        this.treemapChart.setOption(option);

        // 点击钻入行业Tab
        this.treemapChart.on('click', (params) => {
            if (params.data && params.data.indcd) {
                const indcd = params.data.indcd;
                console.log(`点击行业: ${indcd}，跳转到行业透视...`);
                
                // 将选中的行业挂载到全局变量上，由 IndustryModule 获取
                window.selectedIndustryFromTreemap = indcd;
                
                // 路由切换
                window.location.hash = 'industry';
            }
        });
    }
};
