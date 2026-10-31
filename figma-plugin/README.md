# Icon Lab · 同步与资源库 v0.4.0（开发包）

保留已跑通的单图标同步，新增“资源库”：从同一云端空间检索已有 SVG 并插入当前 Figma 页面。无需 MCP，无新增 Token 或第二套后端。

## 更新

先完成[分类迁移与网页部署](../docs/TAXONOMY_AND_LIBRARY.md#部署顺序已有项目)，再关闭正在运行的旧插件。解压新包，用 **code.js 和 ui.html** 覆盖原安装目录同名文件。保留原 manifest.json 中 Figma 分配的 ID。本版开发 ID 与旧包一致，manifest 的网络域名也不变。重新运行，底部应显示 **v0.4.0 · 分类与资源库**。

## 首次安装

整个插件文件夹保存到固定位置，在 Figma 桌面版的 Plugins → Development → Import plugin from manifest 导入 manifest.json，再运行插件。若客户端要求正式 ID，先在 Development → New plugin 创建插件，把分配的 ID 填回 manifest，保留其余配置。[官方 manifest 说明](https://developers.figma.com/docs/plugins/manifest/)

这是本地开发包，尚未上架 Community；另一台电脑需要传整个文件夹并重新导入。团队成员无需安装 MCP。

## 上传图标（原链路）

1. 只选一个图标 Frame、Component 或 Instance；预览出现后核对尺寸和节点。
2. 用工作台已注册并确认邮箱的账号登录，选择目标空间。
3. 填写名称、状态及当前 Figma 文件链接，四个分类维度均可选填：结构、风格、颜色模式、平台。未知时保留未分类。
4. 点击“确认同步到资产库”。同来源或内容重复时继续沿用原确认更新流程，历史保留；版本冲突仍会拦截。

选区变化只更新预览，不会自动上传。同步前会再次导出核对图标；没有修改现有上传实现。白色图标可切换深色底。

当前文件 Key 通常需要手填，节点 ID 自动取自选区。旧 node-id 会替换成当前节点 ID；普通插件无法核实手填链接是否属于当前文件，请自行确认。[fileKey 权限说明](https://developers.figma.com/docs/plugins/api/figma/)

## 从资源库插入

1. 登录同一账号和空间，切换“资源库”。
2. 输入名称，按结构、视觉风格组合筛选；点击“重置”可清空。每次加载 24 项，可继续“加载更多”。
3. 核对缩略图，点击“插入画布”。图标插入当前页面视口中心，自动选中，可继续编辑 Figma 支持的矢量内容。

使用 [figma.createNodeFromSvg()](https://developers.figma.com/docs/plugins/api/figma/)，不生成截图。只读成员可以检索和插入；上传仍需编辑权限。调用不创建资产、不增加版本，和网页共用原 il_assets / RLS / 登录 API。

PNG 等资源会提示非 SVG，按钮不可点。现有安全校验不支持的外部图片、脚本、滤镜等也会明确报错。本版不新增图片插入，也不批量插入。复杂 SVG 的可编辑性和效果受 Figma 支持范围限制。

## 账号与数据

沿用现有个人试点资产库。账号、密码、会话不写入 Figma 文件、clientStorage 或浏览器存储，关闭插件后需重新登录。账号/空间切换会清空列表并丢弃过期查询。网络只允许现有 Supabase 域名；没有远程脚本、遥测或后台上传。

公司禁止外传的素材应留在公司批准的环境，不上传个人试点后端。

## 构建与验收

```sh
npm run build:figma
npm test
```

无需生产依赖。构建复用 taxonomy.js、catalog-core.js、CloudClient 和公开连接配置生成单个内联 ui.html；修改 src 后重新构建，不直接编辑 ui.html。

自动化 21 项通过，涵盖旧上传、旧数据迁移、四维筛选、真实打包 UI 与主线程的模拟联调、分页/切换/会话失效，以及插入的 SVG API、定位、选中、错误处理。旧上传链路已由用户确认跑通；本版还需在真实客户端复验上传和矢量可编辑性。完整验收步骤与已知限制见[开发记录](../docs/TAXONOMY_AND_LIBRARY.md)。
