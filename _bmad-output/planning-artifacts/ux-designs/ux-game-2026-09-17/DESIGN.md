---
name: mcweb（我的世界 - 网页复刻版）
description: 纯前端体素沙盒教育游戏的视觉规范——Three.js 全屏 3D 画布之上叠一层「暗色像素游戏」风 HTML HUD/浮层，emoji 图标语言，面向 9 岁儿童的低龄可读性设计
status: final
created: 2026-09-17
updated: 2026-09-17
note: 回溯性视觉规范——产品 2026-09-01 已上线，本文把既有界面（index.html 内联 CSS + 各模块注入样式）沉淀为 token。未标注条目 = 已实现的现状决策；标注【改进建议】的条目 = 对齐 PRD E8~E11 前瞻方向的改进项，非既成事实
sources:
  - index.html（HUD DOM 与内联 CSS，颜色/字号/圆角/层级的事实源）
  - js/settingsUI.js、js/eduKeypad.js、js/ui.js、js/assistant/ui.js（模块注入样式与教学面板卡片）
  - _bmad-output/planning-artifacts/prds/prd-game-2026-09-17/prd.md（E8~E11 前瞻方向）
  - _bmad-output/planning-artifacts/briefs/brief-game-2026-09-17/brief.md + addendum.md
colors:
  void: '#000000'
  night: '#1a1a2e'
  panel: '#2d2d44'
  panel-deep: '#26263e'
  panel-ink: '#141423'
  border: '#4a4a6a'
  border-soft: '#5a5a7a'
  hover: '#5a5a8a'
  slot: '#3d3d5c'
  accent: '#7ec850'
  accent-soft: '#9ad24a'
  accent-pale: '#8fb573'
  text: '#e0e0e0'
  text-bright: '#ffffff'
  text-dim: '#9a9ab8'
  text-faint: '#77779a'
  selected: '#ffdd55'
  gold: '#ffd84a'
  xp-gold: '#ffe97a'
  danger: '#ff6b5a'
  danger-deep: '#e05252'
  warn: '#e0a030'
  crit: '#e05040'
  edu-green: '#39d353'
typography:
  display:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '48px'
    fontWeight: '700'
    letterSpacing: '4px'
  subtitle:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '18px'
    letterSpacing: '2px'
  heading:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '19px'
    fontWeight: '700'
    letterSpacing: '1px'
  card-title:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '13px'
    fontWeight: '600'
  body:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '14px'
    lineHeight: '1.5'
  caption:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '12px'
  hint:
    fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    fontSize: '11.5px'
    lineHeight: '1.5'
  mono:
    fontFamily: "'Consolas','Courier New',monospace"
    fontSize: '14px'
    fontWeight: '700'
  hud-emoji:
    fontSize: '18px'
    letterSpacing: '1px'
rounded:
  sm: '4px'
  md: '8px'
  lg: '10px'
  xl: '12px'
  edu-card: '14px'
  full: '9999px'
spacing:
  '1': '2px'
  '2': '4px'
  '3': '6px'
  '4': '8px'
  '5': '10px'
  '6': '12px'
  '7': '16px'
  '8': '20px'
  gutter: '8px'
  panel-pad-x: '18px'
  panel-pad-y: '14px'
  hud-bottom: '20px'
