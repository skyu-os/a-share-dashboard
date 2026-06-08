# -*- coding: utf-8 -*-
"""
A股财务数据全景仪表盘 - 盘后自动化更新脚本
============================================
功能：
  1. 从东方财富数据中心拉取最新年报财务数据（资产负债表 / 利润表 / 现金流量表）
  2. 计算 Beneish M-Score 8 因子及综合风险评分
  3. 增量合并到 screening_results.csv，重新生成 dashboard_data.js
  4. 自动 Git push 触发 Vercel 部署

注意事项：
  - 仅在 A 股收盘（15:00）后运行，避免无意义更新
  - 每次 API 请求间隔 2~4 秒，防止触发反爬限制
  - 若当天无新增年报披露，脚本自动跳过
"""

import os, sys, json, time, random, logging, subprocess
from datetime import datetime, timedelta
from collections import OrderedDict
import requests
import pandas as pd
import numpy as np

# ============================================================
# 配置
# ============================================================
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))   # dashboard/
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)                   # A股上市公司财务数据合集/
CSV_PATH    = os.path.join(PROJECT_DIR, "screening_results.csv")
JS_OUTPUT   = os.path.join(SCRIPT_DIR, "dashboard_data.js")

# 东方财富 API
EM_BASE     = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
EM_REPORTS  = {
    "balance":  ("RPT_DMSK_FN_BALANCE", "TOTAL_ASSETS"),
    "income":   ("RPT_DMSK_FN_INCOME",  "PARENT_NETPROFIT"),
    "cashflow": ("RPT_DMSK_FN_CASHFLOW", "NETCASH_OPERATE"),
}
EM_HEADERS  = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://emweb.securities.eastmoney.com/",
}

# 拉取的历史年报年份范围（增量模式只拉最新一年）
FULL_YEARS_BACK  = 5    # 全量模式回看 5 年
PAGE_SIZE        = 500   # 每页记录数（最大 500）
REQUEST_DELAY    = (2, 4)  # 请求间隔秒数 (min, max)
MAX_RETRIES      = 3

# M-Score 因子 clip 范围（抑制极端值）
CLIP_RANGES = {
    "DSRI": (0.0, 10.0),  "GMI": (-10.0, 10.0),
    "AQI":  (0.0, 10.0),  "SGI": (0.0, 10.0),
    "DEPI": (0.0, 10.0),  "SGAI": (0.0, 10.0),
    "LVGI": (0.0, 10.0),  "TATA": (-2.0, 2.0),
}
FACTOR_COLS = list(CLIP_RANGES.keys())

# 风险等级映射
def risk_level(score):
    if score <= 30:  return "低风险"
    if score <= 50:  return "关注"
    if score <= 70:  return "中等风险"
    if score <= 85:  return "高风险"
    return "极高风险"

# ============================================================
# 日志
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("auto_update")

# ============================================================
# 网络层
# ============================================================
def make_session():
    """创建绕过系统代理的 requests Session"""
    s = requests.Session()
    s.trust_env = False  # 忽略系统代理（Clash 未启动时不会报错）
    return s

SESSION = make_session()

def em_fetch(report_name, report_date, sort_col, page=1, retries=MAX_RETRIES):
    """从东方财富数据中心拉取一页数据"""
    params = {
        "reportName": report_name,
        "columns": "ALL",
        "filter": f"(REPORT_DATE='{report_date}')",
        "pageNumber": page,
        "pageSize": PAGE_SIZE,
        "sortTypes": -1,
        "sortColumns": sort_col,
        "source": "HSF10",
        "client": "PC",
    }
    for attempt in range(retries):
        try:
            r = SESSION.get(EM_BASE, params=params, headers=EM_HEADERS, timeout=30)
            data = r.json()
            if data.get("success") and data.get("result"):
                return data["result"]
            if data.get("code") == 9501:
                log.warning(f"API 过滤语法错误: {data.get('message')}")
                return None
            log.warning(f"API 返回异常 (attempt {attempt+1}): {data.get('message','')[:80]}")
        except Exception as e:
            log.warning(f"请求失败 (attempt {attempt+1}): {e}")
        time.sleep(random.uniform(*REQUEST_DELAY))
    return None

