// ==================== assistant/knowledge.js ====================
// 游戏知识库：把散在各源码里的机制规则、数值、方块 ID、配方与「常见修改步骤」
// 整理成带关键词的精简章节，供 search_game_docs 工具按关键词检索。
// 目的：AI 回答机制类问题/动手改码前先查这里（一次几百~几千字），
// 不要整读 config.js(≈1500 行)/kinetic.js 等大文件——省时间省 token。
// 数值与 ID 段全部 import 自 config.js 动态生成：改 config 后知识库自动同步，不会漂移。
// 纯数据+纯函数，无浏览器依赖；tools/test_assistant_knowledge.mjs 可 Node 直测。
// 新增游戏机制时：在对应章节补一句，或新增章节并配好 keywords（检索靠它命中）。

import {
    BELT_BASE, BELT_ITEM_ID, BELT_SPEED, BELT_SU_LOAD,
    BREAK_DELAY, BUTTON_BASE, BUTTON_ITEM_ID, BUTTON_PULSE_SEC,
    COGWHEEL_BASE, COGWHEEL_ITEM_ID, CRUSHER_BASE, CRUSHER_ITEM_ID, CRUSHER_SU_LOAD, CRUSH_SEC,
    CLUTCH_BASE, CLUTCH_ITEM_ID,
    CREATIVE_BREAK_INTERVAL, DEPLOYER_BASE, DEPLOYER_ITEM_ID, DEPLOYER_SEC, DEPLOYER_SU_LOAD,
    DOOR_BASE, DOOR_COUNT, DOOR_ITEM_ID,
    DUST_BASE, DUST_ITEM_ID, FALL_DAMAGE_MIN,
    FLAG_BASE, HANZI_ORE, HUNGER_DRAIN_SEC, HUNGER_REGEN_MIN, HUNGER_REGEN_SEC,
    ITEM_MAGNET_DIST, ITEM_PICKUP_DIST,
    GRAVITY, JUMP_VELOCITY, KEYBOARD_TURN_SPEED, KEYPAD_BASE, KEYPAD_ITEM_ID,
    LAZY_DIST, LEAVES_APPLE_CHANCE, LEVER_BASE, LEVER_ITEM_ID, LAMP_BASE, LAMP_ITEM_ID,
    MAX_AIR, MAX_ENEMIES, MAX_HUNGER, MAX_PASSIVE_MOBS, MERCHANT_BASE,
    OBSERVER_BASE, OBSERVER_ITEM_ID, OBSERVER_PULSE_SEC, PISTON_BASE, PISTON_DELAY,
    PISTON_HEAD_BASE, PISTON_ITEM_ID, PISTON_PUSH_LIMIT, PULLEY_BASE, PULLEY_ITEM_ID,
    PULLEY_ROPE_MAX, PULLEY_SU_LOAD, PLATFORM_BASE, PLATFORM_ITEM_ID, PLATFORM_SU_LOAD,
    LIFT_SPEED, PEN_ID, PLATE_BASE, PLATE_ITEM_ID, RECIPES, RS_MAX_STRENGTH,
    RTORCH_BASE, RTORCH_DELAY, RTORCH_ITEM_ID,
    SAW_BASE, SAW_ITEM_ID, SAW_SPEED, SAW_SU_LOAD,
    SPAWN_MAX_DIST, SPAWN_MIN_DIST, STICKY_PISTON_BASE, STICKY_PISTON_ITEM_ID,
    STARLIGHT_BASE, SHAFT_BASE, SHAFT_ITEM_ID, KINETIC_RECIPES,
    SLIME_BOUNCE_KEEP, SLIME_BOUNCE_MIN,
    SAVE_SLOTS, SAVE_AUTOSAVE_SEC,
    TOOL_EXTRA_BASE, TORCH_SPAWN_BLOCK_RADIUS, WALK_SPEED, FLY_SPEED, PLAYER_EYE_HEIGHT,
    REACH_CREATIVE, REACH_SURVIVAL, TICK_RATE,
    WATERWHEEL_BASE, WATERWHEEL_ITEM_ID, WHEEL_RPM, WHEEL_SU_CAPACITY,
    XP_PER_CRAFT, XP_PER_HOSTILE_KILL,
    BlockInfo, BlockTypes, ItemTypes, ToolTypes, MOB_TYPES,
    isDoorId, isFlagId, isKeypadId, isKineticId, isMerchantId, isPistonGroupId,
    isRedstoneId, isStarlightId,
} from '../config.js';

// ---------- 纯渲染辅助（把 config 数据表压成一行行中文速查） ----------

function nameOf(id) {
    return BlockInfo[id]?.name || `ID${id}`;
}

// 主要实心方块的硬度/工具/掉落速查（有状态方块组在 ids 节另有覆盖，这里跳过防重复）
function renderHardness() {
    const skip = (id) => isDoorId(id) || isRedstoneId(id) || isPistonGroupId(id) || isKineticId(id) ||
        isKeypadId(id) || isMerchantId(id) || id === HANZI_ORE || isFlagId(id) || isStarlightId(id);
    const seen = new Set();
    const lines = [];
    for (const [idStr, info] of Object.entries(BlockInfo)) {
        const id = Number(idStr);
        if (typeof info.hardness !== 'number' || info.hardness < 0 || info.item || skip(id)) continue;
        const base = info.name.replace(/（.*）/g, '');
        if (seen.has(base)) continue;
        seen.add(base);
        const tool = info.tool ? `·${{ pickaxe: '镐', axe: '斧', shovel: '锹' }[info.tool] || info.tool}` : '';
        const nt = info.needsTool ? '·需对应工具才有掉落' : '';
        const drop = info.drop === null ? '·无掉落' : info.drop !== undefined ? `→掉${nameOf(info.drop)}` : '';
        lines.push(`${base}(${id}) 硬度${info.hardness}${tool}${nt}${drop}`);
    }
    return lines.join('；');
}

