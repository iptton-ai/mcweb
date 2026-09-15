// extra_09_clocktower.js —— L9「时光钟楼」活塞闸门机关专项断言。
// 配套：smoke_level_generic.py --file level_09_clocktower.level.json --extra extra_09_clocktower.js
//
// ⚠️ 插入点在 smoke_level_generic.py 的 __EXTRA__：主流程「答完全部锁之后」才执行 runExtra，
// 那时活塞已被答题机收回——所以本文件先 enterLevel 重试式重嵌（锁复位、answers 清零、
// initRedstone 按嵌入态重算）拿**初始态**，做纯读方块断言 ①②③；随后把 4 把锁重答一遍
// （新 answers 里 tries=1，保住主流程「全锁一次过」的 3 星结算），再断言电路断开、活塞头消失。
// 可用符号：lib.py PREAMBLE（B/cfg/BT/S/gb/sleep/tick/lr/lws/ek…）+ smoke_level_generic WPX
//（solveLock/teleport/pressWin…），card = 运行中的关卡卡对象。
async function runExtra(card) {
    const out = {};
    // 卡内局部坐标 → 世界坐标（唯一换算点 levelWorkshop.localToWorld）
    const w = (x, y, z) => lws.localToWorld(x, y, z);
    const HEAD = w(27, 15, 13);  // 机房门洞下格＝活塞头
    const TORCH = w(30, 15, 13); // 红石火把（反相器，挂操作台西面）
    const DUST = w(29, 15, 13);  // 红石粉中继（火把→活塞底座）
    const BASE = w(28, 15, 13);  // 活塞底座（朝西·伸出变体）
    const KEYPAD = w(31, 16, 13);// 机房答题机（操作台上）
    const LAMP = w(31, 17, 13);  // 解锁正反馈灯
    const rd = (p) => gb(p.x, p.y, p.z);

    // ---- 重试式重嵌：恢复「未答任何题」的初始嵌入态 ----
    await lr.enterLevel(card);
    await sleep(900);
    await tick(6); // initRedstone 已跑：亮火把→粉供电→活塞保持伸出（初始伸出的多余上升沿是空动作）

    // ① 初始态：活塞头格确实是「伸出活塞头」（朝西堵洞）
    out['初始·活塞头堵住机房门洞'] = [rd(HEAD) === cfg.pistonHeadId(5),
        `head=${rd(HEAD)} 期望 pistonHeadId(5)=${cfg.pistonHeadId(5)} @世界(${HEAD.x},${HEAD.y},${HEAD.z})`];
    // ② 初始态：红石火把在位且为「亮态」变体（贴西面= facing 5, lit=1）
    out['初始·红石火把为亮态反相器'] = [rd(TORCH) === cfg.rtorchId(5, 1),
        `torch=${rd(TORCH)} 期望 rtorchId(5,1)=${cfg.rtorchId(5, 1)} @世界(${TORCH.x},${TORCH.y},${TORCH.z})`];
    // ③ 初始态：答题机在位（224＝锁定变体），解锁灯为熄灭变体（95）
    out['初始·答题机在位（224）'] = [rd(KEYPAD) === cfg.KEYPAD_BASE && rd(LAMP) === cfg.lampId(0),
        `keypad=${rd(KEYPAD)}(期望 ${cfg.KEYPAD_BASE}) lamp=${rd(LAMP)}(期望 ${cfg.lampId(0)})`];
    // 供电链佐证：中继粉为亮态（36）、底座为「朝西·伸出」变体（115）
    out['初始·供电链（粉亮+底座伸出）'] = [rd(DUST) === cfg.dustId(1) && rd(BASE) === cfg.pistonId(false, 5, 1),
        `dust=${rd(DUST)}(期望 ${cfg.dustId(1)}) base=${rd(BASE)}(期望 ${cfg.pistonId(false, 5, 1)})`];

    // ---- 重答全部锁（重嵌后 answers 已清零，tries=1 不影响 3 星）----
    for (const q of card.questions) await solveLock(card, q);
    await tick(10); // 火把反相 0.1s + 活塞收回延迟 0.15s，留足红石/活塞 tick

    // 答对机房锁后：火把熄灭→粉失电→活塞下降沿收回→活塞头消失＝门洞全开
    out['答对后·活塞头消失路开'] = [rd(HEAD) === BT.AIR && rd(BASE) === cfg.pistonId(false, 5, 0),
        `head=${rd(HEAD)}(期望 AIR=${BT.AIR}) base=${rd(BASE)}(期望收回态 ${cfg.pistonId(false, 5, 0)})`];
    return out;
}