components:
  button-mode:
    background: 'rgba(40,40,66,.9)'
    border: '2px solid #5a5a7a'
    borderRadius: '{rounded.lg}'
    padding: '14px 28px'
    fontSize: '17px'
    minWidth: '200px'
    hoverBorderColor: '{colors.accent}'
    hoverTransform: 'translateY(-2px)'
  button-secondary:
    background: 'rgba(40,40,66,.9)'
    border: '2px solid #5a5a7a'
    borderRadius: '{rounded.lg}'
    padding: '10px 26px'
    fontSize: '14px'
    hoverBorderColor: '{colors.accent}'
  button-primary-affirm:
    background: '{colors.accent}'
    color: '#12300a'
    borderRadius: '{rounded.md}'
    padding: '12px 40px'
    fontSize: '18px'
    fontWeight: '700'
  slot-row:
    background: 'rgba(40,40,66,.9)'
    border: '2px solid #5a5a7a'
    borderRadius: '{rounded.lg}'
    padding: '6px 12px'
    currentBorderColor: '{colors.accent}'
  hotbar-capsule:
    background: 'rgba(30,30,50,.85)'
    border: '3px solid {colors.border}'
    borderRadius: '{rounded.md}'
    padding: '6px 14px 6px 6px'
    slotSize: '52px'
    hoverBorderColor: '{colors.accent}'
  overlay-panel:
    width: 'min(92vw,560px)'
    maxHeight: '84vh'
    background: 'rgba(20,20,35,.97)'
    border: '4px solid {colors.border}'
    borderRadius: '{rounded.xl}'
    padding: '14px {spacing.panel-pad-x}'
    boxShadow: '0 10px 50px rgba(0,0,0,.8)'
  settings-panel:
    width: 'min(92vw,620px)'
    maxHeight: '84vh'
    background: 'rgba(20,20,35,.98)'
    border: '4px solid {colors.border}'
    borderRadius: '{rounded.xl}'
  edu-quiz-card:
    background: 'rgba(20,26,34,.92)'
    border: '3px solid {colors.edu-green}'
    borderRadius: '{rounded.edu-card}'
    padding: '18px 30px'
    boxShadow: '0 0 24px rgba(57,211,83,.45)'
    wrongBorderColor: '{colors.danger-deep}'
    wrongAnimation: 'edu-shake .3s'
  author-card:
    background: 'rgba(20,26,34,.95)'
    border: '3px solid {colors.gold}'
    borderRadius: '{rounded.edu-card}'
    padding: '14px 18px'
    boxShadow: '0 0 24px rgba(255,216,74,.35)'
  assistant-sidebar:
    width: 'min(430px,100vw)'
    dock: 'right-full-height'
    borderRadius: '0'
---

# mcweb — DESIGN.md（视觉规范 · 回溯性沉淀）

> 本文描述 mcweb「长什么样」。行为、信息架构、交互与旅程见同目录 `EXPERIENCE.md`；两份脊线文档冲突时以本文与 EXPERIENCE.md 为准，任何线框/截图/旧实现让位。
> **标注约定**：正文未标注 = 已上线实现的现状决策（证据指向 index.html 与各模块注入样式）；**【改进建议】** = 对齐 PRD E8~E11 的改进方向，尚未实现、不构成承诺。

## Brand & Style

mcweb 的视觉姿态是「**暗色像素游戏机 + 儿童课堂**」：一块全屏 Three.js WebGL 画布铺满视口（z 层最底），所有 UI 是浮在画布上的半透明深蓝面板（rgba 20,20,35 系），用 3px~4px 的描边和强烈投影把界面从 3D 场景里「托」出来。没有品牌 LOGO 图形、没有插画体系——**emoji 承担了全部图标职能**（🏗️ 建造 / ⚔️ 生存 / 🗺 关卡 / 🤖 助手 / 🚩 起点 / 🏁 终点），这是刻意的低龄可读性决策：9 岁儿童认图标先于认文字。

一切文字都带深色 `text-shadow`，保证叠在任意 3D 画面（雪原、洞穴、夜晚）上仍可读——这是全产品最重要的「对比度机制」，不依赖背景色。品牌色只有一颗：**草绿 {colors.accent}**（我的世界的草方块联想），用于全部「可点/可用/正向」语义；金黄色系表示「成绩/奖励/选中」，红橙系表示「危险/损耗/答错」。产品名「我的世界 - 网页复刻版」出现在首屏大标题与浏览器标签（改名议题见 PRD OQ-2/FR-42，UI 文案资产清单见 EXPERIENCE.md「已知痛点」）。

