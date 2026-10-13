import { CLOSING_ERRORS, closingInputFingerprint, directClosingText, hasClosingInput, validFinalClosingText, type ClosingMessageInput } from "@/lib/closing-message";
import type { ClosingMessageState } from "@/lib/closing-message-state";
import styles from "./CapsuleQuestionnaire.module.css";

interface Props {
  state: ClosingMessageState;
  input: ClosingMessageInput;
  busy: boolean;
  onGenerate: () => void;
  onEdit: (text: string) => void;
  onApprove: (direct?: boolean) => void;
}
export default function Q10ClosingMessage({ state, input, busy, onGenerate, onEdit, onApprove }: Props) {
  const fingerprint = closingInputFingerprint(input);
  const draft = state.editedDraft ?? state.aiDraft;
  const stale = !!draft && draft.inputFingerprint !== fingerprint;
  const approved = state.approved?.inputFingerprint === fingerprint ? state.approved : null;
  const loading = !!state.request;
  const direct = directClosingText(input);
  const canApprove = !!draft && !stale && validFinalClosingText(draft.text) && !loading && !busy;
  return <section className={styles.sentencePanel} aria-labelledby="closing-sentence-title" aria-busy={loading}>
    <h2 id="closing-sentence-title">마음에 남길 한 문장</h2>
    <p className={styles.sentenceHint}>담은 표현과 직접 쓴 말로, 마음에 남길 한 문장을 만들어보세요. 아직 답변에 담지 않은 입력도 함께 사용해요.</p>
    <div className={styles.sentenceActions}>
      <button type="button" onClick={onGenerate} disabled={busy || loading || !hasClosingInput(input)}>{loading ? "마음의 문장을 만드는 중…" : state.aiDraft ? "다시 생성" : "나의 문장 만들기"}</button>
      <button type="button" disabled={busy || loading} onClick={() => onEdit(state.editedDraft?.text ?? state.aiDraft?.text ?? direct)}>{draft ? "직접 수정" : "직접 문장 작성"}</button>
    </div>
    <p role="status" aria-live="polite" className={styles.sentenceStatus}>{loading ? "입력한 마음을 한 문장으로 정리하고 있어요. 답변을 바꾸거나 이전 질문으로 이동하면 요청을 취소해요." : approved ? "이 문장으로 결정했어요." : stale ? "이전 입력으로 만든 초안이에요. 새로 생성하거나 직접 수정한 뒤 결정해 주세요." : draft ? "아직 결정하지 않은 초안이에요." : "AI를 사용하지 않고 직접 쓴 문장으로 결정해도 좋아요."}</p>
    {state.error && <p className={styles.sentenceError} role="alert">{CLOSING_ERRORS[state.error]}</p>}
    {state.notice && <p className={styles.recommendationNotice}>{state.notice}</p>}
    {state.aiDraft && <div className={styles.sentencePreview}><span>AI가 만든 초안{state.aiDraft.inputFingerprint !== fingerprint ? " · 이전 입력" : ""}</span><p>{state.aiDraft.text}</p></div>}
    {state.editedDraft && <div className={styles.sentenceEditor}>
      <label htmlFor="edited-closing-sentence">{state.editedDraft.source === "user-edited" ? "내가 수정한 문장" : "내가 직접 쓴 최종 문장"}</label>
      <textarea id="edited-closing-sentence" value={state.editedDraft.text} onChange={event => onEdit(event.target.value)} maxLength={1000} rows={3} disabled={busy || loading} />
      <p>짧게 적어도 괜찮아요. 최대 1000자까지 남길 수 있어요.</p>
    </div>}
    {draft && <button className={styles.sentenceApprove} type="button" onClick={() => onApprove()} disabled={!canApprove || !!approved}>이 문장으로 결정하기</button>}
    {direct && <div className={styles.directSentence}><p>직접 쓴 원문으로 결정할 수 있어요.</p><blockquote>{direct}</blockquote><button type="button" disabled={busy || loading || !validFinalClosingText(direct)} onClick={() => onApprove(true)}>AI 없이 내 문장으로 결정하기</button></div>}
    {approved && <div className={styles.approvedSentence} role="status"><span>결정한 문장 · {approved.source === "ai" ? "AI 초안 승인" : approved.source === "user-edited" ? "직접 수정 후 승인" : "직접 작성 후 승인"}</span><p>{approved.text}</p><small>이 문장은 다음 오로라 단계에 사용할 수 있도록 저장했어요.</small></div>}
  </section>;
}
