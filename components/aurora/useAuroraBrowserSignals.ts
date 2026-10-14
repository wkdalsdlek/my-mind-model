"use client";

import { useSyncExternalStore } from "react";

const compactQuery = "(max-width: 767px), (pointer: coarse) and (max-width: 1100px)";
const reduceQuery = "(prefers-reduced-motion: reduce)";
const serverFalse = () => false;
const serverTrue = () => true;
function subscribeCompact(notify: () => void) { const media = window.matchMedia(compactQuery); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); }
function subscribeReduced(notify: () => void) { const media = window.matchMedia(reduceQuery); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); }
function subscribeVisible(notify: () => void) { document.addEventListener("visibilitychange", notify); return () => document.removeEventListener("visibilitychange", notify); }
const getCompact = () => window.matchMedia(compactQuery).matches;
const getReduced = () => window.matchMedia(reduceQuery).matches;
const getVisible = () => !document.hidden;
export function useAuroraBrowserSignals() {
  const compact = useSyncExternalStore(subscribeCompact, getCompact, serverFalse);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, serverFalse);
  const visible = useSyncExternalStore(subscribeVisible, getVisible, serverTrue);
  return { compact, reduced, visible };
}
