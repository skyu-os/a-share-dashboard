/**
 * A股财务数据全警仪表盘 - 风险预警 (Risk Radar) 模块
 */

const RiskModule = {
    heatmapChart: null,

    init() {
        console.log("初始化风险预警模块...");
        if (!Utils.ensureEcharts()) return;
        this.renderHeatmap();
        this.renderMonitorTable();
        this.renderFlagTable();

        Utils.initChartResize([this.heatmapChart]);
    },

    // 1. 渲染财务风险演变热力图 (动态从 COMPANY_HISTORY 计算)
    renderHeatmap() {
        const chartDom = document.getElementById('risk-heatmap-chart');
        if (!chartDom) return;

        this.heatmapChart = Utils.createChart(chartDom, this.heatmapChart);
        if (!this.heatmapChart) return;

        const sectors = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'];
        const sectorNames = sectors.map(code => SECTOR_NAME_MAP[code] || code);
        const years = Array.from({length: 15}, (_, i) => 2010 + i); // 2010 to 2024

        // 建立格点哈希
        const matrix = {};
        sectors.forEach(s => {
            matrix[s] = {};
            years.forEach(y => {
                matrix[s][y] = { sum: 0, count: 0 };
            });
        });

        // 扫描全样本计算均值
        for (const code in COMPANY_HISTORY) {
            const info = COMPANY_HISTORY[code];
            // 取行业门类代码 (大类，首字母)
            const sec = info.indcd ? info.indcd.charAt(0).toUpperCase() : '';
            if (!matrix[sec]) continue;

            info.history.forEach(rec => {
                const year = rec[0];
                const score = rec[10]; // 综合风险评分
                if (year >= 2010 && year <= 2024 && score !== null && score !== undefined) {
                    matrix[sec][year].sum += score;
                    matrix[sec][year].count += 1;
                }
            });
        }

        // 拼装 ECharts 热力图数据格式 [[x_idx, y_idx, value], ...]
        const heatmapData = [];
        years.forEach((y, xIdx) => {
            sectors.forEach((s, yIdx) => {
                const cell = matrix[s][y];
                const avgScore = cell.count > 0 ? cell.sum / cell.count : 0;
                heatmapData.push([xIdx, yIdx, parseFloat(avgScore.toFixed(2))]);
            });
        });

        const option = {
            tooltip: {
                position: 'top',
                formatter: function (params) {
                    const xName = years[params.data[0]];
                    const yName = sectorNames[params.data[1]];
                    const score = params.data[2];
                    return `
                        <strong>${xName}年 - ${yName}</strong><br/>
                        行业平均风险指数: <span style="color:#f85149;font-weight:bold;">${score}</span><br/>
                        (数值越高，财务虚假/重述风险越大)
                    `;
                }
            },
            grid: {
                top: '3%',
                bottom: '6%',
                left: '8%',
                right: '4%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: years,
                splitArea: { show: true },
                axisLabel: { interval: 0 }
            },
            yAxis: {
                type: 'category',
                data: sectorNames,
                splitArea: { show: true },
                axisLabel: { interval: 0, fontSize: 10 }
            },
            visualMap: {
                min: 5,
                max: 20,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: '0%',
                text: ['高风险', '低风险'],
                inRange: {
                    color: ['#3fb950', '#d29922', '#db6d28', '#f85149']
                },
                textStyle: { color: '#8b949e', fontSize: 10 }
            },
            series: [
                {
                    name: '财务风险指数',
                    type: 'heatmap',
                    data: heatmapData,
                    label: {
                        show: false
                    },
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowColor: 'rgba(0, 0, 0, 0.5)'
                        }
                    }
                }
            ]
        };

        this.heatmapChart.setOption(option);
    },

    // 2. 渲染最新年度高风险监控名单
    renderMonitorTable() {
        const tbody = document.querySelector('#risk-monitor-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        const monitorList = [];
        const latestYear = SCREENING_SUMMARY.latest_year;

        for (const code in COMPANY_HISTORY) {
            const info = COMPANY_HISTORY[code];
            // 找 2024 年的记录
            const latestRec = info.history.find(rec => rec[0] === latestYear);
            if (!latestRec) continue;

            const mscore = latestRec[1];
            const score = latestRec[10]; // 综合风险评分
            const level = latestRec[11];  // 风险等级

            // 过滤出高风险、中等风险、关注的公司
            if (level === '高风险' || level === '中等风险' || level === '关注') {
                monitorList.push({
                    code: code,
                    name: info.name,
                    year: latestYear,
                    indnme: info.indnme,
                    mscore: mscore,
                    score: score,
                    level: level
                });
            }
        }

        // 按评分降序
        monitorList.sort((a, b) => (b.score || 0) - (a.score || 0));

        // 渲染前 30 家即可 (避免表格太长)
        const displayList = monitorList.slice(0, 30);

        displayList.forEach(row => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.showCompanyDetail(String(row.code).padStart(6, '0'));
            });

            const badgeClass = Utils.getRiskLevelClass(row.level);

            tr.innerHTML = `
                <td><span class="font-mono text-blue">${row.code}</span></td>
                <td><strong>${row.name}</strong></td>
                <td><span class="font-mono">${row.year}</span></td>
                <td><span style="font-size:12px; color:var(--text-secondary);">${row.indnme}</span></td>
                <td><span class="font-mono ${row.mscore > -1.78 ? 'text-red font-bold' : ''}">${row.mscore !== null ? row.mscore.toFixed(3) : '--'}</span></td>
                <td><span class="font-mono font-bold">${row.score !== null ? row.score.toFixed(1) : '--'}</span></td>
                <td><span class="badge ${badgeClass}">${row.level}</span></td>
            `;
            tbody.appendChild(tr);
        });

        if (displayList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">暂无高风险警示企业</td></tr>`;
        }
    },

    // 3. 渲染商誉红旗异象异常表
    renderFlagTable() {
        const tbody = document.querySelector('#risk-flag-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        // 取前 20 条渲染
        const displayList = GOODWILL_ANOMALIES.slice(0, 20);

        displayList.forEach(row => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.showCompanyDetail(String(row.stkcd).padStart(6, '0'));
            });

            tr.innerHTML = `
                <td><span class="font-mono text-blue">${row.stkcd}</span></td>
                <td><strong>${row.name}</strong></td>
                <td><span class="font-mono text-red font-bold">${(row.goodwill_ratio * 100).toFixed(2)}%</span></td>
                <td><span class="font-mono">${(row.other_receivables_ratio * 100).toFixed(2)}%</span></td>
            `;
            tbody.appendChild(tr);
        });

        if (displayList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">暂无商誉异常数据</td></tr>`;
        }
    }
};
