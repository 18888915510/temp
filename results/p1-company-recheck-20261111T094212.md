# P1 公司独立副本复验报告（验收摘要，不是原始日志）

- 报告时间：2026-11-11 09:42（本机时间，UTC+8）
- 任务编号：Q-1110-10 第 2 轮
- 验证对象：跨渠道跟进 P1，测试隔离修复后的复验
- 本轮未重装依赖、未改代码、未跳测试、未启动 Hub/Electron、未调用模型或 welink-cli、未修改用户目录缓存、正式 Hub、系统/全局配置或信任设置

## 1. 结论（一句话）

复验通过：全量 2063 项中 2062 通过、1 项原有跳过、0 失败，进程退出码 0；安全审计 ok、1789 个文件、0 失败；lockfile 哈希与上一轮还原后一致，已跟踪文件无改动。

## 2. 版本与目录

| 项目 | 值 |
| --- | --- |
| 功能仓库 | ai-hub-huawei-member（成员版） |
| 分支 | feat/followup-p1 |
| 上一轮 HEAD | e889c75abaeedf2b13c63b9faac1d6036028bdee |
| 本轮要求 HEAD | 738fbd57a270c256028bd65fbc3eaeb36160bcc5 |
| 本轮实际 HEAD | 738fbd57a270c256028bd65fbc3eaeb36160bcc5（完整 SHA 一致） |
| Node / npm | v24.5.0 / 11.5.1 |
| 验证目录 | `%USERPROFILE%\ai-hub-followup-p1-e889c75` |
| 依赖 | 沿用上一轮独立 node_modules，未执行 npm ci，未重装 |

## 3. 更新范围核对（实测）

`git pull --ff-only` 退出码 0，e889c75 → 738fbd5，fast-forward，无冲突。

差异文件恰为 2 个，与要求一致：

| 文件 | 变更 |
| --- | --- |
| tests/unit-company-model-proxy.test.js | +2 / -1（该用例的 env 增加 USERPROFILE 与 HOME 指向临时目录，并加一行注释） |
| docs/FOLLOWUP-P1.md | +2（新增一段 2026-11-11 第 1 轮公司验证记录） |

未出现其他文件变动。业务代码、依赖清单、lockfile 均未被该提交修改。

## 4. 各步骤退出码与耗时（实测）

| 步骤 | 命令 | 退出码 | 耗时 | 结果 |
| --- | --- | --- | --- | --- |
| 拉取 | git pull --ff-only | 0 | <1 s | fast-forward 到 738fbd5 |
| 测试 | npm.cmd test | 0 | 163 s | 2063 项：2062 通过 / 0 失败 / 1 跳过 |
| 审计 | node scripts/audit-public.js | 0 | 2 s | ok=true, files=1789, failures=0 |

- 测试使用本机正常环境运行，未在命令外把 USERPROFILE/HOME 改为空目录；隔离由测试自身完成。
- 输出经 cmd 重定向到新副本 `artifacts/` 下的本地日志，未使用截断管道；退出码为真实子进程退出码。

## 5. 测试结果细节（实测）

- 精确计数：tests 2063，pass 2062，fail 0，skipped 1，cancelled 0，todo 0，duration_ms 161260。
- 与家里基线（2063 / 2062 通过 / 1 跳过 / 0 失败）完全一致。
- 上一轮唯一失败用例 `upstream profile names what is missing in plain words`（tests/unit-company-model-proxy.test.js）本轮通过，耗时约 3437 ms。
- 跳过项 1 项，用例名「不知道域名时不访问，给出可操作的提示」，为仓库原有跳过，本轮未新增跳过。
- 跟进功能测试文件 `tests/unit-company-assistant-followup.test.js` 的 30 项包含在本次全量中，全部通过（全量 0 失败）。

## 6. 安全审计（实测）

- ok=true，files=1789，failures=[]，退出码 0。
- 文件数 1789 与上一轮相同：比家里记录的 1788 多 1，来源仍是新副本根目录未被忽略的未跟踪文件 package-lock.json.bak（本轮按要求保留），不是源码差异。

## 7. 工作树与 lockfile（实测）

- package-lock.json SHA256：962d08bef1a623e244744b553c9ec80afbc37e39f33f03f82a6261fb57c600b2，与上一轮还原后完全相同。
- `git diff --exit-code` 退出码 0：无已跟踪文件改动。
- `git status --short` 仅 `?? package-lock.json.bak`，无其他未跟踪文件（artifacts/、node_modules/ 已被 .gitignore 忽略）。
- 最终 HEAD：738fbd57a270c256028bd65fbc3eaeb36160bcc5。
- 未提交任何内容到功能仓库，未合并 main，未推送。

## 8. 对正式 Hub 的影响核查

- 全部操作在新克隆 `%USERPROFILE%\ai-hub-followup-p1-e889c75` 内执行，依赖为该目录下的独立 node_modules。
- 未启动任何 Hub 窗口或 Electron 进程，未执行 `start-followup-p1.cmd`。
- 未修改正式 Hub 的源码、设置、数据目录；未修改 `%USERPROFILE%\.cac.json` 等用户目录缓存。
- 未修改系统代理、全局 npm 配置、git 全局配置、CLI 信任设置。
- 新副本内 `start-followup-p1.cmd` 仍存在，本轮未运行，供下一轮用户试用。

## 9. 未验证部分

- 未验证：真实 WeLink 连接、真实邮件读取、真实模型跟进效果、界面端到端流程。本轮未启动 Hub、未调用模型；**全量测试通过不代表真实邮件跟进已验证**。
- 未验证：`start-followup-p1.cmd` 的实际启动行为与 `%LOCALAPPDATA%\AIHubFollowupP1` 数据目录表现。
- 未执行：npm ci（沿用上一轮依赖）、任何需要人工登录或放行的操作。

## 10. 实测与推断的区分

- 实测：pull 退出码与范围、HEAD 完整 SHA、两个差异文件及内容、npm test 与 audit 的退出码/耗时/精确计数、上一轮失败用例本轮通过、跳过用例名、lockfile SHA256、git diff 与 status、最终 HEAD。
- 推断：审计文件数 1789 中多出的 1 个为 package-lock.json.bak（依据：git status 仅多这一个未忽略未跟踪文件，且审计按 git 跟踪 + 未忽略未跟踪文件枚举）。
