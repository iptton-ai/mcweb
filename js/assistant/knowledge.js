import { ADVENTURE, AdventureItems, LADDER_BASE } from '../config.js';
import { PhysicsBlocks as PB, PHYSICS as PH, TROUGH_IDS } from '../config.js';
import {LifeBlocks,LifeItems,LIFE} from '../config.js';
// ==================== assistant/knowledge.js ====================
// 游戏知识库：把散在各源码里的机制规则、数值、方块 ID、配方与「常见修改步骤」
// 整理成带关键词的精简章节，供 search_game_docs 工具按关键词检索。
// 目的：AI 回答机制类问题/动手改码前先查这里（一次几百~几千字），
// 不要整读 config.js(≈1500 行)/kinetic.js 等大文件——省时间省 token。
// 数值与 ID 段全部 import 自 config.js 动态生成：改 config 后知识库自动同步，不会漂移。
// 纯数据+纯函数，无浏览器依赖；tools/test_assistant_knowledge.mjs 可 Node 直测。
// 新增游戏机制时：在对应章节补一句，或新增章节并配好 keywords（检索靠它命中）。
// 【硬性纪律，见 AGENTS.md 注意事项】新增/修改任何模组、机制、方块、数值时，
// 必须同步更新对应章节——否则游戏内 AI 助手答不了只能游读源码；改完跑
// node --test tools/test_assistant_knowledge.mjs（章节体量 ≤3000 字符/检索命中/数值防漂移）。

