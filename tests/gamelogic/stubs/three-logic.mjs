// ==================== gamelogic three.js 逻辑桩 ====================
// 与 assistant-sim/stubs/three.mjs 的差别：场景对象（Mesh/Group/Points/相机/灯）带
// **真数值 position/rotation/scale** 与可用的 children 树——逻辑层（物品实体、生物、
// TNT 引信、活塞/电梯载客）靠坐标数值运算做判定，万能桩会把它们算成 NaN。
// 纯渲染类（几何/材质/渲染器）保持轻量或万能桩：逻辑测试不渲染。
import { universal } from '../../assistant-sim/stubs/universal.mjs';

export class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y = this.y, z = this.z) { this.x = x; this.y = y; this.z = z; return this; }
    setX(x) { this.x = x; return this; }
    setY(y) { this.y = y; return this; }
    setZ(z) { this.z = z; return this; }
    setScalar(s) { return this.set(s, s, s); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    addScalar(s) { this.x += s; this.y += s; this.z += s; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    divideScalar(s) { return this.multiplyScalar(s !== 0 ? 1 / s : 0); }
    negate() { return this.multiplyScalar(-1); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() { return this.divideScalar(this.length() || 1); }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    cross(v) { const { x, y, z } = this; this.x = y * v.z - z * v.y; this.y = z * v.x - x * v.z; this.z = x * v.y - y * v.x; return this; }
    lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
    applyEuler() { return this; } // 逻辑层不做真实旋转
    applyQuaternion(q) {
        // 第三人称准星用真实相机四元数，不能以 no-op 假装旋转已生效。
        const { x, y, z } = this;
        const tx = 2 * (q.y * z - q.z * y);
        const ty = 2 * (q.z * x - q.x * z);
        const tz = 2 * (q.x * y - q.y * x);
        this.x = x + q.w * tx + q.y * tz - q.z * ty;
        this.y = y + q.w * ty + q.z * tx - q.x * tz;
        this.z = z + q.w * tz + q.x * ty - q.y * tx;
        return this;
    }
}

export class Euler {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this._order = 'XYZ'; }
    set(x = this.x, y = this.y, z = this.z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Euler(this.x, this.y, this.z); }
}

export class Color {
    constructor(r = 0, g, b) {
        if (typeof r === 'number' && g === undefined && b === undefined) {
            this.r = ((r >> 16) & 255) / 255; this.g = ((r >> 8) & 255) / 255; this.b = (r & 255) / 255;
        } else { this.r = r ?? 0; this.g = g ?? 0; this.b = b ?? 0; }
    }
    set(r, g, b) {
        if (r && typeof r === 'object' && 'r' in r) return this.copy(r);
        if (typeof r === 'number' && g === undefined && b === undefined) return this.setHex(r);
        return this.setRGB(r ?? 0, g ?? 0, b ?? 0);
    }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
    setHex(h) { return this.setRGB(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255); }
    getHex() { return (Math.round(this.r * 255) << 16) | (Math.round(this.g * 255) << 8) | Math.round(this.b * 255); }
    lerp(c, a) { this.r += (c.r - this.r) * a; this.g += (c.g - this.g) * a; this.b += (c.b - this.b) * a; return this; }
    lerpColors(a, b, t) { return this.copy(a).lerp(b, t); }
    lerpHSL() { return this; }
    copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
    clone() { return new Color(this.r, this.g, this.b); }
    offsetHSL() { return this; }
    getHSL(target) { if (target) { target.h = 0; target.s = 0; target.l = 0; } return target; }
    setHSL() { return this; }
    setScalar(s) { return this.setRGB(s, s, s); }
    multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
    multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
    add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
    addScalar(s) { this.r += s; this.g += s; this.b += s; return this; }
    getHexString() { return this.getHex().toString(16).padStart(6, '0'); }
    getStyle() { return `rgb(${Math.round(this.r * 255)},${Math.round(this.g * 255)},${Math.round(this.b * 255)})`; }
}

// 场景对象基类：坐标数值真实、子树可用，渲染相关方法全部 no-op
export class Object3D {
    constructor() {
        this.position = new Vector3();
        this.rotation = new Euler();
        this.scale = new Vector3(1, 1, 1);
        this.quaternion = { x: 0, y: 0, z: 0, w: 1, setFromEuler() {}, slerp() {}, copy() { return this; } };
        this.children = [];
        this.parent = null;
        this.userData = {};
        this.visible = true;
        this.name = '';
        this.castShadow = false;
        this.receiveShadow = false;
        this.frustumCulled = false;
        this.renderOrder = 0;
        this.matrixAutoUpdate = true;
        this.matrixWorldNeedsUpdate = false;
        this.matrix = { identity() {}, compose() {}, decompose() {}, makeTranslation() {}, multiply() {}, copy() { return this; } };
        this.matrixWorld = { identity() {}, compose() {}, decompose() {}, copy() { return this; } };
    }
    add(...objs) {
        for (const o of objs) {
            if (!o) continue;
            if (o.parent) o.parent.remove(o);
            o.parent = this;
            this.children.push(o);
        }
        return this;
    }
    remove(...objs) {
        for (const o of objs) {
            const i = this.children.indexOf(o);
            if (i >= 0) this.children.splice(i, 1);
            if (o) o.parent = null;
        }
        return this;
    }
    clear() { this.children.length = 0; return this; }
    getObjectByName(n) {
        for (const c of this.children) {
            if (c.name === n) return c;
            const hit = c.getObjectByName?.(n);
            if (hit) return hit;
        }
        return undefined;
    }
    traverse(fn) { fn(this); for (const c of [...this.children]) c.traverse?.(fn); }
    traverseVisible(fn) { if (!this.visible) return; fn(this); for (const c of [...this.children]) c.traverseVisible?.(fn); }
    lookAt() { return this; }
    rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
    translateX() { return this; } translateY() { return this; } translateZ() { return this; }
    translateOnAxis() { return this; }
    updateMatrix() { return this; } updateMatrixWorld() {} updateWorldMatrix() {}
    getWorldPosition(target) { const v = target || new Vector3(); return v.copy(this.position); }
    getWorldDirection(target) { const v = target || new Vector3(); return v.set(0, 0, -1); }
    getWorldScale(target) { const v = target || new Vector3(); return v.copy(this.scale); }
    attach(o) { return this.add(o); }
    removeFromParent() { this.parent?.remove(this); return this; }
    clone(recursive = true) {
        // 真语义深克隆（entities.js createMobMesh 靠 clone 保留 children 顺序取四肢）：
        // 递归拷贝子树 + 浅拷贝 userData；子类构造器带参（InstancedMesh 等）缺参时退化为 Object3D
        let out;
        try { out = new this.constructor(); } catch { out = new Object3D(); }
        out.name = this.name;
        out.visible = this.visible;
        Object.assign(out.userData, this.userData);
        if (recursive) for (const c of [...this.children]) out.add(c.clone(true));
        return out;
    }
    copy() { return this; }
    dispatchEvent() {}
}

export class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
export class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; }
}
export class LineSegments extends Mesh { constructor(g, m) { super(g, m); this.isLineSegments = true; } }
export class Points extends Mesh { constructor(g, m) { super(g, m); this.isPoints = true; } }
export class Scene extends Object3D { constructor() { super(); this.isScene = true; this.fog = null; this.background = null; } }

