# 淬知 · 收藏炼金炉

把知乎上"收藏后吃灰"的优质内容，炼成可复习、可再创作的学习包。

## 产品定位

面向知乎黑客松「知识炼金场」赛道。用户粘贴知乎链接、正文或登录后选择收藏夹内容，系统生成结构化学习包（观点光谱、核心概念、复习卡片、情景练习、学习路径），通过主动回忆自评安排 1/3/7/21 天间隔复习，并在复习后生成"我的理解"和"知乎回答草稿"，支持 Markdown / HTML 导出。

## 前端工作台

- 首页即工具：四道工序流程条（淬·观点光谱 → 炼·认知地图 → 固·复习卡片 → 验·看山对练）、3 类真实场景示例卡（📚 知识科普「什么是存在主义」知乎回答链接 → 概念卡；💬 观点争议「年轻人该不该裸辞」内置 15 条真实帖子 → 应该/不应该/中立 三派观点光谱；📝 备考规划「如何备考考研」知乎专栏链接 → 学习路径），点击填充输入框、含内容预览与产出 mini 示意、收藏夹授权入口（含授权范围声明）、历史记录
- 内容类型自适应：炼金时自动识别内容类型（知识科普/观点争议/备考规划/收藏夹批量），学习包按类型聚焦展示——知识类主推复习卡片（概念卡）、观点类主推观点光谱、备考类主推认知地图学习路径、收藏夹主推消化顺序；对练作为三类统一收尾（收藏夹不含对练）；类型徽章可一键纠正，弱化功能收进「更多」面板
- 炼金过程：淬 → 炼 → 固 → 验四工序进度与过程日志
- 学习包四 Tab：观点光谱、认知地图、复习卡片、费曼陪练
- 复习卡片支持正反翻转与"会 / 模糊 / 不会"评分，展示 1/3/7/21 排期与薄弱项
- 费曼陪练为聊天式界面，可生成"我的理解 / 回答草稿"并导出
- 桌面与移动端自适应，包含空态、加载骨架屏、错误提示

### UI v2

- 知乎蓝 `#0084FF` + 炼金暖金 `#F5A623`，立场色区分正方 / 反方 / 中立 / 少数派
- 卡片 16px、按钮 10px、输入框 12px、标签药丸圆角，克制动效与页面 fade-in
- 刘看山 IP 状态素材：首页欢迎、炼金加载、思考、复习、陪练、空状态
- 一键生成可视化复习卡片：概念卡 / 观点卡 / 情景题 / 对比卡 / 思维导图
- 复习页支持类型筛选、点击 / 空格翻转、方向键与滑动切换、评分自动下一张
- 21 天复习日历热力图；导出 Markdown / SVG 图片 / PDF 打印 / Anki `.apkg`

### UI v3 修订

- 顶部固定搜索栏（56px）：Logo + 链接/正文输入 + 开始炼金 + 用户菜单
- 内容区居中，max-width 960px；未输出时首页居中展示刘看山打招呼 + 示例问题卡片
- 历史、收藏夹、登录入口收进右上角菜单，不再占用常驻侧栏
- 观点光谱改为知乎蓝深浅色体系，核心主张 20px/600，论据默认折叠，适用条件置底淡化
- 复习卡片：首次进入 3 步引导、快捷键提示、明确评分文案、进度"第 X / Y 张 + 百分比"
- C 端文案友好化：移除 API/JSON/Agent 等术语，错误统一为友好提示 + 重新炼金按钮

### UI v4 深度优化

- 观点光谱改为环形饼图：支持/中立/质疑/少数派四色，中心显示总回答数，图例可点击筛选
- 认知地图改为 SVG 蜿蜒路径：刘看山沿路径循环移动，走过路径变金色并留下脚印，节点可点击弹出步骤
- 复习卡片精简为概念卡 + 思维导图：概念名衬线金色 32px/700 居中，思维导图 Xmind 式放射布局
- 移除复习卡导出按钮；21 天日历浅蓝未点亮、金色已点亮、当天蓝色描边
- 费曼陪练重命名为看山对练：先选观点，AI 扮反方进行 3 轮对练，结束生成理解评分与薄弱点；评分页展示五维评分详情、「我的理解」摘要，可导出草稿回流知乎
- 全局顶栏 60px：Logo + 刘看山头像 + 居中链接输入 + 蓝色渐变炼金按钮 + 登录/用户菜单
- 字体层级：标题用 Noto Serif SC，概念名衬线金色，标签/数字用 SF Mono，正文系统无衬线

