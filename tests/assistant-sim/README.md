# assistant-sim：无界面 AI 助手对话模拟环境

不启动浏览器、不渲染任何画面，但**对话是真的**（真实 LLM 流式请求 + 真实 agent 工具循环 +
真实世界数据），用来验证与度量「用户说一句话 → AI 实际走了哪些步骤」。

## 原理

| 层 | 处理方式 |
| --- | --- |
| LLM 请求（llm.js） | **真实**。Node 原生 fetch 直连 OpenAI 兼容上游（Key 走环境变量，不落盘） |
| agent 循环（agent.js） | **真实**。工具循环、历史裁剪、Jev 路由原样运行 |
| 工具（tools.js） | **真实**。scan/place/build_script/read_blocks/search_game_docs 全部真执行 |
| 世界数据 | **真实**。generateWorld 真实生成（固定种子可复现）、buildQueue 真实渐进施工、红石/动力网络真求解 |
| 渲染层 | **垫掉**（tests/assistant-sim/hooks.mjs + stubs/）：`three`→万能桩、`engine.js`/`textures.js`→桩（顶层需要真实 WebGL/Canvas）、`chunk.js`→源码改写（纯逻辑函数实时提取，网格函数 no-op） |
| 浏览器平台 | **垫掉**（browser-shims.mjs）：DOM/storage/location/fetch 相对地址，游戏模块在其上原样运行 |

关键文件：

- `hooks.mjs` —— Node `module.register` 钩子：只替换渲染叶子，`chunk.js` 的
  isSolid/shouldRenderFace 等纯函数**从真实源码按大括号配平提取**，不会与主仓漂移。
- `browser-shims.mjs` —— 平台垫片：假元素 DOM、内存 localStorage/sessionStorage、
  相对 URL fetch 补全到本地 server.py。
- `run.mjs` —— 运行器：复刻 main.js `freshWorld` 开局（固定种子）→ 调真实 `initUI()` →
  用 8ms 定时器泵 `updateBuild(dt)`（等价游戏主循环）→ 驱动 `runAgentTurn` 一轮完整对话，
  记录每轮耗时/工具调用/请求字节/施工结果，写 trace JSON 到 `out/`（已 gitignore）。

## 用法

```bash
# 主模型 Key（任意 OpenAI 兼容上游；只存在于进程环境，绝不写入仓库）
export MCWEB_SIM_LLM_KEY=sk-xxx          # 默认上游 https://runanytime.hxi.me/v1 模型 gpt-5.5
node tests/assistant-sim/run.mjs "帮我建一个电梯"

# 对照实验：开启 Jev 快速路由（Node 无 CORS 限制，直连官方 System One 端点）
source ~/.bashrc                         # 取 TYPESAFE_API_KEY
node tests/assistant-sim/run.mjs "帮我建一个电梯" --jev

# 复现实验（同种子同地形同提示词；注意 LLM 采样仍有随机性）
node tests/assistant-sim/run.mjs "帮我建一个电梯" --seed 20260921 --quiet
```

## trace 里看什么

- `rounds[]`：LLM 每轮耗时、正文/思考长度、每把工具的参数与结果（含字符数）
- `http[]`：每次真实请求的 kind（llm/jev/file-api）、上行字节、耗时
- `worldCheck`：施工后全图扫描电梯相关方块（传动轴/水车/平台/滑轮）数量 + 动力网络状态抽样
- `systemPromptChars` / `toolSchemaChars`：每轮固定开销
- `messages[]`：整场对话（同浏览器会话结构）

## 已知边界

- 渲染被垫掉：`rebuildChunk`/道具网格是 no-op，`state.torchLights` 只保留计数语义。
- `reload_game` 的 `location.reload()` 是 no-op（trace 会看到该工具被调用）。
- `fileApiOnline=true` 指向 `--origin`（默认本机 8000 的 server.py）——`write_game_file`
  会**真写仓库文件**（与真实行为一致），跑改码类实验前请自行确认工作区干净。
- `eduKeypad.js` 顶层 `setInterval` 会存活到进程退出，run.mjs 结束时显式 `process.exit(0)`。
