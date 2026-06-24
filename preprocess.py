# -*- coding: utf-8 -*-
"""
A股财务数据预处理脚本
将 8 个 CSV 文件清洗并融合成一个前端直接调用的 dashboard_data.js
"""
import pandas as pd
import json
import numpy as np
import os

# 定义路径 — 优先使用仓库内 data/ 目录（兼容 GitHub Actions），回退到本地路径
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_DATA_DIR = os.path.join(SCRIPT_DIR, "data")
_LOCAL_DATA_DIR = r"e:\A股上市公司财务数据合集"

# 如果仓库内 data/ 有 screening_results.csv 则使用它，否则用本地路径
if os.path.isfile(os.path.join(_REPO_DATA_DIR, "screening_results.csv")):
    WORKSPACE_DIR = _REPO_DATA_DIR
else:
    WORKSPACE_DIR = _LOCAL_DATA_DIR

OUTPUT_DIR = SCRIPT_DIR
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 辅助函数：替换 NaN 为 None (JSON 里的 null) 并进行精度控制
def clean_df(df):
    df = df.copy()
    # 填充 NaN 为 None
    return df.replace({np.nan: None})

def to_dict_list(df):
    # 将 DataFrame 转换为 dict 列表，并处理 float 精度
    df_clean = clean_df(df)
    records = df_clean.to_dict(orient='records')
    # 递归限制 float 精度为两位小数
    return limit_precision(records)

