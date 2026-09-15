// ==================== extra_11_liftworks.js ====================
// 「电梯工厂」机关专项断言（smoke_level_generic.py --extra 注入；进入关卡后、逐锁作答前——
// 实际在全部锁答完之后执行，此时无人碰过呼梯拉杆，电梯平台停在底层）。
// 断言：
//   ① 拉杆呼梯全链：底层拉杆右键切换（红石粉明线 11 格 → 滑轮充能=卷绳）后，
//      电梯平台格发生竖直位移（动力网络 running + 红石远控都正常才成立）。
//   ② 二层车间传送带正在运转（带贴楼板、紧邻传动轴入同一动力分量，水车供能）。
//   ③ 电梯驱动水车在转（kineticStatusAt 报「转速 8 RPM」而非静止/卡死/过载）。
// 可用符号：lib.py PREAMBLE（cfg/S/gb/sb/sleep/tick/rs/kn/w/BT…）+ WPX（lr/lws/ek/teleport…）。
// 布局常量与 tools/builtin_levels/level_11_liftworks.mjs 对应（gy=3：滑轮 gy+7=10、
// 水车 gy+8=11、拉杆/平台/传送带 gy+1=4、车间带 gy+7=10）。
async function runExtra(card) {
  const out = {};
  const W = (x, y, z) => lws.localToWorld(x, y, z);
  const PULLEY = [28, 10, 28];   // 电梯滑轮（朝下垂挂）
  const LEVER = [22, 4, 24];     // 底层呼梯拉杆（默认关）
  const BELT = [36, 10, 20];     // 车间走廊传送带（向东运）
  const WHEEL = [28, 11, 28];    // 塔顶竖轴水车（顶面接水）

  // ---- ① 拉杆呼梯：切换拉杆 → 平台竖直位移 ----
  {
    const pw = W(...PULLEY);
    const scanY = () => {
      for (let y = pw.y - 1; y > pw.y - 33; y--) {   // 沿绳向扫平台（≤PULLEY_ROPE_MAX）
        if (gb(pw.x, y, pw.z) === cfg.PLATFORM_BASE) return y;
      }
      return null;
    };
    const y0 = scanY();
    const lw = W(...LEVER);
    const lid0 = gb(lw.x, lw.y, lw.z);
    const lever0 = cfg.isLeverId(lid0) ? cfg.leverOn(lid0) : -1;
    rs.toggleLeverAt(lw.x, lw.y, lw.z);              // 右键切换拉杆（触发红石重算）
    await tick(30);                                   // ≥1.6s：LIFT_SPEED 1.5 格/秒，足够走 ≥1 格
    const y1 = scanY();
    const lid1 = gb(lw.x, lw.y, lw.z);
    const lever1 = cfg.isLeverId(lid1) ? cfg.leverOn(lid1) : -1;
    const ok = y0 !== null && y1 !== null && Math.abs(y1 - y0) > 0;
    out['拉杆呼梯·平台竖直位移'] = [ok,
      `平台 y ${y0}→${y1}（拉杆 ${lever0}→${lever1} @(${lw.x},${lw.y},${lw.z})，滑轮 @(${pw.x},${pw.y},${pw.z})）`];
  }

  // ---- ② 车间传送带运转中 ----
  {
    const bw = W(...BELT);
    const id = gb(bw.x, bw.y, bw.z);
    const running = kn.isBeltRunningAt(bw.x, bw.y, bw.z) === true;
    out['传送带·运转中'] = [cfg.isBeltId(id) && running,
      `带 @(${bw.x},${bw.y},${bw.z}) id=${id} isBeltRunningAt=${running}`];
  }

  // ---- ③ 电梯水车在转 ----
  {
    const ww = W(...WHEEL);
    const st = kn.kineticStatusAt(ww.x, ww.y, ww.z) || '';
    const ok = st.indexOf('转速 8 RPM') >= 0;
    out['水车·8 RPM 运转'] = [ok, `kineticStatusAt(${ww.x},${ww.y},${ww.z}) = ${st}`];
  }

  return out;
}
