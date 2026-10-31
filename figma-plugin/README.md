# Icon Lab · Figma 单图标同步 v0.3.1（开发试用版）

选中一个 Frame、Component 或 Instance → 检查 SVG 预览 → 补充元数据 → 确认同步 → 在工作台检索复用。重复同步由同一后端检查；更新需要再次确认，并保留历史版本。所有同步资产当前均为“已登记 · 未审核”。

此包连接现有个人试点资产库。公司禁止外传的素材应留在公司环境；后续公司部署需使用获批后端另行打包。

## 从首版更新到 v0.3.1

先关闭 Figma 中正在运行的插件。解压新包，将包内 **code.js 和 ui.html** 一起覆盖到原来导入的插件文件夹，保留原 manifest.json（避免丢失客户端分配的 ID）。再运行插件，滚动到底部确认显示 **v0.3.1 · 读取修复版**。也可以将新包放在固定位置后重新导入其 manifest。

此版修复消息接收依赖 Window 身份导致的空预览，增加当前运行的桥接标识匹配、读取超时提示、按钮禁用原因和深色预览底。白色图标可点击“深色底”查看；预览底色不改变上传 SVG。

## 安装一次

1. 将整个插件文件夹保存在固定位置，保留 manifest.json、code.js、ui.html 三个文件。
2. 打开 **Figma 桌面版** 和一个 Design 文件。在插件的 Development / 开发菜单中选择 **Import plugin from manifest… / 从 manifest 导入插件**，选中本文件夹的 manifest.json。菜单位置以 [Figma 官方安装指南](https://help.figma.com/hc/en-us/articles/38457121114263-Create-a-Figma-Design-plugin-with-the-Figma-MCP-server-and-agentic-tools) 为准。
3. 在 Development 菜单运行 **Icon Lab · 单图标同步**。

这是可本地导入的开发包，不是已上架的 Community 插件。manifest 中的文本 ID 用于本地试用，未代表注册的发布 ID；正式发布需由 Figma 分配 ID，参见 [官方 manifest 说明](https://developers.figma.com/docs/plugins/manifest/)。若客户端要求绑定正式 ID，使用 Development → New plugin 创建插件，将生成的 ID 填回本 manifest，保留其他字段，再导入。

团队试用时每位成员导入同一份开发包，无需安装 MCP。组织内正式分发放在实机验收后处理。

## 同步第一个图标

1. 在画布选中一个图标的 Frame 或 Component，只选一个；建议先用 24 × 24 的个人演示图标。
2. 插件显示实际导出的预览和节点 ID。使用与工作台相同的邮箱、密码登录；无需填写 URL、Key 或 Figma Token。
3. 选择目标工作空间，填写名称、平台、视觉类型、状态和标签。
4. 粘贴**当前设计文件**的 Figma 链接。普通插件无法自动获取文件 Key，因此需要补充此链接；节点 ID 会自动取自当前选区。[Figma fileKey 权限说明](https://developers.figma.com/docs/plugins/api/figma/#filekey-string--undefined-readonly)
5. 确认预览与目标空间后，点击“确认同步到资产库”。只有此时才会提交图标。
6. 打开 [工作台](https://xueyingz90.github.io/icon-lab/)，登录同一账号，选择同一空间并刷新，搜索刚才的名称。

链接的旧 node-id 会替换为当前节点的 ID。普通插件无法核实手填链接是否属于当前文件，请自行确认。画布选区变化仅更新本地预览；不会自动上传。插件不修改 Figma 设计节点。

## 更新同一图标

修改图标后点击“重新读取”，检查新预览，再同步。系统若发现同一来源或相同内容，会显示已有资产名称、版本、状态和来源；确认后点击“确认更新版本”。内容和全部元数据都相同则不会新增版本。

若想登记另一个状态，取消更新并修改状态字段后重新同步。相同来源与变体只保留一个资产记录，不提供绕过去重的强制复制。

如果资产已被其他成员更新，本次提交会被拦截；重新同步检查最新版本即可。同步前还会再次导出选中节点核对预览，避免提交已变更的选区或旧画面。

## 账号与权限

- 插件使用已注册、已确认邮箱的工作台账号，注册仍在个人保存的工作台账号入口完成。
- 首次登录无工作空间时，创建“我的图标库”；已有空间时直接选择。其他成员需要空间所有者授权。
- 只读成员不能同步；数据库也会再次检查编辑权限。
- 密码和会话不写入 Figma 文件、clientStorage 或浏览器存储。关闭插件后需重新登录；退出只结束当前插件会话。
- 网络只允许访问当前 Supabase 项目，无远程脚本、遥测或后台同步。

## 当前范围与限制

支持单图标 SVG 导出和安全校验，最大 1MB。文字以轮廓导出；不支持的滤镜、嵌入图片或复杂 SVG 属性会明确报错，不会静默删改。多图标批量、语义相似识别、正式审核、iconfont 发布、AI 生成和 MCP 均不在此版本中。

自动化已覆盖来源规范化、消息桥接、过期导出丢弃、实际打包 UI 的登录、入库、重复确认、版本冲突和权限拦截。现有后端的数据库测试覆盖隔离及不可变历史。**用户已导入首版并反馈预览问题。v0.3.1 已完成模拟桥接回归，但真实客户端预览与同步仍待更新后复验。**

## 维护与构建

在仓库根目录运行：

```sh
npm run build:figma
npm test
```

构建不下载依赖：复用根目录的 SVG 校验、CloudClient 和公开连接配置，生成单个内联 ui.html。修改源文件后应重新构建再分发。不要直接修改生成的 ui.html。

Figma API 参考：[SVG 导出](https://developers.figma.com/docs/plugins/api/ExportSettings/)、[网络域名限制](https://developers.figma.com/docs/plugins/making-network-requests/)。