## Colors

| Token | 值 | 用途 | 不用于 |
|---|---|---|---|
| `{colors.void}` | `#000000` | body 底色（画布加载前） | 任何面板 |
| `{colors.night}` | `#1a1a2e` | 全局深蓝底基调（CSS 变量 `--mc-dark`） | 正文面板主色（面板用半透明变体） |
| `{colors.panel}` | `#2d2d44` | 中层底（`--mc-panel`） | 大面积平铺 |
| `{colors.panel-deep}` | `#26263e` | 输入框底（搜索框） | — |
| `{colors.panel-ink}` | `#141423` | 最深浮层底（E 面板/设置 rgba .95~.98 的基色） | HUD 短条 |
| `{colors.border}` | `#4a4a6a` | 面板主描边（`--mc-border`，3~4px） | 行内分隔 |
| `{colors.border-soft}` | `#5a5a7a` | 按钮/格子描边（`--mc-slot-border`）、kbd 键帽 | 面板外框 |
| `{colors.hover}` | `#5a5a8a` | 悬停底（`--mc-hover`） | 静止态 |
| `{colors.slot}` | `#3d3d5c` | 物品格/槽位底（`--mc-slot`） | 文字 |
| `{colors.accent}` | `#7ec850` | 草绿：可点/选中/正向/焦点（`--mc-accent`）；滑块 accent-color | 危险/错误语义 |
| `{colors.accent-soft}` | `#9ad24a` | 配方组标题、生存提示行 | 交互态 |
| `{colors.accent-pale}` | `#8fb573` | 学习页学科分组标题、图鉴注音 | 游戏内 HUD |
| `{colors.text}` | `#e0e0e0` | 正文（`--mc-text`） | — |
| `{colors.text-dim}` | `#9a9ab8` | 次要说明、hotbar hint | 正文主体 |
| `{colors.text-faint}` | `#77779a` | 空态/最弱说明 | 需要被儿童读到的信息 |
| `{colors.selected}` | `#ffdd55` | 选中描边（`--mc-selected`，热格/选中格 2px） | 大面积填充 |
| `{colors.gold}` | `#ffd84a` | 星级、作者面板描边、答案行、时间 | 错误语义 |
| `{colors.xp-gold}` | `#ffe97a` | 经验徽章、闯关计时 | — |
| `{colors.danger}` | `#ff6b5a` | 生存模式悬停、删除确认、缺失材料 | 正向动作 |
| `{colors.danger-deep}` | `#e05252` | 答题卡答错描边/抖动 | — |
| `{colors.warn}` | `#e0a030` | 工具耐久条「低」档 | — |
| `{colors.crit}` | `#e05040` | 工具耐久条「将坏」档 | — |
| `{colors.edu-green}` | `#39d353` | 答题机卡片描边与辉光（教学「这扇门能开」的心智色） | 普通游戏面板 |

**半透明覆盖层**（非 token，实现为 rgba）：暂停/浮层遮罩 `rgba(0,0,0,.55~.8)`；受伤红闪 `rgba(255,0,0,.35)`；死亡红幕 `rgba(80,0,0,.55)` + 2px blur。红闪与红幕是仅有的两次「全屏红」——只在掉血与死亡出现，构成强烈的生理信号。

**【改进建议】** 耐久条「低/将坏」与答错抖动目前是「颜色+位置」双编码，符合无障碍底线；但次要文字 `{colors.text-dim}`/`{colors.text-faint}` 在 `{colors.panel-ink}` 上的对比度接近 WCAG AA 下限，儿童设备（低亮度屏幕）可读性存疑——建议做一次对比度审计并给 `{colors.text-faint}` 定下限（E9 低段可读性前置）。

## Typography

