# 交接：用 AI Hub 组队让公司 CodeAgent 执行任务（给 Hub 里的 Claude 负责人）

> 写于 2026-11-09。你是用户公司电脑上 AI Hub 里的 Claude 会话，当前目录是本仓库的本地副本（`followup-eval`）。
> 你的角色是**负责人**：不自己动手做任务，而是通过 Hub 的组队机制招一个公司 CodeAgent 成员，把 `TASK-codeagent.md` 交给它执行，收到汇报后验收，再用大白话告诉用户。

## 1. 为什么这样分工

任务需要读 `e2e-*\local-only\` 里的文件，里面有用户**真实的 WeLink 聊天内容**。这些内容只能交给公司内部模型（CodeAgent）处理，**不能进入你（Claude）的上下文**。所以：

- **你绝不读取、打开、搜索**任何 `local-only\` 目录、`local-only-detail.md`、`*-prompt.txt`、`*-output.txt`，也不读 Hub 的消息快照 `raw-*.json`。
- 你只读：本仓库的脚本和文档、结果文件夹里的 `report.md` / `summary.json`（只有数字和编造的用例），以及 CodeAgent 发来的汇报。
- 如果 CodeAgent 的汇报里出现了像真实聊天的内容，不要转述，提醒它以后别这样，并告诉用户。

## 2. 组队命令

命令是 Hub 数据目录下的 `team\hub-team.cmd`。在 PowerShell 里：

```powershell
$hubData = $env:CLAUDE_HUB_DATA_DIR
if ([string]::IsNullOrWhiteSpace($hubData)) { $hubData = Join-Path $env:USERPROFILE '.ai-hub-community' }
$teamCommand = Join-Path $hubData 'team\hub-team.cmd'
& $teamCommand status
```

- 动作只有：`status`、`accounts`、`propose`、`send`、`read`、`allow`、`restart`、`dismiss`。
- 身份由会话环境变量自动提供，**不要打印、复制或要求用户提供任何令牌**。
- 先跑 `status`：看到团队信息或「你还不在任何团队里」才算可用。报错、超时、没输出就停下，把原样错误告诉用户，不要绕过。
- Hub 30 秒没回应时结果未知：先 `status` 核对，不要直接重发。

## 3. 步骤

### 第 1 步：准备
1. `git pull`，确认 `TASK-codeagent.md` 是最新的。
2. 记下当前目录的绝对路径（`(Get-Location).Path`），后面作为成员的工作目录。
3. `& $teamCommand status` 确认组队可用。

### 第 2 步：招一个 CodeAgent 成员
1. `& $teamCommand accounts`，只看 `usable=true` 的账号，优先 `recommendedId`、`activeSessions` 少的。
2. 选模型：成员要读代码、排查、改脚本，用该账号 `models` 里较强的通用模型（例如 `GLM-5.2-WX-Auto`，以清单为准）。注意：被评测的模型是 `deepseek-v4.1-flash-1017`，由脚本参数决定，和成员自己用什么模型无关。
3. 写计划文件 `plan.json`（UTF-8，不要提交到仓库），只用这些字段：
   ```json
   {"goal":"排查并修好跨渠道跟进的端到端评测，重跑并上传结果",
    "members":[{"role":"评测脚本排查与修复",
      "task":"请先完整阅读当前目录下的 TASK-codeagent.md，按任务 1、2、3 依次执行；完成或卡住时用 hub-team send --to lead 汇报。选这个模型的理由：需要读代码和排查问题。",
      "title":"跟进评测-排查",
      "cwd":"<第 1 步记下的绝对路径>",
      "account":"<选定账号 id>","model":"<选定模型>"}]}
   ```
4. `& $teamCommand propose --plan-file plan.json`
5. 告诉用户：「请在侧栏本会话那一行点『待批准』，确认账号和模型后批准。」**只有用户能批准**，你不能代点。
6. 批准结果会作为消息发给你。驳回就按意见改计划重交；某人没建成，只为缺的人重交，不重复创建。

### 第 3 步：等待与跟进
- 成员按 `TASK-codeagent.md` 自己干，一般十几分钟到半小时（端到端一次约 10 分钟）。你不需要逐步指挥。
- 收到汇报通知时，如果是摘要，用 `& $teamCommand read --id <消息编号>` 读全文。
- 收到「运行中但 N 分钟没有输出」的提醒：评测本身可能长时间无输出，先 `status` 看看，确认卡住再 `restart --member m1`。
- 成员请你拍板时（例如认为标准答案有问题、要改评测口径）：能按 `TASK-codeagent.md` 的原则判断的就回复它；涉及改变目标或标准的，转问用户，一次只问一件事。

### 第 4 步：验收
1. `git pull`，看 `results\` 下最新的 `e2e-*.md`（只有数字，可以读）。
2. 对照 `TASK-codeagent.md` 任务 2 的验收标准逐条核对。
3. `git log --stat -5` 确认成员提交里没有 `e2e-*`、`recall-*`、`result-*`、`local-only` 之类的结果目录或真实数据；有的话立刻告诉用户。
4. 不达标：用 `send --to m1` 说明差在哪，请它继续；达标就进入第 5 步。

### 第 5 步：向用户汇报并收尾
- 用三五句大白话汇报：失败原因、改了什么、端到端结果（关键正确率、误挂真实消息条数、平均耗时）。再附一句「给领导的一句话版本」。
- 问用户是否让成员离队；用户同意后 `& $teamCommand dismiss --member m1`（会话本身保留，由用户决定是否关闭）。
- 不要开始 P1（在 Hub 里实现功能），等用户决定。

## 4. 背景速览（够你判断用）

- 功能目标：HR 把邮件转发给小助理，小助理到 WeLink 群聊、私聊里找相关消息，整理成事项卡片（谁交给谁、交付内容、截止、最新要求、谁交了没）。
- 现在是 P0 验证，只用本仓库的独立脚本，不改 Hub 源码（`D:\ai-hub-huawei-member`）。
- 已有结论：干净消息下 flash 模型各项 100%、约 60 秒；召回用「锚点、前 20 条」，关键消息召回 96%～100%。
- 当前问题：端到端（召回 + 模型）14 次全部没拿到有效 JSON，4 次 300 秒超时，其余 180～270 秒结束。最可能是模型调用了工具、用完 2 轮限制后没输出答案。详见 `TASK-codeagent.md`。
- 文件说明见 `TASK-codeagent.md` 第 3 节。
