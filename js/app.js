/**
 * A股财务数据全景仪表盘 - 主应用模块
 */

document.addEventListener('DOMContentLoaded', () => {
    // 0. 恢复上次保存的主题偏好
    Utils.initTheme();

    // 1. 注册 ECharts 深色 & 浅色双主题
    const chartsReady = Utils.ensureEcharts();
    if (chartsReady) {
        echarts.registerTheme('terminal', Utils.getChartTheme());
        echarts.registerTheme('terminal-light', Utils.getLightChartTheme());
        Utils.clearAlert();
    }

    // 1.5 绑定主题切换按钮
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => Utils.toggleTheme());
    }

    // 2. 主页面 Tab 路由控制
    const tabs = document.querySelectorAll('.nav-tab');
    const sections = document.querySelectorAll('.tab-content');

    function handleRouting() {
        let hash = window.location.hash.substring(1);
        if (!hash) {
            hash = 'overview';
            window.location.hash = 'overview';
        }
        if (!document.getElementById(`${hash}-tab`)) {
            hash = 'overview';
            window.location.hash = 'overview';
        }

        // 激活对应的导航 Tab
        tabs.forEach(tab => {
            if (tab.getAttribute('data-tab') === hash) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // 显示对应的模块 Panel
        sections.forEach(sec => {
            if (sec.id === `${hash}-tab`) {
                sec.classList.add('active');
            } else {
                sec.classList.remove('active');
            }
        });

        // 延迟触发模块的渲染，确保容器尺寸已稳定
        setTimeout(() => {
            triggerModuleRender(hash);
        }, 50);
    }

    // 监听 Hash 变更及初始化路由
    window.addEventListener('hashchange', handleRouting);
    handleRouting();

    // 点击 Tab 手动切换 Hash
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = tab.getAttribute('data-tab');
            window.location.hash = targetTab;
        });
    });

    // 3. 触发各个模块的渲染
    function triggerModuleRender(tabName) {
        console.log(`切换到模块: ${tabName}`);
        if (!Utils.ensureEcharts()) return;
        switch (tabName) {
            case 'overview':
                if (typeof OverviewModule !== 'undefined') OverviewModule.init();
                break;
            case 'industry':
                if (typeof IndustryModule !== 'undefined') IndustryModule.init();
                break;
            case 'crisis':
                if (typeof CrisisModule !== 'undefined') CrisisModule.init();
                break;
            case 'risk':
                if (typeof RiskModule !== 'undefined') RiskModule.init();
                break;
            case 'factor':
                if (typeof FactorModule !== 'undefined') FactorModule.init();
                break;
            case 'screener':
                if (typeof ScreenerModule !== 'undefined') ScreenerModule.init();
                break;
            case 'watchlist':
                if (typeof WatchlistModule !== 'undefined') WatchlistModule.init();
                break;
            case 'benchmark':
                if (typeof BenchmarkModule !== 'undefined') BenchmarkModule.init();
                break;
            case 'rd':
                if (typeof RDModule !== 'undefined') RDModule.init();
                break;
            case 'company':
                if (typeof CompanyModule !== 'undefined') CompanyModule.initSearchPage();
                break;
        }
    }

    // 4. 搜索框功能绑定 (全局顶栏与个股诊断主页)
    // 构建搜索索引 (一次性开销，后续搜索更快)
    Utils.buildSearchIndex();
    setupSearchInput('global-search', 'global-search-dropdown');
    setupSearchInput('large-search', 'large-search-dropdown');

    function setupSearchInput(inputId, dropdownId) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if (!input || !dropdown) return;
        if (input.dataset.bound === 'true') return;
        input.dataset.bound = 'true';

        // 防抖计时器
        let debounceTimer = null;

        input.addEventListener('input', () => {
            const query = input.value.trim();
            if (!query) {
                dropdown.innerHTML = '';
                dropdown.classList.remove('active');
                return;
            }

            // 200ms 防抖
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const results = Utils.searchCompanies(query);
                if (results.length === 0) {
                    dropdown.innerHTML = `<div class="dropdown-section"><div class="dropdown-header">未找到匹配的企业</div></div>`;
                    dropdown.classList.add('active');
                    return;
                }

                let html = `<div class="dropdown-section"><div class="dropdown-header">搜索结果 (${results.length} 条)</div>`;
                results.forEach(item => {
                    const badgeClass = Utils.getRiskLevelClass ? getLatestRiskBadge(item.code) : '';
                    html += `
                        <div class="dropdown-item" data-code="${Utils.escapeHtml(item.code)}">
                            <div class="item-meta">
                                <span class="item-code">${Utils.escapeHtml(item.code)}</span>
                                <span class="item-name">${Utils.escapeHtml(item.name)}</span>
                                ${badgeClass ? `<span class="badge ${badgeClass}">${getLatestRiskLevel(item.code)}</span>` : ''}
                            </div>
                            <span class="item-ind">${Utils.escapeHtml(item.indnme)}</span>
                        </div>
                    `;
                });
                html += '</div>';
                dropdown.innerHTML = html;
                dropdown.classList.add('active');

                // 绑定下拉框点击事件
                dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const code = item.getAttribute('data-code');
                        input.value = '';
                        dropdown.classList.remove('active');
                        window.showCompanyDetail(code);
                    });
                });
            }, 200);
        });

        // 聚焦时若有内容则显示
        input.addEventListener('focus', () => {
            if (input.value) {
                dropdown.classList.add('active');
            }
        });
    }

    // 辅助：获取最新年度风险等级
    function getLatestRiskLevel(code) {
        if (typeof COMPANY_HISTORY === 'undefined') return '';
        const info = COMPANY_HISTORY[code];
        if (!info || !info.history || info.history.length === 0) return '';
        return info.history[info.history.length - 1][11] || '';
    }
    function getLatestRiskBadge(code) {
        const level = getLatestRiskLevel(code);
        if (!level) return '';
        return (Utils.getRiskLevelClass && Utils.getRiskLevelClass(level)) || '';
    }

    // 点击页面其它地方关闭搜索联想框
    document.addEventListener('click', (e) => {
        const dropdowns = document.querySelectorAll('.search-dropdown');
        const inputs = document.querySelectorAll('.search-input, .search-large-input');
        
        let clickedInputOrDropdown = false;
        inputs.forEach(input => {
            if (input.contains(e.target)) clickedInputOrDropdown = true;
        });
        dropdowns.forEach(dropdown => {
            if (dropdown.contains(e.target)) clickedInputOrDropdown = true;
        });

        if (!clickedInputOrDropdown) {
            dropdowns.forEach(d => d.classList.remove('active'));
        }
    });

    // 5. 侧边滑出抽屉面板 (Drawer Pattern) 关闭事件绑定
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawer-overlay');
    const closeBtn = document.getElementById('drawer-close-btn');

    if (overlay && drawer && closeBtn) {
        if (drawer.dataset.closeBound === 'true') return;
        drawer.dataset.closeBound = 'true';

        function closeDrawer() {
            drawer.classList.remove('active');
            overlay.classList.remove('active');
        }

        overlay.addEventListener('click', closeDrawer);
        closeBtn.addEventListener('click', closeDrawer);
    }

    // 6. 趋势快筛芯片点击处理
    const trendFilterLabels = {
        safe_lowrisk:     '安全白马（低风险 + M-Score < -1.78 + 营收 ≥ 10亿）',
        mscore_improve_3y: 'M-Score 连续 3 年改善（财务质量持续向好）',
        revenue_grow_3y:  '连续 3 年营收增长（成长性验证）',
        risk_decline_3y:  '风险评分连续 3 年下降（安全性持续改善）',
        crisis_survivor:  '危机穿越者（≥ 3 次穿越 + 低/关注风险）',
        big_revenue:      '大规模优质企业（营收 ≥ 50亿 + 低风险）'
    };

    function renderTrendResults(filterKey, results) {
        const container = document.getElementById('trend-filter-results');
        const titleEl = document.getElementById('trend-results-title');
        const countEl = document.getElementById('trend-results-count');
        const bodyEl = document.getElementById('trend-results-body');
        if (!container || !bodyEl) return;

        titleEl.textContent = trendFilterLabels[filterKey] || '筛选结果';
        countEl.textContent = results.length + ' 家企业';
        container.style.display = 'block';

        // 高亮当前激活的 chip
        document.querySelectorAll('.trend-chip').forEach(chip => {
            chip.classList.toggle('active', chip.getAttribute('data-filter') === filterKey);
        });

        if (results.length === 0) {
            bodyEl.innerHTML = '<div class="trend-empty">暂无符合条件的企业</div>';
            return;
        }

        let html = '<div class="trend-results-grid">';
        results.forEach(item => {
            const badgeClass = Utils.getRiskLevelClass(item.riskLevel);
            const mscoreDisplay = item.mscore !== null && item.mscore !== undefined ? item.mscore.toFixed(3) : '--';
            const mscoreClass = item.mscore > -1.78 ? 'text-red' : '';
            const revenueDisplay = item.revenue !== null && item.revenue !== undefined ? item.revenue.toFixed(1) : '--';
            const trendBadge = item.trend ? `<span class="trend-badge trend-badge-up">${Utils.escapeHtml(item.trend)}</span>` : '';

            html += `
                <div class="trend-result-card" data-code="${Utils.escapeHtml(item.code)}">
                    <div class="trend-card-top">
                        <span class="trend-card-name">${Utils.escapeHtml(item.name)}</span>
                        <span class="badge ${badgeClass}">${Utils.escapeHtml(item.riskLevel || '--')}</span>
                    </div>
                    <div class="trend-card-meta">
                        <span class="trend-card-code">${Utils.escapeHtml(item.code)}</span>
                        <span class="trend-card-ind">${Utils.escapeHtml(item.indnme)}</span>
                    </div>
                    <div class="trend-card-stats">
                        <div class="trend-stat">
                            <span class="trend-stat-label">M-Score</span>
                            <span class="trend-stat-val ${mscoreClass}">${mscoreDisplay}</span>
                        </div>
                        <div class="trend-stat">
                            <span class="trend-stat-label">营收(亿)</span>
                            <span class="trend-stat-val">${revenueDisplay}</span>
                        </div>
                        <div class="trend-stat">
                            <span class="trend-stat-label">评分</span>
                            <span class="trend-stat-val">${item.riskScore !== null && item.riskScore !== undefined ? item.riskScore.toFixed(1) : '--'}</span>
                        </div>
                        ${trendBadge ? `<div class="trend-stat">${trendBadge}</div>` : ''}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        bodyEl.innerHTML = html;

        // 绑定卡片点击事件
        bodyEl.querySelectorAll('.trend-result-card').forEach(card => {
            card.addEventListener('click', () => {
                const code = card.getAttribute('data-code');
                window.showCompanyDetail(code);
            });
        });
    }

    // 绑定趋势快筛按钮
    document.querySelectorAll('.trend-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const filterKey = chip.getAttribute('data-filter');
            if (!filterKey) return;

            // 如果点击的是已激活的 chip，取消激活
            if (chip.classList.contains('active')) {
                chip.classList.remove('active');
                const container = document.getElementById('trend-filter-results');
                if (container) container.style.display = 'none';
                return;
            }

            // 显示 loading 状态
            chip.classList.add('loading');
            // 延迟执行筛选以允许 UI 更新
            setTimeout(() => {
                const results = Utils.trendFilter(filterKey);
                chip.classList.remove('loading');
                renderTrendResults(filterKey, results);
            }, 50);
        });
    });

    // 关闭趋势结果
    const closeResultsBtn = document.getElementById('trend-results-close');
    if (closeResultsBtn) {
        closeResultsBtn.addEventListener('click', () => {
            const container = document.getElementById('trend-filter-results');
            if (container) container.style.display = 'none';
            document.querySelectorAll('.trend-chip').forEach(c => c.classList.remove('active'));
        });
    }
});
