"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createCustomKeyword, QUESTION_DATA, SEMANTIC_PROFILES, type KeywordCapsule, type SelectedCapsule } from "@/lib/capsules";
import type { QuestionResponseStatus } from "@/lib/questionnaire-state";
import styles from "./CapsuleQuestionnaire.module.css";
import { useCapsulePhysics } from "./useCapsulePhysics";
import { useCapsuleDrag } from "./useCapsuleDrag";
import { createCapsuleEffects, type CapsuleEffects } from "./capsule-effects";

interface Props {
  step: number;
  keywords: KeywordCapsule[];
  selected: SelectedCapsule[];
  responseStatus: QuestionResponseStatus;
  busy: boolean;
  onSelect: (keyword: KeywordCapsule) => void;
  onRemove: (selectionId: string) => void;
  onCreate: (keyword: KeywordCapsule) => void;
  onPrevious: () => void;
  onSkip: () => void;
  onNext: () => void;
}

function capsuleStyle(keyword: KeywordCapsule): CSSProperties {
  return { "--capsule-rgb": SEMANTIC_PROFILES[keyword.group].color } as CSSProperties;
}

export default function CapsuleQuestionnaire({ step, keywords, selected, responseStatus, busy, onSelect, onRemove, onCreate, onPrevious, onSkip, onNext }: Props) {
  const question = QUESTION_DATA[step];
  const closingQuestion = question.keywordMode === "personalized";
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [motionPaused, setMotionPaused] = useState(() => {
    try { return typeof window !== "undefined" && sessionStorage.getItem("mind-capsule-motion") === "paused"; }
    catch { return false; }
  });
  const composing = useRef(false);
  const dropZone = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sparkLayer = useRef<HTMLDivElement>(null);
  const trailLayer = useRef<HTMLDivElement>(null);
  const effects = useRef<CapsuleEffects | null>(null);
  const physics = useCapsulePhysics(stage, keywords, busy || motionPaused, event => {
    effects.current?.spark(event, event.ids.map(id => SEMANTIC_PROFILES[keywords.find(keyword => keyword.id === id)?.group ?? "depth"].color));
  }, sample => {
    const group = keywords.find(keyword => keyword.id === sample.id)?.group ?? "depth";
    effects.current?.trail(sample, SEMANTIC_PROFILES[group].color);
  });
  const selectedList = useRef<HTMLDivElement>(null);
  const answerGlow = useRef<HTMLSpanElement>(null);
  const previousSelections = useRef(new Set(selected.map((item) => item.selectionId)));
  const reaction = useRef<Animation | null>(null);

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const toggleMotion = () => {
    const paused = !motionPaused;
    setMotionPaused(paused);
    window.dispatchEvent(new CustomEvent("mind-capsule-motion", { detail: { paused } }));
    try { sessionStorage.setItem("mind-capsule-motion", paused ? "paused" : "running"); }
    catch { /* Motion controls still work when browser storage is unavailable. */ }
  };

  useLayoutEffect(() => {
    if (!sparkLayer.current || !trailLayer.current) return;
    const current = createCapsuleEffects(sparkLayer.current, trailLayer.current, styles.glassDust, styles.lightTrail, styles.collisionFlash);
    effects.current = current;
    return () => { current.destroy(); effects.current = null; };
  }, []);

  useEffect(() => {
    const added = selected.filter((item) => !previousSelections.current.has(item.selectionId));
    previousSelections.current = new Set(selected.map((item) => item.selectionId));
    if (!added.length) return;
    const newest = selectedList.current?.lastElementChild as HTMLElement | null;
    if (newest && dropZone.current) {
      const panel = dropZone.current;
      if (newest.offsetTop + newest.offsetHeight > panel.scrollTop + panel.clientHeight) {
        panel.scrollTo({ top: newest.offsetTop + newest.offsetHeight - panel.clientHeight + 20, behavior: reducedMotion() ? "instant" : "smooth" });
      }
    }
    if (reducedMotion()) return;
    reaction.current?.cancel();
    reaction.current = answerGlow.current?.animate([{ opacity: 0 }, { opacity: 0.7, offset: 0.25 }, { opacity: 0 }], { duration: 700, easing: "ease-out" }) ?? null;
    newest?.animate([{ opacity: 0, transform: "translateY(-10px) scale(.9)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [selected]);

  useEffect(() => () => { reaction.current?.cancel(); }, []);

  const select = (keyword: KeywordCapsule) => {
    if (busy) return;
    onSelect(keyword);
    setAnnouncement(`${keyword.label} 캡슐을 답변에 추가했습니다.`);
  };

  const { start, click, activeId, overDropZone } = useCapsuleDrag({ physics, dropZone, effects, disabled: busy, select });

  const addKeyword = () => {
    const label = input.trim();
    if (!label || busy || composing.current) return;
    onCreate(createCustomKeyword(question.id, input, crypto.randomUUID()));
    setInput("");
    setAnnouncement(`${label} 캡슐이 키워드 공간에 생성되었습니다.`);
    requestAnimationFrame(() => field.current?.scrollTo({ top: field.current.scrollHeight, behavior: reducedMotion() ? "instant" : "smooth" }));
  };

  return (
    <main className={styles.experience} aria-busy={busy}>
      <section className={styles.questionPanel} aria-labelledby="question-title">
        <header className={styles.brand}><span className={styles.brandMark} aria-hidden="true">✦</span> MY MIND MODEL <span className={styles.brandCaption}>내면의 조각들</span></header>
        <div className={styles.questionContent}>
          <div className={styles.progressLabel}><span>내면 탐구</span><span><strong>{String(step + 1).padStart(2, "0")}</strong> / {String(QUESTION_DATA.length).padStart(2, "0")}</span></div>
          <div className={styles.progress} role="progressbar" aria-label="질문 진행 상태" aria-valuemin={1} aria-valuemax={QUESTION_DATA.length} aria-valuenow={step + 1}>
            <span style={{ width: `${((step + 1) / QUESTION_DATA.length) * 100}%` }} />
          </div>
          <p className={styles.category}>{question.category}</p>
          <h1 id="question-title" className={styles.question}>{question.prompt}</h1>
          <p className={styles.hint}>{question.helperText ?? <>마음에 닿는 단어를 이곳으로 옮겨보세요.<br />같은 단어를 여러 번 담아도 좋아요.</>}</p>
          <div className={styles.answerHeading}><h2>내 마음에 담은 단어</h2><span>{selected.length}개의 조각</span></div>
          <div ref={dropZone} className={`${styles.dropZone} ${overDropZone ? styles.dropZoneActive : ""}`} style={{ "--answer-rgb": SEMANTIC_PROFILES[(keywords.find(keyword => keyword.id === activeId) ?? selected[selected.length - 1])?.group ?? "depth"].color } as CSSProperties} aria-label="선택한 답변 캡슐 영역">
            <span ref={answerGlow} className={styles.answerGlow} aria-hidden="true" />
            {selected.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyOrb} aria-hidden="true">＋</span>
                <p>{overDropZone ? "여기에 내려놓으세요" : responseStatus === "skipped" ? "잠시 건너뛴 질문이에요" : "당신의 마음을 담아주세요"}</p>
                <span>캡슐을 끌어오거나, 가볍게 눌러보세요</span>
              </div>
            ) : (
              <div ref={selectedList} className={styles.selectedList}>
                {selected.map((item) => (
                  <button key={item.selectionId} className={`${styles.glassCapsule} ${styles.selectedCapsule}`} style={capsuleStyle(item)} disabled={busy} onClick={() => { onRemove(item.selectionId); setAnnouncement(`${item.label} 캡슐을 답변에서 제거했습니다.`); }} aria-label={`${item.label} 캡슐 제거`} title={`${item.label} — 클릭하여 제거`}>
                    <span className={styles.glassInterior} aria-hidden="true" />
                    <span className={styles.capsuleLabel}>{item.label}</span><span className={styles.removeIcon} aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className={styles.answerHint}>담은 캡슐을 누르면 다시 꺼낼 수 있어요.</p>
        </div>
        <nav className={styles.navigation} aria-label="질문 이동">
          <button className={styles.previous} onClick={onPrevious} disabled={step === 0 || busy}>← 이전</button>
          {question.allowSkip && <button className={styles.skip} onClick={onSkip} disabled={busy || selected.length > 0}>건너뛰기</button>}
          <button className={styles.next} onClick={onNext} disabled={selected.length === 0 || busy}>{busy ? "오로라를 읽는 중…" : step === QUESTION_DATA.length - 1 ? "오로라 만나기 ✦" : "다음 질문 →"}</button>
        </nav>
        <p className={styles.footerNote}>정답은 없어요. 지금의 마음이면 충분해요.</p>
      </section>

      <section className={styles.keywordPanel} aria-labelledby="keyword-title">
        <div className={styles.fieldHeader}><div><p className={styles.eyebrow}>A SPACE FOR YOUR MIND</p><h2 id="keyword-title">마음이 머무는 단어들</h2></div><div className={styles.fieldControls}><span className={styles.fieldHint}>끌어 담기 · 눌러 담기</span><button type="button" className={styles.motionToggle} aria-pressed={motionPaused} aria-label={motionPaused ? "캡슐 부유 시작" : "캡슐 부유 멈추기"} onClick={toggleMotion}>{motionPaused ? "▷ 부유 시작" : "Ⅱ 부유 멈추기"}</button></div></div>
        <div className={styles.ambientLight} aria-hidden="true" />
        <div ref={field} className={styles.capsuleField}>
          <div ref={stage} className={styles.capsuleGrid}>
            <div ref={sparkLayer} className={styles.sparkLayer} aria-hidden="true" />
            <div ref={trailLayer} className={styles.trailLayer} aria-hidden="true" />
            {closingQuestion && !keywords.length && <div className={styles.fieldEmpty}><p>마음에 남기고 싶은 말이 있나요?</p><span>아래에서 단어나 문장을 직접 띄워보세요.</span></div>}
            {keywords.map((keyword) => (
              <div className={styles.capsuleSlot} key={keyword.id}>
                <div className={styles.floatingCapsule} data-floating-id={keyword.id} style={capsuleStyle(keyword)}>
                  <button className={`${styles.glassCapsule} ${styles.sourceCapsule} ${activeId === keyword.id ? styles.sourceActive : ""}`} style={capsuleStyle(keyword)} disabled={busy} title={keyword.label} aria-label={`${keyword.label} 캡슐 추가`} onPointerDown={(event) => start(event, keyword)} onClick={(event) => click(event.detail, keyword)}>
                    <span className={styles.glassInterior} aria-hidden="true" />
                    <span className={styles.capsuleLabel}>{keyword.label}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <form className={styles.keywordComposer} onSubmit={(event) => { event.preventDefault(); addKeyword(); }}>
          <label htmlFor="new-keyword">{closingQuestion ? "마음에 남기고 싶은 말을 띄워보세요" : "여기에 없는 마음도 괜찮아요"}</label>
          <div className={styles.inputShell}>
            <span className={styles.inputSpark} aria-hidden="true">✧</span>
            <input id="new-keyword" value={input} onChange={(event) => setInput(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)) event.preventDefault(); }} placeholder={closingQuestion ? "나만의 단어나 문장을 남겨보세요" : "나만의 단어를 띄워보세요"} maxLength={closingQuestion ? 200 : 16} disabled={busy} autoComplete="off" />
            <button type="submit" disabled={!input.trim() || busy} aria-label="새 키워드 캡슐 생성">↵</button>
          </div>
          <p>단어를 적고 Enter · 같은 단어도 새로 띄울 수 있어요</p>
        </form>
      </section>
      <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
    </main>
  );
}
