# 研发竞争力模块 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 CSRC 财务年度的研发费用、开发支出、无形资产数据，构建 7 维加权评分系统，辅助识别具备真实技术投入壁垒的 A 股公司。

**Architecture:** 延续现有模块模式 — Python 数据管线（preprocess.py 5.6-5.8 节）→ JS 常量注入 dashboard_data.js → ECharts 前端渲染。左侧行业组控制面板 + 中间评分柱状图 + 右侧雷达/趋势拆解 + 底部行业热力图。护城河定性标签独立文件（moat_notes.json）管理。

**Tech Stack:** Python 3 + pandas（管线）、Vanilla JS + ECharts 5.x（前端）、JSON（护城河数据）

## Global Constraints

- 复用 `INDUSTRY_HIERARCHY`、`COMPANY_METRICS` 等已有管线输出
- 模块对象命名 `RDModule`，文件 `js/rd.js`、`js/moat.js`
- 导航 tab: `#rd`，数据名 `rd`
- UI 面板类名前缀 `.rd-*`
- 权重默认值：强度 25%、增速 20%、健康度 15%、持续性 15%、效率 10%、定价权 8%、无形资产 7%
- 金融业标记 `rd_applicable: false` — 不展示
- 数据不足（< 2 年）灰色显示，评分为 N/A
- 权重滑块范围 0-100，标准化为百分比
- 行业组预设为 JS 常量
- `preprocess.py` 运行预期 < 5 分钟
- `dashboard_data.js` 增量 < 2MB（gzip < 500KB）
- 权重滑块拖动响应 < 100ms（纯前端重排）

---

### Task 1: Data Pipeline — R&D metrics extraction

**Files:**
- Modify: `dashboard/preprocess.py` — 新增 5.6-5.8 节
- Modify: `dashboard/dashboard_data.js` — 管线输出自动追加

**Interfaces:**
- Consumes: `上市公司财务年度合并90-24.xlsx`（B001216000, A001219000, A001218000, B001101000, A001000000 字段）、`screening_results.csv`（Stkcd, ShortName, Indcd, Indnme, Year）、已有管线中的 `INDUSTRY_HIERARCHY` 和行业组映射
- Produces: `const RD_SCORES` (Object: stkcd→{year, score, dimensions, flags})、`const RD_HISTORY` (Object: stkcd→[{year, score, dims}])、`const INDUSTRY_RD_BENCHMARK` (Object: group→{median, p25, p75,…})

- [ ] **Step 1: Read xlsx and extract raw R&D fields**

```python
# In preprocess.py, after section 5.5 (COMPANY_PERCENTILES), add:

# -- 5.6 R&D metrics: raw extraction --
print("提取研发费用数据...")
df_raw = pd.read_excel(os.path.join(WORKSPACE_DIR, '上市公司财务年度合并90-24.xlsx'),
    usecols=['Stkcd', 'Accper', 'B001216000', 'A001219000', 'A001218000',
             'B001101000', 'A001000000', 'B001201000', 'B001209000'])
df_raw.columns = ['stkcd', 'year', 'rd_expense', 'dev_expenditure',
                  'intangible_assets', 'revenue', 'total_assets',
                  'cost_of_revenue', 'selling_expense']
df_raw['stkcd'] = df_raw['stkcd'].astype(str).str.zfill(6)
df_raw['year'] = pd.to_datetime(df_raw['year']).dt.year
# 仅保留 2018 年以后（研发费用字段自 2018 年起可用）
df_raw = df_raw[df_raw['year'] >= 2018].copy()
print(f"  {df_raw['stkcd'].nunique()} 家公司，{len(df_raw)} 条记录")
```

- [ ] **Step 2: Run the partial extraction to verify data**

```bash
python preprocess.py
```
Expected: 输出 `XXXX 家公司，XXXXX 条记录` 且无异常，字段 `rd_expense` 有非零值。

- [ ] **Step 3: Compute company-level 7 metrics**

```python
# 合并 industry 信息
df_raw = df_raw.merge(
    df_screen[['Stkcd', 'Indcd', 'Indnme']].drop_duplicates(subset='Stkcd'),
    left_on='stkcd', right_on='Stkcd', how='left'
)

# 标记金融业
FINANCIAL_INDUSTRIES = {'J'}  # 金融业 CSRC 门类
df_raw['rd_applicable'] = ~df_raw['Indcd'].astype(str).str[0].isin(FINANCIAL_INDUSTRIES) if 'Indcd' in df_raw.columns else True

latest_year = int(df_raw['year'].max())

def _calc_cagr_3y(group, col, latest_year):
    """3年复合增长率，降级：3→2→1"""
    late = group[group['year'] == latest_year]
    if len(late) == 0: return None
    late_val = late[col].values[0]
    if pd.isna(late_val) or late_val == 0: return None
    for yb in range(3, 0, -1):
        early = group[group['year'] == latest_year - yb]
        if len(early) == 0: continue
        early_val = early[col].values[0]
        if pd.isna(early_val) or early_val == 0: continue
        if late_val / early_val <= 0: continue
        return float((late_val / early_val) ** (1.0 / yb) - 1) * 100
    return None

company_rd_metrics = {}
for stkcd, group in df_raw.groupby('stkcd'):
    group = group.sort_values('year')
    latest = group[group['year'] == latest_year]
    if len(latest) == 0:
        continue
    latest = latest.iloc[0]
    rd_applicable = bool(latest.get('rd_applicable', True))
    if not rd_applicable:
        company_rd_metrics[stkcd] = {'rd_applicable': False}
        continue

    rd_exp = latest['rd_expense']
    rev = latest['revenue']
    rd_intensity = (rd_exp / rev * 100) if pd.notna(rd_exp) and pd.notna(rev) and rev > 0 else None

    rd_cagr = _calc_cagr_3y(group, 'rd_expense', latest_year)
    rev_cagr = _calc_cagr_3y(group, 'revenue', latest_year)
    efficiency = (rev_cagr / rd_cagr) if (pd.notna(rd_cagr) and pd.notna(rev_cagr) and rd_cagr != 0) else None
    if efficiency is not None:
        efficiency = max(0.0, min(float(efficiency), 3.0))

    # 资本化率
    dev_exp = latest['dev_expenditure']
    cap_rate = None
    if pd.notna(rd_exp) and pd.notna(dev_exp):
        denom = rd_exp + dev_exp
        if denom > 0:
            cap_rate = dev_exp / denom

    # 持续性
    years_with_rd = group[group['rd_expense'].notna() & (group['rd_expense'] > 0)].shape[0]
    total_years = group.shape[0]
    persistence = years_with_rd / total_years if total_years > 0 else 0

    # 定价权代理（毛利率）
    gross_margins = []
    for _, row in group.iterrows():
        rev_r = row['revenue']
        cost_r = row['cost_of_revenue']
        if pd.notna(rev_r) and pd.notna(cost_r) and rev_r > 0:
            gm = (rev_r - cost_r) / rev_r
            if 0 <= gm <= 1:
                gross_margins.append(gm)
    gm_mean = np.mean(gross_margins) if gross_margins else None
    gm_cv = np.std(gross_margins) / gm_mean if (gross_margins and gm_mean and gm_mean > 0) else None
    pricing_power = gm_mean * (1 - gm_cv) if (gm_mean is not None and gm_cv is not None) else None

    # 无形资产集中度
    intang = latest['intangible_assets']
    ta = latest['total_assets']
    intang_ratio = (intang / ta) if pd.notna(intang) and pd.notna(ta) and ta > 0 else None

    # 研发费用 YoY 变化（供排雷标记）
    rd_prev = None
    prev_year_rows = group[group['year'] == latest_year - 1]
    if len(prev_year_rows) > 0:
        rd_prev = prev_year_rows.iloc[0]['rd_expense']
    rd_yoy_change = None
    if rd_prev is not None and rd_prev != 0 and rd_exp is not None:
        rd_yoy_change = (rd_exp - rd_prev) / rd_prev

    company_rd_metrics[stkcd] = {
        'rd_applicable': True,
        'rd_intensity': float(rd_intensity) if pd.notna(rd_intensity) else None,
        'rd_cagr': float(rd_cagr) if pd.notna(rd_cagr) else None,
        'cap_rate': float(cap_rate) if cap_rate is not None else None,
        'persistence': float(persistence),
        'efficiency': float(efficiency) if efficiency is not None else None,
        'pricing_power': float(pricing_power) if pricing_power is not None else None,
        'intang_ratio': float(intang_ratio) if intang_ratio is not None else None,
        'rd_yoy_change': float(rd_yoy_change) if rd_yoy_change is not None else None,
        'rd_prev': float(rd_prev) if pd.notna(rd_prev) else None,
        'rd_exp': float(rd_exp) if pd.notna(rd_exp) else None,
        'effective_years': int(total_years),
        'name': str(df_screen[df_screen['Stkcd'] == stkcd].iloc[-1]['ShortName']) if stkcd in df_screen['Stkcd'].values else stkcd
    }
```

