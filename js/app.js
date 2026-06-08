/**
 * A股财务数据全景仪表盘 - 主应用模块
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. 注册 ECharts 深色终端主题
    const chartsReady = Utils.ensureEcharts();
    if (chartsReady) {
        echarts.registerTheme('terminal', Utils.getChartTheme());
        Utils.clearAlert();
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
            case 'company':
                if (typeof CompanyModule !== 'undefined') CompanyModule.initSearchPage();
                break;
        }
    }

    // 4. 搜索框功能绑定 (全局顶栏与个股诊断主页)
    setupSearchInput('global-search', 'global-search-dropdown');
    setupSearchInput('large-search', 'large-search-dropdown');

    function setupSearchInput(inputId, dropdownId) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        if (!input || !dropdown) return;
        if (input.dataset.bound === 'true') return;
        input.dataset.bound = 'true';

        input.addEventListener('input', () => {
            const query = input.value.trim();
            if (!query) {
                dropdown.innerHTML = '';
                dropdown.classList.remove('active');
                return;
            }

            const results = Utils.searchCompanies(query);
            if (results.length === 0) {
                dropdown.innerHTML = `<div class="dropdown-section"><div class="dropdown-header">未找到匹配的企业</div></div>`;
                dropdown.classList.add('active');
                return;
            }

            let html = '<div class="dropdown-section"><div class="dropdown-header">搜索结果</div>';
            results.forEach(item => {
                html += `
                    <div class="dropdown-item" data-code="${Utils.escapeHtml(item.code)}">
                        <div class="item-meta">
                            <span class="item-code">${Utils.escapeHtml(item.code)}</span>
                            <span class="item-name">${Utils.escapeHtml(item.name)}</span>
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
        });

        // 聚焦时若有内容则显示
        input.addEventListener('focus', () => {
            if (input.value) {
                dropdown.classList.add('active');
            }
        });
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
});
