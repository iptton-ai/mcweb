# Edu M1：答题机（数学密码门）技术方案

> 2026-09-07 实施上线。玩法总纲见 edu-grade3-plan.md §1.1/§3（M1 = 数学密码门 + 最小任务跟踪）。
> 本文按 create-lite-plan.md 模板记录实现事实，供后续批次（NPC 商人/识字矿石等）照抄挂载点。

## 0. 玩法一句话

右键「答题机」方块弹出算式卡片 → 数字键作答 → 答对方块翻转为「已解锁」并成为
**常供能红石信号源**：贴门放=直接开门，接红石粉=远程解锁/驱动任意红石负载。
题库来自北师大版数学三年级上册第一单元「混合运算」（PDF 提取 + 程序化生成）。

## 1. 数据与常量（js/config.js）

- `KEYPAD_BASE = 224`（电梯组 218..222 之后），`KEYPAD_COUNT = 2`
- ID = `KEYPAD_BASE + solved`（0=锁定 / 1=已解锁·供能）；编解码 `keypadId/keypadSolved/isKeypadId`
- BlockInfo：普通实心立方体（无 customMesh/零 propMesh），hardness 1.5 pickaxe，
  `drop: KEYPAD_ITEM_ID`（固定锁定变体，防变体 ID 进背包不叠堆），`edu: true` 标记
- HotbarBlocks 末尾追加；生存开局礼包加 答题机×3 + 红石粉×8 + 红石灯×2（js/ui.js）

## 2. 模块

- **js/eduKeypad.js**（新增，教学玩法唯一入口）：
  - 题库：懒 fetch `assets/edu/grade3-math.json`（131 题：11 课本提取 + 120 生成），
    失败走内置 20 题兜底；答案全部限定 0..99（两位数字键可输入）
  - 抽题：`(worldSeed, x, y, z)` 稳定哈希 → 题目下标。**不进存档**，读档同格同题；
    破坏重放换题。⚠️ 哈希末步 `^>>15` 产出有符号 int32，取模前必须 `>>>0`
    （负下标 → question undefined → interactKeypadAt reject，实测踩过）
  - 答题 UI：`#edu-quiz` 卡片（模块自注入 CSS/DOM），不进 uiModal 状态机、不抢指针锁
  - 键盘：window **捕获阶段** keydown 拦截数字/退格/回车/Esc（先于 input.js 冒泡监听，
    答题中 1-9 不切快捷栏）；助手聊天开/非 playing 态自动收起；500ms 巡检走远(>5格)收起
  - 答对：翻转变体 + rebuildChunk + `updateRedstoneNetwork()` + 音效 + 进度
  - 学习进度：localStorage `mcweb.edu.v1`（solved/streak/wrong/quest1done，跨存档槽），
    M1 任务=解锁 3 台 → 达成播 fanfare
- **js/redstone.js**：全图扫描分支尾部加 `else if (isKeypadId(id)) keypads.push`（并入
  `id >= CLUTCH_BASE` 短路分支，不延长链）；`keypadSolved===1` 进 activeSources；
  早退门条件加 keypads。已解锁=永久供能（踩线原版拉杆语义）
- **js/interaction.js**：右键路由（拉杆之后）`interactKeypadAt`；破坏默认路径 +
  `brokeSolvedKeypad` 时重算红石网络
- **js/audio.js**：`playEduCorrect/Wrong/UnlockSound` —— fetch+decodeAudioData 缓存播放
  `assets/audio/edu_*.wav`（MusicGen small 本地生成，tools/gen_edu_sfx.py），
  缺文件回退 WebAudio 合成短音

## 3. 资产

- `assets/textures/keypad_locked.png / keypad_solved.png`（16×16）：ComfyUI Klein 4B +
  pixel-art LoRA 生成 512² → NEAREST 降采样 + alpha 合成到不透明底（图集 tile 无半透明），
  经 TILE_OVERRIDES 覆盖 tile 77/78；tile 79（背面）程序化兜底。程序化 drawFunctions
  77/78/79 同步注册（无覆盖文件时兜底）
- `assets/edu/grade3-math.json`：`tools/textbook_extract.py` 从
  `~/.dsh/smartedu-books/*数学三年级上册*/` PDF（PyMuPDF 文本层）提取
  （第一单元 PDF p5..17；extracted 为启发式抽题，M2 人工校对；generated 按知识点播种生成）

## 4. E2E 验证（2026-09-07 实测，注入式）

- ✅ 右键出题（课本题库 131 题加载、确定性同格同题）
- ✅ 数字输入/退格/回车；答题中 1-9 不切快捷栏
- ✅ 答对 → 变体 225 + 邻门 doorId 25（开）+ 红石灯点亮 + 进度 solved+1
- ✅ 答错 → 卡片 wrong 抖动类 + wrong/streak 计数 + 不关卡片可重试
- ✅ 贴图渲染正常（截图目检：绿屏+键盘清晰可读，无黑块/错位）
- ⚠️ 测试脚本直改方块不走重算会让 doorPoweredPrev 边沿基线脏掉（门拒开）——
  真实交互路径都会触发重算，无此问题；排查时注意

## 5. 后续批次挂载指引

- 新学科玩法照抄：config 编码段 → BlockInfo → eduKeypad 式独立模块 → interaction
  右键路由 → redstone/kinetic 挂供能 → textures tile 77..80 剩余 + TILE_OVERRIDES
- NPC/对话类玩法不占方块 ID，走 entities + quests；题库管线 `tools/textbook_extract.py`
  换 `--book` 与正则即可复用到语文/英语