系统字体栈 `'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif`——不引入 Web 字体（零依赖红线），中文渲染交给系统。**等宽字体 `Consolas` 是功能性字型**：所有数字型 HUD（计时/坐标/FPS/星级成绩/锁定明细）用 `{typography.mono}`，让跳动数字不抖宽。

字号阶梯（现状）：`{typography.display}` 48px 仅首屏标题 → 面板标题 17~20px → 正文 `{typography.body}` 14px → 辅助 12~13px → 提示 `{typography.hint}` 11.5px 为**全产品最小字号**（不再更小）。HUD 状态条（红心/鸡腿/气泡）用 18px emoji（`{typography.hud-emoji}`），结算星级 34px——数字与星级永远比周围文字大两级以上，孩子扫一眼就懂。

规则：
- 标题带 `letter-spacing: 1~4px`，营造「游戏标题感」；
- 文案里 keycap 用 `<kbd>` 样式（`{colors.slot}` 底 + `{colors.accent}` 字 + `{colors.border-soft}` 边）；
- **【改进建议】**（E9 低段）为 1~2 年级准备「大字模式」档位：正文提到 16px、按钮字号 +2px；实现建议走 `body.grade-low` 类覆盖 token，而非逐处改写。

## Layout & Spacing

全屏画布布局：游戏世界铺满 `100vw×100vh`，UI 全部 `position: fixed` 浮层，无文档流、无滚动页面（浮层内部各自滚动，`max-height: 80~84vh` + 细滚动条）。宽度安全公式：面板 `width: min(92vw, {680px|620px|560px|480px})`——92vw 保证小窗不溢出，上限按信息量分四档（背包 680 / 设置 620 / 关卡浮层 560 / 结算 480）。

垂直节奏：HUD 元素沿屏幕底缘中线堆栈，自下而上 手持胶囊 20px → 氧气泡 64px → 饥饿条 86px → 红心条 108px → 模式徽章 130px（经验徽章挂在红心右侧 +150px 偏移）；闯关计时条独占顶缘 12px。间距 token 为 2px 基阶（`{spacing.'1'}`..`{spacing.'8'}`），网格 gap 统一 `{spacing.gutter}`。

断点现状：仅一处 `@media (max-width:560px)` 让设置页槽位列表落单列；**其余 HUD 无响应式**——产品明示只支持桌面浏览器（PRD NFR-9），触屏/窄屏不在支持范围（声明见 EXPERIENCE.md「已知痛点」）。

**【改进建议】**（E9/E10）若题库与关卡按学段规模化，关卡列表浮层需预留筛选/分组栏的布局位（现 560px 面板只有「列表 + 底部动作行」两段式）；建议升级为「工具栏 + 分组列表」三段式，宽度提到 680px 与背包对齐。

## Elevation & Depth

深度语言三层：
1. **画布（z:1）** 是世界本身；HUD 元素（z:10~25）直接浮在其上，靠 `text-shadow: 0 2px 8px rgba(0,0,0,.9)` 与半透明底（`rgba(15,15,28,.85)` 级）保证可读，不投影。
2. **交互浮层（z:30~62）** 用大投影把「这是一扇窗」讲清楚：`box-shadow: 0 10px 50px rgba(0,0,0,.8)`（模态面板）到 `0 4px 20px`（手持胶囊）。答题机/作者卡片额外带**同色辉光**（绿色 `0 0 24px rgba(57,211,83,.45)` / 金色 rgba(255,216,74,.35)）——发光=「这是知识时刻」，是普通面板没有的待遇。
3. **全屏层（z:90~120）**：死亡幕（backdrop blur 2px）> 首屏 > 关卡列表 > 设置浮层 > 助手 toast。完整 z 阶梯登记在 EXPERIENCE.md「Information Architecture」，任何新浮层必须插入该阶梯而非另起魔法数。

准星用 `mix-blend-mode: difference` 反色渲染——在任何明暗背景上恒可见，是「零配置对比度」的范例实现。

## Shapes

