"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, OrbitControls, GradientTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three"; 

const QUESTIONS = [
  "[에너지와 자아] 완벽하게 자유로운 주말 이틀이 주어졌을 때, 당신이 가장 '나답다'고 느끼는 시간의 풍경을 묘사해 주세요. 누구와 어디서 무엇을 하고 있나요?",
  "[내면의 잔상] 당신의 마음을 가장 오랫동안 머물게 했던 생각이나 장면이 있다면 무엇인가요? 왜 그것이 당신에게 깊은 잔상을 남겼을까요?",
  "[의사결정 방식] 매우 중요한 결정을 내려야 할 때, 당신은 '데이터(사실)'와 '사람들의 마음(감정)' 중 어느 쪽에 더 무게를 두나요? 당신의 경험을 예로 들어 설명해 주세요.",
  "[위기 대응] 예상치 못한 실수로 계획이 완전히 틀어졌을 때, 당신의 머릿속에 가장 먼저 떠오르는 문장은 무엇인가요? 그 후 첫 번째로 취하는 행동은 무엇인가요?",
  "[소통의 지향점] 당신이 생각하는 '가장 이상적인 대화'는 어떤 모습인가요? (예: 깊이 있는 토론, 가벼운 농담, 침묵이 어색하지 않은 관계 등)",
  "[수용과 방어] 누군가 당신의 노력에 대해 비판을 했을 때, 당신이 그 비판을 수용하거나 거부하는 당신만의 기준은 무엇인가요?",
  "[삶의 핵심 가치] 만약 당신의 삶을 한 권의 책으로 쓴다면, 사람들에게 기억되길 바라는 '가장 핵심적인 한 줄의 문장'은 무엇인가요?",
  "[무조건적인 동기] 보상이 전혀 없더라도 당신이 기꺼이 시간과 노력을 쏟을 수 있는 일은 무엇인가요? 그 일이 당신에게 주는 의미는 무엇인가요?",
  "[회복 탄력성] 마음이 몹시 지쳤을 때, 당신만의 '안전 기지(장소, 행동, 사람 등)'는 어디인가요? 그곳이 왜 당신을 편안하게 만드나요?",
  "[변화와 유지] 나의 모습 중 가장 바꾸고 싶은 부분과, 그럼에도 불구하고 끝까지 지키고 싶은 부분은 각각 무엇인가요?"
];

interface MoodData {
  title?: string;
  colors: [string, string, string]; 
  distort: number; speed: number; wireframe: boolean; roughness: number; glowStrength: number; scale: number;
  comments: { analysis: string; detailedAnalysis: string; effect: string }[]; 
}

function SceneLights({ colors }: { colors: [string, string, string] }) {
  const light1 = useRef<THREE.PointLight>(null!);
  const light2 = useRef<THREE.PointLight>(null!);
  const light3 = useRef<THREE.PointLight>(null!);
  const c1 = useMemo(() => new THREE.Color(), []);
  const c2 = useMemo(() => new THREE.Color(), []);
  const c3 = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    c1.set(colors[0]); c2.set(colors[1]); c3.set(colors[2]);
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
      <Sphere args={[1.5, 130, 130]}>
        <MeshDistortMaterial ref={materialRef} metalness={0.8} roughness={0.2} transparent opacity={0.7} wireframe={data.wireframe} emissive="white">
          <GradientTexture attach="map" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
          <GradientTexture attach="emissiveMap" stops={[0, 0.5, 1]} colors={data.colors} size={1024} />
        </MeshDistortMaterial>
      </Sphere>
    </group>
  );
}

