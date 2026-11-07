import {
  doc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';
import { isWolf, shuffleArray } from './gameLogic';
import { getRole } from './rolesData';

// ── Noms immersifs de villageois médiévaux pour les Bots IA ──────────────────
export const BOT_NAMES = [
  'Gaston', 'Jeanne', 'Arthur', 'Benoît', 'Ysabeau',
  'Thibault', 'Mathilde', 'Godefroy', 'Clotilde', 'Barnabé',
  'Blanche', 'Eloi', 'Aliénor', 'Landry', 'Séraphin',
  'Félicité', 'Marceau', 'Berthe', 'Cyprien', 'Guenièvre',
  'Ambroise', 'Rosalie', 'Corentin', 'Constance', 'Baudouin',
  'Solange', 'Philibert', 'Viviane', 'Léontin', 'Hermine',
  'Enguerrand', 'Perceval', 'Mélisande', 'Foulques', 'Honoré',
];

/** Détecte si un joueur est un Bot IA */
export function isBot(player) {
  if (!player) return false;
  return player.est_bot === true || String(player.nom || '').endsWith('(IA)');
}

/** Trouve un nom disponible pour un nouveau bot */
export function getAvailableBotName(existingJoueurs = []) {
  const existingNames = new Set(existingJoueurs.map(j => String(j.nom || '').trim()));
  for (const baseName of BOT_NAMES) {
    const candidate = `${baseName} (IA)`;
    if (!existingNames.has(candidate)) return candidate;
  }
  let index = 1;
  while (true) {
    const candidate = `Villageois_${index} (IA)`;
    if (!existingNames.has(candidate)) return candidate;
    index++;
  }
}

/** Initialise un objet joueur bot complet */
export function createBotPlayerObject(name, cardIndex = null, assignedRole = '') {
  return {
    nom: name,
    carte_choisie: cardIndex,
    role: assignedRole || '',
    statut_joueur: 'en_vie',
    est_mj: false,
    est_bot: true,
    pouvoir_utilise: false,
    a_vote: false,
    a_vote_sorciere: false,
    vote_jour: null,
    illusion_dispo: true,
    dernier_protege: null,
    potion_vie_utilisee: false,
    potion_mort_utilisee: false,
    vies: assignedRole === 'ancien' ? 2 : 1,
    infection_dispo: assignedRole === 'infect-pere-des-loups' || assignedRole === 'pere-des-loups',
    infection_repondu: false,
    tir_chasseur_fait: false,
    gracie_idiot: false,
    choix_chien: assignedRole === 'chien-loup' ? (Math.random() < 0.4 ? 'loup' : 'villageois') : null,
    modele_id: null,
    modele_nom: null,
    enfant_devenu_loup: false,
    pouvoir_renard_perdu: false,
    flair_nuit_utilise: false,
    dernier_flair_nuit: null,
    dernier_flair_resultat: null,
    pouvoirs_perdus_ancien: false,
    ancien_role: null,
    proposition_role: null,
  };
}

/**
 * Garantit l'unicité stricte des cartes choisies et le respect absolu des quotas
 * de rôles configurés dans `salonData.roles_selectionnes`.
 * - Si deux joueurs ont choisi la même carte simultanément :
 *   - Un joueur humain est toujours prioritaire sur un Bot IA.
 *   - Entre deux humains, le premier enregistré dans `cartes_prises` (ou par ID) conserve la carte,
 *     et le second voit sa `carte_choisie` remise à `null` avec un message d'alerte pour qu'il choisisse un autre numéro.
 *   - Un Bot IA évincé reçoit automatiquement une autre carte libre.
 * - Vérifie également qu'aucun rôle n'est attribué plus de fois que son quota dans `roles_selectionnes`.
 * Retourne `true` si des corrections ont été appliquées en base, ou `false` si tout est déjà strictement valide.
 */
export async function reconcileCardAndRoleDuplicates(roomId, salonData, joueurs = []) {
  if (!roomId || !salonData || !Array.isArray(joueurs) || joueurs.length === 0) return false;
  if (salonData.statut !== 'en_attente') return false;

  const rolesSelectionnes = Array.isArray(salonData.roles_selectionnes) ? salonData.roles_selectionnes : [];
  let rolesMelanges = Array.isArray(salonData.roles_melanges) ? [...salonData.roles_melanges] : [];
  const cartesPrises = salonData.cartes_prises && typeof salonData.cartes_prises === 'object'
    ? { ...salonData.cartes_prises }
    : {};

  if (rolesSelectionnes.length === 0) return false;

  const batch = writeBatch(db);
  let hasChanges = false;
  let salonNeedsUpdate = false;
  const salonUpdates = {};

  // 1. Vérifier que `roles_melanges` correspond exactement aux quotas de `roles_selectionnes`
  const targetCounts = {};
  rolesSelectionnes.forEach(r => { targetCounts[r] = (targetCounts[r] || 0) + 1; });

  const melangeCounts = {};
  rolesMelanges.forEach(r => { melangeCounts[r] = (melangeCounts[r] || 0) + 1; });

  let melangeInvalid = rolesMelanges.length !== rolesSelectionnes.length;
  if (!melangeInvalid) {
    for (const r of Object.keys(targetCounts)) {
      if (melangeCounts[r] !== targetCounts[r]) {
        melangeInvalid = true;
        break;
      }
    }
  }

  if (melangeInvalid && salonData.distribution_mode !== 'manuelle') {
    const remainingPool = { ...targetCounts };
    const fixedMelange = new Array(rolesSelectionnes.length).fill(null);

    const sortedPicked = [...joueurs]
      .filter(j => typeof j.carte_choisie === 'number' && j.carte_choisie >= 0 && j.carte_choisie < rolesSelectionnes.length && j.role)
      .sort((a, b) => (isBot(a) === isBot(b) ? 0 : isBot(a) ? 1 : -1));

    for (const p of sortedPicked) {
      const idx = p.carte_choisie;
      if (fixedMelange[idx] === null && remainingPool[p.role] > 0) {
        fixedMelange[idx] = p.role;
        remainingPool[p.role]--;
      }
    }

    const leftoverRoles = [];
    Object.entries(remainingPool).forEach(([roleId, count]) => {
      for (let i = 0; i < count; i++) leftoverRoles.push(roleId);
    });
    const shuffledLeftovers = shuffleArray(leftoverRoles);

    for (let i = 0; i < fixedMelange.length; i++) {
      if (fixedMelange[i] === null) {
        fixedMelange[i] = shuffledLeftovers.pop() || 'villageois';
      }
    }

    rolesMelanges = fixedMelange;
    salonUpdates.roles_melanges = rolesMelanges;
    salonNeedsUpdate = true;
  }

  // 2. Mode aléatoire : Unicité stricte de `carte_choisie` et correspondance `role === roles_melanges[carte_choisie]`
  if (salonData.distribution_mode !== 'manuelle' && rolesMelanges.length > 0) {
    const byCard = new Map();
    const displacedBots = [];
    const invalidPlayers = [];

    for (const j of joueurs) {
      if (j.carte_choisie === null || j.carte_choisie === undefined || j.carte_choisie === 999) {
        continue;
      }
      const idx = Number(j.carte_choisie);
      if (Number.isNaN(idx) || idx < 0 || idx >= rolesMelanges.length) {
        invalidPlayers.push(j);
        continue;
      }
      if (!byCard.has(idx)) byCard.set(idx, []);
      byCard.get(idx).push(j);
    }

    const usedIndices = new Set();
    let resetHumansCount = 0;

    for (const [idx, owners] of byCard.entries()) {
      owners.sort((a, b) => {
        const aBot = isBot(a);
        const bBot = isBot(b);
        if (aBot !== bBot) return aBot ? 1 : -1;
        const recordedOwner = cartesPrises[String(idx)];
        if (recordedOwner === a.id && recordedOwner !== b.id) return -1;
        if (recordedOwner === b.id && recordedOwner !== a.id) return 1;
        return String(a.id).localeCompare(String(b.id));
      });

      const winner = owners[0];
      usedIndices.add(idx);

      if (cartesPrises[String(idx)] !== winner.id) {
        cartesPrises[String(idx)] = winner.id;
        salonNeedsUpdate = true;
      }

      const expectedRole = rolesMelanges[idx];
      if (winner.role !== expectedRole || (expectedRole === 'ancien' && winner.vies !== 2)) {
        batch.update(doc(db, 'salons', roomId, 'joueurs', winner.id), {
          role: expectedRole,
          vies: expectedRole === 'ancien' ? 2 : 1,
          infection_dispo: expectedRole === 'infect-pere-des-loups' || expectedRole === 'pere-des-loups',
        });
        hasChanges = true;
      }

      for (let k = 1; k < owners.length; k++) {
        const loser = owners[k];
        if (isBot(loser)) {
          displacedBots.push(loser);
        } else {
          resetHumansCount++;
          batch.update(doc(db, 'salons', roomId, 'joueurs', loser.id), {
            carte_choisie: null,
            role: '',
            vies: 1,
            infection_dispo: false,
            conflit_carte_msg: `Vous avez appuyé simultanément sur la carte #${idx + 1} avec ${winner.nom}. Cette carte a été attribuée à ${winner.nom} — veuillez choisir un autre numéro de carte !`,
          });
          hasChanges = true;
        }
      }
    }

    for (const inv of invalidPlayers) {
      if (isBot(inv)) {
        displacedBots.push(inv);
      } else {
        resetHumansCount++;
        batch.update(doc(db, 'salons', roomId, 'joueurs', inv.id), {
          carte_choisie: null,
          role: '',
          vies: 1,
          infection_dispo: false,
        });
        hasChanges = true;
      }
    }

    for (const j of joueurs) {
      if ((j.carte_choisie === null || j.carte_choisie === undefined) && j.role) {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          role: '',
          vies: 1,
          infection_dispo: false,
        });
        hasChanges = true;
      }
    }

    if (displacedBots.length > 0) {
      const freeIndices = [];
      for (let i = 0; i < rolesMelanges.length; i++) {
        if (!usedIndices.has(i)) freeIndices.push(i);
      }
      const unpickedHumans = joueurs.filter(
        j => !isBot(j) && (j.carte_choisie === null || j.carte_choisie === undefined)
      ).length + resetHumansCount;

      for (const bot of displacedBots) {
        if (freeIndices.length > unpickedHumans) {
          const newIdx = freeIndices.pop();
          const newRole = rolesMelanges[newIdx];
          usedIndices.add(newIdx);
          cartesPrises[String(newIdx)] = bot.id;
          salonNeedsUpdate = true;

          const botUpd = {
            carte_choisie: newIdx,
            role: newRole,
            vies: newRole === 'ancien' ? 2 : 1,
            infection_dispo: newRole === 'infect-pere-des-loups' || newRole === 'pere-des-loups',
          };
          if (newRole === 'chien-loup') {
            botUpd.choix_chien = Math.random() < 0.4 ? 'loup' : 'villageois';
          }
          batch.update(doc(db, 'salons', roomId, 'joueurs', bot.id), botUpd);
          hasChanges = true;
        } else {
          batch.update(doc(db, 'salons', roomId, 'joueurs', bot.id), {
            carte_choisie: null,
            role: '',
            vies: 1,
            infection_dispo: false,
          });
          hasChanges = true;
        }
      }
    }

    for (const key of Object.keys(cartesPrises)) {
      const idx = Number(key);
      if (!usedIndices.has(idx)) {
        delete cartesPrises[key];
        salonNeedsUpdate = true;
      }
    }
  } else if (salonData.distribution_mode === 'manuelle') {
    const roleGroups = new Map();
    for (const j of joueurs) {
      if (!j.role) continue;
      if (!roleGroups.has(j.role)) roleGroups.set(j.role, []);
      roleGroups.get(j.role).push(j);
    }

    for (const [roleId, owners] of roleGroups.entries()) {
      const maxAllowed = targetCounts[roleId] || 0;
      if (owners.length > maxAllowed) {
        owners.sort((a, b) => (isBot(a) === isBot(b) ? 0 : isBot(a) ? 1 : -1));
        for (let k = maxAllowed; k < owners.length; k++) {
          const excessPlayer = owners[k];
          batch.update(doc(db, 'salons', roomId, 'joueurs', excessPlayer.id), {
            role: '',
            carte_choisie: null,
            vies: 1,
            infection_dispo: false,
          });
          hasChanges = true;
        }
      }
    }
  }

  if (salonNeedsUpdate) {
    salonUpdates.cartes_prises = cartesPrises;
    batch.update(doc(db, 'salons', roomId), salonUpdates);
  }

  if (hasChanges || salonNeedsUpdate) {
    try {
      await batch.commit();
    } catch (e) {
      console.error('Erreur reconcileCardAndRoleDuplicates:', e);
    }
  }

  return hasChanges;
}