def em_fetch_all(report_name, report_date, sort_col):
    """拉取某个报表类型某年度的全部数据"""
    result = em_fetch(report_name, report_date, sort_col, page=1)
    if not result or not result.get("data"):
        return []
    
    all_records = list(result["data"])
    total_pages = result.get("pages", 1)
    log.info(f"  {report_name} [{report_date}]: 共 {result.get('count',0)} 条, {total_pages} 页")
    
    for page in range(2, total_pages + 1):
        time.sleep(random.uniform(*REQUEST_DELAY))
        result = em_fetch(report_name, report_date, sort_col, page=page)
        if result and result.get("data"):
            all_records.extend(result["data"])
    
    return all_records

# ============================================================
# 数据处理
# ============================================================
def safe_float(val, default=None):
    """安全转换浮点数"""
    if val is None:
        return default
    try:
        v = float(val)
        return v if not np.isnan(v) and not np.isinf(v) else default
    except (ValueError, TypeError):
        return default

def safe_div(a, b):
    """安全除法"""
    a, b = safe_float(a), safe_float(b)
    if a is None or b is None or b == 0:
        return None
    return a / b

def compute_mscore_factors(balance_df, income_df, cashflow_df,
                           prev_balance_df, prev_income_df):
    """
    计算 M-Score 8 大因子。
    所有 DataFrame 都以 SECURITY_CODE 为 index。
    返回一个 DataFrame，index=SECURITY_CODE，columns=8 因子。
    """
    factors = pd.DataFrame(index=balance_df.index)
    
    # 辅助：从 df 取列值，缺失返回 None Series
    def col(df, name):
        if df is not None and name in df.columns:
            return pd.to_numeric(df[name], errors="coerce")
        return pd.Series(np.nan, index=df.index if df is not None else factors.index)

    # --- 1. DSRI (应收账款指数) ---
    ar_cur  = col(balance_df, "ACCOUNTS_RECE")
    rev_cur = col(income_df, "OPERATE_INCOME").fillna(col(income_df, "TOTAL_OPERATE_INCOME"))
    ar_prev = col(prev_balance_df, "ACCOUNTS_RECE") if prev_balance_df is not None else pd.Series(np.nan, index=factors.index)
    rev_prev = col(prev_income_df, "OPERATE_INCOME").fillna(col(prev_income_df, "TOTAL_OPERATE_INCOME")) if prev_income_df is not None else pd.Series(np.nan, index=factors.index)
    
    ratio_cur = ar_cur / rev_cur.replace(0, np.nan)
    ratio_prev = ar_prev / rev_prev.replace(0, np.nan)
    factors["DSRI"] = ratio_cur / ratio_prev.replace(0, np.nan)

    # --- 2. GMI (毛利率指数) ---
    rev_c = col(income_df, "OPERATE_INCOME").fillna(col(income_df, "TOTAL_OPERATE_INCOME"))
    cost_c = col(income_df, "OPERATE_COST").fillna(col(income_df, "TOTAL_OPERATE_COST"))
    gm_cur = (rev_c - cost_c) / rev_c.replace(0, np.nan)
    
    if prev_income_df is not None:
        rev_p = col(prev_income_df, "OPERATE_INCOME").fillna(col(prev_income_df, "TOTAL_OPERATE_INCOME"))
        cost_p = col(prev_income_df, "OPERATE_COST").fillna(col(prev_income_df, "TOTAL_OPERATE_COST"))
        gm_prev = (rev_p - cost_p) / rev_p.replace(0, np.nan)
    else:
        gm_prev = pd.Series(np.nan, index=factors.index)
    factors["GMI"] = gm_prev / gm_cur.replace(0, np.nan)

    # --- 3. AQI (资产质量指数) ---
    # AQI = (1 - CA_cur/TA_cur - PPE_cur/TA_cur) / (1 - CA_prev/TA_prev - PPE_prev/TA_prev)
    ta_cur = col(balance_df, "TOTAL_ASSETS")
    ca_cur = col(balance_df, "TOTAL_CURRENT_ASSETS")
    # 用非流动资产近似替代 (TA - CA - 货币资金)
    nca_cur = ta_cur - ca_cur
    aqi_cur = nca_cur / ta_cur.replace(0, np.nan)
    
    if prev_balance_df is not None:
        ta_prev = col(prev_balance_df, "TOTAL_ASSETS")
        ca_prev = col(prev_balance_df, "TOTAL_CURRENT_ASSETS")
        nca_prev = ta_prev - ca_prev
        aqi_prev = nca_prev / ta_prev.replace(0, np.nan)
    else:
        aqi_prev = pd.Series(np.nan, index=factors.index)
    factors["AQI"] = aqi_cur / aqi_prev.replace(0, np.nan)

    # --- 4. SGI (营业收入指数) ---
    factors["SGI"] = rev_cur / rev_prev.replace(0, np.nan)

    # --- 5. DEPI (折旧率指数) ---
    # 简化 API 不提供折旧数据，使用 1.0 作为中性默认值
    factors["DEPI"] = pd.Series(1.0, index=factors.index)

    # --- 6. SGAI (销管费用指数) ---
    sga_cur = col(income_df, "SALE_EXPENSE").fillna(0) + col(income_df, "MANAGE_EXPENSE").fillna(0)
    sga_ratio_cur = sga_cur / rev_cur.replace(0, np.nan)
    
    if prev_income_df is not None:
        rev_p2 = col(prev_income_df, "OPERATE_INCOME").fillna(col(prev_income_df, "TOTAL_OPERATE_INCOME"))
        sga_prev = col(prev_income_df, "SALE_EXPENSE").fillna(0) + col(prev_income_df, "MANAGE_EXPENSE").fillna(0)
        sga_ratio_prev = sga_prev / rev_p2.replace(0, np.nan)
    else:
        sga_ratio_prev = pd.Series(np.nan, index=factors.index)
    factors["SGAI"] = sga_ratio_cur / sga_ratio_prev.replace(0, np.nan)

    # --- 7. LVGI (杠杆率指数) ---
    tl_cur = col(balance_df, "TOTAL_LIABILITIES")
    leverage_cur = tl_cur / ta_cur.replace(0, np.nan)
    
    if prev_balance_df is not None:
        tl_prev = col(prev_balance_df, "TOTAL_LIABILITIES")
        ta_prev2 = col(prev_balance_df, "TOTAL_ASSETS")
        leverage_prev = tl_prev / ta_prev2.replace(0, np.nan)
    else:
        leverage_prev = pd.Series(np.nan, index=factors.index)
    factors["LVGI"] = leverage_cur / leverage_prev.replace(0, np.nan)

    # --- 8. TATA (应计总额占比) ---
    # TATA = (净利润 - 经营现金流) / 总资产
    np_cur = col(income_df, "PARENT_NETPROFIT").fillna(col(income_df, "NETPROFIT"))
    cfo_cur = col(cashflow_df, "NETCASH_OPERATE") if cashflow_df is not None else pd.Series(np.nan, index=factors.index)
    factors["TATA"] = (np_cur - cfo_cur) / ta_cur.replace(0, np.nan)

    return factors

