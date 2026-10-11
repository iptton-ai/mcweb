---
title: 编辑器退出保存失败时保留修改并让用户选择
type: bugfix
created: 2026-10-11
status: done
baseline_commit: c9060e4915efb1de41fb9b29c8a4f650175978f3
context: []
---

<frozen-after-approval reason="用户明确授权修复保存失败退出，并指定继续编辑或明确放弃两种选择">

## Intent

**Problem:** 删除旗标、无锚点或锚点区域超出卡片上限时，末稿无法生成；退出忽略失败并恢复原世界，静默丢失本次修改。世界操作入口还提前宣称草稿已保存。

**Approach:** 退出先等待末稿结果。失败显示校验或存储原因，保留编辑世界，默认选择继续编辑；只有用户明确选择放弃才恢复原世界。正常有效草稿保存成功继续自动退出。

## Boundaries & Constraints

**Always:** 保留混合工作区及上一轮修复；保存失败不能写槽、清世界或恢复锁题；重复退出共享同一次待决操作；选择继续后重新开放编辑、自动保存和再次退出。鼠标与纯键盘都能操作选择框。

**Ask First:** 扩大关卡尺寸或新增不完整关卡存储格式需要另行设计；当前任务只保护退出选择。

**Never:** 不提交、推送或发布；不改官方卡 JSON，不清除最后有效草稿，不自动替用户选择放弃，不使用延时自动放弃。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|---|---|---|---|
| 正常退出 | 有效末稿保存成功 | 恢复原世界并退出 | 原保存规则保留 |
| 缺旗／无锚点 | 构建末稿失败 | 展示具体缺旗原因，保留方块／锁题／规则 | 提供两种选择 |
| 超范围 | 区域超过 96×64×96 | 保留世界并提示尺寸上限 | 不偷偷裁剪 |
| 存储异常 | 保存返回失败或抛异常 | 显示存储原因，保留编辑 | 不误报已保存 |
| 会话降级 | 有会话稿但持久写失败 | 说明仅本会话可用与刷新风险，退出需明确选择 | 保留既有持久备份 |
| 继续编辑 | 点继续或 Esc/Q | 退出返回 false，保留修改并解除退出锁 | 不触发下一步换世界 |
| 明确放弃 | 激活“放弃修改并退出” | 等待在途存稿后恢复原世界，退出返回 true | 仅放弃未落盘编辑世界，已保存稿保留 |
| 重复退出 | 保存／选择尚在途 | 共享同一次保存和选择 | 无重复弹框和恢复 |
| 对话框输入 | 键盘／点击 | 默认聚焦继续；导航限于对话框 | 不挖掘／放置／开其它浮层／抢指针 |

</frozen-after-approval>

## Code Map

- `js/levelEditor.js`：草稿串行队列、退出共享 Promise、世界与锁题恢复。
- `js/ui.js`：编辑器 HUD 与新增失败原因／双按钮对话框。
- `js/state.js`、`js/uiModal.js`、`js/input.js`、`js/uiKeys.js`：指针、游戏输入与键盘导航守卫。
- `js/main.js`：开新／切槽／删除入口的异步退出结果提示。
- `js/assistant/knowledge.js`、`docs/edu-workshop-impl-contract.md`：机制速查与退出返回值契约。
- `tests/gamelogic/`、`tests/e2e/`：真实模块与真实 DOM 回归。

## Tasks & Acceptance

**Execution:**
- [x] `js/levelEditor.js`：保留失败原因，失败时等待选择；继续解除锁，放弃安全恢复。
- [x] UI／输入模块：实现可见原因、默认安全焦点、明确放弃与输入隔离。
- [x] `js/main.js`：三个世界操作入口只在实际退出后提示，不宣称未保存稿已保存。
- [x] 测试：无锚点、缺旗、超限、存储故障、旧稿保护、取消后重试、并发与真实按钮／键盘。
- [x] 知识库与接口文档同步；三路独立复核；销项 deferred 条目并记录最终验证。