/**
 * Vérifie de manière synchrone si toutes les cartes et tous les rôles des joueurs
 * sont strictement uniques et respectent les quotas de `salonData.roles_selectionnes`.
 */
export function areAllCardsAndRolesValidForStart(salonData, joueurs = []) {
  if (!salonData || !Array.isArray(joueurs) || joueurs.length === 0) return false;
  const rolesSelectionnes = Array.isArray(salonData.roles_selectionnes) ? salonData.roles_selectionnes : [];
  const rolesMelanges = Array.isArray(salonData.roles_melanges) ? salonData.roles_melanges : [];

  const targetCounts = {};
  rolesSelectionnes.forEach(r => { targetCounts[r] = (targetCounts[r] || 0) + 1; });

  const actualCounts = {};
  const seenCards = new Set();

  for (const j of joueurs) {
    if (!j.role) return false;
    actualCounts[j.role] = (actualCounts[j.role] || 0) + 1;
    if (actualCounts[j.role] > (targetCounts[j.role] || 0)) {
      return false;
    }
    if (salonData.distribution_mode !== 'manuelle') {
      const idx = j.carte_choisie;
      if (idx === null || idx === undefined || idx < 0 || idx >= rolesMelanges.length) {
        return false;
      }
      if (seenCards.has(idx)) {
        return false;
      }
      seenCards.add(idx);
      if (j.role !== rolesMelanges[idx]) {
        return false;
      }
    }
  }

  return true;
}

