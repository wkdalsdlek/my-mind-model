"use client";

import { useEffect, useRef, useState } from "react";
import { INTRO_SENTENCE, SITUATION_EXAMPLES, SITUATION_MAX_CHARACTERS, validJourneySituation } from "@/lib/journey-context";
import styles from "./JourneyIntro.module.css";
export default function JourneyIntro({ value, onChange, onStart, leaving }: { value: string; onChange: (text: string) => void; onStart: () => void; leaving: boolean }) {
  const [composing, setComposing] = useState(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className={styles.intro} data-leaving={leaving} aria-labelledby="journey-intro-title" inert={leaving}>
    <div className={styles.dust} aria-hidden="true" />
    <div className={styles.introContent}>
      <p className={styles.sentence}>{INTRO_SENTENCE}</p>
      <form className={styles.introForm} onSubmit={event => { event.preventDefault(); if (!composing && validJourneySituation(value) && !leaving) onStart(); }}>
        <h1 id="journey-intro-title" ref={heading} tabIndex={-1}>당신은 지금 어떤 사람인가요?</h1>
        <p id="situation-help">지금 당신이 살아가는 모습이나 처한 상황을 짧게 들려주세요. 이 이야기는 마지막에 당신의 오로라를 읽는 데 사용됩니다.</p>
        <label className={styles.srOnly} htmlFor="journey-situation">현재 나의 상황</label>
        <textarea id="journey-situation" name="situation" rows={3} value={value} aria-describedby="situation-help situation-count" onChange={e => onChange(e.target.value)}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="한두 문장으로, 지금의 나를 들려주세요." />
        <p id="situation-count" className={styles.count} aria-live="polite">{[...value].length} / {SITUATION_MAX_CHARACTERS}자{[...value].length > SITUATION_MAX_CHARACTERS ? " · 이야기를 조금 줄여 주세요." : ""}</p>
        <details className={styles.examples}><summary>이런 이야기로 시작해도 좋아요</summary><div>{SITUATION_EXAMPLES.map(example => <button key={example} type="button" onClick={() => onChange(example)}>{example}</button>)}</div></details>
        <button className={styles.start} type="submit" disabled={!validJourneySituation(value) || composing || leaving}>나의 마음 들여다보기</button>
      </form>
    </div>
  </section>;
}
export function SituationEditor({ value, onSave, onClose }: { value: string; onSave: (text: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value), dialog = useRef<HTMLDialogElement>(null), composing = useRef(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={styles.editor} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="situation-editor-title">
    <form onSubmit={event => { event.preventDefault(); if (!composing.current && validJourneySituation(draft)) onSave(draft); }}>
      <h2 id="situation-editor-title">지금의 이야기 수정</h2>
      <p id="situation-editor-help">선택한 답변과 승인 문장은 유지해요. 이야기가 바뀌면 오로라 해석은 다시 읽습니다.</p>
      <label htmlFor="situation-edit">현재 나의 상황</label>
      <textarea id="situation-edit" rows={4} value={draft} onChange={e => setDraft(e.target.value)} aria-describedby="situation-editor-help situation-edit-count" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      <p id="situation-edit-count">{[...draft].length} / {SITUATION_MAX_CHARACTERS}자</p>
      <div><button type="button" onClick={onClose}>취소</button><button type="submit" disabled={!validJourneySituation(draft)}>이야기 저장</button></div>
    </form>
  </dialog>;
}
