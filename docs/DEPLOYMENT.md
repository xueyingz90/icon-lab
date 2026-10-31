# 发布记录 · v0.6.2

2026-10-31 发布到现有 xueyingz90/icon-lab 的 main 分支，由 GitHub Pages 构建，沿用原站点与后端。

本版包括四维分类、Figma 同库检索与 SVG 插入、状态素材卡片直接上传、左侧纯文字菜单对齐。桌面与窄屏保留菜单文字，项目资产数量仍显示。

数据库分类迁移 `20261031125455_asset_taxonomy.sql` 已完成，仓库迁移版本与远端记录一致。迁移前后旧资产字段、原 SVG、版本与历史记录的校验值不变；RLS 仍开启，匿名用户不能读取资产。当前项目不要再次执行该迁移。

远端事务回滚验收通过：四维分类写入成功，旧客户端重复上传保持原版本；验收没有遗留测试资产。

已通过 22 项自动化测试。真实 Chrome 检查原生文件选择、SVG 导入、PNG 拖放/解码与刷新恢复；五个菜单文字左侧坐标一致，1440、1280 与 390px 宽度下无页面横向溢出或未捕获异常。Figma 插入的真实客户端可编辑性仍需实机确认。

开发阶段没有使用 MCP。用户另行授权仅发布阶段使用已连接的 GitHub、Supabase 工具。Figma 插件运行及团队安装无需 MCP。

入口：[Icon Lab](https://xueyingz90.github.io/icon-lab/?v=20261031-sidebar-10)。Pages 执行记录见 [GitHub Actions](https://github.com/xueyingz90/icon-lab/actions)。

本次检查发现既有 Supabase 账号配置尚未启用泄露密码保护，迁移前后提示相同，未修改账号设置。后续可按 [官方密码安全说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)在符合当前套餐条件时配置。