/** Ajoute 1 Bot IA dans le salon */
export async function addSingleBot(roomId, salonData, existingJoueurs = []) {
  if (!roomId) return null;
  const botName = getAvailableBotName(existingJoueurs);
  const stableId = 'bot_' + roomId + '_' + botName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  let cardIndex = null;
  let assignedRole = '';
  const batch = writeBatch(db);

  const unpickedHumans = existingJoueurs.filter(
    j => !isBot(j) && (j.carte_choisie === null || j.carte_choisie === undefined)
  ).length;

  // Si aucun humain n'est en train de choisir sa carte, le bot peut piocher une carte libre (depuis la fin)
  if (
    unpickedHumans === 0 &&
    salonData?.statut === 'en_attente' &&
    salonData.distribution_mode !== 'manuelle' &&
    Array.isArray(salonData.roles_melanges)
  ) {
    const cartesPrises = salonData.cartes_prises || {};
    const takenCards = new Set([
      ...existingJoueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => Number(j.carte_choisie)),
      ...Object.keys(cartesPrises).map(Number),
    ]);
    for (let i = salonData.roles_melanges.length - 1; i >= 0; i--) {
      if (!takenCards.has(i)) {
        cardIndex = i;
        assignedRole = salonData.roles_melanges[i];
        batch.update(doc(db, 'salons', roomId), {
          [`cartes_prises.${i}`]: stableId,
        });
        break;
      }
    }
  }

  const botData = createBotPlayerObject(botName, cardIndex, assignedRole);
  batch.set(doc(db, 'salons', roomId, 'joueurs', stableId), botData);
  await batch.commit();
  return botName;
}

/** Remplit le salon avec des Bots IA jusqu'au nombre de rôles sélectionnés */
export async function fillSalonWithBots(roomId, salonData, existingJoueurs = []) {
  if (!roomId || !salonData) return 0;
  const targetCount = Array.isArray(salonData.roles_selectionnes)
    ? salonData.roles_selectionnes.length
    : (salonData.roles_melanges?.length || 6);

  const needed = targetCount - existingJoueurs.length;
  if (needed <= 0) return 0;

  const unpickedHumans = existingJoueurs.filter(
    j => !isBot(j) && (j.carte_choisie === null || j.carte_choisie === undefined)
  ).length;

  const cartesPrises = salonData.cartes_prises || {};
  const takenCards = new Set([
    ...existingJoueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => Number(j.carte_choisie)),
    ...Object.keys(cartesPrises).map(Number),
  ]);

  const availableCardIndices = [];
  if (Array.isArray(salonData.roles_melanges)) {
    for (let i = 0; i < salonData.roles_melanges.length; i++) {
      if (!takenCards.has(i)) availableCardIndices.push(i);
    }
  }

  const batch = writeBatch(db);
  const updatedList = [...existingJoueurs];
  const newCartesPrises = {};
  let addedCount = 0;

  for (let k = 0; k < needed; k++) {
    const botName = getAvailableBotName(updatedList);
    const stableId = 'bot_' + roomId + '_' + botName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    let cardIndex = null;
    let assignedRole = '';

    // Si aucun humain n'attend de tirer sa carte, les bots tirent directement depuis la fin du paquet
    if (
      unpickedHumans === 0 &&
      salonData.statut === 'en_attente' &&
      salonData.distribution_mode !== 'manuelle' &&
      availableCardIndices.length > 0
    ) {
      cardIndex = availableCardIndices.pop();
      assignedRole = salonData.roles_melanges[cardIndex] || '';
      newCartesPrises[`cartes_prises.${cardIndex}`] = stableId;
    }

    const botObj = createBotPlayerObject(botName, cardIndex, assignedRole);
    batch.set(doc(db, 'salons', roomId, 'joueurs', stableId), botObj);
    updatedList.push({ id: stableId, ...botObj });
    addedCount++;
  }

  if (Object.keys(newCartesPrises).length > 0) {
    batch.update(doc(db, 'salons', roomId), newCartesPrises);
  }

  await batch.commit();
  return addedCount;
}

/** Fait tirer les cartes restantes à tous les bots sans carte */
export async function botAutoPickCards(roomId, salonData, existingJoueurs = [], options = {}) {
  if (!roomId || !salonData || !Array.isArray(salonData.roles_melanges)) return 0;

  // D'abord corriger tout doublon éventuel
  const hadDuplicates = await reconcileCardAndRoleDuplicates(roomId, salonData, existingJoueurs);
  if (hadDuplicates) return 0;

  const unpickedHumans = existingJoueurs.filter(
    j => !isBot(j) && (j.carte_choisie === null || j.carte_choisie === undefined)
  ).length;

  // Tant qu'un joueur humain dans le salon n'a pas encore choisi sa carte, les bots patientent
  // pour lui laisser le libre choix de tous les numéros et éviter toute collision simultanée.
  if (unpickedHumans > 0 && !options.forceEvenIfHumanWaiting) {
    return 0;
  }

  const botsWithoutCard = existingJoueurs.filter(
    j => isBot(j) && (j.carte_choisie === null || j.carte_choisie === undefined)
  );
  if (botsWithoutCard.length === 0) return 0;

  let picked = 0;
  try {
    await runTransaction(db, async transaction => {
      const salonRef = doc(db, 'salons', roomId);
      const salonSnap = await transaction.get(salonRef);
      if (!salonSnap.exists()) return;
      const freshSalon = salonSnap.data();
      const rolesMelanges = Array.isArray(freshSalon.roles_melanges) ? freshSalon.roles_melanges : [];
      const cartesPrises = { ...(freshSalon.cartes_prises || {}) };

      const takenCards = new Set([
        ...existingJoueurs
          .filter(j => j.carte_choisie !== null && j.carte_choisie !== undefined && j.carte_choisie !== 999)
          .map(j => Number(j.carte_choisie)),
        ...Object.keys(cartesPrises).map(Number),
      ]);

      const freeCards = [];
      for (let i = 0; i < rolesMelanges.length; i++) {
        if (!takenCards.has(i)) freeCards.push(i);
      }

      for (const bot of botsWithoutCard) {
        if (freeCards.length <= unpickedHumans) break;
        const cardIdx = freeCards.pop();
        const assignedRole = rolesMelanges[cardIdx];
        cartesPrises[String(cardIdx)] = bot.id;

        const updates = {
          carte_choisie: cardIdx,
          role: assignedRole,
          vies: assignedRole === 'ancien' ? 2 : 1,
          infection_dispo: assignedRole === 'infect-pere-des-loups' || assignedRole === 'pere-des-loups',
        };
        if (assignedRole === 'chien-loup') {
          updates.choix_chien = Math.random() < 0.4 ? 'loup' : 'villageois';
        }
        transaction.update(doc(db, 'salons', roomId, 'joueurs', bot.id), updates);
        picked++;
      }

      if (picked > 0) {
        transaction.update(salonRef, { cartes_prises: cartesPrises });
      }
    });
  } catch (e) {
    console.error('Erreur botAutoPickCards transaction:', e);
  }

  return picked;
}

