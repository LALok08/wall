"use client";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { CampusEnvironment } from "./Environment";
import { Buildings } from "./Buildings";
import { Corridors } from "./Corridors";
import { Roads } from "./Roads";
import { Greenspace } from "./Greenspace";
import { Trees } from "./Trees";
import { Labels } from "./Labels";
import { CameraController } from "@/camera/CameraController";
import { useCampusStore } from "@/store/campusStore";

// Campus centre: roughly mid of KMK campus from origin (roundabout = 0,0)
// X centre ≈ -8, Z centre ≈ 10  (weighted toward academic core)
const CAM_TARGET = [-8, 0, 10] as [number, number, number];
const CAM_START  = [-8 + 520, 460, 10 + 620] as [number, number, number];

function SceneReady() {
  const setReady = useCampusStore((s) => s.setReady);
  useEffect(() => {
    // Brief delay so Three.js finishes first paint
    const t = setTimeout(() => setReady(true), 400);
    return () => { clearTimeout(t); setReady(false); };
  }, [setReady]);
  return null;
}

export function CampusScene() {
  const select = useCampusStore((s) => s.select);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: CAM_START, fov: 48, near: 1, far: 6000 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.background = new THREE.Color("#d4e8f0");
      }}
      onPointerMissed={() => select(null)}
    >
      <Suspense fallback={null}>
        <CampusEnvironment />
        <Greenspace />
        <Roads />
        <Trees />
        <Corridors />
        <Buildings />
        <Labels />
        <SceneReady />
      </Suspense>
      <CameraController />
    </Canvas>
  );
}
