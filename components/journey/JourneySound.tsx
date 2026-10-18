"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import styles from "./JourneyIntro.module.css";
export interface JourneySoundHandle { start: () => void }
/** One mounted audio element owns playback through questions, loading and result.
 * No source request or play() before an explicit user gesture. */
export default function JourneySound({ ref }: { ref: Ref<JourneySoundHandle> }) {
  const audio = useRef<HTMLAudioElement>(null), fade = useRef<ReturnType<typeof setInterval> | null>(null), revision = useRef(0);
  const [state, setState] = useState<"idle" | "playing" | "paused" | "unavailable">("idle");
  const stopFade = useCallback(() => { if (fade.current) clearInterval(fade.current); fade.current = null; }, []);
  const unavailable = useCallback(() => { revision.current++; stopFade(); setState("unavailable"); }, [stopFade]);
  const start = useCallback(() => {
    const element = audio.current;
    if (!element || !element.paused) return;
    stopFade(); const id = ++revision.current;
    element.src ||= "/audio/intro-bgm.mp3";
    element.volume = .005;
    try {
      const playing = element.play(); // Must run synchronously in the gesture.
      void playing.then(() => {
        if (id !== revision.current) return;
        setState("playing"); const began = performance.now();
        fade.current = setInterval(() => {
          if (id !== revision.current) { stopFade(); return; }
          const progress = Math.min(1, (performance.now() - began) / 2000);
          element.volume = .005 + (.12 - .005) * progress;
          if (progress === 1) stopFade();
        }, 50);
      }, () => { if (id === revision.current) unavailable(); });
    } catch { unavailable(); }
  }, [stopFade, unavailable]);
  useImperativeHandle(ref, () => ({ start }), [start]);
  const stopPlayback = useCallback((element: HTMLAudioElement | null) => {
    revision.current++; stopFade(); element?.pause();
  }, [stopFade]);
  useEffect(() => {
    const element = audio.current;
    return () => stopPlayback(element);
  }, [stopPlayback]);
  return <div className={styles.sound}>
    <audio ref={audio} loop preload="none" onError={unavailable} aria-label="Silent Void 배경음악" />
    <button type="button" aria-label={state === "playing" ? "배경음악 끄기" : "배경음악 재생"} aria-pressed={state === "playing"} onClick={() => {
      if (state === "playing") { revision.current++; stopFade(); audio.current?.pause(); setState("paused"); }
      else start();
    }}>{state === "playing" ? "♫ 음악 끄기" : "♪ 음악 재생"}</button>
    {state === "unavailable" && <span role="status">음원을 재생할 수 없어요. 감상은 계속할 수 있어요.</span>}
  </div>;
}