def compute_mscore(factors_df):
    """
    计算 Beneish M-Score
    M = -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI
        + 0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
    """
    coeffs = {
        "DSRI": 0.92, "GMI": 0.528, "AQI": 0.404, "SGI": 0.892,
        "DEPI": 0.115, "SGAI": -0.172, "TATA": 4.679, "LVGI": -0.327,
    }
    m = pd.Series(-4.84, index=factors_df.index)
    for col_name, coeff in coeffs.items():
        if col_name in factors_df.columns:
            vals = factors_df[col_name].clip(*CLIP_RANGES.get(col_name, (-10, 10)))
            m += coeff * vals.fillna(0)
    return m

def compute_risk_score(m_score, factors_row):
    """
    综合风险评分 (0-100)，综合 M-Score 和各因子异常程度
    """
    score = 0.0
    # M-Score 贡献 (0-40 分)：M > -1.78 开始计分
    if m_score is not None and not np.isnan(m_score):
        if m_score > -1.78:
            score += min(40, (m_score + 1.78) * 8)
    
    # 各因子异常贡献 (每个最高 ~8.5 分，共 8 个 = 60 分)
    thresholds = {
        "DSRI": 1.46, "GMI": 1.19, "AQI": 1.25, "SGI": 1.60,
        "DEPI": 1.07, "SGAI": 1.05, "LVGI": 1.11, "TATA": 0.0175,
    }
    for factor_name, threshold in thresholds.items():
        val = factors_row.get(factor_name)
        if val is not None and not np.isnan(val):
            if factor_name == "TATA":
                if val > threshold:
                    score += min(8.5, max(0, (val - threshold) * 200))
            else:
                if val > threshold:
                    score += min(8.5, (val - threshold) * 4)
    
    return round(min(100, max(0, score)), 1)

