"""TDX MCP 市场数据批量获取 — 为行业对标看板提供实时行情维度

工作流:
1. 从 TDX MCP 按行业批量查询 PE/PB/市值/换手率等市场指标
2. 输出为 dashboard_data.js 兼容的 JSON 片段
3. 供 benchmark.js 的「市场表现」维度使用

用法: python fetch_tdx_market.py [--output market_data.json]
"""
import urllib.request, json, ssl, time, os, sys

URL = 'https://mcp.tdx.com.cn:3001/mcp'
HEADERS = {
    'Content-Type': 'application/json',
    'tdx-api-key': 'TDX-d9110e87ec261c43c9c65d768be4a01d',
    'Accept': 'application/json, text/event-stream'
}

ctx = ssl.create_default_context()
SESSION_ID = None

def call_mcp(method, params=None, timeout=60):
    global SESSION_ID
    h = dict(HEADERS)
    if SESSION_ID:
        h['Mcp-Session-Id'] = SESSION_ID
    payload = json.dumps({
        'jsonrpc': '2.0',
        'method': method,
        'params': params or {},
        'id': 1
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(URL, data=payload, headers=h, method='POST')
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=timeout)
        body = resp.read().decode('utf-8')
        new_sid = resp.headers.get('Mcp-Session-Id', '')
        if new_sid:
            SESSION_ID = new_sid
        # Parse SSE
        lines = body.strip().split('\n')
        data_lines = [l[6:] for l in lines if l.startswith('data:')]
        return json.loads(data_lines[0]) if data_lines else {}
    except Exception as e:
        print(f'  [MCP error] {e}', file=sys.stderr)
        return None

def ask_tdx(question, timeout=60):
    """向 TDX MCP 提问，返回解析后的表格数据"""
    result = call_mcp('tools/call', {
        'name': 'tdx_wenda_quotes',
        'arguments': {'question': question}
    }, timeout=timeout)
    if not result:
        return None
    content = result.get('result', {}).get('content', [])
    if not content:
        err = result.get('result', {}).get('isError', False)
        if err:
            print(f'  [TDX error] {result}', file=sys.stderr)
        return None
    for c in content:
        text = c.get('text', '')
        try:
            obj = json.loads(text)
            if 'headers' in obj and 'data' in obj:
                return obj
        except json.JSONDecodeError:
            continue
    return None


def fetch_industry_market_indices(industry_names):
    """
    获取各行业的核心市场指标（PE中位数、平均市值等）
    每次查询一个行业，返回 {行业名: {pe_median, avg_market_cap, ...}}
    """
    results = {}
    for i, name in enumerate(industry_names):
        print(f'  [{i+1}/{len(industry_names)}] 查询 {name} 行业市场指标...')
        q = f"查询A股{name}行业（申万）所有个股的最新PE(TTM)中位数、总市值中位数和平均换手率"
        data = ask_tdx(q, timeout=45)
        if data:
            results[name] = _extract_industry_stats(data)
        else:
            results[name] = None
        time.sleep(0.5)  # 限速
    return results


def _extract_industry_stats(data):
    """从 TDX 返回的行业表格中提取关键统计值"""
    headers = data.get('headers', [])
    rows = data.get('data', [])
    if not rows:
        return None

    # 找关键列
    pe_col = None
    mcap_col = None
    turnover_col = None
    for idx, h in enumerate(headers):
        hl = h.lower()
        if '市盈' in h or 'pe' in hl:
            pe_col = idx
        elif '市值' in h:
            mcap_col = idx
        elif '换手' in h:
            turnover_col = idx

    pe_vals = []
    mcap_vals = []
    for row in rows:
        if pe_col is not None and pe_col < len(row):
            try:
                v = float(row[pe_col])
                if 0 < v < 10000:
                    pe_vals.append(v)
            except (ValueError, TypeError):
                pass
        if mcap_col is not None and mcap_col < len(row):
            try:
                v = float(row[mcap_col])
                if v > 0:
                    mcap_vals.append(v)
            except (ValueError, TypeError):
                pass

    stats = {}
    if pe_vals:
        pe_vals.sort()
        n = len(pe_vals)
        stats['pe_median'] = round(pe_vals[n // 2], 2)
        stats['pe_count'] = n
    if mcap_vals:
        mcap_vals.sort()
        n = len(mcap_vals)
        stats['mcap_median'] = round(mcap_vals[n // 2], 0)
        stats['mcap_count'] = n

    return stats if stats else None


def fetch_top_companies_market(codes_chunk, chunk_idx, total_chunks):
    """
    批量查询一批股票的实时行情
    codes_chunk: list of stock codes like ['600519', '000858']
    返回: {code: {price, pe, pb, market_cap, turnover, change_pct}}
    """
    if len(codes_chunk) == 0:
        return {}
    code_list = '、'.join(codes_chunk[:20])  # 每次最多20只
    print(f'  [{chunk_idx}/{total_chunks}] 查询 {len(codes_chunk)} 只个股行情 ({codes_chunk[0]}...) ...')
    q = f"查询{code_list}等股票的最新行情，包括最新价、涨跌幅、总市值、PE(TTM)、PB、换手率"
    data = ask_tdx(q, timeout=60)

    results = {}
    if not data:
        return results

    headers = data.get('headers', [])
    rows = data.get('data', [])
    if not rows:
        return results

    # 映射列
    col_map = {}
    for idx, h in enumerate(headers):
        hl = h.lower()
        if 'sec_code' in hl or 'code' in hl:
            col_map['code'] = idx
        elif 'price' in hl or '最新价' in h or 'now_price' in hl:
            col_map['price'] = idx
        elif 'chg' in hl or '涨跌幅' in h:
            col_map['change_pct'] = idx
        elif '市值' in h:
            col_map['market_cap'] = idx
        elif '市盈' in h or 'pe' in hl:
            col_map['pe'] = idx
        elif 'pb' in hl or '市净' in h:
            col_map['pb'] = idx
        elif '换手' in h:
            col_map['turnover'] = idx

    for row in rows:
        code = str(row[col_map.get('code', 2)]).zfill(6) if col_map.get('code') is not None and col_map['code'] < len(row) else None
        if not code or not code.isdigit():
            # Try other columns for code
            for idx, h in enumerate(headers):
                if 'code' in h.lower() and idx < len(row):
                    code = str(row[idx]).zfill(6)
                    if code.isdigit():
                        break
        if not code or not code.isdigit():
            continue

        def safe_float(idx_key):
            return round(float(row[col_map[idx_key]]), 2) if idx_key in col_map and col_map[idx_key] < len(row) else None

        try:
            results[code] = {
                'price': safe_float('price'),
                'change_pct': safe_float('change_pct'),
                'market_cap': safe_float('market_cap'),
                'pe': safe_float('pe'),
                'pb': safe_float('pb'),
                'turnover': safe_float('turnover'),
            }
        except (ValueError, TypeError):
            continue

    return results


def main():
    global SESSION_ID

    # Initialize
    print('连接 TDX MCP...')
    result = call_mcp('initialize', {
        'protocolVersion': '2024-11-05',
        'capabilities': {},
        'clientInfo': {'name': 'benchmark-fetcher', 'version': '1.0'}
    })
    if not result:
        print('ERROR: 无法连接 TDX MCP')
        sys.exit(1)
    print(f'已连接: {result.get("result", {}).get("serverInfo", {})}')

    # 各 L2 行业名称列表（从已知的 dashboard 数据中提取关键行业）
    # 这里只查询主要行业，全部 185 个太多且很多样本太小
    KEY_INDUSTRIES = [
        '白酒', '银行', '证券', '保险', '房地产开发',
        '半导体', '消费电子', '软件开发', 'IT服务',
        '电力', '煤炭开采', '石油', '光伏设备', '风电设备', '电池',
        '汽车零部件', '乘用车', '化学制药', '中药', '医疗器械', '生物制品',
        '通信设备', '计算机设备', '通用设备', '专用设备',
        '航空机场', '铁路公路', '航运港口',
        '食品加工', '饮料乳品', '养殖业', '种植业',
        '一般零售', '基础建设', '房屋建设',
    ]

    print(f'\n===== 步骤1: 获取行业级市场指标 (共 {len(KEY_INDUSTRIES)} 个行业) =====')
    industry_market = fetch_industry_market_indices(KEY_INDUSTRIES)

    # 统计
    success = sum(1 for v in industry_market.values() if v is not None)
    print(f'\n行业市场数据: {success}/{len(industry_market)} 成功')

    # 输出
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dashboard', 'market_data.json')
    if len(sys.argv) > 1 and sys.argv[1] == '--output':
        output_path = sys.argv[2]

    # 生成与 dashboard_data.js 兼容格式
    js_lines = []
    js_lines.append('/**\n * A股行业对标 - 市场维度数据 (TDX MCP 实时行情)\n')
    js_lines.append(f' * 抓取时间: {time.strftime("%Y-%m-%d %H:%M:%S")}\n')
    js_lines.append(' * 来源: 通达信 wenda-mcp-server\n */\n')
    js_lines.append(f'const INDUSTRY_MARKET_DATA = {json.dumps(industry_market, ensure_ascii=False, indent=2)};\n')

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(''.join(js_lines))

    print(f'\n已保存到: {output_path}')
    print(f'文件大小: {os.path.getsize(output_path) / 1024:.1f} KB')

    # 如果输出到 dashboard_data.js，追加到文件末尾
    if 'market_data.js' in output_path or 'dashboard_data.js' in output_path:
        print('数据格式与 dashboard_data.js 兼容，可直接在 benchmark.js 中引用')


if __name__ == '__main__':
    main()