圆角按「越高层越圆」递进：物品格/键帽 `{rounded.sm}`(4px) → 按钮与手持胶囊 `{rounded.md}`(8px) → 列表行/徽章 `{rounded.lg}`(10px) → 大浮层 `{rounded.xl}`(12px) → 教学答题/作者卡片 `{rounded.edu-card}`(14px，全场最圆+唯一带辉光的形状——形状本身参与「知识时刻」的表达)。胶囊类（模式徽章/经验徽章/官方关卡徽标）用 `{rounded.full}`。描述逻辑：**游戏操作件方硬、阅读与知识件圆润**，孩子在情境切换时能靠轮廓分辨「现在是工具还是考题」。

## Components

视觉规格见 frontmatter `components`；此处登记解剖与状态差异（行为规则归 EXPERIENCE.md）。

### 主行动按钮 `button-mode`
首屏建造/生存/回到游戏三兄弟：emoji 图标 28px 独占一行 + 按钮名 17px + 一句话说明 12px `{colors.text-dim}`。生存按钮 hover 变 `{colors.danger}`、建造变 `{colors.accent}`——**用描边色预告模式气质**。回游戏按钮通栏 420px + 绿描边，是首屏唯一常驻主行动。

### 次级按钮 `button-secondary` / 肯定按钮 `button-primary-affirm`
菜单动作行（保存/设置/关卡）与浮层动作行统一 14px 深底描边钮；唯一实心绿按钮是死亡界面的「🔥 重生」——全产品只此一处实心填充，把「从失败回来」做成最醒目的动作。

### 存档槽行 `slot-row`
图标（🏗️/⚔️ 按存档模式）+ 「世界 N · 当前」粗体 + 上次保存时间 11px；有档行 hover 浮现 ✕ 删除（变红「确认删除？」= 二次确认进行中）；空槽行显示「＋ 空槽位」与 🏗️/⚔️ 两个开新小钮。首屏与设置浮层共用同一渲染函数（settingsUI.renderSlotRows），视觉天然一致。

### 手持胶囊 `hotbar-capsule`
底部居中单行：1 格 52px 当前手持（含耐久条/数量角标）+ 物品名 + 快捷键提示。点击=打开背包。原版九宫格工具栏被刻意替换为单格胶囊——物品总量 38+ 远超一行，完整选择走 E 面板。

### 物品格与配方行 `inv-slot` / `recipe-row`
74px 方格（图标 36px + 10px 名称 + 数量角标 + 3px 耐久条 绿→黄→红）；配方行=产物+材料列表+站点标注，缺材料项变 `{colors.danger}`、整行降透明 42% 表示不可合成。悬停任意格/行 → 屏幕底部弹出物品说明条（见下）。

### 物品说明条 `item-info-strip`
与背包同宽（680px）的底部对话式信息条：左侧 40px 图标+金色名称，右侧最多 5 行说明（工具速度/耐久/伤害/采集门槛/特殊行为/合成关系，全由 config 数据推导）。pointer-events:none 不抢悬停。这是「把规则变成看得见的信息」的物化形态。

### 关卡列表行 `level-row`
行首 64px 俯视色块缩略图 + 卡名/作者/锁数 + 最佳成绩（★☆☆ + 等宽时间）+ 行内动作钮组（▶ 进入 / 🎥 拍宣传片 / ✏️ 改副本·继续编辑 / ⭐ 存为模板 / ✕ 删除）。徽标体系：🏰 官方关卡（绿底）/ ⭐ 模板 / 📝 草稿 / 仅本次会话——官方卡**永远没有删除钮**。

### 教学卡片 `edu-quiz-card` / `author-card`
答题机卡片（绿框辉光）与出题作者卡片（金框辉光）成对：考生看绿、作者看金。答错 = 框变红 + 0.3s 水平抖动动画 + hint 文案；答对 = 整卡消失 + 门体翻转绿光 + 庆祝 tooltip。抖动/变色都是 CSS 动画，**【改进建议】** 未来加 `prefers-reduced-motion` 降级（当前未处理）。

