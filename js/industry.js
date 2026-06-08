/**
 * A股财务数据全景仪表盘 - 行业透视 (Industry Intel) 模块
 */

const IndustryModule = {
    radarChart: null,
    selectedIndcd: 'K70', // 默认房地产业
    eventsBound: false,
    
    // 全局市场平均因子值 (基于前面预计算的数据)
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
        console.log("初始化行业透视模块...");
        if (!Utils.ensureEcharts()) return;
        this.populateDropdowns();
        
        // 检查是否有来自 Treemap 的跳转
        if (window.selectedIndustryFromTreemap) {
            this.selectedIndcd = window.selectedIndustryFromTreemap;
            window.selectedIndustryFromTreemap = null; // 清除标志
        }

        this.renderRankTable();
        
        // 选中对应的行业并渲染雷达图
        this.renderRadar();
        
        // 绑定对比按钮和重置按钮
        this.bindEvents();

        Utils.initChartResize([this.radarChart]);
    },

    // 1. 填充行业选择下拉框
    populateDropdowns() {
        const select1 = document.getElementById('industry-select-1');
        const select2 = document.getElementById('industry-select-2');
        if (!select1 || !select2) return;

        // 清空只保留默认
        select1.innerHTML = '<option value="">-- 选择对比行业A --</option>';
        select2.innerHTML = '<option value="">-- 选择对比行业B --</option>';

        // 获取排序后的行业列表 (按首字母或样本数排序)
        const industries = Object.keys(INDUSTRY_FACTORS).map(code => ({
            code: code,
            name: INDUSTRY_FACTORS[code].name
        })).sort((a, b) => a.code.localeCompare(b.code));

        industries.forEach(ind => {
            const opt1 = document.createElement('option');
            opt1.value = ind.code;
            opt1.innerText = `${ind.name} (${ind.code})`;
            select1.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = ind.code;
            opt2.innerText = `${ind.name} (${ind.code})`;
            select2.appendChild(opt2);
        });
    },

    // 2. 渲染行业风险指标排名表
    renderRankTable() {
        const tbody = document.querySelector('#industry-rank-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';
        
        // 按风险指数降序排列 (风险从高到低)
        const sortedData = [...INDUSTRY_ANALYSIS].sort((a, b) => b.风险指数 - a.风险指数);

        sortedData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            if (row.Indcd === this.selectedIndcd) {
                tr.style.backgroundColor = 'rgba(88, 166, 255, 0.08)';
            }

            // 绑定点击事件，点击行刷新雷达图
            tr.addEventListener('click', () => {
                // 清理之前的选中行样式
                tbody.querySelectorAll('tr').forEach(r => r.style.backgroundColor = '');
                tr.style.backgroundColor = 'rgba(88, 166, 255, 0.08)';
                
                this.selectedIndcd = row.Indcd;
                this.renderRadar();
            });

            tr.innerHTML = `
                <td><span class="font-mono">${index + 1}</span></td>
                <td><strong>${row.Indnme}</strong> <span class="text-muted font-mono" style="font-size:11px;">(${row.Indcd})</span></td>
                <td><span class="font-mono">${row.样本数}</span></td>
                <td><span class="font-mono ${row.M_Score均值 > -1.78 ? 'text-red' : 'trend-down'}">${row.M_Score均值.toFixed(3)}</span></td>
                <td><span class="font-mono">${row.重述率.toFixed(1)}%</span></td>
                <td><span class="font-mono font-bold" style="color: ${row.风险指数 > 15 ? 'var(--risk-high)' : row.风险指数 > 10 ? 'var(--risk-watch)' : 'var(--risk-low)'}">${row.风险指数.toFixed(2)}</span></td>
                <td>
                    <button class="btn industry-view-btn" style="padding: 2px 8px; font-size:11px;" data-indcd="${Utils.escapeHtml(row.Indcd)}">查看</button>
                </td>
            `;
            const viewBtn = tr.querySelector('.industry-view-btn');
            if (viewBtn) {
                viewBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.selectIndustryDropdown(row.Indcd);
                    tbody.querySelectorAll('tr').forEach(r => r.style.backgroundColor = '');
                    tr.style.backgroundColor = 'rgba(88, 166, 255, 0.08)';
                });
            }
            tbody.appendChild(tr);
        });
    },

    // 外部调用：点击行内“查看”自动选择行业A
    selectIndustryDropdown(code) {
        this.selectedIndcd = code;
        this.renderRadar();
        
        const select1 = document.getElementById('industry-select-1');
        if (select1) {
            select1.value = code;
        }
    },

    // 3. 渲染雷达图 (支持单行业对标、或双行业PK对标)
    renderRadar() {
        const chartDom = document.getElementById('industry-radar-chart');
        if (!chartDom) return;

        this.radarChart = Utils.createChart(chartDom, this.radarChart);
        if (!this.radarChart) return;

        // 获取对比框的行业
        const select1 = document.getElementById('industry-select-1');
        const select2 = document.getElementById('industry-select-2');
        
        const codeA = select1 ? select1.value : '';
        const codeB = select2 ? select2.value : '';

        const subtitle = document.getElementById('industry-radar-subtitle');

        const indicators = [
            { name: 'DSRI (应收占比)', max: 2.0, min: 0.0 },
            { name: 'GMI (毛利指数)', max: 2.0, min: 0.0 },
            { name: 'AQI (资产质量)', max: 2.0, min: 0.0 },
            { name: 'SGI (营收增长)', max: 2.0, min: 0.0 },
            { name: 'DEPI (折旧指数)', max: 2.0, min: 0.0 },
            { name: 'SGAI (销管费用)', max: 2.0, min: 0.0 },
            { name: 'LVGI (杠杆指数)', max: 2.0, min: 0.0 },
            { name: 'TATA (应计占比)', max: 0.2, min: -0.2 }
        ];

        // 基础市场均值线数据
        const marketData = [
            this.marketAverages.DSRI,
            this.marketAverages.GMI,
            this.marketAverages.AQI,
            this.marketAverages.SGI,
            this.marketAverages.DEPI,
            this.marketAverages.SGAI,
            this.marketAverages.LVGI,
            this.marketAverages.TATA
        ];

        const seriesData = [
            {
                name: '全市场平均值',
                value: marketData,
                lineStyle: { type: 'dashed', width: 1.5 },
                symbol: 'none',
                itemStyle: { color: '#8b949e' },
                areaStyle: { color: 'rgba(139, 148, 158, 0.05)' }
            }
        ];

        // 确定展示对象
        if (codeA || codeB) {
            // 对比模式
            let titleText = "行业对比:";
            if (codeA && INDUSTRY_FACTORS[codeA]) {
                const infoA = INDUSTRY_FACTORS[codeA];
                titleText += ` ${infoA.name}`;
                seriesData.push({
                    name: infoA.name,
                    value: [
                        infoA.means.DSRI, infoA.means.GMI, infoA.means.AQI, infoA.means.SGI,
                        infoA.means.DEPI, infoA.means.SGAI, infoA.means.LVGI, infoA.means.TATA
                    ],
                    itemStyle: { color: '#58a6ff' },
                    areaStyle: { color: 'rgba(88, 166, 255, 0.1)' }
                });
            }
            if (codeB && INDUSTRY_FACTORS[codeB]) {
                const infoB = INDUSTRY_FACTORS[codeB];
                titleText += ` vs ${infoB.name}`;
                seriesData.push({
                    name: infoB.name,
                    value: [
                        infoB.means.DSRI, infoB.means.GMI, infoB.means.AQI, infoB.means.SGI,
                        infoB.means.DEPI, infoB.means.SGAI, infoB.means.LVGI, infoB.means.TATA
                    ],
                    itemStyle: { color: '#bc8cff' },
                    areaStyle: { color: 'rgba(188, 140, 255, 0.1)' }
                });
            }
            if (subtitle) subtitle.innerText = titleText;
        } else {
            // 单行业查看模式
            const info = INDUSTRY_FACTORS[this.selectedIndcd];
            if (info) {
                if (subtitle) subtitle.innerText = `当前选中: ${info.name} (${this.selectedIndcd})`;
                seriesData.push({
                    name: info.name,
                    value: [
                        info.means.DSRI, info.means.GMI, info.means.AQI, info.means.SGI,
                        info.means.DEPI, info.means.SGAI, info.means.LVGI, info.means.TATA
                    ],
                    itemStyle: { color: '#39d2c0' },
                    areaStyle: { color: 'rgba(57, 210, 192, 0.15)' }
                });
            }
        }

        const option = {
            tooltip: {
                trigger: 'item',
                backgroundColor: '#161b22',
                borderColor: '#30363d',
                textStyle: { color: '#e6edf3' }
            },
            legend: {
                bottom: 0,
                left: 'center',
                textStyle: { color: '#8b949e', fontSize: 11 }
            },
            radar: {
                indicator: indicators,
                radius: '65%',
                center: ['50%', '48%'],
                shape: 'polygon',
                splitNumber: 5,
                axisName: {
                    color: '#8b949e',
                    fontSize: 11
                },
                splitLine: {
                    lineStyle: {
                        color: 'rgba(48, 54, 61, 0.5)'
                    }
                },
                splitArea: {
                    show: true,
                    areaStyle: {
                        color: ['rgba(22, 27, 34, 0.3)', 'rgba(10, 14, 20, 0.5)']
                    }
                },
                axisLine: {
                    lineStyle: {
                        color: 'rgba(48, 54, 61, 0.5)'
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

    // 4. 绑定对比事件
    bindEvents() {
        const compareBtn = document.getElementById('industry-compare-btn');
        const resetBtn = document.getElementById('industry-reset-btn');
        const select1 = document.getElementById('industry-select-1');
        const select2 = document.getElementById('industry-select-2');
        if (this.eventsBound) return;
        this.eventsBound = true;

        if (compareBtn) {
            compareBtn.addEventListener('click', () => {
                this.renderRadar();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (select1) select1.value = '';
                if (select2) select2.value = '';
                this.renderRadar();
            });
        }
    }
};
