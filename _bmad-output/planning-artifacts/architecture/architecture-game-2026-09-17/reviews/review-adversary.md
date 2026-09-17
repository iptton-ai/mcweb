# Review — 对抗镜头（finalize_reviewers 镜头 2）

> 攻击目标：构造「两个下一层单元各自完全遵守全部 AD，却仍然建出不兼容产物」的场景。无子代理环境，按门规顺序执行。

## 结论

**发现 3 个真实缝（1 中 2 低），全部可用收紧 Rule/约定关闭；0 个致命洞。**

## 攻击场景与发现

### 攻击 1（中）：两名教育锁建造者，各自全合规，红石回写路径分叉

A 建「音符盒锁」（234..235），B 建「古诗碑锁」（236..237）。两者都过 AD-4 全套登记（BlockInfo/outline/tile/isPropBlock/getPropMesh/pickBlockItem）、状态编进 ID、派生态走 Map。**但 AD-4/AD-5 都没有规定「答对翻转→供能」的回写接线**：A 在答对回调里直接改 ID 不调 `updateRedstoneNetwork`（灯不亮、门不开，锁具与红石脱钩）；B 自己发明了事件通知。星辉门先例的接线（setBlockSafe + rebuildChunk + updateRedstoneNetwork）只存在于批次契约，不在脊线不变量里——这正是「两个单元独立建设会分歧」的点。
**修复（已应用）**：AD-5 Rule 追加一句——解锁/翻转类变体回写必须走 `setBlockSafe + rebuildChunk + updateRedstoneNetwork`（照星辉门先例）。

### 攻击 2（低）：两名持久化建造者，各自全合规，localStorage key 各起各名

A 给编辑器草稿索引起 `mcweb.editor.draftIdx`，B 起 `mcweb.levels.draftIndex`。两人都满足 AD-7「<100KB 小体积可进 localStorage」——AD-7 管住了**容量分流**，没管住**key 命名空间**；一年后 key 表漂移、导出/迁移工具无法枚举。
**修复（已应用）**：Consistency Conventions「数据与格式」行追加——新增 localStorage key 必须沿用 `mcweb.<域>.v<N>` 命名并在 AGENTS.md 登记。

### 攻击 3（低）：两名工具函数建造者，对「纯逻辑模块」边界理解不同

A 写 `js/quizScheduler.js`（想被 Node 直测）静态 import 了 chunk.js（three 链）；B 写同类模块走动态 import。约定只列了既有纯逻辑模块名单，新模块的归类是作者自由裁量——测试基建（node:test）会随每个新模块静默劣化或受阻。
**修复（已应用）**：Consistency Conventions「测试」行追加——新模块创建时先声明可测性边界（需 Node 直测即禁静态 import three/DOM/chunk，浏览器专用路径动态 import）。

## 攻击过但未击穿的场景（备案）

- **双服务器**：A 在 server.py 加 `/api/backup`，B 在 rust 未加 → AD-13 Rule 已明文「双实现同步或标注仅本机开发」，合规者无处分叉。
- **指针锁**：两个新浮层一个选非暂停标志、一个选独立侧栏 → AD-10 三分类本就是合法选择集，分叉被分类学吸收；z 阶梯约定兜住视觉冲突。
- **存档防线**：A 加「云备份」写 IndexedDB（合规），B 加 30s 草稿自动存走 levelWorkshop→IndexedDB（合规）——只要不碰槽位写就不触防线；碰槽位写必经 saveGame() 入口（AD-9 明文）。
- **卡 schema 扩展**：E8 两个新锁类型都按「只增不改」加 lockType → schema 校验分支增加但旧卡不坏；四件套登记由 AD-15 契约三角约束（机械化程度=OQ-4，已登记）。
