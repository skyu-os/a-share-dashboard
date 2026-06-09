/**
 * A股财务数据全景仪表盘 - 我的关注 (Watchlist) 模块
 * 整合行业研究报告的核心观点、标的监控和催化剂时间线
 */

const WatchlistModule = {
    initialized: false,
    currentSub: 'sst',

    // ── 行业研报数据 ──
    reports: {
        sst: {
            title: 'SST 固态变压器',
            date: '2026年6月',
            thesis: 'SST是2026年电力设备领域最具爆发力的技术革新赛道，被称为"电力领域的CPO"。英伟达800V直流+华为源网荷储战略+政策密集支持三重催化，2026年为"SST商业化元年"。但当前仍处于0到1阶段，投资需区分"有产品有订单"和"仅有概念"的标的。',
            riskAlert: {
                title: '历史周期风险警示',
                level: 'high',
                points: [
                    '当前处于A股概念炒作五阶段的第①→②阶段（概念引入→狂热高峰），市场预期领先产业落地2-4年',
                    '历史上约90%的概念标的最终未能兑现，真正赢家仅1-3家',
                    '储能行业曾6次宣布"商业化元年"，每次延迟9年以上——SST的"元年"叙事需打折',
                    'SST成本是传统方案的2-10倍，多数A股SST概念股的SST收入为零或可忽略',
                    '四方股份PE达74倍（行业均值38倍），已自行发布异常波动公告'
                ],
                advice: '保持10-15%观察仓位，等待第③阶段"现实检验"带来20-30%回调后再加仓。核心集中于2-3家确定性龙头。'
            },
            stocks: [
                // 第一梯队：确定性最高
                { code: '601126', tier: '核心', name: '四方股份', thesis: 'SST整机绝对龙头，市占率超30%，已量产', color: 'green' },
                { code: '688676', tier: '核心', name: '金盘科技', thesis: '全球化SST先锋，海外大单69.6亿，在手75.4亿', color: 'green' },
                { code: '002922', tier: '核心', name: '伊戈尔', thesis: 'SST整机+磁性元件双线，已获欧洲数据中心订单', color: 'green' },
                // 第二梯队：高弹性
                { code: '688663', tier: '弹性', name: '新风光', thesis: '2500kW SST样机下线，20年高频技术底蕴', color: 'yellow' },
                { code: '603063', tier: '弹性', name: '禾望电气', thesis: 'SST效率99.2%行业最高，计划2026年量产', color: 'yellow' },
                { code: '002851', tier: '弹性', name: '麦格米特', thesis: '800V架构专家，英伟达潜在供应商', color: 'yellow' },
                { code: '300274', tier: '弹性', name: '阳光电源', thesis: '储能龙头+SST跨界，35kV技术储备', color: 'yellow' },
                // 第三梯队：上游卖铲子
                { code: '002885', tier: '上游', name: '京泉华', thesis: 'SST高频变压器隐形冠军，伊顿独家供应商', color: 'blue' },
                { code: '688234', tier: '上游', name: '天岳先进', thesis: '全球SiC衬底第一(27.6%份额)，8英寸超50%', color: 'blue' },
                { code: '603290', tier: '上游', name: '斯达半导', thesis: '国产SiC MOSFET模组龙头', color: 'blue' },
                { code: '300811', tier: '上游', name: '铂科新材', thesis: '全球金属软磁粉芯龙头', color: 'blue' },
                { code: '600563', tier: '上游', name: '法拉电子', thesis: '薄膜电容龙头，SST DC-link核心供应商', color: 'blue' }
            ],
            catalysts: [
                { time: '2026 Q2-Q3', event: '四方股份35kV SST原型机发布', impact: '四方股份' },
                { time: '2026 H2', event: '维谛/台达SST产品正式发布', impact: '全产业链' },
                { time: '2026 年底', event: '阳光电源推出SST产品', impact: '阳光电源' },
                { time: '2027', event: '英伟达强制要求新数据中心SST/800V', impact: '全行业爆发', highlight: true },
                { time: '2027-2028', event: 'SiC价格进一步下降20-30%', impact: '整机商利润率改善' },
                { time: '2028-2030', event: '大规模商用部署，SST成本显著下降', impact: '主流渗透' }
            ]
        },
        storage: {
            title: '储能',
            date: '2026年6月',
            thesis: '储能是新能源产业链中增长确定性最高的细分赛道。容量电价机制(114号文)首次为独立储能提供"保底收入"，海外订单爆发(+144%)，技术路线多元化(钠电/液流/长时储能)提供多重增长引擎。但锂电储能电芯产能利用率仅35%，需警惕价格战风险。',
            riskAlert: null,
            stocks: [
                // 第一梯队：核心配置
                { code: '300750', tier: '核心', name: '宁德时代', thesis: '全球动力+储能双料冠军，储能毛利率26.71%', color: 'green' },
                { code: '300274', tier: '核心', name: '阳光电源', thesis: '储能系统集成龙头，毛利率36.49%行业最高', color: 'green' },
                // 第二梯队：高弹性
                { code: '605117', tier: '弹性', name: '德业股份', thesis: '全球户用储能逆变器第一，毛利率51%', color: 'yellow' },
                { code: '688390', tier: '弹性', name: '固德威', thesis: '储能逆变器+电池双爆发，出货+166%/+482%', color: 'yellow' },
                { code: '300014', tier: '弹性', name: '亿纬锂能', thesis: '储能电芯全球第二，大圆柱+钠电双线', color: 'yellow' },
                { code: '300438', tier: '弹性', name: '鹏辉能源', thesis: 'Q1净利已超2025全年，工商业储能TOP3', color: 'yellow' },
                // 第三梯队：主题性机会
                { code: '688411', tier: '主题', name: '海博思创', thesis: '纯储能系统集成第一股，弹性最大', color: 'blue' },
                { code: '002335', tier: '主题', name: '科华数据', thesis: '储能PCS三连冠，累计出货>8GW', color: 'blue' },
                { code: '300827', tier: '主题', name: '上能电气', thesis: '储能PCS专业化龙头', color: 'blue' },
                { code: '688063', tier: '主题', name: '派能科技', thesis: '户用储能电池先驱，欧洲需求复苏', color: 'blue' },
                { code: '002407', tier: '主题', name: '多氟多', thesis: '六氟磷酸锂+钠电池材料双主线', color: 'blue' }
            ],
            catalysts: [
                { time: '2026 Q2-Q3', event: '"十五五"新型储能发展实施方案正式发布', impact: '全行业', highlight: true },
                { time: '2026 Q3-Q4', event: '宁德时代钠电池量产', impact: '宁德时代、多氟多' },
                { time: '2026 H2', event: '更多省份出台容量电价细则', impact: '独立储能运营商和系统集成商' },
                { time: '2026 持续', event: '欧洲/中东储能订单持续落地', impact: '阳光电源、德业股份、固德威' },
                { time: '2027', event: '固态电池储能项目规模化', impact: '宁德时代、亿纬锂能' }
            ]
        },
        newenergy: {
            title: '新能源',
            date: '2026年6月',
            thesis: '新能源行业进入"规模化扩张向高质量发展转型"阶段。风光累计装机18.4亿千瓦首超火电，新能源车渗透率突破50%。"十五五"期间预计新增超5万亿元投资。光伏和动力电池已产能过剩，风电和储能仍保持较高增速。核心关注出海龙头和新技术路线标的。',
            riskAlert: {
                title: '产能过剩警示',
                level: 'medium',
                points: [
                    '光伏组件产能1,100GW vs 需求530GW，利用率不足50%，2024年全行业亏损574.7亿元',
                    '储能电池产能5,000GWh vs 产量1,756GWh，利用率仅35%，四部委已出手规范',
                    '新能源车价格战向产业链传导，部分整车企业单车亏损2-3万元'
                ],
                advice: '优先配置高毛利率环节（户用逆变器、自研PCS系统）和具备全球竞争力的龙头企业。'
            },
            stocks: [
                // 储能系统
                { code: '300750', tier: '核心', name: '宁德时代', thesis: '动力+储能电池双料冠军，全技术路线覆盖', color: 'green' },
                { code: '300274', tier: '核心', name: '阳光电源', thesis: '逆变器+储能双龙头，海外收入居出口企业首位', color: 'green' },
                // 风电
                { code: '002202', tier: '核心', name: '金风科技', thesis: '风电整机市占率第一(~22.8%)，直驱永磁领先', color: 'green' },
                { code: '601615', tier: '弹性', name: '明阳智能', thesis: '海上风电龙头，超长叶片120m+', color: 'yellow' },
                // 光伏
                { code: '600438', tier: '弹性', name: '通威股份', thesis: '全球最大多晶硅+电池片生产商', color: 'yellow' },
                { code: '688223', tier: '弹性', name: '晶科能源', thesis: '2025全球组件出货第一(86.8GW)', color: 'yellow' },
                { code: '601012', tier: '弹性', name: '隆基绿能', thesis: 'All-in BC电池，2026成本与TOPCon持平', color: 'yellow' },
                // 电网
                { code: '600406', tier: '核心', name: '国电南瑞', thesis: '智能电网龙头，在手订单超280亿', color: 'green' },
                // 其他
                { code: '002594', tier: '核心', name: '比亚迪', thesis: '整车+电池垂直整合，刀片电池独特', color: 'green' },
                { code: '605117', tier: '弹性', name: '德业股份', thesis: '混合逆变器+热泵双轮驱动', color: 'yellow' },
                { code: '688390', tier: '弹性', name: '固德威', thesis: '户用逆变器+储能细分龙头', color: 'yellow' },
                { code: '300014', tier: '弹性', name: '亿纬锂能', thesis: '大圆柱电池技术领先', color: 'yellow' }
            ],
            catalysts: [
                { time: '2026 Q2-Q3', event: '"十五五"新能源发展规划正式发布', impact: '全行业', highlight: true },
                { time: '2026 Q3', event: '宁德时代钠电池量产', impact: '宁德时代、多氟多' },
                { time: '2026 H2', event: 'BC电池成本与TOPCon持平', impact: '隆基绿能' },
                { time: '2026 持续', event: '欧洲/中东/东南亚新能源订单落地', impact: '出海龙头' },
                { time: '2027', event: '固态电池规模化', impact: '宁德时代、亿纬锂能' }
            ]
        }
    },

    init() {
        if (this.initialized) return;
        this.bindEvents();
        this.renderSub(this.currentSub);
        this.initialized = true;
    },

    bindEvents() {
        const subtabs = document.getElementById('watchlist-subtabs');
        if (subtabs) {
            subtabs.addEventListener('click', (e) => {
                const btn = e.target.closest('.watchlist-subtab');
                if (!btn) return;
                const sub = btn.getAttribute('data-sub');
                if (sub === this.currentSub) return;
                this.currentSub = sub;
                subtabs.querySelectorAll('.watchlist-subtab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderSub(sub);
            });
        }
    },

    renderSub(sub) {
        const report = this.reports[sub];
        if (!report) return;

        this.renderThesis(report);
        this.renderRiskAlert(report.riskAlert);
        this.renderTable(report.stocks);
        this.renderCatalysts(report.catalysts);
    },

    // ── 核心观点卡片 ──
    renderThesis(report) {
        const el = document.getElementById('watchlist-thesis');
        if (!el) return;
        el.innerHTML = `
            <div class="thesis-header">
                <h3 class="thesis-title">${report.title} · 投资研究</h3>
                <span class="thesis-date">${report.date}</span>
            </div>
            <p class="thesis-text">${report.thesis}</p>
            <div class="thesis-stats">
                <span class="thesis-stat"><strong>${report.stocks.length}</strong> 只关注标的</span>
                <span class="thesis-stat"><strong>${report.catalysts.length}</strong> 个催化事件</span>
                <span class="thesis-stat"><strong>${report.stocks.filter(s => s.tier === '核心').length}</strong> 只核心仓位</span>
            </div>`;
    },

    // ── 风险提示卡片 ──
    renderRiskAlert(alert) {
        const el = document.getElementById('watchlist-risk-alert');
        if (!el) return;
        if (!alert) {
            el.style.display = 'none';
            return;
        }
        el.style.display = 'block';
        const levelClass = alert.level === 'high' ? 'alert-high' : alert.level === 'medium' ? 'alert-medium' : 'alert-low';
        el.innerHTML = `
            <div class="risk-alert-header ${levelClass}">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" style="width:18px;height:18px;"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><path d="M10 7v3M10 13h.01"/></svg>
                <span>${alert.title}</span>
            </div>
            <ul class="risk-alert-points">
                ${alert.points.map(p => `<li>${p}</li>`).join('')}
            </ul>
            ${alert.advice ? `<div class="risk-alert-advice">${alert.advice}</div>` : ''}`;
    },

    // ── 标的监控表 ──
    renderTable(stocks) {
        const tbody = document.getElementById('watchlist-table-body');
        if (!tbody) return;

        let html = '';
        stocks.forEach(s => {
            // 从 COMPANY_HISTORY 获取实时财务数据
            const info = (typeof COMPANY_HISTORY !== 'undefined') ? COMPANY_HISTORY[s.code] : null;
            const history = info && info.history && info.history.length > 0 ? info.history[info.history.length - 1] : null;

            const mscore = history ? history[1] : null;
            const riskLevel = history ? history[11] : '--';
            const riskScore = history ? history[10] : null;
            const revenue = history ? history[12] : null;
            const netProfit = history ? history[13] : null;

            const msClass = (mscore !== null && mscore > -1.78) ? 'text-red' : '';
            const npClass = (netProfit !== null && netProfit < 0) ? 'text-red' : '';

            const badgeMap = { '低风险': 'badge-low', '关注': 'badge-watch', '中等风险': 'badge-mid', '高风险': 'badge-high', '极高风险': 'badge-extreme' };
            const badgeClass = badgeMap[riskLevel] || '';

            const tierClass = `tier-${s.color}`;

            html += `<tr class="watchlist-row" data-code="${Utils.escapeHtml(s.code)}">
                <td><span class="tier-badge ${tierClass}">${Utils.escapeHtml(s.tier)}</span></td>
                <td><span class="font-mono" style="color:var(--accent-blue);">${Utils.escapeHtml(s.code)}</span></td>
                <td><strong>${Utils.escapeHtml(s.name)}</strong></td>
                <td class="thesis-cell">${Utils.escapeHtml(s.thesis)}</td>
                <td><span class="font-mono ${msClass}">${mscore !== null ? mscore.toFixed(3) : '--'}</span></td>
                <td><span class="badge ${badgeClass}">${Utils.escapeHtml(riskLevel || '--')}</span></td>
                <td><span class="font-mono">${riskScore !== null ? riskScore.toFixed(1) : '--'}</span></td>
                <td><span class="font-mono">${revenue !== null ? revenue.toFixed(1) : '--'}</span></td>
                <td><span class="font-mono ${npClass}">${netProfit !== null ? netProfit.toFixed(2) : '--'}</span></td>
            </tr>`;
        });
        tbody.innerHTML = html;

        // 绑定行点击
        tbody.querySelectorAll('.watchlist-row').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const code = row.getAttribute('data-code');
                if (typeof window.showCompanyDetail === 'function') {
                    window.showCompanyDetail(code);
                }
            });
        });
    },

    // ── 催化剂时间线 ──
    renderCatalysts(catalysts) {
        const el = document.getElementById('watchlist-catalyst-list');
        if (!el) return;

        el.innerHTML = catalysts.map(c => `
            <div class="catalyst-item${c.highlight ? ' catalyst-highlight' : ''}">
                <div class="catalyst-time">${c.time}</div>
                <div class="catalyst-event">${c.event}</div>
                <div class="catalyst-impact">${c.impact}</div>
            </div>`).join('');
    }
};
