"use client";

import { useEffect, useLayoutEffect, useState, useRef, useMemo, useReducer } from "react";

import CapsuleQuestionnaire from "@/components/questionnaire/CapsuleQuestionnaire";
import QuestionAtmosphere from "@/components/questionnaire/QuestionAtmosphere";
import { createKeywordPools, createSelectedCapsule, QUESTION_DATA, QUESTIONS, type KeywordCapsule } from "@/lib/capsules";
import { createQuestionnaireState, firstIncompleteQuestion, getApprovedClosingMessage, questionnaireReducer } from "@/lib/questionnaire-state";
import { buildClosingMessageInput, closingInputFingerprint } from "@/lib/closing-message";
import { ClosingMessageRequestController } from "@/lib/closing-message-client";

import AuroraResultScreen from "@/components/result/AuroraResultScreen";
import { prepareAuroraResult } from "@/lib/aurora-result";
import { AuroraUniverseRequestController, auroraUniverseFailureMessage, type AuroraUniverseResult, type AuroraUniversePhase } from "@/lib/aurora-universe";
import styles from "@/app/page.module.css";

export default function MindJourney() {
  const [step, setStep] = useState(0);
  const [questionnaire, dispatchQuestionnaire] = useReducer(questionnaireReducer, undefined, createQuestionnaireState);
  const { selections, responses } = questionnaire;
  const [keywordPools, setKeywordPools] = useState(createKeywordPools);
  const closingDraft = questionnaire.closing.authoredText;
  const closingKeywordDraft = questionnaire.closing.authoredWord;
  const [closingRequests] = useState(() => new ClosingMessageRequestController());
  const closingInput = useMemo(() => buildClosingMessageInput({ selections, responses }, closingDraft, closingKeywordDraft), [selections, responses, closingDraft, closingKeywordDraft]);
  const closingFingerprint = closingInputFingerprint(closingInput);
  const approvedClosingMessage = getApprovedClosingMessage(questionnaire);
  useEffect(() => {
    if (step !== 9 || (closingRequests.fingerprint && closingRequests.fingerprint !== closingFingerprint)) {
      closingRequests.cancel();
      dispatchQuestionnaire({ type: "closing-cancel" });
    }
  }, [step, closingFingerprint, closingRequests]);
  useEffect(() => () => closingRequests.cancel(), [closingRequests]);
  const cancelClosingRequest = () => { closingRequests.cancel(); dispatchQuestionnaire({ type: "closing-cancel" }); };
  const setClosingDraft = (text: string) => { cancelClosingRequest(); dispatchQuestionnaire({ type: "closing-input", field: "authoredText", text }); };
  const setClosingKeywordDraft = (text: string) => { cancelClosingRequest(); dispatchQuestionnaire({ type: "closing-input", field: "authoredWord", text }); };
  const generateClosingMessage = () => {
    if (step !== 9 || isAnalyzing || questionnaire.closing.request) return;
    const previousText = questionnaire.closing.aiDraft?.inputFingerprint === closingFingerprint ? questionnaire.closing.aiDraft.text : undefined;
    void closingRequests.generate(closingInput, previousText, {
      start: (id, inputFingerprint) => dispatchQuestionnaire({ type: "closing-start", id, inputFingerprint }),
      success: (id, inputFingerprint, text) => dispatchQuestionnaire({ type: "closing-success", id, inputFingerprint, text }),
      failure: (id, inputFingerprint, code) => dispatchQuestionnaire({ type: "closing-failure", id, inputFingerprint, code }),
    });
  };
  const closingKeywords = useMemo(() => [...questionnaire.personalization.recommendations, ...keywordPools[9]], [questionnaire.personalization.recommendations, keywordPools]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AuroraUniverseResult | null>(null);
  const [analysisRequests] = useState(() => new AuroraUniverseRequestController());
  const [analysisPhase, setAnalysisPhase] = useState<AuroraUniversePhase>("preparing");
  const [analysisError, setAnalysisError] = useState("");
  const latestQuestionnaire = useRef(questionnaire);
  useLayoutEffect(() => { latestQuestionnaire.current = questionnaire; }, [questionnaire]);
  useEffect(() => {
    if (analysisRequests.fingerprint && (analysisRequests.fingerprint !== closingFingerprint || !approvedClosingMessage)) analysisRequests.cancel();
  }, [analysisRequests, closingFingerprint, approvedClosingMessage]);
  useEffect(() => () => analysisRequests.cancel(false), [analysisRequests]);
  const showResult = result !== null && result.snapshot.inputFingerprint === approvedClosingMessage?.inputFingerprint
    && result.snapshot.personalization.approvedTitle.text === approvedClosingMessage?.text
    && result.snapshot.personalization.approvedTitle.source === approvedClosingMessage?.source;

  const handleNext = () => {
    if (isAnalyzing || selections[step].length === 0) return;
    if (step < QUESTIONS.length - 1) setStep(step + 1);
  };

  const handlePrev = () => { if (!isAnalyzing && step > 0) { cancelClosingRequest(); setStep(step - 1); } };

  const handleSkip = () => {
    if (isAnalyzing || !QUESTION_DATA[step].allowSkip || selections[step].length) return;
    dispatchQuestionnaire({ type: "skip", step });
    setStep(step + 1);
  };

  const handleSelect = (keyword: KeywordCapsule) => {
    if (isAnalyzing) return;
    cancelClosingRequest();
    const selection = createSelectedCapsule(keyword, QUESTION_DATA[step].id, crypto.randomUUID());
    dispatchQuestionnaire({ type: "select", step, selection });
  };

  const handleRemove = (selectionId: string) => {
    if (isAnalyzing) return;
    cancelClosingRequest();
    dispatchQuestionnaire({ type: "remove", step, selectionId });
  };

  const handleCreateKeyword = (keyword: KeywordCapsule) => {
    if (isAnalyzing) return;
    setKeywordPools((previous) => previous.map((items, index) => index === step ? [...items, keyword] : items));
  };

  const handleAnalyze = () => {
    if (isAnalyzing || analysisRequests.busy) return;
    const prepared = prepareAuroraResult(questionnaire);
    if (!prepared.ready) {
      setStep(prepared.step);
      if (prepared.failure) setAnalysisError(auroraUniverseFailureMessage("INVALID_INPUT"));
      return;
    }
    const snapshot = prepared.snapshot;
    void analysisRequests.generate(questionnaire, {
      isCurrent: () => {
        const approval = getApprovedClosingMessage(latestQuestionnaire.current);
        return approval?.inputFingerprint === snapshot.inputFingerprint && approval.text === snapshot.personalization.approvedTitle.text
          && approval.source === snapshot.personalization.approvedTitle.source && firstIncompleteQuestion(latestQuestionnaire.current) === -1;
      },
      start: () => { setIsAnalyzing(true); setAnalysisError(""); },
      phase: setAnalysisPhase,
      success: completed => setResult(completed),
      failure: code => setAnalysisError(auroraUniverseFailureMessage(code)),
      settled: () => setIsAnalyzing(false),
    });
  };

  const handleReset = () => {
    if (window.confirm("다시 처음부터 성찰하시겠습니까? 작성된 내용은 지워집니다.")) {
      analysisRequests.cancel(); closingRequests.cancel();
      setStep(0); dispatchQuestionnaire({ type: "reset" }); setKeywordPools(createKeywordPools());
      setResult(null); setIsAnalyzing(false); setAnalysisError("");
    }
  };

  // Generate only the new interpretation; preserve legacy analyze for compatibility.
  if (!showResult || !result) {
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
          closingState={questionnaire.closing}
          closingInput={closingInput}
          closingApproved={!!approvedClosingMessage}
          onGenerateClosing={generateClosingMessage}
          onEditClosing={text => { cancelClosingRequest(); dispatchQuestionnaire({ type: "closing-edit", text }); }}
          onApproveClosing={direct => dispatchQuestionnaire({ type: "closing-approve", direct, approvedAt: new Date().toISOString() })}
          busy={isAnalyzing}
          onSelect={handleSelect}
          onRemove={handleRemove}
          onCreate={handleCreateKeyword}
          onPrevious={handlePrev}
          onSkip={handleSkip}
          onNext={step === QUESTIONS.length - 1 ? handleAnalyze : handleNext}
        />
        {(isAnalyzing || analysisError) && <aside className={styles.analysisStatus} aria-label="오로라 해석 요청" aria-busy={isAnalyzing}>
          {isAnalyzing ? <><p role="status" aria-live="polite">{analysisPhase === "preparing" ? "당신의 답변으로 빛의 구성을 준비하고 있어요."
            : analysisPhase === "requesting" ? "오로라의 의미와 마지막 문장에 어울리는 철학적 시선을 읽고 있어요." : "완성된 해석과 실제 리본의 연결을 확인하고 있어요."}</p>
            <button type="button" onClick={() => analysisRequests.cancel()}>요청 취소</button></>
            : <><p role="alert">{analysisError}</p><button type="button" onClick={handleAnalyze}>해석 다시 요청하기</button>
              <button type="button" onClick={() => setAnalysisError("")}>닫기</button></>}
        </aside>}
      </QuestionAtmosphere>
    );
  }

  return <AuroraResultScreen result={result} onReset={handleReset} busy={isAnalyzing} requestError={analysisError}
    onRetryInterpretation={handleAnalyze} onCancelInterpretation={() => analysisRequests.cancel()}
    onReviewClosing={() => { analysisRequests.cancel(); setResult(null); setAnalysisError(""); setStep(9); }} />;
}
