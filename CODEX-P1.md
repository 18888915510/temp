# Codex CLI 说明书：跨渠道跟进 P1 开发

> 写于 2026-11-10。读者是**用户家里电脑上直接运行的 Codex CLI**，本说明书自成一体，不依赖之前的对话。
> 任务：在 AI Hub 成员版仓库里实现 `P1-DESIGN.md` 描述的功能，在独立分支上开发、测试、推送分支，不合并 main。
> 家里没有 WeLink 数据和公司模型；需要在公司电脑上做的事，你写成提问交给用户转发（见第 1 节）。

## 背景（三句话）

用户是 AI Hub 华为成员版的协作者。HR 希望把「邮件里布置、WeLink 群里改要求」的工作按事项归并，分清谁交给谁、截止、最新要求、谁交了没交。
P0 阶段已用本目录的评测脚本在 22 道编造题和用户真实聊天噪音上验证：模型判断整体可靠，召回规则经三轮修正；P1 把这套逻辑做进助理模块，做成带人工确认的试用版。

## 工作目录

- 本说明书所在目录 `followup-eval`（临时仓库 `https://github.com/18888915510/temp` 的副本）：设计、评测代码、编造题。只读参考，不要在这里写功能代码。
- 成员版仓库（`https://github.com/TianLin0509/ai-hub-huawei-member`，主干 `main`）：在它的独立 worktree / 分支 `feat/followup-p1` 上开发。不要动用户正在运行的 Hub 目录。

## 0. 先读

1. **协作者维护说明书**：`D:\WeChat\xwechat_files\wxid_fbevkiamsm7l22_8f6e\msg\file\2026-11\20261101-协作者维护说明书-claude(1).html`。必须遵守。读不到就停下，请用户提供。
2. 成员版仓库的 `AGENTS.md`（开发任务一节）、`docs/ARCHITECTURE.md`。
3. 本目录（`followup-eval`）的 `P1-DESIGN.md`：要做什么。
4. 本目录的评测代码，**召回和提问直接从这里移植，不要另写一套**：`recall-bench.js`（`tokens`、`idfOf`、`recall` 的 anchor 模式、`anchors`、`expandByPeople`、`mentionsOf` 和默认参数）、`followup-bench.js`（`prompt()`、`parseJson`、规则文字）。`cases.json`、`holdout*.json` 可以复制进仓库作测试 fixture（都是编造数据）。
5. 助理模块的参照实现：`core/company-assistant/brief.js` 和 `service.js` 里的 `generateBrief` / `finishBrief` / `enqueue` / `laneOf` / `collectJob` / `publish`，`data.js`，`citation-check.js`，`identity.js`，`welink.js`（只读命令白名单），`renderer/company-assistant-page.js`。

## 1. 分工

**只有用户能做的：**
- 在公司电脑上用自己的真实邮件试用（点「跟进」、看卡片、判断对错）；
- 决定是否合并进 main、是否发版；
- 你或公司端遇到需要人登录、放行、拍板的情况时处理。

**可以交给公司 CodeAgent 在公司电脑上做的（你写提问，用户转发）：**
- 第 1 步的命令探测和耗时实验；
- 第 4 步在公司电脑上拉分支、装依赖、跑测试。

做法：把提问写进本目录的 `company-tasks/第N步.md`（N 为步骤号），提交并推送到临时仓库，然后停下来告诉用户「请把 company-tasks/第N步.md 的内容用 AI Hub 的『问公司』发给公司电脑，回答回来后贴给我」。拿到回答再继续。
如果你所在的会话本身就有 AI Hub 的「问公司」工具，可以直接用，不必让用户转发。
每份提问都要写清：工作目录、授权的动作（只限该目录）、禁止事项（不改 Hub 正在运行的目录和数据目录、不发消息、不调用 welink-cli 的写命令）、回答里不得出现真实消息内容、群名、人名。
公司端回答里的结果文件会推到临时仓库的 `results/`，你可以 `git pull` 后直接读（只含数字）。

**你自己做的：** 第 2、3 步的开发和家里能跑的测试；第 1、4 步提问的撰写和结果的解读。

## 2. 步骤

