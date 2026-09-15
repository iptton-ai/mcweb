// 通用远程门断言：卡 meta.lockDoorHints 里登记的「锁→门」映射（远程红石布线/活塞闸门锁），
// 在全部锁答完后逐一验证门已开。被 smoke_level_generic.py --extra 引用。
async function runExtra(card) {
  const out = {};
  const hints = (card.meta && card.meta.lockDoorHints) || [];
  if (!hints.length) return { '无远程门映射（跳过）': [true, 'card.meta.lockDoorHints 为空'] };
  for (const h of hints) {
    const w = lws.localToWorld(h.door[0], h.door[1], h.door[2]);
    const id = gb(w.x, w.y, w.z);
    const open = cfg.isDoorId(id) ? cfg.doorOpen(id) : -1;
    out[`远程门 ${h.door} 已开`] = [open === 1, `世界(${w.x},${w.y},${w.z}) id=${id} doorOpen=${open}`];
  }
  return out;
}
