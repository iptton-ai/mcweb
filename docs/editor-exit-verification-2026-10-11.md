# 编辑器退出保存失败保护：验收与销项

2026-10-11 用户明确授权处理上一轮 deferred 项，指定“保存失败时提示原因，让用户选择继续编辑或明确放弃”。本轮已完成；[规格](../_bmad-output/implementation-artifacts/spec-editor-exit-save-failure.md)与[原后续项](../_bmad-output/implementation-artifacts/deferred-work.md)同步销项。既有修改继续保留，未暂存、提交、推送或发布。

## 最终行为

- 无锚点、缺起点／终点旗、区域超过 `96×64×96`、存储异常时，退出保留编辑世界、题目、规则和最后有效草稿，显示具体原因。
- 默认“继续编辑”，Esc/Q 同效；选择继续后解除退出与保存锁，可修正后保存、自动保存或再次退出。只有激活“放弃修改并退出”才弃掉未保存的编辑世界并恢复原槽，已保存稿保留。
- 正常有效末稿持久提交成功仍自动退出。会话降级说明具体存储原因及刷新风险，也等待明确选择，保留磁盘备份。
- 写入确认等 IndexedDB 事务 `complete`，请求成功后事务中止也按失败处理，不提前删除旧稿或退出。
- 重复退出共享一份存稿与选择过程；明确不追加末稿的程序化退出仍等待在途保存。
- 保存等待与选择期间，禁止画布盖章、作者改题、助手抢焦点和其它面板快捷键。Tab 限在两个按钮内；原生 Esc/Q 使用 `stopImmediatePropagation`，避免同节点助手监听再次切换状态。
- 开新／切槽／删槽入口等待真实退出结果才提示，取消后保留编辑会话；不提前宣称草稿已保存。

## 回归结果

新增 [remediation-editor-exit.test.mjs](../tests/gamelogic/remediation-editor-exit.test.mjs) **12/12**，运行真实编辑器、卡片、锁题、存档与恢复模块，模拟 IndexedDB 平台边界。覆盖四种校验失败、继续修正后续编、明确放弃恢复、配额降级、请求成功后事务中止、保存异常、并发退出、在途队列和盖章输入隔离。事务用工作副本，只有 commit 才写回，避免 Map 引用伪通过。

既有正常退出测试改用持久 IndexedDB 夹具，继续验证保存成功自动退出；原无 IDB 的会话兜底契约断言同步新增 `storageError`。没有将失败场景跳过或弱化为成功。

| 套件 | 结果 | 日志 |
|---|---|---|
| 全量 gamelogic | 98/98，零失败／跳过 | [logic.log](editor-exit-evidence/2026-10-11/logic.log) |
| 内置关卡契约 | 64/64 | [builtin.log](editor-exit-evidence/2026-10-11/builtin.log) |
| 编辑器契约 | 10/10 | [editor.log](editor-exit-evidence/2026-10-11/editor.log) |
| 关卡工坊契约 | 21/21 | [workshop.log](editor-exit-evidence/2026-10-11/workshop.log) |
| 关卡运行契约 | 10/10 | [run.log](editor-exit-evidence/2026-10-11/run.log) |
| 我的题库 | 13/13 | [question-bank.log](editor-exit-evidence/2026-10-11/question-bank.log) |
| 学习进度 | 8/8 | [edu-progress.log](editor-exit-evidence/2026-10-11/edu-progress.log) |
| 助手机制知识库 | 10/10 | [knowledge.log](editor-exit-evidence/2026-10-11/knowledge.log) |
| 题库内容校验 | 597 题、零违规／提醒 | [banks.log](editor-exit-evidence/2026-10-11/banks.log) |
| `git diff --check` | 通过 | 最终工作区检查 |

Node 合计 **234/234**。知识库已同步保存失败选择、事务提交、输入暂停，并增加“草稿／退出／保存失败／继续编辑／放弃”检索词；工坊契约新增退出返回值与降级错误字段说明。

