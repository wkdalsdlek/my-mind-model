"use client";

import { useState, useRef, useMemo, useReducer, type ComponentRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, OrbitControls, GradientTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three"; 

import CapsuleQuestionnaire from "@/components/questionnaire/CapsuleQuestionnaire";
import QuestionAtmosphere from "@/components/questionnaire/QuestionAtmosphere";
import { createKeywordPools, createSelectedCapsule, QUESTION_DATA, QUESTIONS, type KeywordCapsule } from "@/lib/capsules";
import { createQuestionnaireState, firstIncompleteQuestion, questionnaireReducer, serializeLegacyAnswers } from "@/lib/questionnaire-state";

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
  const materialRef = useRef<ComponentRef<typeof MeshDistortMaterial> & { speed: number }>(null!);
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
      <Sphere args={[1.5, 75, 75]}>
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
  const [questionnaire, dispatchQuestionnaire] = useReducer(questionnaireReducer, undefined, createQuestionnaireState);
  const { selections, responses } = questionnaire;
  const [keywordPools, setKeywordPools] = useState(createKeywordPools);
  const [closingDraft, setClosingDraft] = useState("");
  const [closingKeywordDraft, setClosingKeywordDraft] = useState("");
  const closingKeywords = useMemo(() => [...questionnaire.personalization.recommendations, ...keywordPools[9]], [questionnaire.personalization.recommendations, keywordPools]);
  const answers = serializeLegacyAnswers(questionnaire);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResult, setShowResult] = useState(false); 

  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [isDetailedMode, setIsDetailedMode] = useState(false);

  const [passwordInput, setPasswordInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const SECRET_PASSWORD = "202220707"; 

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
    if (isAnalyzing || selections[step].length === 0) return;
    if (step < QUESTIONS.length - 1) setStep(step + 1);
  };

  const handlePrev = () => { if (!isAnalyzing && step > 0) setStep(step - 1); };

  const handleSkip = () => {
    if (isAnalyzing || !QUESTION_DATA[step].allowSkip || selections[step].length) return;
    dispatchQuestionnaire({ type: "skip", step });
    setStep(step + 1);
  };

  const handleSelect = (keyword: KeywordCapsule) => {
    if (isAnalyzing) return;
    const selection = createSelectedCapsule(keyword, QUESTION_DATA[step].id, crypto.randomUUID());
    dispatchQuestionnaire({ type: "select", step, selection });
  };

  const handleRemove = (selectionId: string) => {
    if (isAnalyzing) return;
    dispatchQuestionnaire({ type: "remove", step, selectionId });
  };

  const handleCreateKeyword = (keyword: KeywordCapsule) => {
    if (isAnalyzing) return;
    setKeywordPools((previous) => previous.map((items, index) => index === step ? [...items, keyword] : items));
  };

  const handleAnalyze = async () => {
    if (isAnalyzing) return;
    const unanswered = firstIncompleteQuestion(questionnaire);
    if (unanswered !== -1) {
      setStep(unanswered);
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, questions: QUESTIONS }), 
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        alert(errorData?.code === "AI_NOT_CONFIGURED"
          ? "AI 분석 서비스가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요. 선택한 답변은 그대로 유지됩니다."
          : "분석 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const data = await response.json();
      setCurrentData({ ...data, wireframe: true });
      setShowResult(true); 
      setIsAnalysisOpen(false); 
    } catch {
      alert("분석 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요. 선택한 답변은 그대로 유지됩니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    if(window.confirm("다시 처음부터 성찰하시겠습니까? 작성된 내용은 지워집니다.")) {
      setStep(0); dispatchQuestionnaire({ type: "reset" }); setKeywordPools(createKeywordPools()); setShowResult(false);
      setClosingDraft("");
      setClosingKeywordDraft("");
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

  // Keyword selections are serialized only at the boundary with the existing API.
  if (!showResult) {
    return (
      <QuestionAtmosphere step={step}>
        <CapsuleQuestionnaire
          key={step}
          step={step}
          keywords={step === 9 ? closingKeywords : keywordPools[step]}
          selected={selections[step]}
          responseStatus={responses[step].status}
          personalization={questionnaire.personalization}
          closingDraft={closingDraft}
          onClosingDraftChange={setClosingDraft}
          closingKeywordDraft={closingKeywordDraft}
          onClosingKeywordDraftChange={setClosingKeywordDraft}
          busy={isAnalyzing}
          onSelect={handleSelect}
          onRemove={handleRemove}
          onCreate={handleCreateKeyword}
          onPrevious={handlePrev}
          onSkip={handleSkip}
          onNext={step === QUESTIONS.length - 1 ? handleAnalyze : handleNext}
        />
      </QuestionAtmosphere>
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
