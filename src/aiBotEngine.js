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
    proposition_role: null,
  };
}

/** Ajoute 1 Bot IA dans le salon */
export async function addSingleBot(roomId, salonData, existingJoueurs = []) {
  if (!roomId) return null;
  const botName = getAvailableBotName(existingJoueurs);
  const stableId = 'bot_' + roomId + '_' + botName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  // Si on est en attente aléatoire, le bot peut directement piocher une carte disponible
  let cardIndex = null;
  let assignedRole = '';

  if (salonData?.statut === 'en_attente' && salonData.distribution_mode !== 'manuelle' && Array.isArray(salonData.roles_melanges)) {
    const takenCards = new Set(
      existingJoueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => j.carte_choisie)
    );
    for (let i = 0; i < salonData.roles_melanges.length; i++) {
      if (!takenCards.has(i)) {
        cardIndex = i;
        assignedRole = salonData.roles_melanges[i];
        break;
      }
    }
  }

  const botData = createBotPlayerObject(botName, cardIndex, assignedRole);
  await setDoc(doc(db, 'salons', roomId, 'joueurs', stableId), botData);
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

  const takenCards = new Set(
    existingJoueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => j.carte_choisie)
  );

  const availableCardIndices = [];
  if (Array.isArray(salonData.roles_melanges)) {
    for (let i = 0; i < salonData.roles_melanges.length; i++) {
      if (!takenCards.has(i)) availableCardIndices.push(i);
    }
  }

  const batch = writeBatch(db);
  const updatedList = [...existingJoueurs];
  let addedCount = 0;

  for (let k = 0; k < needed; k++) {
    const botName = getAvailableBotName(updatedList);
    const stableId = 'bot_' + roomId + '_' + botName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    let cardIndex = null;
    let assignedRole = '';

    if (salonData.statut === 'en_attente' && salonData.distribution_mode !== 'manuelle' && availableCardIndices.length > 0) {
      cardIndex = availableCardIndices.shift();
      assignedRole = salonData.roles_melanges[cardIndex] || '';
    }

    const botObj = createBotPlayerObject(botName, cardIndex, assignedRole);
    batch.set(doc(db, 'salons', roomId, 'joueurs', stableId), botObj);
    updatedList.push({ id: stableId, ...botObj });
    addedCount++;
  }

  await batch.commit();
  return addedCount;
}

/** Fait tirer les cartes restantes à tous les bots sans carte */
export async function botAutoPickCards(roomId, salonData, existingJoueurs = []) {
  if (!roomId || !salonData || !Array.isArray(salonData.roles_melanges)) return 0;

  const takenCards = new Set(
    existingJoueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => j.carte_choisie)
  );
  const freeCards = [];
  for (let i = 0; i < salonData.roles_melanges.length; i++) {
    if (!takenCards.has(i)) freeCards.push(i);
  }

  const botsWithoutCard = existingJoueurs.filter(j => isBot(j) && j.carte_choisie === null);
  if (botsWithoutCard.length === 0 || freeCards.length === 0) return 0;

  const batch = writeBatch(db);
  let picked = 0;

  for (const bot of botsWithoutCard) {
    if (freeCards.length === 0) break;
    const cardIdx = freeCards.shift();
    const assignedRole = salonData.roles_melanges[cardIdx];

    const updates = {
      carte_choisie: cardIdx,
      role: assignedRole,
      vies: assignedRole === 'ancien' ? 2 : 1,
      infection_dispo: assignedRole === 'infect-pere-des-loups' || assignedRole === 'pere-des-loups',
    };
    if (assignedRole === 'chien-loup') {
      updates.choix_chien = Math.random() < 0.4 ? 'loup' : 'villageois';
    }
    batch.update(doc(db, 'salons', roomId, 'joueurs', bot.id), updates);
    picked++;
  }

  await batch.commit();
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
 * MOTEUR D'ACTION AUTONOME DES BOTS IA
 * Analyse l'état actuel de la partie et fait jouer les bots qui ont un tour à jouer.
 * Retourne un descriptif des actions menées pour affichage au MJ.
 */