- [ ] **Step 4: Normalize within industry groups**

```python
# 定义行业组
INDUSTRY_GROUPS = {
    'all': {'name': '全部', 'industries': None},  # None = 全部非金融
    'hardware': {'name': '硬件与设备', 'industries': ['半导体','消费电子','通信设备','计算机设备','光学光电子','元件']},
    'software': {'name': '软件与服务', 'industries': ['软件开发','IT服务','互联网电商','游戏','数字媒体']},
    'manufacturing': {'name': '高端制造', 'industries': ['自动化设备','通用设备','专用设备','电池','光伏设备','风电设备']},
    'materials': {'name': '材料与基础', 'industries': ['金属新材料','化学制品','塑料','电子化学品']},
}

# 建 stkcd → 行业组映射
def _match_group(indnme):
    for gk, gv in INDUSTRY_GROUPS.items():
        if gk == 'all': continue
        for kw in gv['industries']:
            if kw in str(indnme):
                return gk
    return 'other'

stkcd_group = {}
for stkcd, metrics in company_rd_metrics.items():
    if not metrics.get('rd_applicable', True):
        stkcd_group[stkcd] = None
        continue
    # 从 screening_results 获取行业名
    match = df_screen[df_screen['Stkcd'] == stkcd]
    if len(match) > 0:
        indnme = str(match.iloc[-1]['Indnme'])
        stkcd_group[stkcd] = _match_group(indnme)
    else:
        stkcd_group[stkcd] = 'other'

# 对每个行业组计算分位排名
DIMS = ['rd_intensity','rd_cagr','cap_rate','persistence','efficiency','pricing_power','intang_ratio']

def _calc_percentile(values):
    """计算数组中每个值的分位数（0-100），NaN 返回 None"""
    valid = [(i, v) for i, v in enumerate(values) if v is not None]
    if not valid:
        return [None] * len(values)
    sorted_vals = sorted(v[1] for v in valid)
    n = len(sorted_vals)
    def rank(v):
        if v is None: return None
        # 二分查找
        lo, hi = 0, n - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if sorted_vals[mid] < v: lo = mid + 1
            else: hi = mid - 1
        return round(lo / n * 100, 1)
    return [rank(v) for v in values]

# 按组分批归一化
for group_name in set(stkcd_group.values()):
    if group_name is None: continue
    members = [s for s, g in stkcd_group.items() if g == group_name]
    # 每个维度单独归一化
    for dim in DIMS:
        vals = [company_rd_metrics[s].get(dim) for s in members if s in company_rd_metrics]
        actual_members = [s for s in members if s in company_rd_metrics]
        percentiles = _calc_percentile(vals)
        for s, p in zip(actual_members, percentiles):
            company_rd_metrics[s][f'{dim}_pct'] = p
    # 计算行业中位数（用于资本化健康度）
    all_cap_rates = [v for s in members if (v := company_rd_metrics[s].get('cap_rate')) is not None and s in company_rd_metrics]
    median_cap = np.median(all_cap_rates) if all_cap_rates else 0
    for s in members:
        if s in company_rd_metrics:
            cap = company_rd_metrics[s].get('cap_rate')
            if cap is not None and median_cap > 0:
                dev = abs(cap - median_cap) / median_cap
                company_rd_metrics[s]['cap_health'] = round(max(0.0, min(1.0, 1 - dev)) * 100, 1)
            elif cap is not None and median_cap == 0:
                company_rd_metrics[s]['cap_health'] = 100.0  # 行业整体无资本化 = 满分
            else:
                company_rd_metrics[s]['cap_health'] = None
```

- [ ] **Step 5: Compute composite scores and flags**

