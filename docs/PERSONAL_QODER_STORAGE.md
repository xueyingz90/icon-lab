# 个人 Qoder 存储部署记录

此功能的数据库变更已通过 Supabase 迁移接口应用到线上项目；迁移历史为权威记录。

- 20261108135901 / personal_qoder_vault_profiles
- 20261108140305 / personal_qoder_deny_client_policy

云端函数 v7 需要 Supabase 默认提供的 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY。服务端密钥不得写入网页。原有来源和账号白名单继续生效。

私有表 iconlab_private.qoder_profiles 仅关联成员与 Vault secret_id；全部配置以 JSON 加密存入 Vault。公开 il_personal_qoder 为 SECURITY INVOKER，撤销 PUBLIC / anon / authenticated 执行权，仅服务角色可调用。其私有实现明确验证服务 JWT 角色，所有者 ID 来自 Edge 的真实用户验证。服务角色没有 auth.uid()，因此这一内部入口不采用客户端用户 JWT 的 auth.uid() 策略；浏览器提交的所有者字段会被忽略。

真实数据库验证使用临时假 PAT，事务结束回滚；未留下个人配置，也未读取真实密钥。已检查加密往返、替换、其他成员为空、删除、Vault 清理及客户端权限。普通客户端显式拒绝策略保留，不能添加读密钥的客户端策略。

安全检查未发现本轮新增的警告。项目既有“泄露密码保护未开启”提醒仍存在，本轮未修改认证策略：[官方说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。
