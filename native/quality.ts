// The look per graphics level: the browser build's four presets and budgets
// (gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the spark count scaled within the tier by the level (frame().levelIndex,
// at most 2×), as gfx.js budgetFor did. The runtime owns the rest of the old
// Graphics panel: Auto and the level choice, render scale and the pixel-ratio
// cap, adaptive resolution, the frame-rate limit and the FPS readout. The
// old per-category overrides are not offered (Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget { material: "lambert" | "standard" | "physical"; segments: number; bevel: number; texture: number; sparks: number; bloomRes: number; aoRes: number }
export interface Look {
  preset: QualityTier; shadows: 0 | 1024 | 2048 | 4096; ao: "off" | "on" | "high"; bloom: boolean; grade: boolean;
  antialias: AntialiasMode; reflections: boolean; detailed: boolean; particles: "low" | "high"; animated: boolean; budget: Budget;
}
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "high", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", segments: 0.5, bevel: 1, texture: 128, sparks: 12, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", segments: 0.75, bevel: 2, texture: 256, sparks: 18, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", segments: 1, bevel: 3, texture: 256, sparks: 24, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", segments: 1.5, bevel: 4, texture: 512, sparks: 36, bloomRes: 1, aoRes: 1 },
};
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const SPARKS_LOW = 6;
export const SPARK_MAX = 72;

export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.23, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  return { preset, ...TABLE[preset], budget: b };
}
export function sparkCount(l: Look): number { return l.particles === "high" ? l.budget.sparks : SPARKS_LOW; }