**Acceptance Criteria:**
- Given 无法保存的编辑世界，when 请求退出但未明确放弃，then 方块、锁题、规则与槽位保持，失败原因可见。
- Given 失败选择框，when 继续并修正旗标或区域，then 能正常保存退出，原世界恢复且新稿可续编。
- Given 最新混合工作区，when 运行逻辑与相关契约／知识库回归，then 无新增失败，已有补丁保留。

## Spec Change Log

2026-10-11：用户本轮明确指定退出选择，替代上一轮“保留简化退出恢复”的约束；授权已给出，无需重复确认。原 gameplay-remediation 规格冻结段保持历史原文。未设置 story_key，跳过 sprint 同步。

独立复核新增 patch：事务提交判定、保存等待画布／作者输入、助手捕获与延迟焦点。真实原生 Esc 揭示同节点监听间会释放退出态，退出框改用 stopImmediatePropagation。全部修复并追加回归，保留已有存稿队列、旧稿保护和取消／放弃语义；未改变冻结意图。

## Design Notes

继续维持 `saveEditorDraft -> card|null` 与 `exitLevelEditor -> Promise<boolean>`；失败原因保存在编辑会话，退出成功／明确放弃为 true，继续编辑为 false。选择框未决时 Promise 等待人类游戏玩家选择，不是向开发任务用户重新请求授权。`saveDraft:false` 保留程序化显式放弃路径，仍排空在途保存。持久写降级保留会话卡和持久备份；退出不静默把降级等同于磁盘保存成功。

## Verification

- `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`
- `node tools/test_level_editor.mjs`、`node tools/test_level_workshop.mjs`、`node tools/test_level_run.mjs`
- `node --test tools/test_assistant_knowledge.mjs`
- 隔离 origin 的 ego-browser：真实退出／继续／放弃按钮，Esc/Q、Tab／Enter、错误可见及取消后保存成功。
- `git diff --check`；独立审查使用当前混合工作区的增量快照，排除上一轮既有修改归属。


**Final verification:**
- 新增退出保护专项 12/12，全量 gamelogic 98/98；其他 Node 136/136，总计 234/234，零失败／跳过。
- 597 题校验零违规；知识库同步与 git diff --check 通过。
- 隔离 ego-browser 8 组真实场景通过，含 5 类失败、保存中鼠标／作者、main／已有助手／Esc／鼠标放弃组合；最终日志 EDITOR_EXIT_BROWSER_PASS。
- 三路独立只读复核及最后原生事件补丁核查收齐，无本轮未修残余。
- [完整验收与证据](../../docs/editor-exit-verification-2026-10-11.md)；[原 deferred 项销项](deferred-work.md)。
- 未提交／推送／发布；用户禁止提交覆盖技能默认提交步骤。

## Suggested Review Order

**保存与退出边界**

- 失败先等待选择，成功才恢复原世界。
  [levelEditor.js:356](../../js/levelEditor.js#L356)

- 保留具体失败原因，释放串行保存队列。
  [levelEditor.js:285](../../js/levelEditor.js#L285)

- 持久成功等事务提交，失败保留备份。
  [levelWorkshop.js:662](../../js/levelWorkshop.js#L662)

**选择与输入隔离**

- 显示具体原因与默认安全选项。
  [ui.js:1513](../../js/ui.js#L1513)

- 消费整个原生按键，防同节点重复处理。
  [uiKeys.js:237](../../js/uiKeys.js#L237)

- 保存等待期间画布不得盖章。
  [input.js:287](../../js/input.js#L287)

- 助手捕获与延迟聚焦服从退出选择。
  [ui.js:417](../../js/assistant/ui.js#L417)

**验证与知识**

- 真实模块验证备份、重试和事务中止。
  [remediation-editor-exit.test.mjs:321](../../tests/gamelogic/remediation-editor-exit.test.mjs#L321)

- 真实退出按钮与原生输入组合。
  [editor_exit_ego.mjs:193](../../tests/e2e/editor_exit_ego.mjs#L193)

- 同步失败退出的可搜索机制说明。
  [knowledge.js:375](../../js/assistant/knowledge.js#L375)
