/**
 * A股财务数据全景仪表盘 - 因子分解 (Factor Anatomy) 模块
 */

const FactorModule = {
    distributionChart: null,
    corrChart: null,
    eventsBound: false,

    // 全局平均
    marketAverages: {
        'DSRI': 1.1874,
        'GMI': 1.0358,
        'AQI': 1.2150,
        'SGI': 1.1751,
        'DEPI': 1.0835,
        'SGAI': 1.0559,
        'LVGI': 1.0738,
        'TATA': -0.0176
    },

    init() {
        console.log("初始化因子分解模块...");
        if (!Utils.ensureEcharts()) return;
        this.renderDistribution();
        this.renderCorrelation();
        this.renderIndustryFactorTable();
        this.bindEvents();

        Utils.initChartResize([this.distributionChart, this.corrChart]);
    },

    // 1. 渲染因子分布直方图 (动态计算 2024 年全市场数据)
    renderDistribution() {
        const chartDom = document.getElementById('factor-distribution-chart');
        if (!chartDom) return;

        const select = document.getElementById('factor-dist-select');
        const factorKey = select ? select.value : 'DSRI';

        this.distributionChart = Utils.createChart(chartDom, this.distributionChart);
        if (!this.distributionChart) return;

        // 收集 2024 年全市场的对应因子值
        const values = [];
        const latestYear = SCREENING_SUMMARY.latest_year;

        // 因子位置索引对照表
        const factorIndexMap = {
            'DSRI': 2, 'GMI': 3, 'AQI': 4, 'SGI': 5,
            'DEPI': 6, 'SGAI': 7, 'LVGI': 8, 'TATA': 9
        };
        const valIdx = factorIndexMap[factorKey];

        for (const code in COMPANY_HISTORY) {
            const info = COMPANY_HISTORY[code];
            const latestRec = info.history.find(rec => rec[0] === latestYear);
            if (latestRec && latestRec[valIdx] !== null && latestRec[valIdx] !== undefined) {
                values.push(latestRec[valIdx]);
            }
        }

        if (values.length === 0) return;

        // 排序，提取 5% 和 95% 分位数，排除极端值干扰直方图形状
        values.sort((a, b) => a - b);
        const q05 = values[Math.floor(values.length * 0.02)];
        const q95 = values[Math.floor(values.length * 0.98)];

        // 创建 20 个区间 bin
        const binCount = 20;
        const step = (q95 - q05) / binCount || 1;
        const bins = Array.from({ length: binCount }, (_, i) => q05 + step * i);
        const counts = Array(binCount).fill(0);

        // 填充计数
        values.forEach(v => {
            if (v >= q05 && v <= q95) {
                const idx = Math.min(Math.floor((v - q05) / step), binCount - 1);
                counts[idx]++;
            }
        });

        const binLabels = bins.map((b, i) => {
            const nextBin = b + step;
            return `${b.toFixed(2)}-${nextBin.toFixed(2)}`;
        });

        const marketAverage = this.marketAverages[factorKey];
        const averageIndex = Math.max(0, Math.min(
            binCount - 1,
            Math.floor(((marketAverage ?? q05) - q05) / step)
        ));

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: '{b}<br/>企业数量: <strong>{c} 家</strong>'
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '6%',
                top: '5%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: binLabels,
                axisLabel: { rotate: 30, fontSize: 9 }
            },
            yAxis: {
                type: 'value',
                name: '企业数 (家)',
                splitLine: { lineStyle: { color: '#21262d' } }
            },
            series: [
                {
                    name: '企业数',
                    type: 'bar',
                    data: counts,
                    itemStyle: {
                        color: '#58a6ff',
                        borderRadius: [3, 3, 0, 0]
                    },
                    barWidth: '75%',
                    // 标记平均线
                    markLine: {
                        symbol: 'none',
                        label: {
                            formatter: `全市场平均: {c}`,
                            color: '#39d2c0'
                        },
                        lineStyle: {
                            color: '#39d2c0',
                            type: 'dashed',
                            width: 1.5
                        },
                        data: [{ xAxis: averageIndex, yAxis: 0 }]
                    }
                }
            ]
        };

        this.distributionChart.setOption(option);
    },

    // 2. 渲染 8x8 因子相关性矩阵
    renderCorrelation() {
        const chartDom = document.getElementById('factor-corr-chart');
        if (!chartDom) return;

        this.corrChart = Utils.createChart(chartDom, this.corrChart);
        if (!this.corrChart) return;

        const factorNames = ['DSRI', 'GMI', 'AQI', 'SGI', 'DEPI', 'SGAI', 'LVGI', 'TATA'];

        // 扁平化数据 [[x, y, value], ...]
        const heatmapData = [];
        FACTOR_CORRELATION.forEach((row, yIdx) => {
            row.forEach((val, xIdx) => {
                heatmapData.push([xIdx, yIdx, parseFloat(val.toFixed(3))]);
            });
        });

        const option = {
            tooltip: {
                position: 'top',
                formatter: function (params) {
                    const xName = factorNames[params.data[0]];
                    const yName = factorNames[params.data[1]];
                    const val = params.data[2];
                    return `
                        相关性: ${xName} × ${yName}<br/>
                        Pearson 系数: <strong style="color:${val >= 0 ? '#f85149' : '#58a6ff'};">${val > 0 ? '+' : ''}${val.toFixed(3)}</strong>
                    `;
                }
            },
            grid: {
                top: '4%',
                bottom: '8%',
                left: '12%',
                right: '4%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: factorNames
            },
            yAxis: {
                type: 'category',
                data: factorNames
            },
            visualMap: {
                min: -0.3,
                max: 0.3,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: '0%',
                text: ['正相关', '负相关'],
                inRange: {
                    // 发散色阶 (蓝 -> 黑 -> 红)
                    color: ['#58a6ff', '#161b22', '#f85149']
                },
                textStyle: { color: '#8b949e', fontSize: 10 }
            },
            series: [
                {
                    name: '因子相关性',
                    type: 'heatmap',
                    data: heatmapData,
                    label: {
                        show: true,
                        fontSize: 10,
                        formatter: function (params) {
                            return params.data[2].toFixed(2);
                        }
                    }
                }
            ]
        };

        this.corrChart.setOption(option);
    },

    // 3. 渲染因子行业偏离表
    renderIndustryFactorTable() {
        const tbody = document.querySelector('#factor-industry-rank-table tbody');
        if (!tbody) return;

        const select = document.getElementById('factor-rank-select');
        const factorKey = select ? select.value : 'DSRI';

        tbody.innerHTML = '';

        const marketAvg = this.marketAverages[factorKey];
        const dataList = [];

        // 提取各行业该因子的均值
        for (const indcd in INDUSTRY_FACTORS) {
            const info = INDUSTRY_FACTORS[indcd];
            const mean = info.means[factorKey];
            if (mean !== null && mean !== undefined) {
                // 计算相对偏离度
                let deviation = 0;
                if (factorKey === 'TATA') {
                    // TATA 为负值或很小，做绝对偏离差
                    deviation = mean - marketAvg;
                } else {
                    deviation = ((mean - marketAvg) / marketAvg) * 100;
                }

                dataList.push({
                    code: indcd,
                    name: info.name,
                    mean: mean,
                    deviation: deviation
                });
            }
        }

        // 按照均值降序排列
        dataList.sort((a, b) => b.mean - a.mean);

        dataList.forEach(row => {
            const tr = document.createElement('tr');
            
            // 判定等级
            let devLabel = '正常 🟢';
            if (factorKey === 'TATA') {
                if (row.deviation > 0.03) devLabel = '显著偏正 🔴';
                else if (row.deviation < -0.03) devLabel = '偏负 🟡';
            } else {
                if (row.deviation > 20) devLabel = '高正偏离 🔴';
                else if (row.deviation < -20) devLabel = '负向偏离 🟡';
            }

            const devText = factorKey === 'TATA' 
                ? (row.deviation > 0 ? '+' : '') + row.deviation.toFixed(4)
                : (row.deviation > 0 ? '+' : '') + row.deviation.toFixed(1) + '%';

            tr.innerHTML = `
                <td><span class="font-mono">${row.code}</span></td>
                <td><strong>${row.name}</strong></td>
                <td><span class="font-mono">${row.mean.toFixed(4)}</span></td>
                <td><span class="font-mono ${row.deviation > (factorKey === 'TATA' ? 0.03 : 20) ? 'text-red font-bold' : ''}">${devText}</span></td>
                <td><span>${devLabel}</span></td>
            `;
            tbody.appendChild(tr);
        });
    },

    // 4. 绑定选择变化事件
    bindEvents() {
        const distSel = document.getElementById('factor-dist-select');
        const rankSel = document.getElementById('factor-rank-select');
        if (this.eventsBound) return;
        this.eventsBound = true;

        if (distSel) {
            distSel.addEventListener('change', () => {
                this.renderDistribution();
            });
        }

        if (rankSel) {
            rankSel.addEventListener('change', () => {
                this.renderIndustryFactorTable();
            });
        }
    }
};
