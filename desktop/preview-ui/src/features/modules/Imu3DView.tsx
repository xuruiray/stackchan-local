import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { numberText } from "../../model/format";
import type { AnyRecord } from "./module-utils";

type PoseReadout = {
  hasAccel: boolean;
  pitchRad?: number;
  rollRad?: number;
  yawRad: number;
  accelMagnitude?: number;
  gyroMagnitude?: number;
};

type SceneHandle = {
  camera: THREE.PerspectiveCamera;
  cube: THREE.Group;
  renderer: THREE.WebGLRenderer;
  resizeObserver: ResizeObserver;
  scene: THREE.Scene;
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function poseFromImu(imu: AnyRecord, yawRad: number): PoseReadout {
  const x = finiteNumber(imu.x);
  const y = finiteNumber(imu.y);
  const z = finiteNumber(imu.z);
  const gyroX = finiteNumber(imu.gyroX);
  const gyroY = finiteNumber(imu.gyroY);
  const gyroZ = finiteNumber(imu.gyroZ);
  const hasAccel = x !== undefined && y !== undefined && z !== undefined;
  const accelMagnitude = hasAccel ? Math.sqrt(x ** 2 + y ** 2 + z ** 2) : undefined;
  const hasStableAccel = hasAccel && accelMagnitude !== undefined && accelMagnitude > 0.0001;
  return {
    hasAccel: hasStableAccel,
    pitchRad: hasStableAccel ? Math.atan2(-x, Math.sqrt(y ** 2 + z ** 2)) : undefined,
    rollRad: hasStableAccel ? Math.atan2(y, z) : undefined,
    yawRad,
    accelMagnitude,
    gyroMagnitude:
      gyroX !== undefined && gyroY !== undefined && gyroZ !== undefined ? Math.sqrt(gyroX ** 2 + gyroY ** 2 + gyroZ ** 2) : undefined
  };
}

function createCube(): THREE.Group {
  const cube = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1.55, 1.55, 1.55);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xf26b62, roughness: 0.46 }),
    new THREE.MeshStandardMaterial({ color: 0xba9cff, roughness: 0.46 }),
    new THREE.MeshStandardMaterial({ color: 0x42d19d, roughness: 0.46 }),
    new THREE.MeshStandardMaterial({ color: 0xe7b84a, roughness: 0.46 }),
    new THREE.MeshStandardMaterial({ color: 0x69b7ff, roughness: 0.46 }),
    new THREE.MeshStandardMaterial({ color: 0x9ca7ad, roughness: 0.46 })
  ];
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  cube.add(mesh);
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xf4fbff })));
  return cube;
}

function resizeRenderer(container: HTMLDivElement, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const drawable = object as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    drawable.geometry?.dispose();
    if (Array.isArray(drawable.material)) {
      drawable.material.forEach((material) => material.dispose());
    } else {
      drawable.material?.dispose();
    }
  });
}

function createScene(container: HTMLDivElement): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(3.1, 2.4, 3.3);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
  keyLight.position.set(2.8, 4, 3);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x69b7ff, 0.55);
  rimLight.position.set(-3, 2, -2);
  scene.add(rimLight);

  const cube = createCube();
  scene.add(cube);

  const resizeObserver = new ResizeObserver(() => resizeRenderer(container, renderer, camera));
  resizeObserver.observe(container);
  resizeRenderer(container, renderer, camera);
  renderer.render(scene, camera);

  return { camera, cube, renderer, resizeObserver, scene };
}

export function Imu3DView({ imu }: { imu: AnyRecord }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imuRef = useRef(imu);
  const yawRef = useRef(0);
  const [readout, setReadout] = useState<PoseReadout>(() => poseFromImu(imu, 0));
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    imuRef.current = imu;
  }, [imu]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let sceneHandle: SceneHandle;
    let frameId = 0;
    let lastFrameMs = performance.now();
    let lastReadoutMs = 0;
    let disposed = false;

    try {
      sceneHandle = createScene(container);
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : "WebGL 初始化失败");
      return;
    }

    const animate = (nowMs: number) => {
      if (disposed) {
        return;
      }

      const dtSeconds = clamp((nowMs - lastFrameMs) / 1000, 0, 0.12);
      lastFrameMs = nowMs;
      const gyroZ = finiteNumber(imuRef.current.gyroZ) ?? 0;
      yawRef.current += gyroZ * DEG_TO_RAD * dtSeconds;

      const pose = poseFromImu(imuRef.current, yawRef.current);
      sceneHandle.cube.rotation.set(pose.pitchRad ?? 0, pose.yawRad, -(pose.rollRad ?? 0), "YXZ");
      sceneHandle.renderer.render(sceneHandle.scene, sceneHandle.camera);

      if (nowMs - lastReadoutMs > 160) {
        lastReadoutMs = nowMs;
        setReadout(pose);
      }
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      sceneHandle.resizeObserver.disconnect();
      disposeScene(sceneHandle.scene);
      sceneHandle.renderer.dispose();
      sceneHandle.renderer.domElement.remove();
    };
  }, []);

  return (
    <section className="panel-block imu-3d-panel">
      <div className="imu-3d-heading">
        <h3>BMI270 3D</h3>
        <span>{readout.hasAccel ? "Live attitude" : "Waiting for accel data"}</span>
      </div>
      <div className="imu-3d-layout">
        <div className="imu-3d-canvas" ref={containerRef} aria-label="BMI270 3D attitude view">
          {webglError ? <span className="imu-3d-error">{webglError}</span> : null}
        </div>
        <div className="imu-3d-readout" aria-label="BMI270 attitude readout">
          <span>
            <small>Pitch</small>
            <strong>{numberText(readout.pitchRad === undefined ? undefined : readout.pitchRad * RAD_TO_DEG, 1, " deg")}</strong>
          </span>
          <span>
            <small>Roll</small>
            <strong>{numberText(readout.rollRad === undefined ? undefined : readout.rollRad * RAD_TO_DEG, 1, " deg")}</strong>
          </span>
          <span>
            <small>Yaw</small>
            <strong>{numberText(readout.yawRad * RAD_TO_DEG, 1, " deg")}</strong>
          </span>
          <span>
            <small>Accel</small>
            <strong>{numberText(readout.accelMagnitude, 3)}</strong>
          </span>
          <span>
            <small>Gyro</small>
            <strong>{numberText(readout.gyroMagnitude, 2, " dps")}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
