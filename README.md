# WCAG 文本对比度与透明叠色核验后端（Windows 本地）

一个只做 **API 与 CLI** 的本地服务，用 TypeScript + Node.js + SQLite 实现。
输入文字前景色、背景色和不透明画布色（sRGB 十六进制），输出最终可见颜色、
相对亮度、对比度以及普通文本/大文本四个等级判定，并支持命名配色的版本化管理、
批量核验、失败筛选、版本比较与导出。

不依赖 Docker、WSL、付费服务或任何外部在线 API。SQLite 使用 Node.js 内置
`node:sqlite`（Node 22+ / 本机验证 Node 25），无需编译原生模块。

## 范围与限制（务必先读）

- 只核对**给定的纯色组合**：不读取网页截图、不解析 CSS、不推断字体实际尺寸、不计算图片背景。
- “通过”仅表示**这一组前景/背景纯色在所选文本类别下达到对比度门槛**，
  **不代表整页已符合全部无障碍标准**。
- **大文本类别必须由调用者显式给出**（`category: "large"`）。服务不会根据字号字符串、
  粗细、`bold`、`24px` 等信息自行猜测是否为大文本；默认类别为 `normal`。
- 颜色只接受 sRGB 十六进制：`RRGGBB`（不透明）或 `RRGGBBAA`（带 alpha），大小写不敏感。
- 画布色必须不透明：只接受 6 位 `RRGGBB`；带 alpha 的画布会被拒绝。
- 合成模型是题目指定的近似：在**归一化 sRGB 编码通道**上做普通 source-over，
  而不是在线性光空间合成。这适用于本题核验，并非通用色彩管理方案。

## 计算公式（版本 `WCAG21-sRGB-sourceOver-v1`）

顺序是核心，不能颠倒：

1. **背景 over 画布**：半透明背景按 source-over 叠到不透明画布，得到最终背景（不透明）。
2. **前景 over 结果背景**：半透明前景再叠到上一步的最终背景，得到最终文字色。
3. 对最终前景、最终背景分别做 sRGB → 线性转换后计算相对亮度。
4. 用两个最终亮度计算对比度。

source-over（在 0..1 归一化 sRGB 编码通道上，结果**不取整**）：

```
out_a = αs + αd·(1−αs)
out_c = (αs·cs + αd·cd·(1−αs)) / out_a
```

sRGB → 线性（逐通道）：

```
c ≤ 0.04045 :  c / 12.92
c > 0.04045 :  ((c + 0.055) / 1.055) ^ 2.4
```

相对亮度：`L = 0.2126·R + 0.7152·G + 0.0722·B`

对比度（1:1 ~ 21:1）：`(L_lighter + 0.05) / (L_darker + 0.05)`

全程保留双精度浮点；显示用十六进制仅做展示。**判定直接使用未取整比值与门槛做
`>=` 比较**，不会先把比值四舍五入到阈值再判通过。每个等级都输出原始比值、门槛和
差值（ratio − threshold）。

| 等级 | 普通文本 | 大文本 |
| --- | --- | --- |
| AA | 4.5 | 3 |
| AAA | 7 | 4.5 |

门槛均为“大于等于”。透明度为 0 的文字最终与背景完全一致，对比度为 1。

## 快速开始

需要 Node.js 22 以上（建议 24/25，已在 v25.5.0 验证）。

```powershell
npm install
npm run build      # 类型检查 + 编译到 dist/
npm test           # 编译并运行 15 项测试
npm run demo       # 内置演示（21:1、1:1、半透明 vs 不透明黑字、版本化等）
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
```

## CLI

