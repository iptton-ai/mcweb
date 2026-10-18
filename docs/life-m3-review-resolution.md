# 第三批独立审查修复记录

日期：2026-10-18。产品代码修复完成；浏览器实际游玩由总验收记录单独确认。

| 问题 | 修复 | 回归证据 |
| --- | --- | --- |
| 机械锯消耗原木后、产物落带前保存丢失四木板 | 机械锯与粉碎轮生成产物时立即标记持久化 | 真实动力运行至第一帧产物，立即普通存读档；原料 AIR、四木板仍在，锯线全部入箱 |
| 活塞推梯子后形成无支撑可攀爬梯 | 梯子归贴面道具 PUSH_POP | 四朝向 × 普通/粘性活塞，真实伸出收回；目标不残留梯、只返一件规范物品 |
| 原料开局提示“回到你放好的工作台” | 改为先制作路径，已放台只作为条件选项 | 远处营地工作台存在时仍正确提示制作，近处工作台仍识别 |
| 首次 HUD 被画布覆盖，按 J 后才有定位样式 | HUD 与面板共用幂等样式安装 | 未打开手册时先创建 HUD 已具定位样式，开面板不重复安装，面板期间隐藏 |
| 助手尚未初始化时作品录像入口异常 | showAssistantPanel 检查实际面板引用及编辑退出遮罩 | 未 initUI 安全返回 false；initUI 后返回 true 且可见，退出遮罩仍拒绝 |
| 梯子失支撑 pending 格式缺 stack（父代理修复） | 完整 stack 加入待掉落队列 | 连续 flush 两次只产生一个合法 ladder itemId |
| 关闭助手后录像控制态阻止行走（父代理修复） | setAssistantVisible(false) 同时清录像控制态 | 模态状态恢复后纯键盘行走恢复 |

回归命令与结果：

- `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/survival-m3-review.test.mjs tests/gamelogic/survival-m3.test.mjs tests/gamelogic/home-m1-review.test.mjs`：35/35。
- `node --test --import ./tests/gamelogic/_preload.mjs tests/gamelogic/*.test.mjs`：190/190。
- `node --test tools/test_*.mjs`：217/217。
- `git diff --check`：通过。

以上没有失败或跳过。日志在 `docs/life-m23-evidence/2026-10-18/m3-review.log`、`m3-logic.log`、`m3-tools.log`。无头 UI 检查只核实初始化、样式安装与显隐生命周期，不替代浏览器像素验收。