# ============================================================
# 主更新流程
# ============================================================
def get_years_to_update(full_mode=False):
    """确定需要更新的年报年份"""
    if os.path.exists(CSV_PATH):
        existing = pd.read_csv(CSV_PATH, encoding="utf-8-sig", usecols=["Year"])
        existing_max_year = int(existing["Year"].max())
    else:
        existing_max_year = 2009  # 默认从 2010 开始

    current_year = datetime.now().year
    # 年报数据在次年 1-4 月密集披露，6 月后当年的年报基本出齐
    # 所以当前可获取的最新年报年份 = current_year - 1
    latest_available_year = current_year - 1
    
    if full_mode:
        start = max(existing_max_year - FULL_YEARS_BACK + 1, 2010)
    else:
        # 增量模式：只拉取已有数据的下一年
        start = min(existing_max_year + 1, latest_available_year)
    
    years = list(range(start, latest_available_year + 1))
    if not years:
        log.info(f"已有数据截至 {existing_max_year} 年，当前无新年报可更新")
    return years

def fetch_year_data(year):
    """拉取某一年度的三张报表数据"""
    report_date = f"{year}-12-31"
    log.info(f"拉取 {year} 年报数据...")
    
    # 资产负债表
    log.info(f"  [1/3] 资产负债表")
    rn, sc = EM_REPORTS["balance"]
    bal_records = em_fetch_all(rn, report_date, sc)
    bal_df = pd.DataFrame(bal_records) if bal_records else pd.DataFrame()
    
    # 利润表
    log.info(f"  [2/3] 利润表")
    rn, sc = EM_REPORTS["income"]
    inc_records = em_fetch_all(rn, report_date, sc)
    inc_df = pd.DataFrame(inc_records) if inc_records else pd.DataFrame()
    
    # 现金流量表
    log.info(f"  [3/3] 现金流量表")
    rn, sc = EM_REPORTS["cashflow"]
    cf_records = em_fetch_all(rn, report_date, sc)
    cf_df = pd.DataFrame(cf_records) if cf_records else pd.DataFrame()
    
    return bal_df, inc_df, cf_df

