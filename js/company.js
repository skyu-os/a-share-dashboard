/**
 * A股财务数据全景仪表盘 - 个股诊断 (Company Diagnosis) 模块
 */

const CompanyModule = {
    gaugeChart: null,
    trendChart: null,
    radarChart: null,
    searchEventsBound: false,

    initSearchPage() {
        console.log("初始化个股检索页面...");
        if (!Utils.ensureEcharts()) return;
        this.bindSearchPageEvents();
    },

    // 绑定搜索落地页事件
    bindSearchPageEvents() {
        if (this.searchEventsBound) return;
        this.searchEventsBound = true;
        const chips = document.querySelectorAll('.popular-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const code = chip.getAttribute('data-code');
                this.openDrawer(code);
            });
        });
    },

    // 1. 打开抽屉并渲染个股详情 (核心功能，全局钩子调用此函数)
    openDrawer(stkcd) {
        console.log(`查询企业代码: ${stkcd}`);
        const cleanCode = String(stkcd).trim().padStart(6, '0');
        const company = COMPANY_HISTORY[cleanCode];
        if (!company) {
            Utils.showAlert(`未找到代码为 ${cleanCode} 的企业数据`);
            return;
        }
        Utils.clearAlert();

        // 获取 DOM
        const drawer = document.getElementById('drawer');
        const overlay = document.getElementById('drawer-overlay');
        
        const nameEl = document.getElementById('drawer-company-name');
        const codeEl = document.getElementById('drawer-company-code');
        const indEl = document.getElementById('drawer-company-ind');
        const riskEl = document.getElementById('drawer-company-risk');

        if (!drawer || !overlay) return;

        // 设置文本
        nameEl.innerText = company.name;
        codeEl.innerText = cleanCode;
        indEl.innerText = `${company.indnme} (${company.indcd})`;

        // 取最新一年记录的风险等级
        const history = company.history;
        if (!history || history.length === 0) {
            Utils.showAlert(`${company.name} 暂无可展示的历史财务数据`);
            return;
        }
        const latestRec = history[history.length - 1];
        const latestLevel = latestRec[11];
        
        riskEl.innerText = latestLevel;
        riskEl.className = 'badge ' + Utils.getRiskLevelClass(latestLevel);

        // 滑出抽屉
        drawer.classList.add('active');
        overlay.classList.add('active');

        // 异步渲染三个图表及财务表格，避免 UI 阻塞卡顿
        setTimeout(() => {
            this.renderGaugeChart(latestRec[10]);
            this.renderTrendChart(history);
            this.renderRadarChart(latestRec, company.indcd);
            this.renderFinanceTable(history);
            Utils.initChartResize([this.gaugeChart, this.trendChart, this.radarChart]);
            Utils.resizeChart(this.gaugeChart);
            Utils.resizeChart(this.trendChart);
            Utils.resizeChart(this.radarChart);
        }, 100);
    },

    // 2. 渲染风险安全仪表盘 (Gauge)
    renderGaugeChart(riskScore) {
        const chartDom = document.getElementById('drawer-gauge-chart');
        if (!chartDom) return;

        this.gaugeChart = Utils.createChart(chartDom, this.gaugeChart);
        if (!this.gaugeChart) return;

        const score = riskScore !== null && riskScore !== undefined && !isNaN(riskScore)
            ? parseFloat(Number(riskScore).toFixed(1))
            : 0;

        const option = {
            series: [
                {
                    type: 'gauge',
                    center: ['50%', '55%'],
                    radius: '90%',
                    startAngle: 180,
                    endAngle: 0,
                    min: 0,
                    max: 100,
                    splitNumber: 5,
                    axisLine: {
                        lineStyle: {
                            width: 8,
                            color: [
                                [0.15, '#3fb950'], // 低风险
                                [0.30, '#d29922'], // 关注
                                [0.50, '#db6d28'], // 中等风险
                                [1.0, '#f85149']   // 高/极高风险
                            ]
                        }
                    },
                    pointer: {
                        icon: 'path://M12.8,0.7l12,8c0.4,0.3,0.4,0.9,0.1,1.3c-0.3,0.4-0.9,0.4-1.3,0.1l-12-8C9.2,3.8,9.2,3.2,9.5,2.8C9.8,2.4,10.4,2.4,10.8,2.7L12.8,0.7z',
                        length: '65%',
                        width: 4,
                        offsetCenter: [0, -4],
                        itemStyle: { color: '#e6edf3' }
                    },
                    axisTick: { length: 3, lineStyle: { color: 'auto', width: 1 } },
                    splitLine: { length: 8, lineStyle: { color: 'auto', width: 2 } },
                    axisLabel: {
                        color: '#8b949e',
                        fontSize: 10,
                        distance: -35,
                        formatter: function (value) {
                            if (value === 0) return '安全';
                            if (value === 30) return '关注';
                            if (value === 50) return '中等';
                            if (value === 100) return '极高';
                            return '';
                        }
                    },
                    title: { show: false },
                    detail: {
                        valueAnimation: true,
                        formatter: '{value}',
                        color: '#f0f3f6',
                        fontSize: 18,
                        fontWeight: 'bold',
                        offsetCenter: [0, '15%']
                    },
                    data: [{ value: score, name: '风险指数' }]
                }
            ]
        };

        this.gaugeChart.setOption(option);
    },

    // 3. 渲染历史 M-Score & 综合风险评分趋势 (双轴)
    renderTrendChart(history) {
        const chartDom = document.getElementById('drawer-trend-chart');
        if (!chartDom) return;

        this.trendChart = Utils.createChart(chartDom, this.trendChart);
        if (!this.trendChart) return;

        const tc = Utils.themeColors();

        const years = history.map(rec => rec[0]);
        const mscores = history.map(rec => rec[1]);
        const scores = history.map(rec => rec[10]);

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['M-Score', '风险评分'],
                top: 0
            },
            grid: {
                left: '3%',
                right: '3%',
                bottom: '5%',
                top: '18%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: years
            },
            yAxis: [
                {
                    type: 'value',
                    name: 'M-Score',
                    position: 'left',
                    splitLine: { show: false },
                    // M-Score 阈值参考线
                    markLine: {
                        symbol: 'none',
                        label: {
                            position: 'end',
                            formatter: '阈值 -1.78',
                            fontSize: 9,
                            color: '#f85149'
                        },
                        lineStyle: {
                            color: 'rgba(248, 81, 73, 0.4)',
                            type: 'dashed'
                        },
                        data: [{ yAxis: -1.78 }]
                    }
                },
                {
                    type: 'value',
                    name: '风险评分',
                    min: 0,
                    max: 100,
                    position: 'right',
                    splitLine: { lineStyle: { color: tc.splitLineAlt } }
                }
            ],
            series: [
                {
                    name: 'M-Score',
                    type: 'line',
                    data: mscores,
                    smooth: true,
                    symbolSize: 6,
                    itemStyle: { color: '#39d2c0' },
                    lineStyle: { width: 2.5 }
                },
                {
                    name: '风险评分',
                    type: 'line',
                    yAxisIndex: 1,
                    data: scores,
                    smooth: true,
                    symbolSize: 6,
                    itemStyle: { color: '#bc8cff' },
                    lineStyle: { width: 2.5 }
                }
            ]
        };

        this.trendChart.setOption(option);
    },

    // 4. 渲染个股因子雷达 (对标行业均值)
    renderRadarChart(latestRec, indcd) {
        const chartDom = document.getElementById('drawer-radar-chart');
        if (!chartDom) return;

        this.radarChart = Utils.createChart(chartDom, this.radarChart);
        if (!this.radarChart) return;

        const tc = Utils.themeColors();
        const indMeans = INDUSTRY_FACTORS[indcd] ? INDUSTRY_FACTORS[indcd].means : null;

        const indicators = [
            { name: 'DSRI (应收)', max: 2.0, min: 0.0 },
            { name: 'GMI (毛利)', max: 2.0, min: 0.0 },
            { name: 'AQI (资产)', max: 2.0, min: 0.0 },
            { name: 'SGI (营业)', max: 2.0, min: 0.0 },
            { name: 'DEPI (折旧)', max: 2.0, min: 0.0 },
            { name: 'SGAI (费用)', max: 2.0, min: 0.0 },
            { name: 'LVGI (杠杆)', max: 2.0, min: 0.0 },
            { name: 'TATA (应计)', max: 0.2, min: -0.2 }
        ];

        // 个股最新因子值
        const compData = [
            latestRec[2], latestRec[3], latestRec[4], latestRec[5],
            latestRec[6], latestRec[7], latestRec[8], latestRec[9]
        ];

        const seriesData = [
            {
                name: '企业最新因子',
                value: compData,
                itemStyle: { color: '#58a6ff' },
                areaStyle: { color: 'rgba(88, 166, 255, 0.15)' }
            }
        ];

        // 行业均值线 (如果有)
        if (indMeans) {
            const indData = [
                indMeans.DSRI, indMeans.GMI, indMeans.AQI, indMeans.SGI,
                indMeans.DEPI, indMeans.SGAI, indMeans.LVGI, indMeans.TATA
            ];
            seriesData.push({
                name: '所属行业均值',
                value: indData,
                lineStyle: { type: 'dotted', width: 1.5 },
                symbol: 'none',
                itemStyle: { color: '#bc8cff' }
            });
        }

        const option = {
            tooltip: {
                trigger: 'item',
                backgroundColor: tc.tooltipBg,
                borderColor: tc.tooltipBorder,
                textStyle: { color: tc.textLight }
            },
            legend: {
                bottom: 0,
                left: 'center',
                textStyle: { color: tc.textSecondary, fontSize: 10 }
            },
            radar: {
                indicator: indicators,
                radius: '62%',
                center: ['50%', '46%'],
                shape: 'polygon',
                splitNumber: 4,
                axisName: {
                    color: tc.textSecondary,
                    fontSize: 9
                },
                splitLine: {
                    lineStyle: { color: tc.radarLine }
                },
                splitArea: {
                    show: true,
                    areaStyle: {
                        color: [tc.radarArea1, tc.radarArea2]
                    }
                }
            },
            series: [
                {
                    type: 'radar',
                    data: seriesData
                }
            ]
        };

        this.radarChart.setOption(option);
    },

    // 5. 渲染财务明细表
    renderFinanceTable(history) {
        const tbody = document.querySelector('#drawer-finance-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        // 按年份降序排
        const reverseHistory = [...history].reverse();

        reverseHistory.forEach(rec => {
            const tr = document.createElement('tr');
            
            const year = rec[0];
            const mscore = rec[1];
            const score = rec[10];
            const level = rec[11];
            const rev = rec[12];
            const np = rec[13];
            const ta = rec[14];

            const badgeClass = Utils.getRiskLevelClass(level);

            tr.innerHTML = `
                <td><span class="font-mono">${year}</span></td>
                <td><span class="font-mono">${rev !== null ? rev.toFixed(2) : '--'}</span></td>
                <td><span class="font-mono ${np !== null && np < 0 ? 'text-red' : ''}">${np !== null ? np.toFixed(2) : '--'}</span></td>
                <td><span class="font-mono">${ta !== null ? ta.toFixed(2) : '--'}</span></td>
                <td><span class="font-mono ${mscore > -1.78 ? 'text-red' : ''}">${mscore !== null ? mscore.toFixed(3) : '--'}</span></td>
                <td><span class="font-mono">${score !== null ? score.toFixed(1) : '--'}</span></td>
                <td><span class="badge ${badgeClass}" style="padding: 1px 4px; font-size:9px;">${level}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }
};