```python
DEFAULT_WEIGHTS = {
    'rd_intensity': 25, 'rd_cagr': 20, 'cap_rate': 15,
    'persistence': 15, 'efficiency': 10, 'pricing_power': 8, 'intang_ratio': 7
}

RD_SCORES = {}
for stkcd, m in company_rd_metrics.items():
    if not m.get('rd_applicable', True):
        RD_SCORES[stkcd] = {'rd_applicable': False, 'score': None, 'year': latest_year, 'dimensions': {}, 'flags': []}
        continue

    score = 0
    dims_out = {}
    flags = []
    total_w = 0

    if m['effective_years'] < 2:
        flags.append('insufficient_data')

    for dim in DIMS:
        pct = m.get(f'{dim}_pct')
        if dim == 'cap_rate':
            # 资本化健康度用 cap_health
            val = m.get('cap_health')
        else:
            val = pct
        w = DEFAULT_WEIGHTS[dim]
        if val is not None:
            dims_out[dim] = round(val, 1)
            score += val * w
            total_w += w
        else:
            dims_out[dim] = None

    score = round(score / total_w, 1) if total_w > 0 else None

    # 排雷标记
    cap_rate = m.get('cap_rate')
    group_cap_median = median_cap  # 同一个 group 共享
    if cap_rate is not None and group_cap_median > 0 and cap_rate > group_cap_median * 3:
        flags.append('cap_aggressive')
    rd_yoy = m.get('rd_yoy_change')
    if rd_yoy is not None and rd_yoy < -0.3:
        flags.append('rd_cliff')
    if rd_yoy is not None and rd_yoy < -0.3 and cap_rate is not None and m.get('rd_prev') is not None and rd_yoy < 0:
        # 检查资本化率是否在上升
        prev_cap_rate = None
        # 简化：如果当年 cap_rate > 0.3 且 rd 下降 > 30%
        if cap_rate > 0.3:
            flags.append('double_kill')

    RD_SCORES[stkcd] = {
        'rd_applicable': True,
        'score': score,
        'year': int(latest_year),
        'dimensions': dims_out,
        'flags': flags,
        'name': m['name'],
        'rd_intensity_raw': m.get('rd_intensity'),
        'cap_rate_raw': m.get('cap_rate'),
        'group': stkcd_group.get(stkcd, 'other')
    }
```

- [ ] **Step 6: Generate history snapshots**

```python
# 5.7 为每年生成评分快照（用于趋势图）
RD_HISTORY = {}
for stkcd, group in df_raw.groupby('stkcd'):
    metrics = company_rd_metrics.get(stkcd)
    if not metrics or not metrics.get('rd_applicable', True):
        continue
    years = sorted(group['year'].unique())
    history = []
    for year in years:
        yr_data = group[group['year'] == year].iloc[0]
        rd_exp_v = yr_data['rd_expense']
        rev_v = yr_data['revenue']
        intensity = (rd_exp_v / rev_v * 100) if pd.notna(rd_exp_v) and pd.notna(rev_v) and rev_v > 0 else None
        history.append({
            'year': int(year),
            'rd_expense': float(rd_exp_v) if pd.notna(rd_exp_v) else None,
            'rd_intensity': round(float(intensity), 2) if intensity is not None else None,
        })
    if history:
        RD_HISTORY[stkcd] = history
```

- [ ] **Step 7: Generate industry benchmark stats**

```python
# 5.8 行业组基准统计
INDUSTRY_RD_BENCHMARK = {}
for group_name in set(stkcd_group.values()):
    if group_name is None: continue
    members = [s for s, g in stkcd_group.items() if g == group_name and s in company_rd_metrics]
    if not members: continue
    scores = [company_rd_metrics[s] for s in members]
    intensity_vals = [s['rd_intensity'] for s in scores if s.get('rd_intensity') is not None]
    intensity_vals.sort()
    n = len(intensity_vals)
    INDUSTRY_RD_BENCHMARK[group_name] = {
        'name': INDUSTRY_GROUPS.get(group_name, {}).get('name', group_name),
        'count': len(members),
        'rd_intensity_median': round(intensity_vals[n//2], 2) if n > 0 else None,
        'rd_intensity_p25': round(intensity_vals[n//4], 2) if n > 1 else None,
        'rd_intensity_p75': round(intensity_vals[3*n//4], 2) if n > 3 else None,
        'rd_intensity_mean': round(np.mean(intensity_vals), 2) if intensity_vals else None,
    }
```

- [ ] **Step 8: Serialize to dashboard_data.js**

```python
# Add to the existing serialization block in main()
print("写入研发竞争力数据...")
rd_data_js = f'''
// === 研发竞争力模块 (R&D Competitiveness) ===
// 综合评分 (7维加权: 强度25% + 增速20% + 健康度15% + 持续性15% + 效率10% + 定价权8% + 无形资产7%)
const RD_SCORES = {json.dumps(RD_SCORES, ensure_ascii=False)};
const RD_HISTORY = {json.dumps(RD_HISTORY, ensure_ascii=False)};
const INDUSTRY_RD_BENCHMARK = {json.dumps(INDUSTRY_RD_BENCHMARK, ensure_ascii=False)};
const RD_INDUSTRY_GROUPS = {json.dumps({k: v for k, v in INDUSTRY_GROUPS.items() if k != 'all'}, ensure_ascii=False)};
const RD_DEFAULT_WEIGHTS = {json.dumps(DEFAULT_WEIGHTS, ensure_ascii=False)};
'''
with open(os.path.join(OUTPUT_DIR, 'dashboard_data.js'), 'a', encoding='utf-8') as f:
    f.write(rd_data_js)
```

- [ ] **Step 9: Run full pipeline and verify output**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && python preprocess.py 2>&1 | tail -20
```
Expected: 输出 RD_SCORES 键数 > 3000，RD_HISTORY 键数 > 3000，且 `RD_SCORES` 中存在 score > 50 的公司条目。

- [ ] **Step 10: Commit**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && git add preprocess.py dashboard_data.js && git commit -m "feat: add R&D competitiveness data pipeline (5.6-5.8)

Extract 7 metrics from CSRC annual xlsx: intensity, CAGR,
capitalization health, persistence, efficiency, pricing power,
intangible concentration. Output RD_SCORES, RD_HISTORY,
INDUSTRY_RD_BENCHMARK constants." 
```

---

### Task 2: HTML Layout + CSS Styles

**Files:**
- Modify: `dashboard/index.html:35-35` (nav tabs)
- Modify: `dashboard/index.html:761-761` (before closing `</main>`)
- Modify: `dashboard/index.html:843-844` (script tags)
- Modify: `dashboard/css/style.css` — append styles
- Modify: `dashboard/js/app.js:101-103` (routing)
- Create: `dashboard/js/rd.js` (stub module)
- Create: `dashboard/js/moat.js` (stub module)
- Create: `dashboard/data/moat_notes.json` (empty initial data)

**Interfaces:**
- Consumes: `RD_SCORES`, `RD_HISTORY`, `INDUSTRY_RD_BENCHMARK`, `RD_INDUSTRY_GROUPS`, `RD_DEFAULT_WEIGHTS` (from dashboard_data.js)
- Produces: `RDModule` global object (lazy init via `RDModule.init()`), `MoatModule` global object

- [ ] **Step 1: Add nav tab in index.html**

In `index.html`, after the benchmark nav tab (line 28), add:

```html
<a href="#rd" class="nav-tab" data-tab="rd">研发竞争力</a>
```

- [ ] **Step 2: Add tab section before `</main>`**

In `index.html`, just before `</main>` (after `</section>` for benchmark-tab), add:

```html
<!-- 研发竞争力 (R&D Competitiveness) -->
<section id="rd-tab" class="tab-content">

    <!-- 控制面板 + 双栏 -->
    <div class="benchmark-grid rd-grid">
        <!-- 左栏：控制面板 250px -->
        <div class="card rd-panel-control">
            <div class="card-title"><span>行业组</span></div>
            <div class="rd-group-buttons" id="rd-group-buttons">
                <!-- JS 渲染 -->
            </div>
            <div class="card-title" style="margin-top:16px;"><span>维度权重</span></div>
            <div class="rd-weight-sliders" id="rd-weight-sliders">
                <!-- JS 渲染 7 滑块 -->
            </div>
            <div class="card-title" style="margin-top:16px;"><span>年份</span></div>
            <select class="custom-select" id="rd-year-select"></select>
            <div class="rd-moat-coverage" id="rd-moat-coverage" style="margin-top:16px;">
                <!-- JS 渲染研究覆盖度 -->
            </div>
        </div>

        <!-- 中栏：评分榜单 -->
        <div class="card rd-panel-ranking">
            <div class="card-title">
                <span id="rd-ranking-title">研发竞争力排名 — 全部</span>
                <select class="custom-select" id="rd-top-n" style="margin-left:auto;">
                    <option value="20">Top 20</option>
                    <option value="50">Top 50</option>
                    <option value="100">Top 100</option>
                </select>
            </div>
            <div class="chart-container-lg" id="rd-bar-chart"></div>
        </div>

        <!-- 右栏：公司详情 + 护城河 -->
        <div class="card rd-panel-detail">
            <div class="card-title" id="rd-detail-title">公司详情 — 请点击左侧榜单</div>
            <div class="chart-container" id="rd-radar-chart" style="height:240px;"></div>
            <div class="chart-container" id="rd-trend-chart" style="height:180px;"></div>
            <div class="rd-moat-section" id="rd-moat-section">
                <!-- JS 渲染护城河笔记 -->
            </div>
        </div>
    </div>

    <!-- 底部：行业研发强度热力图 -->
    <div class="card rd-heatmap-card">
        <div class="card-title">
            <span>行业研发强度年度变化</span>
            <span>颜色深浅 = 研发费用/营业收入 中位数 (%)</span>
        </div>
        <div class="chart-container" id="rd-heatmap-chart" style="height:360px;"></div>
    </div>

</section>
```

- [ ] **Step 3: Add script tags in index.html**

Before the `</body>` closing tag, after the benchmark.js script tag (line 843), add:

```html
<script src="js/rd.js"></script>
<script src="js/moat.js"></script>
```

- [ ] **Step 4: Add tab routing in app.js**

In `app.js`, inside the `triggerModuleRender` switch statement (after `case 'benchmark':`), add:

```javascript
case 'rd':
    if (typeof RDModule !== 'undefined') RDModule.init();
    break;
```

- [ ] **Step 5: Append CSS styles**

In `css/style.css`, append:

```css
/* ===== 研发竞争力模块 ===== */
.rd-grid {
    display: grid;
    grid-template-columns: 250px 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
}

.rd-panel-control { overflow-y: auto; }

.rd-group-buttons {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.rd-group-btn {
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    transition: all 0.15s;
    color: var(--text-primary);
}
.rd-group-btn:hover { border-color: var(--accent-color); }
.rd-group-btn.active {
    border-color: var(--accent-color);
    background: rgba(59, 130, 246, 0.1);
    font-weight: 600;
}

.rd-weight-sliders { display: flex; flex-direction: column; gap: 8px; }
.rd-slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}
.rd-slider-row label {
    width: 60px;
    flex-shrink: 0;
    color: var(--text-secondary);
}
.rd-slider-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent-color);
}
.rd-slider-row .rd-slider-val {
    width: 28px;
    text-align: right;
    font-weight: 600;
    color: var(--text-primary);
    font-size: 12px;
}

.rd-panel-ranking { overflow: hidden; }
.rd-panel-detail { overflow-y: auto; }

.rd-moat-coverage { font-size: 12px; color: var(--text-secondary); }
.rd-moat-coverage .moat-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
}
.rd-moat-coverage .moat-fill {
    height: 4px;
    background: var(--accent-color);
    border-radius: 2px;
    transition: width 0.3s;
}

.rd-moat-section {
    padding: 12px;
    border-top: 1px solid var(--border-color);
    font-size: 13px;
}
.rd-moat-section h4 {
    font-size: 14px;
    margin: 0 0 8px;
}
.rd-moat-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
}
.rd-moat-row .moat-label { color: var(--text-secondary); }
.rd-moat-row .moat-stars { color: var(--accent-color); letter-spacing: 2px; }
.rd-moat-row .moat-evidence { font-size: 11px; color: var(--text-secondary); }
.rd-moat-notes {
    margin-top: 8px;
    padding: 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
}
.rd-moat-link {
    display: inline-block;
    margin-top: 6px;
    color: var(--accent-color);
    text-decoration: none;
    font-size: 12px;
}
.rd-moat-link:hover { text-decoration: underline; }

.rd-flag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-left: 4px;
}
.rd-flag-cap { background: rgba(234, 179, 8, 0.2); color: #b45309; }
.rd-flag-cliff { background: rgba(249, 115, 22, 0.2); color: #c2410c; }
.rd-flag-double { background: rgba(239, 68, 68, 0.2); color: #b91c1c; font-weight: 600; }
.rd-flag-insufficient { background: rgba(156, 163, 175, 0.2); color: #6b7280; }

.rd-heatmap-card { margin-top: 16px; }

/* 护城河徽章 */
.moat-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
}
.moat-badge-deep { background: rgba(34, 197, 94, 0.15); color: #16a34a; }
.moat-badge-solid { background: rgba(59, 130, 246, 0.15); color: #2563eb; }
.moat-badge-research { background: rgba(156, 163, 175, 0.15); color: #6b7280; }

/* 响应式 */
@media (max-width: 1200px) {
    .rd-grid { grid-template-columns: 1fr; }
    .rd-panel-control { max-height: none; }
}
```

- [ ] **Step 6: Create rd.js stub**

Create `dashboard/js/rd.js`:

