/**
 * A股财务数据全景仪表盘 - 危机穿越 (Crisis Survivors) 模块
 */

const CrisisModule = {
    resilienceChart: null,
    comparisonChart: null,
    scatterChart: null,

    init() {
        console.log("初始化危机穿越模块...");
        if (!Utils.ensureEcharts()) return;
        this.renderResilienceChart();
        this.renderComparisonChart();
        this.renderScatterChart();
        this.renderSurvivorWall();

        Utils.initChartResize([this.resilienceChart, this.comparisonChart, this.scatterChart]);
    },

    // 1. 行业危机穿越综合韧性排名
    renderResilienceChart() {
        const chartDom = document.getElementById('crisis-resilience-chart');
        if (!chartDom) return;

        this.resilienceChart = Utils.createChart(chartDom, this.resilienceChart);
        if (!this.resilienceChart) return;

        // 按得分升序排，以便在水平条形图中高得分在顶部
        const sortedData = [...CRISIS_RESILIENCE_RANKING].sort((a, b) => a.total_score - b.total_score);

        const sectorNames = sortedData.map(d => SECTOR_NAME_MAP[d.sector_code] || d.sector_name);
        const scores = sortedData.map(d => d.total_score);
        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function(params) {
                    const idx = params[0].dataIndex;
                    const item = sortedData[idx];
                    return `
                        <strong>${Utils.escapeHtml(SECTOR_NAME_MAP[item.sector_code] || item.sector_name || item.sector_code)} (${Utils.escapeHtml(item.sector_code)})</strong><br/>
                        综合韧性得分: <span style="color:#39d2c0;font-weight:bold;">${item.total_score}</span><br/>
                        穿越危机次数: ${item.cross_crisis_count}/4 次<br/>
                        逆势企业占比: ${(item.avg_resistance_ratio_pct).toFixed(1)}%<br/>
                        平均修复年数: ${item.avg_recovery_years.toFixed(1)} 年<br/>
                        平均营收变动: ${item.avg_revenue_growth_pct.toFixed(1)}%
                    `;
                }
            },
            grid: {
                left: '3%',
                right: '8%',
                bottom: '3%',
                top: '5%',
                containLabel: true
            },
            xAxis: {
                type: 'value',
                name: '韧性得分',
                max: 100
            },
            yAxis: {
                type: 'category',
                data: sectorNames,
                axisLabel: { interval: 0, fontSize: 10 }
            },
            series: [
                {
                    name: '综合韧性得分',
                    type: 'bar',
                    data: scores,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                            { offset: 0, color: '#58a6ff' },
                            { offset: 1, color: '#39d2c0' }
                        ]),
                        borderRadius: [0, 4, 4, 0]
                    },
                    barWidth: '60%'
                }
            ]
        };

        this.resilienceChart.setOption(option);
    },

    // 2. 历次危机板块表现对比 (分组柱状图)
    renderComparisonChart() {
        const chartDom = document.getElementById('crisis-comparison-chart');
        if (!chartDom) return;

        this.comparisonChart = Utils.createChart(chartDom, this.comparisonChart);
        if (!this.comparisonChart) return;

        // 获取全部 19 个行业代码
        const sectors = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'];
        const sectorNames = sectors.map(code => SECTOR_NAME_MAP[code] || code);

        const crises = ['2008金融危机', '2015股灾', '2018去杠杆', '2020疫情'];
        const series = [];

        // 颜色调色板
        const colors = ['#58a6ff', '#bc8cff', '#39d2c0', '#f0883e'];

        crises.forEach((crisisName, cIdx) => {
            const data = [];
            sectors.forEach(secCode => {
                // 在 CRISIS_SECTOR_ANALYSIS 中寻找匹配项
                const match = CRISIS_SECTOR_ANALYSIS.find(d => d.crisis === crisisName && d.sector_code === secCode);
                // 营收增长百分比
                data.push(match ? match.revenue_growth_pct : 0);
            });

            series.push({
                name: crisisName,
                type: 'bar',
                data: data,
                barGap: '10%',
                barCategoryGap: '30%',
                itemStyle: {
                    color: colors[cIdx],
                    borderRadius: [2, 2, 0, 0]
                }
            });
        });

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    let html = `<strong>${params[0].name}</strong><br/>`;
                    params.forEach(p => {
                        html += `${p.marker} ${p.seriesName}: <span style="font-weight:bold; color:${p.color}">${p.value > 0 ? '+' : ''}${p.value.toFixed(1)}%</span><br/>`;
                    });
                    return html;
                }
            },
            legend: {
                data: crises,
                top: 0
            },
            grid: {
                left: '3%',
                right: '3%',
                bottom: '10%',
                top: '12%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: sectorNames,
                axisLabel: { interval: 0, rotate: 35, fontSize: 10 }
            },
            yAxis: {
                type: 'value',
                name: '营收增长率 (%)',
                axisLabel: { formatter: '{value}%' }
            },
            series: series
        };

        this.comparisonChart.setOption(option);
    },

    // 3. 散点分布图 (1060家危机穿越公司)
    renderScatterChart() {
        const chartDom = document.getElementById('crisis-scatter-chart');
        if (!chartDom) return;

        this.scatterChart = Utils.createChart(chartDom, this.scatterChart);
        if (!this.scatterChart) return;

        // 数据按照行业门类进行分组，方便在图例中分类和不同颜色显示
        const sectors = [...new Set(CRISIS_COMPANIES.map(d => d.sector))].sort();
        const series = [];

        sectors.forEach(secCode => {
            const secData = CRISIS_COMPANIES.filter(d => d.sector === secCode).map(item => {
                // x: 营收增长 (百分比，clip在[-100, 200]内)
                const rawGrowth = Math.abs(item.avg_rev_growth || 0) <= 1 ? (item.avg_rev_growth || 0) * 100 : (item.avg_rev_growth || 0);
                const xVal = Math.min(Math.max(rawGrowth, -100), 200);
                // y: 最新ROE (百分比，clip在[-50, 100]内)
                const yVal = Math.min(Math.max((item.roe_2024 || 0) * 100, -50), 100);
                
                return [
                    xVal,
                    yVal,
                    item.ShortName,
                    item.Stkcd,
                    SECTOR_NAME_MAP[item.sector] || item.sector,
                    item.resist_count,
                    item.leverage_2024 ? item.leverage_2024 * 100 : 0
                ];
            });

            series.push({
                name: SECTOR_NAME_MAP[secCode] || secCode,
                type: 'scatter',
                data: secData,
                symbolSize: function (data) {
                    // 气泡大小映射到穿越次数: 4次穿越大，3次穿越小
                    return data[5] === 4 ? 14 : 7;
                },
                emphasis: {
                    focus: 'series',
                    label: {
                        show: true,
                        formatter: function (param) {
                            return param.data[2]; // 悬浮高亮显示简称
                        },
                        position: 'top',
                        color: '#f0f3f6',
                        fontSize: 10,
                        backgroundColor: 'rgba(10, 14, 20, 0.8)',
                        padding: [2, 4],
                        borderRadius: 2
                    }
                },
                itemStyle: {
                    opacity: 0.7,
                    shadowBlur: 5,
                    shadowColor: 'rgba(0, 0, 0, 0.3)'
                }
            });
        });

        const option = {
            grid: {
                left: '3%',
                right: '18%',
                bottom: '10%',
                top: '8%',
                containLabel: true
            },
            tooltip: {
                backgroundColor: '#161b22',
                borderColor: '#30363d',
                borderWidth: 1,
                formatter: function (obj) {
                    const data = obj.data;
                    return `
                        <div style="font-size:14px; font-weight:bold; margin-bottom:4px;">${data[2]} (${data[3]})</div>
                        板块: ${data[4]}<br/>
                        穿越危机次数: <strong style="color:#39d2c0">${data[5]}/4 次</strong><br/>
                        平均营收增长: ${data[0].toFixed(1)}%<br/>
                        最新 ROE: ${data[1].toFixed(1)}%<br/>
                        最新负债率: ${data[6].toFixed(1)}%
                    `;
                }
            },
            legend: {
                orient: 'vertical',
                right: '1%',
                top: 'center',
                textStyle: { color: '#8b949e', fontSize: 10 },
                pageIconColor: '#58a6ff',
                pageTextStyle: { color: '#8b949e' }
            },
            xAxis: {
                name: '平均营收增长率 (%)',
                type: 'value',
                splitLine: { show: true },
                axisLabel: { formatter: '{value}%' }
            },
            yAxis: {
                name: '最新 ROE (%)',
                type: 'value',
                splitLine: { show: true },
                axisLabel: { formatter: '{value}%' }
            },
            dataZoom: [
                { type: 'inside', zoomOnMouseWheel: true },
                { type: 'slider', bottom: '2%', left: '5%', right: '22%' }
            ],
            series: series
        };

        this.scatterChart.setOption(option);

        // 点击散点打开个股诊断抽屉
        this.scatterChart.on('click', (params) => {
            if (params.data && params.data[3]) {
                const stkcd = String(params.data[3]).padStart(6, '0');
                window.showCompanyDetail(stkcd);
            }
        });
    },

    // 4. 渲染 58 家危机穿越者精英卡片墙
    renderSurvivorWall() {
        const wall = document.getElementById('crisis-survivor-wall');
        if (!wall) return;

        wall.innerHTML = '';

        CRISIS_SURVIVORS.forEach(item => {
            const card = document.createElement('div');
            card.className = 'survivor-card';
            
            // 点击卡片查看公司详情
            card.addEventListener('click', () => {
                window.showCompanyDetail(item.Stkcd);
            });

            // 星星评级
            const starText = '⭐'.repeat(Math.round(item.穿越次数));

            card.innerHTML = `
                <div class="survivor-card-header">
                    <div>
                        <div class="survivor-name">${item.ShortName}</div>
                        <div class="survivor-code">${item.Stkcd}</div>
                    </div>
                    <span class="badge badge-low">低风险</span>
                </div>
                <div class="survivor-stats">
                    <div class="survivor-stat-row">
                        <span>穿越危机:</span>
                        <span style="color:var(--risk-watch); font-weight:bold;">${item.穿越次数}次 ${starText}</span>
                    </div>
                    <div class="survivor-stat-row">
                        <span>均营收增长:</span>
                        <span class="survivor-stat-val text-green">${item.平均营收增长率_危机期}</span>
                    </div>
                    <div class="survivor-stat-row">
                        <span>均净利增长:</span>
                        <span class="survivor-stat-val text-green">${item.平均净利润增长率_危机期}</span>
                    </div>
                    <div class="survivor-stat-row">
                        <span>最新 ROE:</span>
                        <span class="survivor-stat-val">${(item.最新ROE * 100).toFixed(1)}%</span>
                    </div>
                    <div class="survivor-stat-row">
                        <span>负债比率:</span>
                        <span class="survivor-stat-val">${(item.最新资产负债率 * 100).toFixed(1)}%</span>
                    </div>
                </div>
            `;
            wall.appendChild(card);
        });
    }
};
