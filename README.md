# a-share-dashboard

A股上市公司财务数据全景分析终端。项目是纯静态站点，入口为 `index.html`，数据由 `dashboard_data.js` 提供，无需后端服务或构建步骤。

## 本地预览

直接打开 `index.html` 即可预览。也可以用任意静态服务器在项目根目录启动服务：

```bash
python -m http.server 4173
```

然后访问 `http://localhost:4173`。

## 部署到 Vercel

- Framework Preset: Other
- Build Command: 留空
- Output Directory: 留空或 `.`
- Install Command: 留空

关键依赖 ECharts 已放在 `vendor/echarts.min.js`，线上部署不依赖外部 CDN。

## 数据说明

`dashboard_data.js` 由 `preprocess.py` 从本地 CSV 数据生成。若要刷新数据，在上级数据文件更新后运行：

```bash
python preprocess.py
```

## 路由

页面使用 hash 路由：

- `#overview`
- `#industry`
- `#crisis`
- `#risk`
- `#factor`
- `#company`

