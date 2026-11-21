import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap, prefersReducedMotion } from '../../components/motion/gsap';
import type { CrewTier } from './teamActivity';

export interface SkylineCell {
  date: string;
  col: number;
  row: number;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
  crew: CrewTier;
  future?: boolean;
  untracked: boolean;
}

interface HexSkylineProps {
  cells: SkylineCell[];
  weeks: number;
  theme: string;
  label: string;
  hint: string;
  unavailable: string;
  onSelect: (date: string) => void;
  onHover: (date: string | null, clientX: number, clientY: number) => void;
}

const RADIUS = 1;
const GAP = 1.06;
const STEP_X = Math.sqrt(3) * RADIUS * GAP;
const STEP_Z = 1.5 * RADIUS * GAP;
const MIX = [0, 0.34, 0.58, 0.8, 1];

function cssColor(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try { return new THREE.Color(value || fallback); } catch { return new THREE.Color(fallback); }
}

function heightOf(cell: SkylineCell): number {
  if (cell.future) return 0.06;
  if (cell.total <= 0) return 0.22;
  return 0.7 + Math.log2(1 + cell.total) * 1.55;
}

/**
 * Hexagonal skyline: every day is an extruded hex prism (InstancedMesh, one draw call),
 * height = contribution volume, colour = team heat. Days where 2+ people were active get a
 * pulsing glow cap. Lazy-loaded so three.js never weighs on the first dashboard paint.
 */