## 核心流程

```text
知乎链接/正文/收藏夹 → 炼金 → 学习包 → 主动回忆 → 薄弱反馈 → 间隔复习 → 再创作 → 导出/回流知乎
```

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 代码检查
npm run check

# 启动开发服务器（支持热重载）
npm run dev

# 启动生产服务器
npm start
```

本地预览地址：`http://127.0.0.1:4173/`

### Mock 模式

未配置 `LLM_API_KEY` 或设置 `CUZHI_LLM_MODE=mock` 时，系统使用内置模板生成学习包和再创作内容，不调用外部服务，适合本地评审与离线演示。

```bash
# 强制 Mock 模式
CUZHI_LLM_MODE=mock npm start
```

### 内置示例预烘焙（推荐）

首页三个内置示例（存在主义 / 裸辞 / 考研）支持预烘焙：用真实 LLM 一次性生成高质量管线结果，
并存入 `server/lib/baked/`。命中烘焙后，炼金接口**不再调用 LLM**，返回从 ~20s 降到毫秒级，适合演示与压测。

```bash
# 生成（部署前执行一次；需要配置 LLM_API_KEY）
npm run bake

# 强制使用 Mock 模板重新生成（无密钥也能跑通，但为模板结果）
CUZHI_LLM_MODE=mock npm run bake
```

> 提示：`npm run bake` 会覆盖 `server/lib/baked/*.json`，这些文件应在部署产物中保留（否则退回真实 LLM）。

### 性能与加载

- 首页动画素材（刘看山 GIF）已压缩至总计约 763KB；非首屏 GIF 使用 `loading="lazy"` 延迟加载
- 静态资源缓存策略：HTML `no-cache` + ETag，CSS/JS 1 小时，图片/字体 7 天
- 炼金进度条由服务端 NDJSON 流式阶段驱动（真实步骤），失败时不再泄漏定时器
- 一键性能检查（需要本地服务在 4173 端口）：

```bash
npm run perf
```

## 环境变量

复制 `.env.example` 为 `.env`（或直接在部署平台配置）：

| 变量 | 说明 | 默认值 | 必需 |
|---|---|---|---|
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` | 否 |
| `LLM_API_KEY` | LLM 密钥；不配置时自动 Mock | - | 否 |
| `LLM_MODEL` | 模型名 | `gpt-4o-mini` | 否 |
| `CUZHI_LLM_MODE` | `auto` / `mock` | `auto` | 否 |
| `ZHIHU_OAUTH_APP_KEY` | OAuth App Key，生产环境通过平台 Secret 注入 | - | 是（登录功能） |
| `ZHIHU_ACCESS_SECRET` | 知乎开放平台 Access Secret，生产环境通过平台 Secret 注入 | - | 是（用户数据） |
| `CUZHI_DATA_DIR` | 本地 JSON 数据目录 | `.data/` | 否 |
| `PORT` | 服务端口 | `4173` | 否 |

## OAuth 部署

### 1. 配置知乎开放平台

1. 在 [知乎开放平台](https://open.zhihu.com/) 创建应用
2. 获取 `App ID` 和 `App Key`
3. 配置回调地址为 `https://<你的域名>/auth/callback`

### 2. 配置应用

```bash
# 在 hackathon.config.json 中填写 App ID
{
  "oauth": {
    "enabled": true,
    "appId": "你的App ID",
    "redirectUri": null
  }
}
```

### 3. 部署到 Cloudflare Pages

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 部署
npm run deploy

# 配置环境变量（在 Cloudflare Dashboard 中设置）
# ZHIHU_OAUTH_APP_KEY=你的App Key
# ZHIHU_ACCESS_SECRET=你的Access Secret
```

### 4. 部署到 Sealos

```bash
# 构建 Docker 镜像
docker build -t cuizhi .

# 推送到 Sealos 镜像仓库
# 在 Sealos 控制台创建应用并部署

# 配置环境变量（在 Sealos 控制台中设置）
# ZHIHU_OAUTH_APP_KEY=你的App Key
# ZHIHU_ACCESS_SECRET=你的Access Secret
# PORT=4173
```

### 5. 配置回调地址

部署完成后，获取公网 HTTPS 域名，执行：

```bash
node scripts/configure_callback.mjs \
  --project-dir . \
  --redirect-uri https://<公网域名>/auth/callback