### 第 1 步：公司环境探测（写提问，由用户转发给公司 CodeAgent）
提问要点（你来写完整版）：
1. 在 `%USERPROFILE%\followup-eval` 运行 `git pull`，再运行 `run-latency.cmd`（约 25 分钟，只运行不修改，结果自动上传），回答里给出每次运行的模型、思考档、耗时和第 7 步的关键正确率。
2. 只读探测 welink-cli（找到 Hub 用的那个 welink-cli，或用 Hub 的 `welink-ro` 包装）：`mail list --help`、`mail get --help`、`mail folders --help`、`search person --help`、`contact detail --help` 的完整输出；
   再执行一次 `mail list`（最近几封）和一次 `mail get` 某一封，**只报告 JSON 的字段名和层级结构，所有值替换成类型**（例如 `"to": [{"name": "<string>", "address": "<string>"}]`），不得带出任何真实内容。
   重点回答：能否列出已读邮件、能否按时间范围或发件人筛选、`mail get` 是否有收件人 / 抄送 / 正文 / 附件名 / 邮件组成员、`search person` 能否按邮箱查到 WeLink 账号和名字。
拿到结果后：按探测结果定邮件取数方式；按耗时实验定思考档默认值（`low` 又快又准就用 `low`，否则沿用 `answerEffort`）。把结论写进分支里的设计说明。

### 第 2 步：开发（家里）
- 在独立分支 `feat/followup-p1` / 独立 worktree 上开发，不要动用户正在运行的目录。提交作者用 `18888915510@163.com`。
- 建议文件划分（可按说明书和现有风格调整）：
  - `core/company-assistant/followup-recall.js`：从评测移植的召回（纯函数）；
  - `core/company-assistant/followup.js`：提问生成、输出解析、出处核对、逾期 / 冲突 / 进度计算（纯函数）；
  - `service.js`：取种子邮件、读历史快照、排队（job.type `followup`，单独一条 lane 或复用 brief lane，不能阻塞对话）、完成处理、超时 10 分钟重试 1 次、保存 `followups/<id>.json`、通知、本地试用日志；
  - 前端：「今天」栏「重要邮件」行的「跟进」按钮、「跟进邮件…」选择框、「跟进」列表与卡片、来源原文查看、「不相关」「重新整理」「标记完成」「归档」；
  - IPC：照现有助理接口的写法加。
- 提问和召回参数与评测保持一致；有意改动的地方写清原因。
- 按 `AGENTS.md` 的「开箱即用」铁律：全新数据目录、只登录了 WeLink 的状态下，点「跟进」就能用。

### 第 3 步：家里验证
- 单元测试（加进 `npm test`）：召回用 4 套编造题作 fixture，关键消息全部找到；提问生成；解析；出处核对（编造一个不存在的来源，应被删掉并注明）；逾期按当前时间计算；冲突提示；进度。
- 界面端到端：参照 `tests/e2e-community-cdp.js`，用模拟 CLI 返回 `cases.json` 某题的标准答案，走「点跟进 → 整理中 → 卡片 → 不相关 → 标记完成」。
- `npm test`、`node scripts/audit-public.js`、改动文件 `node --check` 全部通过；记录实际命令和结果。
- 推送分支（**不合并 main**）。

### 第 4 步：公司电脑验证（写提问，由用户转发给公司 CodeAgent）
提问要点：
- 在一个**新的独立目录**克隆或拉取 `feat/followup-p1`（不要动 Hub 正在运行的目录）；
- 公司电脑装依赖要：环境变量 `ELECTRON_MIRROR=https://mirrors.tools.huawei.com/electron/`，设置 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，`package-lock.json` 里的 registry 地址替换成 `mirrors.tools.huawei.com/npm`（先备份为 `package-lock.json.bak`，测试后还原，不要提交这个改动）；
- 运行 `npm ci`、`npm test`、`node scripts/audit-public.js`，回答通过情况；不启动、不替换用户正在用的 Hub。

### 第 5 步：交给用户
用简体中文大白话汇报（用户需要转述给领导时，另附一句「给领导的一句话版本」）：做了什么、测试结果、公司电脑上的验证结果、已知限制（例如邮件组能否展开、历史快照覆盖多少天）。
然后**只提一件事**，单独放在最后：请用户在公司电脑上用分支版本试用 3～5 封真实邮件（写清怎么从分支启动，不影响正在用的 Hub）。

## 3. 不要做的事

- 不合并 main、不发版、不改用户正在运行的 Hub 目录和数据目录。
- 不新增任何 welink-cli 写命令；不放宽 `welink.js` 的只读白名单。
- 不把真实消息内容写进仓库、日志、测试或回答。
- 不为了通过测试修改评测题的标准答案。
- 按偏好：功能完成后，告诉用户哪些东西可以删除（例如临时仓库 `18888915510/temp`、公司电脑上的 `followup-eval` 结果文件夹）。