## 真实浏览器

使用 ego-browser TaskSpace 10 的 p1，隔离服务器 `http://127.0.0.1:18642/`，真实 Three.js／DOM／IndexedDB。脚本：[editor_exit_ego.mjs](../tests/e2e/editor_exit_ego.mjs)；[完整通过日志](editor-exit-evidence/2026-10-11/browser.log)以 `EDITOR_EXIT_BROWSER_PASS` 结尾。

| 场景 | 实际操作与结果 |
|---|---|
| 无锚点 | 点击退出 → 可见原因与默认继续焦点 → 鼠标继续 → 方块保留 → 补旗后点击退出，末稿持久可读 |
| 缺终点旗 | 点击退出 → 原生 Esc 继续 → 补旗后成功退出 |
| 超范围 | 显示 96×64×96 原因 → Tab 往返限制在两按钮 → Enter 明确放弃，恢复原世界 |
| 配额失败 | 原生 `put` 抛 QuotaExceededError → 显示存储空间不足与会话限制 → Q 继续，恢复写入后保存退出 |
| 事务提交失败 | 原生 put 请求成功后调用事务 abort → 显示事务未提交，原持久备份不变 → 继续、正常提交后退出 |
| 保存等待时画布 | 延迟真实缩略图 toBlob 回调；鼠标模式保留组件放置态，原生画布点击无后写方块 |
| 保存等待时作者 | 已有作者面板的真实委托 change/click 不改变题目／考核锁；末稿完成后正常退出 |
| main 与助手 | 暂停菜单实际开新按钮二次确认进入退出保护，无成功虚报；助手已打开时 T 不穿透、Esc 继续仍保持暂停与编辑世界；再次退出鼠标明确放弃 |

图片已逐张视觉复核：

- [无锚点原因与默认继续焦点](editor-exit-evidence/2026-10-11/no-anchors.png)。
- [超范围原因与双按钮](editor-exit-evidence/2026-10-11/oversize.png)。

复跑时先启动隔离 `server.py`，在当前任务的 ego-browser 页调用 `prepare` → 观察 HUD → `openFailure` → 观察选择框 → `exercise`；`runPendingInput` 分 mouse/author 两模式，`runMainAndAssistant` 检验原生捕获监听组合。测试在 finally 恢复故障注入并清理自身创建的卡。没有逐关手动完成所有官方关卡，也没有重跑全部历史 CDP E2E。

## 独立复核销项

三位未继承会话的只读代理分别做盲审、边界审查和规格验收；初轮及修复后只读复核均已收齐。盲审仅看增量 diff，另两路读实际源码与测试，核查员没有修改或运行测试。

| 发现 | 处理与证据 | 最终状态 |
|---|---|---|
| 保存等待期间未锁画布仍能盖章，已有作者表单能改末稿之外的数据 | 最早鼠标／作者入口守卫；共享盖章 await 后核对世界与会话；新增逻辑与真实画布／表单回归 | ✅ edges／acceptance 销项 |
| 助手捕获 T/Esc 和延迟焦点抢占选择框 | 捕获入口、打开入口和延迟 focus 守卫；原生已有助手场景复跑 | ✅ 三路最终销项 |
| put 请求成功被当成持久落盘，事务最终中止仍会退出并删备份 | 等事务 complete，abort/error 降级；工作副本与真 IDB abort 回归 | ✅ edges／acceptance 销项 |
| 原生监听之间释放退出态后，同一 Esc 又被助手处理 | 真实复跑证实初轮纯源码判断不充分；退出框消费整个事件，保留 pause；重跑全浏览器链通过 | ✅ 三路最终销项 |

最后完整复跑后，本轮范围无剩余可复现未修项。原 gameplay-remediation 冻结规格及历史验收保持原文；本轮新授权与完成状态作为后续记录追加。
