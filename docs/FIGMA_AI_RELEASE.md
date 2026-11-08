# Figma 插件 v0.5.0 发布说明

新增选区 AI 生成，保留已有上传、重复确认、版本更新、资源库及记住登录。

## 实现

- 三个页签：上传图标、资源库、AI 生成。
- 读取单个 Frame / Component / Instance 的 SVG、256px PNG 预览及原生尺寸、描边、端点、连接和颜色；本地读取不发送素材。
- 原始参数与生成目标分开显示，混用字段留空待指定，留白预设需人工确认。AI 风格分析可选，分析后须再确认。
- 支持 2000 字符多行需求与场景、三个不同候选、方形和矩形尺寸，复用共享 AI 校验。
- 插入候选为独立矢量，放在参考旁，设置撤销边界，保留原图。切到原上传页，附带生成摘要；不自动入库。
- 完整需求、规范、模型、时间和参考节点保存在生成节点插件数据中；云端现有备注仅保存最长 500 字符摘要。
- 选区、参考内容、目标参数、需求、账号及工作空间变化会使相关确认或结果失效。采用当前页面 nodechange，不加载整份文件。
- 个人 Qoder 沿用工作台账号配置，密钥仅在服务端使用。

## 结构

旧主线程实现移至 figma-plugin/src/main.js；新增 ai-main.js 与 ai.js。构建脚本仍输出 manifest 指定的 code.js 和 ui.html。旧上传的 sync-core.js 与登录 session.js 未改动。界面和资源库仅增加页签切换及生成结果接入。

云端共用 supabase/functions/icon-ai/handler.ts，两个薄入口分别服务网页和插件。网页精确来源白名单保留；插件接口接受原生无 Origin、opaque null 及 Figma 来源，仍必须验证用户 JWT 和 AI 白名单。客户端标记不是授权凭据。插件接口仅开放生成、分析与配置状态查询，个人密钥写入仍在网页完成。

## 验证

完整自动检查：346 项通过，0 失败。新增测试将真实打包的 UI 与主线程联调，模拟 Figma API 和模型，涵盖 32×32 / 48×32、原生参数、授权、混用字段、候选校验、过期结果、插入、生成记录和原上传复用。旧插件测试仍通过。

实际网络探测：插件接口预检 204，Access-Control-Allow-Origin 为精确 null；未登录请求 401。icon-ai-figma v1 与 icon-ai v9 均已部署 ACTIVE，verify_jwt=true。

浏览器 420×720 窄面板完成布局检查。Figma 桌面自动化未能完成插件导入及运行，因此真实客户端的 AI 生成、可编辑性、撤销及入库尚未验收；不能把模拟结果视为实测。原版上传已由用户确认跑通。

## 更新

关闭旧插件，备份安装目录，用新版 code.js 和 ui.html 替换同名文件，保留旧 manifest.json 的真实插件 ID。运行后核对底部 v0.5.0。选一份公开测试图标，按读取 → 确认 → 生成 → 插入 → 上传操作，检查撤销及原图保留。

参考：[Figma 网络请求](https://developers.figma.com/docs/plugins/making-network-requests/)、[页面动态加载与 nodechange](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/)、[撤销边界](https://developers.figma.com/docs/plugins/api/properties/figma-commitundo/)。
