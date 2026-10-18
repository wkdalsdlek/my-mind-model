import { AURORA_REPORT_HEADINGS, AURORA_REPORT_SECTIONS, type AuroraInterpretationResult, type AuroraRibbonInterpretationFacts } from "@/lib/aurora-interpretation-types";
import { auroraVisualReading } from "@/lib/aurora-visual-reading";
import { isVerifiedPhilosophyQuote } from "@/lib/philosophy-quotes";
import { QUESTION_DATA } from "@/lib/question-data";
import styles from "./AuroraResultScreen.module.css";

type RibbonText = AuroraInterpretationResult["generated"]["ribbons"][number];
export function RibbonVisualReading({ ribbon }: { ribbon: AuroraRibbonInterpretationFacts }) {
  const visual = auroraVisualReading(ribbon);
  return <div className={styles.visualReading}>
    <div className={styles.colorNames}>{visual.colors.map((color, i) => <p key={i}><span className={styles.colorDot} style={{ backgroundColor: color.color }} aria-hidden="true" />{color.name}<small>{color.explanation}</small></p>)}</div>
    <p className={styles.scopeNote}>{visual.motion}</p><p className={styles.scopeNote}>{visual.structure}</p>
    <p className={styles.scopeNote}>{visual.light}</p><p className={styles.scopeNote}>{visual.limitation}</p>
  </div>;
}
export function RibbonDeepReading({ ribbon, reading }: { ribbon: AuroraRibbonInterpretationFacts; reading?: RibbonText }) {
  return <>
    <div className={styles.composition} aria-label="이 리본의 의미 구성">{ribbon.composition.length ? ribbon.composition.map(s => <span key={s.familyId}>{s.label} {Math.round(s.withinPairShare * 100)}%</span>) : <span>중립적인 빛</span>}</div>
    <h3>내가 남긴 선택에서</h3>
    {ribbon.evidence.length ? <ul className={styles.evidence}>{ribbon.evidence.map(e => <li key={e.ref}><small>{e.questionId.toUpperCase()} · {QUESTION_DATA.find(q => q.id === e.questionId)?.category}</small><p>{e.originalText}</p></li>)}</ul> : <p className={styles.scopeNote}>핵심 선택에 직접 연결되지 않은 중립 표현입니다.</p>}
    {ribbon.repeatedTexts.length > 0 && <p className={styles.scopeNote}>같은 표현이 반복된 문항: {ribbon.repeatedTexts.map(t => t.questionIds.map(q => q.toUpperCase()).join("·")).join(", ")}. 반복은 기존 의미 계산에만 반영되며 성격의 강도를 확정하지 않습니다.</p>}
    <p className={styles.interpretationText}>{reading?.psychological.text ?? "아직 해석을 완성하지 못했어요. 실제 선택을 먼저 돌아볼 수 있어요."}</p>
    {reading?.currentMind && <><h3>지금의 마음과 함께 읽기</h3><p className={styles.interpretationText}>{reading.currentMind.text}</p></>}
    {reading && <><h3>당신에게서 읽히는 모습</h3><p className={styles.interpretationText}>{reading.philosophical.text}</p></>}
    <h3>빛으로 표현된 방식</h3><RibbonVisualReading ribbon={ribbon} />
    {reading && <div className={styles.reflection}><h3>나에게 남기는 질문</h3><p>{reading.reflectionQuestion}</p></div>}
  </>;
}
export function AuroraFullReading({ interpretation, visualRibbons = interpretation.facts.ribbons }: { interpretation: AuroraInterpretationResult; visualRibbons?: readonly AuroraRibbonInterpretationFacts[] }) {
  const { generated, facts } = interpretation;
  const quote = isVerifiedPhilosophyQuote(generated.philosophy.line) ? generated.philosophy.line : null;
  return <div className={styles.essay}>
    {interpretation.situation && <div className={styles.situationReference}><h3>지금 내가 들려준 이야기</h3><p>{interpretation.situation.rawText}</p></div>}
    <section><h3>당신의 마음이 보여준 전체적인 모습</h3><p>{generated.overall.text}</p></section>
    <section><h3>오로라를 이루는 리본들</h3>{facts.ribbons.map(ribbon => {
      const reading = generated.ribbons.find(r => r.ribbonId === ribbon.ribbonId);
      return <article key={ribbon.ribbonId} data-reading-ribbon-id={ribbon.ribbonId}><h4>{ribbon.name}</h4><p>{reading?.reportSummary?.text ?? reading?.psychological.text}</p>
        <details className={styles.reference}><summary>이 리본의 실제 선택과 빛</summary><ul className={styles.evidence}>{ribbon.evidence.map(e => <li key={e.ref}><small>{e.questionId.toUpperCase()}</small><p>{e.originalText}</p></li>)}</ul><RibbonVisualReading ribbon={visualRibbons.find(r => r.ribbonId === ribbon.ribbonId) ?? ribbon} /></details></article>;
    })}</section>
    {generated.report && AURORA_REPORT_SECTIONS.map(section => <section key={section} data-report-section={section}><h3>{AURORA_REPORT_HEADINGS[section]}</h3><p>{generated.report![section].text}</p></section>)}
    <div className={styles.approvedReference}><h3>내가 승인한 마지막 문장</h3><p>{interpretation.approvedClosing.text}</p></div>
    {quote && <figure className={styles.philosophy} data-quote-placement="report-end"><blockquote cite={quote.source.url} className={styles.quote}>{quote.text}</blockquote>
      <figcaption>{quote.philosopher}{quote.source.attributionNote.includes("플라톤") ? " · 플라톤의 말을 전하며" : ""}<a href={quote.source.url} target="_blank" rel="noopener noreferrer">{quote.source.work} · {quote.source.locator} 원문 ↗</a></figcaption>
      <p className={styles.quoteReason}>{generated.philosophy.reason.join(" ")}</p>
      <details className={styles.reference}><summary>출처와 번역</summary><p lang="la" className={styles.originalQuote}>{quote.originalText}</p><p>{quote.source.attributionNote}</p><p>{quote.translation.note}</p></details>
    </figure>}
  </div>;
}
