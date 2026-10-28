// The browser build's pure game modules, typed for this client: the rules
// (rules.js: seeded content, legality, dispatch, scoring, the solver and
// hints; a classic UMD script that sets globalThis.TTRules when imported) and
// the save model (save.js).
import "../rules.js";
import * as save from "../save.js";

export interface Vehicle { c: number; cap: number; n: number }
export interface State {
  cfgId: string; version: number; seed: number; holdingCap: number; moveLimit: number; tick: number;
  q: number[][]; h: number[]; v: Vehicle[]; boarded: number; dispatches: number; invalid: number;
  fullBoards: number; holdingAccum: number; status: "active" | "won" | "lost"; reason: string | null; par: number;
}
export interface Cfg { id: string; seed: number; theme: string; moveLimit: number }
export interface Events {
  boarded: { queue: number; color: number }[]; displaced: { queue: number; color: number }[];
  fromHolding: number; full: boolean; match: boolean; queue: number; color: number;
}
export interface Preview { ok: boolean; reason?: string; match?: boolean; boards?: number }
export interface Score { completion: number; board: number; full: number; spare: number; invalidPenalty: number; holdingPenalty: number; total: number }
export interface Hint { v: number; q: number }
interface RulesApi {
  JOURNEY_STAGES: number;
  genLevel(cfg: Cfg): State; clone(s: State): State;
  preview(s: State, v: number, q: number): Preview;
  dispatch(s: State, v: number, q: number): { ok: boolean; reason?: string; state: State; events: Events | null };
  scoreComponents(s: State): Score; hint(s: State): Hint | null;
  journeyConfig(stage: number): Cfg; dailyConfig(d: number): Cfg; practiceConfig(diff: string, seed: number): Cfg;
  challengeConfig(seed: number): Cfg; tutorialConfig(lesson: number): Cfg;
  rng(seed: number): () => number;
}
export const R = (globalThis as unknown as { TTRules: RulesApi }).TTRules;

export interface Progress { journeyDone: number[]; journeyUnlocked: number; tutorialDone: boolean; daysPlayed: number[]; wins: number; streak: number; best: Record<string, number> }
export interface SaveDoc { v: number; progress: Progress; achievements: string[] }
export interface Options { palette: "default" | "cvd" | "contrast"; leftHand: boolean; captions: boolean }
interface SaveApi {
  defaultSave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSaves(a: unknown, b: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): SaveDoc | null; foreignOptions(text: string): Partial<Options>;
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; PALETTES: Options["palette"][]; BROWSER_KEYS: string[];
  pickOptions(raw: unknown): Partial<Options>;
}
export const SaveModel = save as unknown as SaveApi;
