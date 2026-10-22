// 实验装置的统一键鼠面板；开始后收起，让普通生存离开阅读暂停再推进实验。
import { PhysicsBlocks as B, PHYSICS as P, BlockInfo, isTroughId } from './config.js';
import { state } from './state.js';
import { getUIState, setState } from './uiModal.js';
import { uiKick } from './uiKeys.js';
import { physicsInfoAt, configurePhysicsAt, physicsActionAt } from './physicsLab.js';
let root,readout;
const definitions={
    slope:['坡度',P.slopes.map((v,i)=>[i,`${v}°`])],surface:['表面',[[0,'光滑'],[1,'普通'],[2,'粗糙']]],
    mass:['物体质量',[[1,'1'],[2,'2'],[3,'3'],[4,'4']]],pivot:['支点槽位',[[1,'靠左'],[2,'中央'],[3,'靠右']]],
    leftMass:['左砝码',Array.from({length:5},(_,i)=>[i,String(i)])],rightMass:['右砝码',Array.from({length:5},(_,i)=>[i,String(i)])],
    leftArm:['左砝码离中点',[[1,'1格'],[2,'2格']]],rightArm:['右砝码离中点',[[1,'1格'],[2,'2格']]],
    compression:['压缩档位',[[1,'轻压'],[2,'中压'],[3,'深压']]],ropes:['教学绳路',[[0,'定滑轮 · 1段承重绳'],[1,'动滑轮 · 2段承重绳'],[2,'滑轮组 · 4段承重绳']]],
    travel:['提升高度',[[1,'1'],[2,'2'],[3,'3']]],dir:['朝向',[[0,'北'],[1,'东'],[2,'南'],[3,'西']]],
    open:['阀门状态',[[0,'关闭'],[1,'开启']]],control:['阀门控制',[[0,'手动'],[1,'红石有电开启']]],
    lift:['泵扬程',Array.from({length:5},(_,i)=>[i,`${i}格`])],width:['平台宽度',[[1,'1格'],[3,'3格']]],
    length:['往返行程',Array.from({length:P.maxTravel},(_,i)=>[i+1,`${i+1}格`])],
    float:['标准浮块',[[0,'移出实验'],[1,'放入水槽']]],ballast:['浮块配重',Array.from({length:5},(_,i)=>[i,String(i)])],
    allowRun:['关卡手动实验',[[0,'不开放'],[1,'允许开始 / 压缩 / 拉绳 / 复位']]],
};
function ensure() {
    if(root)return;
    const style=document.createElement('style');
    style.textContent='#physics-panel{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:135;background:#071824bb;padding:16px;box-sizing:border-box}#physics-panel.open{display:flex}.physics-card{font:16px/1.6 system-ui;background:#193745;color:#eef5e7;border:2px solid #75c6be;border-radius:18px;padding:22px;width:min(760px,100%);max-height:88vh;overflow:auto;box-sizing:border-box}.physics-card h2{margin:0 0 8px}.physics-card p{margin:10px 0}.physics-card button,.physics-card select{font:inherit;background:#2c5662;color:#fff;border:1px solid #8cc8c1;border-radius:6px;padding:9px 12px;margin:5px;cursor:pointer}.physics-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px}.physics-fields label{display:flex;align-items:center;justify-content:space-between}.physics-fields select{max-width:70%}.physics-readout{font-variant-numeric:tabular-nums;padding:12px;border-radius:10px;background:#0b2634;white-space:pre-wrap}.physics-note{color:#c8d9ca}';
    document.head.appendChild(style);root=document.createElement('div');root.id='physics-panel';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');document.body.appendChild(root);
}
export function openPhysicsPanel(x,y,z) {
    const info=physicsInfoAt(x,y,z);if(!info)return false;
    ensure();state.physicsPanel={x,y,z,world:state.blocks,id:info.id};setState('physics');renderPhysicsPanel();uiKick();return true;
}
export function closePhysicsPanel(){state.physicsPanel=null;root?.classList.remove('open');if(getUIState()==='physics')setState('playing');}
function button(parent,text,action) {
    const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>{
        const t=state.physicsPanel;if(!t||t.world!==state.blocks)return closePhysicsPanel();
        const result=physicsActionAt(t.x,t.y,t.z,action);
        if(result.ok&&['start','pull','ignite'].includes(action))closePhysicsPanel();else {renderPhysicsPanel(result.error||'操作完成');uiKick();}
    };parent.appendChild(b);return b;
}
function renderPhysicsPanel(message='') {
    const t=state.physicsPanel,info=t&&physicsInfoAt(t.x,t.y,t.z);if(!info)return closePhysicsPanel();
    ensure();root.innerHTML='';root.classList.add('open');const card=document.createElement('section');card.className='physics-card';root.appendChild(card);
    const close=document.createElement('button');close.type='button';close.textContent='收起 E / Esc / Q';close.style.float='right';close.onclick=closePhysicsPanel;card.appendChild(close);
    const h=document.createElement('h2');h.textContent=BlockInfo[info.id].name;card.appendChild(h);
    const note=document.createElement('p');note.className='physics-note';
    note.textContent=isTroughId(info.id)?'实验槽每格4份水=1桶；零散水先汇满再取。复位只复位浮块，不恢复水量。':
        [B.RAMP,B.LEVER,B.SPRING,B.TEACHING_PULLEY].includes(info.id)?'这是单格微缩实验，标准物体和砝码不进背包，也不承载玩家。数值采用游戏单位；修改一个条件后复位、比较结果。':
        info.id===B.PUMP?'背后接传动轴，侧面接进水槽；前方按扬程放出水槽。每次搬1份现有水，断动力停机。':
        info.id===B.CARRIAGE?'背后接轴；驱动器上方摆1或3格宽电梯平台，沿箭头铺实心导轨地板。有红石回程、无红石去程，遇人或障碍停机。':
        info.id===B.WINDMILL?'固定竖轴，下方接轴。上方3层、水平5×5保持开阔，输出简化游戏风动力。':
        info.id===B.FAN?'背后接轴，箭头方向6格内推动掉落物或标准试验物体；实心墙遮风，传送带优先运输。':
        info.id===B.SENSOR?'点击开始后，沿朝向穿过本格的两道测速面（相距0.8格）。计时使用实际越面位置与时间；支持玩家与掉落物。':
        info.id===B.MOTION_TNT?'独立运动 TNT 会下落；点燃后2.5秒在当前位置爆炸。请留出安全距离。原有 TNT 保持原规则。':
        info.id===B.FALLING?'只有实验落块受重力，普通沙砾保持原样；下方有人时停止，落水减速。':'关闭时两端隔槽不通，开启后按水量均衡。红石模式下手动状态让位于信号。';
    card.appendChild(note);
    const fields=document.createElement('div');fields.className='physics-fields';card.appendChild(fields);
    for(const [key,value] of Object.entries(info.config)) {
        if(!definitions[key])continue;const [name,options]=definitions[key];
        const label=document.createElement('label');label.appendChild(document.createTextNode(name));
        const select=document.createElement('select');select.setAttribute('aria-label',name);select.dataset.physicsField=key;
        for(const [v,text] of options){const option=document.createElement('option');option.value=String(v);option.textContent=text;select.appendChild(option);}
        select.value=String(typeof value==='boolean'?Number(value):value);select.disabled=!!state.levelRun;
        select.onchange=()=>{const patch={[key]:key==='allowRun'?select.value==='1':Number(select.value)};const result=configurePhysicsAt(t.x,t.y,t.z,patch);renderPhysicsPanel(result.error||'条件已更新，实验已停止');uiKick();};
        label.appendChild(select);fields.appendChild(label);
    }
    readout=document.createElement('p');readout.className='physics-readout';readout.setAttribute('role','status');card.appendChild(readout);
    const msg=document.createElement('p');msg.textContent=message;card.appendChild(msg);
    const buttons=document.createElement('div');card.appendChild(buttons);
    const canRun=!state.levelRun||info.config.allowRun;
    if([B.RAMP,B.LEVER,B.SPRING,B.TEACHING_PULLEY,B.SENSOR].includes(info.id)) {
        if(info.id===B.SPRING)button(buttons,'手动压缩','compress').disabled=!canRun;
        button(buttons,info.id===B.SPRING?'释放弹簧并观察':info.id===B.TEACHING_PULLEY?'拉绳并观察':'开始实验并观察',info.id===B.TEACHING_PULLEY?'pull':'start').disabled=!canRun;
        button(buttons,'复位实验','reset').disabled=!canRun;
    }
    if(isTroughId(info.id))button(buttons,'复位浮块','reset').disabled=!canRun;
    if(info.id===B.VALVE)button(buttons,'开关水闸','toggle').disabled=!!state.levelRun||!!info.config.control;
    if(info.id===B.MOTION_TNT)button(buttons,'点燃运动 TNT','ignite').disabled=!!state.levelRun||!!info.config.armed;
    if(state.levelRun&&!canRun){const p=document.createElement('p');p.textContent='作者没有开放手动实验；请用关卡中的知识锁与电路。';card.appendChild(p);}
    syncPhysicsPanel();
}
export function syncPhysicsPanel() {
    if(!root)return;
    const t=state.physicsPanel;
    if(getUIState()!=='physics'){root.classList.remove('open');state.physicsPanel=null;return;}
    const info=t?.world===state.blocks&&physicsInfoAt(t.x,t.y,t.z);
    if(!info)return closePhysicsPanel();
    if(info.id!==t.id&&!(isTroughId(info.id)&&isTroughId(t.id)))return closePhysicsPanel();
    if(readout)readout.textContent=`${info.status}${info.rpm!==undefined?` · ${info.rpm} RPM · ${info.load}/${info.capacity} SU`:''}\n`+
        (isTroughId(info.id)?`水量 ${info.water}/4份 · 浮块高度 ${info.height.toFixed(2)}`:
        info.id===B.CARRIAGE?`平台位置 ${info.config.offset}/${info.config.length}格`:
        info.id===B.MOTION_TNT?info.config.armed?`引信 ${info.config.fuse.toFixed(2)}秒`:'未点燃':
        info.id===B.LEVER?`净力矩 ${info.torque.toFixed(2)} · 支点槽位 ${info.config.pivot} · ${info.status}`:
        `时间 ${info.elapsed.toFixed(2)}秒 · 距离 ${info.distance.toFixed(2)} · 速度 ${info.velocity.toFixed(2)}\n高度 ${info.height.toFixed(2)} · 拉力 ${info.force.toFixed(2)} · 拉绳距离 ${info.ropeDistance.toFixed(2)}`);
}