function renderKineticRecipes() {
    return Object.entries(KINETIC_RECIPES)
        .map(([k, v]) => `${nameOf(+k)}→${nameOf(v.item)}${v.count > 1 ? '×' + v.count : ''}`)
        .join('、');
}

function renderRecipes() {
    const stationNames = { crafting: '工作台', furnace: '熔炉' };
    const groups = { 徒手: [], 工作台: [], 熔炉: [] };
    for (const r of RECIPES) {
        const cost = Object.entries(r.cost).map(([k, n]) => `${nameOf(+k)}×${n}`).join('+');
        groups[r.station ? (stationNames[r.station] || r.station) : '徒手']
            .push(`${nameOf(r.out)}×${r.outCount}←${cost}`);
    }
    return ['徒手：' + groups.徒手.join('、'), '工作台：' + groups.工作台.join('、'), '熔炉：' + groups.熔炉.join('、')].join('\n');
}

function renderMobs() {
    return Object.values(MOB_TYPES).map((m) => {
        const drops = (m.drops || []).map(([id, p, extra]) =>
            `${nameOf(id)}×${1 + (extra || 0)}${p >= 1 ? '必掉' : `(${Math.round(p * 100)}%)`}`).join('/');
        return `${m.name}：${m.hostile ? '敌对' : '被动'} ${m.hp}血 速${m.speed}` +
            `${m.damage ? ` 伤${m.damage}` : ''}${m.fuseSec ? ` 贴近${m.fuseDist}格引信${m.fuseSec}s自爆` : ''}` +
            `${drops ? ' 掉' + drops : ''}`;
    }).join('；');
}

// 可进食物品（BlockInfo.food > 0）：苹果+4 生猪肉+3 熟猪排+8
function renderFoods() {
    return Object.entries(BlockInfo)
        .filter(([, info]) => info.food > 0)
        .map(([id, info]) => `${info.name}+${info.food}`)
        .join(' ');
}

// ---------- 知识节 ----------
// 每节 {id, title, keywords, text}：keywords 是检索命中的词表（查询词命中 title/keywords 得分最高）。