export async function runBotTurnStep(roomId, salonData, joueurs = []) {
  if (!roomId || !salonData) return null;
  const bots = joueurs.filter(j => isBot(j));
  if (bots.length === 0) return null;

  const alivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
  const aliveBots = bots.filter(j => j.statut_joueur !== 'mort');
  const actionsSummary = [];

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

  // ── 3. Actions par Phase de Jeu ─────────────────────────────────────────────
  const statut = salonData.statut;

  // A. Phase d'attente : tirage des cartes
  if (statut === 'en_attente') {
    const picked = await botAutoPickCards(roomId, salonData, joueurs);
    if (picked > 0) return `${picked} Bot(s) ont tiré leur carte secrète.`;
    return null;
  }

  // B. Nuit : Cupidon
  if (statut === 'nuit_cupidon') {
    const cupidonBot = aliveBots.find(j => j.role === 'cupidon' && !j.pouvoir_utilise);
    if (cupidonBot && alivePlayers.length >= 2) {
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

  // C. Nuit : Salvateur
  if (statut === 'nuit_salvateur') {
    const salvateurBot = aliveBots.find(j => j.role === 'salvateur' && !j.a_vote);
    if (salvateurBot) {
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

  // D. Nuit : Voyante
  if (statut === 'nuit_voyante') {
    const voyanteBot = aliveBots.find(j => j.role === 'voyante' && !j.a_vote);
    if (voyanteBot) {
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

  // E. Nuit : Loups-Garous
  if (statut === 'nuit_loups') {
    const wolfBots = aliveBots.filter(j => isWolf(j));
    const nonWolfTargets = alivePlayers.filter(j => !isWolf(j));
    const humanWolves = alivePlayers.filter(j => isWolf(j) && !isBot(j));

    if (wolfBots.length > 0 && nonWolfTargets.length > 0) {
      // Choix ou confirmation de la proie
      let targetName = salonData.vote_loup_temporaire;
      if (!targetName || !nonWolfTargets.some(t => t.nom === targetName)) {
        const chosen = nonWolfTargets[Math.floor(Math.random() * nonWolfTargets.length)];
        targetName = chosen.nom;

        // Message dans le chat des loups
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

      // Si Infect Père des Loups bot
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
        // S'il n'y a aucun loup humain dans la meute, les bots confirment directement la proie
        // S'il y a un loup humain, les bots marquent a_vote = true pour valider la proposition tout en laissant l'humain confirmer
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

  // F. Nuit : Sorcière
  if (statut === 'nuit_sorciere') {
    const sorciereBot = aliveBots.find(j => j.role === 'sorciere' && !j.a_vote_sorciere);
    if (sorciereBot) {
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

  // G. Nuit : Voleur
  if (statut === 'nuit_voleur') {
    const voleurBot = aliveBots.find(j => j.role === 'voleur' && !j.a_vote);
    if (voleurBot) {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', voleurBot.id), { a_vote: true });
      await updateDoc(doc(db, 'salons', roomId), {
        notifications_mj: arrayUnion(`Le Voleur IA (${voleurBot.nom}) a terminé son tour.`),
      });
      return `Le Voleur IA (${voleurBot.nom}) a passé son tour.`;
    }
  }

  // H. Rôles nocturnes secondaires (Corbeau / Renard)
  if (['nuit_cupidon', 'nuit_salvateur', 'nuit_voyante', 'nuit_loups', 'nuit_sorciere', 'nuit_voleur'].includes(statut)) {
    const corbeauBot = aliveBots.find(j => j.role === 'corbeau' && !salonData.cible_corbeau);
    if (corbeauBot) {
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

  // I. Jour : Vote du Village
  if (statut === 'jour_vote') {
    const currentVotes = salonData.votes || {};
    const aliveBots = bots.filter(b => b.statut_joueur !== 'mort' && !b.gracie_idiot);
    const hasAccusedList = Array.isArray(salonData.la_liste_accuses) && salonData.la_liste_accuses.length > 0;

    if (hasAccusedList) {
      // 1. Les accusés bots envoient un message de défense s'ils ne l'ont pas encore fait
      const accusedBots = aliveBots.filter(b => salonData.la_liste_accuses.includes(b.nom));
      for (const accBot of accusedBots) {
        const alreadySpoke = Array.isArray(salonData.chat_defense) && salonData.chat_defense.some(m => m.sender === accBot.nom);
        if (!alreadySpoke) {
          const defenseText = ACCUSED_DEFENSE_MESSAGES[Math.floor(Math.random() * ACCUSED_DEFENSE_MESSAGES.length)];
          const msg = {
            id: 'bot_def_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            sender: accBot.nom,
            text: defenseText,
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

      // 2. Les bots votent contre l'un des accusés
      const botsNeedToVote = aliveBots.filter(b => !currentVotes[b.nom]);
      if (botsNeedToVote.length > 0) {
        const newVotesUpdates = {};
        for (const bot of botsNeedToVote) {
          // Le bot évite de voter pour lui-même s'il y a un autre accusé
          let choices = salonData.la_liste_accuses.filter(n => n !== bot.nom);
          if (choices.length === 0) choices = salonData.la_liste_accuses;
          const target = choices[Math.floor(Math.random() * choices.length)];
          newVotesUpdates[`votes.${bot.nom}`] = target;
        }
        await updateDoc(doc(db, 'salons', roomId), newVotesUpdates);
        actionsSummary.push(`${botsNeedToVote.length} Bot(s) ont voté contre les accusés.`);
      }
    } else {
      // Phase d'accusations libres : les bots désignent des suspects
      const botsNeedToVote = aliveBots.filter(b => !currentVotes[b.nom]);
      if (botsNeedToVote.length > 0) {
        const allAlive = joueurs.filter(j => j.statut_joueur !== 'mort');
        const newVotesUpdates = {};
        for (const bot of botsNeedToVote) {
          const otherAlive = allAlive.filter(j => j.nom !== bot.nom);
          if (otherAlive.length > 0) {
            const target = otherAlive[Math.floor(Math.random() * otherAlive.length)].nom;
            newVotesUpdates[`votes.${bot.nom}`] = target;
          }
        }
        if (Object.keys(newVotesUpdates).length > 0) {
          await updateDoc(doc(db, 'salons', roomId), newVotesUpdates);
          actionsSummary.push(`${botsNeedToVote.length} Bot(s) ont déposé leurs accusations.`);
        }
      }
    }

    if (actionsSummary.length > 0) {
      return actionsSummary.join(' | ');
    }
  }

  return actionsSummary.length > 0 ? actionsSummary.join(' | ') : null;
}
