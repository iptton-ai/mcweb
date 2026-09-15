# 答题题库契约（Edu quiz banks contract，2026-09-09）

> 本批目标：把「答题环节」从「答题机只考数学第一单元」扩展为**多学科题库**。
> 本文件是内容侧（题库 JSON）与代码侧（js/eduKeypad.js 等加载引擎）的**唯一接口契约**，
> 两边并行开发、以本文件为准对拍。改契约必须先改本文件并同步所有相关方。

## 0. 参与方与文件写权限（advisory，一文件一主）

| 角色 | 拥有（可写） | 绝不碰 |
|---|---|---|
| math-bank | assets/edu/grade3-math.json、tools/（数学题生成脚本） | 其余全部 |
| quiz-engine | js/eduKeypad.js、js/eduRewards.js、js/settingsUI.js、assets/edu/banks.json、tools/validate_banks.py | 各题库 JSON 内容 |
| english-bank | assets/edu/grade3-english.json、js/eduMerchant.js | 其余全部 |
| chinese-bank | assets/edu/grade3-hanzi.json、assets/edu/grade3-yuwen.json | 其余全部 |
| science-daofa-bank | assets/edu/grade3-science.json、assets/edu/grade3-daofa.json | 其余全部 |
| lead（集成验收） | 不改上述文件；只读 + 汇总报告 | — |

- js/config.js、js/interaction.js、js/world.js、js/textures.js、index.html **本批一律不改**
  （方块、右键路由、导出名全部保持不变：`interactKeypadAt` / `interactMerchantAt` /
  `collectHanziAt` / `ensureHanziBank` 签名兼容）。

## 1. 题库清单 assets/edu/banks.json（quiz-engine 拥有）

答题机启动时加载此清单，逐个 fetch 题库文件；**单个题库缺失/损坏时跳过该学科并走内置
兜底题，绝不阻塞玩法**。

```json
{
  "note": "答题机题库清单：subject 为稳定 key（进度记账用，勿改）；file 相对 assets/edu/；weight 越大被抽中概率越高",
  "banks": [
    { "subject": "math",    "emoji": "🧮", "name": "数学", "file": "grade3-math.json",    "weight": 2 },
    { "subject": "science", "emoji": "🔬", "name": "科学", "file": "grade3-science.json", "weight": 1 },
    { "subject": "daofa",   "emoji": "🧭", "name": "道法", "file": "grade3-daofa.json",   "weight": 1 },
    { "subject": "yuwen",   "emoji": "📖", "name": "语文", "file": "grade3-yuwen.json",   "weight": 1 }
  ]
}
```

## 2. 题库文件统一 schema（grade3-{math,science,daofa,yuwen}.json）

```json
{
  "source": "教材版本 + 册次 + 依据页码（供家长/老师核对）",
  "subject": "math | science | daofa | yuwen（须与 banks.json 一致）",
  "subjectName": "数学",
  "banks": [
    {
      "kind": "input",
      "items": [
        { "q": "24×3", "a": 72, "unit": "三上·乘法", "hint": "先算 20×3=60，再算 4×3=12" }
      ]
    },
    {
      "kind": "choice",
      "items": [
        { "q": "水沸腾时的温度大约是？", "options": ["60℃", "80℃", "100℃", "120℃"], "a": 2,
          "unit": "三上·水", "hint": "标准大气压下水约 100℃ 沸腾" }
      ]
    }
  ]
}
```

硬性规则：
- `kind:"input"`：`a` 必须是 **0..9999 的整数**（答题机数字输入上限本批放宽到 4 位）。
- `kind:"choice"`：`options` 3~4 个**互不相同**的字符串；`a` 为正确项**下标（0-based）**。
- 每题必填 `unit`（单元标签）与 `hint`（答错时展示的讲解，一句话）。
- 每个文件至少提供一个 `banks` 条目；多单元就多条目（unit 写在 item 上，条目可按 kind 分）。
- **答案正确性自查**：input 重算一遍；choice 检查 `options[a]` 确为正确答案。
  用 tools/validate_banks.py（quiz-engine 提供）跑过再交付。

### 2.1 数学文件迁移（math-bank）
- grade3-math.json 从旧格式（顶层 extracted/generated 数组）迁移到 §2 统一格式；
  旧的 extracted 题目保留（hint 已含页码）。
- 覆盖北师大版三上全册单元：混合运算 / 观察物体 / 加与减 / 乘与除 / 周长 / 乘法 /
  年月日 / 认识小数（小数只考「元角分互化」类整数答案题）。
- quiz-engine 的加载器**同时兼容旧格式**（识别顶层 extracted/generated 时自动折叠为
  一个 input bank）——迁移期兜底。

## 3. 识字表升级（grade3-hanzi.json，chinese-bank）

```json
{ "source": "…", "chars": [ { "ch": "绒", "pinyin": "róng", "word": "绒毛" }, … ] }
```

- **258 字一字不漏**：新 chars 的 ch 集合必须与旧文件完全一致（用脚本对拍集合相等）。
- pinyin 标注课本常用音（多音字取三上课文常用读音，组词与读音一致）。
- 兼容：js/eduRewards.js 同时接受旧格式（字符串数组）与新格式；学习进度图鉴仍只存
  `ch` 单字；新增导出 `hanziInfo(ch)` → `{pinyin, word} | null`（图鉴注音用）。

## 4. 语文答题库（grade3-yuwen.json，chinese-bank，走 §2 schema）

- 古诗（统编三上：《所见》《山行》《赠刘景文》《夜书所见》《望天门山》
  《饮湖上初晴后雨》《望洞庭》《采莲曲》）：名句接句 / 补字 / 作者对应 / 名句理解。
- 字词积累：多音字选音、形近字辨析、日积月累成语谚语。
- 全部 choice 题，unit 标注「三上·古诗 / 三上·字词 / 三上·积累」。

## 5. 英语（自包含：english-bank 同时拥有数据与商人代码）

- `words` 保持 `{unit, en, zh}` 结构不变（存量 150 词），但**必须清洗**：
  - 修复脏数据（如 `{"en":"ten","zh":"years old 十岁"}` → zh 只留中文释义）；
  - `en` 全表唯一（小写化后判重——商人「已学会」集合以 en 小写为 key，重复词会互吞）。
- 新增顶层 `sentences: [{ "en": "How are you?", "zh": "你好吗？", "unit": 1 }, …]` ≥ 30 条
  （沪教版三上情景对话/句型）。
- 商人出题模式扩展：①看中文选英文（现状）②看英文选中文 ③句子情景三选一；
  句子学习进度以 `s:` 前缀记入图鉴集合，避免与单词 key 冲突。

## 6. 进度记账（quiz-engine）

- 兼容旧 key：`solved / wrong / streak / trades / words / hanzi / claimed` 全部保留照旧累加。
- 新增 `subjects: { math: {solved, wrong}, science: {…}, daofa: {…}, yuwen: {…} }`
  供家长报告按学科展示；英语商人如需分模式计数挂 `merchantModes` 下。

## 7. 质量红线

1. 答案与选项事实正确（安全/科学常识必须权威：如报警电话 110/119/120 用途不可混）。
2. 不大段抄课文（版权红线，同 edu-grade3-plan §4）：只收字词句点、公式、常识点。
3. 文案与注释中文；JSON 用 `python3 -m json.tool` 可解析；UTF-8 无 BOM。
4. 纯静态红线：不加后端、不引构建工具。
5. 交付前每个内容方跑一遍 tools/validate_banks.py 并附各文件题数统计。
