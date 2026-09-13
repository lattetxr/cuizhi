# 淬知 × 知乎开放平台能力优化方案

> 基于官方 zhihu Skill / CLI 0.5.0 的能力清单（`capabilities`）与 2026-09-13 实测结果，
> 围绕 **知乎搜索、知乎知识库（知识 RAG）、直答 Agent** 三条主线，把现有「炼金管线」
> 升级为「真实知乎语料取数 → 结构化炼金 → 沉淀个人知识库 → 智能检索复用」的闭环。

## 0. 实测事实（本项目 Access Secret，2026-09-13）

| 能力 | 端点 | 实测 | 每日额度（本账号套餐） |
|---|---|---|---:|
| 知乎搜索 | `GET /api/v1/content/zhihu_search?Query&Count(≤10)` | ✅ 返回 Title/ContentID/ContentType/AuthorName/AuthorSignature/ContentText/Url/RankingScore | 10 |
| 全网搜索 | `GET /api/v1/content/global_search?Query&Count(≤20)&SearchDB&Filter` | 未消耗实测 | 10 |
| 热榜 | `GET /api/v1/content/hot_list?Limit(≤30)` | 未消耗实测 | **2** |
| 直答 | `POST /v1/chat/completions`，模型 `zhida-fast-1p5`/`zhida-thinking-1p5`/`zhida-agent` | ✅ zhida-fast 正常，OpenAI 兼容响应 | **2（极紧）** |
| 知识库列表 | `GET /api/v1/knowledge/bases?Scope=all|created|subscribed` | ✅ 已有 1 个默认私有库（`<默认私有库 ID 已省略>`，0 条） | 500（知识库合计） |
| 知识库内容 | `GET /api/v1/knowledge/bases/{id}/items`（游标分页） | — | 500 |
| 知识库检索 | `POST /api/v1/knowledge/search`（scope: personal/subscription/public，limit ≤10，可多 base-id） | — | 500 |
| 知识库上传 | `POST /api/v1/knowledge/files`（单文件 ≤100MiB，multipart，有副作用，不自动重试） | — | 500 |
| 额度查询 | `GET /api/v1/quota` | ✅ user_data 1000（已用 45） | — |

公共约束：

- 所有请求 `Authorization: Bearer <Access Secret>` + `X-Request-Timestamp: <秒级时间戳>`。
- 直答**只正式支持 `model/messages/stream` 三个字段**：不保证 `response_format`、`temperature` 生效；
  `zhida-fast/thinking` 支持多轮 role/content，`zhida-agent` 为智能检索档（自带知乎语料检索）。
- 知识库接口身份是 **Access Secret 所属账号**（单租户），不随 OAuth 登录用户切换；
  OAuth 只影响 `/api/v1/user/*` 本人数据。
- 搜索/热榜/直答额度极小，**缓存与配额闸门是必做项，不是优化项**。

## 1. 现状盘点（代码事实）

- `server/lib/zhihu.js` 已封装 zhihu_search / hot_list 的调用、24h 内存缓存、
  错误分类（鉴权/限流/超时）和 Mock 兜底；但关键词炼金（`fetchContent`）为了凑回答，
  会按「标题→URL」最多打 **3 次** zhihu_search（10 次/天额度下，3-4 个用户就打满）。
- `searchZhihu()`、`fetchHotList()` 已实现但**没有任何路由使用**。
- 结构化 Agent（观点光谱/认知地图/卡片）走 `callStructuredJson`：
  依赖 JSON 输出 + Ajv 校验 + 1 次修复重试；生产模型是通义 qwen（OpenAI 兼容）。
- `lib/llm.mjs` 的 `callLlm` 是标准 OpenAI Chat Completions 客户端，
  切换 baseURL/model 即可直连知乎直答，但当前固定发送 `response_format`/`temperature`。
- 已有 Markdown/HTML 导出（`lib/export.mjs` 的 `toMarkdown`），可直接作为知识库上传物。
- 用户中心已接入 OAuth：收藏夹/关注/创作，分页「加载更多」已就绪。

## 2. 优化总览

```
热榜 ──┐
关键词 ─┼─► zhihu_search（1 次取数，去重聚合）─► 结构化炼金（qwen 主力，保 JSON）
问题URL┘                │                                    │
                        ├─ global_search（按需补外部证据）    ├─ zhida-fast：一句话导读/Query 改写（缓存）
                        │                                    ├─ zhida-thinking：深度解读（手动触发）
                        ▼                                    └─ zhida-agent：看山对练（SSE 流式，自带检索）
              观点卡片挂原文来源/作者链接                              │
                        ▼                                            ▼
              学习包 Markdown ──► knowledge/files 存入默认库 ──► knowledge/search RAG
                        │                                            （教练对练/再创作时召回，附引用）
                        └──────────────► 用户中心「我的知识库」浏览/检索/二次炼金
```

