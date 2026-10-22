// 有界物理实验与局部水路：固定步进、实方块事务、虚拟标准物体不兑换物资。
import { PhysicsBlocks as B, PHYSICS as P, BlockInfo, BlockTypes as T, BELT_DIRS, LifeItems,
    PLAYER_WIDTH, PLAYER_HEIGHT, PLATFORM_BASE, HotbarBlocks, CHUNK_SIZE, WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH,
    isPhysicsId, isPhysicsKineticId, isTroughId, troughId, troughWater, isBeltId, isWaterwheelId, BELT_RIDE_Y } from './config.js';
import { state, isCreative } from './state.js';
import { getBlock, setBlockSafe } from './world.js';
import { physicsData, physicsDeviceAt, physicsDefaults, physicsKey, rebuildPhysicsIndex, validPhysicsConfig } from './physicsData.js';
import { kineticInfoAt, updateKineticNetwork, isBeltRunningAt, hasRedstoneNear } from './kinetic.js';
import { redstoneSignalAt, popUnsupportedRedstone, updateRedstoneNetwork } from './redstone.js';
import { refreshPropAt, rebuildChunk, isSolid } from './chunk.js';
import { planStructureRiderMove, commitRiderMove } from './piston.js';
import { inventoryCapacity, takeInventoryStack, addInventoryStack } from './inventoryStacks.js';
import { explode } from './tnt.js';
import { isWorldPausedAt as isWorldPaused } from './worldPause.js';
import { updatePhysicsMesh } from './physicsModels.js';

