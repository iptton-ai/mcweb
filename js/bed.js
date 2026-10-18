// 小床：完整双格生命周期、设家、睡眠和安全重生。底层覆盖约束在 world.setBlockSafe。
import { BED_DIRECTIONS, BED_ITEM_ID, BlockInfo, BlockTypes, PLAYER_HEIGHT, PLAYER_WIDTH,
    WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH, bedId, bedFacing, bedHalf, isBedId, collisionHeight } from './config.js';
import { state, isCreative, isNight } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { facingFromYaw } from './door.js';
import { refreshPropAt, rebuildChunk } from './chunk.js';
import { CHUNK_SIZE } from './config.js';
import { popUnsupportedRedstone, updateRedstoneNetwork } from './redstone.js';
import { showTooltip } from './ui.js';

export function getBedAt(x,y,z) {
    const id = getBlock(x,y,z);
    if (!isBedId(id)) return null;
    const facing = bedFacing(id), [dx,dz] = BED_DIRECTIONS[facing];
    const foot = { x:x-(bedHalf(id)?dx:0), y, z:z-(bedHalf(id)?dz:0), facing };
    if (getBlock(foot.x,y,foot.z) !== bedId(0,facing) || getBlock(foot.x+dx,y,foot.z+dz) !== bedId(1,facing)) return null;
    return foot;
}
const fullSupport = (x,y,z) => collisionHeight(getBlock(x,y,z)) === 1 && !BlockInfo[getBlock(x,y,z)]?.customMesh;
export function tryPlaceBed(x,y,z,yaw) {
    const facing = facingFromYaw(yaw), [dx,dz] = BED_DIRECTIONS[facing];
    const p = state.player, hw = PLAYER_WIDTH/2;
    const cells = [[x,y,z],[x+dx,y,z+dz]];
    for (const [bx,by,bz] of cells) {
        if (bx < 0 || bx >= WORLD_WIDTH || bz < 0 || bz >= WORLD_DEPTH || by < 1 || by >= WORLD_HEIGHT-2) return '小床需要世界内两格平地';
        if (getBlock(bx,by,bz) !== BlockTypes.AIR) return '床头被挡住了，请留出两格空地';
        if (!fullSupport(bx,by-1,bz)) return '床的两格下方都需要结实的地面';
        if (collisionHeight(getBlock(bx,by+1,bz)) > 0) return '床的上方需要留出空间';
        if (bx+1>p.x-hw && bx<p.x+hw && by+1>p.y && by<p.y+PLAYER_HEIGHT && bz+1>p.z-hw && bz<p.z+hw) return '请退开一步，再放下小床';
    }
    cells.forEach(([bx,by,bz],half) => { setBlockSafe(bx,by,bz,bedId(half,facing)); refreshPropAt(bx,by,bz); });
    return null;
}
export function breakBedAt(x,y,z,{drop=true}={}) {
    if (!isBedId(getBlock(x,y,z))) return [];
    const cells = setBlockSafe(x,y,z,BlockTypes.AIR) || [];
    if (drop && !isCreative()) state.player.inventory[BED_ITEM_ID] = (state.player.inventory[BED_ITEM_ID] || 0)+1;
    return cells;
}
export function flushBedChanges({ dropAttachments = false } = {}) {
    if (!state.bedDirtyCells.length) return;
    const chunks = new Set();
    while (state.bedDirtyCells.length) {
        for (const c of state.bedDirtyCells.splice(0)) {
            const changed = [c];
            // 被新实心块替换时原挂件仍有支撑；清空/水覆盖才撤掉挂件。
            if (!BlockInfo[getBlock(c.x, c.y, c.z)]?.solid) {
                changed.push(...popUnsupportedRedstone(c.x, c.y, c.z, { drop: dropAttachments }));
            }
            for (const cell of changed) chunks.add(`${Math.floor(cell.x / CHUNK_SIZE)},${Math.floor(cell.z / CHUNK_SIZE)}`);
        }
    }
    updateRedstoneNetwork();
    for (const key of chunks) {
        const [cx, cz] = key.split(',').map(Number);
        rebuildChunk(cx, cz);
    }
}