### 设置浮层页签 `gs-tab` 与卡片 `gs-card`
四页签（🎵 音频 / 🎛 画面 / 💾 存档 / 📚 学习），激活态绿字+绿下划线；页内容是一摞 `gs-card`（浅描边圆角卡，标题 13px 绿字 + 11.5px 灰说明），学习页遵循「交接卡不是监控报表」：错题按学科分组、答案放 `<details>` 折叠、🖨 打印只印带走区（白底黑字 print CSS）。

### AI 助手 `assistant-sidebar`
右侧滑入 430px 侧栏 + 左上角 🤖 浮动按钮（未配置时标题带「未配置」徽章）。视觉与主面板同族（深底+描边），但**独立于游戏状态机**：开着时游戏键照常。工具调用渲染为消息流内的折叠卡片。

### 空态与降级
所有列表有手写空态文案（关卡列表：「还没有关卡——✏️ 新建空白关卡用组件库搭一个，或让 🤖 帮你生成草稿」）；所有资源缺失走降级不改样式（题库→兜底题、缩略图→无图行、BGM→静默）——**降级不降视觉**是硬规矩。

## Do's and Don'ts

**Do**
- 一切浮在 3D 画布上的文字必须带深色 text-shadow 或半透明底。
- 用 emoji + 文字双编码传达状态（🔥 重生 / 💀 死亡数 / 🔒 锁进度），emoji 是图标体系的一部分，选贴近原版认知的（🏗️⚔️🗺🏁🤖✏️⭐🏰）。
- 危险动作（删档/导入覆盖/清空学习记录/重开）一律行内二次确认（4 秒冷却自动撤销），不弹系统 confirm。
- 正向/可用 = 草绿；成绩/答案 = 金黄；危险/答错 = 红橙——语义色不混用。
- 新面板复用「深底 3~4px 描边 12px 圆角大投影」骨架，并把新条目登记进本文 token。

**Don't**
- 不引入 Web 字体、CSS 框架、图标库——保持零依赖纯静态（NFR-1）。
- 不用系统 alert/confirm/prompt——统一 tooltip（#tooltip 顶部居中）与浮层内提示行。
- 不做浅色主题、不做皮肤系统——暗色半透明是唯一视觉（对比度机制依赖它）。
- 不让新浮层发明 z-index 魔法数——插入既有阶梯（EXPERIENCE.md）。
- 不把学习数据做成监控报表样式（折线大屏/时长统计）——学习页是「交接卡」：分组清单+折叠答案+打印。
- 不在结算/星级之外给答题行为做任何积分、排名、勋章类视觉激励（PRD SM-C2/FR-14 冻结）。

## 附录：假设与开放问题

- **A-D1**【假设】本文 token 以 2026-09-16 止的 index.html 与模块注入样式为基线；后续批次改动 UI 需走 Update 模式回写本文。
- **A-D2**【假设】emoji 在目标设备（家庭/课堂 Windows 与 mac 桌面 Chrome）渲染一致性可接受；安卓平板/国产浏览器内核未验证（与 OQ-3 触达假设相关）。
- **OQ-D1** 次要文字对比度未做 WCAG 审计（见 Colors 节改进建议）；儿童低亮度设备场景建议随 E9 立项一起测。
- **OQ-D2** 品牌改名（PRD OQ-2/FR-42）将影响首屏大标题、subtitle 与浏览器标签文案；建议改名裁决落地时同步产出「文案资产清单 + 替换方案」，格式字符串（mcweb.level.v1 等）不在其列。
- **OQ-D3** 答题/作者卡片为教学模块自注入样式（eduKeypad.js），与 index.html 骨架 token 已对齐但未抽公共类；是否收敛为共享样式表，待架构批次裁决。