const ok=()=>({ok:true}),error=message=>({error:message});
const inBounds=(x,y,z)=>x>=0&&x<WORLD_WIDTH&&y>=0&&y<WORLD_HEIGHT&&z>=0&&z<WORLD_DEPTH;
let world=null,revision=-1,accumulator=0,waterTime=0,clock=0,environment=-1;
const stats={steps:0,waterTransfers:0,platformSteps:0,fullScans:0};
export function initPhysicsLab() {
    rebuildPhysicsIndex();stats.fullScans++;
    world=state.blocks;revision=state.physicsRevision;accumulator=waterTime=clock=0;environment=-1;
    state.physicsRuntime=new Map();state.physicsWindLevels=new Map();
    state.kineticRiderOwners=new Map();
    for(const c of state.physicsCells.values())if(c.id===B.WINDMILL)state.physicsWindLevels.set(physicsKey(c.x,c.y,c.z),physicsWindOpenAt(c.x,c.y,c.z));
}
function ready() {
    if(world!==state.blocks||revision!==state.physicsRevision) initPhysicsLab();
}
function runtime(c) {
    const k=physicsKey(c.x,c.y,c.z),map=state.physicsRuntime;
    let r=map.get(k);
    if(!r||r.id!==c.id&&!(isTroughId(r.id)&&isTroughId(c.id))) {
        r={id:c.id,running:false,elapsed:0,distance:0,velocity:0,height:0,angle:0,torque:0,force:0,
            ropeDistance:0,stored:0,phase:0,blocked:false,status:'就绪',powered:redstoneSignalAt(c.x,c.y,c.z),previous:new Map(),measures:new Map()};
        map.set(k,r);
    }
    return r;
}
function cellAt(x,y,z) {
    const id=getBlock(x,y,z);
    return isPhysicsId(id)?{x,y,z,id}:null;
}
function cfg(c) { return physicsDeviceAt(c.x,c.y,c.z,c.id)?.config; }
export function physicsWindOpenAt(x,y,z) {
    for(let dy=1;dy<=3;dy++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++) {
        if(!inBounds(x+dx,y+dy,z+dz)||BlockInfo[getBlock(x+dx,y+dy,z+dz)]?.solid)return false;
    }
    return true;
}
export function physicsDirectionAt(x,y,z,id=getBlock(x,y,z)) {
    if(id===B.WINDMILL)return [0,1,0];
    return BELT_DIRS[physicsDeviceAt(x,y,z,id)?.config.dir??1];
}
export function configurePhysicsAt(x,y,z,patch) {
    ready();const c=cellAt(x,y,z);if(!c)return error('这里没有物理组件');
    if(state.levelRun)return error('闯关中不能修改实验条件');
    const entry=physicsDeviceAt(x,y,z,c.id);if(!entry)return error('物理组件数量已满');
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return error('实验条件无效');
    // 位置和引信仅由世界事务写入，作者不能在面板制造悬空平台或暂停炸弹。
    if(Object.keys(patch).some(k=>['offset','armed','fuse'].includes(k)&&patch[k]!==entry.config[k]))return error('运动状态不能手动修改');
    const next={...entry.config,...patch};
    if(!validPhysicsConfig(c.id,next))return error('实验条件超出范围');
    if(c.id===B.CARRIAGE&&entry.config.offset&&(patch.dir!==undefined||patch.width!==undefined||patch.length!==undefined))
        return error('先让平台回到起点再修改轨道');
    if(c.id===B.CARRIAGE&&[...platformCells(c,next,0),...platformCells(c,next,next.length)].some(p=>!inBounds(p.x,p.y,p.z)))
        return error('轨道行程越出世界边界');
    entry.config=next;state.physicsRuntime.delete(physicsKey(x,y,z));
    if(isPhysicsKineticId(c.id))updateKineticNetwork();
    return ok();
}
export function physicsActionAt(x,y,z,action) {
    ready();const c=cellAt(x,y,z);if(!c)return error('这里没有物理组件');
    const config=cfg(c),r=runtime(c);if(!config)return error('物理组件数量已满');
    if(state.levelRun&&(!config.allowRun||!['start','reset','compress','pull'].includes(action)))return error('作者没有开放这个实验动作');
    if(action==='reset') {
        if([B.CARRIAGE,B.MOTION_TNT,B.FALLING,B.VALVE,B.PUMP,B.FAN,B.WINDMILL].includes(c.id))return error('该组件没有实验复位动作');
        state.physicsRuntime.delete(physicsKey(x,y,z));return ok();
    }
    if(action==='toggle'&&c.id===B.VALVE) {
        if(config.control)return error('当前水闸由红石控制');
        config.open=config.open?0:1;return ok();
    }
    if(action==='ignite'&&c.id===B.MOTION_TNT) {
        if(config.armed)return error('运动 TNT 已经点燃');
        config.armed=true;config.fuse=P.fuse;return ok();
    }
    if(action==='compress'&&c.id===B.SPRING) {
        if(r.running)return error('等物体落稳后再压缩');
        r.stored=P.springCompression[config.compression];r.status='已手动压缩，等待释放';return ok();
    }
    return beginExperiment(c,config,r,action);
}
function beginExperiment(c,config,r,action) {
    const {x,y,z}=c;
    if(!['start','pull'].includes(action)||![B.RAMP,B.LEVER,B.SPRING,B.TEACHING_PULLEY,B.SENSOR].includes(c.id))return error('这个动作不适用于当前组件');
    if(r.running)return error('实验正在运行');
    if([...state.physicsRuntime.values()].filter(v=>v.running).length>=P.maxRunning)return error('同时运行实验数量已满');
    if(c.id===B.SPRING) {
        if(r.stored<=0)return error('先手动压缩弹簧');
        r.height=0;r.velocity=Math.sqrt(P.springK/config.mass)*r.stored*P.springLoss;r.stored=0;
    } else if(c.id===B.RAMP) { r.distance=0;r.velocity=0; }
    else if(c.id===B.TEACHING_PULLEY&&r.height>=config.travel-1e-6)return error('已经到达提升终点，请先复位');
    else if(c.id===B.SENSOR){
        r.previous.clear();r.measures.clear();r.distance=r.velocity=0;
        for(const e of [state.player,...state.itemDrops])r.previous.set(e,sensorPoint(c,config,e,0));
    }
    r.elapsed=0;r.running=true;r.blocked=false;r.status='运行中';return ok();
}
export function physicsInfoAt(x,y,z) {
    ready();const c=cellAt(x,y,z);if(!c)return null;
    const config=cfg(c);if(!config)return null;
    const r=runtime(c);derive(c,config,r);
    return {id:c.id,config:{...config},running:r.running,elapsed:r.elapsed,distance:r.distance,velocity:r.velocity,
        height:r.height,angle:r.angle,torque:r.torque,force:r.force,ropeDistance:r.ropeDistance,stored:r.stored,
        water:isTroughId(c.id)?troughWater(c.id):undefined,blocked:r.blocked,status:r.status,
        ...(isPhysicsKineticId(c.id)?kineticInfoAt(x,y,z):{})};
}
function derive(c,a,r) {
    if(c.id===B.RAMP)r.height=Math.max(0,P.rampLength-r.distance)*Math.sin(P.slopes[a.slope]*Math.PI/180);
    if(c.id===B.LEVER) {
        r.torque=P.gravity*(a.leftMass*(2-a.leftArm-a.pivot)+a.rightMass*(2+a.rightArm-a.pivot));
        r.angle=Math.max(-.35,Math.min(.35,r.torque/(P.gravity*Math.max(1,a.leftMass+a.rightMass))*.25));
        r.force=0;r.status=Math.abs(r.torque)<1e-6?'平衡':'右侧更重 / 左侧更重'.split(' / ')[r.torque<0?1:0];
    }
    if(c.id===B.TEACHING_PULLEY){r.force=a.mass*P.gravity/P.ropeCounts[a.ropes];r.ropeDistance=r.height*P.ropeCounts[a.ropes];}
    if(isTroughId(c.id)) {
        const q=troughWater(c.id),mass=P.floatMass+a.ballast,level=.15+q*.16;
        r.force=q?Math.min(mass,P.floatVolume)*P.gravity:0;
        r.height=!a.float?.15:mass<P.floatVolume&&q?Math.max(.15,level-.12*(mass/P.floatVolume)):.15;
        r.status=!a.float?`${q}/4份水`:mass<P.floatVolume&&q?'轻载漂浮':'加重沉底';
    }
}
function simulateBench(c,a,r,h) {
    derive(c,a,r);
    const signal=redstoneSignalAt(c.x,c.y,c.z);
    if(signal&&!r.powered&&[B.RAMP,B.LEVER,B.SPRING,B.TEACHING_PULLEY].includes(c.id)) {
        if(c.id===B.SPRING)r.stored=P.springCompression[a.compression];
        // 自动动作来自作者电路，只在上升沿输入做功。
        beginExperiment(c,a,r,'start');
    }
    r.powered=signal;
    if(!r.running)return;
    r.elapsed+=h;
    if(c.id===B.RAMP) {
        const slope=r.distance<P.rampLength?P.slopes[a.slope]*Math.PI/180:0,mu=P.friction[a.surface];
        const accel=P.gravity*(Math.sin(slope)-mu*Math.cos(slope));
        const before=r.velocity;r.velocity=Math.max(0,r.velocity+accel*h);
        r.distance=Math.min(P.trackLength,r.distance+(before+r.velocity)*.5*h);
        r.height=Math.max(0,P.rampLength-r.distance)*Math.sin(P.slopes[a.slope]*Math.PI/180);
        if(r.distance>=P.trackLength||r.velocity===0){r.running=false;r.velocity=0;r.status=r.distance>=P.trackLength?'到达轨尾':'摩擦停稳';}
    } else if(c.id===B.SPRING) {
        r.height+=r.velocity*h-.5*P.gravity*h*h;r.velocity-=P.gravity*h;
        const ceiling=BlockInfo[getBlock(c.x,c.y+1,c.z)]?.solid?1:3;
        if(r.height>ceiling){r.height=ceiling;r.velocity=Math.min(0,r.velocity);r.blocked=true;r.status='遇到上方挡板';}
        if(r.height<=0){r.height=0;r.velocity=0;r.running=false;r.status='落稳；再次弹射需重新压缩';}
    } else if(c.id===B.TEACHING_PULLEY) {
        r.height=Math.min(a.travel,r.height+h*.5/P.ropeCounts[a.ropes]);
        r.ropeDistance=r.height*P.ropeCounts[a.ropes];
        if(r.height>=a.travel){r.running=false;r.status='已到提升终点';}
    } else if(c.id===B.LEVER){r.running=false;}
}
function unobstructed(c,point) {
    const [dx,,dz]=BELT_DIRS[c.dir],sx=c.x+.5,sz=c.z+.5;
    const along=(point.x-sx)*dx+(point.z-sz)*dz,lateral=Math.abs((point.x-sx)*dz-(point.z-sz)*dx);
    if(along<=0||along>P.windRange||lateral>.48||Math.abs(point.y-(c.y+.55))>.7)return false;
    // 逐体素穿过真实三维线段，上下层挡板也会遮风；起点风扇和终点试验台不算中途墙。
    const from=[sx,c.y+.55,sz],to=[point.x,point.y,point.z],cell=from.map(Math.floor),end=to.map(Math.floor);
    const delta=to.map((v,i)=>v-from[i]),sign=delta.map(Math.sign);
    const stride=delta.map(v=>v===0?Infinity:Math.abs(1/v));
    const edge=delta.map((v,i)=>v===0?Infinity:(sign[i]>0?cell[i]+1-from[i]:from[i]-cell[i])/Math.abs(v));
    if(!inBounds(...end))return false;
    for(let step=0;step<12;step++) {
        const t=Math.min(...edge);if(t>=1-1e-9)return true;
        for(let i=0;i<3;i++)if(edge[i]<=t+1e-9){cell[i]+=sign[i];edge[i]+=stride[i];}
        if(cell.every((v,i)=>v===end[i]))return true;
        if(BlockInfo[getBlock(...cell)]?.solid)return false;
    }
    return false;
}
function fanTick(c,a,h) {
    const info=kineticInfoAt(c.x,c.y,c.z);if(!info?.rpm)return;
    const fan={...c,dir:a.dir},[dx,,dz]=BELT_DIRS[a.dir],force=P.windForce*info.rpm/P.windRpm;
    for(const d of state.itemDrops) {
        const bx=Math.floor(d.x),by=Math.floor(d.y-BELT_RIDE_Y),bz=Math.floor(d.z);
        if(isBeltId(getBlock(bx,by,bz))&&isBeltRunningAt(bx,by,bz)||!unobstructed(fan,d))continue;
        d.vx=Math.max(-8,Math.min(8,(d.vx||0)+dx*force*h));d.vz=Math.max(-8,Math.min(8,(d.vz||0)+dz*force*h));d.windTimer=.15;
    }
    for(const target of state.physicsCells.values())if(target.id===B.RAMP&&unobstructed(fan,{x:target.x+.5,y:target.y+.55,z:target.z+.5})) {
        const r=runtime(target);
        // 微缩斜坡只沿东西轨道运动；横风不能凭空变成沿轨道的前进力。
        if(!dx)continue;
        if(!r.running&&[...state.physicsRuntime.values()].filter(v=>v.running).length>=P.maxRunning)continue;
        r.velocity=Math.max(0,Math.min(8,r.velocity+dx*force*h/cfg(target).mass));
        if(r.velocity>0)r.running=true;
    }
}
function valveOpen(c,a) {return a.control?redstoneSignalAt(c.x,c.y,c.z):!!a.open;}
function waterTick() {
    const cells=[...state.physicsCells.values()].filter(c=>isTroughId(c.id)).slice(0,P.maxTroughs).sort((a,b)=>a.y-b.y);
    const amounts=new Map(cells.map(c=>[physicsKey(c.x,c.y,c.z),troughWater(getBlock(c.x,c.y,c.z))]));
    const transfer=(s,d,equal=false)=>{
        const sk=physicsKey(s.x,s.y,s.z),dk=physicsKey(d.x,d.y,d.z),sq=amounts.get(sk),dq=amounts.get(dk);
        if(sq===undefined||dq===undefined||sq<=0||dq>=4||equal&&sq-dq<=1)return false;
        amounts.set(sk,sq-1);amounts.set(dk,dq+1);stats.waterTransfers++;return true;
    };
    for(const c of cells) {
        let fell=false;
        for(const [dx,dy,dz] of [[0,-1,0],[1,-1,0],[-1,-1,0],[0,-1,1],[0,-1,-1]])
            if(transfer(c,{x:c.x+dx,y:c.y+dy,z:c.z+dz})){fell=true;break;}
        if(!fell)for(const [dx,dz] of [[1,0],[0,1]]) {
            const to={x:c.x+dx,y:c.y,z:c.z+dz},q=amounts.get(physicsKey(to.x,to.y,to.z));
            if(q===undefined)continue;
            if((amounts.get(physicsKey(c.x,c.y,c.z))||0)>=q)transfer(c,to,true);else transfer(to,c,true);
        }
    }
    for(const c of state.physicsCells.values())if(c.id===B.VALVE) {
        const a=cfg(c);if(!valveOpen(c,a))continue;
        const [dx,,dz]=BELT_DIRS[a.dir],s={x:c.x-dx,y:c.y,z:c.z-dz},d={x:c.x+dx,y:c.y,z:c.z+dz};
        if((amounts.get(physicsKey(s.x,s.y,s.z))||0)>(amounts.get(physicsKey(d.x,d.y,d.z))||0))transfer(s,d,true);else transfer(d,s,true);
    }
    for(const [key,amount] of amounts) {
        const [x,y,z]=key.split(',').map(Number),id=troughId(amount);
        if(getBlock(x,y,z)!==id){setBlockSafe(x,y,z,id,{physicsWaterTransfer:true});refreshPropAt(x,y,z);}
    }
}
function pumpTick(c,a,r,h) {
    const rpm=kineticInfoAt(c.x,c.y,c.z)?.rpm||0,[dx,,dz]=BELT_DIRS[a.dir];
    const source={x:c.x-dz,y:c.y,z:c.z+dx},dest={x:c.x+dx,y:c.y+a.lift,z:c.z+dz};
    const sq=troughWater(getBlock(source.x,source.y,source.z)),dq=troughWater(getBlock(dest.x,dest.y,dest.z));
    r.status=!rpm?'没有动力':sq<0||dq<0?'连接侧方进水槽与前方出水槽':sq===0?'进水槽无水':dq===4?'出水槽已满':'抽水中';
    r.running=!!rpm&&sq>0&&dq>=0&&dq<4;
    if(!r.running)return;
    r.phase+=h*rpm/P.windRpm;
    if(r.phase+1e-9<P.pumpSeconds)return;
    r.phase-=P.pumpSeconds;
    setBlockSafe(source.x,source.y,source.z,troughId(sq-1),{physicsWaterTransfer:true});setBlockSafe(dest.x,dest.y,dest.z,troughId(dq+1),{physicsWaterTransfer:true});
    refreshPropAt(source.x,source.y,source.z);refreshPropAt(dest.x,dest.y,dest.z);stats.waterTransfers++;
}
function platformCells(c,a,offset=a.offset) {
    const [dx,,dz]=BELT_DIRS[a.dir],out=[];
    for(let t=-(a.width>>1);t<=a.width>>1;t++)out.push({x:c.x+dx*offset-dz*t,y:c.y+1,z:c.z+dz*offset+dx*t});
    return out;
}
function carriageTick(c,a,r,h,owners) {
    const rpm=kineticInfoAt(c.x,c.y,c.z)?.rpm||0;
    r.running=false;
    if(!rpm){r.status='没有动力，平台悬停';return;}
    const direction=redstoneSignalAt(c.x,c.y,c.z)?-1:1,next=a.offset+direction;
    if(next<0||next>a.length){r.status='行程端点';return;}
    r.phase+=h*P.carriageSpeed*rpm/P.windRpm;if(r.phase+1e-9<1)return;
    r.phase=Math.min(r.phase,1);
    const old=platformCells(c,a),dest=platformCells(c,a,next),oldKeys=new Set(old.map(p=>physicsKey(p.x,p.y,p.z)));
    if(old.some(p=>getBlock(p.x,p.y,p.z)!==PLATFORM_BASE)) {a.offset=0;r.phase=0;r.status='平台损坏，已安全解绑；补齐起点平台可恢复';r.blocked=true;return;}
    if(dest.some(p=>!inBounds(p.x,p.y,p.z)||!isSolid(getBlock(p.x,p.y-1,p.z))||
        !oldKeys.has(physicsKey(p.x,p.y,p.z))&&getBlock(p.x,p.y,p.z)!==T.AIR)) {r.status='轨道或平台前方受阻';r.blocked=true;return;}
    const [dx,,dz]=BELT_DIRS[a.dir],n=[dx*direction,0,dz*direction];
    const plan=planStructureRiderMove(old,dest,n,owners,physicsKey(c.x,c.y,c.z));
    if(!plan){r.status='乘客或前方空间受阻';r.blocked=true;return;}
    for(const p of old)setBlockSafe(p.x,p.y,p.z,T.AIR);
    for(const p of dest)setBlockSafe(p.x,p.y,p.z,PLATFORM_BASE);
    a.offset=next;commitRiderMove(plan);r.phase-=1;r.blocked=false;r.running=true;r.status='平台运行';stats.platformSteps++;
    let popped=false;
    for(const p of old)if(popUnsupportedRedstone(p.x,p.y,p.z).length)popped=true;
    if(!popped&&[...old,...dest].some(p=>hasRedstoneNear(p.x,p.y,p.z)))updateRedstoneNetwork();
    rebuildMovedCells([...old,...dest]);
}
function rebuildMovedCells(cells) {
    const chunks=new Set(),cols=Math.ceil(WORLD_WIDTH/CHUNK_SIZE),rows=Math.ceil(WORLD_DEPTH/CHUNK_SIZE);
    const add=(x,z)=>{if(x>=0&&z>=0&&x<cols&&z<rows)chunks.add(`${x},${z}`);};
    for(const p of cells) {
        const cx=Math.floor(p.x/CHUNK_SIZE),cz=Math.floor(p.z/CHUNK_SIZE);add(cx,cz);
        if(p.x%CHUNK_SIZE===0)add(cx-1,cz);
        if(p.x%CHUNK_SIZE===CHUNK_SIZE-1)add(cx+1,cz);
        if(p.z%CHUNK_SIZE===0)add(cx,cz-1);
        if(p.z%CHUNK_SIZE===CHUNK_SIZE-1)add(cx,cz+1);
    }
    for(const key of chunks){const [cx,cz]=key.split(',').map(Number);rebuildChunk(cx,cz);}
}
function occupant(x,y,z) {
    const overlaps=(e,half,height)=>e.x+half>x&&e.x-half<x+1&&e.z+half>z&&e.z-half<z+1&&e.y+height>y&&e.y<y+1;
    return !state.player.dead&&overlaps(state.player,PLAYER_WIDTH/2,PLAYER_HEIGHT)||
        state.enemies.some(e=>overlaps(e,.35,e.hostile===false?1.1:1.8));
}
function fallingTick(c,a,r,h) {
    const signal=redstoneSignalAt(c.x,c.y,c.z);
    if(c.id===B.MOTION_TNT&&!a.armed&&signal&&!r.powered){a.armed=true;a.fuse=P.fuse;}
    r.powered=signal;
    if(c.id===B.MOTION_TNT&&a.armed) {
        a.fuse=Math.max(0,a.fuse-h);
        if(a.fuse<=1e-8){setBlockSafe(c.x,c.y,c.z,T.AIR);explode(c.x,c.y,c.z);return;}
    }
    const below=getBlock(c.x,c.y-1,c.z);
    if(c.y<=0||below!==T.AIR&&below!==T.WATER||occupant(c.x,c.y-1,c.z)){r.velocity=0;r.phase=0;r.blocked=true;return;}
    r.velocity=Math.min(12,r.velocity+P.gravity*h);r.phase+=r.velocity*h*(below===T.WATER?.2:1);
    if(r.phase<1)return;
    const sourceKey=physicsKey(c.x,c.y,c.z),destKey=physicsKey(c.x,c.y-1,c.z),entry=physicsData().devices[sourceKey];
    setBlockSafe(c.x,c.y,c.z,below);setBlockSafe(c.x,c.y-1,c.z,c.id);
    physicsData().devices[destKey]=entry;entry.id=c.id;r.phase-=1;
    state.physicsRuntime.delete(sourceKey);state.physicsRuntime.set(destKey,r);
    const popped=popUnsupportedRedstone(c.x,c.y,c.z).length;
    if(!popped&&(hasRedstoneNear(c.x,c.y,c.z)||hasRedstoneNear(c.x,c.y-1,c.z)))updateRedstoneNetwork();
    if(below===T.WATER&&isWaterwheelId(getBlock(c.x,c.y-2,c.z)))updateKineticNetwork();
    rebuildMovedCells([c]);
}
function sensorPoint(c,a,e,time) {
    const [dx,,dz]=BELT_DIRS[a.dir],x=e.x-c.x-.5,z=e.z-c.z-.5;
    return {along:x*dx+z*dz,side:x*dz-z*dx,height:e.y,time};
}
function sensorTick(c,a,r,h) {
    if(!r.running)return;
    r.elapsed+=h;
    const entities=[state.player,...state.itemDrops];
    for(const e of entities) {
        const point=sensorPoint(c,a,e,r.elapsed),{along}=point;
        const old=r.previous.get(e);
        if(old) {
            const delta=along-old.along;
            if(delta>1e-8) {
                for(const plane of [-.4,.4])if(old.along<plane&&along>=plane) {
                    const f=(plane-old.along)/delta,side=old.side+(point.side-old.side)*f,height=old.height+(point.height-old.height)*f;
                    if(Math.abs(side)>=.6||height<c.y||height>=c.y+2){r.measures.delete(e);continue;}
                    const t=old.time+(r.elapsed-old.time)*f;
                    if(plane<0)r.measures.set(e,t);
                    else if(r.measures.has(e)){
                        r.elapsedMeasurement=t-r.measures.get(e);
                        if(r.elapsedMeasurement>1e-9){r.distance=.8;r.velocity=.8/r.elapsedMeasurement;r.status=`测速 ${r.velocity.toFixed(2)} 格/秒 · ${r.elapsedMeasurement.toFixed(3)} 秒`;}
                        r.measures.delete(e);
                    }
                }
            }
        }
        r.previous.set(e,point);
    }
    // 已消失掉落物不保持强引用。
    const active=new Set(entities);
    for(const e of r.previous.keys())if(!active.has(e)){r.previous.delete(e);r.measures.delete(e);}
}
export function physicsBucketAt(x,y,z,heldId) {
    ready();const id=getBlock(x,y,z);if(!isTroughId(id))return error('请对准实验水槽');
    if(state.levelRun)return error('闯关中不能取放实验水');
    const q=troughWater(id),pour=heldId===LifeItems.WATER_BUCKET,take=heldId===LifeItems.BUCKET;
    if(!pour&&!take)return error('需要手持水桶');
    if(pour&&q!==0||take&&q!==4)return error('整桶交换需要空槽或满槽；零散水先汇满');
    const out=pour?LifeItems.BUCKET:LifeItems.WATER_BUCKET;
    if(!isCreative()) {
        if(!(state.player.inventory[heldId]>0))return error('没有可用的水桶');
        if(inventoryCapacity(out)<1)return error('背包中没有空间接收水桶');
        takeInventoryStack(heldId,1);addInventoryStack({id:out,count:1});
    }
    const barIndex=state.player.quickbar?.indexOf(heldId)??-1;
    if(barIndex>=0)state.player.quickbar[barIndex]=out;
    // 与普通湖水取放一致：换到操作后的桶，连续两次X可注水再取回。
    if(state.player.selectedSlot===HotbarBlocks.indexOf(heldId))state.player.selectedSlot=HotbarBlocks.indexOf(out);
    setBlockSafe(x,y,z,troughId(pour?4:0),{physicsWaterTransfer:true});refreshPropAt(x,y,z);return ok();
}
function visuals() {
    for(const prop of state.droppedItems) {
        if(!prop.prop)continue;
        const c=state.physicsCells.get(physicsKey(prop.x,prop.y,prop.z));if(!c)continue;
        const r=runtime(c),a=cfg(c),mesh=prop.mesh;derive(c,a,r);
        const visualConfig=c.id===B.VALVE?{...a,open:valveOpen(c,a)}:a;
        updatePhysicsMesh(mesh,c.id,visualConfig,r,clock,kineticInfoAt(c.x,c.y,c.z)?.rpm||0);
    }
}
export function tickPhysicsLab(dt,{deferSensors=false}={}) {
    ready();if(!state.physicsCells.size||isWorldPaused())return;
    const frame=Math.max(0,Math.min(P.maxFrame,Number.isFinite(dt)?dt:0));
    accumulator+=frame;
    if(environment!==state.physicsEnvironment) {
        environment=state.physicsEnvironment;let dirty=false;
        for(const c of state.physicsCells.values())if(c.id===B.WINDMILL) {
            const k=physicsKey(c.x,c.y,c.z),open=physicsWindOpenAt(c.x,c.y,c.z);
            if(state.physicsWindLevels.get(k)!==open){state.physicsWindLevels.set(k,open);dirty=true;}
        }
        if(dirty)updateKineticNetwork();
    }
    const owners=state.kineticRiderOwners||new Map();
    while(accumulator+1e-9>=P.step) {
        const h=P.step;accumulator-=h;clock+=h;waterTime+=h;stats.steps++;
        for(const c of [...state.physicsCells.values()]) {
            if(getBlock(c.x,c.y,c.z)!==c.id)continue;
            const a=cfg(c),r=runtime(c);if(!a)continue;
            if(c.id===B.FAN)fanTick(c,a,h);
            else if(c.id===B.PUMP)pumpTick(c,a,r,h);
            else if(c.id===B.CARRIAGE)carriageTick(c,a,r,h,owners);
            else if(c.id===B.FALLING||c.id===B.MOTION_TNT)fallingTick(c,a,r,h);
            else if(c.id===B.SENSOR)continue;
            else if(!isTroughId(c.id))simulateBench(c,a,r,h);
        }
        if(waterTime+1e-9>=P.waterStep){waterTime-=P.waterStep;waterTick();}
    }
    // 测速只采一次真实帧位移，用越面插值计时；固定子步不能重复读取同一个实体终点。
    if(!deferSensors)samplePhysicsSensors(frame);
    visuals();
}
export function samplePhysicsSensors(dt) {
    if(!state.physicsCells?.size||isWorldPaused())return;
    const frame=Math.max(0,Math.min(P.maxFrame,Number.isFinite(dt)?dt:0));
    for(const c of state.physicsCells.values())if(c.id===B.SENSOR)sensorTick(c,cfg(c),runtime(c),frame);
}
export function physicsDiagnostics(){return {...stats,cells:state.physicsCells?.size||0,runtime:state.physicsRuntime?.size||0,windLevels:state.physicsWindLevels?.size||0};}