export default function Home() {
  const [step, setStep] = useState(0); 
  const [answers, setAnswers] = useState<string[]>(Array(10).fill("")); 
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResult, setShowResult] = useState(false); 

  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [isDetailedMode, setIsDetailedMode] = useState(false);

  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const SECRET_PASSWORD = "20250208"; 

  const [currentData, setCurrentData] = useState<MoodData>({
    title: "시간이 멈춘 어느 날\n날씨: 맑음",
    colors: ["#14FFF7", "#A316FD", "#FF1493"], distort: 0.4, speed: 2.0, wireframe: true, roughness: 0.2, glowStrength: 0.6, scale: 1.0, comments: []
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === SECRET_PASSWORD) setIsAuthenticated(true);
    else alert("비밀번호가 틀렸습니다.");
  };

  const handleNext = () => {
    if (answers[step].trim() === "") { alert("질문에 대한 답변을 적어주세요."); return; }
    if (step < 9) setStep(step + 1);
  };

  const handlePrev = () => { if (step > 0) setStep(step - 1); };

  const handleAnswerChange = (text: string) => {
    const newAnswers = [...answers];
    newAnswers[step] = text;
    setAnswers(newAnswers);
  };

  const handleAnalyze = async () => {
    if (answers[9].trim() === "") { alert("마지막 답변을 적어주세요."); return; }
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, questions: QUESTIONS }), 
      });
      if (!response.ok) throw new Error("API 요청 실패");
      const data = await response.json();
      setCurrentData({ ...data, wireframe: true });
      setShowResult(true); 
      setIsAnalysisOpen(false); 
    } catch (error) {
      console.error("AI 에러:", error);
      alert("분석 중 문제가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    if(window.confirm("다시 처음부터 성찰하시겠습니까? 작성된 내용은 지워집니다.")) {
      setStep(0); setAnswers(Array(10).fill("")); setShowResult(false);
      setCurrentData({ ...currentData, comments: [] });
      setIsAnalysisOpen(false); setIsDetailedMode(false);
    }
  };

  const openBasicAnalysis = () => { setIsDetailedMode(false); setIsAnalysisOpen(true); };
  const openDetailedAnalysis = () => { setIsDetailedMode(true); setIsAnalysisOpen(true); };

  const formatQuestion = (question: string) => {
    const match = question.match(/^(\[.*?\])\s*(.*)$/);
    const category = match ? match[1] : "";
    const text = match ? match[2] : question;
    const formattedText = text.replace(/([.?])\s+/g, "$1\n");
    return { category, formattedText };
  };

  // 1️⃣ 로그인 화면
  if (!isAuthenticated) {
    return (
      <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", display: "flex", justifyContent: "center", alignItems: "center", color: "white" }}>
        <form onSubmit={handleLogin} style={{ textAlign: "center", padding: "40px", borderRadius: "30px", border: "1px solid #333", backgroundColor: "#0a0a0a" }}>
          <h2 style={{ marginBottom: "20px", fontSize: "24px", fontWeight: "bold" }}>🔐 심리 모델링 입장</h2>
          <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="암호 입력..." style={{ padding: "12px 20px", borderRadius: "15px", border: "1px solid #444", backgroundColor: "#222", color: "white", width: "220px", marginBottom: "25px", textAlign: "center", outline: "none" }} />
          <br /><button type="submit" style={{ padding: "12px 40px", borderRadius: "25px", border: "none", backgroundColor: "#A316FD", color: "white", fontWeight: "bold", cursor: "pointer" }}>입장하기</button>
        </form>
      </div>
    );
  }

  // 2️⃣ 질문 화면
  if (!showResult) {
    const { category, formattedText } = formatQuestion(QUESTIONS[step]);
    return (
      <div style={{ width: "100vw", height: "100vh", backgroundColor: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "white", padding: "20px" }}>
        <div style={{ width: "100%", maxWidth: "600px" }}>
          <p style={{ color: "#A316FD", fontWeight: "bold", marginBottom: "10px", fontSize: "14px" }}>내면 탐구 {step + 1} / 10</p>
          <div style={{ width: "100%", height: "4px", backgroundColor: "#333", borderRadius: "2px", marginBottom: "30px" }}>
            <div style={{ width: `${((step + 1) / 10) * 100}%`, height: "100%", backgroundColor: "#A316FD", borderRadius: "2px", transition: "width 0.3s ease" }} />
          </div>
          <div style={{ marginBottom: "30px" }}>
            {category && <div style={{ display: "inline-block", padding: "6px 16px", backgroundColor: "rgba(163, 22, 253, 0.15)", color: "#c879ff", borderRadius: "20px", fontSize: "14px", fontWeight: "bold", marginBottom: "15px", border: "1px solid rgba(163, 22, 253, 0.3)" }}>{category}</div>}
            <h2 style={{ fontSize: "22px", lineHeight: "1.6", wordBreak: "keep-all", whiteSpace: "pre-wrap" }}>{formattedText}</h2>
          </div>
          <textarea value={answers[step]} onChange={(e) => handleAnswerChange(e.target.value)} placeholder="당신의 솔직한 마음을 편안하게 적어주세요." style={{ width: "100%", height: "150px", padding: "20px", borderRadius: "15px", border: "1px solid #444", backgroundColor: "#111", color: "white", fontSize: "16px", outline: "none", resize: "none", marginBottom: "30px", lineHeight: "1.6" }} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button onClick={handlePrev} disabled={step === 0} style={{ padding: "12px 30px", borderRadius: "20px", border: "1px solid #555", backgroundColor: "transparent", color: step === 0 ? "#555" : "white", cursor: step === 0 ? "not-allowed" : "pointer" }}>이전</button>
            {step < 9 ? (
              <button onClick={handleNext} style={{ padding: "12px 40px", borderRadius: "20px", border: "none", backgroundColor: "#FFFFFF", color: "#000000", fontWeight: "bold", cursor: "pointer", boxShadow: "0 0 15px rgba(255, 255, 255, 0.2)" }}>다음</button>
            ) : (
              <button onClick={handleAnalyze} disabled={isAnalyzing} style={{ padding: "12px 40px", borderRadius: "20px", border: "none", backgroundColor: "#FF1493", color: "white", fontWeight: "bold", cursor: isAnalyzing ? "not-allowed" : "pointer", boxShadow: "0 0 15px rgba(255, 20, 147, 0.4)" }}>{isAnalyzing ? "오로라 생성 중..." : "결과 확인 ✨"}</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3️⃣ 최종 결과 화면
  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", position: "relative", color: "white", overflow: "hidden" }}>
      
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 }}>
        <Canvas camera={{ position: [0, 0, 4.5] }}>
          <EffectComposer>
            <Bloom luminanceThreshold={0.8} intensity={0.5} mipmapBlur luminanceSmoothing={0.9} />
          </EffectComposer>
          <SceneLights colors={currentData.colors} />
          <MindModel data={currentData} />
          <OrbitControls enableZoom={true} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      {!isAnalysisOpen && (
        <div style={{ position: "absolute", top: "10%", width: "100%", display: "flex", justifyContent: "center", zIndex: 5 }}>
           {/* 💡 whiteSpace: "pre-wrap" 속성과 replace 함수를 추가하여 "날씨:" 앞에서 줄바꿈 되도록 처리했습니다. */}
           <h2 style={{ fontSize: "28px", fontWeight: "bold", textShadow: `0 0 20px ${currentData.colors[1]}`, letterSpacing: "1px", textAlign: "center", padding: "0 20px", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
             {currentData.title ? currentData.title.replace(" 날씨:", "\n날씨:") : "당신의 내면을 닮은 오로라"}
           </h2>
        </div>
      )}

      {!isAnalysisOpen && (
        <div style={{ position: "absolute", bottom: "8%", width: "100%", display: "flex", justifyContent: "center", gap: "15px", flexWrap: "wrap", zIndex: 5 }}>
          <button onClick={handleReset} style={{ padding: "12px 25px", borderRadius: "30px", border: "1px solid rgba(255,255,255,0.3)", backgroundColor: "rgba(0,0,0,0.5)", color: "white", cursor: "pointer", backdropFilter: "blur(5px)", transition: "all 0.3s" }}>다시 성찰하기</button>
          <button onClick={openBasicAnalysis} style={{ padding: "12px 25px", borderRadius: "30px", border: "none", backgroundColor: "#14FFF7", color: "black", fontWeight: "bold", cursor: "pointer", boxShadow: `0 0 15px rgba(20, 255, 247, 0.4)`, transition: "all 0.3s" }}>요약 분석 📜</button>
          <button onClick={openDetailedAnalysis} style={{ padding: "12px 25px", borderRadius: "30px", border: "none", backgroundColor: "#A316FD", color: "white", fontWeight: "bold", cursor: "pointer", boxShadow: `0 0 15px rgba(163, 22, 253, 0.4)`, transition: "all 0.3s" }}>심층 분석 🔍</button>
        </div>
      )}

      {/* 분석 결과 사이드 패널 */}
      <div style={{ 
        position: "absolute", top: 0, right: isAnalysisOpen ? 0 : "-100%", 
        width: "100%", maxWidth: "500px", height: "100%", zIndex: 20, 
        backgroundColor: "rgba(10, 10, 10, 0.85)", backdropFilter: "blur(15px)", 
        borderLeft: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", 
        transition: "right 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)" 
      }}>
        
        <div style={{ padding: "20px 30px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* 💡 사이드 패널의 작은 제목에도 줄바꿈이 적용되도록 처리했습니다. */}
            <span style={{ fontSize: "12px", color: "#aaa", marginBottom: "8px", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
              {currentData.title ? currentData.title.replace(" 날씨:", "\n날씨:") : ""}
            </span>
            <h3 style={{ fontSize: "18px", fontWeight: "bold", color: isDetailedMode ? "#A316FD" : "#14FFF7" }}>
              {isDetailedMode ? "🔍 심층 분석 결과" : "📜 요약 분석 결과"}
            </h3>
          </div>
          <button onClick={() => setIsAnalysisOpen(false)} style={{ background: "none", border: "none", color: "white", fontSize: "24px", cursor: "pointer" }}>✖</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "30px" }}>
          {currentData.comments?.map((comment, i) => {
            const { category, formattedText } = formatQuestion(QUESTIONS[i]);
            const textToShow = isDetailedMode 
              ? (comment.detailedAnalysis || comment.analysis || "분석을 불러오지 못했습니다.")
              : (comment.analysis || "분석을 불러오지 못했습니다.");

            return (
              <div key={i} style={{ marginBottom: "30px" }}>
                <p style={{ color: currentData.colors[0], fontWeight: "bold", marginBottom: "10px", fontSize: "14px" }}>
                  Question {i + 1} <span style={{ color: "#888", fontWeight: "normal", marginLeft: "5px" }}>{category}</span>
                </p>
                <div style={{ marginBottom: "15px", padding: "12px", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: "10px", borderLeft: `2px solid #555` }}>
                  <p style={{ fontSize: "12px", color: "#bbb", marginBottom: "6px", whiteSpace: "pre-wrap" }}>Q. {formattedText}</p>
                  <p style={{ fontSize: "14px", color: "#fff" }}>A. {answers[i]}</p>
                </div>
                <p style={{ fontSize: "15px", lineHeight: "1.7", marginBottom: "12px", color: "#eee" }}>
                  {textToShow}
                </p>
                <div style={{ padding: "10px", borderRadius: "8px", backgroundColor: "rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: "12px", color: "#aaa", lineHeight: "1.5" }}>
                    ✨ <strong>오로라 반영:</strong> {comment.effect}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}