```javascript
/**
 * A股财务数据全景仪表盘 - 研发竞争力 (R&D Competitiveness) 模块
 * 7维加权评分：强度/增速/健康度/持续性/效率/定价权/无形资产
 * 左栏：行业组+权重控制 | 中栏：ECharts 评分柱状图 | 右栏：雷达+趋势+护城河 | 底：热力图
 */
const RDModule = {
    activeGroup: 'all',
    activeYear: null,
    weights: { ...RD_DEFAULT_WEIGHTS },
    selectedStkcd: null,
    initialized: false,
    barChart: null,
    radarChart: null,
    trendChart: null,
    heatmapChart: null,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        if (typeof RD_SCORES === 'undefined' || typeof RD_INDUSTRY_GROUPS === 'undefined') {
            console.warn('研发竞争力数据未加载');
            return;
        }
        if (!Utils.ensureEcharts()) return;
        // Determine latest year
        const years = new Set();
        Object.values(RD_SCORES).forEach(r => { if (r.year) years.add(r.year); });
        this.activeYear = Math.max(...years);
        this.renderGroupButtons();
        this.renderWeightSliders();
        this.renderYearSelect(years);
        this.renderBarChart();
        this.renderHeatmap();
        this.bindEvents();
        if (typeof MoatModule !== 'undefined') MoatModule.refreshCoverage();
    },

    renderGroupButtons() {
        const container = document.getElementById('rd-group-buttons');
        let html = '<button class="rd-group-btn active" data-group="all">全部</button>';
        for (const [key, cfg] of Object.entries(RD_INDUSTRY_GROUPS)) {
            html += `<button class="rd-group-btn" data-group="${key}">${cfg.name}</button>`;
        }
        container.innerHTML = html;
    },

    renderWeightSliders() {
        const labels = {
            rd_intensity: '研发强度', rd_cagr: '增速',
            cap_rate: '健康度', persistence: '持续性',
            efficiency: '效率', pricing_power: '定价权',
            intang_ratio: '无形资产'
        };
        const container = document.getElementById('rd-weight-sliders');
        let html = '';
        for (const [key, w] of Object.entries(this.weights)) {
            html += `<div class="rd-slider-row">
                <label>${labels[key] || key}</label>
                <input type="range" min="0" max="100" value="${w}" data-dim="${key}">
                <span class="rd-slider-val">${w}</span>
            </div>`;
        }
        container.innerHTML = html;
    },

    renderYearSelect(years) {
        const sel = document.getElementById('rd-year-select');
        sel.innerHTML = '';
        [...years].sort((a, b) => b - a).forEach(y => {
            sel.innerHTML += `<option value="${y}" ${y === this.activeYear ? 'selected' : ''}>${y}</option>`;
        });
    },

    bindEvents() {
        document.querySelectorAll('.rd-group-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rd-group-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeGroup = btn.dataset.group;
                this.renderBarChart();
                this.renderHeatmap();
                if (typeof MoatModule !== 'undefined') MoatModule.refreshCoverage();
            });
        });
        document.querySelectorAll('.rd-slider-row input').forEach(slider => {
            slider.addEventListener('input', () => {
                const dim = slider.dataset.dim;
                const val = parseInt(slider.value);
                this.weights[dim] = val;
                slider.nextElementSibling.textContent = val;
                this.renderBarChart();
            });
        });
        document.getElementById('rd-year-select').addEventListener('change', (e) => {
            this.activeYear = parseInt(e.target.value);
            this.renderBarChart();
            this.renderHeatmap();
        });
        document.getElementById('rd-top-n').addEventListener('change', () => {
            this.renderBarChart();
        });
    },

    getFilteredCompanies() {
        const results = [];
        for (const [stkcd, data] of Object.entries(RD_SCORES)) {
            if (!data.rd_applicable) continue;
            if (data.year !== this.activeYear) continue;
            if (this.activeGroup !== 'all' && data.group !== this.activeGroup) continue;
            if (data.flags.includes('insufficient_data')) continue;
            results.push({ stkcd, ...data });
        }
        // Recalculate score with current weights
        results.forEach(r => {
            let score = 0, totalW = 0;
            for (const [dim, w] of Object.entries(this.weights)) {
                const val = r.dimensions[dim];
                if (val != null) { score += val * w; totalW += w; }
            }
            r.weightedScore = totalW > 0 ? Math.round(score / totalW * 10) / 10 : null;
        });
        results.sort((a, b) => (b.weightedScore ?? -1) - (a.weightedScore ?? -1));
        const topN = parseInt(document.getElementById('rd-top-n')?.value || '20');
        return results.slice(0, topN);
    },

    getBarOption() {
        const data = this.getFilteredCompanies();
        // Horizontal bar chart
        return {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'value', name: '综合评分', max: 100 },
            yAxis: {
                type: 'category',
                inverse: true,
                axisLabel: {
                    formatter: (v) => v.length > 6 ? v.slice(0, 5) + '..' : v,
                    fontSize: 11
                },
                data: data.map(r => `${r.name}`).reverse(),
            },
            series: [{
                type: 'bar',
                data: data.map(r => ({
                    value: r.weightedScore,
                    itemStyle: {
                        color: r.flags.includes('double_kill') ? '#ef4444'
                            : r.flags.includes('rd_cliff') ? '#f97316'
                            : r.flags.includes('cap_aggressive') ? '#eab308'
                            : '#3b82f6'
                    }
                })).reverse(),
                label: { show: true, position: 'right', fontSize: 10, formatter: '{c}' },
                barMaxWidth: 24,
            }]
        };
    },

    renderBarChart() {
        if (!this.barChart) {
            this.barChart = echarts.init(document.getElementById('rd-bar-chart'), Utils.getTheme());
        }
        this.barChart.setOption(this.getBarOption());
        // Click handler
        this.barChart.off('click');
        this.barChart.on('click', (params) => {
            const idx = params.dataIndex;
            const data = this.getFilteredCompanies();
            const item = data[data.length - 1 - idx];
            if (item) this.showDetail(item.stkcd);
        });
    },

    showDetail(stkcd) {
        this.selectedStkcd = stkcd;
        const data = RD_SCORES[stkcd];
        document.getElementById('rd-detail-title').textContent = `${data.name} (${stkcd})`;
        this.renderRadar(stkcd);
        this.renderTrend(stkcd);
        if (typeof MoatModule !== 'undefined') MoatModule.renderMoat(stkcd);
    },

    renderRadar(stkcd) {
        if (!this.radarChart) {
            this.radarChart = echarts.init(document.getElementById('rd-radar-chart'), Utils.getTheme());
        }
        const data = RD_SCORES[stkcd];
        const labels = {
            rd_intensity: '研发强度', rd_cagr: '增速',
            cap_rate: '健康度', persistence: '持续性',
            efficiency: '效率', pricing_power: '定价权',
            intang_ratio: '无形资产'
        };
        const indicator = Object.entries(labels).map(([k, v]) => ({ name: v, max: 100 }));
        const values = Object.entries(labels).map(([k]) => data.dimensions[k] ?? 0);
        this.radarChart.setOption({
            tooltip: {},
            legend: { data: [data.name], bottom: 0 },
            radar: { indicator, center: ['50%', '55%'], radius: '65%' },
            series: [{ type: 'radar', data: [{ value: values, name: data.name, areaStyle: { opacity: 0.15 } }] }]
        });
    },

    renderTrend(stkcd) {
        if (!this.trendChart) {
            this.trendChart = echarts.init(document.getElementById('rd-trend-chart'), Utils.getTheme());
        }
        const history = RD_HISTORY[stkcd] || [];
        const years = history.map(h => h.year);
        const intensities = history.map(h => h.rd_intensity);
        this.trendChart.setOption({
            tooltip: { trigger: 'axis' },
            grid: { left: '10%', right: '5%', top: '10%', bottom: '10%' },
            xAxis: { type: 'category', data: years },
            yAxis: { type: 'value', name: '研发强度%' },
            series: [{
                type: 'line', data: intensities, smooth: true,
                areaStyle: { opacity: 0.1 },
                lineStyle: { color: '#3b82f6' },
                itemStyle: { color: '#3b82f6' }
            }]
        });
    },

    renderHeatmap() {
        if (!this.heatmapChart) {
            this.heatmapChart = echarts.init(document.getElementById('rd-heatmap-chart'), Utils.getTheme());
        }
        const groups = this.activeGroup === 'all'
            ? Object.keys(RD_INDUSTRY_GROUPS)
            : [this.activeGroup];
        const years = [...new Set(Object.values(RD_SCORES).map(r => r.year))].sort();
        const data = [];
        let maxVal = 0;
        for (const g of groups) {
            const bench = INDUSTRY_RD_BENCHMARK[g];
            if (!bench) continue;
            for (const y of years) {
                const val = bench.rd_intensity_median ?? 0;
                data.push([g, y, val]);
                if (val > maxVal) maxVal = val;
            }
        }
        this.heatmapChart.setOption({
            tooltip: { position: 'top' },
            grid: { left: '14%', right: '5%', top: '5%', bottom: '8%' },
            xAxis: { type: 'category', data: years, splitArea: { show: true } },
            yAxis: {
                type: 'category',
                data: groups.map(g => RD_INDUSTRY_GROUPS[g]?.name || g),
                splitArea: { show: true }
            },
            visualMap: { min: 0, max: maxVal || 1, calculable: true,
                orient: 'horizontal', left: 'center', bottom: '0%',
                inRange: { color: ['#f0f9ff', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7'] }
            },
            series: [{
                type: 'heatmap',
                data: data.map(d => [d[1], d[0], d[2]]),
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
            }]
        });
    },

    /** Expose resize handler */
    resize() {
        [this.barChart, this.radarChart, this.trendChart, this.heatmapChart]
            .forEach(c => c?.resize());
    }
};
```

