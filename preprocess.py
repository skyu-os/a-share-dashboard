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
        f.write(f"const COMPANY_HISTORY = {json.dumps(company_history, ensure_ascii=False)};\n")
        
    print("数据预处理全部完成！")

if __name__ == "__main__":
    main()
