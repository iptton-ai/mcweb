// 可保存物理配置：只依赖数据，世界写入口/普通档/快照/关卡共用。
import { state } from './state.js';
import { PhysicsBlocks as B, PHYSICS as P, PLATFORM_BASE, BlockInfo, isPhysicsId, isTroughId, troughWater, WORLD_WIDTH, WORLD_HEIGHT, WORLD_DEPTH } from './config.js';

export const physicsKey=(x,y,z)=>`${x},${y},${z}`;
export function physicsDefaults(id) {
    const common={allowRun:false};
    if (isTroughId(id)) return {...common,float:0,ballast:0};
    switch(id) {
        case B.RAMP:return {...common,slope:2,surface:1,mass:1};
        case B.LEVER:return {...common,pivot:2,leftMass:1,rightMass:1,leftArm:1,rightArm:1};
        case B.SPRING:return {...common,mass:1,compression:2};
        case B.TEACHING_PULLEY:return {...common,mass:2,ropes:0,travel:1};
        case B.FAN:return {...common,dir:1};
        case B.SENSOR:return {...common,dir:1};
        case B.VALVE:return {...common,dir:1,open:0,control:0};
        case B.PUMP:return {...common,dir:1,lift:1};
        case B.CARRIAGE:return {...common,dir:1,width:3,length:4,offset:0};
        case B.WINDMILL:return common;
        case B.FALLING:return common;
        case B.MOTION_TNT:return {...common,armed:false,fuse:P.fuse};
        default:return {};
    }
}
export function normalizePhysicsConfig(id,config={}) {
    return {...physicsDefaults(id),...config};
}
const ranges={allowRun:[0,1],slope:[0,3],surface:[0,2],mass:[1,4],pivot:[1,3],leftMass:[0,4],rightMass:[0,4],
    leftArm:[1,2],rightArm:[1,2],compression:[1,3],ropes:[0,2],travel:[1,3],dir:[0,3],open:[0,1],control:[0,1],
    lift:[0,4],width:[1,3],length:[1,P.maxTravel],offset:[0,P.maxTravel],float:[0,1],ballast:[0,4],armed:[0,1],fuse:[0,P.fuse]};
