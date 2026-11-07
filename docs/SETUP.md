# 资产库基础版：开通云端保存

此版本保留原动效工作台，新增资产登记、搜索筛选、详情、来源、历史版本、重复提示、账号与工作空间。

当前增量版本增加多维分类与 Figma 资源库，请按[本次迁移与部署步骤](TAXONOMY_AND_LIBRARY.md)执行。以下已部署状态指此前的资产库基础版，分类迁移已于 2026-10-31 完成，见 [发布记录](DEPLOYMENT.md)。

## 当前部署状态（2026-10-31）

个人原型项目 icon-lab 已创建，表与版本管理 RPC 已部署，cloud-config.js 已写入公开连接配置。真实数据库的事务回滚测试通过，安全 advisors 无告警。性能检查仅提示新建索引尚未使用，待真实负载后再评估：[官方说明](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。

你现在只需：
1. 打开 https://supabase.com/dashboard/project/blolhaacvmciirmiovdo/auth/url-configuration ，把 Site URL 设置为 https://xueyingz90.github.io/icon-lab/ 并保存。如需填写 Redirect URLs，也加入同一完整地址。
2. 使用个人保存的账号设置入口（首页已隐藏入口），无需再填 Project URL 和公钥，使用邮箱和密码注册。当前 Email 登录已启用、注册已开放、邮箱确认已开启，需要你本人打开确认邮件；注册后的账号与 Supabase 管理后台账号相互独立。
3. 确认邮箱后返回工作台登录。再在第二台电脑用同一工作台账号登录，验收同步。

以下是从零部署或重新建立项目时使用的备用说明，不需要对已部署项目重复执行建表脚本。

## 备用：从零部署步骤

优先启用并连接 Supabase。连接确认后，可由开发助手继续检查项目并执行数据库部署。账号登录、创建项目时的条款或费用确认、邮箱验证需要你本人完成。

若自行配置，按以下顺序：

1. 在 https://supabase.com/dashboard 创建一个用于个人原型的项目。数据库密码自行保管，不要填到网页或发到聊天中。
2. 打开该项目 SQL Editor，先完整执行 `backend/001_asset_library.sql`，再依次执行 `supabase/migrations/20261031112854_icon_standards.sql` 与 `supabase/migrations/20261031125455_asset_taxonomy.sql`。初始脚本用于新项目，不要在已有项目反复执行。
3. 在 Authentication 的 URL 配置中，将 Site URL 设置为 `https://xueyingz90.github.io/icon-lab/`，并允许该地址用于确认回跳。配置 Email 登录。邮件注册验证需要项目可用的邮件发送配置；试用时也可由项目管理员在 Auth Users 中创建已确认的测试用户。
4. 在项目的 Connect / API Keys 位置找到 Project URL 与 Publishable key（通常以 `sb_publishable_` 开头）。旧的 anon key 也可使用。**不要使用 Secret / service_role key。**
5. 使用个人保存的账号设置入口，展开“高级连接设置”，填写上述两个公开配置，保存，然后注册或登录工作台账号。工作台账号与 Supabase 管理后台账号是两套身份。
6. 换电脑后，用相同后端配置和相同工作台账号登录。资产保存在数据库，不依赖原电脑在线。会话存储于标签页会话，关闭标签页后需要重新登录。

Project URL 和 Publishable key 可放进根目录 `cloud-config.js` 后发布，使每台电脑免于重复填写后端配置。它们是公开配置，用户权限由数据库和登录令牌执行。不要把管理员密钥提交到 GitHub。

用户已于 2026-10-31 确认真实账号登录及双机同步验收完成。以下步骤保留为后续部署的验收方法。

## 两台电脑验收

1. 电脑 A 登录，上传演示 SVG，填写名称、标签、平台、风格、状态、来源后确认入库。
2. 电脑 B 使用相同账号登录，点“刷新”，搜索并下载同一资产。
3. 从详情进入“更新版本”，修改名称或文件后保存，检查两份历史版本。
4. 两台电脑同时打开旧版本；先在一台更新，再在另一台提交，后提交应提示版本冲突。
5. 重复上传同一文件与信息，不应创建新版本。相同文件但不同元数据会提示已有资产，需人工进入已有资产更新。

## 团队小范围试用

对方先在同一后端注册账号并完成验证。空间所有者进入“添加成员”，填写注册邮箱并选择只读或编辑权限。该操作只授权已存在的账号，不发送邀请邮件。

只读成员可以查看、下载资产及历史版本；编辑成员可登记与更新；只有所有者可添加成员。未授权用户看不到此空间。不要把演示账号与公司内部图标混用。

## 数据与版本边界

- 本地试用、云端资产、旧动效工作台是三个明确区分的数据域。
- 连接云端不会自动上传已有本地数据；使用“登记本地图标”或“登记到资产库”逐项确认。
- 退出云端回到本地试用，云端失败不会静默改存本地。
- 备份保存当前加载的资产，当前页面最多加载最近 500 项。导入合并到本地，保留已有资产，不覆盖，也不恢复完整历史版本。超过试点规模后，应升级分页、数据库备份和服务器端检索。
- SVG 在展示、下载、导入时均校验；支持安全的 transform、渐变和内部裁剪引用；不支持脚本、事件、外部图片、外部引用与 CSS 样式表。
- 新资产保存后可直接复用，显示“已保存”，不设置强制审核；iconfont 发布尚未实现。
- 同步提交通过数据库事务执行；历史版本只能读，前端不能直接改表。
- Supabase 保存后不等于拥有公司原始 Figma 文件访问权。点击来源仍受 Figma 自身权限控制。

## AI 规范读取与图标生成

AI 链路支持 24 × 24 单色线性 SVG：参考 SVG 与 256px PNG 预览 → AI 规范建议 → 人工确认 → 一次请求生成三个候选 → 逐项结构与保守描边边界校验 → 对比选择 → 本地项目保存。模型返回含三个 `{name,d}` 的 `icons` 数组对象，只允许 M、L、C、Q、Z 绝对路径；程序按确认规范组装 SVG，拒绝重复路径。整组无效最多修正一次，未全部通过时保留上一组，不会用演示图标伪装成功。系统提示按分析/生成分别精简，参考 SVG、图片与用户填写的规范不截短；字符减少不等于实际 token 或 credits 同比例减少。三个候选共用一次调用，但输出费用可能高于单个结果。

### 本地联调

需要 Node.js 24。在项目根目录使用被 Git 忽略的 `.env`，参考 `.env.example` 选择一个服务端提供商。网页的“本地服务端 / Supabase 云端”只决定传输方式，不决定模型提供商。

OpenAI 兼容模式需要支持图像输入、JSON 输出的 Chat Completions 模型：

```dotenv
AI_PROVIDER=openai
MODEL_API_URL=实际的完整ChatCompletionsHTTPS接口地址
MODEL_API_KEY=仅服务端保管的模型密钥
MODEL_NAME=实际支持图像输入的模型名称
```

`MODEL_API_URL` 是完整请求地址，包含提供商要求的 API 路径；服务不会自行拼接 `/chat/completions`。未设置 `AI_PROVIDER` 时默认使用此模式。

Qoder Cloud Agents 使用 Managed API，不是 Chat Completions 接口：

```dotenv
AI_PROVIDER=qoder
QODER_PAT=仅服务端保管的个人访问令牌
QODER_AGENT_ID=专用Agent的资源ID
QODER_ENVIRONMENT_ID=已有运行环境的资源ID
QODER_MODEL=ultimate
QODER_MAX_CREDITS=10.00
```

专用 Agent 的模型必须与 `QODER_MODEL` 一致，`tools`、`mcp_servers`、`skills` 必须都是空数组，不能启用多 Agent 编排。适配器先验证配置并固定 Agent 版本，再为每次分析、生成或修复创建独立会话；发送参考统计、SVG 文本和 base64 PNG，不上传文件。模型正常完成后归档会话；超时或失败时尝试取消，确认空闲后才归档。取消或归档未确认时服务端会提示检查控制台，不能直接认定远端任务已停止。

`QODER_MAX_CREDITS` 是每个会话的软预算，不是本次推理费用硬上限：超过预算时当前轮仍可能完成，后续消息才会被拒绝。生成若触发一次修复，会使用另一个会话和预算。每次调用最多等待 60 秒；取消不保证即时停止计费。真实推理会消耗 Qoder 额度，图像能力与生成质量需另行验收。

所选提供商配置缺失时接口明确返回 503，不会产生模拟结果。不要把 PAT 或模型密钥放入 `cloud-config.js`、网页输入框或 Git；修改 `.env` 后重启本地服务。

```sh
npm install
npm run dev
```

打开终端显示的本地地址，进入“同风格生成”，选择“本地服务端”。上传参考后勾选发送确认，点击“AI 读取规范”，检查并编辑右侧规范，再点击“确认当前规范”。输入新图标描述并生成，检查语义后保存到项目资产。修改参考后需要重新读取；修改目标规范后需要重新确认。已有候选保留生成时的规范，不随目标修改而改变。

本地 API 仅绑定 127.0.0.1，拒绝跨 Origin 或缺少 Origin 的 POST。静态服务器不提供 `.env`、Git、后端与测试文件。限流和并发控制用于私人联调，不是持久的生产配额。

### GitHub Pages 与 Supabase

GitHub Pages 不能保管密钥或执行模型代理。保留静态前端，在已有 Supabase 项目部署 `supabase/functions/icon-ai/index.ts`；新增函数未自动发布。服务端按上方选择 `AI_PROVIDER` 和对应的 `MODEL_*` 或 `QODER_*` secrets，同时设置：

- `AI_ALLOWED_ORIGINS`：精确的网页 Origin，当前为 `https://xueyingz90.github.io`，不含 `/icon-lab/`；不允许通配符。
- `AI_ALLOWED_USER_IDS`：允许使用模型的已注册 Supabase 用户 UUID，多个用英文逗号分隔；不能填写邮箱。缺失时拒绝调用。
- Supabase 自动提供的 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 用于验证用户令牌，不使用模型密钥充当前端身份。

配置 secrets 后使用 Supabase CLI 部署 `icon-ai` 函数。不要关闭 JWT 验证。网页选择“Supabase 云端”，通过“云端账号”登录后即可调用；模型请求使用该登录会话。用户仍需勾选参考发送确认，登录并不自动上传素材。

云端按已验证用户限制请求频率与并发，但计数在函数实例内存中，实例重启或多实例不会共享；仅适用于明确用户白名单的私人原型。扩大用户范围前应接入持久额度、费用预算和监控。

AI 候选保存规范、输入描述、模型名称、生成时间与参考 SVG 快照；保存地点是“项目资产”的当前浏览器，不会自动同步到云资产库。清除浏览器数据会丢失本地项目，请备份。视觉重心、语义和风格一致性始终需要人工验收。

## 本地开发与验证

无前端构建步骤。`npm run dev` 同时提供静态页面和本地 AI 接口。仅查看原有资产与动效、不调用 AI 时，仍可使用静态服务器：

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

测试依赖只用于开发，不会被网页加载：

```sh
npm test
```

AI 自动化测试使用明确标注的模拟模型传输，验证协议、校验、失败路径与保存，不代表已经通过真实模型质量或上线验收。

测试覆盖 SVG 导入、重复与版本冲突、会话请求，以及真实 PostgreSQL 引擎中的工作空间隔离与角色权限。它们不能替代真实 Supabase Auth、邮件配置和两台电脑的上线验收。

## 本阶段之后

Figma 单图标同步已由用户确认跑通；当前开发包新增资源库，见 [安装与验收](../figma-plugin/README.md)。继续复用已有 `il_save_asset`，本版只增加兼容的分类字段。采用现有网络域名、仅本次运行的会话和显式更新确认。新版上传回归和矢量插入需实机验收。AI 接入见上方新增链路；审核发布、复杂形变和 MCP 尚未实现。

官方参考：
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/auth/passwords
