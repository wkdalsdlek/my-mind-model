"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, OrbitControls, GradientTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three"; 

interface MoodData {
  colors: [string, string, string]; 
  distort: number;   
  speed: number;     
  wireframe: boolean; 
  roughness: number; 
  glowStrength: number; 
  scale: number;
}

function SceneLights({ colors }: { colors: [string, string, string] }) {
  const light1 = useRef<THREE.PointLight>(null!);
  const light2 = useRef<THREE.PointLight>(null!);
  const light3 = useRef<THREE.PointLight>(null!);
  const c1 = useMemo(() => new THREE.Color(), []);
  const c2 = useMemo(() => new THREE.Color(), []);
  const c3 = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    c1.set(colors[0]);
    c2.set(colors[1]);
    c3.set(colors[2]);
    if (light1.current) light1.current.color.lerp(c1, 0.05); 
    if (light2.current) light2.current.color.lerp(c2, 0.05);
    if (light3.current) light3.current.color.lerp(c3, 0.05);
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      <pointLight ref={light1} position={[10, 10, 10]} intensity={0.8} />
      <pointLight ref={light2} position={[-10, -10, -10]} intensity={0.8} />
      <pointLight ref={light3} position={[0, 10, -10]} intensity={0.8} />
    </>
  );
}

function MindModel({ data }: { data: MoodData }) {
  const materialRef = useRef<any>(null!);
  const groupRef = useRef<THREE.Group>(null!); 

  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.distort = THREE.MathUtils.lerp(materialRef.current.distort, data.distort, 0.05);
      materialRef.current.speed = THREE.MathUtils.lerp(materialRef.current.speed, data.speed, 0.05);
      materialRef.current.roughness = THREE.MathUtils.lerp(materialRef.current.roughness, data.roughness, 0.05);
      materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(materialRef.current.emissiveIntensity, data.glowStrength, 0.05);
    }
    if (groupRef.current) {
      const currentScale = THREE.MathUtils.lerp(groupRef.current.scale.x, data.scale, 0.05);
      groupRef.current.scale.set(currentScale, currentScale, currentScale);
    }
  });

  return (
    <group ref={groupRef}>
      <Sphere args={[1.5, 100, 100]}>
        <MeshDistortMaterial 
          ref={materialRef}
          metalness={0.8} roughness={0.2} transparent opacity={0.7}
          wireframe={data.wireframe} emissive="white"
        >
          <GradientTexture attach="map" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
          <GradientTexture attach="emissiveMap" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
        </MeshDistortMaterial>
      </Sphere>
    </group>
  );
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // 💡 비밀번호 상태 관리
  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // ✅ [수정] 경민쌤이 원하는 비밀번호로 여기서 바꿔주세요!
  const SECRET_PASSWORD = "20250208"; 

  const [currentData, setCurrentData] = useState<MoodData>({
    colors: ["#14FFF7", "#A316FD", "#FF1493"],
    distort: 0.4, speed: 2.0, wireframe: true, roughness: 0.2, glowStrength: 0.6, scale: 1.0
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === SECRET_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert("비밀번호가 틀렸습니다. 다시 시도해 보세요! 🧐");
    }
  };

  const handleAnalyze = async () => {
    if (inputText.trim() === "") {
      alert("오늘의 감정을 적어주세요.");
      return;
    }
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      if (!response.ok) throw new Error("API 요청 실패");
      const data = await response.json();
      setCurrentData({ ...data, wireframe: true });
    } catch (error) {
      console.error("AI 에러:", error);
      alert("AI 분석 중 문제가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 1️⃣ 로그인 화면 (인증 전)
  if (!isAuthenticated) {
    return (
      <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", display: "flex", justifyContent: "center", alignItems: "center", color: "white", fontFamily: "sans-serif" }}>
        <form onSubmit={handleLogin} style={{ textAlign: "center", padding: "40px", borderRadius: "30px", border: "1px solid #333", backgroundColor: "#0a0a0a", boxShadow: "0 0 30px rgba(163, 22, 253, 0.2)" }}>
          <h2 style={{ marginBottom: "20px", fontSize: "24px", fontWeight: "bold" }}>🔐 심리 모델링 테스트 버전</h2>
          <p style={{ color: "#888", marginBottom: "30px" }}>암호를 입력해 주세요.</p>
          <input 
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="암호 입력..."
            style={{ padding: "12px 20px", borderRadius: "15px", border: "1px solid #444", backgroundColor: "#222", color: "white", width: "220px", marginBottom: "25px", textAlign: "center", fontSize: "16px", outline: "none" }}
          />
          <br />
          <button type="submit" style={{ padding: "12px 40px", borderRadius: "25px", border: "none", backgroundColor: "#A316FD", color: "white", fontSize: "16px", fontWeight: "bold", cursor: "pointer", transition: "all 0.3s" }}>
            입장하기
          </button>
        </form>
      </div>
    );
  }

  // 2️⃣ 분석기 화면 (인증 후)
  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", display: "flex", flexDirection: "column", color: "white", overflow: "hidden" }}>
      <div style={{ padding: "30px", textAlign: "center", zIndex: 10, position: "absolute", bottom: "5%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <h2 style={{ marginBottom: "15px", fontSize: "20px", fontWeight: "bold", textShadow: `0 0 10px ${currentData.colors[1]}` }}>
          심리 모델링 테스트 버전
        </h2>
        <textarea 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="오늘 기분은 어떠신가요?"
          style={{ width: "80%", maxWidth: "500px", height: "80px", padding: "15px", borderRadius: "15px", border: "1px solid #555", backgroundColor: "rgba(255,255,255,0.1)", color: "white", fontSize: "16px", marginBottom: "15px", outline: "none", resize: "none" }}
          disabled={isAnalyzing}
        />
        <button 
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          style={{ padding: "15px 40px", fontSize: "18px", fontWeight: "bold", cursor: isAnalyzing ? "not-allowed" : "pointer", borderRadius: "30px", border: "none", backgroundColor: currentData.colors[1], color: "white", transition: "all 0.3s", boxShadow: `0 0 15px ${currentData.colors[1]}` }}
        >
          {isAnalyzing ? "모델링 중..." : "변화 확인"}
        </button>
      </div>

      <Canvas camera={{ position: [0, 0, 4.5] }} style={{ flex: 1 }}>
        <EffectComposer>
          <Bloom luminanceThreshold={0.8} intensity={0.5} mipmapBlur luminanceSmoothing={0.9} />
        </EffectComposer>
        <SceneLights colors={currentData.colors} />
        <MindModel data={currentData} />
        <OrbitControls enableZoom={true} autoRotate autoRotateSpeed={0.5} />
      </Canvas>
    </div>
  );
}