---

## 3. 主线一：知乎搜索 —— 让炼出来的每个观点都有真实出处

### P0-1 关键词炼金改为「单次直搜 + 按问题聚合」（省配额、提质量）

- 新增 `POST /api/alchemy/search`（或在现有 `/api/alchemy` 的 search 分支）：
  关键词输入只调用 **1 次** `searchZhihu(query, {count:10})`，不再走 `fetchContent` 的三次猜测。
- `mapSearchItems` 之后增加按问题聚合：同一问题下保留赞同数/权威度最高的 3–5 个回答，
  保证「观点光谱」天然有立场冲突（debate 类的核心价值），凑不足时再用第 2 次搜索补 query 改写词。
- 每个来源保留 `Url / AuthorName / AuthorSignature / RankingScore`，在管线中透传：
  - 观点光谱每条 stance 已带 `source_answer_ids`，前端增加「查看原始回答」链接列表；
  - 卡片详情展示作者与原文链接，输出物（MD/HTML/知识库归档）附来源章节。
- 返回里的 `SearchHashId` 作为幂等/缓存键的一部分。

### P0-2 热榜入口（`hot_list` 2 次/天 → 服务启动时缓存 24h，全员共享一次调用）

- 首页新增「🔥 今日热榜炼一题」：服务端单飞（single-flight）请求 + 24h 缓存，
  所有用户共用，不随刷新重复消耗；点击热榜条目直接进入该议题炼金。
- 热榜只做发现，不做事实依据（符合 Skill 使用边界）。

### P1-3 全网搜索作为「外部证据」按需层（默认关闭）

- 争议/科普类学习包增加按钮「补充站外证据」，点击才打 1 次 global_search，
  结果作为独立 section（与知乎观点分开展示，不混源），供认知地图补事实边界。
- 用 `SearchDB=all`，必要时用 `Filter` 限定权威站点；接口形态上线前用一次真实调用固化字段映射。

### 配额保护

- 后端按 API ID 做令牌桶 + 当日计数（内存即可，部署重启走 `/api/v1/quota` 校准）；
  zhihu_search/global_search/hot_list 命中 30001/30002 时降级为缓存 → baked 示例 → Mock，并沿用现有「演示数据」提示条。
- 搜索缓存 TTL：zhihu_search 7 天、hot_list 24 小时、global_search 3 天；
  key 含规范化 query 与 count。

## 4. 主线二：知乎知识库 —— 把炼金成果沉淀为可 RAG 的个人资产（最大差异化）

> 知识库额度 500/天且账号已有默认私有库，是三条线里额度最宽裕、最值得重投入的。

### P0-1 学习包一键归档（`knowledge/files` 上传）

- 学习包页新增按钮「📥 存入我的知乎知识库」：
  后端用 `toMarkdown(pkg)` 生成 `cuizhi-<类型>-<短哈希>-<日期>.md`（含标题、目标、
  光谱、概念、卡片、路径、全部来源链接），multipart 上传到默认知识库（省略 base-id）。
- 新增 `server/lib/knowledge.js`（Railway 容器内没有 CLI，必须直连 HTTP；本地用 CLI smoke 验证）：
  `listBases()` / `listItems(baseId, cursor)` / `searchKnowledge({query, scopes, baseIds, limit})` /
  `uploadFile(file, baseId?)`，沿用 `requestJson` 同款鉴权、超时与错误分类；上传类请求**不自动重试**。
- 包记录上保存 `knowledgeFileId/baseId`，按钮变为「已归档 · 再次查看」，防重复上传（有副作用操作需用户显式点击）。

### P1-2 教练对练接入知识库 RAG（`knowledge/search`，500/天，可默认开启）

- 「看山对练」提问时，用「当前包核心问题 + 用户问题」检索 scope=personal 的 Top3 文档片段，
  作为上下文注入，并在回答下渲染引用出处；无结果时静默退化为仅学习包上下文。
- 形成产品闭环：**收藏夹炼金 → 学习包归档 → 下次提问自动召回自己的历史沉淀**。

### P1-3 用户中心新增「我的知识库」区

- 复用现有「加载更多」模式：`knowledge bases` 列库（all/created/subscribed 分栏），
  `items` 游标分页列内容；支持库内关键词检索（`knowledge/search`），
  每条结果提供「用这篇再炼一次」（进入搜索/链接炼金）。

### P2-4 公共/订阅库选题

- home 增加「订阅知识库推荐」入口（scope=subscribed/public 检索热门主题），
  作为没有收藏夹的新用户的冷启动素材。

## 5. 主线三：直答 Agent —— 用在刀刃上（2 次/天），结构化主力仍保留 qwen

直答只保证 model/messages/stream，且结构化 Agent 目前带 1 次 JSON 修复重试，
**一次失败修复就会吃掉整天全部额度**。因此分工如下：

