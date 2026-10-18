// 纯求解器：容量与绝对转速经过全部边；旋向只经过机械边。
// edge.ratio 是从本节点到邻节点的有符号传动比，反向边取倒数。
export function solveKineticGraph(nodes, edges, { sourceRpm, minRpm, maxRpm }) {
    const result = new Map(), components = [], visited = new Set();
    for (const seed of nodes.keys()) {
        if (visited.has(seed)) continue;
        const members = [], queue = [seed];
        visited.add(seed);
        for (let i = 0; i < queue.length; i++) {
            const key = queue[i];
            members.push(key);
            for (const e of edges.get(key) || []) {
                if (!visited.has(e.to)) { visited.add(e.to); queue.push(e.to); }
            }
        }
        const sources = members.filter(key => nodes.get(key).powered);
        const rpm = new Map(), direction = new Map();
        let speedConflict = false, phaseConflict = false;
        const origin = sources[0] || seed;
        rpm.set(origin, sourceRpm);
        const rq = [origin];
        for (let i = 0; i < rq.length; i++) {
            const key = rq[i];
            for (const e of edges.get(key) || []) {
                const value = rpm.get(key) * Math.abs(e.ratio);
                if (!rpm.has(e.to)) { rpm.set(e.to, value); rq.push(e.to); }
                else if (rpm.get(e.to) !== value) speedConflict = true;
            }
        }
        for (const key of sources) if (rpm.get(key) !== sourceRpm) speedConflict = true;
        // 每个相位子网都先从其动力源求解，带边绝缘也不能漏掉另一侧的内部冲突。
        for (const first of [...sources, ...members]) {
            if (direction.has(first)) continue;
            direction.set(first, 1);
            const dq = [first];
            for (let i = 0; i < dq.length; i++) {
                const key = dq[i];
                for (const e of edges.get(key) || []) {
                    if (e.insulated) continue;
                    const value = direction.get(key) * Math.sign(e.ratio);
                    if (!direction.has(e.to)) { direction.set(e.to, value); dq.push(e.to); }
                    else if (direction.get(e.to) !== value) phaseConflict = true;
                }
            }
        }
        for (const key of sources) if (direction.get(key) !== 1) phaseConflict = true;
        const capacity = sources.reduce((sum,key) => sum + nodes.get(key).capacity, 0);
        const load = members.reduce((sum,key) => sum + nodes.get(key).load * rpm.get(key) / sourceRpm, 0);
        const outOfRange = members.some(key => rpm.get(key) < minRpm || rpm.get(key) > maxRpm);
        const reason = !sources.length ? '无动力' : speedConflict ? '转速冲突'
            : phaseConflict ? '传动转向冲突' : outOfRange ? '超出转速范围'
                : load > capacity ? '应力过载' : null;
        const compId = components.length;
        components.push({ capacity, load, poweredWheels:sources.length,
            jammed:speedConflict || phaseConflict, overstressed:capacity > 0 && load > capacity,
            running:reason === null, reason });
        for (const key of members) result.set(key, {compId, dir:direction.get(key), rpm:rpm.get(key)});
    }
    return { map:result, components };
}