/** Supprime tous les Bots IA du salon */
export async function removeAllBots(roomId, existingJoueurs = []) {
  if (!roomId) return 0;
  const bots = existingJoueurs.filter(j => isBot(j));
  if (bots.length === 0) return 0;

  const batch = writeBatch(db);
  bots.forEach(b => batch.delete(doc(db, 'salons', roomId, 'joueurs', b.id)));
  await batch.commit();
  return bots.length;
}

// ── Phrases de discussion réalistes pour les bots ────────────────────────────
const WOLF_CHAT_MESSAGES = [
  "Attaquons {target} ce soir, c'est une cible parfaite !",
  "Je propose d'éliminer {target}, personne ne se doutera de rien.",
  "D'accord pour {target}, c'est le joueur le plus dangereux.",
  "Silence dans la nuit... On dévore {target} et on reste discrets.",
  "La meute a faim. {target} sera notre proie !",
];

const BOT_ACCUSATION_ARGUMENTS = [
  "Je trouve l'attitude de {target} particulièrement trouble depuis ce matin. Ses réactions ne sont pas naturelles !",
  "Moi je propose d'accuser {target}. Il faut qu'il vienne s'expliquer devant tout le village !",
  "Regardez comment {target} évite les débats... Pour moi, c'est un suspect évident.",
  "Mon accusation ira sur {target}. Je compte sur les autres villageois pour m'aider à l'envoyer au tribunal !",
  "Il y a de fortes chances que {target} cache sa véritable allégeance. Mettons-le sur le banc des accusés !",
  "Les loups avancent masqués, et {target} joue un jeu très étrange aujourd'hui.",
  "Attention villageois, ne votons pas n'importe comment ! Il nous faut des éléments tangibles avant d'accuser.",
  "Restons calmes et prudents, nous risquons d'accuser un innocent si nous nous précipitons sans réfléchir.",
];

const ACCUSED_DEFENSE_MESSAGES = [
  "Je vous jure que je suis un simple villageois innocent ! Vous faites une énorme erreur !",
  "Ne votez pas contre moi ! Je me bats du côté du village depuis le début !",
  "C'est un piège tendu par les loups pour éliminer un villageois loyal, réveillez-vous !",
  "Regardez mon comportement, j'ai toujours aidé le village ! Épargnez-moi !",
  "Si vous me tuez, le village perdra un allié précieux. Tournez vos regards ailleurs !",
];

const ACCUSED_CITIZEN_REACTIONS = [
  "Les arguments se tiennent, mais restons vigilants...",
  "C'est très suspect tout de même...",
  "Je ne suis pas totalement convaincu par cette défense.",
  "Faisons confiance aux villageois et votons selon notre intuition.",
];

/**
 * Calcule un délai de réaction humanisé et stable (en secondes) pour un bot donné,
 * une phase donnée et un numéro de jour donné.
 */
