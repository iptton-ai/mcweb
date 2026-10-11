// ==================== assistant-sim three.js 桩 ====================
// 覆盖项目实际用到的全部 THREE 导出名（tools/assistant-sim 生成清单，见 README）。
// 全部是万能对象：网格/材质/相机创建照常「成功」，但不产生任何真实几何或 WebGL 调用。
import { universal } from './universal.mjs';

const NAMES = [
    'AmbientLight', 'BoxGeometry', 'BufferAttribute', 'BufferGeometry', 'CanvasTexture',
    'Color', 'CylinderGeometry', 'DirectionalLight', 'DoubleSide', 'EdgesGeometry',
    'Euler', 'Fog', 'FrontSide', 'Group', 'HemisphereLight', 'InstancedMesh',
    'LineBasicMaterial', 'LineSegments', 'MathUtils', 'Matrix4', 'Mesh',
    'MeshBasicMaterial', 'MeshLambertMaterial', 'NearestFilter', 'PCFSoftShadowMap',
    'PerspectiveCamera', 'PlaneGeometry', 'PointLight', 'Points', 'PointsMaterial',
    'Scene', 'SRGBColorSpace', 'TorusGeometry', 'Vector3', 'WebGLRenderer',
];

const api = {};
for (const n of NAMES) api[n] = universal('THREE.' + n);

export const {
    AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture,
    Color, CylinderGeometry, DirectionalLight, DoubleSide, EdgesGeometry,
    Euler, Fog, FrontSide, Group, HemisphereLight, InstancedMesh,
    LineBasicMaterial, LineSegments, MathUtils, Matrix4, Mesh,
    MeshBasicMaterial, MeshLambertMaterial, NearestFilter, PCFSoftShadowMap,
    PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial,
    Scene, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer,
} = api;

export default universal('THREE');