Note: `renderHeatmap()` is a simplified stub — full implementation with per-year-per-group data requires modifying the data pipeline to produce year-group breakdowns. See Task 5 for heatmap enhancement.

- [ ] **Step 7: Create moat.js stub**

Create `dashboard/js/moat.js`:

```javascript
/**
 * A股财务数据全景仪表盘 - 护城河笔记系统
 * 管理定性标签：门槛等级、不可替代性、证据链、Obsidian 链接
 */
const MoatModule = {
    notes: {},
    loaded: false,

    // Obsidian vault 路径
    OBSIDIAN_VAULT: 'Obsidian',
    OBSIDIAN_WIKI_PATH: 'E:/Obsidian/ALL/wiki/',

    init() {
        this.loadNotes();
    },

    loadNotes() {
        // 尝试从 localStorage 或 moat_notes.json 加载
        try {
            const stored = localStorage.getItem('moat_notes');
            if (stored) {
                this.notes = JSON.parse(stored);
                this.loaded = true;
            }
        } catch (e) {
            console.warn('护城河笔记加载失败', e);
        }
        // Initial seed: load from embedded JSON if available
        if (typeof MOAT_INITIAL_DATA !== 'undefined') {
            Object.assign(this.notes, MOAT_INITIAL_DATA);
        }
    },

    saveNotes() {
        try {
            localStorage.setItem('moat_notes', JSON.stringify(this.notes));
        } catch (e) {
            console.warn('护城河笔记保存失败', e);
        }
    },

    getMoat(stkcd) {
        return this.notes[stkcd] || null;
    },

    setMoat(stkcd, data) {
        this.notes[stkcd] = { ...data, last_updated: new Date().toISOString().slice(0, 10) };
        this.saveNotes();
    },

    hasNotes(stkcd) {
        return !!this.notes[stkcd];
    },

    refreshCoverage() {
        // Update coverage display in left panel
        const container = document.getElementById('rd-moat-coverage');
        if (!container) return;
        let covered = 0, total = 0;
        for (const [stkcd, data] of Object.entries(RD_SCORES)) {
            if (!data.rd_applicable || data.group !== RDModule.activeGroup && RDModule.activeGroup !== 'all') continue;
            total++;
            if (this.hasNotes(stkcd)) covered++;
        }
        const pct = total > 0 ? Math.round(covered / total * 100) : 0;
        container.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">研究覆盖度</div>
            <div class="moat-bar">
                <span>${covered}/${total}</span>
                <div class="moat-fill" style="width:${pct}%;"></div>
                <span>${pct}%</span>
            </div>
        `;
    },

    renderMoat(stkcd) {
        const container = document.getElementById('rd-moat-section');
        if (!container) return;
        const moat = this.getMoat(stkcd);
        const data = RD_SCORES[stkcd];
        if (!data) { container.innerHTML = ''; return; }

        // Auto-detect Obsidian links
        let obsidianLinks = [];
        if (moat?.obsidian_links) {
            obsidianLinks = moat.obsidian_links;
        }

        let html = '<h4>🛡️ 技术护城河</h4>';
        if (moat) {
            const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
            html += `<div class="rd-moat-row"><span class="moat-label">门槛等级</span><span class="moat-stars">${stars(moat.barrier_level || 0)}</span></div>`;
            html += `<div class="rd-moat-row"><span class="moat-label">不可替代性</span><span class="moat-stars">${stars(moat.irreplaceability || 0)}</span></div>`;
            if (moat.chain_position) {
                html += `<div class="rd-moat-row"><span class="moat-label">产业链位置</span><span>${Utils.escapeHtml(moat.chain_position)}</span></div>`;
            }
            const evidenceLabels = { customer_validation: '客户验证', order_visibility: '订单可见', patent_search: '专利检索', competitive_landscape: '竞争格局', technology_roadmap: '技术路线图' };
            const evidenceHtml = Object.entries(evidenceLabels).map(([k, v]) =>
                `<span style="color:${moat.evidence?.[k] ? '#16a34a' : '#d1d5db'}">${moat.evidence?.[k] ? '☑' : '☐'}${v}</span>`
            ).join(' ');
            html += `<div class="rd-moat-row"><span class="moat-label">证据强度</span><span class="moat-evidence">${evidenceHtml}</span></div>`;
            if (moat.notes) {
                html += `<div class="rd-moat-notes">${Utils.escapeHtml(moat.notes)}</div>`;
            }
        } else {
            html += '<div style="color:var(--text-secondary);font-size:12px;padding:8px 0;">暂无护城河评级<br><small>点击下方按钮开始标注</small></div>';
        }

        // Obsidian links
        if (obsidianLinks.length > 0) {
            html += '<div style="margin-top:8px;">';
            obsidianLinks.forEach(link => {
                const encodedPath = encodeURIComponent(link.replace(/\.md$/, ''));
                html += `<a class="rd-moat-link" href="obsidian://open?vault=${this.OBSIDIAN_VAULT}&file=${encodedPath}" target="_blank">📝 ${Utils.escapeHtml(link)}</a><br>`;
            });
            html += '</div>';
        } else {
            html += '<div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">未关联 Obsidian 笔记</div>';
        }

        // Edit button
        html += `<button class="btn" style="margin-top:8px;font-size:11px;" onclick="MoatModule.openEditor('${stkcd}')">✏️ 编辑护城河评级</button>`;
        container.innerHTML = html;
    },

    openEditor(stkcd) {
        // Open a modal/drawer for editing (simplified: prompt-based)
        // Full implementation should use a proper modal component
        const existing = this.getMoat(stkcd);
        const barrier = prompt('门槛等级 (1-5):', existing?.barrier_level || '');
        if (barrier === null) return;
        const irreplace = prompt('不可替代性 (1-5):', existing?.irreplaceability || '');
        if (irreplace === null) return;
        const notes = prompt('研究笔记:', existing?.notes || '');
        if (notes === null) return;

        this.setMoat(stkcd, {
            barrier_level: parseInt(barrier) || 0,
            irreplaceability: parseInt(irreplace) || 0,
            evidence: existing?.evidence || {},
            chain_position: existing?.chain_position || '',
            obsidian_links: existing?.obsidian_links || [],
            notes: notes
        });
        this.renderMoat(stkcd);
        this.refreshCoverage();
    }
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => MoatModule.init());
```

- [ ] **Step 8: Create empty moat_notes.json**

Create `dashboard/data/moat_notes.json`:

```json
{
  "_description": "护城河评级数据 - 人工标注的技术护城河评价",
  "_schema": "barrier_level(1-5), irreplaceability(1-5), evidence(bool flags), chain_position, obsidian_links, notes",
  "entries": {}
}
```

- [ ] **Step 9: Commit**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && git add index.html css/style.css js/app.js js/rd.js js/moat.js data/moat_notes.json && git commit -m "feat: add R&D competitiveness module UI layout and stubs

Add nav tab, three-panel layout with weight sliders, bar
chart, radar, trend, heatmap, and moat note system."

```

