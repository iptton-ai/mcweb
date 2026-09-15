# Edu M2：英语商人 + 识字矿石 + 奖励梯队 + 家长报告

> 2026-09-08 实施上线。上游方案：edu-grade3-plan.md §2/§5（M2 = 内容规模化）。
> M1 基建（题库管线/贴图覆盖链/音效播放/进度存储）全部复用，本文只记增量。

## 0. 交付清单

| 项 | 内容 | 挂载 |
|---|---|---|
| **奖励梯队** | 连对 8+传说(钻×2+熟猪排×2) / 5+史诗(钻×1+铁×2) / 3+精良(铁×2+苹×2) / 基础苹×1；累计里程碑 5/10/20/50（红石灯×2→粘液×8→钻×2→钻×5，claimed 记账不重复）；10% 彩蛋熟猪排 | js/eduRewards.js grantEduReward，spawnItemDrop 真物品弹出磁吸入包 |
| **英语商人** | 右键「🛒 这是什么单词？」中文释义 + 3 英文选项按 1/2/3 作答；未学词优先、全学完随机复习；答错显示正确答案下次再来 | js/eduMerchant.js + MERCHANT_BASE=226（tile 82/84，ComfyUI merchant.png） |
| **识字矿石** | 世界生成 ~1% 矿（y≤44 独立哈希段），挖开=按格子哈希从识字表认领一个字入图鉴（同格同字）+ 25% 附赠苹果 | world.js oreAt + interaction.js breakBlockAt 分支 + HANZI_ORE=228（tile 83，hanzi_ore.png） |
| **家长报告页** | ⚙️ 设置新增「📚 学习」页：答题机/正确率/连对/交易/单词/识字图鉴/里程碑 + 识字字墙 + 二次确认清零 | settingsUI.js（switchTab edu → renderEduReport） |
| **题库** | 英语 150 词（沪教版三上 Word list）、生字 258 字（统编版三上识字表）；extracted 数学 11 题人工核算全对 | tools/extract_edu_m2.py → assets/edu/grade3-{english,hanzi}.json |

## 1. 数据与常量（js/config.js）

- `MERCHANT_BASE = 226`（单变体）、`isMerchantId`；`HANZI_ORE = 228`
- BlockInfo：均普通实心立方体（edu: true）；商人 hardness1.5 axe drop 自身；
  识字矿 hardness3 pickaxe needsTool drop 煤炭 xp3
- HotbarBlocks 追加两件；生存开局礼包加 商人×1（答题机×3 为 M1）

## 2. 模块

- **js/eduRewards.js**（新增，教学共享层）：
  - `loadEduProgress/saveEduProgress`（localStorage mcweb.edu.v1，键扩展：words/hanzi/
    trades/wordStreak/wordWrong/claimed/hanziNew）
  - `grantEduReward(x,y,z,{streak,totalKey})`：梯队+里程碑+彩蛋 → spawnItemDrop 弹出；
    里程碑命中播 unlock fanfare；返回描述文本供 toast
  - `ensureHanziBank/hanziFor/collectHanziAt`：识字表懒加载 + 格子哈希（`>>>0` 归一，
    M1 负下标坑）+ 图鉴去重记账
- **js/eduMerchant.js**（新增）：交易卡 UI（#edu-trade，模块自注入 CSS）+ 1/2/3 键捕获
  （window 捕获阶段，答题中不切快捷栏）+ 未学词优先选题 + 走远/拆块自动收起（同 eduKeypad）
- **js/eduKeypad.js**：进度/奖励改用 eduRewards 共享层，onKeypadSolved 带坐标发奖
- **js/world.js**：oreAt 加 `h∈(0.890,0.900] && y≤44 → HANZI_ORE`（独立分段不与煤/铁/钻重叠）
- **js/settingsUI.js**：edu 页签 + renderEduReport（切入实时刷新）+ 二次确认清零；
  `.vol-row label` 改 fit-content+nowrap（修长标签竖排）

## 3. 资产

- `assets/textures/merchant.png / hanzi_ore.png`（16×16，ComfyUI Klein4B+pixel LoRA，
  NEAREST 降采样+不透明合成），TILE_OVERRIDES 覆盖 tile 82/83；drawFunctions 82/83/84 程序化兜底
- 音效复用 edu_{correct,wrong,unlock}.wav（M1 已生成）

## 4. E2E 验证（2026-09-08 实测，注入式）

- ✅ 商人交易：出卡「开心的 →1.go/2.your/3.happy」，按 3 答对 → words=['happy']、
  trades=1、奖励掉落实体生成、面板关闭
- ✅ 奖励梯队：streak6=史诗+里程碑ms5；streak9=传说+ms20+彩蛋；claimed 记账不重复
- ✅ 识字矿石：collectHanziAt 同格同字（缸→缸 new:true→false）；breakBlockAt 破坏记字
- ✅ 报告页：7 项统计+识字字墙渲染正确（截图目检），重置按钮二次确认
- ✅ 回归：刷新后答题机 18÷3+8=14 答对 → 变体 225 + solved=1 + 掉落 1 实体
- ✅ extracted 数学 11 题独立核算全对（eval 复算 vs 提取答案）

## 5. 已知边界

- 创造模式奖励实体磁吸后不计库存（创造本无限，语义无碍）
- 识字表 258 字 vs 课本标称 250：提取含少量多音字/语文园地字，demo 可接受
- 商人干扰项随机自全词库（同 zh 过滤），未按单元聚类——M3 可做「按当前单元出题」
