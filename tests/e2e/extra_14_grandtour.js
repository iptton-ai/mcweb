// ==================== extra_14_grandtour.js ====================
// 「全能冠军试炼」机关专项断言（smoke_level_generic.py --extra 注入；在全部 5 把锁
// 答完之后执行）。断言：
//   ① 布线大厅远控正确性：锁④（入口答题机，卡内局部 76,4,48）答对后，8 格玻璃导管
//      红石粉明线点亮、大厅尽头王座厅门（卡内局部 85,4,48，由 lockDoorHints 映射）
//      两半扇均已开门——远程红石布线是本关招牌机关，通用烟雾对这把锁只报「6 邻无门」。
//   ② 水下涵洞水体完整：段②石丘涵洞（局部 x28..34 / y4..5 / z47..49，共 42 格）全部
//      仍为 WATER——涵洞是 BFS 合法主路，水体缺失会既破游泳体验又改可达性。
// 可用符号：lib.py PREAMBLE（cfg/S/gb/sb/sleep/tick/rs/kn/w/BT…）+ WPX（lr/lws/ek/teleport…）。
async function runExtra(card) {
  const out = {};
  const W = (x, y, z) => lws.localToWorld(x, y, z);

  // ---- ① 远端王座门已开（布线正确性的关键验证）----
  {
    const dw = W(85, 4, 48);
    const lo = gb(dw.x, dw.y, dw.z);
    const up = gb(dw.x, dw.y + 1, dw.z);
    const ok = cfg.isDoorId(lo) && cfg.doorOpen(lo) === 1 &&
               cfg.isDoorId(up) && cfg.doorOpen(up) === 1;
    out['布线解锁·远端王座门已开'] = [ok,
      `门 @(${dw.x},${dw.y},${dw.z}) 下半 ${lo}/open=${cfg.isDoorId(lo) ? cfg.doorOpen(lo) : '非门'}` +
      ` 上半 ${up}/open=${cfg.isDoorId(up) ? cfg.doorOpen(up) : '非门'}`];
  }

  // ---- ② 水下涵洞水体完整 ----
  {
    let water = 0;
    const bad = [];
    for (let x = 28; x <= 34; x++) {
      for (let y = 4; y <= 5; y++) {
        for (let z = 47; z <= 49; z++) {
          const p = W(x, y, z);
          const id = gb(p.x, p.y, p.z);
          if (id === cfg.BlockTypes.WATER) water++; else bad.push(`${x},${y},${z}=${id}`);
        }
      }
    }
    const ok = water === 42 && bad.length === 0;
    out['水下涵洞·水体完整'] = [ok,
      `WATER ${water}/42${bad.length ? '；异常 ' + bad.slice(0, 6).join(' ') : ''}`];
  }

  return out;
}