export class PerspectiveCamera extends Object3D {
    constructor(fov = 70, aspect = 1, near = 0.1, far = 1000) {
        super();
        this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
        this.isPerspectiveCamera = true;
    }
    updateProjectionMatrix() {}
}

export class Light extends Object3D {
    constructor(color, intensity = 1) { super(); this.color = new Color(color); this.intensity = intensity; }
}
export class AmbientLight extends Light {}
export class DirectionalLight extends Light { constructor(c, i) { super(c, i); this.target = new Object3D(); } }
export class HemisphereLight extends Light { constructor(c, g, i) { super(c, i); this.groundColor = new Color(g); } }
export class PointLight extends Light { constructor(c, i, d = 0, decay = 1) { super(c, i); this.distance = d; this.decay = decay; } }

export class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; this.usage = 0; }
    get count() { return this.array.length / this.itemSize; }
    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    setX(i, x) { this.array[i * this.itemSize] = x; return this; }
    setY(i, y) { this.array[i * this.itemSize + 1] = y; return this; }
    setZ(i, z) { this.array[i * this.itemSize + 2] = z; return this; }
    setXY(i, x, y) { const b = i * this.itemSize; this.array[b] = x; this.array[b + 1] = y; return this; }
    setXYZ(i, x, y, z) { const b = i * this.itemSize; this.array[b] = x; this.array[b + 1] = y; this.array[b + 2] = z; return this; }
}

export class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.boundingSphere = null; this.boundingBox = null; this.drawRange = { start: 0, count: Infinity }; }
    setAttribute(name, attr) { this.attributes[name] = attr; return this; }
    getAttribute(name) { return this.attributes[name]; }
    deleteAttribute(name) { delete this.attributes[name]; return this; }
    setIndex(i) { this.index = i; return this; }
    setFromPoints(points) {
        const arr = new Float32Array(points.length * 3);
        points.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
        return this.setAttribute('position', new BufferAttribute(arr, 3));
    }
    computeBoundingSphere() {} computeBoundingBox() {} computeVertexNormals() {} dispose() {}
    setDrawRange() {} applyMatrix4() { return this; } applyEuler() { return this; }
    toNonIndexed() { return this; } normalizeNormals() {}
    translate() { return this; } rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
    scale() { return this; } center() { return this; }
    clone() { return new BufferGeometry(); }
}