---

### Task 3: Data Pipeline — Heatmap Enhancement

**Files:**
- Modify: `dashboard/preprocess.py` — 5.9 节，年-组级基准
- Modify: `dashboard/js/rd.js` — `renderHeatmap()` 函数

**Interfaces:**
- Consumes: Task 1 outputs (RD_SCORES, company_rd_metrics), 行业组映射
- Produces: `RD_HEATMAP_DATA` constant in dashboard_data.js

- [ ] **Step 1: Add yearly group benchmark computation in preprocess.py**

In `preprocess.py`, after section 5.8 (INDUSTRY_RD_BENCHMARK), add:

```python
# -- 5.9 R&D heatmap data generation --
print("生成 R&D 热力图数据...")
# 按 (年份, 行业组) 计算研发强度中位数
year_group_bench = {}
unique_years = sorted(df_raw['year'].unique())
for year in unique_years:
    yr_data = df_raw[df_raw['year'] == year].copy()
    # 合并行业组
    yr_data['rd_group'] = yr_data['stkcd'].map(stkcd_group)
    for g_name in yr_data['rd_group'].dropna().unique():
        if g_name is None: continue
        g_data = yr_data[yr_data['rd_group'] == g_name]
        valid = g_data[g_data['rd_expense'].notna() & (g_data['rd_expense'] > 0) & g_data['revenue'].notna() & (g_data['revenue'] > 0)]
        if len(valid) == 0: continue
        intensities = (valid['rd_expense'] / valid['revenue'] * 100).tolist()
        intensities.sort()
        n = len(intensities)
        key = f"{year}|{g_name}"
        year_group_bench[key] = {
            'year': int(year),
            'group': g_name,
            'n': n,
            'median': round(intensities[n//2], 2),
            'p25': round(intensities[n//4], 2) if n > 1 else None,
            'p75': round(intensities[3*n//4], 2) if n > 3 else None,
        }

RD_HEATMAP_DATA = list(year_group_bench.values())

# Append to serialization
with open(os.path.join(OUTPUT_DIR, 'dashboard_data.js'), 'a', encoding='utf-8') as f:
    f.write(f'\nconst RD_HEATMAP_DATA = {json.dumps(RD_HEATMAP_DATA, ensure_ascii=False)};\n')
```

- [ ] **Step 2: Update renderHeatmap() in rd.js**

Replace the `renderHeatmap()` method in `js/rd.js`:

```javascript
renderHeatmap() {
    if (!this.heatmapChart) {
        this.heatmapChart = echarts.init(document.getElementById('rd-heatmap-chart'), Utils.getTheme());
    }
    if (typeof RD_HEATMAP_DATA === 'undefined') {
        console.warn('热力图数据未加载');
        return;
    }
    const groupsToShow = this.activeGroup === 'all'
        ? Object.keys(RD_INDUSTRY_GROUPS)
        : [this.activeGroup];
    const groupNames = groupsToShow.map(g => RD_INDUSTRY_GROUPS[g]?.name || g);
    const years = [...new Set(RD_HEATMAP_DATA.map(d => d.year))].sort();
    const heatData = [];
    let maxVal = 0;
    for (const d of RD_HEATMAP_DATA) {
        if (!groupsToShow.includes(d.group)) continue;
        heatData.push([d.year, d.group, d.median]);
        if (d.median > maxVal) maxVal = d.median;
    }
    this.heatmapChart.setOption({
        tooltip: {
            position: 'top',
            formatter: (params) => {
                const d = RD_HEATMAP_DATA.find(x => x.year === params.value[0] && x.group === params.value[1]);
                return `${RD_INDUSTRY_GROUPS[d.group]?.name || d.group} ${d.year}<br/>研发强度中位数: ${d.median}%<br/>样本: ${d.n} 家公司`;
            }
        },
        grid: { left: '14%', right: '5%', top: '5%', bottom: '14%' },
        xAxis: { type: 'category', data: years, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
        yAxis: {
            type: 'category',
            data: groupNames,
            splitArea: { show: true },
            axisLabel: { fontSize: 11 }
        },
        visualMap: {
            min: 0,
            max: maxVal || 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '0%',
            inRange: { color: ['#f0f9ff', '#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7'] }
        },
        series: [{
            type: 'heatmap',
            data: heatData,
            label: { show: true, fontSize: 10 },
            emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
        }]
    });
},
```

