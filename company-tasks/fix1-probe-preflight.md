# fix1 单封邮件执行器：先完整模拟，后另约真实窗口

第 9 轮因路径转义导致 CLI 未启动；第 11 轮列表已返回，但 PowerShell 单元素数组解析失败，均未执行 get。两次不得算作全文读取通过。“实际返回一条”若仅从缺陷推断，应写推断而非直接计数。

这次使用仓库内固定脚本，不再临场改写。它是本轮诊断辅助工具，不是 P1 业务功能；不修改正式 Hub、试用版或依赖。

## 本轮仅预检

1. `%USERPROFILE%\followup-eval` 先核对工作树；允许 `git fetch origin fix1-mail-probe`，不切换/改动现有 main，不清理旧日志。在系统临时目录选择一个不存在的新目录，以家里消息给出的完整 SHA 执行 `git worktree add --detach <新目录> <完整SHA>`，随后只在新工作树运行下面的检查。未知已跟踪改动/冲突即停。该诊断分支相对 01973c7 只新增本说明、`fix1-mail-probe.cjs`、`fix1-mail-probe.test.cjs` 三个文件；不要把旧结果报告或旧任务当成新任务执行。
2. 不装依赖，不修改脚本；运行 `node --check company-tasks/fix1-mail-probe.cjs`、测试文件语法检查，再 `node --test company-tasks/fix1-mail-probe.test.cjs`。28 项测试全部使用编造数据和 Node 假 CLI，包括完整 list → get 流程、单条/多条/空数组、错误 JSON、未读、缺编号、版本入口、超时清理。假 CLI 在系统临时目录，由测试只清理自己创建并校验路径的目录/子进程，不碰任何既有文件或进程。
3. 复用已验证的实际原生 CLI 路径（只存在本机变量中），通过 PowerShell 独立参数运行下列版本预检：

```powershell
node .\company-tasks\fix1-mail-probe.cjs --cli $exe --mode version
```

`$exe` 由既有定位得到，不把路径拼进内联 JS。执行脚本内部 `spawn(file,args,{shell:false})`，不经 PowerShell JSON 解包。不打印 `$exe` 或原始输出，仅脚本生成的安全 JSON。

4. 只回短摘要：固定 SHA、Node 版本、28 项测试通过/失败数及退出码、真实 CLI 的 version 模式退出码/版本/耗时/是否退出。失败就停，不拿真实邮件验证修法。**本轮不运行真实 mail 模式，不需要用户观察。** 不上传报告、不新增提交、不安装/升级、不启动 Hub/Outlook/模型、不碰 OST/PST、不改配置。

## 以后另行授权的真实窗口

收到家里给定的带时区绝对截止时间，并确认用户在场、Outlook 正常后，才运行：

```powershell
node .\company-tasks\fix1-mail-probe.cjs --cli $exe --mode mail --deadline $deadline
```

开始前先只读确认 OUTLOOK 进程存在，不主动启动。`$deadline` 是家里给定的 ISO 时间，不能收到后重新计时。脚本剩余不足 65 秒不启动；最多 list 1 次（已读、1 条），确认单元素数组/isRead/编号后等 600ms，再 get 1 次；第二条启动前要求剩余至少 30 秒。单命令 30 秒超时，仅处理自己创建的 CLI PID，并最多等 10 秒确认退出。任何失败均停，不补跑、不改条件。返回 `complete` 才表示已读全文步骤完成，仍须用户观察确认 Outlook 情况。

原始 stdout/stderr 仅在内存；安全结果不含正文、标题、人员、邮件编号或路径。版本模式只输出提取的版本号。日志中的 UTC 时间需明确换算到 UTC+8 后再与用户观察对齐；不要混淆计时口径。

所有回执是安全摘要（非完整文件），每份 <=64,000 UTF-8 字节。原始公司材料一律不回传；其他待传源文件先核对精确字节数/mtime，大小未知或 >=20,000,000 字节不传，不能压缩/编码/分片/分页绕过。不发送源码、真实邮件/人名/群名/邮箱/账号/编号/私有路径。