const SECTIONS = [
    {
        id: 'ids',
        title: '方块与物品 ID 总表（含状态编码公式）',
        keywords: ['ID', '方块', '物品', '编码', '变体', '基址', 'doorId', '编号', '区间'],
        text: [
            `基础：0空气 1草方块 2泥土 3石头 4原木 5树叶 6沙子 7水(非固体) 8基岩(不可破坏) 9砖块 10玻璃 11木板 12圆石 13沙砾 14雪 15树干 16火把 17花 18TNT ${BlockTypes.SLIME}粘液块`,
            `生存方块：${BlockTypes.COAL_ORE}煤矿石 ${BlockTypes.IRON_ORE}铁矿石 ${BlockTypes.DIAMOND_ORE}钻石矿石 ${BlockTypes.CRAFTING_TABLE}工作台 ${BlockTypes.FURNACE}熔炉 ${BlockTypes.WOOL}羊毛`,
            `门 ${DOOR_BASE}..${DOOR_BASE + DOOR_COUNT - 1}：ID=${DOOR_BASE}+half*8+open*4+facing（half 0下/1上，上格=下格+8；open 0关/1开；facing 0北/1东/2南/3西）；摆放写 ${DOOR_ITEM_ID}`,
            `红石组：粉 ${DUST_BASE}+lit(0灭/1亮)→写${DUST_ITEM_ID}；火把 ${RTORCH_BASE}+facing*2+lit（facing 0贴地/2北墙/3东墙/4南墙/5西墙，不能贴顶）→写${RTORCH_ITEM_ID}；按钮 ${BUTTON_BASE}+facing*2+pressed→写${BUTTON_ITEM_ID}；压力板 ${PLATE_BASE}+pressed→写${PLATE_ITEM_ID}；拉杆 ${LEVER_BASE}+facing*2+on→写${LEVER_ITEM_ID}；红石灯 ${LAMP_BASE}+lit→写${LAMP_ITEM_ID}`,
            `活塞组：活塞 ${PISTON_BASE}+facing*2+extended、粘性活塞 ${STICKY_PISTON_BASE}+同式、活塞头 ${PISTON_HEAD_BASE}+facing（非物品）、观察者 ${OBSERVER_BASE}+facing*2+powered；facing 0上/1下/2北/3东/4南/5西；摆放写 ${PISTON_ITEM_ID}/${STICKY_PISTON_ITEM_ID}/${OBSERVER_ITEM_ID}`,
            `动力组：传动轴 ${SHAFT_BASE}+axis、齿轮 ${COGWHEEL_BASE}+axis、水车 ${WATERWHEEL_BASE}+axis、粉碎轮 ${CRUSHER_BASE}+axis（axis 0东西X/1上下Y/2南北Z）；机械锯 ${SAW_BASE}+facing(0上..5西)；摆放写 ${SHAFT_ITEM_ID}/${COGWHEEL_ITEM_ID}/${WATERWHEEL_ITEM_ID}/${CRUSHER_ITEM_ID}/${SAW_ITEM_ID}`,
            `物流组：传送带 ${BELT_BASE}+dir(0北/1东/2南/3西)→写${BELT_ITEM_ID}；投料器 ${DEPLOYER_BASE}+facing→写${DEPLOYER_ITEM_ID}；离合器 ${CLUTCH_BASE}+axis*2+断开位(0接合/1断开)→写${CLUTCH_ITEM_ID}`,
            `电梯组：滑轮 ${PULLEY_BASE}+up*2+powered（up 0垂挂/1顶举）→写${PULLEY_ITEM_ID}；电梯平台 ${PLATFORM_BASE}（普通实心立方体）`,
            `教学组：答题机 ${KEYPAD_BASE}+solved(0锁/1已解锁)→写${KEYPAD_ITEM_ID}；英语商人 ${MERCHANT_BASE}；识字矿石 ${HANZI_ORE}；关卡旗 ${FLAG_BASE}+kind(0起点/1检查点/2终点)；星辉门 ${STARLIGHT_BASE}+state(0锁/1开)；出题笔(物品) ${PEN_ID}`,
            `工具（物品不可放置）：铁镐${ToolTypes.PICKAXE} 铁斧${ToolTypes.AXE} 铁锹${ToolTypes.SHOVEL} 铁剑${ToolTypes.SWORD}；木/石/钻档 ${TOOL_EXTRA_BASE}..${TOOL_EXTRA_BASE + 11}（镐斧锹剑 × 木石钻顺序：木镐${ToolTypes.WOOD_PICKAXE} 石镐${ToolTypes.STONE_PICKAXE} 钻镐${ToolTypes.DIAMOND_PICKAXE} 木斧${ToolTypes.WOOD_AXE} …）`,
            `材料食物（物品不可放置）：${ItemTypes.STICK}木棍 ${ItemTypes.COAL}煤炭 ${ItemTypes.IRON_INGOT}铁锭 ${ItemTypes.DIAMOND}钻石 ${ItemTypes.APPLE}苹果 ${ItemTypes.RAW_PORK}生猪肉 ${ItemTypes.COOKED_PORK}熟猪排 ${ItemTypes.GUNPOWDER}火药`,
            '有状态方块（门/红石/活塞/动力/物流/电梯/教学）的状态都直接编码进方块 ID，没有额外元数据；编码解码纯函数都在 js/config.js（doorId/rtorchId/pistonId/shaftId/clutchId/pulleyId…）。',
        ].join('\n'),
    },
    {
        id: 'mining',
        title: '挖掘·工具·方块属性',
        keywords: ['挖掘', '硬度', '工具', '耐久', '掉落', '采集', '镐', '破坏', '裂纹', 'outline', '选取'],
        text: [
            '破坏耗时(秒)=硬度×(可采集?1.5:5)÷工具速度；水中或悬空再×5；每破坏一块强制间隔 ' + BREAK_DELAY + 's；创造模式即点即碎（限速 ' + CREATIVE_BREAK_INTERVAL + 's/块）；硬度 -1=不可破坏（基岩）。',
            '工具四档：速度 木2/石4/铁6/钻8，耐久 59/131/250/1561，用坏即消失（HUD 有耐久条）；剑不加速挖掘，攻击 木4/石5/铁6/钻7 伤害·0.6s 冷却，徒手 1 伤害·0.25s，创造一击必杀。',
            '采集门槛（minTier/needsTool）：煤矿需木镐+、铁矿需石镐+、钻石需铁镐+；石头/圆石/砖 needsTool——等级不够挖开也无掉落（原版 harvest 规则）。',
            '掉落映射：石头→圆石、草方块→泥土、玻璃/树叶无掉落、树叶 ' + Math.round(LEAVES_APPLE_CHANCE * 100) + '% 掉苹果；矿石经验 煤+2 铁+2 钻+7 识字矿+3。',
            '硬度速查：' + renderHardness() + '。',
            '不满格道具（火把/花/红石元件/门/传送带/旗…）在 config.js 的「选取形状 outline」段登记格内局部 AABB——碰撞(BlockInfo.solid)、选取框(outline)、渲染模型三者解耦；新道具不登记 outline 准星会整格黑框。',
        ].join('\n'),
    },
    {
        id: 'world',
        title: '世界·时间·物理·刷怪·矿石分布',
        keywords: ['世界', '尺寸', '坐标', '区块', '时间', '重力', '刷怪', '物理', '种子', '矿石', '夜晚'],
        text: [
            '世界 ' + 256 + '×' + 256 + '×' + 128 + '（x/z 0..255，y 0..127 向上，y=0 基岩层）；方块存 Uint8Array：index=x+z*W+y*W*D；区块 16×16，改方块后必须 rebuildChunk（建造类工具已自动处理）。',
            '时间：state.time 秒，state.dayLength=600s 一天，新世界从清晨开局（time=0.3×dayLength）；isNight() 为夜晚（刷怪）。',
            '物理：重力 ' + GRAVITY + '、跳跃 ' + JUMP_VELOCITY + '、走路 ' + WALK_SPEED + '、飞行 ' + FLY_SPEED + ' 格/秒；玩家碰撞盒 0.6×1.8、眼高 ' + PLAYER_EYE_HEIGHT + '；触及距离 生存' + REACH_SURVIVAL + '/创造' + REACH_CREATIVE + '；游戏刻 ' + Math.round(TICK_RATE * 1000) + 'ms。',
            '刷怪（对齐原版）：敌对上限 ' + MAX_ENEMIES + '；生成距离 ' + SPAWN_MIN_DIST + '..' + SPAWN_MAX_DIST + ' 格，火把 ' + TORCH_SPAWN_BLOCK_RADIUS + ' 格内不刷；' + LAZY_DIST + ' 格外冻结 AI 并按小概率消失；被动生物（猪羊牛）上限 ' + MAX_PASSIVE_MOBS + '，白天草地小群补充。',
            '矿石分布（world.js oreAt，种子进存档）：煤 y<44 / 铁 y<30 / 钻石 y<12；识字矿石 y≤44 约 1% 独立分段。',
            '纯键盘模式：方向键转视角 ' + KEYBOARD_TURN_SPEED + ' 弧度/秒（×设置里的灵敏度倍率）。',
        ].join('\n'),
    },
    {
        id: 'redstone',
        title: '红石系统（源→布线→负载）',
        keywords: ['红石', '信号', '红石粉', '火把', '拉杆', '按钮', '压力板', '红石灯', '时钟', '反相器', '电路', '充能'],
        text: [
            '模型（对齐原版）：信号源 ' + RS_MAX_STRENGTH + ' 级 → 红石粉布线每格 -1、0 级断路（可斜上/斜下一格爬坡）→ 负载（红石灯/门/TNT/离合器等）。',
            '激活红石粉会充能「脚下 + 四邻水平」的实心方块；拉杆/按钮/压力板充能各自的挂靠/支撑方块。',
            '元件行为：拉杆=右键开关（稳态源）；按钮=右键按下 ' + BUTTON_PULSE_SEC + 's 自动弹回（脉冲源）；压力板=只放顶面，玩家/怪物踩住即源（自动门/陷阱）；红石灯=6 邻有激活粉或激活源即点亮（亮时发光、照到的格子不刷怪）。',
            '红石火把=反相器：默认亮；挂靠方块被充能则熄灭、解除复亮，切换延迟 ' + RTORCH_DELAY + 's（两级串联还原信号；输出粉绕回挂靠方块=时钟）。不能贴顶放置。',
            '时序：门在信号上升沿开、下降沿关（手动右键不受影响）；TNT 放置为惰性，上升沿点燃或右键点燃；离合器/滑轮的通断变体由红石网络按电平回写。',
            '经典形态：自动门（压力板+粉+门）、远程开门（粉线 ≤13 格）、闪烁灯/时钟（火把+粉环）、陷阱（压力板+TNT）。',
            '实现（改码用）js/redstone.js：placeRedstone / toggleLeverAt·pressButtonAt / breakRedstoneAt（失支撑连锁脱落）/ updateRedstoneNetwork（事件触发全量重算）/ updateRedstoneTick（每帧：按钮弹出·火把翻转·压力板·末尾驱动活塞组）。',
        ].join('\n'),
    },
    {
        id: 'piston',
        title: '活塞组·粘液块·观察者',
        keywords: ['活塞', '粘性', '粘液', '推动', '拉动', '观察者', '弹跳', '载人', '飞行机器', '伸出'],
        text: [
            '放置：朝「所点击面的外法线」（点顶面=朝上、贴墙=垂直墙面）。信号上升沿伸出、下降沿收回，动作延迟 ' + PISTON_DELAY + 's（延迟动作队列：边沿只入队，updatePistonTick 消费）。',
            '推动：最多 ' + PISTON_PUSH_LIMIT + ' 格；基岩/伸出态活塞/活塞头挡路=整个动作不动；路径上的贴面道具（红石/门/火把/花/带）被压碎并返还物品。粘性活塞收回=把头前方块拉回一格。',
            '粘液块：被推/拉时把六邻粘着的可推方块整体拖走/拉回（飞行机器的基础）；落速 ≥' + SLIME_BOUNCE_MIN + ' 格/秒落上=反弹保留 ' + Math.round(SLIME_BOUNCE_KEEP * 100) + '% 垂直速度（弹跳高度按平方衰减、免摔伤），低速落上正常站定不抖——垫粘液块即弹跳跃层/落地缓冲。',
            '活塞载人：伸出/收回用 AABB 命中「占据被占格/站方块顶」的玩家·怪物·物品整体平移 1 格（piston.js 的 carryRiders，电梯平台共用）；水平推动可载着站在方块顶的人走。',
            '观察者：像普通方块一样放置，正前方方块增删/变化→背面输出 ' + OBSERVER_PULSE_SEC + 's 脉冲（可做活塞时钟的心跳）。',
            '破坏：打活塞头=反查底座整只拆（breakPistonGroupAt）；TNT 爆炸后的孤儿（头/底座失配）由 fixPistonAround 修复。',
        ].join('\n'),
    },
    {
        id: 'kinetic',
        title: '动力组（水车/传动轴/齿轮/粉碎轮/机械锯）',
        keywords: ['动力', '水车', '传动轴', '齿轮', '粉碎轮', '机械锯', '应力', 'RPM', '转速', '过载', '粉碎'],
        text: [
            '动力链（Create 风格）：水车顶面接触静态水=动力源，全网 ' + WHEEL_RPM + ' RPM + 每台 ' + WHEEL_SU_CAPACITY + ' SU 应力容量（多水车只叠容量不叠转速）→ 传动轴同轴串联 1:1 传速 → 齿轮与垂直轴的相邻齿轮啮合=换向反转（平行并排不连接）→ 终端机器。',
            '应力负载：配对粉碎轮 ' + CRUSHER_SU_LOAD + '/只（单只不成对不计）、机械锯 ' + SAW_SU_LOAD + '、传送带 ' + BELT_SU_LOAD + '/格、投料器 ' + DEPLOYER_SU_LOAD + '、已绑滑轮 ' + PULLEY_SU_LOAD + '+平台 ' + PLATFORM_SU_LOAD + '/格；总负载>总容量 或 转向冲突=整网停转（准星对准动力方块可见转速/应力/故障）。',
            '粉碎轮：水平相邻两轮同轴才配对工作；正上方格=投料口，' + CRUSH_SEC + 's 碾碎，配方（config.js KINETIC_RECIPES）：' + renderKineticRecipes() + '；表外方块投不进。',
            '机械锯：朝向格=被锯目标，通电自动锯切（原木/树干→木板×4、石头→圆石），等效挖掘速度 ' + SAW_SPEED + '（≈铁质工具）。',
            '转速/转向/应力/机器进度全是派生态不进存档：js/kinetic.js 事件触发 updateKineticNetwork 全量求解写运行时 Map，updateKineticTick 每帧（旋转动画只动 spinner.rotation + 粉碎/锯切计时）。',
            '放置：水车/轴/齿轮/粉碎轮轴向=所点击面法线（点顶面=立轴、贴墙=横轴）；机械锯/投料器朝向=面法线。查状态 kineticStatusAt（HUD 常显）、isBeltRunningAt。',
        ].join('\n'),
    },
    {
        id: 'logistics',
        title: '物流控制组（传送带/投料器/离合器）',
        keywords: ['传送带', '投料器', '离合器', '物流', '产线', '运输', '无人'],
        text: [
            '传送带（贴实心方块顶面放置，带向=放置时玩家朝向）：必须挨着通电的轴/齿轮等动力方块（顶面或四邻）才运转；带速 ' + BELT_SPEED + ' 格/秒恒定；落上的掉落物（items.js carried 模式）与玩家都会被带动；断电原地停、复电续走；尽头掉落、抵墙停留、物品 0.35 格间距排队不重叠。',
            '投料器（朝向=所点击面的外法线，照机械锯贴面）：通电每 ' + DEPLOYER_SEC + 's 把捕获三格 {朝向格, 朝向格上方, 自身头顶} 里的「方块类物品」变回方块塞进朝向格（守卫：界内/目标为空气或水/材料·工具·食物·贴面道具不投/玩家与怪 AABB）；朝向粉碎轮投料口=自动再投料。',
            '离合器（串进传动轴中段，照轴定轴向）：红石充能=断开传动（水车侧照转、下游停），断电接合；通断变体由红石电平回写；自身不计应力。',
            '无人值守产线示例：粉碎轮旁一格放投料器朝投料口、带尽头架在投料器正上方——丢一块石头上带，自动 石→圆石→沙砾→沙 滚三轮停在末端。',
        ].join('\n'),
    },
    {
        id: 'elevator',
        title: '电梯组（滑轮/电梯平台）',
        keywords: ['电梯', '滑轮', '平台', '升降', '卷绳', '绑绳', '呼梯', '井道'],
        text: [
            '滑轮：贴方块底面（朝下垂挂，绳/平台在下方）或顶面（朝上顶举）放置；背面接传动轴（竖轴/横轴都接），正面（朝向）是绳出口不传动。',
            '绑绳：沿朝向 ≤' + PULLEY_ROPE_MAX + ' 格内第一个「电梯平台」自动绑定（绳可穿水与贴面道具、不穿实心方块）；两台滑轮夹同一平台=先扫描者得（y 低先得）。',
            '运行：接上水车动力匀速 ' + LIFT_SPEED + ' 格/秒巡航（离散跨格）；红石拉杆即呼梯按钮——充能=卷绳（平台向滑轮收拢）、断电=放绳；断水/过载/离合器断开=平台悬停不坠落；行程端点（前方被挡）空转并 HUD 提示，撤挡自动续走。',
            '应力：滑轮 ' + PULLEY_SU_LOAD + '/台（未绑定不计）+平台 ' + PLATFORM_SU_LOAD + '/格——两台电梯（80 SU）已超单水车容量（' + WHEEL_SU_CAPACITY + '），要学会加水车。',
            '平台=普通实心方块：可当建材、站顶的玩家/物品/怪物由 carryRiders 载运、可被活塞推走（推离绳路自动脱绑、推回重绑）；平台顶贴的红石粉跨格时连锁脱落返还；井道旁观察者能侦测平台经过。',
        ].join('\n'),
    },
    {
        id: 'survival',
        title: '生存系统（饥饿/氧气/合成/经验/成长线）',
        keywords: ['生存', '饥饿', '氧气', '摔落', '经验', '合成', '配方', '食物', '熔炉', '工作台', '进食', '溺水'],
        text: [
            '饥饿（满 ' + MAX_HUNGER + '）：移动 ' + HUNGER_DRAIN_SEC + 's/点（疾跑×2.7、站立×0.2）；≥' + HUNGER_REGEN_MIN + ' 每 ' + HUNGER_REGEN_SEC + 's 判定回 1 血；=0 判定扣血（最低扣到 1）。食物（BlockInfo.food，右键进食）：' + renderFoods() + '。',
            '氧气 ' + MAX_AIR + 's：头部没入水开始倒数，归零每 1.5s 扣 2 血；出水 3 倍速恢复。摔落：落差 >' + FALL_DAMAGE_MIN + ' 格开始扣血=floor(落差-3)；水中游泳免摔。',
            '经验（HUD ✨）：合成+' + XP_PER_CRAFT + '、杀敌对+' + XP_PER_HOSTILE_KILL + '、矿石见 mining 节。',
            '矿石与门槛：煤 y<44（木镐可采）、铁 y<30（石镐+）、钻石 y<12（铁镐+）；铁矿掉自身需熔炉炼锭（每条熔炉配方含煤炭×1 燃料；木炭例外=两根原木自燃出炭）。',
            '成长线：撸树→木板→木棍→工作台→木镐→挖圆石→石镐→挖铁→熔炉铁锭→铁镐→挖钻石→钻石装备。',
            '合成表（config.js RECIPES 纯数据，E 面板可搜索；站点判定=右键打开台/炉或站在旁边 4 格）：\n' + renderRecipes(),
        ].join('\n'),
    },
    {
        id: 'mobs',
        title: '生物与刷怪',
        keywords: ['生物', '怪', '僵尸', '苦力怕', '猪', '牛', '羊', '掉落', '刷怪', '敌对', '自爆'],
        text: [
            '图鉴（config.js MOB_TYPES）：' + renderMobs() + '。',
            '行为：僵尸追击近战、白天着火消散；苦力怕贴近进入引信膨胀闪烁→自爆（复用 TNT 爆炸，半径 3.5）；被动生物游荡、被打逃跑 3 秒。',
            '掉落走真物品实体（items.js spawnItemDrop：0.25 小立方+重力+磁吸 ' + ITEM_MAGNET_DIST + ' 格+拾取 ' + ITEM_PICKUP_DIST + ' 格+120s 寿命）。',
            '刷怪规则见 world 节：24~128 环带/火把 6 格内不刷/成群/32 格冻结；玩家第三人称模型与原型 clone 共享在 entities.js 的 buildMobProto。',
        ].join('\n'),
    },
    {
        id: 'saves',
        title: '存档与全局状态（state 字段速查）',
        keywords: ['存档', 'localStorage', '槽位', '迁移', '版本', 'state', '字段', '快照', '自动保存'],
        text: [
            '多槽存档：localStorage mcweb.save.v1.slotN（' + SAVE_SLOTS + ' 槽，每槽一个独立世界）+ 轻量索引 mcweb.save.index；方块 RLE base64（enc rle/raw）+ 玩家（hunger/air/xp/toolWear）/模式/时间/出生点/worldSeed；当前槽 state.saveSlot。自动存 ' + SAVE_AUTOSAVE_SEC + 's + 页面隐藏兜底。',
            '版本：v4 起带 dims=[宽,高,深]——尺寸不符的老档按存档种子重生成地形+老区域逐格覆盖迁移（玩家改动零丢失）；改存档字段需同步 SAVE_VERSION 版本号。导出/导入：saveGame.js exportSlotJson/importSlotJson（设置浮层「💾 存档」页）。',
            '世界切换/覆盖重开时 main.js 必调 clearBuildQueue 清 AI 施工队列（防幽灵建筑）；闯关(state.levelRun)/编辑器(state.levelEdit)期间 saveGame 入口闸拒绝写槽。',
            'state.js 关键字段：blocks(Uint8Array)、player{x,y,z,yaw,flying,health,hunger,air,xp,toolWear,inventory,selectedSlot,onGround}、enemies、itemDrops(不进存档)、time、spawn、worldSeed、buildSpeedIdx/buildPaused(施工)、chunkUpdates、levelRun(闯关中非 null)、levelEdit(编辑器中非 null)。',
            '助手热重载快照：assistant/snapshot.js 存 sessionStorage（方块 RLE 复用 js/rle.js），reload_game 后自动恢复世界与玩家。',
        ].join('\n'),
    },
    {
        id: 'modules',
        title: '模块地图（改码定位：哪个文件管什么、关键导出）',
        keywords: ['模块', '文件', '函数', '导出', '源码', '结构', '哪里', '地图'],
        text: [
            '一文件一职责（先在这里定位，再 read_game_file 只读目标文件）：',
            '- config.js：全部常量与 ID 编码纯函数（doorId/rtorchId/pistonId/shaftId/clutchId/pulleyId…）、BlockTypes/BlockInfo（含 outline 选取形状）、RECIPES/KINETIC_RECIPES、ToolTypes 与 registerTool',
            '- state.js：全局单例 state（唯一数据源）+ isCreative()/isNight()；main.js：装配与主循环 gameLoop（updateMining→物理→viewmodel→渲染→renderViewmodel）',
            '- world.js：generateWorld/getBlock/setBlockSafe（地形种子混入 worldSeed）；chunk.js：rebuildChunk(cx,cz)/updateChunkMeshes/isSolid/isTransparent/getPropMesh/refreshPropAt',
            '- mining.js：蓄力挖掘（硬度×1.5/5÷速度、裂纹、canHarvest、damageHeldTool）；interaction.js：breakBlockAt/placeBlock/raycastBlocks（outline 精确求交）/dropHeldItem/pickBlockUnderCrosshair',
            '- 有状态方块四组高层逻辑：door.js（tryPlaceDoor/toggleDoorAt/breakDoorAt）、redstone.js（placeRedstone/updateRedstoneNetwork/updateRedstoneTick）、piston.js（placePiston/updatePistonTick/carryRiders/updateObservers）、kinetic.js（placeKinetic/updateKineticNetwork/updateKineticTick/kineticStatusAt）',
            '- items.js：spawnItemDrop/updateItemDrops（重力/磁吸/骑带）；entities.js：MOB_TYPES 驱动的 AI 与刷怪；tnt.js：点燃与爆炸；particles.js：粒子',
            '- playerPhysics.js：移动碰撞重力游泳摔落骑带；playerLife.js：updateSurvivalStats/doEat/addXp/HUD/死亡重生',
            '- input.js：键鼠输入（isPlaying() 门控、isTypingTarget 让路）；uiModal.js：模态状态机+指针锁唯一管理者（新增浮层必须接入）；uiKeys.js：浮层方向键导航；ui.js：HUD/背包/合成面板/拍摄面板；itemInfo.js：describeItem 说明条；settingsUI.js：设置浮层',
            '- buildQueue.js：enqueueBuildOps/getBuildStatus/setBuildSpeedIdx（AI 渐进施工+分帧重建）；saveGame.js：initSaves/loadGame/saveGame/exportSlotJson/importSlotJson；rle.js：零依赖 RLE',
            '- textures.js：Canvas 程序化纹理（tiles/drawFunctions/blockUVs；TILE_OVERRIDES 用 assets/textures/ 覆盖）；engine.js：three 场景；daynight.js：昼夜+天空；audio.js：音效；bgm.js：态势配乐状态机；viewmodel.js：手部视图；cameraRig.js：跟拍/自由镜；recording.js：画布录像；highlight.js：选取框',
            '- 教学与关卡：eduKeypad.js/eduMerchant.js/eduStarlight.js/eduRewards.js、levelRun.js（enterLevel/exitLevelRun）、levelWorkshop.js（buildLevelCard/validateLevelCard/reachabilityBFS/embedLevelToWorld）、levelEditor.js、levelPrefabs.js、questionBank.js/questionBankUI.js、levelPoster.js',
            '- assistant/：本助手自身代码，除非用户明确要求不要修改；*.bak* 历史备份禁止读写',
        ].join('\n'),
    },
    {
        id: 'recipes',
        title: '常见修改步骤（加方块/加键位/加配方/调参/热重载）',
        keywords: ['修改', '新增', '添加', '步骤', '热重载', '纹理', '贴图', '调参', '常量', '怎么改', '实现'],
        text: [
            '新增普通方块：① config.js——BlockTypes 加 ID（下一个可用整数）、BlockInfo 加 {name,solid,transparent,color,hardness,tool,needsTool,drop}、按需加入 HotbarBlocks；② textures.js——tiles 加 {type,top,side,bottom}+drawFunctions 加绘制函数（空闲 tile 45..63；扩 atlasSize 会整体平移所有 UV，慎动）；③ 非标准立方体设 customMesh:true 并在 chunk.js getPropMesh 加分支（参考 TORCH/FLOWER）；④ 交互逻辑 interaction.js。',
            '不满格道具：在 config.js「选取形状 outline」段登记局部 AABB（数值可用 tests/e2e/probe_outline.py 实测），否则准星整格黑框、指空格也算瞄到。',
            '新增有状态方块：照门/红石组模式——config.js 编码常量+编解码纯函数 → 新建逻辑模块（放置/开关/破坏）→ chunk.js getPropMesh 分支 → interaction.js 交互分支；派生态优先编进 ID 或走运行时 Map（参照动力组，存档零改动）。',
            '新增键位：input.js 的 keydown 加 e.code 分支——游戏键用 isPlaying() 门控、打字中的输入框用 isTypingTarget(e) 让路、避开浏览器默认键并 preventDefault；浮层内按键看 uiKeys.js 范围表。',
            '调参：只改 config.js（物理/刷怪/挖掘节奏/动力数值/ hunger 等全集中于此）；新增合成/粉碎配方只改 RECIPES/KINETIC_RECIPES 纯数据表；新增生物=MOB_TYPES 图鉴+entities.js 行为；新增 BGM 态势=bgm.js 文件头常量+assets/audio。',
            '世界扩容：只改 WORLD_WIDTH/DEPTH/HEIGHT（v4 dims 自动迁移老档）；代价先算：红石/动力全图重算 ×N、存档体积 ×N。',
            '改码流程（热重载）：write_game_file 是整文件覆盖——必须先 read_game_file 基于最新内容做最小修改；多文件改完只调一次 reload_game；重载后 get_runtime_errors 查错。代码必须语法正确（ES Module 闭合），否则页面黑屏助手也挂。',
        ].join('\n'),
    },
    {
        id: 'keys',
        title: '键位与输入模式',
        keywords: ['键位', '按键', '快捷键', '输入', '键盘', '鼠标', '操作', '按什么'],
        text: [
            '移动：WASD/Space 跳（创造双击空格或 F 切飞行）/Shift 潜行·飞行下降/Ctrl+W 疾跑。',
            '交互：左键=蓄力挖掘（准星是怪则攻击）；右键=放置/交互（食物进食→台/炉开面板→门/TNT/按钮/拉杆→放置；Shift+右键绕过交互直放）；中键吸取（创造）；1-9·滚轮切手持；Z 丢弃；E 背包+合成面板；M 创造·生存切换。',
            '视图与系统：F5 或 V 视角、F1 隐藏界面、F2 截图、F3 调试、F6 昼夜（创造）、Esc 暂停菜单、Q=Esc 替代（内嵌浏览器宿主会截获 Esc）、T 或 🤖 助手。',
            '施工控制（AI 建造时）：[ ] 调速、P 暂停、G 前往施工现场、R 录像、C 切镜头、Tab 拍摄面板。',
            '纯键盘模式（⚙️ 设置「🎛 画面」切换）：永不锁定鼠标——方向键转视角、Enter 挖掘/攻击（按住蓄力）、X 放置/交互、I 吸取；与鼠标左右中键共用同一触发函数，闯关/编辑器守卫天然一致。',
            '浮层键盘导航（uiKeys.js，两模式通用）：方向键在可操作元素间移焦、Enter/Space 激活、Esc 先退打字再关面板；答题对话框刻意不进导航（数字键作答）。',
        ].join('\n'),
    },
    {
        id: 'edu',
        title: '教学组与关卡工坊（答题机/商人/识字矿/关卡）',
        keywords: ['教学', '答题机', '题库', '关卡', '闯关', '星辉门', '出题笔', '识字', '商人', '图鉴', '锁'],
        text: [
            '答题机 ' + KEYPAD_BASE + '(0锁/1已解锁)：右键答题（数字题 0..9999 或选择题按 1~4），按格子坐标哈希确定性抽题（同格同题，不进存档）；答对翻转为常供能红石信号源——贴门放=直接开门、接粉=远程解锁。学科：数学/科学/道法/语文。',
            '英语商人 ' + MERCHANT_BASE + '：右键单词交易（看中选英/看英选中/情景对话，按 1~3），答对拿奖励+词句入图鉴。识字矿石 ' + HANZI_ORE + '（y≤44 约 1% 生成）：挖开按格哈希认生字入图鉴（带注音组词）。',
            '关卡工坊：旗组 ' + FLAG_BASE + '+kind（0 起点/1 检查点/2 终点）；星辉门 ' + STARLIGHT_BASE + '(0锁/1开) 出「还没学到」的超纲题，答对开门+记提前解锁、答错入错题本；出题笔（物品 ' + PEN_ID + '）手持右键答题机=作者面板出题；同一把锁连答对 2 次=双通过才能导出 .level.json。',
            '题库：assets/edu/banks.json 清单 + grade3-{math,science,daofa,yuwen,english,hanzi}.json；内容契约 docs/edu-quiz-banks-contract.md（五学科、题级 schema）；校验器 tools/validate_banks.py。学习进度存 localStorage mcweb.edu.v1（对错计数/错题本/图鉴/分学科）。',
            '闯关模式（state.levelRun 非 null）：禁挖掘/放置/E 背包/M/F6/飞行/中键/右键手开门，正午锁+禁刷怪+饥饿氧气冻结（摔落保留）；死亡回检查点计时不停；踩终点旗结算星级（3=零死亡且全锁一次过/2=通关且零死亡或全对/1=通关）；世界=临时世界，退出精确恢复进关前存档。此模式下世界改造类工具被拒（防架桥绕锁），不要尝试绕过。',
            '编辑器（state.levelEdit 非 null）：独立编辑世界+强制创造+正午，允许挖掘/放置/出题笔全流程；组件库（B 键，levelPrefabs.js 纯几何：旗组/答题门/星辉门/滑轮电梯/塔楼等）；草稿卡 meta.draft 自动保存。',
            'AI 协作工具：check_level（关卡体检报告，绝不输出答案）/ gen_level_draft（学科+单元+三模板出草稿——AI 只出草稿、作者位在孩子）；苏格拉底红线（不代答、梯度提示、考核锁拒答）见系统提示词，优先级最高。',
        ].join('\n'),
    },
];

