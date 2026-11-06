// The look per graphics level. The engine owns shadows, ambient occlusion,
// bloom, the grade and the anti-aliasing (levelSettings(): the frame's level);
// the browser build's art columns and budgets (gfx.js TABLE / BUDGETS: materials,
// mesh detail, reflections, paving) stay keyed by the runtime's quality tier
// (frame().quality), with the spark count scaled within the tier by the level's
// particle budget (at most 2×). The runtime owns the rest of the old Graphics
// panel: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and the FPS readout. The old
// per-category overrides are not offered (Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget { material: "lambert" | "standard" | "physical"; segments: number; bevel: number; texture: number; sparks: number }
interface Art { reflections: boolean; detailed: boolean; particles: "low" | "high"; animated: boolean }
export interface Look extends Art {
  preset: QualityTier;
  /** The level's shadow map size, 0 = off. */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution, null = off. */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  budget: Budget;
}
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { reflections: true, detailed: true, particles: "high", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", segments: 0.5, bevel: 1, texture: 128, sparks: 12 },
  balanced: { material: "standard", segments: 0.75, bevel: 2, texture: 256, sparks: 18 },
  high: { material: "physical", segments: 1, bevel: 3, texture: 256, sparks: 24 },
  ultra: { material: "physical", segments: 1.5, bevel: 4, texture: 512, sparks: 36 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const SPARKS_LOW = 6;
export const SPARK_MAX = 72;

export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, texture: Math.min(b.texture, s.maxTextureSize), sparks: Math.min(SPARK_MAX, Math.round(b.sparks * k)) },
  };
}
export function sparkCount(l: Look): number { return l.particles === "high" ? l.budget.sparks : SPARKS_LOW; }
