// 单格微缩实验装置，共享几何/材质；运动只改节点变换，建拆不持续分配GPU资源。
import * as THREE from 'three';
import { PhysicsBlocks as B, PHYSICS as P, isTroughId, troughWater, BlockInfo } from './config.js';
const geometry=new THREE.BoxGeometry(1,1,1),materials=new Map();
function material(color,transparent=false) {
    const key=color+transparent;
    if(!materials.has(key))materials.set(key,new THREE.MeshLambertMaterial({color,transparent,opacity:transparent?.68:1}));
    return materials.get(key);
}
function box(parent,name,size,pos,color,transparent=false) {
    const m=new THREE.Mesh(geometry,material(color,transparent));m.name=name;
    m.scale.set(...size);m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
export function buildPhysicsMesh(id) {
    const g=new THREE.Group(),wood='#966c43',metal='#b5c7c9',gold='#e8c56e',color=BlockInfo[id].color;
    if(isTroughId(id)) {
        box(g,'',[.94,.12,.94],[0,.06,0],metal);
        for(const x of [-.46,.46])box(g,'',[.06,.75,.94],[x,.49,0],'#a9e5e9',true);
        for(const z of [-.46,.46])box(g,'',[.94,.75,.06],[0,.49,z],'#a9e5e9',true);
        const q=troughWater(id);if(q)box(g,'lab_water',[.82,q*.16,.82],[0,.12+q*.08,0],'#459cdd',true);
        box(g,'lab_body',[.28,.16,.28],[0,.7,0],wood).visible=false;
        return g;
    }
    box(g,'',[.94,.2,.94],[0,.1,0],wood);
    for(const x of [-.36,.36])for(const z of [-.36,.36])box(g,'',[.1,.25,.1],[x,.3,z],metal);
    box(g,'',[.9,.12,.9],[0,.47,0],color);
    if(id===B.RAMP) {
        const slope=new THREE.Group();slope.name='lab_ramp';g.add(slope);
        for(const [i,c] of ['#7acee4','#b5c7c9','#926748'].entries())box(slope,'lab_surface_'+i,[.54,.035,.5],[0,0,0],c);
        box(g,'',[.48,.035,.5],[.14,.6,0],metal);
        for(const z of [-.36,.36])box(g,'',[.9,.08,.06],[0,.58,z],gold);
        box(g,'lab_body',[.13,.13,.2],[-.38,.74,0],gold);
        for(const x of [-.32,.32])box(g,'',[.025,.2,.65],[x,.7,0],'#69e8ca',true);
    } else if(id===B.LEVER) {
        box(g,'lab_pivot',[.12,.14,.22],[0,.57,0],gold);
        const beam=new THREE.Group();beam.name='lab_beam';beam.position.y=.64;g.add(beam);
        box(beam,'lab_beam_board',[.8,.05,.3],[0,0,0],metal);
        box(beam,'lab_left_weight',[.16,.12,.16],[-.3,.08,0],wood);
        box(beam,'lab_right_weight',[.16,.12,.16],[.3,.08,0],wood);
    } else if(id===B.SPRING) {
        const spring=new THREE.Group();spring.name='lab_spring';spring.position.y=.52;g.add(spring);
        for(let i=0;i<5;i++)box(spring,'',[.25,.025,.25],[0,.025+i*.045,0],metal);
        box(g,'lab_body',[.26,.12,.26],[0,.75,0],gold);
        for(const z of [-.32,.32])box(g,'',[.04,.45,.04],[0,.76,z],metal);
    } else if(id===B.TEACHING_PULLEY) {
        for(const x of [-.34,.34])box(g,'',[.06,.45,.08],[x,.74,0],wood);
        box(g,'',[.75,.05,.12],[0,.95,0],wood);
        for(const [i,x] of [-.18,.18].entries()) {
            const wheel=box(g,'lab_pulley_fixed_'+i,[.15,.15,.08],[x,.86,0],gold);wheel.rotation.z=Math.PI/4;
        }
        const moving=new THREE.Group();moving.name='lab_pulley_moving';g.add(moving);
        for(const [i,x] of [-.12,.12].entries())box(moving,'lab_moving_wheel_'+i,[.12,.12,.08],[x,0,0],gold).rotation.z=Math.PI/4;
        for(let i=0;i<4;i++)box(g,'lab_rope_'+i,[.014,.3,.014],[-.28+i*.18,.7,.07],metal);
        box(g,'lab_body',[.24,.12,.24],[0,.6,0],metal);
    } else if(id===B.FAN||id===B.WINDMILL) {
        box(g,'',[.14,.45,.14],[0,.7,0],wood);
        const rotor=new THREE.Group();rotor.name='lab_rotor';rotor.position.set(0,.64,-.2);g.add(rotor);
        for(let i=0;i<4;i++) {
            const blade=box(rotor,'',[.12,.36,.04],[Math.sin(i*Math.PI/2)*.17,Math.cos(i*Math.PI/2)*.17,0],id===B.FAN?metal:'#e5d6a8');
            blade.rotation.z=-i*Math.PI/2;
        }
        box(rotor,'',[.14,.14,.1],[0,0,0],gold);
        g.userData.physicsDirectional=id===B.FAN;
    } else if(id===B.SENSOR) {
        for(const x of [-.38,.38])box(g,'',[.06,.4,.08],[x,.72,0],metal);
        box(g,'',[.85,.06,.1],[0,.94,0],gold);
        box(g,'',[.7,.015,.015],[0,.8,0],'#71eacb');g.userData.physicsDirectional=true;
    } else if(id===B.VALVE) {
        box(g,'',[.34,.3,.54],[0,.69,0],metal);
        const handle=box(g,'lab_valve',[.64,.055,.07],[0,.88,0],'#e8c45c');handle.rotation.y=.4;
        g.userData.physicsDirectional=true;
    } else if(id===B.PUMP) {
        box(g,'',[.48,.34,.44],[0,.7,0],metal);
        box(g,'',[.15,.12,.42],[0,.66,.29],color);
        box(g,'',[.17,.4,.16],[0,.78,-.3],gold);g.userData.physicsDirectional=true;
    } else if(id===B.CARRIAGE) {
        box(g,'',[.72,.3,.62],[0,.7,0],metal);
        box(g,'',[.14,.08,.7],[0,.9,0],gold);box(g,'',[.3,.08,.14],[0,.9,-.3],gold);g.userData.physicsDirectional=true;
    }
    return g;
}

// 配置、读数和模型共用一份状态；所有节点留在本格，不额外创建运动碰撞体。
export function updatePhysicsMesh(mesh,id,a,r,clock,rpm) {
    const body=mesh.getObjectByName('lab_body'),beam=mesh.getObjectByName('lab_beam'),rotor=mesh.getObjectByName('lab_rotor');
    if(body) {
        body.visible=!isTroughId(id)||!!a.float;
        body.position.x=id===B.RAMP?-.38+r.distance/P.trackLength*.76:0;
        body.position.y=isTroughId(id)?r.height+.08:id===B.RAMP?.69+r.height*.19:
            id===B.TEACHING_PULLEY?.57+Math.min(3,r.height)*.07:.65+Math.min(3,r.height)*.08;
        if(a.mass)body.scale.set(.13+Math.cbrt(a.mass)*.03,.11+Math.cbrt(a.mass)*.015,.18+Math.cbrt(a.mass)*.02);
        if(isTroughId(id))body.scale.y=.16+a.ballast*.025;
    }
    const ramp=mesh.getObjectByName('lab_ramp');
    if(ramp) {
        const span=P.rampLength/P.trackLength*.76,rise=P.rampLength*Math.sin(P.slopes[a.slope]*Math.PI/180)*.19;
        ramp.rotation.z=-Math.atan2(rise,span);ramp.position.set(-.38+span/2,.6+rise/2,0);ramp.scale.x=Math.hypot(span,rise)/.54;
        for(let i=0;i<3;i++)ramp.getObjectByName('lab_surface_'+i).visible=i===a.surface;
    }
    if(beam) {
        const px=(a.pivot-2)*.18;beam.rotation.z=-r.angle;beam.position.x=px;
        mesh.getObjectByName('lab_pivot').position.x=px;
        beam.getObjectByName('lab_beam_board').position.x=-px;
        for(const [side,mass,slot] of [['left',a.leftMass,2-a.leftArm],['right',a.rightMass,2+a.rightArm]]) {
            const weight=beam.getObjectByName('lab_'+side+'_weight');weight.visible=mass>0;
            weight.position.x=(slot-a.pivot)*.18;weight.scale.y=.06+mass*.025;weight.position.y=.025+weight.scale.y/2;
        }
    }
    const moving=mesh.getObjectByName('lab_pulley_moving');
    if(moving) {
        const n=P.ropeCounts[a.ropes],my=.65+Math.min(3,r.height)*.07;
        moving.visible=n>1;moving.position.y=my;
        moving.getObjectByName('lab_moving_wheel_0').visible=n>1;moving.getObjectByName('lab_moving_wheel_1').visible=n===4;
        mesh.getObjectByName('lab_pulley_fixed_1').visible=n===4;
        for(let i=0;i<4;i++) {
            const rope=mesh.getObjectByName('lab_rope_'+i);rope.visible=i<n;
            rope.scale.y=n===1?.3:Math.max(.035,.88-my);rope.position.y=n===1?.72:(.88+my)/2;
        }
    }
    if(rotor)rotor.rotation.z=clock*rpm*Math.PI/30;
    if(mesh.userData.physicsDirectional)mesh.rotation.y=-a.dir*Math.PI/2;
    const spring=mesh.getObjectByName('lab_spring');if(spring)spring.scale.y=r.stored>0?.4:1;
    const valve=mesh.getObjectByName('lab_valve');if(valve)valve.rotation.y=a.open?Math.PI/2:0;
}