export const KNOWLEDGE_SECTIONS = SECTIONS;

// ---------- 检索 ----------

// 口语填充词：命中也不会指向任何章节，直接丢掉（不做复杂分词，靠整词+二字滑窗兜底）
const STOPWORDS = new Set(['帮我', '看看', '怎么', '什么', '多少', '如何', '请问', '一下', '哪里', '哪些', '我想', '是不是', '这个', '那个', '还是', '以及', '可以', '需要', '一下下', '游戏里', '里面']);

// 分词：ASCII 词 + CJK 连续段（整段作为强词）+ 段内二字滑窗（弱词，兜底长句）
function tokenize(query) {
    const runs = String(query || '').toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) || [];
    const terms = [];
    const seen = new Set();
    for (const run of runs) {
        if (!seen.has(run)) { seen.add(run); terms.push({ t: run, weak: false }); }
        if (/[\u4e00-\u9fff]/.test(run) && run.length > 2) {
            for (let i = 0; i + 2 <= run.length; i++) {
                const bg = run.slice(i, i + 2);
                if (!seen.has(bg)) { seen.add(bg); terms.push({ t: bg, weak: true }); }
            }
        }
    }
    return terms.filter(({ t }) => !STOPWORDS.has(t));
}

// 按关键词检索知识节，返回按得分排序的前 topN 节（无命中返回 []）。
// 得分：标题 > 关键词表 > 正文；强词（整词）权重高于弱词（二字滑窗）。
export function searchKnowledge(query, topN = 3) {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const scored = [];
    for (const sec of KNOWLEDGE_SECTIONS) {
        let score = 0;
        for (const { t, weak } of terms) {
            if (weak) {
                if (sec.title.toLowerCase().includes(t)) score += 3;
                else if (sec.keywords.some((k) => k.toLowerCase().includes(t))) score += 2;
                else if (sec.text.toLowerCase().includes(t)) score += 1;
            } else {
                if (sec.title.toLowerCase().includes(t)) score += 12;
                else if (sec.keywords.some((k) => k.toLowerCase().includes(t))) score += 8;
                else if (sec.text.toLowerCase().includes(t)) score += 4;
            }
        }
        if (score > 0) scored.push({ sec, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topN).map((s) => s.sec);
}

// 系统提示词用的知识库目录（id｜标题｜关键词），让模型知道能查什么
export function knowledgeIndexText() {
    return KNOWLEDGE_SECTIONS.map((s) => `- ${s.id}｜${s.title}｜关键词：${s.keywords.slice(0, 7).join(' ')}`).join('\n');
}
