# WCAG 文本对比度与透明叠色核验后端

本地运行的**文本配色**对比度核验服务，仅提供 **HTTP API** 与 **CLI**（无前端、无网页抓取）。
使用 TypeScript + Node.js 内置 `node:sqlite`，**无需 Docker、WSL、付费服务或任何在线 API，也无需原生编译**。

- 输入：文字前景色、背景色、不透明画布色，sRGB 的 `RRGGBB`（不透明）或 `RRGGBBAA`（含 alpha）。
- 输出：最终可见颜色、相对亮度、对比度（原始未取整比值），以及四个文本等级的逐项判定。
- 只核对**给定的纯色组合**：不读取网页截图、不解析 CSS、不推断字体实际尺寸、不计算图片背景。
- **不把“该纯色组合对比度通过”表述为“整页已符合全部无障碍标准”。** 本服务只对给出的前景/背景/画布纯色负责。

## 大文本类别由调用者提供

服务**不会**根据粗体、字号字符串等自行猜测“大文本”。调用方必须显式传入：

- `category=normal`（默认）：主判定取**普通文本 AA（4.5）**。
- `category=large`：主判定取**大文本 AA（3）**。

无论传入哪种类别，响应都会**同时**给出全部四项：普通 AA 4.5、普通 AAA 7、大文本 AA 3、大文本 AAA 4.5，
并用 `primary` 标出主判定项。

## 计算口径（重要）

叠色与亮度换算的**顺序**是本服务的核心：

1. 先把**背景**按 alpha 以普通 source-over 叠到**不透明画布**，得到最终背景色；
2. 再把**前景（文字）**以 source-over 叠到第 1 步所得背景，得到最终文字色；
3. 分别对最终文字色、最终背景色做 sRGB→线性转换，再算相对亮度；
4. 用未取整的线性亮度计算对比度。

约束与公式：

- source-over 在**归一化 sRGB 编码通道**上进行：`out = src*a + dst*(1-a)`，结果 alpha=1，通道保留浮点不取整。
- 不会把半透明颜色单独当成不透明颜色测对比；也不会直接对 8 位 RGB 求平均亮度。
- sRGB→线性：`c <= 0.04045` 时 `c/12.92`，否则 `((c+0.055)/1.055)^2.4`。
- 相对亮度：`0.2126*R + 0.7152*G + 0.0722*B`（线性通道）。
- 对比度：`(L_lighter+0.05)/(L_darker+0.05)`。
- 判定一律用**大于等于 `>=`**，全程保留浮点精度；展示的小数和 8 位 hex **不参与判定**，
  因此不会出现“先四舍五入到阈值再判通过”。
- 文字 alpha=0 时最终文字色与背景相同，对比度为 1。
- **画布必须不透明**（`RRGGBB`，或 `RRGGBBAA` 且 alpha=`FF`）；颜色字符非法或长度不支持（不接受 3/4 位简写）一律拒绝。

记录中保存公式版本标识 `wcag21-srgb-sourceover-v1`，便于日后区分口径变化。

## 环境要求

- Node.js **>= 22.5**（开发与实测环境为 Node v25.5.0，npm 11.8.0，Windows）。
- 仅使用 Node 内置模块（`node:http`、`node:sqlite`、`node:net` 等），运行时零第三方依赖。

## 构建 / 测试 / 启动 / 演示

在项目根目录（PowerShell 或 cmd）：

```powershell
# 1) 安装开发依赖（typescript、类型声明）
npm install

# 2) 构建到 dist/
npm run build

# 3) 运行测试（22 个用例，含手算独立核对、批量、SQLite 持久化）
npm test

# 4) 启动 HTTP 服务（默认自动选择空闲端口）
npm start

# 5) 运行内置演示（21:1、1:1、半透明黑 vs 不透明黑、非法画布等）
npm run demo
```

可配置端口（默认让操作系统分配空闲端口）：

```powershell
# 方式一：环境变量
$env:PORT="8080"; npm start

# 方式二：命令行参数
node --experimental-sqlite dist/server/start.js --port=8080
```

数据目录固定在**项目内** `data/`，数据库文件 `data/wcag.sqlite`。
可用环境变量 `WCAG_DB` 覆盖路径。

## CLI 用法

```powershell
# 核验单条（显示最终颜色、亮度、合成步骤、四项判定）
node --experimental-sqlite dist/cli/index.js check `
  --fg=000000CC --bg=FFFFFF --canvas=FFFFFF --category=normal