export function getBotActionDelay(botNom, phaseKey, dayNumber = 1, minSec = 4, maxSec = 14) {
  let hash = 0;
  const str = `${botNom || ''}_${phaseKey}_${dayNumber}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  const span = Math.max(1, maxSec - minSec);
  const rawDelay = minSec + (positive % span) + ((positive % 10) / 10);
  return Math.round(rawDelay * 10) / 10;
}

/**
 * MOTEUR D'ACTION AUTONOME DES BOTS IA
 * Analyse l'état actuel de la partie et fait jouer les bots qui ont un tour à jouer.
 * Imite le rythme d'action humain avec hésitations et actions échelonnées dans le temps.
 * Retourne un descriptif des actions menées pour affichage au MJ.
 */
export async function runBotTurnStep(roomId, salonData, joueurs = []) {
  if (!roomId || !salonData) return null;
  const bots = joueurs.filter(j => isBot(j));
  if (bots.length === 0) return null;

  const alivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
  const aliveBots = bots.filter(j => j.statut_joueur !== 'mort');
  const actionsSummary = [];

  const phaseStartedAt = salonData.phase_started_at || salonData.auto_mj_phase_started_at || 0;
  const elapsedSec = phaseStartedAt > 0 ? (Date.now() - phaseStartedAt) / 1000 : 999;
  const dayNumber = salonData.numero_jour || 1;

  // ── 0. Proposition de rôle du MJ en attente chez un Bot IA ──────────────────
  const botWithProposal = bots.find(j => j.proposition_role?.roleId);
  if (botWithProposal) {
    const newRoleId = botWithProposal.proposition_role.roleId;
    const rObj = getRole(newRoleId);
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', botWithProposal.id), {
        role: newRoleId,
        vies: newRoleId === 'ancien' ? 2 : 1,
        infection_dispo: newRoleId === 'infect-pere-des-loups' || newRoleId === 'pere-des-loups',
        proposition_role: null,
      });
      await updateDoc(doc(db, 'salons', roomId), {
        notifications_mj: arrayUnion(
          `Le Bot ${botWithProposal.nom} a accepté son nouveau rôle : ${rObj?.name || newRoleId}.`,
        ),
      });
      return `Le Bot ${botWithProposal.nom} a accepté le rôle de ${rObj?.name || newRoleId}.`;
    } catch (e) {
      console.error(e);
    }
  }

  // ── 1. Chasseur Bot mort avec tir de vengeance en attente ───────────────────
  const deadChasseurBot = bots.find(
    j => j.role === 'chasseur' && j.statut_joueur === 'mort' && j.tir_chasseur_fait === false
  );
  if (deadChasseurBot && alivePlayers.length > 0) {
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    if (target) {
      try {
        await runTransaction(db, async transaction => {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', target.id), { statut_joueur: 'mort' });
          transaction.update(doc(db, 'salons', roomId, 'joueurs', deadChasseurBot.id), { tir_chasseur_fait: true });
          transaction.update(doc(db, 'salons', roomId), {
            notifications_mj: arrayUnion(
              `Le Chasseur IA (${deadChasseurBot.nom}) a abattu ${target.nom} dans son dernier souffle.`
            ),
          });
        });
        return `Le Chasseur IA (${deadChasseurBot.nom}) a tiré sur ${target.nom}.`;
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ── 2. Enfant Sauvage Bot sans modèle ───────────────────────────────────────
  const enfantBot = aliveBots.find(j => j.role === 'enfant-sauvage' && !j.modele_id);
  if (enfantBot) {
    const candidates = alivePlayers.filter(j => j.id !== enfantBot.id);
    if (candidates.length > 0) {
      const chosenModel = candidates[Math.floor(Math.random() * candidates.length)];
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', enfantBot.id), {
        modele_id: chosenModel.id,
        modele_nom: chosenModel.nom,
      });
      await updateDoc(doc(db, 'salons', roomId), {
        notifications_mj: arrayUnion(
          `L'Enfant Sauvage IA (${enfantBot.nom}) a choisi ${chosenModel.nom} comme modèle.`
        ),
      });
      return `L'Enfant Sauvage (${enfantBot.nom}) a choisi son modèle : ${chosenModel.nom}.`;
    }
  }

  // ── Renard Bot : flairer une seule fois dans la nuit ───────────────────────
  const renardBot = aliveBots.find(
    j => (j.role === 'renard' || j.role === 'renard-garou') &&
         !j.pouvoir_renard_perdu &&
         !j.flair_nuit_utilise &&
         j.dernier_flair_nuit !== dayNumber
  );
  if (renardBot && ALL_NIGHT_PHASES.includes(salonData.statut) && alivePlayers.length >= 2) {
    const plannedDelay = getBotActionDelay(renardBot.nom, 'renard_flair', dayNumber, 4, 9);
    if (elapsedSec >= plannedDelay) {
      const len = alivePlayers.length;
      const targetIdx = Math.floor(Math.random() * len);
      const center = alivePlayers[targetIdx];
      const left = alivePlayers[(targetIdx - 1 + len) % len];
      const right = alivePlayers[(targetIdx + 1) % len];
      const trio = Array.from(new Set([left, center, right]));
      const hasWolf = trio.some(p => isWolf(p));
      const trioNames = trio.map(p => p.nom);

      try {
        await updateDoc(doc(db, 'salons', roomId, 'joueurs', renardBot.id), {
          flair_nuit_utilise: true,
          dernier_flair_nuit: dayNumber,
          pouvoir_renard_perdu: renardBot.role === 'renard' ? !hasWolf : false,
          dernier_flair_resultat: { trioNames, hasWolf, numero_jour: dayNumber },
        });
        await updateDoc(doc(db, 'salons', roomId), {
          notifications_mj: arrayUnion(
            `Le Renard IA (${renardBot.nom}) a flairé [${trioNames.join(', ')}] → ${hasWolf ? 'Présence de loup détectée' : 'Aucun loup (flair perdu)'}.`,
          ),
        });
        return `Le Renard IA (${renardBot.nom}) a flairé ${center.nom}.`;
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ── 3. Actions par Phase de Jeu ─────────────────────────────────────────────
  const statut = salonData.statut;

  // A. Phase d'attente : tirage des cartes
  if (statut === 'en_attente') {
    const picked = await botAutoPickCards(roomId, salonData, joueurs);
    if (picked > 0) return `${picked} Bot(s) ont tiré leur carte secrète.`;
    return null;
  }

  // B. Nuit : Cupidon (hésitation humaine de 5 à 10s)
  if (statut === 'nuit_cupidon') {
    const cupidonBot = aliveBots.find(j => j.role === 'cupidon' && !j.pouvoir_utilise);
    if (cupidonBot && alivePlayers.length >= 2) {
      const plannedDelay = getBotActionDelay(cupidonBot.nom, 'cupidon', dayNumber, 5, 10);
      if (elapsedSec >= plannedDelay) {
        const shuffled = shuffleArray([...alivePlayers]);
        const p1 = shuffled[0];
        const p2 = shuffled[1];
        try {
          await runTransaction(db, async transaction => {
            transaction.update(doc(db, 'salons', roomId), {
              couple: [p1.id, p2.id],
              notifications_mj: arrayUnion(`Cupidon IA (${cupidonBot.nom}) a uni ${p1.nom} et ${p2.nom}.`),
            });
            transaction.update(doc(db, 'salons', roomId, 'joueurs', cupidonBot.id), {
              pouvoir_utilise: true,
              a_vote: true,
            });
            transaction.update(doc(db, 'salons', roomId, 'joueurs', p1.id), { statut_joueur: 'En couple' });
            transaction.update(doc(db, 'salons', roomId, 'joueurs', p2.id), { statut_joueur: 'En couple' });
          });
          return `Cupidon IA (${cupidonBot.nom}) a uni ${p1.nom} et ${p2.nom}.`;
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  // C. Nuit : Salvateur (hésitation humaine de 5 à 10s)
  if (statut === 'nuit_salvateur') {
    const salvateurBot = aliveBots.find(j => j.role === 'salvateur' && !j.a_vote);
    if (salvateurBot) {
      const plannedDelay = getBotActionDelay(salvateurBot.nom, 'salvateur', dayNumber, 5, 10);
      if (elapsedSec >= plannedDelay) {
        const candidates = alivePlayers.filter(j => j.nom !== salonData.derniere_cible_salvateur);
        if (candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          try {
            await runTransaction(db, async transaction => {
              transaction.update(doc(db, 'salons', roomId), {
                joueur_protege: target.nom,
                derniere_cible_salvateur: target.nom,
                notifications_mj: arrayUnion(`Le Salvateur IA (${salvateurBot.nom}) a protégé ${target.nom}.`),
              });
              transaction.update(doc(db, 'salons', roomId, 'joueurs', salvateurBot.id), {
                a_vote: true,
                dernier_protege: target.nom,
              });
            });
            return `Le Salvateur IA (${salvateurBot.nom}) a protégé ${target.nom}.`;
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
  }

  // D. Nuit : Voyante (observation humaine de 5 à 11s)
  if (statut === 'nuit_voyante') {
    const voyanteBot = aliveBots.find(j => j.role === 'voyante' && !j.a_vote);
    if (voyanteBot) {
      const plannedDelay = getBotActionDelay(voyanteBot.nom, 'voyante', dayNumber, 5, 11);
      if (elapsedSec >= plannedDelay) {
        const candidates = alivePlayers.filter(j => j.id !== voyanteBot.id);
        if (candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          const rData = getRole(target.role);
          try {
            await updateDoc(doc(db, 'salons', roomId, 'joueurs', voyanteBot.id), { a_vote: true });
            await updateDoc(doc(db, 'salons', roomId), {
              notifications_mj: arrayUnion(
                `La Voyante IA (${voyanteBot.nom}) a sondé ${target.nom} (${rData?.name || target.role}).`
              ),
            });
            return `La Voyante IA (${voyanteBot.nom}) a sondé ${target.nom}.`;
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
  }

  // E. Nuit : Loups-Garous (débat progressif dans le chat puis confirmation de la meute)
  if (statut === 'nuit_loups') {
    const wolfBots = aliveBots.filter(j => isWolf(j));
    const nonWolfTargets = alivePlayers.filter(j => !isWolf(j));
    const humanWolves = alivePlayers.filter(j => isWolf(j) && !isBot(j));

    if (wolfBots.length > 0 && nonWolfTargets.length > 0) {
      let targetName = salonData.vote_loup_temporaire;

      // Étape 1 : un premier loup propose une proie dans le chat (4 à 8s)
      const delaySuggest = getBotActionDelay(wolfBots[0].nom, 'wolf_suggest', dayNumber, 4, 8);
      if (!targetName || !nonWolfTargets.some(t => t.nom === targetName)) {
        if (elapsedSec >= delaySuggest) {
          const chosen = nonWolfTargets[Math.floor(Math.random() * nonWolfTargets.length)];
          targetName = chosen.nom;

          const speaker = wolfBots[Math.floor(Math.random() * wolfBots.length)];
          const template = WOLF_CHAT_MESSAGES[Math.floor(Math.random() * WOLF_CHAT_MESSAGES.length)];
          const text = template.replace('{target}', targetName);

          const newMsg = {
            id: 'bot_msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            sender: speaker.nom,
            text,
            timestamp: Date.now(),
            isWolf: true,
          };

          await updateDoc(doc(db, 'salons', roomId), {
            vote_loup_temporaire: targetName,
            chat_loups: arrayUnion(newMsg),
          });
          actionsSummary.push(`Les Loups IA visent ${targetName}.`);
        }
      } else {
        // Étape 2 : un second loup répond et approuve dans le chat (9 à 13s)
        if (wolfBots.length > 1 && Array.isArray(salonData.chat_loups) && salonData.chat_loups.length === 1) {
          const delayAgree = getBotActionDelay(wolfBots[1].nom, 'wolf_agree', dayNumber, 9, 13);
          if (elapsedSec >= delayAgree) {
            const secondWolf = wolfBots[1];
            const agreeTexts = [
              `D'accord avec ${salonData.chat_loups[0].sender}, éliminons ${targetName} !`,
              `Très bon choix, ${targetName} ne s'y attendra pas.`,
              `Je vote pour ${targetName} aussi, soyons discrets et impitoyables.`,
            ];
            const text = agreeTexts[Math.floor(Math.random() * agreeTexts.length)];
            const agreeMsg = {
              id: 'bot_msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
              sender: secondWolf.nom,
              text,
              timestamp: Date.now(),
              isWolf: true,
            };
            await updateDoc(doc(db, 'salons', roomId), {
              chat_loups: arrayUnion(agreeMsg),
            });
          }
        }

        // Étape 3 : validation finale de la proie (14 à 19s)
        const delayConfirm = getBotActionDelay(wolfBots[0].nom, 'wolf_confirm', dayNumber, 14, 19);
        if (elapsedSec >= delayConfirm) {
          const infectPereBot = wolfBots.find(
            j => (j.role === 'infect-pere-des-loups' || j.role === 'pere-des-loups') && j.infection_dispo && !j.infection_repondu
          );

          if (infectPereBot) {
            const doInfect = Math.random() < 0.5;
            await runTransaction(db, async transaction => {
              transaction.update(doc(db, 'salons', roomId), {
                victime_loups: targetName,
                infection_active: doInfect,
                notifications_mj: arrayUnion(
                  doInfect
                    ? `L'Infect Père des Loups IA (${infectPereBot.nom}) a choisi d'infecter ${targetName}.`
                    : `L'Infect Père des Loups IA (${infectPereBot.nom}) laisse la cible mourir.`
                ),
              });
              transaction.update(doc(db, 'salons', roomId, 'joueurs', infectPereBot.id), {
                a_vote: true,
                infection_dispo: !doInfect,
                infection_repondu: true,
              });
            });
            return `L'Infect Père des Loups IA a ${doInfect ? 'infecté' : 'décidé de dévorer'} ${targetName}.`;
          } else if (!salonData.victime_loups) {
            const batch = writeBatch(db);
            if (humanWolves.length === 0) {
              batch.update(doc(db, 'salons', roomId), {
                victime_loups: targetName,
                notifications_mj: arrayUnion(`La meute IA a validé sa proie : ${targetName}.`),
              });
            }
            wolfBots.forEach(w => {
              batch.update(doc(db, 'salons', roomId, 'joueurs', w.id), { a_vote: true });
            });
            await batch.commit();
            return humanWolves.length === 0
              ? `La meute IA a confirmé sa proie : ${targetName}.`
              : `Les loups IA soutiennent la cible ${targetName} avec leurs alliés humains.`;
          }
        }
      }
    }
  }

  // F. Nuit : Loup-Garou Blanc (trahison secrète de la meute, hésitation de 6 à 12s)
  if (statut === 'nuit_loup_blanc') {
    const loupBlancBot = aliveBots.find(j => j.role === 'loup-blanc' && !j.a_vote);
    if (loupBlancBot) {
      const plannedDelay = getBotActionDelay(loupBlancBot.nom, 'loup_blanc', dayNumber, 6, 12);
      if (elapsedSec >= plannedDelay) {
        // Cibles potentielles : les autres loups vivants !
        const otherWolves = alivePlayers.filter(j => isWolf(j) && j.id !== loupBlancBot.id);
        let victimName = null;
        if (otherWolves.length > 0) {
          // Décision : 85% de chance d'éliminer un autre loup, 15% d'attendre
          const willKill = Math.random() < 0.85;
          if (willKill) {
            victimName = otherWolves[Math.floor(Math.random() * otherWolves.length)].nom;
          }
        }
        try {
          await runTransaction(db, async transaction => {
            transaction.update(doc(db, 'salons', roomId), {
              victime_loup_blanc: victimName || null,
              notifications_mj: arrayUnion(
                victimName
                  ? `Le Loup Blanc IA (${loupBlancBot.nom}) a frappé un loup en secret.`
                  : `Le Loup Blanc IA (${loupBlancBot.nom}) a épargné la meute cette nuit.`
              ),
            });
            transaction.update(doc(db, 'salons', roomId, 'joueurs', loupBlancBot.id), {
              a_vote: true,
              a_vote_loup_blanc: true,
            });
          });
          return victimName
            ? `Le Loup Blanc IA (${loupBlancBot.nom}) a pris pour cible ${victimName}.`
            : `Le Loup Blanc IA (${loupBlancBot.nom}) n'attaque pas cette nuit.`;
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  // G. Nuit : Sorcière (décision humaine de 6 à 12s)
  if (statut === 'nuit_sorciere') {
    const sorciereBot = aliveBots.find(j => j.role === 'sorciere' && !j.a_vote_sorciere);
    if (sorciereBot) {
      const plannedDelay = getBotActionDelay(sorciereBot.nom, 'sorciere', dayNumber, 6, 12);
      if (elapsedSec >= plannedDelay) {
        const victim = salonData.victime_loups_visible_sorciere;
        const canSave = victim && !sorciereBot.potion_vie_utilisee;
        const shouldSave = canSave && Math.random() < 0.8;

        let poisonTarget = null;
        const canPoison = !sorciereBot.potion_mort_utilisee && (salonData.numero_jour || 1) >= 2;
        if (canPoison && Math.random() < 0.25) {
          const potentialVictims = alivePlayers.filter(
            j => j.id !== sorciereBot.id && j.nom !== victim
          );
          if (potentialVictims.length > 0) {
            poisonTarget = potentialVictims[Math.floor(Math.random() * potentialVictims.length)].nom;
          }
        }

        try {
          await runTransaction(db, async transaction => {
            const updatesSalon = {};
            const updatesSorciere = { a_vote_sorciere: true };
            const notifs = [];

            if (shouldSave) {
              updatesSalon.victime_sauvee = true;
              updatesSorciere.potion_vie_utilisee = true;
              notifs.push(`La Sorcière IA (${sorciereBot.nom}) a sauvé la victime des loups (${victim}).`);
            }
            if (poisonTarget) {
              updatesSalon.victime_sorciere = poisonTarget;
              updatesSorciere.potion_mort_utilisee = true;
              notifs.push(`La Sorcière IA (${sorciereBot.nom}) a empoisonné ${poisonTarget}.`);
            }
            if (!shouldSave && !poisonTarget) {
              notifs.push(`La Sorcière IA (${sorciereBot.nom}) n'a utilisé aucune potion ce soir.`);
            }

            updatesSalon.notifications_mj = arrayUnion(...notifs);
            transaction.update(doc(db, 'salons', roomId), updatesSalon);
            transaction.update(doc(db, 'salons', roomId, 'joueurs', sorciereBot.id), updatesSorciere);
          });
          return `La Sorcière IA (${sorciereBot.nom}) a terminé son tour ${shouldSave ? '(a sauvé)' : ''} ${poisonTarget ? `(a empoisonné ${poisonTarget})` : ''}.`;
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  // G. Nuit : Voleur (4 à 8s)
  if (statut === 'nuit_voleur') {
    const voleurBot = aliveBots.find(j => j.role === 'voleur' && !j.a_vote);
    if (voleurBot) {
      const plannedDelay = getBotActionDelay(voleurBot.nom, 'voleur', dayNumber, 4, 8);
      if (elapsedSec >= plannedDelay) {
        await updateDoc(doc(db, 'salons', roomId, 'joueurs', voleurBot.id), { a_vote: true });
        await updateDoc(doc(db, 'salons', roomId), {
          notifications_mj: arrayUnion(`Le Voleur IA (${voleurBot.nom}) a terminé son tour.`),
        });
        return `Le Voleur IA (${voleurBot.nom}) a passé son tour.`;
      }
    }
  }

  // H. Rôles nocturnes secondaires (Corbeau : 5 à 11s)
  if (['nuit_cupidon', 'nuit_salvateur', 'nuit_voyante', 'nuit_loups', 'nuit_sorciere', 'nuit_voleur'].includes(statut)) {
    const corbeauBot = aliveBots.find(j => j.role === 'corbeau' && !salonData.cible_corbeau);
    if (corbeauBot) {
      const plannedDelay = getBotActionDelay(corbeauBot.nom, 'corbeau', dayNumber, 5, 11);
      if (elapsedSec >= plannedDelay) {
        const candidates = alivePlayers.filter(j => j.id !== corbeauBot.id);
        if (candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          await updateDoc(doc(db, 'salons', roomId), {
            cible_corbeau: target.nom,
            notifications_mj: arrayUnion(`Le Corbeau IA (${corbeauBot.nom}) a maudit ${target.nom} (+2 voix).`),
          });
          actionsSummary.push(`Le Corbeau IA a maudit ${target.nom}.`);
        }
      }
    }
  }

  // I. Journée du Village : Accusations échelonnées
  if (statut === 'jour_accusation') {
    const currentVotes = salonData.votes || {};
    const aliveBots = bots.filter(b => b.statut_joueur !== 'mort' && !b.gracie_idiot);
    const totalAccusationDuration = salonData.duree_accusation !== undefined ? salonData.duree_accusation : 60;
    const allAlive = joueurs.filter(j => j.statut_joueur !== 'mort');

    // Seuls les bots dont le temps de réflexion individuel est atteint accusent maintenant
    const botsReadyToAccuse = aliveBots.filter(b => {
      if (currentVotes[b.nom]) return false;
      const plannedDelay = getBotActionDelay(
        b.nom,
        'jour_accusation',
        dayNumber,
        5,
        Math.max(12, totalAccusationDuration - 8)
      );
      return elapsedSec >= plannedDelay;
    });

    if (botsReadyToAccuse.length > 0) {
      const newVotesUpdates = {};
      const messagesAcc = Array.isArray(salonData.chat_accusation) ? salonData.chat_accusation : [];
      let newChatMsg = null;

      for (const bot of botsReadyToAccuse) {
        const otherAlive = allAlive.filter(j => j.nom !== bot.nom);
        if (otherAlive.length > 0) {
          const seed = getBotActionDelay(bot.nom, 'accuse_choice', dayNumber, 1, 100);
          if (seed <= 15) {
            newVotesUpdates[`votes.${bot.nom}`] = 'Personne';
          } else {
            let candidatePool = otherAlive;

            if (isWolf(bot) && bot.role !== 'loup-blanc') {
              // Les loups normaux ne savent pas lequel des loups de la meute est le Loup Blanc.
              // En temps normal, ils protègent la meute et accusent les villageois.
              // Mais si le Loup Blanc a frappé un loup la nuit (ou dès le Jour 2 s'ils soupçonnent un traître),
              // leur stratégie peut les pousser à accuser un autre loup au hasard pour tenter d'éliminer le Loup Blanc au vote !
              const nonWolves = otherAlive.filter(j => !isWolf(j));
              const packMates = otherAlive.filter(j => isWolf(j));
              const traitorSuspected = Boolean(salonData.loup_blanc_a_frappe || salonData.morts_nuit?.loup_blanc);
              const huntTraitorRoll = getBotActionDelay(bot.nom, 'wolf_hunt_traitor', dayNumber, 1, 100);

              if (traitorSuspected && packMates.length > 0 && huntTraitorRoll <= 45) {
                candidatePool = packMates;
              } else if (nonWolves.length > 0) {
                candidatePool = nonWolves;
              }
            }

            const target = candidatePool[Math.floor((seed / 100) * candidatePool.length) % candidatePool.length].nom;
            newVotesUpdates[`votes.${bot.nom}`] = target;

            // Dépose un argument persuasif dans le chat d'accusations (limité à 3 messages bots pour garder le chat lisible)
            if (!newChatMsg && messagesAcc.filter(m => m.id?.startsWith('bot_acc_')).length < 3) {
              const alreadySpoke = messagesAcc.some(m => m.auteur === bot.nom);
              if (!alreadySpoke) {
                const template = BOT_ACCUSATION_ARGUMENTS[Math.floor(Math.random() * (BOT_ACCUSATION_ARGUMENTS.length - 2))];
                const text = template.replace('{target}', target);
                newChatMsg = {
                  id: 'bot_acc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                  auteur: bot.nom,
                  roleBadge: 'HABITANT',
                  texte: text,
                  heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  timestamp: Date.now(),
                };
              }
            }
          }
        }
      }
      if (newChatMsg) {
        newVotesUpdates.chat_accusation = arrayUnion(newChatMsg);
        actionsSummary.push(`Le Bot ${newChatMsg.auteur} a partagé son réquisitoire dans le chat d'accusations.`);
      }
      if (Object.keys(newVotesUpdates).length > 0) {
        await updateDoc(doc(db, 'salons', roomId), newVotesUpdates);
        actionsSummary.push(`${botsReadyToAccuse.length} Bot(s) ont déposé leur accusation.`);
      }
    }
  }

  // II. Journée du Village : Défenses progressives
  if (statut === 'jour_defense') {
    const aliveBots = bots.filter(b => b.statut_joueur !== 'mort');
    const accusedList = Array.isArray(salonData.la_liste_accuses) ? salonData.la_liste_accuses : [];
    const accusedBots = aliveBots.filter(b => accusedList.includes(b.nom));

    for (const accBot of accusedBots) {
      const alreadySpoke = Array.isArray(salonData.chat_defense) &&
        salonData.chat_defense.some(m => m.auteur === accBot.nom || m.sender === accBot.nom);
      if (!alreadySpoke) {
        const plannedDelay = getBotActionDelay(accBot.nom, 'jour_defense_plea', dayNumber, 5, 18);
        if (elapsedSec >= plannedDelay) {
          const defenseIndex = Math.floor(getBotActionDelay(accBot.nom, 'defense_msg', dayNumber, 0, ACCUSED_DEFENSE_MESSAGES.length));
          const defenseText = ACCUSED_DEFENSE_MESSAGES[defenseIndex % ACCUSED_DEFENSE_MESSAGES.length];
          const msg = {
            id: 'bot_def_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            auteur: accBot.nom,
            sender: accBot.nom,
            texte: defenseText,
            text: defenseText,
            roleBadge: 'ACCUSÉ',
            heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            isAccused: true,
            isMj: false,
          };
          await updateDoc(doc(db, 'salons', roomId), {
            chat_defense: arrayUnion(msg),
          });
          actionsSummary.push(`L'accusé IA ${accBot.nom} a plaidé sa défense.`);
        }
      }
    }

    // Réaction occasionnelle d'un spectateur IA dans le chat de défense
    const nonAccusedBots = aliveBots.filter(b => !accusedList.includes(b.nom));
    if (nonAccusedBots.length > 0 && Array.isArray(salonData.chat_defense) && salonData.chat_defense.length >= 1) {
      const hasSpectatorComment = salonData.chat_defense.some(m => !m.isAccused && !m.isMj);
      if (!hasSpectatorComment && elapsedSec >= 19) {
        const commentator = nonAccusedBots[0];
        const reactIndex = Math.floor(getBotActionDelay(commentator.nom, 'spectator_comment', dayNumber, 0, ACCUSED_CITIZEN_REACTIONS.length));
        const reactText = ACCUSED_CITIZEN_REACTIONS[reactIndex % ACCUSED_CITIZEN_REACTIONS.length];
        const msg = {
          id: 'bot_react_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          auteur: commentator.nom,
          sender: commentator.nom,
          texte: reactText,
          text: reactText,
          roleBadge: 'VILLAGEOIS',
          heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          isAccused: false,
          isMj: false,
        };
        await updateDoc(doc(db, 'salons', roomId), {
          chat_defense: arrayUnion(msg),
        });
        actionsSummary.push(`Le spectateur IA ${commentator.nom} a réagi à la défense.`);
      }
    }
  }

  // III. Journée du Village : Vote d'élimination échelonné
  if (statut === 'jour_vote') {
    const currentVotes = salonData.votes || {};
    const aliveBots = bots.filter(b => b.statut_joueur !== 'mort' && !b.gracie_idiot);
    const totalVoteDuration = salonData.duree_vote !== undefined ? salonData.duree_vote : 60;
    const accusedList = Array.isArray(salonData.la_liste_accuses) && salonData.la_liste_accuses.length > 0
      ? salonData.la_liste_accuses
      : joueurs.filter(j => j.statut_joueur !== 'mort').map(j => j.nom);

    // Les bots votent de manière échelonnée tout au long de la période de vote
    const botsReadyToVote = aliveBots.filter(b => {
      if (currentVotes[b.nom]) return false;
      const plannedDelay = getBotActionDelay(
        b.nom,
        'jour_vote',
        dayNumber,
        6,
        Math.max(12, totalVoteDuration - 7)
      );
      return elapsedSec >= plannedDelay;
    });

    if (botsReadyToVote.length > 0) {
      const newVotesUpdates = {};
      const traitorSuspected = Boolean(salonData.loup_blanc_a_frappe || salonData.morts_nuit?.loup_blanc);
      for (const bot of botsReadyToVote) {
        let choices = accusedList.filter(n => n !== bot.nom);
        if (choices.length === 0) choices = accusedList;

        if (isWolf(bot) && bot.role !== 'loup-blanc' && choices.length > 1) {
          const nonWolfAccused = choices.filter(nom => {
            const p = joueurs.find(j => j.nom === nom);
            return p && !isWolf(p);
          });
          const wolfAccused = choices.filter(nom => {
            const p = joueurs.find(j => j.nom === nom);
            return p && isWolf(p);
          });
          const huntTraitorRoll = getBotActionDelay(bot.nom, 'vote_traitor', dayNumber, 1, 100);
          // Si un traître Loup Blanc est soupçonné dans la meute, les loups peuvent voter contre un loup accusé
          if (traitorSuspected && wolfAccused.length > 0 && huntTraitorRoll <= 55) {
            choices = wolfAccused;
          } else if (nonWolfAccused.length > 0) {
            choices = nonWolfAccused;
          }
        }

        const seed = getBotActionDelay(bot.nom, 'vote_target', dayNumber, 0, choices.length * 10);
        const target = choices[Math.floor(seed) % choices.length];
        newVotesUpdates[`votes.${bot.nom}`] = target;
      }
      if (Object.keys(newVotesUpdates).length > 0) {
        await updateDoc(doc(db, 'salons', roomId), newVotesUpdates);
        actionsSummary.push(`${botsReadyToVote.length} Bot(s) ont voté l'élimination parmi les accusés.`);
      }
    }
  }

  return actionsSummary.length > 0 ? actionsSummary.join(' | ') : null;
}