export default function HexSkyline3D({ cells, weeks, theme, label, hint, unavailable, onSelect, onHover }: HexSkylineProps) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onSelect, onHover });
  callbacks.current = { onSelect, onHover };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    const reduced = prefersReducedMotion();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme === 'dark' ? 1.15 : 1.05;
    renderer.domElement.className = 'hex-3d-canvas';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const isDark = theme === 'dark';
    scene.fog = new THREE.Fog(isDark ? 0x0b0e16 : 0xeef1f8, 70, 150);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    const width = weeks * STEP_X;
    const depth = 7 * STEP_Z;
    // Framing: keep a fixed viewing angle and solve the camera distance so the whole year fits
    // the canvas at any aspect ratio. Narrow (portrait) canvases look down the length of the year
    // instead, so recent weeks sit closest to the viewer.
    const lookAt = new THREE.Vector3(0, 1.4, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const landscapeDir = new THREE.Vector3(0.14, 0.52, 0.84).normalize();
    const portraitDir = new THREE.Vector3(0.8, 0.56, 0.22).normalize();
    const view = { zoom: reduced ? 1 : 1.8, fit: 70, phase: 0, dir: landscapeDir };
    const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, 6].map((y) => new THREE.Vector3(sx * (width / 2 + 1.5), y, sz * (depth / 2 + 1.5)))));
    const probe = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
    const projected = new THREE.Vector3();
    const solveFit = () => {
      probe.fov = camera.fov;
      probe.aspect = camera.aspect;
      probe.updateProjectionMatrix();
      let lo = 6;
      let hi = 320;
      for (let step = 0; step < 24; step += 1) {
        const mid = (lo + hi) / 2;
        probe.position.copy(lookAt).addScaledVector(view.dir, mid);
        probe.lookAt(lookAt);
        probe.updateMatrixWorld();
        const fits = corners.every((corner) => {
          projected.copy(corner).project(probe);
          return Math.abs(projected.x) <= 0.95 && Math.abs(projected.y) <= 0.86 && projected.z < 1;
        });
        if (fits) hi = mid; else lo = mid;
      }
      return hi;
    };
    const swayDir = new THREE.Vector3();
    const placeCamera = () => {
      swayDir.copy(view.dir).applyAxisAngle(up, Math.sin(view.phase) * 0.16);
      camera.position.copy(lookAt).addScaledVector(swayDir, view.fit * view.zoom);
    };
    placeCamera();

    scene.add(new THREE.HemisphereLight(isDark ? 0x9fb4ff : 0xffffff, isDark ? 0x0a0c14 : 0xc9d2e6, isDark ? 1.0 : 1.35));
    const key = new THREE.DirectionalLight(0xffffff, isDark ? 1.6 : 1.9);
    key.position.set(-30, 60, 40);
    scene.add(key);
    const rim = new THREE.DirectionalLight(isDark ? 0x7c4dff : 0xa78bfa, isDark ? 1.2 : 0.6);
    rim.position.set(40, 20, -50);
    scene.add(rim);

    const group = new THREE.Group();
    group.position.set(-width / 2 + STEP_X / 2, 0, -depth / 2 + STEP_Z / 2);
    scene.add(group);

    // Base plate: a soft frosted slab under the hive.
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(width + 6, 0.4, depth + 6),
      new THREE.MeshStandardMaterial({ color: isDark ? 0x141826 : 0xf7f8fc, roughness: 0.9, metalness: 0, transparent: true, opacity: isDark ? 0.85 : 0.75 }),
    );
    plate.position.set(0, -0.25, 0);
    scene.add(plate);

    const prism = new THREE.CylinderGeometry(RADIUS, RADIUS, 1, 6, 1, false);
    prism.translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.12, flatShading: true });
    const mesh = new THREE.InstancedMesh(prism, material, Math.max(1, cells.length));
    mesh.count = cells.length;
    group.add(mesh);

    const heat0 = cssColor('--heat-0', isDark ? '#191D28' : '#E3E7F0');
    const crews = [1, 2, 3, 4].map((tier) => cssColor(`--crew-${tier}`, ['#2F62E9', '#7C4DFF', '#C63CDB', '#DC143C'][tier - 1]));
    const base: THREE.Color[] = cells.map((cell) => {
      if (cell.future) return heat0.clone().multiplyScalar(isDark ? 0.8 : 1.02);
      if (cell.level === 0 || cell.crew === 0) return heat0.clone();
      return heat0.clone().lerp(crews[Math.min(4, cell.crew) - 1], MIX[cell.level]);
    });
    base.forEach((color, index) => mesh.setColorAt(index, color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const positions = cells.map((cell) => new THREE.Vector3(cell.col * STEP_X + (cell.row % 2) * (STEP_X / 2), 0, cell.row * STEP_Z));
    const targets = cells.map(heightOf);
    const dummy = new THREE.Object3D();
    const progress = { value: reduced ? 1 : 0 };
    const layout = () => {
      cells.forEach((cell, index) => {
        const local = Math.min(1, Math.max(0, progress.value * 1.6 - (cell.col / Math.max(1, weeks)) * 0.6));
        const eased = 1 - Math.pow(1 - local, 3);
        dummy.position.copy(positions[index]);
        dummy.scale.set(1, Math.max(0.001, targets[index] * eased), 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    layout();

    // Glow caps for multi-person days.
    const hot = cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.crew >= 2 && cell.total > 0 && !cell.future);
    const capGeometry = new THREE.CylinderGeometry(RADIUS * 0.82, RADIUS * 0.82, 0.08, 6);
    const capMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const caps = new THREE.InstancedMesh(capGeometry, capMaterial, Math.max(1, hot.length));
    caps.count = hot.length;
    hot.forEach(({ cell }, index) => caps.setColorAt(index, crews[Math.min(4, cell.crew) - 1]));
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
    group.add(caps);
    const pulse = { value: 0 };
    const layoutCaps = () => {
      hot.forEach(({ cell, index }, capIndex) => {
        const local = Math.min(1, Math.max(0, progress.value * 1.6 - (cell.col / Math.max(1, weeks)) * 0.6));
        const eased = 1 - Math.pow(1 - local, 3);
        dummy.position.copy(positions[index]);
        dummy.position.y = targets[index] * eased + 0.06 + pulse.value * 0.25;
        const s = 1 + pulse.value * 0.35;
        dummy.scale.set(s, 1, s);
        dummy.updateMatrix();
        caps.setMatrixAt(capIndex, dummy.matrix);
      });
      caps.instanceMatrix.needsUpdate = true;
    };
    layoutCaps();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 10;
    controls.maxDistance = 220;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.target.copy(lookAt);
    controls.update();
    let touched = false;
    const tweens: Array<ReturnType<typeof gsap.to>> = [];
    const stopAuto = () => {
      if (touched) return;
      touched = true;
      tweens.slice(2).forEach((tween) => tween.kill());
    };
    controls.addEventListener('start', stopAuto);
    const follow = () => {
      if (touched) return;
      placeCamera();
      controls.update();
    };

    if (!reduced) {
      tweens.push(gsap.to(progress, { value: 1, duration: 1.9, ease: 'power2.out', onUpdate: () => { layout(); layoutCaps(); } }));
      tweens.push(gsap.to(pulse, { value: 1, duration: 1.3, ease: 'sine.inOut', repeat: -1, yoyo: true, onUpdate: layoutCaps }));
      // Fly-in, then a slow cinematic sway that stops as soon as the user grabs the scene.
      tweens.push(gsap.to(view, {
        zoom: 1,
        duration: 2.2,
        ease: 'power3.out',
        onUpdate: follow,
        onComplete: () => {
          if (touched) return;
          tweens.push(gsap.to(view, { phase: Math.PI * 2, duration: 14, ease: 'none', repeat: -1, onUpdate: follow }));
        },
      }));
    }

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.fov = clientWidth < 560 ? 46 : 32;
      camera.updateProjectionMatrix();
      view.dir = camera.aspect < 1.25 ? portraitDir : landscapeDir;
      view.fit = solveFit();
      controls.maxDistance = Math.max(60, view.fit * 2.2);
      follow();
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = -1;
    const highlight = new THREE.Color();
    const setHovered = (index: number) => {
      if (index === hovered) return;
      if (hovered >= 0) mesh.setColorAt(hovered, base[hovered]);
      hovered = index;
      if (hovered >= 0) mesh.setColorAt(hovered, highlight.copy(base[hovered]).offsetHSL(0, 0.05, isDark ? 0.16 : 0.1));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      renderer.domElement.style.cursor = hovered >= 0 && !cells[hovered].future ? 'pointer' : 'grab';
    };
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      return hit?.instanceId ?? -1;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const index = pick(event);
      setHovered(index);
      const cell = index >= 0 ? cells[index] : null;
      callbacks.current.onHover(cell && !cell.future ? cell.date : null, event.clientX, event.clientY);
    };
    const onLeave = () => { setHovered(-1); callbacks.current.onHover(null, 0, 0); };
    const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const index = pick(event);
      const cell = index >= 0 ? cells[index] : null;
      if (cell && !cell.future) callbacks.current.onSelect(cell.date);
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    let visible = true;
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; })
      : null;
    io?.observe(container);
    renderer.setAnimationLoop(() => {
      if (!visible || document.hidden) return;
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      tweens.forEach((tween) => tween.kill());
      observer?.disconnect();
      io?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      controls.removeEventListener('start', stopAuto);
      controls.dispose();
      prism.dispose();
      capGeometry.dispose();
      material.dispose();
      capMaterial.dispose();
      plate.geometry.dispose();
      (plate.material as THREE.Material).dispose();
      mesh.dispose();
      caps.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [cells, weeks, theme]);

  if (failed) return <p className="hex-3d-fallback">{unavailable}</p>;
  return (
    <div className="hex-3d" role="img" aria-label={label}>
      <div ref={host} className="hex-3d-host" />
      <p className="hex-3d-hint" aria-hidden="true">{hint}</p>
    </div>
  );
}
