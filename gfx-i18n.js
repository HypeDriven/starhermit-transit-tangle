// Strings for the Graphics settings section, per locale. The locale comes from the browser
// language (the game has no language setting); unmatched languages fall back to en-US.

const en = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})', renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device, so the game renders without it.',
  unknownGpu: 'unknown GPU',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  cats: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing',
    reflections: 'Reflections', detail: 'Scene detail', particles: 'Particles', ambient: 'Ambient motion',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated',
  },
  sum: {
    noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing',
  },
};

const enGB = {
  ...en,
  cats: { ...en.cats, grade: 'Colour grade' },
};

const es = {
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})', renderScale: 'Escala de renderizado',
  fromPreset: 'Según el ajuste ({tier})', adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
  unknownGpu: 'GPU desconocida',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Suavizado de bordes',
    reflections: 'Reflejos', detail: 'Detalle de la escena', particles: 'Partículas', ambient: 'Movimiento ambiental',
  },
  tiers: {
    off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Sencillo', detailed: 'Detallado', static: 'Estático', animated: 'Animado',
  },
  sum: {
    noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa',
    bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin suavizado',
  },
};

const esES = {
  ...es,
  showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo, así que el juego se muestra sin él.',
};

const de = {
  graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', renderScale: 'Renderskalierung',
  fromPreset: 'Aus Voreinstellung ({tier})', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, daher wird ohne sie gerendert.',
  unknownGpu: 'unbekannte GPU',
  presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
  cats: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchten', grade: 'Farbkorrektur', antialias: 'Kantenglättung',
    reflections: 'Reflexionen', detail: 'Szenendetails', particles: 'Partikel', ambient: 'Umgebungsbewegung',
  },
  tiers: {
    off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Einfach', detailed: 'Detailliert', static: 'Statisch', animated: 'Animiert',
  },
  sum: {
    noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoFull: 'volle Umgebungsverdeckung',
    bloom: 'Leuchten', reflections: 'Reflexionen', noAA: 'keine Kantenglättung',
  },
};

const fr = {
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})', renderScale: 'Échelle de rendu',
  fromPreset: 'Selon le préréglage ({tier})', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; le jeu s’affiche sans lui.',
  unknownGpu: 'GPU inconnu',
  presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage', antialias: 'Anticrénelage',
    reflections: 'Reflets', detail: 'Détail de la scène', particles: 'Particules', ambient: 'Mouvement ambiant',
  },
  tiers: {
    off: 'Désactivé', on: 'Activé', low: 'Bas', medium: 'Moyen', high: 'Élevé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animé',
  },
  sum: {
    noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète',
    bloom: 'halo', reflections: 'reflets', noAA: 'sans anticrénelage',
  },
};

const frCA = {
  ...fr,
  graphics: 'Graphiques',
  showFps: 'Afficher la fréquence d’images',
};

const ptBR = {
  graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})', renderScale: 'Escala de renderização',
  fromPreset: 'Da predefinição ({tier})', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
  postFailed: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
  unknownGpu: 'GPU desconhecida',
  presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Suavização de bordas',
    reflections: 'Reflexos', detail: 'Detalhe da cena', particles: 'Partículas', ambient: 'Movimento ambiente',
  },
  tiers: {
    off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Simples', detailed: 'Detalhado', static: 'Estático', animated: 'Animado',
  },
  sum: {
    noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente', aoFull: 'oclusão ambiente completa',
    bloom: 'brilho', reflections: 'reflexos', noAA: 'sem suavização',
  },
};

const itIT = {
  graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', renderScale: 'Scala di rendering',
  fromPreset: 'Dalla preimpostazione ({tier})', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
  postFailed: 'La post-elaborazione non è disponibile su questo dispositivo, quindi il gioco viene mostrato senza.',
  unknownGpu: 'GPU sconosciuta',
  presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing',
    reflections: 'Riflessi', detail: 'Dettaglio scena', particles: 'Particelle', ambient: 'Movimento ambientale',
  },
  tiers: {
    off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Semplice', detailed: 'Dettagliato', static: 'Statico', animated: 'Animato',
  },
  sum: {
    noShadows: 'senza ombre', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoFull: 'occlusione ambientale completa',
    bloom: 'bagliore', reflections: 'riflessi', noAA: 'senza antialiasing',
  },
};

export const GFX_STRINGS = {
  'en-US': en, 'en-GB': enGB, 'es-419': es, 'es-ES': esES, 'de-DE': de,
  'fr-FR': fr, 'fr-CA': frCA, 'pt-BR': ptBR, 'it-IT': itIT,
};

/** Pick a supported locale for a BCP-47 tag (exact match, then language fallback). */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split('-')[0].toLowerCase();
  const region = (t.split('-')[1] || '').toUpperCase();
  if (lang === 'en') return ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(region) ? 'en-GB' : 'en-US';
  if (lang === 'es') return region === 'ES' || !region ? 'es-ES' : 'es-419';
  if (lang === 'fr') return region === 'CA' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

export function gfxStrings(tag) {
  return GFX_STRINGS[pickLocale(tag)];
}