import {
    BED_BASE, BED_COUNT, BED_HEIGHT, FIRST_DAY_SECONDS,
    BELT_BASE, BELT_ITEM_ID, BELT_SPEED, BELT_SU_LOAD,
    BREAK_DELAY, BUTTON_BASE, BUTTON_ITEM_ID, BUTTON_PULSE_SEC,
    COGWHEEL_BASE, COGWHEEL_ITEM_ID, CRUSHER_BASE, CRUSHER_ITEM_ID, CRUSHER_SU_LOAD, CRUSH_SEC,
    CRANK_BASE, CRANK_ITEM_ID, CRANK_RPM, CRANK_SU_CAPACITY,
    LARGE_COG_BASE, LARGE_COG_ITEM_ID, REVERSER_BASE, REVERSER_ITEM_ID,
    KINETIC_MIN_RPM, KINETIC_MAX_RPM,
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
import { atlasSize, freeTileRanges } from '../textureTiles.js';

// ---------- 纯渲染辅助（把 config 数据表压成一行行中文速查） ----------

// 纹理图集空闲 tile 区间速查（textureTiles.js 分配表动态生成，杜绝手写「45..63」式漂移）
const FREE_TILES_TEXT = freeTileRanges().map(([a, b]) => (a === b ? String(a) : `${a}..${b}`)).join('、');

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
        id:'physics',title:'力学实验（斜坡摩擦/杠杆/弹簧/教学滑轮/测速）',
        keywords:['物理实验','实验台','试验物体','砝码','斜坡','摩擦','光滑','粗糙','杠杆','支点','力臂','转矩','弹簧','压缩','弹射','教学滑轮','定滑轮','动滑轮','滑轮组','测力','测速','计时','复位'],
        sources:['js/config.js','js/physicsData.js','js/physicsLab.js','js/physicsUI.js','js/levelPrefabs.js'],
        text:[
            `组件：斜坡台${PB.RAMP}、杠杆台${PB.LEVER}、弹簧台${PB.SPRING}、教学滑轮台${PB.TEACHING_PULLEY}、测速门${PB.SENSOR}。工作台合成，创造/编辑器B→物理实验放模板。右键或纯键盘X打开条件面板，开始后自动收起观察；E/Esc/Q关闭，Shift绕过交互建造。`,
            `实验台是单格微缩模型，不承载玩家。标准物体与砝码不进入背包/掉落物，复位不兑换物资。游戏重力${PH.gravity}、质量/长度/力为模型单位，不能当真实仪器。固定${PH.step}秒小步，仅有效游玩推进。`,
            `斜坡：坡度${PH.slopes.join('/')}度，摩擦系数${PH.friction.join('/')}对应光滑/普通/粗糙。同物体同起点只改一个变量比较；a=g(sinθ−μcosθ)，摩擦足够则停稳，坡底转水平，轨道长${PH.trackLength}。`,
            `杠杆：五槽0..4，左槽2-leftArm、右槽2+rightArm、支点pivot=1..3；净力矩Σm*g*(槽位−支点)，正=右沉、负=左沉，零=平衡；有限角度，虚拟砝码不压玩家。`,
            `弹簧：先选压缩档并点击手动压缩，再释放。k=${PH.springK}，压缩${PH.springCompression.slice(1).join('/')}，释放速度√(k/m)*压缩量*${PH.springLoss}；释放/复位清储能，再弹必须重新输入。台内上限3，外部封顶时限1，撞顶停上升。`,
            `教学定/动/组合滑轮承重绳数n=${PH.ropeCounts.join('/')}；理想拉力mg/n、拉绳距离=n*提升高度。手拉输入使物体提升，省力同时费距离；和原有载人电梯卷扬机分名。测速门两测面相距0.8格，开始后让玩家/物品沿朝向穿门，按真实线段越面插值读秒与格/秒。`,
            '配置保存进physics v1的devices坐标表；读档实验回初态、弹簧无储能。关卡卡带局部配置并纳入hash。作者allowRun默认关闭，开启才允许开始/压缩/拉绳/复位；闯关仍禁改参数、桶和点TNT。作者红石上升沿可自动驱动实验。',
        ].join('\n'),
    },
    {
        id:'hydraulics',title:'局部水力（水槽/闸阀/机械泵/浮块）',
        keywords:['水槽','实验水','水流','局部流体','水量','守恒','水闸','阀门','水泵','抽水','扬程','浮块','浮力','配重','漂浮','沉降','份水'],
        sources:['js/config.js','js/physicsData.js','js/physicsLab.js','js/physicsUI.js','js/levelPrefabs.js'],
        text:[
            `实验槽q0..4对应ID[${TROUGH_IDS.join(',')}]，不是连续区间；4份=1桶，只有空槽有配方，五种含水量均可入包选回放置。普通水${BlockTypes.WATER}依旧静态，槽水不驱动原水车/灌溉，也不变成湖水。`,
            `槽外密闭；每${PH.waterStep}秒优先流到下方或相邻低一格槽，同层均衡。水闸/阀${PB.VALVE}占中间一格，轴向两端槽相隔2格；手动open或control红石有电开，关闭不删水。`,
            `泵${PB.PUMP}：后接轴，侧方进水，前方按lift=0..4格扬程出水。朝东时西接轴、南接进水槽、东侧上抬lift为出水槽。${WHEEL_RPM} RPM每${PH.pumpSeconds}秒搬1份，基础${PH.pumpLoad}SU；转速改变节拍和负载。无水/出口满/断动力明确停机，不凭空造水。`,
            `满桶只对q0槽放4份，空桶只从q4取4份；q1..3请先汇满。生存先检查桶和背包容量，再一次提交。湿槽挖/覆盖（含换槽）/爆炸排入保留原q的持久掉落，水路/泵/桶内部换量只转移现有水；编辑删除视为作者弃置，不发资源。复位仅清浮块状态，水量存字节，六槽/热重载/卡片自动保留。`,
            `槽面板放标准浮块，质量${PH.floatMass}+配重0..4，体积${PH.floatVolume}；轻载随水面浮、超过浮力能力沉底。它是有限定量槽的简化模型，不模拟真实连续压力/排水体积/泵效率，不兑换物资。`,
            `局部最多${PH.maxTroughs}槽，全部物理配置最多${PH.maxDevices}个；没有逐帧全世界扫描。B模板包含水路闸门、抽水与浮块实验。`,
        ].join('\n'),
    },
    {
        id:'physics-motion',title:'风力与运动机关（风车/风扇/宽平台/落块TNT）',
        keywords:['风车','风力','机械风扇','风道','推力','水平平台','移动平台','移动桥','宽平台','往返','导轨','实验落块','运动TNT','落沙','坠物'],
        sources:['js/config.js','js/physicsLab.js','js/kinetic.js','js/piston.js','js/items.js','js/levelPrefabs.js'],
        text:[
            `风车${PB.WINDMILL}固定Y轴，下接轴；顶部3层、水平5×5实心遮挡全无时输出${PH.windRpm}RPM/${PH.windCapacity}SU。是明确的简化游戏风档，非空气流场。普通方块加挡/撤挡只在供能边沿重算。`,
            `机械风扇${PB.FAN}后接轴，按朝向吹${PH.windRange}格，基础${PH.fanLoad}SU；RPM影响推力，三维风路中的墙挡风；斜坡试验体只取东西轨道方向的风力。作用于标准试验体和真掉落，不吹玩家/生物。风中暂缓磁吸/拾取，离风或断电恢复；运转中的带运输优先，停机带上的物品仍可被风吹动，不重置掉落物寿命。`,
            `宽平台驱动${PB.CARRIAGE}后接轴，正上方摆${PLATFORM_BASE}平台1或3格宽，行程1..${PH.maxTravel}格、方向可选四向；沿路下方铺实心地板。红石有电回程、无电去程，基础${PH.carriageLoad}SU+每平台${PLATFORM_SU_LOAD}SU，${WHEEL_RPM}RPM走${PH.carriageSpeed}格/秒。`,
            '宽平台整组先验全部目的格和乘客扫掠，再原子搬方块与去重乘客；前方旁观者/低顶/墙/边界挡停，撤障续走。断动力悬停，平台位置offset随真实方块保存，装置不被活塞推移或机器吞料。拆驱动器后平台仍是原建材。导出旗标区域必须包含当前整组平台；不足会提示扩大区域。',
            `只有实验落块${PB.FALLING}与运动TNT${PB.MOTION_TNT}受新增重力；失支撑逐格落下，碰人停落、普通水减速交换水格，实验槽挡落。运动TNT右键面板点燃${PH.fuse}秒在当前整数格爆炸，引信随移动/普通档/快照保存；关卡禁止手动点燃，卡片拒带已点燃TNT。`,
            '天然沙/沙砾与原TNT保持旧规则。B→物理实验含风道运输、风车动力站、三格宽往返平台、落块与运动TNT；说明→搭自己的物理实验室看图解。',
        ].join('\n'),
    },
    {
        id: 'ids',
        title: '方块与物品 ID 总表（含状态编码公式）',
        keywords: ['ID', '方块', '物品', '编码', '变体', '基址', 'doorId', '编号', '区间'],
        sources: ['js/config.js', 'js/buildQueue.js'],
        text: [
            `基础：0空气 1草方块 2泥土 3石头 4原木 5树叶 6沙子 7水(非固体) 8基岩(不可破坏) 9砖块 10玻璃 11木板 12圆石 13沙砾 14雪 15树干 16火把 17花 18TNT ${BlockTypes.SLIME}粘液块`,
            `生存方块：${BlockTypes.COAL_ORE}煤矿石 ${BlockTypes.IRON_ORE}铁矿石 ${BlockTypes.DIAMOND_ORE}钻石矿石 ${BlockTypes.CRAFTING_TABLE}工作台 ${BlockTypes.FURNACE}熔炉 ${BlockTypes.WOOL}羊毛`,
            `门 ${DOOR_BASE}..${DOOR_BASE + DOOR_COUNT - 1}：ID=${DOOR_BASE}+half*8+open*4+facing（half 0下/1上，上格=下格+8；open 0关/1开；facing 0北/1东/2南/3西）；摆放写 ${DOOR_ITEM_ID}`,
            `床 ${BED_BASE}..${BED_BASE+BED_COUNT-1}：ID=BED_BASE+half*4+facing（half 0床尾/1床头，水平四向）；AI队列拒绝单格床写入，由玩家放置。`,
            `红石组：粉 ${DUST_BASE}+lit(0灭/1亮)→写${DUST_ITEM_ID}；火把 ${RTORCH_BASE}+facing*2+lit（facing 0贴地/2北墙/3东墙/4南墙/5西墙，不能贴顶）→写${RTORCH_ITEM_ID}；按钮 ${BUTTON_BASE}+facing*2+pressed→写${BUTTON_ITEM_ID}；压力板 ${PLATE_BASE}+pressed→写${PLATE_ITEM_ID}；拉杆 ${LEVER_BASE}+facing*2+on→写${LEVER_ITEM_ID}；红石灯 ${LAMP_BASE}+lit→写${LAMP_ITEM_ID}`,
            `活塞组：活塞 ${PISTON_BASE}+facing*2+extended、粘性活塞 ${STICKY_PISTON_BASE}+同式、活塞头 ${PISTON_HEAD_BASE}+facing（非物品）、观察者 ${OBSERVER_BASE}+facing*2+powered；facing 0上/1下/2北/3东/4南/5西；摆放写 ${PISTON_ITEM_ID}/${STICKY_PISTON_ITEM_ID}/${OBSERVER_ITEM_ID}`,
            `动力组：传动轴 ${SHAFT_BASE}+axis、齿轮 ${COGWHEEL_BASE}+axis、水车 ${WATERWHEEL_BASE}+axis、粉碎轮 ${CRUSHER_BASE}+axis（axis 0东西X/1上下Y/2南北Z）；机械锯 ${SAW_BASE}+facing(0上..5西)；摆放写 ${SHAFT_ITEM_ID}/${COGWHEEL_ITEM_ID}/${WATERWHEEL_ITEM_ID}/${CRUSHER_ITEM_ID}/${SAW_ITEM_ID}`,
            `物理组件：手摇 ${CRANK_BASE}+axis、大齿轮 ${LARGE_COG_BASE}+axis、红石换向器 ${REVERSER_BASE}+axis*2+powered（0直通/1反转）；物品 ${CRANK_ITEM_ID}/${LARGE_COG_ITEM_ID}/${REVERSER_ITEM_ID}；BT.CRANK/LARGE_COG/REVERSER。`,
            `物流组：传送带 ${BELT_BASE}+dir(0北/1东/2南/3西)→写${BELT_ITEM_ID}；投料器 ${DEPLOYER_BASE}+facing→写${DEPLOYER_ITEM_ID}；离合器 ${CLUTCH_BASE}+axis*2+断开位(0接合/1断开)→写${CLUTCH_ITEM_ID}`,
            `电梯组：滑轮 ${PULLEY_BASE}+up*2+powered（up 0垂挂/1顶举）→写${PULLEY_ITEM_ID}；电梯平台 ${PLATFORM_BASE}（普通实心立方体）`,
            `教学组：答题机 ${KEYPAD_BASE}+solved(0锁/1已解锁)→写${KEYPAD_ITEM_ID}；英语商人 ${MERCHANT_BASE}；识字矿石 ${HANZI_ORE}；关卡旗 ${FLAG_BASE}+kind(0起点/1检查点/2终点)；星辉门 ${STARLIGHT_BASE}+state(0锁/1开)；出题笔(物品) ${PEN_ID}`,
            `工具（物品不可放置）：铁镐${ToolTypes.PICKAXE} 铁斧${ToolTypes.AXE} 铁锹${ToolTypes.SHOVEL} 铁剑${ToolTypes.SWORD}；木/石/钻档 ${TOOL_EXTRA_BASE}..${TOOL_EXTRA_BASE + 11}（镐斧锹剑 × 木石钻顺序：木镐${ToolTypes.WOOD_PICKAXE} 石镐${ToolTypes.STONE_PICKAXE} 钻镐${ToolTypes.DIAMOND_PICKAXE} 木斧${ToolTypes.WOOD_AXE} …）`,
            `材料食物（物品不可放置）：${ItemTypes.STICK}木棍 ${ItemTypes.COAL}煤炭 ${ItemTypes.IRON_INGOT}铁锭 ${ItemTypes.DIAMOND}钻石 ${ItemTypes.APPLE}苹果 ${ItemTypes.RAW_PORK}生猪肉 ${ItemTypes.COOKED_PORK}熟猪排 ${ItemTypes.GUNPOWDER}火药`,
            '朝向语义（全游戏通用，写变体 ID 前先换算坐标轴）：facing 0上(+Y)/1下(−Y)/2北(−Z)/3东(+X)/4南(+Z)/5西(−X)；门与传送带的水平四向 0北(−Z)/1东(+X)/2南(+Z)/3西(−X)——北=−Z、东=+X。',
            'AI 建造（place_blocks/run_build_script）=直接写变体 ID 完成放置：写物品 ID（=基址）即默认态（' + PULLEY_ITEM_ID + '=滑轮垂挂·放绳、' + PISTON_ITEM_ID + '=活塞朝上·收回、' + CLUTCH_ITEM_ID + '=离合器X轴·接合、' + BELT_ITEM_ID + '=带朝北）；放置不做支撑/贴面校验；每个施工任务完成后自动重算红石+动力网络——电平类状态（粉亮灭/红石灯/离合器/换向器/滑轮 powered/绳绑定）自动自愈翻到正确变体，边沿类（门/TNT/活塞）从静止基线出发。run_build_script 的 BT 表含动力/活塞/物流/电梯全部基址与默认物品（BT.SHAFT…BT.PLATFORM），门/红石组/教学组按上文公式用基址数值拼写。',
            '有状态方块（门/红石/活塞/动力/物流/电梯/教学）的状态都直接编码进方块 ID，没有额外元数据；编码解码纯函数都在 js/config.js（doorId/rtorchId/pistonId/shaftId/clutchId/pulleyId…）。',
        ].join('\n'),
    },
    {
        id: 'mining',
        title: '挖掘·工具·方块属性',
        keywords: ['挖掘', '硬度', '工具', '耐久', '掉落', '采集', '镐', '破坏', '裂纹', 'outline', '选取'],
        sources: ['js/mining.js', 'js/interaction.js', 'js/items.js', 'js/ui.js', 'js/config.js'],
        text: [
            '破坏耗时(秒)=硬度×(可采集?1.5:5)÷工具速度；水中或悬空再×5；每破坏一块强制间隔 ' + BREAK_DELAY + 's；创造模式即点即碎（限速 ' + CREATIVE_BREAK_INTERVAL + 's/块）；硬度 -1=不可破坏（基岩）。',
            '工具四档：速度 木2/石4/铁6/钻8，耐久 59/131/250/1561，用坏即消失（HUD 有耐久条）；剑不加速挖掘，攻击 木4/石5/铁6/钻7 伤害·0.6s 冷却，徒手 1 伤害·0.25s，创造一击必杀。',
            '耐久逐把保存：toolWear 是当前工具，toolReserveWear 保存备用磨损；转移使用 inventoryStacks.js，最旧工具优先使用，丢弃优先备用，拾回保留所有工具的磨损。玩家近战沿准星求实体碰撞盒命中，眼睛到命中点最多 4 格、受方块遮挡；第三人称从眼睛投影处开始检测，跳过身后且仍能打到贴脸前方目标。',
            '采集门槛（minTier/needsTool）：煤矿需木镐+、铁矿需石镐+、钻石需铁镐+；石头/圆石/砖 needsTool——等级不够挖开也无掉落（原版 harvest 规则）。',
            '掉落映射：石头→圆石、草方块→泥土、玻璃/树叶无掉落、树叶 ' + Math.round(LEAVES_APPLE_CHANCE * 100) + '% 掉苹果；矿石经验 煤+2 铁+2 钻+7 识字矿+3。',
            '硬度速查：' + renderHardness() + '。',
            '不满格道具（火把/花/红石元件/门/传送带/旗…）在 config.js 的「选取形状 outline」段登记格内局部 AABB——碰撞(BlockInfo.solid)、选取框(outline)、渲染模型三者解耦；新道具不登记 outline 准星会整格黑框。',
        ].join('\n'),
    },
    {
        id: 'world',
        title: '世界·时间·物理·刷怪·矿石分布',
        keywords: ['世界', '尺寸', '坐标', '区块', '时间', '重力', '刷怪', '物理', '种子', '矿石', '夜晚', '昼夜', '天空', '光照', '太阳'],
        sources: ['js/world.js', 'js/playerPhysics.js', 'js/config.js', 'js/state.js', 'js/daynight.js', 'js/entities.js'],
        text: [
            '世界 ' + 256 + '×' + 256 + '×' + 128 + '（x/z 0..255，y 0..127 向上，y=0 基岩层）；方块存 Uint8Array：index=x+z*W+y*W*D；区块 16×16，改方块后必须 rebuildChunk（建造类工具已自动处理）。',
            '时间：state.time 秒，state.dayLength=600s 一天，新世界从清晨开局（time=0.3×dayLength）；正午=state.time≡dayLength/2（闯关锁正午即此值）；isNight()=太阳高度 sin(progress·2π−π/2)<−0.08（约傍晚到黎明，刷怪）。',
            '物理：重力 ' + GRAVITY + '、跳跃 ' + JUMP_VELOCITY + '、走路 ' + WALK_SPEED + '、飞行 ' + FLY_SPEED + ' 格/秒；玩家碰撞盒 0.6×1.8、眼高 ' + PLAYER_EYE_HEIGHT + '；触及距离 生存' + REACH_SURVIVAL + '/创造' + REACH_CREATIVE + '；游戏刻 ' + Math.round(TICK_RATE * 1000) + 'ms。',
            '碰撞：水平扫描包含部分覆盖头部的墙；垂直移动扫过脚/头经过的全部层，按方向先接触的平台或天花板阻挡高速穿透；粘液反弹、水中免摔、传送带与活塞载客照常。',
            '刷怪（对齐原版）：敌对上限 ' + MAX_ENEMIES + '；生成距离 ' + SPAWN_MIN_DIST + '..' + SPAWN_MAX_DIST + ' 格，火把 ' + TORCH_SPAWN_BLOCK_RADIUS + ' 格内不刷；' + LAZY_DIST + ' 格外冻结 AI 并按小概率消失；被动生物（猪羊牛）上限 ' + MAX_PASSIVE_MOBS + '，白天草地小群补充。',
            '矿石分布（world.js oreAt，种子进存档）：煤 y<44 / 铁 y<30 / 钻石 y<12；识字矿石 y≤44 约 1% 独立分段。',
            '普通生存阅读/失焦暂停世界，首夜缓冲见 home 节；纯键盘模式：方向键转视角 ' + KEYBOARD_TURN_SPEED + ' 弧度/秒（×设置里的灵敏度倍率）。',
            '天空与光照（daynight.js buildSky/updateDayNightCycle）：太阳方向光/环境光/半球光强度随太阳高度插值（昼强夜弱）；天空色 白昼蓝→晚霞橙→深夜蓝 插值、雾密度夜间加大；550 颗星点球冠夜空（随相机头顶平移+缓慢自转，夜里淡入）、40 朵实例化云在高空缓慢东漂（夜里压暗）、日/月盘=自发光面片挂太阳方向、落到地平线下隐没；state.sunAngle 存当前太阳角。火把点光源与「灯照不刷怪」见 redstone/ids 节。',
        ].join('\n'),
    },
    {
        id: 'redstone',
        title: '红石系统（源→布线→负载）',
        keywords: ['红石', '信号', '红石粉', '火把', '拉杆', '按钮', '压力板', '红石灯', '时钟', '反相器', '电路', '充能', '竖直', '垂直布线', '火把塔', '爬线', '双相', '平铺', '接力'],
        sources: ['js/redstone.js', 'js/config.js'],
        text: [
            '模型（对齐原版）：信号源 ' + RS_MAX_STRENGTH + ' 级 → 红石粉布线每格 -1、0 级断路 → 负载（红石灯/门/TNT/活塞/离合器/滑轮/换向器）。爬坡：斜上天然可连（邻粉坐在实心支撑上）；斜下须邻列上格非实心才连（挡线即断）。一条粉线最长 15 格：源邻粉 15 级起每格 −1，强度 1 仍能激活负载，第 16 格 0 级断。',
            '负载判定（统一规则）：所有负载（灯/门/TNT/活塞/离合器/滑轮/换向器）=「6 邻任意一格有激活红石粉（强度>0）或激活源」；门只判下半扇与其上格。激活源=开着的拉杆/按下的按钮/踩住的压力板/亮的红石火把/观察者脉冲/已解锁答题机/已开启星辉门——源自身贴着负载也算（答题机贴门=直接开门、拉杆贴滑轮=呼梯开关）。',
            '充能方块 ≠ 激活负载：激活粉/源会把方块「充能」，但充能只用于红石火把的反相判定——被充能的方块不会激活邻接负载。原版「拉杆充能贴着的方块→方块开旁边的门」在这里不成立：拉杆要么直接贴负载，要么把粉线铺到负载 6 邻内。',
            '激活红石粉会充能「脚下 + 四邻水平」的实心方块；拉杆/按钮/压力板充能各自的挂靠/支撑方块；亮红石火把充能的是正上方方块（不是挂靠块）。',
            '元件行为：拉杆=右键开关（稳态源）；按钮=右键按下 ' + BUTTON_PULSE_SEC + 's 自动弹回（脉冲源）；压力板=只放顶面，玩家/怪物踩住即源（自动门/陷阱）；红石灯=6 邻有激活粉或激活源即点亮（亮时发光、照到的格子不刷怪）。灯不是信号源：亮灯不给邻粉供电、也点不亮相邻的灯（灯连灯不通），纯负载/显示器，与原版一致。',
            '读档/热重载重新初始化红石与活塞：清旧世界注册表、边沿和按钮计时；存档中按钮释放并回放下降沿，关联门关闭、活塞收回。重复初始化按实际伸出态重建动作，未供能的手动开门保持。',
            '红石火把=反相器：默认亮；挂靠方块被充能则熄灭、解除复亮，切换延迟 ' + RTORCH_DELAY + 's（两级串联还原信号；输出粉绕回挂靠方块=时钟）。火把不充能自己的挂靠方块（时钟得以振荡的前提），也不充能水平邻块——所以双级反相（F2=NOT F1，双相输出）平铺时两块方块之间必须垫一格红石粉接力（火把→粉→方块→下一级火把）；竖摆（第二级方块压第一级火把头顶）才可省粉。不能贴顶放置。',
            '竖直布线=火把塔（对齐原版）：亮火把强充能正上方方块 →「方块 + 侧面火把」交替叠层即可沿墙竖直传信号：火把亮→上方方块被充能→该方块侧面的下一级火把熄灭→再上一级复亮……每级反相一次（要同相输出就凑偶数级）、信号重新 ' + RS_MAX_STRENGTH + ' 级（不受粉线衰减限制，任意高度可达）。占地约 1×2 两列交替、每级一块+一火把；粉不能垂直叠放（每格粉都要坐在实心顶面），高度超过 ~14 格或竖井里走线一律用火把塔。竖转横的出口在火把不在粉：亮火把给自己 6 邻粉直接播满 15 级，想在哪层接横向电路就在那层火把旁铺粉（相位随层数交替，要同相取偶数层或再串一只火把反相回来；电梯顶层拉杆控底层滑轮即此形态）。',
            '时序：门/TNT/活塞=边沿语义——门上升沿开下降沿关（手动右键不受影响）、TNT 放置为惰性且上升沿点燃（或右键）、活塞上升沿伸出下降沿收回；离合器/换向器/滑轮=电平语义，红石网络按电平回写变体——离合器或换向器变化带一次动力重算，滑轮 powered 变化不触发动力重算（拓扑不变、换向即时生效）。',
            '经典形态：自动门（压力板+粉+门）、远程开门（粉线最长 15 格）、闪烁灯/时钟（火把+粉环）、陷阱（压力板+TNT）、竖井竖直控制（火把塔，见上）。',
            '实现（改码用）js/redstone.js：placeRedstone / toggleLeverAt·pressButtonAt / breakRedstoneAt（失支撑连锁脱落）/ updateRedstoneNetwork（事件触发全量重算）/ updateRedstoneTick（每帧：按钮弹出·火把翻转·压力板·末尾驱动活塞组）。',
        ].join('\n'),
    },
    {
        id: 'piston',
        title: '活塞组·粘液块·观察者',
        keywords: ['活塞', '粘性', '粘液', '推动', '拉动', '观察者', '弹跳', '载人', '飞行机器', '伸出'],
        sources: ['js/piston.js', 'js/config.js'],
        text: [
            '放置：朝「所点击面的外法线」（点顶面=朝上、贴墙=垂直墙面）。信号上升沿伸出、下降沿收回，动作延迟 ' + PISTON_DELAY + 's（延迟动作队列：边沿只入队，updatePistonTick 消费）。AI 建造写 ' + PISTON_ITEM_ID + '/' + STICKY_PISTON_ITEM_ID + ' 基址=朝上·收回变体，按 +facing*2 拼其他朝向。',
            '推动：最多 ' + PISTON_PUSH_LIMIT + ' 格；基岩/伸出态活塞/活塞头挡路=整个动作不动；路径上的贴面道具（红石/门/火把/花/带）被压碎并返还物品。粘性活塞收回=把头前方块拉回一格。',
            '粘液块：被推/拉时把六邻粘着的可推方块整体拖走/拉回（飞行机器的基础）；落速 ≥' + SLIME_BOUNCE_MIN + ' 格/秒落上=反弹保留 ' + Math.round(SLIME_BOUNCE_KEEP * 100) + '% 垂直速度（弹跳高度按平方衰减、免摔伤），低速落上正常站定不抖——垫粘液块即弹跳跃层/落地缓冲。',
            '活塞载人：伸出/收回用 AABB 命中「占据被占格/站方块顶」的玩家·怪物·物品整体平移 1 格（piston.js 的 carryRiders；滑轮另有移动前碰撞检查）；水平推动可载着站在方块顶的人走。',
            '观察者：facing=侦测面（脸朝所点击面的外法线；编码 ' + OBSERVER_BASE + '+facing*2+powered）；正前方（facing 方向）方块增删/变化→从背面（facing 反方向那格）输出 ' + OBSERVER_PULSE_SEC + 's 脉冲并充能背面格——亮起时观察者本身也是信号源（可做活塞时钟的心跳）。',
            '破坏：打活塞头=反查底座整只拆（breakPistonGroupAt）；TNT 爆炸后的孤儿（头/底座失配）由 fixPistonAround 修复。',
        ].join('\n'),
    },
    {
        id: 'kinetic',
        title: '动力组（水车/手摇/变速齿轮/换向器/加工）',
        keywords: ['动力', '水车', '手摇', '手摇动力器', '传动轴', '齿轮', '大齿轮', '传动比', '变速', '换向器', '旋向', '纠偏', '物理', '粉碎轮', '机械锯', '应力', 'RPM', '转速', '过载', '粉碎'],
        sources: ['js/kinetic.js', 'js/config.js'],
        text: [
            `动力源：水车正上方一格是水时输出 ${WHEEL_RPM} RPM、${WHEEL_SU_CAPACITY} SU；手摇动力器按住所瞄准方块的右键或纯键盘X，输出 ${CRANK_RPM} RPM、${CRANK_SU_CAPACITY} SU。多源只叠容量，不叠转速；源经传动后转速或旋向不一致会整网停机。`,
            '手摇仅普通世界/编辑器可用，闯关中禁用。松手、移开准星/超射程、面板、失焦、死亡、换世界/相机立即停止；恢复后要重新按下。Shift+右键可贴面放置。拆掉再放同格不继承手摇；按住不重复放置，供能只在开/关边沿重算，手摇状态不保存。',
            '传动：同轴端面串接均为1:1同向。齿轮啮合反向：大带小×2，小带大×0.5，大带大/小带小×1。相邻轴垂直且中心连线沿其中一轴可啮合；平行轴横向相邻只允许至少一只大齿轮，小/小仍不连。同轴大小串接不变速。',
            `本格q=|RPM|/${WHEEL_RPM}；合法转速 ${KINETIC_MIN_RPM}..${KINETIC_MAX_RPM} RPM，超界整网停机。加工进度/带速/升降速度乘q，完成耗时除q，真实产量随速度变化；轴反转不改变带箭头和滑轮红石卷放绳方向。`,
            `基础应力（${WHEEL_RPM} RPM）：配对粉碎轮 ${CRUSHER_SU_LOAD}/只（单只不计）、锯 ${SAW_SU_LOAD}、带 ${BELT_SU_LOAD}/格、投料器 ${DEPLOYER_SU_LOAD}、已绑滑轮 ${PULLEY_SU_LOAD}+平台 ${PLATFORM_SU_LOAD}。各负载乘本格q再求和；超载/旋向冲突/转速冲突整网停。SU是游戏负载预算，不是真实扭矩、牛顿或瓦特。`,
            '红石换向器串在轴上，无电直通、有电将两端旋向关系翻转一次；三轴正向端有固定黄标，负向端是参考端；反接供能也翻一次、两只通电抵消。可纠正奇数次啮合后双水车旋向冲突，恢复合流加工；旁路关系矛盾仍停机。方向读数以从轴正向端观察为准，正转按右手轴正角定义。',
            `粉碎轮水平相邻、同轴、连线垂直轴才配对；正上方投料，${WHEEL_RPM} RPM耗时 ${CRUSH_SEC}s。配方：${renderKineticRecipes()}；表外方块不可投。机械锯在 ${WHEEL_RPM} RPM等效速度 ${SAW_SPEED}，锯朝向格（原木/树干→木板×4，其他照掉落表）；锯/投料器只能从背面轴向传动，正面不取力。`,
            '放置轴向=所点击面法线（顶面Y、贴墙X/Z）；锯/投料器朝向同理。AI使用 BT.CRANK/LARGE_COG/REVERSER/SHAFT/COGWHEEL/WATERWHEEL/CRUSHER/SAW 与基址变体；完工自动重算。三新组件被活塞压碎各返一个代表物品。',
            '状态为运行时派生量：kineticInfoAt 返回 rpm/targetRpm/ratio/direction/capacity/load/running/reason/sourceRpm，HUD kineticStatusAt 显示实际转速/负载/故障，beltSpeedAt 供玩家和物品共同取实际带速。普通加工变更按帧合并区块和必要网络更新。B组件库有手摇运输台、变速对照台、升降实验台、合流纠偏台；说明→让机关转起来可看实验步骤。',
        ].join('\n'),
    },
    {
        id: 'logistics',
        title: '物流控制组（传送带/投料器/离合器）',
        keywords: ['传送带', '投料器', '离合器', '物流', '产线', '运输', '无人'],
        sources: ['js/kinetic.js', 'js/config.js'],
        text: [
            `传送带贴实心顶面放，AI写 ${BELT_ITEM_ID}+dir（0北−Z/1东+X/2南+Z/3西−X）；六邻通电动力块可驱动（平台除外）。${WHEEL_RPM} RPM时带速 ${BELT_SPEED} 格/秒，按本格|RPM|/${WHEEL_RPM}缩放，玩家和物品同速；方向始终沿箭头，不随轴反转。跨格重读带向/速度，转弯/抵墙/满箱排队，物品间距0.35格；断电停、复电续、尽头掉落。`,
            '投料器（朝向=所点击面的外法线，照机械锯贴面）：基准 ' + WHEEL_RPM + ' RPM每 ' + DEPLOYER_SEC + 's 把捕获三格 {朝向格, 朝向格上方, 自身头顶} 里的「方块类物品」变回方块塞进朝向格（守卫：界内/目标为空气或水/材料·工具·食物·贴面道具不投/玩家与怪 AABB）；提速按倍率缩短间隔，每帧最多投一次。朝向粉碎轮投料口=自动再投料。正面（朝向格）不传动、只有背面接传动——轴接在背面；AI 写 ' + DEPLOYER_ITEM_ID + '+facing。',
            '投料放水或用方块替换水都会重算动力，水车顶面失水后整条下游立即停转。',
            '离合器（串进传动轴中段，照轴定轴向）：红石充能=断开传动（水车侧照转、下游停），断电接合；放置初始=接合，放进充能位由红石重算翻到断开（电平自愈）；通断变体由红石电平回写并带一次动力重算；自身不计应力。AI 写 ' + CLUTCH_ITEM_ID + '（X轴·接合），按 +axis*2+断开位 拼变体。',
            '生存机器和红石元件都有工作台配方，缺料来源见背包；矿物、原木、羊毛、小麦可持续补给。传送带末端紧贴同高度家园箱子，真实物品优先入箱再处理拾取/磁吸；满箱保留余量；机械锯与粉碎轮产物从生成第一帧起就随存档保存，落带前保存也不丢。带上排队和断电产物不会过期。state.adventure.delivered只累计真实接收量。',
            '首条入箱产线：水车X轴→轴X→锯朝东；锯正下方起铺4格向东带，最后贴箱子。原木放锯前（第二格带上方），产4木板。水车顶放水，8RPM应力40/64；只从第二格铺带会因斜接而不取力。',
            '无人值守产线示例：粉碎轮旁一格放投料器朝投料口、带尽头架在投料器正上方——丢一块石头上带，自动 石→圆石→沙砾→沙 滚三轮停在末端。',
        ].join('\n'),
    },
    {
        id: 'elevator',
        title: '电梯组（滑轮/电梯平台）',
        keywords: ['电梯', '滑轮', '平台', '升降', '卷绳', '绑绳', '呼梯', '井道', '红石', '供电', '顶举', '垂挂', '行程', '绳'],
        sources: ['js/kinetic.js', 'js/config.js'],
        text: [
            '朝向与编码：滑轮没有水平朝向位，绳永远竖直（沿 Y 轴）——ID=' + PULLEY_BASE + '+up*2+powered，up=0 朝下垂挂（绳/平台在下方）/1 朝上顶举（上方）。AI 建造写 ' + PULLEY_ITEM_ID + '=垂挂·放绳，顶举写基址+2（pulleyId(up,0)）。',
            '方向语义（「拉杆开=上行」设计前必读）：up=0 垂挂——断电放绳=平台下降、充电卷绳=平台上升；up=1 顶举——断电放绳=平台上升、充电卷绳=平台下降（卷绳=平台向滑轮收拢）。',
            '传动接线：正面（绳出口）不传动；背面（绳反方向那格——垂挂的背面在上方、顶举的背面在下方）接传动——背面格是已接通动力族方块（非传送带/平台）即连通，跨轴也行（贴横轴顶面放顶举滑轮）。必须接上水车或正在操作的手摇动力才动。',
            '绑绳（自动，事件触发重算）：沿绳方向逐格扫 ≤' + PULLEY_ROPE_MAX + ' 格——AIR/水/贴面道具可穿，第一个电梯平台即绑定（先扫先得、每平台唯一）；中途任何实心方块=未绑定（井道全程不能有实心穿绳）。未绑定不计应力，HUD「未找到平台」。',
            '红石供电：滑轮是红石负载（6 邻任意一格有激活粉或激活源即充能）——拉杆直接贴滑轮任意面=呼梯开关，远程则粉线铺到滑轮旁；powered 由红石网络按电平回写变体，不触发动力重算（换向即时生效）；放进充能位会电平自愈。',
            '运行：本格 ' + WHEEL_RPM + ' RPM时以 ' + LIFT_SPEED + ' 格/秒跨格巡航，速度按|RPM|/' + WHEEL_RPM + '缩放，轴反转不改升降方向；无动力（断水/过载/卡死/离合器断开）=平台悬停不坠落；行程端点（平台前方格非 AIR/水，或出世界边界）=平台停、滑轮空转，不 jam 整网，撤挡自动续走。',
            '平台 ' + PLATFORM_BASE + '（单 ID 无变体）=普通实心立方体：仅连接所属滑轮绳负载，不连接邻带或其他轴、可当建材；承载玩家/物品/怪物先验整步碰撞，低顶/侧墙/围栏或边界挡住乘客则整步停并提示“乘客前方受阻”，撤障恢复；相邻滑轮同帧不重复搬人；可被活塞推走（推离绳路自动脱绑、推回重绑）；平台顶贴的红石粉跨格时连锁脱落返还；井道旁观察者能侦测平台经过。',
            '应力：基准 ' + WHEEL_RPM + ' RPM时已绑滑轮 ' + PULLEY_SU_LOAD + '/台+平台 ' + PLATFORM_SU_LOAD + '/格，二者同乘滑轮速度倍率（未绑定不计）。两台基准速电梯共' + (2 * (PULLEY_SU_LOAD + PLATFORM_SU_LOAD)) + ' SU，超过单水车容量' + WHEEL_SU_CAPACITY + '，可加动力源或降速。',
            'AI 建造井道电梯配方：竖直 AIR 井道（全程无实心）→ 底放电梯平台、顶悬垂挂滑轮（或底部顶举滑轮）→ 滑轮背面格接传动轴连到水车 → 拉杆贴滑轮；全部直接写变体 ID，施工任务完成后自动绑绳+回写 powered。',
        ].join('\n'),
    },
    {
        id: 'home',
        title: '安家、床与睡眠、常用栏和安全暂停',
        keywords: ['床','睡觉','睡眠','家','重生','常用栏','快捷栏','羊毛','轻松','暂停','首夜','水池'],
        sources: ['js/bed.js','js/homeSurvival.js','js/playerLife.js','js/uiModal.js','js/world.js','js/ui.js','js/itemSources.js'],
        text: [
            '小床 ID '+BED_BASE+'..'+(BED_BASE+BED_COUNT-1)+'：BED_BASE+half*4+facing，half=0床尾/1床头，facing=0北1东2南3西；床头在朝向相邻格。碰撞高 '+BED_HEIGHT+'，图集由 textureTiles.js 分配。',
            '工作台：3 羊毛+3 木板→床；6 木板→3 门。床需两格空气、下方完整实心支撑且不与玩家重叠。白天右键设家，晚上睡到清晨，不补饥饿；床边要有安全起身通道，有能走到床边的敌人时不能睡，墙外隔离的敌人不阻睡；高台上能落到床边的敌人仍会阻睡。',
            '家床坐标随存档槽和热重载保存。死亡保留背包，优先床边，床失效/被堵则安全回退出生点并说明原因。拆任一半或玩家拆支撑只返一床；覆盖/爆炸/支撑损坏清两格并撤无支撑红石挂件，环境破坏不送物品进背包。活塞不能推床，锯/投料器不能处理床。原木地板可安全睡醒/重生，新世界自然出生才排除树冠。AI buildQueue 不接受原始床状态写入，请让玩家放床，清区/覆盖已有床会完整清理。',
            '新世界生存赠木器三件、5 苹果、8 火把、6 原木和3 羊毛；仅首次进入生存赠送。前 '+FIRST_DAY_SECONDS+' 秒有效游玩时间不入夜。设置→生存选择自由实验后可选领取一次性机械实验包。旧档原有物品保留；只有缺首赠标记、创造模式且空背包的旧档，首次切生存补发安家包一次。',
            '新世界默认轻松（苦力怕不破坏方块但仍伤人）；旧档默认冒险，设置可切。玩家 TNT 两种规则都照常破坏。新生成版本2在出生地附近有浅池；旧版1地形算法及扩容生成保持不变。',
            '普通生存菜单、背包、题卡、说明、助手打字、隐藏/失焦时世界 tick 完全冻结。创造施工录像与关卡计时不改变。',
            '致命伤害先将生命归零再刷新红心，重生恢复满生命并保留背包。',
            '九格常用栏 player.quickbar 存物品ID；数字键1~9/滚轮切换，E面板展开「设置常用栏」，点栏位置再点已有物品即可配置。selectedSlot仍是HotbarBlocks全目录索引。背包已有优先并有已有/安家/工具筛选，材料显示缺额和来源，来源由 itemSources.js 与悬停共用；水可用空桶取放，旧世界可在工作台用空桶+4沙+2原木集水，无生存获取链的物品明确标仅创造/编辑可取用。材料旁 ? 查来源，制作按钮或配方行执行合成。',
        ].join('\n'),
    },
    {
        id: 'homestead',
        title: '稳定生活：箱子、熔炉、种田、树林与家畜',
        keywords: ['箱子','存取','农田','种子','小麦','面包','树苗','水桶','剪刀','羊毛','喂养','命名','熔炉','自由实验','纪念章'],
        sources: ['js/homestead.js','js/lifeData.js','js/inventoryStacks.js','js/lifeUI.js','js/entities.js','js/survivalRules.js'],
        text: [
            `箱子 ${LifeBlocks.CHEST}：右键开生活面板，${LIFE.chestSlots}格；每格${LIFE.stackSize}件，工具单独记录磨损。存1/存一组/取1/取整组/存同类/取常用（材料补16、工具补1）。拆箱拆炉原子摘除后返还完整内容，掉落可随保存恢复；创造模式拾取也保留物资和工具磨损，满包留下余量。箱炉不可推/锯。`,
            `生活方块242..251：箱子、耕地、四期小麦、树苗、围栏、围栏门关/开。物品ID ${LifeItems.SEEDS}以上不许写进Uint8世界。`,
            `种子：挖草地必得、2泥土筛1种、成熟返2种；设置→生存一次种植包8种子2树苗。木锄右键草地/泥土成耕地，四格内有水才能播种；小麦每${LIFE.cropStageSeconds}有效秒长一期，三期后成熟，右键收获1麦2种；3麦徒手做面包。未熟挖下返1种。`,
            `树苗：打树叶必得，或原木+泥土制作；种在草地/泥土，${LIFE.treeSeconds}有效秒后尝试生长。整树5格宽7格高空间先验，空间不足不覆盖建筑，留苗等待。拆耕地/树苗地面会立即清植物并返一次收获物，成长时再次检查支撑；编辑器可删除植物但不发生活资源，闯关禁止收获。`,
            `空桶3铁锭在工作台制作，对准水面右键取水，水桶右键放水并返空桶；手中与常用栏自动换成对应桶，水车同步重算。旧世界无水可工作台空桶+4沙+2原木集水，不自动改旧地形。`,
            `拿小麦可引诱10格内动物。近处对准动物右键开面板，用1小麦认领并命名，家畜上限${LIFE.maxAnimals}只，不占野生动物${MAX_PASSIVE_MOBS}只额度。远离、普通死亡、读档后仍保留。剪刀2铁锭制作，剪羊每次3毛；再喂小麦并游玩${LIFE.woolSeconds}秒长回。围栏/关门碰撞高1.5，上半也可瞄准右键开门，击退不能把羊穿栏；不要在围栏旁垫高让动物绕出。`,
            `熔炉右键，原料/燃料/成品分格。每件${LIFE.furnaceSeconds}秒，煤供64秒、原木16秒、木板8秒；原木作原料可烧炭。背包即时熔炉兑换已禁用。输出满冻结全部消耗。普通生存收起面板才继续加工。暂停/失焦/离线/睡眠跳天空不补算生产。`,
            '标准生存默认AI只给清单、蓝图和步骤，世界写入/建造脚本/源码写入都拒绝；入口、队列入队、消费使用同一守卫。设置明确选自由实验才放行免费施工，切回标准取消剩余队列，已应用部分保留并刷新显示与网络。标准生存答题给收藏纪念章，不无限产钻石、铁或主食，原学习统计保留。',
            '临时关卡只携空箱/炉及植物外形，不携普通世界库存、生产或家畜；进出与热重载均隔离。',
        ].join('\n'),
    },
    {
        id: 'adventure',
        title: '主动探险、地图、装备维修、我的作品',
        keywords: ['探险','探索','地图','路标','浅矿洞','旧塔','营地','梯子','盾','护具','护甲','维修','修理','经验','农庄','灯塔','矿井电梯','作品'],
        sources: ['js/landmarks.js','js/adventureData.js','js/adventure.js','js/adventureUI.js','js/playerPhysics.js','js/items.js'],
        text: [
            '新世界 generationVersion=3：出生地北方浅矿洞、东方旧塔、西方林间营地，以三格宽碎石路连接；洞内有缓坡原路可返。旧版本1/2地形保持逐字节，不补盖地标；旧世界仍能记路标和做作品。',
            `木梯ID ${LADDER_BASE}..${LADDER_BASE+3}，朝向0北1东2南3西为背靠墙方向；木棍7→3梯。贴墙侧面放，靠近后Space/W上爬、Shift下爬，松手停住，速度${ADVENTURE.climbSpeed}格/秒；上方出口要留两格净空，顶部梯高出平台一格；支撑被拆梯子掉下；被活塞推压按贴墙道具移除，只返还一次梯子，不会留下悬空梯。`,
            `J打开探险手册：北向上简图、家、本人、已发现地标、自命名路标和目标方向。亲自到达地标才记录，各一次${ADVENTURE.discoveryXp}经验+1探索纪念章(ID${AdventureItems.SOUVENIR})；飞行、创造和临时关卡不发现。路标最多24个。`,
            `铁护具ID${AdventureItems.ARMOR}耐久${BlockInfo[AdventureItems.ARMOR].maxDurability}，木铁盾ID${AdventureItems.SHIELD}耐久${BlockInfo[AdventureItems.SHIELD].maxDurability}；工作台分别8铁锭、6木板+1铁锭制作。J装备页装备/收起；护具战斗与爆炸减伤${ADVENTURE.armorReduction*100}%，盾面向攻击来源并按住O（或手持盾按住右键/X）再减伤${ADVENTURE.shieldReduction*100}%，最终四舍五入至少1伤害。饥饿/溺水/摔落不减。受击消耗耐久，存箱后不再生效。`,
            `维修：J装备页，在工作台4格内修当前磨损工具，花${ADVENTURE.repairXp}经验+1材料，恢复最多${ADVENTURE.repairFraction*100}%耐久；木/石/铁/钻工具材料=木板/圆石/铁锭/钻石，木锄木板、剪刀和护盾铁锭。满耐久/缺材料/缺经验不扣费，备用工具磨损不变。`,
            'J作品页自选农庄/灯塔/矿井电梯，首次选择脚下为中心24格范围；真实麦田围栏箱子/高处塔身亮灯梯子/滑轮平台与真正移动记录，收获和传送带实际入箱记录组成进度。可切换不清既有成果，名字和讲解随世界保存。截图F2、录像Tab、关卡工坊已有入口可展示；不自动造作品或变成关卡。',
            'adventureData统一reset/capture/restore，跟随homeSurvival存普通档及热重载快照，临时关卡进入清空、退出恢复。',
        ].join('\n'),
    },
    {
        id: 'survival',
        title: '生存系统（饥饿/氧气/合成/经验/成长线）',
        keywords: ['生存', '饥饿', '氧气', '摔落', '经验', '合成', '配方', '食物', '熔炉', '工作台', '进食', '溺水'],
        sources: ['js/playerLife.js', 'js/ui.js', 'js/config.js'],
        text: [
            '饥饿（满 ' + MAX_HUNGER + '）：移动 ' + HUNGER_DRAIN_SEC + 's/点（疾跑×2.7、站立×0.2）；≥' + HUNGER_REGEN_MIN + ' 每 ' + HUNGER_REGEN_SEC + 's 判定回 1 血；=0 判定扣血（最低扣到 1）。食物（BlockInfo.food，右键进食）：' + renderFoods() + '。',
            '氧气 ' + MAX_AIR + 's：头部没入水开始倒数，归零每 1.5s 扣 2 血；出水 3 倍速恢复。摔落：落差 >' + FALL_DAMAGE_MIN + ' 格开始扣血=floor(落差-3)；水中游泳免摔；脚部仍浸水时保留浮力，按住空格向岸移动可跃上一格岸，头顶碰撞仍有效，离水后恢复重力而不增加空中跳跃。',
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
        sources: ['js/entities.js', 'js/config.js', 'js/items.js'],
        text: [
            '图鉴（config.js MOB_TYPES）：' + renderMobs() + '。',
            '行为：僵尸追击近战需路径无实心遮挡、白天着火消散；苦力怕贴近进入引信膨胀闪烁→自爆（复用 TNT 爆炸，半径 3.5）；被动生物游荡、被打逃跑 3 秒；重合坐标的追击/击退不产生 NaN。',
            '掉落走真物品实体（items.js spawnItemDrop：0.25 小立方+重力+磁吸 ' + ITEM_MAGNET_DIST + ' 格+拾取 ' + ITEM_PICKUP_DIST + ' 格+120s 寿命）。',
            '刷怪规则见 world 节：24~128 环带/火把 6 格内不刷/成群/32 格冻结；玩家第三人称模型与原型 clone 共享在 entities.js 的 buildMobProto。',
        ].join('\n'),
    },
    {
        id: 'tnt',
        title: 'TNT 与爆炸（点燃路径/苦力怕自爆/闯关保护）',
        keywords: ['TNT', '爆炸', '引爆', '点燃', '苦力怕', '自爆', '炸', '陷阱', '引信'],
        sources: ['js/tnt.js', 'js/redstone.js', 'js/interaction.js', 'js/entities.js', 'js/levelRun.js'],
        text: [
            '点燃路径（放置的 TNT 是惰性方块）：① 右键点它=手动点燃（interaction.js 交互链：食物→台/炉→门/TNT/按钮/拉杆→放置）；② 红石信号上升沿=引爆（redstone.js 对 TNT 逐格做边沿检测，压力板/拉杆/观察者配合可做陷阱）。点燃后生成引信实体（闪烁计时，2.5s 后爆炸），爆炸瞬间原格 TNT 方块一并清除。做陷阱：TNT 埋地 + 压力板盖顶 + 粉线连 TNT，踩板上升沿即起爆。',
            '同位置仅一个引信，重复点燃不重置倒计时；方块被替换或炸掉即取消该引信。孤立 TNT 消失也刷新爆心区块，玩家重合爆心时击退数值保持有限。',
            '爆炸范围与副作用（tnt.js explode）：半径 R=3——欧氏距离 ≤3.5 格内的方块全部清除（跳过空气与基岩），30% 概率出破坏粒子；炸掉的火把清点光源、道具清掉落物；活塞被炸成孤儿（头/底座失配）由 fixPistonAround 就地修复；受影响区块（含相邻）重建后重算红石与动力网络（拓扑变了）。',
            '对实体：玩家距爆心 <5 格受 round((5−d)×3) 伤害并被击退（水平 8、竖直 +5）；怪物 <5 格受 round((5−d)×4)。连锁：爆炸能引爆圈内其它惰性 TNT 吗——不能，只会把 TNT 方块当普通方块炸掉（无连锁殉爆）。',
            '苦力怕自爆复用同一爆炸（entities.js）：贴近玩家 ' + MOB_TYPES.creeper.fuseDist + ' 格内开始充能引信 ' + MOB_TYPES.creeper.fuseSec + 's（膨胀闪烁+冒烟，离开则缓慢泄压），充满即自爆——调用 explode(...,creeper)，轻松生存只伤人不破坏方块，冒险照常破坏，自爆的苦力怕不掉落不给经验；夜晚成群刷的敌对里约三成是苦力怕。',
            '闯关模式爆炸保护（levelRun W12）：isLevelRunActive 时 锁具（答题机）/旗组/星辉门/门 免疫爆炸（谜题结构不许炸穿），普通方块照炸——关卡里的 TNT 来自作者自己的布置；闯关不刷怪（mobSpawnTick 直接 return），进关时清空点燃中的 TNT 实体（clearTntEntities）。',
        ].join('\n'),
    },
    {
        id: 'saves',
        title: '存档与全局状态（state 字段速查）',
        keywords: ['存档', 'localStorage', '槽位', '迁移', '版本', 'state', '字段', '快照', '自动保存'],
        sources: ['js/saveGame.js', 'js/state.js', 'js/rle.js', 'js/assistant/snapshot.js'],
        text: [
            '多槽存档：localStorage mcweb.save.v1.slotN（' + SAVE_SLOTS + ' 槽，每槽一个独立世界）+ 轻量索引 mcweb.save.index；方块 RLE base64（enc rle/raw）+ 玩家（hunger/air/xp/toolWear/quickbar）/模式/时间/出生点/worldSeed；当前槽 state.saveSlot。自动存 ' + SAVE_AUTOSAVE_SEC + 's + 页面隐藏兜底。',
            '版本：v4 起带 dims=[宽,高,深]——尺寸不符的老档按存档种子重生成地形+老区域逐格覆盖迁移（玩家改动零丢失）；破坏性协议变化需升级 SAVE_VERSION；新增可选字段需安全默认并同步热重载快照。导入先完整验证尺寸、base64 和 RLE/raw 长度，损坏数据保留原槽位与索引；导入成功后自动存档抑制到下次 loadGame（防 reload 触发的 pagehide 兜底存档把内存旧世界覆盖刚导入的槽）。',
            '安家字段：homeBed/survivalDifficulty/survivalStarted/firstDayRemaining/starterWorkshopClaimed/homeGuideEnabled/generationVersion 与 quickbar 在存档和快照中双向保存；缺 generationVersion=1（迁移仍用旧地形），新世界=3 追加浅池和三处地标，版本1/2地形保持不变。',
            '世界切换/覆盖重开清 AI 施工队列；闯关(state.levelRun)/编辑器(state.levelEdit)入口互斥且要求原世界保存成功，失败拒绝进入并提示存储原因，临时世界期间 saveGame 拒写槽。loadGame 清落地/落差/水中态并重建红石与动力缓存。',
            'state.js 关键字段：blocks(Uint8Array)、player{x,y,z,yaw,flying,health,hunger,air,xp,toolWear,inventory,selectedSlot,onGround}、enemies、itemDrops(不进存档)、time、spawn、worldSeed、buildSpeedIdx/buildPaused(施工)、chunkUpdates、levelRun(闯关中非 null)、levelEdit(编辑器中非 null)。',
            '助手热重载快照：sessionStorage 方块 RLE+玩家生存/磨损/worldSeed；恢复前验证编码，成功后清生物/物品/TNT/粒子/施工队列并重建机关。闯关/编辑仅存临时标记、不序列化方块，刷新恢复原槽世界。',
        ].join('\n'),
    },
    {
        id: 'modules',
        title: '模块地图（改码定位：哪个文件管什么、关键导出）',
        keywords: ['模块', '文件', '函数', '导出', '源码', '结构', '哪里', '地图'],
        sources: ['js/config.js', 'js/state.js', 'js/main.js'],
        text: [
            '一文件一职责（先在这里定位，再 read_game_file 只读目标文件）：',
            '- config.js：全部常量与 ID 编码纯函数（doorId/rtorchId/pistonId/shaftId/clutchId/pulleyId…）、BlockTypes/BlockInfo（含 outline 选取形状）、RECIPES/KINETIC_RECIPES、ToolTypes 与 registerTool',
            '- state.js：全局单例 state（唯一数据源）+ isCreative()/isNight()；main.js：装配与主循环 gameLoop（updateMining→物理→viewmodel→渲染→renderViewmodel）',
            '- world.js：generateWorld/getBlock/setBlockSafe（地形种子混入 worldSeed）；chunk.js：rebuildChunk(cx,cz)/updateChunkMeshes/isSolid/isTransparent/getPropMesh/refreshPropAt',
            '- mining.js：蓄力挖掘（硬度×1.5/5÷速度、裂纹、canHarvest、damageHeldTool）；interaction.js：breakBlockAt/placeBlock/raycastBlocks（outline 精确求交）/dropHeldItem/pickBlockUnderCrosshair',
            '- 有状态方块四组高层逻辑：door.js（tryPlaceDoor/toggleDoorAt/breakDoorAt）、redstone.js（placeRedstone/updateRedstoneNetwork/updateRedstoneTick）、piston.js（placePiston/updatePistonTick/carryRiders/updateObservers）、kinetic.js（placeKinetic/updateKineticNetwork/updateKineticTick/kineticStatusAt）',
            '- items.js：spawnItemDrop/updateItemDrops（重力/磁吸/骑带）；entities.js：MOB_TYPES 驱动的 AI 与刷怪；tnt.js：点燃与爆炸；particles.js：粒子',
            '- playerPhysics.js：移动碰撞重力游泳摔落骑带；playerLife.js：updateSurvivalStats/doEat/addXp/HUD/死亡重生',
            '- input.js：键鼠输入（isPlaying() 门控、isTypingTarget 让路）；uiModal.js：模态状态机+指针锁唯一管理者（新增浮层必须接入）；uiKeys.js：浮层方向键导航；ui.js：HUD/背包/合成面板/拍摄面板；itemInfo.js：describeItem 说明条；settingsUI.js：设置浮层；helpDocs.js：📖 说明浮层（目录+iframe 嵌 docs/ 图解）',
            '- buildQueue.js：enqueueBuildOps/getBuildStatus/setBuildSpeedIdx（AI 渐进施工+分帧重建；每个施工任务完成后自动重算红石+动力网络）；saveGame.js：initSaves/loadGame/saveGame/exportSlotJson/importSlotJson；rle.js：零依赖 RLE',
            '- textures.js：Canvas 程序化纹理（tiles/drawFunctions/blockUVs；分配表下沉在 textureTiles.js 纯数据模块；TILE_OVERRIDES 用 assets/textures/ 覆盖）；engine.js：three 场景；daynight.js：昼夜+天空；audio.js：音效；bgm.js：态势配乐状态机；viewmodel.js：手部视图；cameraRig.js：跟拍/自由镜；recording.js：画布录像；highlight.js：选取框',
            '- 教学与关卡：eduKeypad.js/eduMerchant.js/eduStarlight.js/eduRewards.js、levelRun.js（enterLevel/exitLevelRun）、levelWorkshop.js（buildLevelCard/validateLevelCard/reachabilityBFS/embedLevelToWorld）、levelEditor.js、levelPrefabs.js、questionBank.js/questionBankUI.js、levelPoster.js',
            '- assistant/：本助手自身代码，除非用户明确要求不要修改；*.bak* 历史备份禁止读写',
        ].join('\n'),
    },
    {
        id: 'recipes',
        title: '常见修改步骤（加方块/加键位/加配方/调参/热重载）',
        keywords: ['修改', '新增', '添加', '步骤', '热重载', '纹理', '贴图', '调参', '常量', '怎么改', '实现'],
        sources: ['js/config.js', 'js/textures.js', 'js/textureTiles.js', 'js/input.js', 'js/chunk.js'],
        text: [
            '新增普通方块：① config.js——BlockTypes 加 ID（下一个可用整数）、BlockInfo 加 {name,solid,transparent,color,hardness,tool,needsTool,drop}、按需加入 HotbarBlocks；② textures.js——tiles 加 {type,top,side,bottom}+drawFunctions 加绘制函数（分配表在 textureTiles.js：图集 ' + atlasSize + '×' + atlasSize + '、空闲 tile ' + FREE_TILES_TEXT + '，别占用已占号；扩 atlasSize 会整体平移所有 UV，慎动）；③ 非标准立方体设 customMesh:true 并在 chunk.js getPropMesh 加分支（参考 TORCH/FLOWER）；④ 交互逻辑 interaction.js。',
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
        sources: ['js/input.js', 'js/uiKeys.js', 'js/uiModal.js'],
        text: [
            '移动：WASD/Space 跳（创造双击空格或 F 切飞行）/Shift 潜行·飞行下降/Ctrl+W 疾跑（飞行时同样生效：水平速度 ×1.5=' + (FLY_SPEED * 1.5).toFixed(1) + ' 格/秒，垂直升降不变；仅创造，生存切模式自动关飞行）。',
            '交互：左键=蓄力挖掘（准星是怪则攻击）；右键=放置/交互（食物进食→台/炉开面板→门/TNT/按钮/拉杆→放置；Shift+右键绕过交互直放）；中键吸取（创造）；1-9·滚轮切手持；Z 丢弃；E 背包+合成面板；J 探险手册（地图/装备维修/作品）；按住O举已装备盾；M 创造·生存切换。',
            '视图与系统：F5 或 V 视角、F1 隐藏界面、F2 截图、F3 调试、F6 昼夜（创造）、Esc 暂停菜单、Q=Esc 替代（内嵌浏览器宿主会截获 Esc）、T 或 🤖 助手。',
            '施工控制（AI 建造时）：[ ] 调速、P 暂停、G 前往施工现场、R 录像、C 切镜头、Tab 拍摄面板。',
            '纯键盘模式（⚙️ 设置「🎛 画面」切换）：永不锁定鼠标——方向键转视角、Enter 挖掘/攻击（按住蓄力）、X 放置/交互、I 吸取；与鼠标左右中键共用同一触发函数，闯关/编辑器守卫天然一致。',
            '浮层键盘导航（uiKeys.js，两模式通用）：方向键在可操作元素间移焦、Enter/Space 激活、Esc 先退打字再关面板；答题对话框刻意不进导航（数字键作答）。',
        ].join('\n'),
    },
    {
        id: 'media',
        title: '录像·拍摄·配乐（三镜头/自动跟拍/BGM 态势/音量）',
        keywords: ['录像', '录制', '拍摄', '镜头', 'BGM', '配乐', '音效', '音量', '自动取景', '跟拍', '宣传片', '音乐', '风格包', '管弦', 'YuE2'],
        sources: ['js/recording.js', 'js/cameraRig.js', 'js/audio.js', 'js/bgm.js', 'js/ui.js', 'js/settingsUI.js'],
        text: [
            '拍摄面板（ui.js，显隐跟随 AI 助手面板——助手开（T）才显示、助手关即整体隐藏，不再常驻；Tab 释放鼠标操作面板（施工继续），再按 Tab 回游戏）：R 开始录制/停止保存；三镜头=玩家视角 player/自动取景 build/手动调镜 free（C 键循环），切换镜头不断录像。手动调镜=从当前相机真实位姿无跳变接管：点击画面鼠标转向、WASD 移动、空格/Shift 升降、滚轮调速。录制本体不依赖面板可见性：面板隐藏时 R 键照常启停。',
            '📖 说明浮层（helpDocs.js，首屏/暂停菜单「📖 说明」按钮）：目录+iframe 嵌 docs/ 图解文档（首篇=红石能源系统图解，含信号源/开关/脉冲/时钟/火把塔交互演示）；Esc/Q 关闭、闯关中拒开；加新文档改 helpDocs.js 的 DOCS 表。红石速记：源（拉杆/按钮 1s/压力板/火把/观察者 0.2s 背面输出/已解锁答题机）15 级→粉每格-1；拉杆只充能自己贴的方块；粉充能脚下+水平四邻；火把充能正上方；被充能方块唯一用途=翻转贴附火把（不喂粉，与原版差异）；负载看 6 邻亮粉或激活源。',
            'AI 施工自动跟拍（cameraRig.js）：开工自动取景并开录（owner=cam）——按建筑八角包围盒+真实 FOV/aspect 框住宽/高/深，遮挡检测自动换机位；施工期间切镜不停录，等待 AI 下一轮工具调用不算完工；真正完工后展示 4s 只停 cam 会话；用户手动停过本次不再自动重开，用户/关卡的录像绝不被收尾停掉。「AI 施工自动录制」开关存 localStorage mcweb.buildAutoRecord（拍摄面板可关）。',
            '录像（recording.js）：独立画布 ≤1920×1080 偶数尺寸 30fps；编码显式锁定 H.264+AAC 的 mp4（QuickTime 全兼容——裸 video/mp4 会被浏览器协商出 VP9/Opus 弹「不兼容部分媒体」），不支持 AAC 的环境退 avc1+opus（音轨提示用 VLC/IINA），webm 仅兜底；音轨从 audio.js 主输出分轨 clone 合入；单段最长 10 分钟（到点自动停并保存）；停止后自动下载，被拦截可点「保存上一段」（入口保留到下一片完成或页面关闭）；启动失败明确反馈且不残留录制态。录像所有权三档：cam=施工跟拍/level=关卡宣传片（通关或退出自动保存，绝不碰用户会话）/user=手动（只能用户停）。',
            'BGM（bgm.js）：白天 day/黑夜 night/怪物接近 approach/战斗 combat 四态势自动切换，优先级 战斗>接近>黑夜>白天；接近 18 格进 24 格出、战斗 8 进 12 出（迟滞防边界来回切歌），受伤保底战斗曲 4s；怪物从无到有叠放一次性警示句（20s 冷却）；候选稳定 1.2s 才切、非紧急曲最小间隔 8s；新曲 1.2s 淡入、旧曲 0.2s 快速淡出保证不叠歌。五风格包 classic/pastoral/lofi/ambient/orchestral：文件名 bgm_<pack>_<mood>.m4a（经典包无包前缀 bgm_<mood>.m4a），新包单曲缺失回退经典包同名曲、再缺静默无配乐不报错；orchestral（管弦冒险）=YuE2 本地生成的管弦配乐，重生成跑 python3 tools/gen_yue2_audio.py（需本机 ComfyUI 带 --gpu-only 跑 YuE2 bf16）；风格与音量存 localStorage（mcweb.bgm.style / mcweb.bgm.vol）。',
            '音效与音量（audio.js/settingsUI.js）：音效走 sfxBus 总线、与 BGM 分开调音量（mcweb.sfx.vol），都汇主输出——录像分轨才带得走全部游戏声音；⚙️ 设置浮层「🎵 音频」页=风格包选择+音乐/音效音量滑块（即时生效）；教学音效 assets/audio/edu_{correct,wrong,unlock}.wav（YuE2 重制版 3s/32kHz/单声道，与 BGM 同出 tools/gen_yue2_audio.py）缺文件回退 WebAudio 合成音。',
        ].join('\n'),
    },
    {
        id: 'edu',
        title: '教学组与关卡工坊（答题机/商人/识字矿/关卡）',
        keywords: ['教学', '答题机', '题库', '关卡', '闯关', '星辉门', '出题笔', '识字', '商人', '图鉴', '锁', '奖励', '里程碑', '错题本', '草稿', '退出', '保存失败', '继续编辑', '放弃'],
        sources: ['js/eduKeypad.js', 'js/eduRewards.js', 'js/eduMerchant.js', 'js/eduStarlight.js', 'js/levelWorkshop.js', 'js/levelRun.js', 'js/levelEditor.js'],
        text: [
            '答题机 ' + KEYPAD_BASE + '(0锁/1已解锁)：右键答题（数字题 0..9999 或选择题按 1~4），按格子坐标哈希确定性抽题（同格同题，不进存档）；答对翻转为常供能红石信号源——源自身贴着负载也算激活：贴门放=直接开门、接粉=远程解锁。AI 建造=写 ' + KEYPAD_BASE + '（锁定变体，玩家右键出题）。学科：数学/科学/道法/语文。',
            '英语商人 ' + MERCHANT_BASE + '：右键单词交易（看中选英/看英选中/情景对话，按 1~3），答对拿奖励+词句入图鉴。识字矿石 ' + HANZI_ORE + '（y≤44 约 1% 生成）：挖开按格哈希认生字入图鉴（带注音组词）。',
            '关卡工坊：旗组 ' + FLAG_BASE + '+kind（0 起点/1 检查点/2 终点）；星辉门 ' + STARLIGHT_BASE + '(0锁/1开) 出「还没学到」的超纲题，答对开门+记提前解锁、答错入错题本；出题笔（物品 ' + PEN_ID + '）手持右键答题机=作者面板出题；同一把锁连答对 2 次=双通过才能导出 .level.json。',
            '奖励梯队（eduRewards.js grantEduReward，答题机/商人答对即发）：连对 streak 8+ 传说=钻石×2+熟猪排×2 / 5+ 史诗=钻石×1+铁锭×2 / 3+ 精良=铁锭×2+苹果×2 / 基础 苹果×1；累计里程碑（答对总数）5=红石灯×2、10=粘液块×8、20=钻石×2、50=钻石×5（一次性，p.claimed 记已领）；10% 概率彩蛋熟猪排×1；奖励走 spawnItemDrop 真物品弹出（磁吸自动入包），里程碑触发解锁音效。',
            '学习进度 localStorage mcweb.edu.v1（跨存档槽累计，字段只增不改）：solved/wrong/streak（答题机）+ trades/words（商人）+ hanzi/hanziNew（识字图鉴）+ claimed（已领里程碑）+ subjects:{math/science/daofa/yuwen:{solved,wrong}} 分学科对错 + merchantModes 商人分模式计数 + progress:{unit}（三上第 N 单元，星辉门「超纲」判定基准）+ wrongBook 错题本（≤50 条滚动淘汰）+ metrics:{weekPlays,returnEvents,helpRequests,earlyUnlocks} 回流埋点（⚙️ 家长页 4 周趋势）。',
            '题库契约（docs/edu-quiz-banks-contract.md，内容↔代码唯一接口）：assets/edu/banks.json 清单=五/六学科条目（subject 稳定 key 勿改，weight 控抽中概率、math=2 其余 1）；单个题库文件缺失/损坏=跳过该学科走内置兜底题，绝不阻塞；题级规则：input 答案 0..9999 整数、choice options 3~4 个互异且 a 为 0 基下标、每题必填 unit+hint；交付前跑 tools/validate_banks.py 全量校验。',
            '关卡卡 mcweb.level.v1（levelWorkshop.js 是唯一换算点）：region 自动检测=旗∪锁∪门包围盒+2 格、上限 96×64×96（超限报错）；方块快照 RLE+base64（region.enc=' + "'rle'" + '，字节布局同存档）；题目全量拷贝进卡（题级 kind 下沉、meta.source=bank|custom）；卡内一律局部坐标（相对 region.x0/y0/z0）；双通过=作者连过同一锁 2 次（meta.verifiedPasses<2 拒导出，meta.draft 草稿卡降为警告）；嵌入固定偏移 (80,4,80)，运行期=临时世界、退出精确恢复。',
            '闯关模式：禁挖掘/放置/E/M/F6/飞行/中键/右键手开门，正午锁+禁刷怪+饥饿氧气冻结（摔落保留）；死亡回检查点计时不停；先判断超时再踩终点，超时0星失败；通关3星=零死亡且全锁一次过，2星=零死亡或全对，否则1星；退出恢复原槽。世界改造工具被拒。',
            '编辑器：独立创造世界+正午，可挖掘/放置/出题；B 组件库；续编保留规则/created，草稿缺省或显式 verifiedPasses=0 都须双通过；模板草稿另开副本。正式导出保留限时，考核锁随作者选择。存稿串行、退出等在途；持久事务提交成功才替换旧稿，失败保留磁盘备份，续编也不误删；会话稿刷新会丢失。缺旗/超范围/持久保存失败时退出保留世界并显示原因，默认继续编辑（Esc/Q同效），只有明确「放弃修改并退出」才恢复原世界；修正后可重新保存退出，最后有效稿保留。保存等待与退出选择期间暂停盖章、改题和助手快捷键。卡内几何快照一致，切世界中止出卡。',
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