def process_year(year, bal_df, inc_df, cf_df, prev_bal_df, prev_inc_df):
    """处理单年数据：计算 M-Score、风险评分，输出 screening_results 格式"""
    if bal_df.empty:
        log.warning(f"  {year}: 资产负债表为空，跳过")
        return pd.DataFrame()

    # 以 SECURITY_CODE 为 index 对齐三张表
    for df in [bal_df, inc_df, cf_df]:
        if not df.empty and "SECURITY_CODE" in df.columns:
            df.set_index("SECURITY_CODE", inplace=True)
    
    if prev_bal_df is not None and not prev_bal_df.empty and "SECURITY_CODE" in prev_bal_df.columns:
        prev_bal_df.set_index("SECURITY_CODE", inplace=True)
    if prev_inc_df is not None and not prev_inc_df.empty and "SECURITY_CODE" in prev_inc_df.columns:
        prev_inc_df.set_index("SECURITY_CODE", inplace=True)

    # 计算 8 因子
    log.info(f"  计算 M-Score 因子...")
    factors_df = compute_mscore_factors(bal_df, inc_df, cf_df, prev_bal_df, prev_inc_df)
    
    # 计算 M-Score
    m_scores = compute_mscore(factors_df)
    
    # 组装 screening_results 格式
    rows = []
    common_idx = bal_df.index.intersection(factors_df.index)
    
    for stkcd in common_idx:
        bal_row = bal_df.loc[stkcd] if stkcd in bal_df.index else None
        inc_row = inc_df.loc[stkcd] if (inc_df is not None and stkcd in inc_df.index) else None
        factor_row = factors_df.loc[stkcd]
        m = m_scores.get(stkcd, np.nan)
        
        if bal_row is None:
            continue
        
        # 基础信息
        secucode = str(bal_row.get("SECUCODE", "")).split(".")[0] if isinstance(bal_row.get("SECUCODE"), str) else str(stkcd)
        short_name = str(bal_row.get("SECURITY_NAME_ABBR", ""))
        indcd = str(bal_row.get("INDUSTRY_CODE", ""))
        indnme = str(bal_row.get("INDUSTRY_NAME", ""))
        
        # 财务数据（元转亿元）
        revenue = safe_float(
            inc_row.get("OPERATE_INCOME") if inc_row is not None else None,
            safe_float(inc_row.get("TOTAL_OPERATE_INCOME") if inc_row is not None else None)
        )
        net_profit = safe_float(
            inc_row.get("PARENT_NETPROFIT") if inc_row is not None else None,
            safe_float(inc_row.get("NETPROFIT") if inc_row is not None else None)
        )
        total_assets = safe_float(bal_row.get("TOTAL_ASSETS"))
        
        # 商誉和其他应收款占比
        goodwill = safe_float(bal_row.get("GOODWILL"), 0)
        other_recv = safe_float(bal_row.get("OTHER_RECEIVE"), 0)
        goodwill_ratio = goodwill / total_assets if total_assets and total_assets > 0 else 0
        other_recv_ratio = other_recv / total_assets if total_assets and total_assets > 0 else 0
        
        # 综合风险评分
        m_val = safe_float(m, -4.0)
        risk_score = compute_risk_score(m_val, factor_row.to_dict())
        rl = risk_level(risk_score)
        
        rows.append({
            "Stkcd": secucode.zfill(6),
            "ShortName": short_name,
            "Indcd": indcd,
            "Indnme": indnme,
            "Year": year,
            "M_Score": round(m_val, 4) if m_val is not None else None,
            "DSRI": round(safe_float(factor_row.get("DSRI"), np.nan), 4),
            "GMI": round(safe_float(factor_row.get("GMI"), np.nan), 4),
            "AQI": round(safe_float(factor_row.get("AQI"), np.nan), 4),
            "SGI": round(safe_float(factor_row.get("SGI"), np.nan), 4),
            "DEPI": round(safe_float(factor_row.get("DEPI"), np.nan), 4),
            "SGAI": round(safe_float(factor_row.get("SGAI"), np.nan), 4),
            "LVGI": round(safe_float(factor_row.get("LVGI"), np.nan), 4),
            "TATA": round(safe_float(factor_row.get("TATA"), np.nan), 4),
            "综合风险评分": risk_score,
            "风险等级": rl,
            "营业收入": revenue,       # 保持元为单位，preprocess.py 会转亿
            "净利润": net_profit,
            "总资产": total_assets,
            "商誉占比": round(goodwill_ratio, 6),
            "其他应收款占比": round(other_recv_ratio, 6),
        })
    
    result_df = pd.DataFrame(rows)
    log.info(f"  {year}: 处理完成, {len(result_df)} 家公司")
    return result_df

def merge_and_save(new_df):
    """增量合并到 screening_results.csv"""
    if os.path.exists(CSV_PATH):
        existing_df = pd.read_csv(CSV_PATH, encoding="utf-8-sig")
        log.info(f"已有数据: {len(existing_df)} 行, 年份 {existing_df['Year'].min()}-{existing_df['Year'].max()}")
        
        # 删除与新数据重叠的年份记录
        new_years = set(new_df["Year"].unique())
        existing_df = existing_df[~existing_df["Year"].isin(new_years)]
        
        merged = pd.concat([existing_df, new_df], ignore_index=True)
    else:
        merged = new_df
    
    merged = merged.sort_values(["Stkcd", "Year"]).reset_index(drop=True)
    merged.to_csv(CSV_PATH, index=False, encoding="utf-8-sig")
    log.info(f"写入 screening_results.csv: {len(merged)} 行")
    return merged

