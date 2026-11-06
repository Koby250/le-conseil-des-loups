// ─── Logique de jeu partagée (MJ + Joueurs) ──────────────────────────────────

/** Rôles qui se réveillent avec la meute dès le début de la partie. */
export const WOLF_ROLES = [
  'loup-garou',
  'infect-pere-des-loups',
  'grand-mechant-loup',
  'louveteau',
  'renard-garou',
  'loup-blanc',
];

/** Un joueur fait-il partie de la meute (rôle, infection, Chien-Loup ou Enfant Sauvage) ? */
export function isWolf(player) {
  if (!player) return false;
  if (player.est_infecte === true) return true;
  if (player.enfant_devenu_loup === true) return true;
  if (WOLF_ROLES.includes(player.role)) return true;
  if (player.role === 'loup') return true;
  if (player.role === 'chien-loup' && player.choix_chien === 'loup') return true;
  return false;
}

/** Un rôle (id) appartient-il à la meute par défaut ? */
export const isWolfRole = roleId => WOLF_ROLES.includes(roleId);

export const isAlive = player => !!player && player.statut_joueur !== 'mort';

/** Ordre officiel des phases de nuit gérées automatiquement. */
export const ALL_NIGHT_PHASES = [
  'nuit_cupidon',
  'nuit_salvateur',
  'nuit_voyante',
  'nuit_loups',
  'nuit_sorciere',
  'nuit_voleur',
];

export const DAY_PHASES = ['matin', 'jour_accusation', 'jour_defense', 'jour_vote', 'jour_resolution'];

/** Métadonnées d'affichage de chaque phase. */
export const PHASE_META = {
  SETUP:           { label: 'Préparation',        kind: 'setup' },
  en_attente:      { label: 'Salle d\'attente',   kind: 'setup' },
  nuit_cupidon:    { label: 'Cupidon',            kind: 'night', roleId: 'cupidon',   text: 'Cupidon lie deux âmes…' },
  nuit_salvateur:  { label: 'Salvateur',          kind: 'night', roleId: 'salvateur', text: 'Le Salvateur veille sur le village…' },
  nuit_voyante:    { label: 'Voyante',            kind: 'night', roleId: 'voyante',   text: 'La Voyante consulte les astres…' },
  nuit_loups:      { label: 'Loups-Garous',       kind: 'night', roleId: 'loup-garou', text: 'La meute choisit sa proie…' },
  nuit_sorciere:   { label: 'Sorcière',           kind: 'night', roleId: 'sorciere',  text: 'La Sorcière prépare ses potions…' },
  nuit_voleur:     { label: 'Voleur',             kind: 'night', roleId: 'voleur',    text: 'Le Voleur rôde en silence…' },
  matin:           { label: 'Lever du jour',      kind: 'day' },
  jour_accusation: { label: 'Accusations',        kind: 'day' },
  jour_defense:    { label: 'Défenses des accusés', kind: 'day' },
  jour_vote:       { label: 'Vote d\'élimination', kind: 'day' },
  jour_resolution: { label: 'Sentence',           kind: 'day' },
  fin_village:     { label: 'Victoire du village', kind: 'end' },
  fin_loups:       { label: 'Victoire des loups', kind: 'end' },
};

export const phaseLabel = statut => PHASE_META[statut]?.label || String(statut || '').replace(/_/g, ' ');

/** Supprime les emojis d'une chaîne (utile pour les anciennes notifications stockées). */
export function stripEmoji(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Associe une notification MJ au rôle concerné (pour afficher la bonne icône). */
const NOTIF_RULES = [
  [/voleur/i, 'voleur'],
  [/cupidon|couple|amoureu|chagrin/i, 'cupidon'],
  [/salvateur/i, 'salvateur'],
  [/voyante/i, 'voyante'],
  [/sorci/i, 'sorciere'],
  [/infect/i, 'infect-pere-des-loups'],
  [/chasseur/i, 'chasseur'],
  [/chevalier|venin/i, 'chevalier-epee'],
  [/ancien/i, 'ancien'],
  [/chien-loup/i, 'chien-loup'],
  [/enfant sauvage|modèle/i, 'enfant-sauvage'],
  [/corbeau/i, 'corbeau'],
  [/renard/i, 'renard'],
  [/idiot/i, 'idiot-village'],
  [/bouc/i, 'bouc-emissaire'],
  [/illusion/i, 'illusionniste'],
  [/com[ée]dien/i, 'comedien'],
  [/loup|meute/i, 'loup-garou'],
];

export function notifRoleId(text) {
  const rule = NOTIF_RULES.find(([re]) => re.test(text || ''));
  return rule ? rule[1] : null;
}

export function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}