```powershell
# 单项核验（--category 可选：normal（默认）/ large）
node dist/src/cli.js check --fg 000000CC --bg FFFFFF --canvas FFFFFF --category normal

# 批量核验（保留输入顺序，逐条输出非法诊断）
node dist/src/cli.js batch --file examples/items.json

# 按等级筛选失败项
node dist/src/cli.js failures --file examples/items.json --level AA --text-type normal

# 命名配色：保存（颜色变化自动产生新版本）
node dist/src/cli.js save --name main-theme --fg 000000 --bg FFFFFF --canvas FFFFFF
node dist/src/cli.js palettes
node dist/src/cli.js versions --name main-theme
node dist/src/cli.js compare --name main-theme --a 1 --b 2
node dist/src/cli.js export --name main-theme --out data/main-theme.json

node dist/src/cli.js demo
```

## HTTP API

启动后控制台会打印实际地址。设置端口：`$env:PORT=8080; npm start`；
不设置则自动选择一个空闲端口。只监听 `127.0.0.1`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/check` | 单项核验 |
| POST | `/api/batch` | 批量核验（≤ 100 条） |
| POST | `/api/batch/failures` | 按等级筛选失败项 |
| POST | `/api/palettes/:name` | 保存/新建配色版本 |
| GET | `/api/palettes` | 列出配色集合 |
| GET | `/api/palettes/:name/versions` | 列出某配色全部版本 |
| GET | `/api/palettes/:name/versions/:v` | 查看某版本完整结果 |
| GET | `/api/palettes/:name/compare?a=1&b=2` | 比较两个版本 |

```powershell
$body = '{"foreground":"000000CC","background":"FFFFFF","canvas":"FFFFFF","category":"normal"}'
Invoke-RestMethod -Uri http://127.0.0.1:<端口>/api/check -Method Post -Body $body -ContentType 'application/json'
```

批量请求体：`{ "items": [ { "id": "可选稳定编号", "foreground": "...", "background": "...", "canvas": "...", "category": "normal|large" } ] }`。

错误响应统一为：`{ "error": { "code", "message", "details?" } }`。

## 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `COLOR_LENGTH_UNSUPPORTED` | 400 | 颜色不是 6 位或 8 位 |
| `COLOR_INVALID_CHAR` | 400 | 颜色含非十六进制字符 |
| `CANVAS_NOT_OPAQUE` | 400 | 画布带透明度或不是 6 位 |
| `CATEGORY_INVALID` | 400 | 类别不是 `normal`/`large` |
| `BATCH_EMPTY` | 400 | 批量记录为空 |
| `BATCH_LIMIT_EXCEEDED` | 400 | 超过 100 条 |
| `PALETTE_NOT_FOUND` | 404 | 配色集合不存在 |
| `VERSION_NOT_FOUND` | 404 | 指定版本不存在 |
| `VALIDATION_ERROR` | 400/404 | 其它参数/路由校验失败 |

## 数据与持久化

- SQLite 文件默认在项目内 `data/wcag.db`，可用环境变量 `WCAG_DB` 覆盖。
- 表 `palette_versions` 保存：原始 `foreground/background/canvas` 色值、`category`、
  `formula_version`、比值与完整结果 JSON、创建时间。
- 修改颜色会追加新版本；未改变颜色时复用当前版本。**历史判定永久保留，
  不会被当前主题替换**。

## 手算核对示例

- 黑字白底：亮度 0 与 1，对比度 `1.05/0.05 = 21`。
- 相同颜色：比值 1，四个等级均失败。
- 80% 黑字（`000000CC`，α=204/255=0.8）叠白底：最终通道 ≈ 0.2（显示为 `333333`），
  线性 ≈ 0.033105，对比度 ≈ 12.63；不透明黑字为 21，差异明显。
- 透明前景（`...00`）最终颜色等于背景，比值 1。
- 50% 白背景（`FFFFFF80`，α≈0.502）叠黑画布：最终背景通道 = 128/255 ≈ 0.502，
  黑字对比度 ≈ 5.31；同一背景叠白画布时为 21，说明画布影响结果。
- 不透明颜色交换前景/背景不改变对比度；**透明色交换不能套用这一性质**
  （因合成顺序与画布参与），测试中有对应用例。