def regenerate_dashboard():
    """运行 preprocess.py 重新生成 dashboard_data.js"""
    log.info("重新生成 dashboard_data.js ...")
    preprocess_path = os.path.join(SCRIPT_DIR, "preprocess.py")
    try:
        result = subprocess.run(
            [sys.executable, preprocess_path],
            capture_output=True, timeout=120
        )
        if result.returncode == 0:
            log.info("dashboard_data.js 生成成功")
        else:
            stderr_text = result.stderr.decode("gbk", errors="replace") if result.stderr else ""
            log.error(f"生成失败: {stderr_text[:500]}")
        return result.returncode == 0
    except Exception as e:
        log.error(f"preprocess.py 执行异常: {e}")
        return False

def git_push():
    """提交并推送到 GitHub"""
    log.info("提交并推送到 GitHub...")
    try:
        cwd = SCRIPT_DIR
        subprocess.run(["git", "add", "dashboard_data.js"], cwd=cwd, check=True,
                       capture_output=True, timeout=30)
        
        # 检查是否有变更
        status = subprocess.run(["git", "status", "--porcelain"], cwd=cwd,
                                capture_output=True, timeout=30)
        if not status.stdout.strip():
            log.info("无数据变更，跳过 Git push")
            return True
        
        today = datetime.now().strftime("%Y-%m-%d")
        subprocess.run(
            ["git", "commit", "-m", f"Auto-update dashboard data {today}"],
            cwd=cwd, check=True, capture_output=True, timeout=30
        )
        subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=cwd, check=True, capture_output=True, timeout=120
        )
        log.info("Git push 成功，Vercel 将自动部署")
        return True
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode("gbk", errors="replace") if e.stderr else str(e)
        log.error(f"Git 操作失败: {err[:300]}")
        return False
    except Exception as e:
        log.error(f"Git 操作异常: {e}")
        return False

# ============================================================
# 入口
# ============================================================
def main():
    import argparse
    parser = argparse.ArgumentParser(description="A股 Dashboard 盘后自动更新")
    parser.add_argument("--full", action="store_true", help="全量模式：重新拉取近 5 年数据")
    parser.add_argument("--skip-git", action="store_true", help="跳过 Git push")
    parser.add_argument("--skip-time-check", action="store_true", help="跳过交易时间检查")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("A股财务数据 Dashboard 自动更新")
    log.info("=" * 60)

    # 交易时间检查：工作日 16:00 后才运行
    if not args.skip_time_check:
        now = datetime.now()
        weekday = now.weekday()  # 0=Mon, 6=Sun
        hour = now.hour
        if weekday >= 5:
            log.info("今天是周末，跳过更新")
            return
        if hour < 16:
            log.info(f"当前时间 {hour}:00，A 股尚未收盘/数据尚未就绪，跳过更新")
            log.info("建议在 18:00 后运行以确保数据已披露")
            return

    # 确定更新年份
    years = get_years_to_update(full_mode=args.full)
    if not years:
        log.info("没有需要更新的年份")
        return
    log.info(f"待更新年份: {years}")

    # 逐年拉取并处理
    all_new_data = []
    prev_bal_df, prev_inc_df = None, None
    
    for year in years:
        log.info(f"\n{'='*40}")
        log.info(f"处理 {year} 年报")
        log.info(f"{'='*40}")
        
        bal_df, inc_df, cf_df = fetch_year_data(year)
        
        if bal_df.empty:
            log.warning(f"{year}: 无数据，跳过")
            continue
        
        result = process_year(year, bal_df, inc_df, cf_df, prev_bal_df, prev_inc_df)
        if not result.empty:
            all_new_data.append(result)
        
        # 保存当前年作为下一年的"上年"参照
        prev_bal_df = bal_df.copy()
        prev_inc_df = inc_df.copy()
        
        time.sleep(random.uniform(*REQUEST_DELAY))

    if not all_new_data:
        log.info("没有获取到新数据")
        return

    # 合并所有新数据
    new_df = pd.concat(all_new_data, ignore_index=True)
    log.info(f"\n共新增 {len(new_df)} 行数据 ({new_df['Year'].min()}-{new_df['Year'].max()})")

    # 合并到 CSV
    merge_and_save(new_df)

    # 重新生成 dashboard_data.js
    if regenerate_dashboard():
        # Git push
        if not args.skip_git:
            git_push()
        else:
            log.info("跳过 Git push (--skip-git)")
    else:
        log.error("dashboard_data.js 生成失败，跳过 Git push")

    log.info("\n全部完成！")

if __name__ == "__main__":
    main()