```

然后在知乎开放平台更新回调地址。

### 6. 本地 OAuth 状态

- 本地地址只能预览页面，无法完成真实知乎登录
- 未部署前 OAuth 状态显示"等待部署"
- 回调不带 state 时页面提示"仅适合临时联调"

## API

| 路由 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/oauth/status` | OAuth 状态（凭证只显示脱敏信息） |
| `GET /auth/login` | 发起知乎 OAuth |
| `GET /auth/callback` | OAuth 回调 |
| `POST /api/alchemy` | 链接/正文炼金 |
| `GET /api/packages` | 学习包列表 |
| `GET /api/packages/:id` | 学习包详情 |
| `POST /api/packages/:id/review` | 卡片自评 |
| `POST /api/packages/:id/recreate` | 生成我的理解与回答草稿 |
| `GET /api/packages/:id/export?format=md\|html` | 导出 |
| `GET /api/me/contents` | 本人创作 |
| `GET /api/me/followees` | 本人关注 |
| `GET /api/me/favlists` | 收藏夹列表 |
| `GET /api/me/favlist_contents` | 收藏夹内容 |
| `GET /api/me/collections` | 近期收藏 |
| `POST /api/favlists/:urlToken/alchemy` | 整夹炼金 |

## 知乎开放平台接入层

`server/lib/zhihu.js` 是独立的知乎接入模块，按官方 Skill 契约实现：

- `extractFromUrl(url)`：解析问题/回答/文章 ID 与链接
- `fetchContent(questionIdOrUrl, { limit })`：拉取优质回答，按回答优先、赞同、权威度、相关性综合排序
- `fetchFavorites(accessToken)`：OAuth 后读取收藏夹列表与内容（`Authorization: Bearer` + `X-OAuth-Token`）
- `searchZhihu` / `fetchHotList` / `zhidaAnswer`：搜索、热榜、直答能力

统一缓存 24 小时；所有请求带超时、重试与错误分类（网络、鉴权、限流、服务端）。无凭证或接口失败时自动回退 Mock，并返回 `demo: true` 与「当前为演示数据」提示，保证流程不中断。

真实验收：

```bash
ZHIHU_ACCESS_SECRET=<你的 Access Secret> npm run zhihu:smoke
```

## Agent 学习管线

`agents/` 下实现 4 个 Agent 与统一编排：

| Agent | 输出 |
|---|---|
| `viewpointAgent` | 观点光谱：立场、论据链、共识点、分歧本质 |
| `mapAgent` | 认知地图：核心概念、学习路径、常见误区、应用场景 |
| `cardAgent` | 复习卡片：间隔重复卡片集 + 1/3/7/21 排期 |
| `coachAgent` | 费曼陪练：多轮对话，按需生成"我的理解 / 回答草稿" |

编排入口是 `agents/pipeline.js`：`fetchContent → viewpoint → map → cards`，coachAgent 按需调用。所有 Agent 的 LLM 调用走 `server/lib/llm.js`，强制 JSON mode，输出用 `agents/schemas.js` 的 JSON Schema 校验，失败自动修复重试一次；单 Agent 失败会降级为占位结果并把提示传给前端。

接口：

```text
POST /api/pipeline
{ "url": "https://www.zhihu.com/question/365536909" }
# 或
{ "answers": [{ answerId, author, title, summary, content, ... }] }
```

## 安全说明

- OAuth Token 只存 Node 进程内存会话，不写文件、不写日志、不返回前端
- Access Secret 与 OAuth App Key 使用独立的 Secret 配置，显示时仅保留脱敏前缀
- 部署前运行 `npm run check`，敏感扫描会拦截配置中出现的密钥字段
- 所有凭证通过环境变量或平台 Secret 注入，不进入源码

## 测试与检查

```bash
npm test
npm run check
```

## 部署验证

### 1. 登录/登出功能

```bash
# 启动服务
npm start

# 访问 http://127.0.0.1:4173/api/oauth/status
# 检查 OAuth 状态

# 访问 http://127.0.0.1:4173/auth/login
# 应该返回 400 错误，提示"等待部署"
```

### 2. 线上功能验证

```bash
# 访问 https://<你的域名>/api/health
# 应该返回 ok: true

# 访问 https://<你的域名>/api/oauth/status
# 检查 OAuth 配置状态

# 测试登录流程
# 点击"登录知乎"按钮，应该跳转到知乎授权页
# 授权后回调到 /auth/callback，自动登录
```

### 3. Mock 模式验证

```bash
# 不配置 LLM_API_KEY 启动服务
npm start

# 粘贴知乎链接或正文，点击"开始炼金"
# 应该使用内置模板生成学习包
```