| 场景 | 模型 | 理由 |
|---|---|---|
| 观点光谱/认知地图/卡片（结构化 JSON） | **维持 qwen**（或私有化大模型） | 需要 response_format/稳定 schema/修复重试，直答额度与契约都不适合 |
| 学习包「一句话导读」、搜索 Query 改写 | `zhida-fast-1p5` | 短文本、快；按包/按 query **永久缓存**，每包最多 1 次 |
| 「深度解读」按钮（展示 reasoning_content 分析过程 + 结论） | `zhida-thinking-1p5` | 用户手动触发，思考过程本身是产品卖点；结果缓存 |
| 看山对练自由问答 | `zhida-agent`（智能检索档） | 自带知乎语料检索，减少幻觉；`stream=true` 走 SSE 透传 |

实施要点：

1. 新增 `callZhida({model, messages, stream})`（`lib/zhida.mjs`）：只发三个官方字段；
   非流式按 OpenAI 兼容结构取 `choices[0].message.content`（thinking 另有 `reasoning_content`）；
   流式透传 SSE，正确处理 `: keep-alive` 心跳与中途错误 `finish_reason=error`；**POST 不额外重试**。
2. 新增路由：`POST /api/zhida/brief`（导读，缓存）、`POST /api/zhida/deep`（深度解读，缓存）、
   `GET  /api/zhida/coach?stream=1`（或 POST + fetch ReadableStream 转发）。
3. `zhida-agent` 多轮上下文未在正式保证范围内：每次把学习包摘要 + 本轮问题打包成单轮请求，
   不在服务端拼接多轮历史。
4. 配额闸门（必做）：
   - `GET /api/zhihu/quota` 代理 `/api/v1/quota`，服务端缓存 60s；用户中心/炼金页展示
     「今日直答剩余 N/2、搜索剩余 N/10」；
   - 当日 zhida 已用 2 次时，深度/对练按钮降级为 qwen 并提示，核心流程永不被额度卡死。
5. 前端对练改 SSE：参考现有炼金 NDJSON overlay 的流式 UI，打字机输出 + 「知乎智能检索」徽标。

## 6. 工程与演示保障

- **配额感知网关**：所有平台调用统一经过 `server/lib/zhihu.js` 的 wrapper：
  按 API ID 计数、分级缓存、30001/30002 自动降级（缓存 → baked → Mock），提示条沿用现有 demo 标记。
- **缓存持久化（P1）**：Railway 内存缓存重启即失（与 OAuth 会话同问题），
  接 Railway Redis/插件 KV 存搜索结果与 zhida 缓存，进一步省配额。
- **演示零配额方案**：把热榜、2-3 个标准议题的搜索结果与 zhida 导读用 `scripts/bake-examples.mjs`
  预烘焙进仓库（现有机制），路演断网/打满额度也不翻车；真实接口只在显式按钮触发。
- **测试**：沿用 `__setTransport` 注入假响应，新增 zhihu_search 单次取数聚合、
  knowledge 上传/检索、zhida SSE 解析、配额闸门降级四组单测。
- **合规边界**：知识库上传只在用户显式点击后发生；界面说明知识库归属 Access Secret 账号；
  不在日志/前端输出任何密钥与原始 token；全局搜索与知乎搜索分源展示。

## 7. 落地排期建议

| 优先级 | 事项 | 预估 | 验收 |
|---|---|---|---|
| P0 | 单次 zhihu_search 聚合取数 + 来源链接；热榜单飞缓存；quota 接口与配额闸门；学习包一键入知识库 | 0.5–1 天 | 关键词炼金只耗 1 次搜索；学习包 Markdown 出现在默认知识库 |
| P1 | zhida-agent SSE 看山对练（qwen 兜底）；knowledge RAG 注入对练；用户中心知识库浏览/检索 | 1 天 | 对练流式输出且引用知识库片段；库内容可分页、可再炼 |
| P1 | 持久化缓存（Railway Redis/KV） | 0.5 天 | 重新部署后缓存与配额计数不丢 |
| P2 | global_search 外部证据；zhida-thinking 深度解读；订阅库推荐 | 1 天 | 争议包可按需补站外证据；深度解读展示思考过程 |

## 8. 风险与注意

- **直答 2 次/天**是本方案最硬的约束：任何自动化路径都不得默认调用直答；上线后先用 `/api/v1/quota` 确认线上套餐额度。
- `zhida-agent` 实际是否可用受租户授权影响（文档明示），代码必须做模型不可用→qwen 的降级。
- knowledge HTTP 的 multipart 字段名/游标响应以 CLI 0.5.0 实际请求为准，开发时先用
  `zhihu-cli knowledge upload --progress` / `knowledge items` 各做一次最小真实验收再固化。
- 搜索返回的是摘要不是全文，观点分析仍应提示「基于摘要」，需要原文时给链接跳转。
