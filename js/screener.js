/**
 * A股财务数据全景仪表盘 - 智能选股 (Smart Screener) 模块
 */

const ScreenerModule = {
    initialized: false,
    lastResults: [],

    // 快筛预设定义
    presets: {
        safe_bluechip: {
            label: '安全白马',
            conditions: { risk: '低风险', mscore: 'safe', revenue: '10', score: 'medium' }
        },
        growth_candidate: {
            label: '成长候选',
            conditions: { revenue_grow_3y: true, profit: 'positive', risk: '低风险' }
        },
        mine_clearer: {
            label: '财务避雷',
            conditions: { mscore: 'safe', goodwill: 'low', risk: '低风险', score: 'low' }
        },
        crisis_warrior: {
            label: '危机穿越者',
            conditions: { crisis: '3', risk: '低风险', score: 'medium' }
        },
        big_quality: {
            label: '大规模优质',
            conditions: { revenue: '50', risk: '低风险', profit: 'positive' }
        }
    },

    init() {
        console.log('初始化智能选股模块...');
        if (this.initialized) return;
        this.populateSectors();
        this.bindEvents();
        this.initialized = true;
    },

    // 填充行业门类下拉框
    populateSectors() {
        const select = document.getElementById('screener-sector');
        if (!select) return;
        select.innerHTML = '<option value="">全部行业</option>';
        for (const code in SECTOR_NAME_MAP) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = SECTOR_NAME_MAP[code];
            select.appendChild(opt);
        }
    },

    // 绑定事件
    bindEvents() {
        // 快筛预设按钮
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetKey = btn.getAttribute('data-preset');
                this.applyPreset(presetKey);
            });
        });

        // 高级条件展开/折叠
        const advToggle = document.getElementById('screener-advanced-toggle');
        if (advToggle) {
            advToggle.addEventListener('click', () => {
                const adv = document.getElementById('screener-advanced');
                if (adv) {
                    const show = adv.style.display === 'none';
                    adv.style.display = show ? 'flex' : 'none';
                    advToggle.classList.toggle('active', show);
                    advToggle.querySelector('svg').style.transform = show ? 'rotate(180deg)' : '';
                }
            });
        }

        // 执行筛选
        const runBtn = document.getElementById('screener-run');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runFilter());
        }

        // 重置条件
        const resetBtn = document.getElementById('screener-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetFilters());
        }
    },

    // 应用快筛预设
    applyPreset(presetKey) {
        const preset = this.presets[presetKey];
        if (!preset) return;

        // 重置所有条件
        this.resetSelects();

        const c = preset.conditions;

        // 映射预设条件到下拉框
        if (c.risk) this.setSelect('screener-risk', c.risk);
        if (c.revenue) this.setSelect('screener-revenue', c.revenue);
        if (c.mscore) this.setSelect('screener-mscore', c.mscore);
        if (c.score) this.setSelect('screener-score', c.score);
        if (c.profit) this.setSelect('screener-profit', c.profit);
        if (c.crisis) this.setSelect('screener-crisis', c.crisis);
        if (c.goodwill) this.setSelect('screener-goodwill', c.goodwill);

        // 展开高级条件面板（如果有高级条件）
        if (c.profit || c.score || c.crisis || c.goodwill) {
            const adv = document.getElementById('screener-advanced');
            const toggle = document.getElementById('screener-advanced-toggle');
            if (adv) adv.style.display = 'flex';
            if (toggle) toggle.classList.add('active');
        }

        // 高亮预设按钮
        document.querySelectorAll('.preset-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-preset') === presetKey);
        });

        // 延迟执行筛选
        setTimeout(() => this.runFilter(), 50);
    },

    setSelect(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    },

    resetSelects() {
        ['screener-sector', 'screener-risk', 'screener-revenue', 'screener-mscore',
         'screener-profit', 'screener-score', 'screener-crisis', 'screener-goodwill'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    },

    resetFilters() {
        this.resetSelects();
        const summary = document.getElementById('screener-summary');
        const results = document.getElementById('screener-results');
        const info = document.getElementById('screener-result-info');
        if (summary) summary.style.display = 'none';
        if (info) info.textContent = '';
        if (results) {
            results.innerHTML = `
                <div class="screener-empty">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;opacity:0.3;margin-bottom:12px;">
                        <circle cx="20" cy="20" r="14"/><path d="m30 30 12 12"/><path d="M14 20h12M20 14v12"/>
                    </svg>
                    <p>选择上方的快速策略或自定义条件，点击"执行筛选"查看结果</p>
                </div>`;
        }
        this.lastResults = [];
    },

    // 执行筛选 (核心逻辑)
    runFilter() {
        if (typeof COMPANY_HISTORY === 'undefined') return;

        const sector = this.getVal('screener-sector');
        const risk = this.getVal('screener-risk');
        const revenue = this.getVal('screener-revenue');
        const mscore = this.getVal('screener-mscore');
        const profit = this.getVal('screener-profit');
        const score = this.getVal('screener-score');
        const crisis = this.getVal('screener-crisis');
        const goodwill = this.getVal('screener-goodwill');
        const revenueGrow3y = this.getVal('screener-revenue') === 'growth_3y'; // special

        // 构建危机穿越者代码集
        let crisisSurvivors = {};
        if (crisis && typeof CRISIS_COMPANIES !== 'undefined') {
            const minCount = parseInt(crisis) || 0;
            CRISIS_COMPANIES.forEach(c => {
                if (c.resist_count >= minCount) {
                    crisisSurvivors[String(c.Stkcd).padStart(6, '0')] = c;
                }
            });
        }

        // 构建商誉异常代码集
        let goodwillMap = {};
        if (goodwill && typeof GOODWILL_ANOMALIES !== 'undefined') {
            GOODWILL_ANOMALIES.forEach(g => {
                goodwillMap[String(g.stkcd).padStart(6, '0')] = g.goodwill_ratio;
            });
        }

        // 连续3年营收增长检查
        const checkRevenueGrowth = this.presets.growth_candidate &&
            document.querySelector('.preset-btn.preset-growth.active');

        const results = [];
        const latestYear = typeof SCREENING_SUMMARY !== 'undefined' ? SCREENING_SUMMARY.latest_year : 2025;

        for (const code in COMPANY_HISTORY) {
            const info = COMPANY_HISTORY[code];
            if (!info.history || info.history.length === 0) continue;

            const latest = info.history[info.history.length - 1];
            const year = latest[0];
            if (year < latestYear - 1) continue;

            const lMs = latest[1];       // M-Score
            const lRisk = latest[11];     // Risk Level
            const lScore = latest[10];    // Risk Score
            const lRev = latest[12];      // Revenue
            const lNP = latest[13];       // Net Profit

            // ── 条件过滤 ──

            // 行业门类
            if (sector) {
                const companySector = String(info.indcd || '').charAt(0).toUpperCase();
                if (companySector !== sector) continue;
            }

            // 风险等级
            if (risk && lRisk !== risk) continue;

            // 营收规模
            if (revenue) {
                const minRev = parseFloat(revenue);
                if (!isNaN(minRev) && (lRev === null || lRev < minRev)) continue;
            }

            // M-Score
            if (mscore) {
                if (lMs === null || lMs === undefined) continue;
                if (mscore === 'safe' && lMs >= -1.78) continue;
                if (mscore === 'moderate' && lMs >= -1.50) continue;
                if (mscore === 'risky' && lMs <= -1.78) continue;
            }

            // 净利润
            if (profit) {
                if (lNP === null || lNP === undefined) continue;
                if (profit === 'positive' && lNP <= 0) continue;
                if (profit === 'loss' && lNP >= 0) continue;
            }

            // 风险评分
            if (score) {
                if (lScore === null || lScore === undefined) continue;
                if (score === 'low' && lScore > 10) continue;
                if (score === 'medium' && lScore > 30) continue;
                if (score === 'high' && lScore <= 50) continue;
            }

            // 危机穿越
            if (crisis) {
                if (!crisisSurvivors[code]) continue;
            }

            // 商誉占比
            if (goodwill) {
                const gw = goodwillMap[code];
                if (goodwill === 'low') {
                    // 没有商誉数据或商誉占比 < 5% 都算安全
                    if (gw !== undefined && gw >= 0.05) continue;
                } else if (goodwill === 'medium') {
                    if (gw !== undefined && gw >= 0.15) continue;
                } else if (goodwill === 'high') {
                    if (gw === undefined || gw < 0.30) continue;
                }
            }

            // 连续3年营收增长 (成长候选)
            if (checkRevenueGrowth) {
                if (info.history.length < 3) continue;
                const last3 = info.history.slice(-3);
                const revs = last3.map(r => r[12]);
                if (revs.some(r => r === null || r === undefined || r <= 0)) continue;
                if (!(revs[0] < revs[1] && revs[1] < revs[2])) continue;
            }

            // ── 通过所有条件 ──
            results.push({
                code,
                name: info.name,
                indnme: info.indnme,
                mscore: lMs,
                riskLevel: lRisk,
                riskScore: lScore,
                revenue: lRev,
                netProfit: lNP,
                crisisCount: crisisSurvivors[code] ? crisisSurvivors[code].resist_count : 0
            });
        }

        // 排序：风险评分升序 (最安全在前)
        results.sort((a, b) => (a.riskScore || 99) - (b.riskScore || 99));

        // 最多展示 200 条
        const displayResults = results.slice(0, 200);
        this.lastResults = displayResults;

        // 渲染结果
        this.renderSummary(results);
        this.renderResults(displayResults);
    },

    getVal(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    },

    // 渲染结果概览
    renderSummary(results) {
        const summary = document.getElementById('screener-summary');
        const info = document.getElementById('screener-result-info');
        if (!summary) return;

        summary.style.display = 'flex';

        const count = results.length;
        const avgMs = count > 0 ? (results.reduce((s, r) => s + (r.mscore || 0), 0) / count).toFixed(3) : '--';
        const avgScore = count > 0 ? (results.reduce((s, r) => s + (r.riskScore || 0), 0) / count).toFixed(1) : '--';

        // 统计主要行业
        const sectorCount = {};
        results.forEach(r => { sectorCount[r.indnme] = (sectorCount[r.indnme] || 0) + 1; });
        const topSector = Object.entries(sectorCount).sort((a, b) => b[1] - a[1])[0];
        const topSectorStr = topSector ? `${topSector[0]} (${topSector[1]}家)` : '--';

        document.getElementById('screener-count').textContent = count + ' 家';
        document.getElementById('screener-avg-mscore').textContent = avgMs;
        document.getElementById('screener-avg-score').textContent = avgScore;
        document.getElementById('screener-top-sector').textContent = topSectorStr;

        if (info) {
            info.textContent = count > 200 ? `显示前 200 条 (共 ${count} 条匹配)` : `共 ${count} 条匹配`;
        }
    },

    // 渲染结果列表
    renderResults(results) {
        const container = document.getElementById('screener-results');
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = `
                <div class="screener-empty">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;opacity:0.3;margin-bottom:12px;">
                        <circle cx="20" cy="20" r="14"/><path d="m30 30 12 12"/>
                    </svg>
                    <p>未找到符合条件的企业，请尝试放宽筛选条件</p>
                </div>`;
            return;
        }

        let html = '<div class="screener-table-wrapper"><table class="custom-table screener-table"><thead><tr>';
        html += '<th>代码</th><th>企业名称</th><th>行业</th><th>风险等级</th><th>M-Score</th><th>风险评分</th><th>营收(亿)</th><th>净利润(亿)</th>';
        html += '</tr></thead><tbody>';

        results.forEach(item => {
            const badgeClass = Utils.getRiskLevelClass(item.riskLevel);
            const msClass = (item.mscore !== null && item.mscore > -1.78) ? 'text-red' : '';
            const npClass = (item.netProfit !== null && item.netProfit < 0) ? 'text-red' : '';

            html += `<tr class="screener-row-item" data-code="${Utils.escapeHtml(item.code)}">
                <td><span class="font-mono" style="color:var(--accent-blue);">${Utils.escapeHtml(item.code)}</span></td>
                <td><strong>${Utils.escapeHtml(item.name)}</strong></td>
                <td style="font-size:11px;color:var(--text-muted);">${Utils.escapeHtml(item.indnme)}</td>
                <td><span class="badge ${badgeClass}">${Utils.escapeHtml(item.riskLevel || '--')}</span></td>
                <td><span class="font-mono ${msClass}">${item.mscore !== null ? item.mscore.toFixed(3) : '--'}</span></td>
                <td><span class="font-mono font-bold">${item.riskScore !== null ? item.riskScore.toFixed(1) : '--'}</span></td>
                <td><span class="font-mono">${item.revenue !== null ? item.revenue.toFixed(1) : '--'}</span></td>
                <td><span class="font-mono ${npClass}">${item.netProfit !== null ? item.netProfit.toFixed(2) : '--'}</span></td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // 绑定行点击
        container.querySelectorAll('.screener-row-item').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const code = row.getAttribute('data-code');
                window.showCompanyDetail(code);
            });
        });
    }
};