export function validPhysicsConfig(id,config) {
    if(!config||typeof config!=='object'||Array.isArray(config))return false;
    const defaults=physicsDefaults(id);
    for(const [key,value] of Object.entries(config)) {
        if(!Object.hasOwn(defaults,key))return false;
        if(['allowRun','armed'].includes(key)&&typeof value==='boolean')continue;
        if(!Object.hasOwn(defaults,key)||!Number.isFinite(value))return false;
        const [lo,hi]=ranges[key];
        if(value<lo||value>hi||key!=='fuse'&&!Number.isInteger(value)||key==='width'&&value!==1&&value!==3)return false;
    }
    const c={...defaults,...config};
    return c.offset===undefined||c.offset<=c.length;
}
export function resetPhysicsData(raw) {
    state.physics={v:1,devices:raw?.devices?JSON.parse(JSON.stringify(raw.devices)):{}};
    for(const entry of Object.values(state.physics.devices))entry.config=normalizePhysicsConfig(entry.id,entry.config);
    state.physicsCells=new Map();
    state.physicsRuntime?.clear();state.physicsWindLevels?.clear();
    state.physicsWorld=state.blocks;
    state.physicsRevision=(state.physicsRevision||0)+1;
    state.physicsPanel=null;
}
export function physicsData() { if(!state.physics)resetPhysicsData();return state.physics; }
export function physicsDeviceAt(x,y,z,id) {
    const d=physicsData(),key=physicsKey(x,y,z);
    if(!isPhysicsId(id))return null;
    let entry=d.devices[key];
    if(!entry&&Object.keys(d.devices).length<P.maxDevices)entry=d.devices[key]={id,config:physicsDefaults(id)};
    return entry||null;
}
export function onPhysicsBlockChanged(x,y,z,oldId,newId,{physicsWaterTransfer=false}={}) {
    // 任何实体方块写入均使风车局部环境版本变化；tick只在变更后复查。
    if(!!BlockInfo[oldId]?.solid!==!!BlockInfo[newId]?.solid||oldId!==newId&&(oldId===B.WINDMILL||newId===B.WINDMILL))
        state.physicsEnvironment=(state.physicsEnvironment||0)+1;
    if(!isPhysicsId(oldId)&&!isPhysicsId(newId))return;
    if(state.physicsWorld!==state.blocks)resetPhysicsData();
    const d=physicsData(),k=physicsKey(x,y,z);
    const waterUpdate=physicsWaterTransfer&&isTroughId(oldId)&&isTroughId(newId);
    if(oldId!==newId&&!waterUpdate)delete d.devices[k];
    if(!waterUpdate)state.physicsRuntime?.delete(k);
    if(oldId!==newId)state.physicsWindLevels?.delete(k);
    // 带水槽被覆盖/炸掉也返原水量的完整槽，不能把零散水变整桶；作者删除为显式弃置。
    if(isTroughId(oldId)&&troughWater(oldId)>0&&!waterUpdate&&!state.levelRun&&!state.levelEdit)
        (state.lifePendingDrops||=[]).push({x:x+.5,y:y+.5,z:z+.5,stack:{id:oldId,count:1}});
    state.physicsCells.delete(k);
    if(isPhysicsId(newId)) {
        const entry=physicsDeviceAt(x,y,z,newId);
        if(entry){entry.id=newId;state.physicsCells.set(k,{x,y,z,id:newId});}
    }
}
export function physicsPlacementError(x,y,z,id) {
    if(!isPhysicsId(id)||state.physicsWorld!==state.blocks)return null;
    const cells=state.physicsCells;if(!cells)return null;
    const old=cells.get(physicsKey(x,y,z));
    if(!old&&cells.size>=P.maxDevices)return '物理装置数量已达上限';
    if(isTroughId(id)&&!isTroughId(old?.id)&&[...cells.values()].filter(c=>isTroughId(c.id)).length>=P.maxTroughs)return '实验水槽数量已达上限';
    return null;
}
export function rebuildPhysicsIndex() {
    const old=physicsData().devices,devices={},cells=new Map(),blocks=state.blocks;
    if(blocks)for(let i=0;i<blocks.length;i++) {
        const id=blocks[i];if(!isPhysicsId(id)||cells.size>=P.maxDevices)continue;
        const x=i%WORLD_WIDTH,z=Math.floor(i/WORLD_WIDTH)%WORLD_DEPTH,y=Math.floor(i/(WORLD_WIDTH*WORLD_DEPTH));
        const key=physicsKey(x,y,z),prior=old[key];
        devices[key]=prior?.id===id&&validPhysicsConfig(id,prior.config)?{id,config:normalizePhysicsConfig(id,prior.config)}:{id,config:physicsDefaults(id)};
        cells.set(key,{x,y,z,id});
    }
    state.physics={v:1,devices};state.physicsCells=cells;state.physicsWorld=blocks;
    state.physicsRevision=(state.physicsRevision||0)+1;
}
export function capturePhysicsState(region) {
    const devices={};
    for(const [k,entry] of Object.entries(physicsData().devices)) {
        const [x,y,z]=k.split(',').map(Number);
        if(state.blocks?.[x+z*WORLD_WIDTH+y*WORLD_WIDTH*WORLD_DEPTH]!==entry.id)continue;
        if(region&&(x<region.x0||x>=region.x0+region.w||y<region.y0||y>=region.y0+region.h||z<region.z0||z>=region.z0+region.d))continue;
        const key=region?physicsKey(x-region.x0,y-region.y0,z-region.z0):k;
        const config={...entry.config};
        // 合法拆坏的机构安全解绑，不能阻塞整世界保存；外来伪造偏移仍由导入校验拒绝。
        if(entry.id===B.CARRIAGE&&config.offset&&!carriageMatches(x,y,z,config,state.blocks,[WORLD_WIDTH,WORLD_HEIGHT,WORLD_DEPTH]))config.offset=0;
        devices[key]={id:entry.id,config};
    }
    return {v:1,devices};
}
export function validatePhysicsState(raw,blocks,dims=[WORLD_WIDTH,WORLD_HEIGHT,WORLD_DEPTH]) {
    let count=0,troughs=0;
    for(const id of blocks)if(isPhysicsId(id)){count++;if(isTroughId(id))troughs++;}
    if(count>P.maxDevices||troughs>P.maxTroughs)return '物理装置或水槽数量超限';
    if(raw===undefined)return null;
    if(!raw||raw.v!==1||!raw.devices||typeof raw.devices!=='object'||Array.isArray(raw.devices)||
        Object.keys(raw).some(k=>!['v','devices'].includes(k))||Object.keys(raw.devices).length>P.maxDevices)return '物理配置格式或数量无效';
    const [w,h,d]=dims;
    for(const [key,entry] of Object.entries(raw.devices)) {
        if(!/^\d+,\d+,\d+$/.test(key))return '物理装置坐标无效';
        const [x,y,z]=key.split(',').map(Number);
        if(physicsKey(x,y,z)!==key)return '物理装置坐标无效';
        if(x>=w||y>=h||z>=d||!entry||!isPhysicsId(entry.id)||blocks[x+z*w+y*w*d]!==entry.id||
            Object.keys(entry).some(k=>!['id','config'].includes(k))||!validPhysicsConfig(entry.id,entry.config))return '物理配置与地形不匹配';
        if(entry.id===B.CARRIAGE&&(entry.config.offset||0)>0&&!carriageMatches(x,y,z,{...physicsDefaults(entry.id),...entry.config},blocks,dims))return '移动平台位置与配置不匹配';
    }
    return null;
}
function carriageMatches(x,y,z,c,blocks,[w,h,d]) {
    const dirs=[[0,-1],[1,0],[0,1],[-1,0]],v=dirs[c.dir];
    for(let t=-(c.width>>1);t<=c.width>>1;t++) {
        const px=x+v[0]*c.offset-v[1]*t,pz=z+v[1]*c.offset+v[0]*t;
        if(px<0||pz<0||px>=w||pz>=d||y+1>=h||blocks[px+pz*w+(y+1)*w*d]!==PLATFORM_BASE)return false;
    }
    return true;
}
export function restorePhysicsState(raw,offset) {
    if(!offset){resetPhysicsData(raw);return;}
    const devices={};
    for(const [key,value] of Object.entries(raw?.devices||{})) {
        const [x,y,z]=key.split(',').map(Number);
        devices[physicsKey(x+offset.x,y+offset.y,z+offset.z)]=JSON.parse(JSON.stringify(value));
    }
    resetPhysicsData({devices});
}