- [ ] **Step 3: Run pipeline and verify**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && python preprocess.py 2>&1 | grep "R&D"
```
Expected: `生成 R&D 热力图数据...` 和 `RD_HEATMAP_DATA` 数组长度 > 0。

- [ ] **Step 4: Commit**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && git add preprocess.py js/rd.js dashboard_data.js && git commit -m "feat: add R&D heatmap yearly industry group data"
```

---

### Task 4: Polish — Score Trend History & Edge Cases

**Files:**
- Modify: `dashboard/js/rd.js` — score history calculation, edge case handling, empty states
- Modify: `dashboard/js/moat.js` — edit modal, batch import

**Interfaces:**
- Consumes: `RD_SCORES`, `RD_HISTORY`
- Produces: Complete rendering logic for all panels with error/empty states

- [ ] **Step 1: Add score history computation in rd.js**

In `RDModule`, replace the `showDetail()` method to include score history and add a new method:

```javascript
showDetail(stkcd) {
    this.selectedStkcd = stkcd;
    const data = RD_SCORES[stkcd];
    if (!data) return;
    document.getElementById('rd-detail-title').textContent = `${data.name} (${stkcd})`;
    this.renderRadar(stkcd);
    this.renderTrend(stkcd);
    this.renderScoreHistory(stkcd);
    if (typeof MoatModule !== 'undefined') MoatModule.renderMoat(stkcd);
},

computeHistoryScores(stkcd) {
    // 用默认权重计算历史评分
    const history = RD_HISTORY[stkcd];
    if (!history || history.length < 1) return [];
    // 简化：用年度研发强度作为代理评分
    return history.map(h => ({
        year: h.year,
        rd_intensity: h.rd_intensity,
        rd_expense: h.rd_expense
    }));
},

renderScoreHistory(stkcd) {
    // Render a mini table showing year-by-year scores
    const histScores = this.computeHistoryScores(stkcd);
    // Show last 5 years of data
    const recent = histScores.slice(-5);
    // Update trend chart to show both intensity and expense
},
```

- [ ] **Step 2: Add empty state handling**

```javascript
// In rd.js, add after init():
_checkDataAvailability() {
    const total = Object.values(RD_SCORES).filter(r => r.rd_applicable).length;
    if (total === 0) {
        document.getElementById('rd-bar-chart').innerHTML =
            '<div style="text-align:center;padding:40px;color:var(--text-secondary);">暂无研发数据</div>';
        return false;
    }
    const current = Object.values(RD_SCORES).filter(r => r.rd_applicable && r.year === this.activeYear).length;
    if (current === 0) {
        document.getElementById('rd-bar-chart').innerHTML =
            `<div style="text-align:center;padding:40px;color:var(--text-secondary);">${this.activeYear} 年暂无数据，请切换年份</div>`;
        return false;
    }
    return true;
},
```

Update `renderBarChart()` to call `_checkDataAvailability()` first.

- [ ] **Step 3: Add flag display in bar chart**

Update `getBarOption()` to include flag markers in tooltip:

```javascript
tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params) => {
        const data = this.getFilteredCompanies();
        const idx = data.length - 1 - params[0].dataIndex;
        const item = data[idx];
        if (!item) return '';
        let html = `<strong>${item.name}</strong> (${item.stkcd || ''})<br/>`;
        html += `综合评分: ${item.weightedScore}<br/>`;
        for (const [dim, val] of Object.entries(item.dimensions)) {
            if (val != null) html += `  ${dim}: ${val}<br/>`;
        }
        if (item.flags.length > 0) {
            html += `<br/>⚠️ 排雷标记: ${item.flags.join(', ')}`;
        }
        // Moat badge
        if (typeof MoatModule !== 'undefined' && MoatModule.hasNotes(item.stkcd)) {
            const moat = MoatModule.getMoat(item.stkcd);
            if (moat.barrier_level >= 4 && moat.irreplaceability >= 4) html += '<br/>🛡️ 深护城河';
            else if (moat.barrier_level >= 3 || moat.irreplaceability >= 3) html += '<br/>🔒 有壁垒';
        }
        return html;
    }
}
```

- [ ] **Step 4: Add window resize handler**

```javascript
// At bottom of rd.js:
window.addEventListener('resize', () => {
    if (RDModule.initialized) RDModule.resize();
});
```

- [ ] **Step 5: Commit**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && git add js/rd.js && git commit -m "feat: add score history, edge cases, and resize for R&D module"
```

---

### Task 5: End-to-End Integration & Verification

**Files:**
- Verify: `dashboard/dashboard_data.js` — 确认所有常量存在
- Verify: `dashboard/index.html` — 确认 HTML 结构正确，script 加载顺序
- Verify: `dashboard/js/app.js` — 路由 switch case 包含 'rd'
- Modify: `dashboard/js/rd.js` — 最终调整
- Modify: `dashboard/js/moat.js` — 最终调整

**Interfaces:**
- Everything wired together from Tasks 1-4

- [ ] **Step 1: Run full pipeline and start dev server**

```bash
cd "E:/A股上市公司财务数据合集/dashboard"
python preprocess.py
# Start any local HTTP server
python -m http.server 8080
```

- [ ] **Step 2: Manual E2E verification checklist**

Open `http://localhost:8080` and verify:
1. `#rd` nav tab is visible and clickable
2. Tab switches to R&D panel with 3-panel layout
3. Left panel: 5 industry group buttons + 7 weight sliders + year dropdown
4. Middle panel: Bar chart renders with companies sorted by score
5. Click a bar → Right panel shows radar + trend + moat section
6. Change group → Bar chart and heatmap refresh
7. Adjust weight slider → Scores recalculate, bar chart reorders
8. Switch year → All data updates
9. Bottom heatmap renders with groups × years grid
10. Moat edit button opens prompts and saves to localStorage
11. Coverage percentage updates in left panel

- [ ] **Step 3: Check console for errors**

```bash
# Open browser DevTools, filter by "RDModule\|MoatModule\|rd-"
# Expected: No errors. Only info messages on first load.
```

- [ ] **Step 4: Verify data pipeline output**

```bash
cd "E:/A股上市公司财务数据合集/dashboard"
grep -c "RD_SCORES\|RD_HISTORY\|RD_HEATMAP_DATA\|INDUSTRY_RD_BENCHMARK" dashboard_data.js
```
Expected: Each constant appears exactly once (or twice if in pre-existing data).

Check file size: `RD_SCORES` 条目数 > 3000, `RD_HISTORY` 条目数 > 3000.

- [ ] **Step 5: Fix any issues and commit**

```bash
cd "E:/A股上市公司财务数据合集/dashboard" && git add -A && git commit -m "chore: finalize R&D competitiveness module integration

- Ensure all data pipeline outputs are correct
- Fix any rendering edge cases
- Verify tab routing and lazy init" 
```

---
