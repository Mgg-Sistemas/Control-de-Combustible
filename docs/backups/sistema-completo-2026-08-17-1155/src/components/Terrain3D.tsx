// Visor 3D del terreno (WebGL/Three.js) — muestra la malla del MDT coloreada por
// elevación, con órbita del ratón. Solo web (iframe con Three por CDN); en nativo
// muestra un aviso. La malla llega ya calculada por src/lib/tin.ts (terrainMesh).
import React, { useMemo } from 'react';
import { Platform, View, Text } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme';

export type Mesh3D = { positions: number[]; colors: number[]; indices: number[] };

function html(mesh: Mesh3D): string {
  const data = JSON.stringify(mesh);
  return `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;height:100%;background:#0b1020;overflow:hidden}</style>
<script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js"></script>
</head><body><script>
  var M = ${data};
  var scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1020);
  var camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.01, 100);
  camera.position.set(0.8, 0.8, 0.8);
  var renderer = new THREE.WebGLRenderer({ antialias:true }); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio||1); document.body.appendChild(renderer.domElement);
  var controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(M.positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(M.colors, 3));
  geo.setIndex(M.indices); geo.computeVertexNormals();
  var mat = new THREE.MeshStandardMaterial({ vertexColors:true, side:THREE.DoubleSide, roughness:0.95, metalness:0.0, flatShading:false });
  var mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
  var wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color:0x000000, transparent:true, opacity:0.08 })); scene.add(wire);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.0));
  var dir = new THREE.DirectionalLight(0xffffff, 1.1); dir.position.set(1,2,1.5); scene.add(dir);
  scene.add(new THREE.GridHelper(2, 20, 0x334155, 0x1e293b));
  window.addEventListener('resize', function(){ camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
  (function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
</script></body></html>`;
}

export function Terrain3D({ mesh, height }: { mesh: Mesh3D; height?: number }) {
  const { colors } = useTheme();
  const doc = useMemo(() => html(mesh), [mesh]);
  if (Platform.OS !== 'web') {
    return <Card><Text style={{ color: colors.muted }}>El visor 3D del terreno está disponible en la versión web.</Text></Card>;
  }
  return React.createElement('iframe' as any, { srcDoc: doc, allow: 'fullscreen', style: { width: '100%', height: height ?? 420, border: `1px solid ${colors.border}`, borderRadius: radius.md, background: '#0b1020' } } as any);
}
