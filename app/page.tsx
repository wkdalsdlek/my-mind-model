"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, OrbitControls, GradientTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three"; 

// 1. 데이터 규격 (심장 박동 관련 항목 제거)
interface MoodData {
  colors: [string, string, string]; 
  distort: number;   
  speed: number;     
  wireframe: boolean; 
  roughness: number; 
  glowStrength: number; 
  scale: number;
}

// 2. 부드러운 조명 전환 컴포넌트 (밝기 최적화)
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
    // 조명 강도를 1.5에서 0.8 정도로 낮게 유지하여 눈부심 방지
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

// 3. 3D 심리 모델 컴포넌트
function MindModel({ data }: { data: MoodData }) {
  const materialRef = useRef<any>(null!);
  const groupRef = useRef<THREE.Group>(null!); 

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.distort = data.distort;
      materialRef.current.speed = data.speed;
      materialRef.current.roughness = data.roughness;
      materialRef.current.emissiveIntensity = data.glowStrength;
    }
  }, []);

  useFrame(() => {
    // 수치 보간 (Lerp)
    if (materialRef.current) {
      materialRef.current.distort = THREE.MathUtils.lerp(materialRef.current.distort, data.distort, 0.05);
      materialRef.current.speed = THREE.MathUtils.lerp(materialRef.current.speed, data.speed, 0.05);
      materialRef.current.roughness = THREE.MathUtils.lerp(materialRef.current.roughness, data.roughness, 0.05);
      materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(materialRef.current.emissiveIntensity, data.glowStrength, 0.05);
    }

    // 크기 보간 (박동 제거됨)
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
          metalness={0.8}       // 금속성을 높여 깊이감 부여
          roughness={0.2}       // 질감 조정
          transparent           
          opacity={0.7}         // 살짝 투명하게 하여 맑은 느낌
          wireframe={data.wireframe}
          emissive="white"      
        >
          <GradientTexture attach="map" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
          <GradientTexture attach="emissiveMap" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
        </MeshDistortMaterial>
      </Sphere>
    </group>
  );
}

// 4. 메인 화면
export default function Home() {
  const [inputText, setInputText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // 초기 밝기를 낮춘 기본 데이터
  const [currentData, setCurrentData] = useState<MoodData>({
    colors: ["#14FFF7", "#A316FD", "#FF1493"],
    distort: 0.4, 
    speed: 2.0, 
    wireframe: true, 
    roughness: 0.2, 
    glowStrength: 0.6, // 은은한 초기 밝기
    scale: 1.0
  });

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
      
      setCurrentData({
        ...data,
        wireframe: true
      });

    } catch (error) {
      console.error("AI 에러:", error);
      alert("AI 분석 중 문제가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", display: "flex", flexDirection: "column", color: "white", overflow: "hidden" }}>
      
      {/* 입력창 UI */}
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
          {isAnalyzing ? "분석 중..." : "변화 확인"}
        </button>
      </div>

      <Canvas camera={{ position: [0, 0, 4.5] }} style={{ flex: 1 }}>
        <EffectComposer>
          {/* 눈부심을 억제한 Bloom 설정 */}
          <Bloom 
            luminanceThreshold={0.8} // 밝은 부분만 빛나게 제한
            intensity={0.5}          // 전체 광량 하향
            mipmapBlur 
            luminanceSmoothing={0.9} 
          />
        </EffectComposer>
        <SceneLights colors={currentData.colors} />
        <MindModel data={currentData} />
        <OrbitControls enableZoom={true} autoRotate autoRotateSpeed={0.5} />
      </Canvas>
    </div>
  );
}