def limit_precision(obj):
    if isinstance(obj, float):
        return round(obj, 4) if not np.isnan(obj) else None
    elif isinstance(obj, dict):
        return {k: limit_precision(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [limit_precision(x) for x in obj]
    return obj

def main():
    print("开始预处理 A 股财务数据...")

    # 1. 读取各小文件并转换
    print("读取行业与危机分析数据...")
    
    # 行业细分分析
    df_ind_analysis = pd.read_csv(os.path.join(WORKSPACE_DIR, "industry_analysis.csv"), encoding='utf-8-sig')
    ind_analysis_json = to_dict_list(df_ind_analysis)
    
    # 行业大类汇总
    df_ind_summary = pd.read_csv(os.path.join(WORKSPACE_DIR, "industry_summary_report.csv"), encoding='utf-8-sig')
    ind_summary_json = to_dict_list(df_ind_summary)
    
    # 危机期间板块分析
    df_crisis_sector = pd.read_csv(os.path.join(WORKSPACE_DIR, "crisis_sector_analysis.csv"), encoding='utf-8-sig')
    crisis_sector_json = to_dict_list(df_crisis_sector)
    
    # 板块韧性排名
    df_crisis_resilience = pd.read_csv(os.path.join(WORKSPACE_DIR, "crisis_resilience_ranking.csv"), encoding='utf-8-sig')
    crisis_resilience_json = to_dict_list(df_crisis_resilience)
    
    # 58个危机穿越者
    df_crisis_survivors = pd.read_csv(os.path.join(WORKSPACE_DIR, "crisis_survivors.csv"), encoding='utf-8-sig')
    crisis_survivors_json = to_dict_list(df_crisis_survivors)
    
    # 危机韧性公司（1060家）
    df_crisis_companies = pd.read_csv(os.path.join(WORKSPACE_DIR, "crisis_during_companies.csv"), encoding='utf-8-sig')
    crisis_companies_json = to_dict_list(df_crisis_companies)
    
    # 2. 核心大文件：screening_results.csv (约 24MB)
    print("读取主数据 screening_results.csv ...")
    df_screen = pd.read_csv(os.path.join(WORKSPACE_DIR, "screening_results.csv"), encoding='utf-8-sig')
    
    # 数据总览 KPI 数据计算
    total_companies = int(df_screen['Stkcd'].nunique())
    latest_year = int(df_screen['Year'].max())
    df_latest = df_screen[df_screen['Year'] == latest_year]
    
    # M-Score 均值进行 clip 限制，避免极端噪声干扰整体平均
    avg_mscore_latest = float(df_latest['M_Score'].clip(-10, 10).mean())
    risk_level_counts = df_latest['风险等级'].value_counts().to_dict()
    total_latest_companies = len(df_latest)
    
    # 重新映射风险等级计数
    risk_summary = {
        "total_companies": total_companies,
        "latest_year": latest_year,
        "latest_companies": total_latest_companies,
        "avg_mscore_latest": round(avg_mscore_latest, 4),
        "risk_levels": {k: int(v) for k, v in risk_level_counts.items()}
    }
    
    # 年度趋势计算 (M-Score 均值 & 高风险公司比例)
    print("计算年度趋势指标...")
    annual_stats = []
    years = sorted(df_screen['Year'].unique())
    for y in years:
        df_y = df_screen[df_screen['Year'] == y]
        total_y = len(df_y)
        # 高风险/极高风险定义：风险等级为 '高风险' 或 '极高风险' 或 综合风险评分 > 60
        high_risk_count = len(df_y[df_y['风险等级'].isin(['高风险', '极高风险'])])
        avg_m = df_y['M_Score'].clip(-10, 10).mean()
        annual_stats.append({
            "year": int(y),
            "total_companies": total_y,
            "avg_mscore": round(float(avg_m), 4) if not np.isnan(avg_m) else None,
            "high_risk_count": high_risk_count,
            "high_risk_ratio": round(high_risk_count / total_y, 4) if total_y > 0 else 0
        })

    # 3. 压缩并聚合个股历史数据
    print("处理个股历史信息并压缩...")
    # 按照代码和年份排序
    df_screen_sorted = df_screen.sort_values(['Stkcd', 'Year'])
    
    # 构建个股历史字典
    company_history = {}
    
    # 我们仅保留分析需要的字段，并且进行精度舍入以压缩体积
    for stkcd, group in df_screen_sorted.groupby('Stkcd'):
        # 取最新一条记录的名称和行业
        latest_rec = group.iloc[-1]
        name = str(latest_rec['ShortName'])
        indcd = str(latest_rec['Indcd'])
        indnme = str(latest_rec['Indnme'])
        
        # 提取历史年份列表
        history_list = []
        for _, row in group.iterrows():
            # 列定义: [Year, M_Score, DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA, 综合风险评分, 风险等级, 营业收入_亿, 净利润_亿, 总资产_亿]
            # 营业收入, 净利润, 总资产 以亿元为单位存储
            rev = row['营业收入'] / 1e8 if pd.notna(row['营业收入']) else None
            np_val = row['净利润'] / 1e8 if pd.notna(row['净利润']) else None
            ta = row['总资产'] / 1e8 if pd.notna(row['总资产']) else None
            
            history_list.append([
                int(row['Year']),
                round(float(row['M_Score']), 3) if pd.notna(row['M_Score']) else None,
                round(float(row['DSRI']), 3) if pd.notna(row['DSRI']) else None,
                round(float(row['GMI']), 3) if pd.notna(row['GMI']) else None,
                round(float(row['AQI']), 3) if pd.notna(row['AQI']) else None,
                round(float(row['SGI']), 3) if pd.notna(row['SGI']) else None,
                round(float(row['DEPI']), 3) if pd.notna(row['DEPI']) else None,
                round(float(row['SGAI']), 3) if pd.notna(row['SGAI']) else None,
                round(float(row['LVGI']), 3) if pd.notna(row['LVGI']) else None,
                round(float(row['TATA']), 3) if pd.notna(row['TATA']) else None,
                round(float(row['综合风险评分']), 1) if pd.notna(row['综合风险评分']) else None,
                str(row['风险等级']) if pd.notna(row['风险等级']) else "低风险",
                round(float(rev), 2) if rev is not None else None,
                round(float(np_val), 2) if np_val is not None else None,
                round(float(ta), 2) if ta is not None else None
            ])
            
        company_history[str(stkcd).zfill(6)] = {
            "name": name,
            "indcd": indcd,
            "indnme": indnme,
            "history": history_list
        }

    # 4. 行业雷达和相关性矩阵需要 8个因子 在行业和整体层面的均值/中位数
    print("计算因子行业均值以用于因子分析页面...")
    factor_columns = ['DSRI', 'GMI', 'AQI', 'SGI', 'DEPI', 'SGAI', 'LVGI', 'TATA']
    
    # 不同的因子需要不同的 clip 范围，防止极端分母异常噪声干扰均值计算
    clip_ranges = {
        'DSRI': (0.0, 10.0),
        'GMI': (-10.0, 10.0),
        'AQI': (0.0, 10.0),
        'SGI': (0.0, 10.0),
        'DEPI': (0.0, 10.0),
        'SGAI': (0.0, 10.0),
        'LVGI': (0.0, 10.0),
        'TATA': (-2.0, 2.0)
    }
    
    # 行业因子的平均值
    industry_factors = {}
    for indcd, group in df_screen.groupby('Indcd'):
        indnme = group.iloc[0]['Indnme']
        means = {}
        for col in factor_columns:
            low, high = clip_ranges[col]
            val = group[col].clip(low, high).mean()
            means[col] = round(float(val), 4) if pd.notna(val) else None
        industry_factors[str(indcd)] = {
            "name": str(indnme),
            "means": means
        }
        
    # 8个因子之间的互相关系数矩阵 (8x8)
    print("计算因子互相关矩阵...")
    df_clipped = df_screen[factor_columns].copy()
    for col in factor_columns:
        low, high = clip_ranges[col]
        df_clipped[col] = df_clipped[col].clip(low, high)
        
    corr_matrix = df_clipped.corr().values.tolist()
    corr_matrix_json = limit_precision(corr_matrix)

    # 4.5 计算最新年度商誉与其他应收款占比的Top 50异常排行
    print("计算2024年商誉与应收款异常排查名单...")
    df_latest_year = df_screen[df_screen['Year'] == latest_year]
    df_latest_filled = df_latest_year.copy()
    df_latest_filled['商誉占比'] = df_latest_filled['商誉占比'].fillna(0.0)
    df_latest_filled['其他应收款占比'] = df_latest_filled['其他应收款占比'].fillna(0.0)
    
    # 按商誉占比降序
    df_goodwill_top = df_latest_filled.sort_values('商誉占比', ascending=False).head(50)
    goodwill_anomalies = []
    for _, row in df_goodwill_top.iterrows():
        goodwill_anomalies.append({
            "stkcd": str(row['Stkcd']).zfill(6),
            "name": str(row['ShortName']),
            "goodwill_ratio": round(float(row['商誉占比']), 4),
            "other_receivables_ratio": round(float(row['其他应收款占比']), 4)
        })

    # ==========================================
    # 行业对标 (Industry Benchmarking) 数据管线
    # ==========================================
    print("计算行业对标数据...")

    L1_NAMES = {
        'A': '农、林、牧、渔业', 'B': '采矿业', 'C': '制造业',
        'D': '电力、热力、燃气及水生产和供应业', 'E': '建筑业',
        'F': '批发和零售业', 'G': '交通运输、仓储和邮政业',
        'H': '住宿和餐饮业', 'I': '信息传输、软件和信息技术服务业',
        'J': '金融业', 'K': '房地产业', 'L': '租赁和商务服务业',
        'M': '科学研究和技术服务业', 'N': '水利、环境和公共设施管理业',
        'O': '居民服务、修理和其他服务业', 'P': '教育',
        'Q': '卫生和社会工作', 'R': '文化、体育和娱乐业', 'S': '综合'
    }

    # -- 5.1 行业层级映射 --
    # 申万分类名 → CSRC 门类前缀关键词规则（数字编码 Indcd 无字母前缀，需靠 Indnme 推断）
    _SW_L1_RULES = [
        (['银行','证券','保险','金融'], 'J'),
        (['房地产','房产'], 'K'),
        (['软件开发','IT服务','通信服务','互联网电商','游戏','数字媒体','电视广播'], 'I'),
        (['电力','电网'], 'D'),
        (['燃气','供水'], 'D'),
        (['煤炭开采','油气开采','油服工程','炼化','石油','焦炭'], 'B'),
        (['种植业','渔业','林业','饲料','养殖业','动物保健','农业综合','农产品加工'], 'A'),
        (['航空机场','铁路公路','航运港口','物流'], 'G'),
        (['一般零售','贸易','专业连锁','汽车服务'], 'F'),
        (['酒店餐饮','旅游'], 'H'),
        (['基础建设','房屋建设','专业工程','装修装饰'], 'E'),
        (['教育'], 'P'),
        (['出版','广告','影视','体育'], 'R'),
        (['环境治理','环保设备'], 'N'),
        (['工程咨询服务','专业服务'], 'M'),
        (['综合'], 'S'),
        (['医疗服务'], 'Q'),
        (['生物制品','医药','中药','化学制药','医疗器械'], 'C'),
    ]
    def _classify_l1(indnme):
        """用关键词匹配从申万行业名推断 CSRC 门类，默认归制造业 C"""
        for keywords, l1 in _SW_L1_RULES:
            for kw in keywords:
                if kw in indnme:
                    return l1
        return 'C'

    # 预建数字编码 → (L1前缀, Indnme) 映射
    _digital_l1_map = {}
    _digital_codes = df_screen[df_screen['Indcd'].astype(str).str.match(r'^\d+$')][['Indcd','Indnme']].drop_duplicates()
    for _, row in _digital_codes.iterrows():
        _digital_l1_map[str(row['Indcd'])] = _classify_l1(str(row['Indnme']))

    unique_indcd = df_screen[['Indcd', 'Indnme']].drop_duplicates()
    industry_hierarchy = {}
    for _, row in unique_indcd.iterrows():
        if pd.isna(row['Indcd']):
            continue
        indcd = str(row['Indcd'])
        indnme = str(row['Indnme'])
        # 数字编码用映射推断 L1，字母编码取首字母
        if indcd in _digital_l1_map:
            l1 = _digital_l1_map[indcd]
        else:
            l1 = indcd[0]
        if l1 not in industry_hierarchy:
            industry_hierarchy[l1] = {
                'name': L1_NAMES.get(l1, '未知行业'),
                'level2': {}
            }
        industry_hierarchy[l1]['level2'][indcd] = indnme

    # -- 5.2 公司级指标 --
    def _calc_cagr(group, col, latest_year, years_back_target=3):
        """复合年增长率，3年 → 2年 → 1年降级；两端须同号且非零"""
        late_row = group[group['Year'] == latest_year]
        if len(late_row) == 0:
            return None
        late_val = late_row[col].values[0]
        if pd.isna(late_val):
            return None
        for yb in range(years_back_target, 0, -1):
            target_year = latest_year - yb
            early_row = group[group['Year'] == target_year]
            if len(early_row) == 0:
                continue
            early_val = early_row[col].values[0]
            if pd.isna(early_val) or early_val == 0:
                continue
            if late_val / early_val <= 0:
                continue
            return float((late_val / early_val) ** (1.0 / yb) - 1) * 100
        return None

    company_metrics = {}
    for stkcd, group in df_screen_sorted.groupby('Stkcd'):
        group = group.sort_values('Year')
        latest = group.iloc[-1]
        latest_year = int(latest['Year'])
        code = str(stkcd).zfill(6)
        # 处理行业代码：NaN → "000" 占位
        if pd.isna(latest['Indcd']):
            indcd = '000'
            ind1 = '?'
        else:
            indcd = str(latest['Indcd'])
            # 数字编码用映射推断 L1，字母编码取首字母
            if indcd in _digital_l1_map:
                ind1 = _digital_l1_map[indcd]
            else:
                ind1 = indcd[0] if len(indcd) > 0 else '?'
        name = str(latest['ShortName'])

        rev = latest['营业收入']
        np_val = latest['净利润']
        ta = latest['总资产']

        # ROA / ROE proxy
        if pd.notna(ta) and ta != 0 and pd.notna(np_val):
            roa = float(np_val / ta * 100)
        else:
            roa = None
        roe = roa  # ROE 以 ROA 代替（缺少净资产字段）

        # 资产周转率
        if pd.notna(ta) and ta != 0 and pd.notna(rev):
            asset_turnover = float(rev / ta)
        else:
            asset_turnover = None

        # CAGR
        revenue_cagr3 = _calc_cagr(group, '营业收入', latest_year, 3)
        profit_cagr3 = _calc_cagr(group, '净利润', latest_year, 3)
        asset_growth = _calc_cagr(group, '总资产', latest_year, 3)

        # M-Score & 风险等级
        mscore = round(float(latest['M_Score']), 3) if pd.notna(latest['M_Score']) else None
        restated = int(latest['IfCorrect']) if pd.notna(latest['IfCorrect']) else 0
        risk_level = str(latest['风险等级']) if pd.notna(latest['风险等级']) else '低风险'

        # 营收/总资产 → 亿元
        rev_b = round(float(rev / 1e8), 2) if pd.notna(rev) else None
        ta_b = round(float(ta / 1e8), 2) if pd.notna(ta) else None

        company_metrics[code] = {
            'roe': round(roe, 2) if roe is not None else None,
            'roa': round(roa, 2) if roa is not None else None,
            'asset_turnover': round(asset_turnover, 4) if asset_turnover is not None else None,
            'revenue_cagr3': round(revenue_cagr3, 2) if revenue_cagr3 is not None else None,
            'profit_cagr3': round(profit_cagr3, 2) if profit_cagr3 is not None else None,
            'asset_growth': round(asset_growth, 2) if asset_growth is not None else None,
            'mscore': mscore,
            'restated': restated,
            'risk_level': risk_level,
            'revenue': rev_b,
            'total_assets': ta_b,
            'ind1': ind1,
            'ind2': indcd,
            'name': name
        }

    print(f"  计算完成 {len(company_metrics)} 家公司指标")

    # -- 5.3 L2 行业同业基准 --
    # 按 L2 行业对公司分组
    industry_l2_groups = {}
    for code, cm in company_metrics.items():
        ind2 = cm['ind2']
        industry_l2_groups.setdefault(ind2, []).append(code)

    METRIC_COLS = [
        'roe', 'roa', 'asset_turnover',
        'revenue_cagr3', 'profit_cagr3', 'asset_growth',
        'mscore', 'revenue', 'total_assets'
    ]

    l2_benchmark = {}
    for ind2, codes in industry_l2_groups.items():
        # 数字编码用映射推断 L1，字母编码取首字母
        if ind2 in _digital_l1_map:
            ind1_key = _digital_l1_map[ind2]
        else:
            ind1_key = ind2[0] if len(ind2) > 0 else '?'
        ind2_name = (
            industry_hierarchy.get(ind1_key, {}).get('level2', {}).get(ind2, ind2)
        )

        # 收集各指标有效值
        metric_values = {m: [] for m in METRIC_COLS}
        for code in codes:
            for m in METRIC_COLS:
                v = company_metrics[code].get(m)
                if v is not None:
                    metric_values[m].append(v)

        percentiles = {}
        medians = {}
        for m in METRIC_COLS:
            vals = metric_values[m]
            if len(vals) >= 2:
                arr = np.array(vals, dtype=np.float64)
                p = {
                    'p10': round(float(np.percentile(arr, 10)), 4),
                    'p25': round(float(np.percentile(arr, 25)), 4),
                    'p50': round(float(np.percentile(arr, 50)), 4),
                    'p75': round(float(np.percentile(arr, 75)), 4),
                    'p90': round(float(np.percentile(arr, 90)), 4),
                }
            elif len(vals) == 1:
                v = float(vals[0])
                p = {'p10': v, 'p25': v, 'p50': v, 'p75': v, 'p90': v}
            else:
                p = {'p10': None, 'p25': None, 'p50': None, 'p75': None, 'p90': None}
            percentiles[m] = p
            medians[m] = p['p50']

        # Top5 与 CR5
        sorted_by_rev = sorted(
            codes,
            key=lambda c: company_metrics[c].get('revenue') or 0.0,
            reverse=True
        )
        top5 = sorted_by_rev[:5]
        total_rev = sum(company_metrics[c].get('revenue') or 0.0 for c in codes)
        top5_rev = sum(company_metrics[c].get('revenue') or 0.0 for c in top5)
        cr5 = round(top5_rev / total_rev * 100, 2) if total_rev > 0 else None

        l2_benchmark[ind2] = {
            'name': ind2_name,
            'ind1': ind1_key,
            'sample_size': len(codes),
            'companies': codes,
            'percentiles': percentiles,
            'medians': medians,
            'top5': top5,
            'concentration_cr5': cr5,
        }

    print(f"  计算完成 {len(l2_benchmark)} 个二级行业基准")

    # -- 5.4 公司同行百分位 --
    company_percentiles = {}
    DIM_GROUPS = {
        'profit':  ('roe', 'roa', 'asset_turnover'),
        'growth':  ('revenue_cagr3', 'profit_cagr3', 'asset_growth'),
        'risk':    ('mscore',),
        'scale':   ('revenue', 'total_assets'),
    }
    DIM_WEIGHTS = {'profit': 0.25, 'growth': 0.20, 'risk': 0.20, 'scale': 0.15}

    for code, cm in company_metrics.items():
        ind2 = cm['ind2']
        l2_codes = industry_l2_groups.get(ind2, [])

        percentiles = {}
        ranks = {}

        for m in METRIC_COLS:
            my_val = cm.get(m)
            if my_val is None or len(l2_codes) <= 1:
                percentiles[m] = None
                ranks[m] = None
                continue

            all_vals = [company_metrics[c][m]
                        for c in l2_codes
                        if company_metrics[c].get(m) is not None]

            if len(all_vals) <= 1:
                percentiles[m] = None
                ranks[m] = None
                continue

            if m == 'mscore':
                # 越低越好 → 百分位 = 比我高(差)的占比
                higher = sum(1 for v in all_vals if v > my_val)
                pct = round(higher / len(all_vals) * 100, 2)
                rank = sorted(all_vals).index(my_val) + 1
            else:
                lower = sum(1 for v in all_vals if v < my_val)
                pct = round(lower / len(all_vals) * 100, 2)
                rank = sorted(all_vals, reverse=True).index(my_val) + 1

            percentiles[m] = pct
            ranks[m] = f"{rank}/{len(all_vals)}"

        # 维度百分位
        dim_pct = {}
        for dim, keys in DIM_GROUPS.items():
            vals = [percentiles.get(k) for k in keys if percentiles.get(k) is not None]
            dim_pct[dim] = round(sum(vals) / len(vals), 2) if vals else None

        # 加权综合分
        valid = [(dim_pct[d], DIM_WEIGHTS[d]) for d in DIM_GROUPS if dim_pct[d] is not None]
        if valid:
            total_w = sum(w for _, w in valid)
            composite = round(sum(p * w / total_w for p, w in valid), 2)
        else:
            composite = None

        company_percentiles[code] = {
            'ind2': ind2,
            'percentiles': percentiles,
            'ranks': ranks,
            'composite': composite,
        }

    # NaN → None 递归清理
    def _sanitize(obj):
        if isinstance(obj, float):
            return None if (np.isnan(obj) or np.isinf(obj)) else obj
        if isinstance(obj, dict):
            return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize(x) for x in obj]
        return obj

    company_percentiles = _sanitize(company_percentiles)

    print(f"  计算完成 {len(company_percentiles)} 家公司百分位")

    # -- 5.5 L1 行业基准（从 L2 加权聚合） --
    l1_groups_map = {}
    for ind2, bench in l2_benchmark.items():
        l1 = bench['ind1']
        l1_groups_map.setdefault(l1, []).append(ind2)

    l1_benchmark = {}
    for l1, l2_list in l1_groups_map.items():
        l1_name = industry_hierarchy.get(l1, {}).get('name', '未知行业')

        percentiles = {}
        medians = {}
        for m in METRIC_COLS:
            weighted = {'p10': 0.0, 'p25': 0.0, 'p50': 0.0, 'p75': 0.0, 'p90': 0.0}
            total_w = 0.0
            for ind2 in l2_list:
                bench = l2_benchmark[ind2]
                w = bench['sample_size']
                if bench['percentiles'][m]['p50'] is not None:
                    total_w += w
                    for pk in ('p10', 'p25', 'p50', 'p75', 'p90'):
                        weighted[pk] += bench['percentiles'][m][pk] * w
            if total_w > 0:
                p = {k: round(weighted[k] / total_w, 4) for k in weighted}
            else:
                p = {k: None for k in weighted}
            percentiles[m] = p
            medians[m] = p['p50']

        # L1 Top5 & CR5
        all_l1_codes = []
        for ind2 in l2_list:
            all_l1_codes.extend(l2_benchmark[ind2]['companies'])
        sorted_l1 = sorted(
            all_l1_codes,
            key=lambda c: company_metrics[c].get('revenue') or 0.0,
            reverse=True
        )
        l1_top5 = sorted_l1[:5]
        l1_total_rev = sum(company_metrics[c].get('revenue') or 0.0 for c in all_l1_codes)
        l1_top5_rev = sum(company_metrics[c].get('revenue') or 0.0 for c in l1_top5)
        l1_cr5 = round(l1_top5_rev / l1_total_rev * 100, 2) if l1_total_rev > 0 else None

        l1_benchmark[l1] = {
            'name': l1_name,
            'sample_size': sum(l2_benchmark[i]['sample_size'] for i in l2_list),
            'percentiles': percentiles,
            'medians': medians,
            'top5': l1_top5,
            'concentration_cr5': l1_cr5,
        }

    print(f"  计算完成 {len(l1_benchmark)} 个一级行业基准")

    # 5. 输出合并后的 JS 文件
    output_js_path = os.path.join(OUTPUT_DIR, "dashboard_data.js")
    print(f"写入整合后的数据至 {output_js_path}...")
    
    with open(output_js_path, 'w', encoding='utf-8') as f:
        f.write("/**\n * A股财务数据全景仪表盘 - 静态数据库\n * 此文件由 preprocess.py 自动生成，请勿手动修改\n */\n\n")
        f.write(f"const SCREENING_SUMMARY = {json.dumps(risk_summary, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const ANNUAL_TRENDS = {json.dumps(annual_stats, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const INDUSTRY_ANALYSIS = {json.dumps(ind_analysis_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const INDUSTRY_SUMMARY = {json.dumps(ind_summary_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const CRISIS_SECTOR_ANALYSIS = {json.dumps(crisis_sector_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const CRISIS_RESILIENCE_RANKING = {json.dumps(crisis_resilience_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const CRISIS_SURVIVORS = {json.dumps(crisis_survivors_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const CRISIS_COMPANIES = {json.dumps(crisis_companies_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const INDUSTRY_FACTORS = {json.dumps(industry_factors, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const FACTOR_CORRELATION = {json.dumps(corr_matrix_json, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const GOODWILL_ANOMALIES = {json.dumps(goodwill_anomalies, ensure_ascii=False, indent=2)};\n\n")
        f.write(f"const INDUSTRY_HIERARCHY = {json.dumps(industry_hierarchy, ensure_ascii=False)};\n\n")
        f.write(f"const INDUSTRY_L1_BENCHMARK = {json.dumps(l1_benchmark, ensure_ascii=False)};\n\n")
        f.write(f"const INDUSTRY_L2_BENCHMARK = {json.dumps(l2_benchmark, ensure_ascii=False)};\n\n")
        f.write(f"const COMPANY_METRICS = {json.dumps(company_metrics, ensure_ascii=False)};\n\n")
        f.write(f"const COMPANY_PERCENTILES = {json.dumps(company_percentiles, ensure_ascii=False)};\n\n")
        f.write(f"const COMPANY_HISTORY = {json.dumps(company_history, ensure_ascii=False)};\n")
        
    print("数据预处理全部完成！")

if __name__ == "__main__":
    main()