# 批量核验（文件为 { "entries": [ ... ] } 或直接是数组）
node --experimental-sqlite dist/cli/index.js batch --file=examples/entries.json

# 只看失败项（可按等级过滤；非法记录始终列出）
node --experimental-sqlite dist/cli/index.js batch --file=examples/entries.json --failures --level=AA

# 命名配色集合：保存即产生新版本
node --experimental-sqlite dist/cli/index.js save --palette=brand --fg=000000 --bg=FFFFFF --canvas=FFFFFF
node --experimental-sqlite dist/cli/index.js save --palette=brand --fg=777777 --bg=FFFFFF --canvas=FFFFFF

# 列出集合 / 版本，查看单项亮度与合成步骤，比较版本，导出
node --experimental-sqlite dist/cli/index.js list
node --experimental-sqlite dist/cli/index.js list --palette=brand
node --experimental-sqlite dist/cli/index.js show --palette=brand --version=1
node --experimental-sqlite dist/cli/index.js compare --palette=brand --versions=1...2
node --experimental-sqlite dist/cli/index.js export
```

## HTTP API

请求/响应均为 JSON。颜色字段：`foreground`、`background`、`canvas`，可选 `category`（`normal`|`large`）、`name`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/check` | 核验单条，返回最终颜色、亮度、合成步骤、四项判定 |
| POST | `/batch` | 批量核验（上限 100 条），保留输入顺序，逐条独立诊断 |
| POST | `/batch/failures` | 批量并只返回失败项（可带 `level=AA|AAA`、`category`） |
| GET | `/palettes` | 列出命名集合 |
| GET | `/palettes/:p/versions` | 列出某集合全部版本（历史不被覆盖） |
| GET | `/palettes/:p/versions/:v` | 查看某版本的完整报告（含亮度与合成步骤） |
| POST | `/palettes/:p/versions` | 保存一条核验为该集合的新版本 |
| GET | `/palettes/:p/compare/:a...:b` | 比较两个版本的色值与比值差异 |
| GET | `/export` | 导出全部版本元数据 |

单条例子（PowerShell）：

```powershell
$body = '{"foreground":"000000CC","background":"FFFFFF","canvas":"FFFFFF","category":"normal"}'
Invoke-RestMethod -Uri "http://127.0.0.1:<端口>/check" -Method Post -Body $body -ContentType 'application/json'
```

批量请求体形如：

```json
{ "entries": [
  { "recordId": "a", "foreground": "000000", "background": "FFFFFF", "canvas": "FFFFFF", "category": "normal" },
  { "recordId": "b", "foreground": "ZZZZZZ", "background": "FFFFFF", "canvas": "FFFFFF" }
] }
```

每条可带稳定 `recordId`（缺省时用从 0 开始的序号）。一条非法记录返回独立诊断，
**不会**被计为通过，也不会影响其他记录的计算。

## 错误码

| code | 含义 |
| --- | --- |
| `COLOR_NOT_STRING` / `COLOR_INVALID_CHAR` | 颜色不是字符串 / 含非十六进制字符 |
| `COLOR_LENGTH_UNSUPPORTED` | 长度不是 6 或 8（不接受 3/4 位简写） |
| `CANVAS_NOT_OPAQUE` | 画布含透明度（必须不透明） |
| `MISSING_COLOR` / `MISSING_ENTRIES` | 缺少颜色字段 / 批量缺少 entries |
| `CATEGORY_INVALID` | 文本类别不是 `normal`/`large` |
| `BATCH_NOT_ARRAY` / `BATCH_TOO_MANY` | 批量不是数组 / 超过 100 条 |
| `INVALID_JSON` / `BODY_TOO_LARGE` | 请求体非法 / 超 1MB |
| `VERSION_NOT_FOUND` / `NOT_FOUND` | 版本不存在 / 路由不存在 |

## 版本与持久化

- SQLite 保存**原始色值、文本类别、公式版本、完整结果 JSON、时间戳**。
- 修改颜色后再次保存会创建**新版本行**；历史版本及其判定不会被当前主题替换。
- 重启服务后历史数据仍可读（测试中已验证重新打开同一文件）。

## 范围与限制

- 仅核验纯色前景/背景/画布的 sRGB 数值对比度；不处理图片、渐变、CSS、字体渲染或实际像素。
- source-over 在**编码 sRGB 通道**上进行（题目指定口径），并非在线性光空间合成。
- 不声明整页无障碍合规；其他 WCAG 准则不在本服务范围内。
- `node:sqlite` 在当前 Node 版本会打印一条 ExperimentalWarning，属正常现象，不影响功能。