// 玩家拆支撑时，合并双格清理记录，只返还一次床；环境破坏不调用此函数。
export function refundRemovedBeds(cells) {
    if (isCreative()) return;
    const beds = new Set();
    for (const c of cells) {
        if (!isBedId(c.id)) continue;
        const facing = bedFacing(c.id), [dx, dz] = BED_DIRECTIONS[facing];
        const half = bedHalf(c.id);
        beds.add(`${c.x - half * dx},${c.y},${c.z - half * dz},${facing}`);
    }
    if (beds.size) state.player.inventory[BED_ITEM_ID] = (state.player.inventory[BED_ITEM_ID] || 0) + beds.size;
}

function clearStandingCell(x,y,z) {
    return x>=1 && x<WORLD_WIDTH-1 && z>=1 && z<WORLD_DEPTH-1 && y>=1 && y<WORLD_HEIGHT-2 &&
        fullSupport(x,y-1,z) && getBlock(x,y,z)!==BlockTypes.WATER && getBlock(x,y+1,z)!==BlockTypes.WATER &&
        !collisionHeight(getBlock(x,y,z)) && !collisionHeight(getBlock(x,y+1,z));
}
export function findSafeStandingPosition(origin,radius=12,{ naturalGround = false } = {}) {
    const ox=Math.floor(origin.x), oz=Math.floor(origin.z), oy=Math.floor(origin.y);
    for (let r=0;r<=radius;r++) for(let dx=-r;dx<=r;dx++) for(let dz=-r;dz<=r;dz++) {
        if (Math.max(Math.abs(dx),Math.abs(dz))!==r) continue;
        const x=ox+dx,z=oz+dz;
        // 优先同一层，找不到再在当地上下搜索，绝不把玩家放进水里或半格床里。
        for(let d=0;d<WORLD_HEIGHT;d++) for(const y of d ? [oy+d,oy-d] : [oy]) {
            if(clearStandingCell(x,y,z) && (!naturalGround || ![BlockTypes.LEAVES,BlockTypes.WOOD,BlockTypes.LOG].includes(getBlock(x,y-1,z)))) return {x:x+0.5,y:y+0.001,z:z+0.5};
        }
    }
    return null;
}
function bedExit(bed) {
    const [dx,dz]=BED_DIRECTIONS[bed.facing];
    const candidates=[];
    for(const [bx,bz] of [[bed.x,bed.z],[bed.x+dx,bed.z+dz]]) {
        for(const [sx,sz] of BED_DIRECTIONS) for(const dy of [0,1,-1]) {
            const x=bx+sx,y=bed.y+dy,z=bz+sz;
            if(clearStandingCell(x,y,z)) candidates.push({x:x+0.5,y:y+0.001,z:z+0.5});
        }
    }
    return candidates;
}
function reachableThreat(bed,exits) {
    const targets=new Set(exits.map(p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`));
    for(const e of state.enemies) {
        if(!e.hostile || e.hp<=0 || Math.hypot(e.x-bed.x,e.z-bed.z)>8 || Math.abs(e.y-bed.y)>4) continue;
        const start=[Math.floor(e.x),Math.floor(e.y),Math.floor(e.z)];
        const queue=[start], seen=new Set([start.join(',')]);
        for(let i=0;i<queue.length && i<800;i++) {
            const [x,y,z]=queue[i],key=`${x},${y},${z}`;

            if(targets.has(key)) return true;
            if(Math.hypot(x-bed.x,z-bed.z)>9) continue;
            const enqueue = (nx, ny, nz) => {
                const next = [nx, ny, nz], nextKey = next.join(',');
                if (!seen.has(nextKey) && clearStandingCell(...next)) {
                    seen.add(nextKey);
                    queue.push(next);
                }
            };
            for (const [dx, dz] of BED_DIRECTIONS) {
                const nx = x + dx, nz = z + dz;
                // 同层或一格台阶（与生物水平移动规则相同）。
                enqueue(nx, y, nz);
                if (!collisionHeight(getBlock(x, y + 2, z))) enqueue(nx, y + 1, nz);
                // 跨出平台后可自由下落，直到第一个实心表面；不能穿过封闭屋顶。
                if (!collisionHeight(getBlock(nx, y, nz)) && !collisionHeight(getBlock(nx, y + 1, nz))) {
                    for (let ny = y - 1; ny >= Math.max(1, bed.y - 4); ny--) {
                        if (collisionHeight(getBlock(nx, ny, nz))) break;
                        if (clearStandingCell(nx, ny, nz)) { enqueue(nx, ny, nz); break; }
                    }
                }
            }
        }
    }
    return false;
}
function moveTo(pos) {
    Object.assign(state.player,pos,{vx:0,vy:0,vz:0,fallStartY:null,inWater:false,underwater:false,onGround:true});
}
export function interactBedAt(x,y,z) {
    const fail = error => { showTooltip(error); return {ok:false,error}; };
    if(state.levelRun || state.levelEdit) return fail('这里是临时关卡世界，不能改变家或睡觉');
    const bed=getBedAt(x,y,z);
    if(!bed) return fail('这张床不完整，请重新放置');
    const exits=bedExit(bed);
    if(!exits.length) return fail('床边没有安全起身的位置，请清出两格高的通道');
    state.homeBed={...bed};
    if(!isNight()) { showTooltip('🏠 家已记住，以后会在这里醒来；晚上再来睡觉'); return {ok:true,slept:false}; }
    if(reachableThreat(bed,exits)) return fail('附近有能走到床边的怪物，请先关好门或清理它们');
    state.time=(Math.floor(state.time/state.dayLength)+1)*state.dayLength+state.dayLength*0.3;
    state.firstDayRemaining=0;
    moveTo(exits[0]);
    state.player.invulnTimer=Math.max(state.player.invulnTimer||0,2);
    const veil=document.getElementById('sleep-veil');
    if(veil) { veil.classList.remove('sleeping'); void veil.offsetWidth; veil.classList.add('sleeping'); }
    showTooltip('☀️ 睡到清晨了！带好早餐，开始新的一天');
    return {ok:true,slept:true};
}
export function getHomeRespawn() {
    let reason='';
    const h=state.homeBed;
    if(h) {
        const bed=getBedAt(h.x,h.y,h.z);
        if(bed && bed.facing===h.facing) {
            const pos=bedExit(bed)[0];
            if(pos) return {position:pos,reason:''};
            reason='床边被堵住了，先回到安全出生点';
        } else reason='原来的床不在了，先回到安全出生点';
    }
    let position=findSafeStandingPosition(state.spawn,16);
    if(!position) {
        // 极端改建世界：创建最小安全平台，保证回退不会掉进虚空或窒息。
        const x=Math.max(2,Math.min(WORLD_WIDTH-3,Math.floor(state.spawn.x)));
        const z=Math.max(2,Math.min(WORLD_DEPTH-3,Math.floor(state.spawn.z)));
        const y=Math.max(2,Math.min(WORLD_HEIGHT-3,Math.floor(state.spawn.y)));
        for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) {
            setBlockSafe(x+dx,y-1,z+dz,BlockTypes.PLANKS);
            setBlockSafe(x+dx,y,z+dz,BlockTypes.AIR); setBlockSafe(x+dx,y+1,z+dz,BlockTypes.AIR);
            rebuildChunk(Math.floor((x+dx)/CHUNK_SIZE),Math.floor((z+dz)/CHUNK_SIZE));
        }
        position={x:x+0.5,y:y+0.001,z:z+0.5};
        reason='出生点没有安全地面，已为你准备一个小平台';
    }
    return {position,reason};
}