// 几何类：默认带 position/normal/uv 属性（24 顶点=BoxGeometry 6 面×4 的面序占位），
// 逻辑层要写 uv/读 attributes（js/items.js 掉落物几何 getDropGeo）不落空
class GeometryStub extends BufferGeometry {
    constructor(...params) {
        super();
        this.parameters = params;
        this.setAttribute('position', new BufferAttribute(new Float32Array(24 * 3), 3));
        this.setAttribute('normal', new BufferAttribute(new Float32Array(24 * 3), 3));
        this.setAttribute('uv', new BufferAttribute(new Float32Array(24 * 2), 2));
    }
}
export class BoxGeometry extends GeometryStub {}
export class CylinderGeometry extends GeometryStub {}
export class PlaneGeometry extends GeometryStub {}
export class TorusGeometry extends GeometryStub {}
export class EdgesGeometry extends GeometryStub {}

export class Material { constructor(params = {}) { Object.assign(this, params); if (typeof this.color === 'number') this.color = new Color(this.color); this.isMaterial = true; } dispose() {} }
export class MeshBasicMaterial extends Material {}
export class MeshLambertMaterial extends Material {}
export class LineBasicMaterial extends Material {}
export class PointsMaterial extends Material {}

export class CanvasTexture { constructor(image) { this.image = image; this.needsUpdate = true; } dispose() {} }
export class Fog { constructor(color, near, far) { this.color = new Color(color); this.near = near; this.far = far; } }
export class Matrix4 {
    constructor() { this.elements = new Float32Array(16); }
    identity() { return this; } compose() { return this; } decompose() {} multiply() { return this; }
    premultiply() { return this; } multiplyMatrices() { return this; }
    makeTranslation() { return this; } makeScale() { return this; }
    makeRotationX() { return this; } makeRotationY() { return this; } makeRotationZ() { return this; }
    setPosition() { return this; } extractRotation() { return this; }
    copy() { return this; } clone() { return new Matrix4(); }
}
export class InstancedMesh extends Mesh {
    constructor(g, m, count) { super(g, m); this.count = count; this.instanceMatrix = new BufferAttribute(new Float32Array(count * 16), 16); }
    setMatrixAt() {} getMatrixAt(i, t) { t?.identity?.(); } dispose() {}
}
export class WebGLRenderer {
    constructor(params = {}) {
        this.domElement = params.canvas || universal('canvas');
        this.shadowMap = { enabled: false, type: 0 };
        this.outputColorSpace = 'srgb';
        this.toneMapping = 0;
        this.toneMappingExposure = 1;
    }
    setSize() {} setPixelRatio() {} render() {} setClearColor() {} dispose() {} setRenderTarget() {} getSize(t) { t?.set?.(1280, 720); return t; }
}

export const MathUtils = {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    degToRad: (d) => (d * Math.PI) / 180,
    radToDeg: (r) => (r * 180) / Math.PI,
    euclideanModulo: (a, b) => ((a % b) + b) % b,
    randFloat: (a, b) => a + Math.random() * (b - a),
    randFloatSpread: (r) => (Math.random() - 0.5) * r,
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    isPowerOfTwo: (v) => (v & (v - 1)) === 0,
    DAMPING: 0.98,
};

// 数值常量（取值照 three 真实导出，逻辑层只做相等比较或透传）
export const NearestFilter = 1003;
export const DoubleSide = 2;
export const FrontSide = 0;
export const PCFSoftShadowMap = 2;
export const SRGBColorSpace = 'srgb';

// 默认导出：显式清单聚合 + 未列出的名字回落万能桩（防漏；避免模块自引用的 TDZ 问题）
const registry = {
    Vector3, Euler, Color, Object3D, Group, Mesh, LineSegments, Points, Scene,
    PerspectiveCamera, Light, AmbientLight, DirectionalLight, HemisphereLight, PointLight,
    BufferAttribute, BufferGeometry, BoxGeometry, CylinderGeometry, PlaneGeometry,
    TorusGeometry, EdgesGeometry, Material, MeshBasicMaterial, MeshLambertMaterial,
    LineBasicMaterial, PointsMaterial, CanvasTexture, Fog, Matrix4, InstancedMesh,
    WebGLRenderer, MathUtils, NearestFilter, DoubleSide, FrontSide, PCFSoftShadowMap, SRGBColorSpace,
};
export default new Proxy(registry, {
    get(t, p) {
        if (p in t) return t[p];
        if (typeof p === 'symbol') return undefined;
        t[p] = universal('THREE.' + String(p));
        return t[p];
    },
});
