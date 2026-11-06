import { useRef, useEffect } from 'react';
import {
  doc, updateDoc, writeBatch, runTransaction, arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';
import { isWolf, ALL_NIGHT_PHASES, shuffleArray } from './gameLogic';
import { getRole } from './rolesData';

/**
 * Calcule la liste ordonnée des phases de nuit actives selon l'état des joueurs.
 */
export function computeNightPhasesAuto(joueurs = []) {
  const alive = joueurs.filter(j => j.statut_joueur !== 'mort');
  const phases = [];

  if (alive.some(j => j.role === 'cupidon' && !j.pouvoir_utilise))
    phases.push('nuit_cupidon');
  if (alive.some(j => j.role === 'salvateur'))
    phases.push('nuit_salvateur');
  if (alive.some(j => j.role === 'voyante'))
    phases.push('nuit_voyante');
  if (alive.some(j => isWolf(j)))
    phases.push('nuit_loups');
  if (alive.some(j => j.role === 'sorciere' && (!j.potion_vie_utilisee || !j.potion_mort_utilisee)))
    phases.push('nuit_sorciere');
  if (alive.some(j => j.role === 'voleur' && !j.a_vote))
    phases.push('nuit_voleur');

  return phases;
}

/**
 * Calcule la phase nocturne suivante ou renvoie 'matin'.
 */
export function getNextNightPhaseAuto(currentPhase, joueurs = []) {
  const phases = computeNightPhasesAuto(joueurs);
  const currentIndex = ALL_NIGHT_PHASES.indexOf(currentPhase);
  if (currentIndex === -1) return 'matin';

  for (let i = currentIndex + 1; i < ALL_NIGHT_PHASES.length; i++) {
    if (phases.includes(ALL_NIGHT_PHASES[i])) return ALL_NIGHT_PHASES[i];
  }
  return 'matin';
}

/**
 * Vérifie si la partie est terminée (victoire village ou victoire loups).
 */
export function checkGameEnd(joueurs = []) {
  const alive = joueurs.filter(j => j.statut_joueur !== 'mort');
  if (alive.length === 0) return 'fin_village';

  const wolves = alive.filter(j => isWolf(j));
  const nonWolves = alive.filter(j => !isWolf(j));

  if (wolves.length === 0) return 'fin_village';
  if (wolves.length >= nonWolves.length) return 'fin_loups';

  return null;
}

/**
 * Hook React pour exécuter la boucle de Maître du Jeu Automatisé.
 */
export function useAutoMj(roomId, salonData, joueurs = []) {
  const isRunningRef = useRef(false);

  useEffect(() => {
    if (!salonData?.mj_automatique || !roomId) return;

    const interval = setInterval(async () => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      try {
        await runAutoMjStep(roomId, salonData, joueurs);
      } catch (e) {
        console.error('Erreur useAutoMj:', e);
      } finally {
        isRunningRef.current = false;
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [
    roomId,
    salonData?.mj_automatique,
    salonData?.statut,
    salonData?.auto_mj_phase_started_at,
    salonData?.votes,
    salonData?.couple,
    salonData?.victime_loups,
    joueurs,
  ]);
}


/**
 * Lancement automatique de la partie depuis 'en_attente'.
 */
export async function executeStartGameAuto(roomId, salonData, joueurs = []) {
  const phases = computeNightPhasesAuto(joueurs);
  const firstPhase = phases[0] || 'nuit_loups';

  await updateDoc(doc(db, 'salons', roomId), {
    statut: firstPhase,
    auto_mj_phase_started_at: Date.now(),
    auto_mj_last_tick: Date.now(),
    notifications_mj: arrayUnion("Le Maître du Jeu Automatisé a lancé la partie. La nuit tombe sur le village..."),
  });
  return `Partie lancée automatiquement en phase ${firstPhase}.`;
}

/**
 * Avance vers la phase de nuit suivante.
 */
export async function executeNextNightPhaseAuto(roomId, salonData, joueurs = []) {
  const next = getNextNightPhaseAuto(salonData.statut, joueurs);
  const updates = {
    statut: next,
    auto_mj_phase_started_at: Date.now(),
    auto_mj_last_tick: Date.now(),
  };

  if (salonData.statut === 'nuit_loups' && salonData.victime_loups) {
    const victimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
    const isProtected       = victimDoc?.nom === salonData.joueur_protege;
    const isAncienFirstLife = victimDoc?.role === 'ancien' && (victimDoc?.vies ?? 2) > 1;
    const isInfection       = !!salonData.infection_active;

    updates.victime_loups_visible_sorciere =
      (isProtected || isAncienFirstLife || isInfection) ? null : salonData.victime_loups;
  }

  await updateDoc(doc(db, 'salons', roomId), updates);
  return `Phase de nuit passée à ${next}.`;
}

/**
 * Résolution automatique de la nuit : calcul des morts et passage au lever du jour.
 */
export async function executeApplyNightDeathsAuto(roomId, salonData, joueurs = []) {
  try {
    await runTransaction(db, async transaction => {
      let diedFromLoups    = false;
      let diedFromSorciere = false;
      let notifMj          = null;
      const newNotifications = [];
      const deadPlayerIds = new Set();

      const isInfectRole = r => r === 'infect-pere-des-loups' || r === 'pere-des-loups';
      const isChevalierRole = r => r === 'chevalier-epee' || r === 'chevalier';

      // 1. Victime des loups
      if (salonData.victime_loups && !salonData.victime_sauvee) {
        const loupVictimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
        if (loupVictimDoc) {
          const isProtected       = loupVictimDoc.nom === salonData.joueur_protege;
          const isAncienFirstLife = loupVictimDoc.role === 'ancien' && (loupVictimDoc.vies ?? 2) > 1;

          if (isProtected) {
            if (salonData.infection_active) {
              const infectPere = joueurs.find(j => isInfectRole(j.role));
              if (infectPere) {
                transaction.update(doc(db, 'salons', roomId, 'joueurs', infectPere.id), { infection_dispo: true });
              }
              newNotifications.push("L'Infection a échoué car la cible était protégée par le Salvateur.");
            }
          } else if (isAncienFirstLife) {
            transaction.update(doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id), { vies: 1 });
            if (salonData.infection_active) {
              const infectPere = joueurs.find(j => isInfectRole(j.role));
              if (infectPere) {
                transaction.update(doc(db, 'salons', roomId, 'joueurs', infectPere.id), { infection_dispo: true });
              }
              newNotifications.push("L'Ancien a résisté à l'infection grâce à sa première vie.");
            } else {
              notifMj = `L'Ancien (${loupVictimDoc.nom}) a survécu à l'attaque des loups.`;
            }
          } else {
            if (salonData.infection_active) {
              if (isChevalierRole(loupVictimDoc.role)) {
                transaction.update(doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id), { statut_joueur: 'mort' });
                deadPlayerIds.add(loupVictimDoc.id);
                diedFromLoups = true;
                transaction.update(doc(db, 'salons', roomId), {
                  venin_chevalier_actif: true,
                  index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id),
                });
              } else {
                transaction.update(doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id), { est_infecte: true });
                newNotifications.push(`${loupVictimDoc.nom} a été infecté et rejoint le camp des loups.`);
              }
            } else {
              transaction.update(doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id), { statut_joueur: 'mort' });
              deadPlayerIds.add(loupVictimDoc.id);
              diedFromLoups = true;
              if (isChevalierRole(loupVictimDoc.role)) {
                transaction.update(doc(db, 'salons', roomId), {
                  venin_chevalier_actif: true,
                  index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id),
                });
              }
            }
          }
        }
      }

      // 2. Victime de la Sorcière
      if (salonData.victime_sorciere) {
        const sorcVictimDoc = joueurs.find(j => j.nom === salonData.victime_sorciere);
        if (sorcVictimDoc) {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', sorcVictimDoc.id), { statut_joueur: 'mort' });
          deadPlayerIds.add(sorcVictimDoc.id);
          diedFromSorciere = true;
        }
      }

      // 3. Cascade Amoureux
      let chagrinNom = null;
      if (Array.isArray(salonData.couple) && salonData.couple.length === 2) {
        const [c1, c2] = salonData.couple;
        if (deadPlayerIds.has(c1) && !deadPlayerIds.has(c2)) {
          const p2 = joueurs.find(j => j.id === c2);
          if (p2 && p2.statut_joueur !== 'mort') {
            transaction.update(doc(db, 'salons', roomId, 'joueurs', p2.id), { statut_joueur: 'mort' });
            deadPlayerIds.add(p2.id);
            chagrinNom = p2.nom;
            newNotifications.push(`Amoureux : ${p2.nom} meurt de chagrin suite à la mort de son âme sœur.`);
          }
        } else if (deadPlayerIds.has(c2) && !deadPlayerIds.has(c1)) {
          const p1 = joueurs.find(j => j.id === c1);
          if (p1 && p1.statut_joueur !== 'mort') {
            transaction.update(doc(db, 'salons', roomId, 'joueurs', p1.id), { statut_joueur: 'mort' });
            deadPlayerIds.add(p1.id);
            chagrinNom = p1.nom;
            newNotifications.push(`Amoureux : ${p1.nom} meurt de chagrin suite à la mort de son âme sœur.`);
          }
        }
      }

      // 4. Modèle de l'Enfant Sauvage
      joueurs.forEach(j => {
        if (
          j.role === 'enfant-sauvage' &&
          j.statut_joueur !== 'mort' &&
          !deadPlayerIds.has(j.id) &&
          j.modele_id &&
          deadPlayerIds.has(j.modele_id) &&
          !j.enfant_devenu_loup
        ) {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', j.id), { enfant_devenu_loup: true });
          newNotifications.push(`Enfant Sauvage : Le modèle de ${j.nom} est mort, ${j.nom} rejoint les loups !`);
        }
      });

      // 5. Bilan structuré des morts
      const mortsDetails = [];
      if (diedFromLoups && salonData.victime_loups) {
        const p = joueurs.find(j => j.nom === salonData.victime_loups);
        if (p) mortsDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: 'Dévoré par les Loups-Garous', est_infecte: !!p.est_infecte });
      }
      if (diedFromSorciere && salonData.victime_sorciere) {
        const p = joueurs.find(j => j.nom === salonData.victime_sorciere);
        if (p) mortsDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: 'Empoisonné par la Sorcière', est_infecte: !!p.est_infecte });
      }
      if (salonData.morts_nuit?.venin) {
        const p = joueurs.find(j => j.nom === salonData.morts_nuit.venin);
        if (p) mortsDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: "Empoisonné par le Chevalier à l'Épée Rouillée", est_infecte: !!p.est_infecte });
      }
      if (chagrinNom) {
        const p = joueurs.find(j => j.nom === chagrinNom);
        if (p) mortsDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: "Mort de chagrin d'amour", est_infecte: !!p.est_infecte });
      }

      // 6. Vérification condition victoire
      const updatedJoueurs = joueurs.map(j => deadPlayerIds.has(j.id) ? { ...j, statut_joueur: 'mort' } : j);
      const gameEnd = checkGameEnd(updatedJoueurs);

      const salonUpdates = {
        statut: gameEnd || 'jour_accusation',
        morts_nuit: {
          loups:    diedFromLoups    ? salonData.victime_loups    : null,
          sorciere: diedFromSorciere ? salonData.victime_sorciere : null,
          venin:    salonData.morts_nuit?.venin || null,
          chagrin:  chagrinNom,
        },
        morts_nuit_details: mortsDetails,
        infection_active: false,
        notif_mj: notifMj,
        la_liste_accuses: [],
        votes: {},
        chat_defense: [],
        phase_started_at: Date.now(),
        auto_mj_phase_started_at: Date.now(),
        auto_mj_last_tick: Date.now(),
      };
      if (newNotifications.length > 0) {
        salonUpdates.notifications_mj = arrayUnion(...newNotifications);
      }
      transaction.update(doc(db, 'salons', roomId), salonUpdates);
    });
    return 'Bilan de la nuit résolu automatiquement.';
  } catch (err) {
    console.error('Erreur executeApplyNightDeathsAuto:', err);
    return null;
  }
}

/**
 * Clôture automatique de la phase d'accusations et passage aux défenses (ou directement résolution si 0 accusé).
 */
export async function executeCloseAccusationsAuto(roomId, salonData, joueurs = []) {
  const votesRaw = salonData.votes || {};
  const accusesCount = {};

  // Pénalité Corbeau
  if (salonData.cible_corbeau) {
    const cibleAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
    if (cibleAlive) {
      accusesCount[salonData.cible_corbeau] = (accusesCount[salonData.cible_corbeau] || 0) + 2;
    }
  }

  Object.entries(votesRaw).forEach(([votant, cible]) => {
    const p = joueurs.find(j => j.nom === votant && j.statut_joueur !== 'mort' && !p.gracie_idiot);
    if (p && cible) {
      const targets = Array.isArray(cible) ? cible : [cible];
      targets.forEach(t => {
        if (t && t !== 'Personne') {
          accusesCount[t] = (accusesCount[t] || 0) + 1;
        }
      });
    }
  });

  const finalAccuses = Object.keys(accusesCount).filter(nom => accusesCount[nom] > 0);

  // Si aucun joueur n'a été accusé
  if (finalAccuses.length === 0) {
    await updateDoc(doc(db, 'salons', roomId), {
      statut: 'jour_resolution',
      condamne_jour: 'Personne (Aucun accusé)',
      verdict_details: {
        type: 'personne',
        raison: "Le village a choisi de n'accuser personne aujourd'hui. Le bûcher reste éteint.",
        timestamp: Date.now(),
      },
      phase_started_at: Date.now(),
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return "Aucun accusé désigné : passage à la résolution.";
  }

  await updateDoc(doc(db, 'salons', roomId), {
    statut: 'jour_defense',
    la_liste_accuses: finalAccuses,
    votes: {},
    chat_defense: [],
    phase_started_at: Date.now(),
    auto_mj_phase_started_at: Date.now(),
    auto_mj_last_tick: Date.now(),
  });
  return `Accusations terminées : ${finalAccuses.length} accusé(s) en défense.`;
}

/**
 * Clôture automatique de la phase de défense et passage au vote d'élimination.
 */
export async function executeCloseDefenseAuto(roomId, salonData, joueurs = []) {
  await updateDoc(doc(db, 'salons', roomId), {
    statut: 'jour_vote',
    votes: {},
    phase_started_at: Date.now(),
    auto_mj_phase_started_at: Date.now(),
    auto_mj_last_tick: Date.now(),
  });
  return "Défenses terminées : ouverture du vote d'élimination.";
}

/**
 * Résolution automatique du vote du village (passage à 'jour_resolution').
 */
export async function executeApplyDaySentenceAuto(roomId, salonData, joueurs = []) {
  const votesRaw = salonData.votes || {};
  const votesCount = {};

  // Pénalité Corbeau si parmi les accusés
  const allowedCandidates = Array.isArray(salonData.la_liste_accuses) && salonData.la_liste_accuses.length > 0
    ? new Set([...salonData.la_liste_accuses, 'Personne'])
    : null;

  if (salonData.cible_corbeau && (!allowedCandidates || allowedCandidates.has(salonData.cible_corbeau))) {
    const cibleAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
    if (cibleAlive) {
      votesCount[salonData.cible_corbeau] = (votesCount[salonData.cible_corbeau] || 0) + 2;
    }
  }

  // Agréger votes des vivants autorisés pour l'élimination parmi les accusés
  Object.entries(votesRaw).forEach(([votant, cible]) => {
    const p = joueurs.find(j => j.nom === votant);
    if (p && p.statut_joueur !== 'mort' && !p.gracie_idiot && cible) {
      const targets = Array.isArray(cible) ? cible : [cible];
      targets.forEach(t => {
        if (t && (!allowedCandidates || allowedCandidates.has(t))) {
          votesCount[t] = (votesCount[t] || 0) + 1;
        }
      });
    }
  });

  // Si aucun vote ou si "Personne" gagne
  if (Object.keys(votesCount).length === 0 || (votesCount['Personne'] && Object.keys(votesCount).length === 1)) {
    await updateDoc(doc(db, 'salons', roomId), {
      statut: 'jour_resolution',
      condamne_jour: 'Personne (Vote blanc)',
      verdict_details: {
        type: 'personne',
        raison: "Le village a choisi de n'accuser personne aujourd'hui. Aucun habitant n'est éliminé.",
        timestamp: Date.now(),
      },
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return "Vote du village terminé : aucun éliminé.";
  }

  // Calcul du gagnant des votes
  let maxVotes = 0;
  let condamneNom = null;
  let tie = false;

  for (const [nom, count] of Object.entries(votesCount)) {
    if (count > maxVotes) {
      maxVotes = count;
      condamneNom = nom;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  // Égalité
  if (tie) {
    const bouc = joueurs.find(j => j.role === 'bouc-emissaire' && j.statut_joueur !== 'mort');
    if (bouc) {
      condamneNom = bouc.nom;
    } else {
      await updateDoc(doc(db, 'salons', roomId), {
        statut: 'jour_resolution',
        condamne_jour: 'Personne (Égalité)',
        verdict_details: {
          type: 'personne',
          raison: "Égalité parfaite des votes sans Bouc Émissaire : personne n'est condamné.",
          timestamp: Date.now(),
        },
        auto_mj_phase_started_at: Date.now(),
        auto_mj_last_tick: Date.now(),
      });
      return "Vote terminé par une égalité sans victime.";
    }
  }

  if (condamneNom === 'Personne' || !condamneNom) {
    await updateDoc(doc(db, 'salons', roomId), {
      statut: 'jour_resolution',
      condamne_jour: 'Personne (Grâce du village)',
      verdict_details: {
        type: 'personne',
        raison: "La majorité a voté pour n'accuser personne. Le bûcher reste éteint.",
        timestamp: Date.now(),
      },
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return "Le village a gracié tous les suspects.";
  }

  const condamne = joueurs.find(j => j.nom === condamneNom);
  if (!condamne) return null;

  // 1. Illusionniste
  if (condamne.role === 'illusionniste' && salonData.illusion_active) {
    await updateDoc(doc(db, 'salons', roomId), {
      illusion_active: false,
      statut: 'jour_resolution',
      condamne_jour: `${condamneNom} (Sauvé par son Illusion)`,
      verdict_details: {
        type: 'illusion_sauve',
        epargne: {
          id: condamne.id,
          nom: condamne.nom,
          role: condamne.role,
          raison: "C'était une illusion : le village a exécuté un leurre !",
        },
        timestamp: Date.now(),
      },
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return `L'Illusionniste (${condamneNom}) a survécu au bûcher !`;
  }

  // 2. Idiot du Village
  if (condamne.role === 'idiot-village' && !condamne.gracie_idiot) {
    await updateDoc(doc(db, 'salons', roomId, 'joueurs', condamne.id), { gracie_idiot: true });
    await updateDoc(doc(db, 'salons', roomId), {
      statut: 'jour_resolution',
      condamne_jour: `${condamneNom} (Gracié — Idiot du Village)`,
      verdict_details: {
        type: 'idiot_gracie',
        epargne: {
          id: condamne.id,
          nom: condamne.nom,
          role: condamne.role,
          raison: "Idiot du Village : gracié par le village, il survit mais perd son droit de vote.",
        },
        timestamp: Date.now(),
      },
      notifications_mj: arrayUnion(`Idiot du Village : ${condamneNom} a été gracié par le village et perd son droit de vote.`),
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return `${condamneNom} est l'Idiot du Village : il est gracié !`;
  }

  // 3. Ange (condamné tour 1)
  if (condamne.role === 'ange' && (salonData.numero_jour || 1) === 1) {
    await updateDoc(doc(db, 'salons', roomId, 'joueurs', condamne.id), { statut_joueur: 'mort' });
    await updateDoc(doc(db, 'salons', roomId), {
      statut: 'fin_ange',
      condamne_jour: `${condamneNom} (Victoire de l'Ange)`,
      verdict_details: {
        type: 'victoire_ange',
        victimes: [{
          id: condamne.id,
          nom: condamne.nom,
          role: condamne.role,
          raison: "L'Ange a réussi à se faire condamner au premier tour et remporte la partie !",
        }],
        timestamp: Date.now(),
      },
      notifications_mj: arrayUnion(`L'Ange (${condamneNom}) a été éliminé au premier vote et remporte la partie seul !`),
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });
    return `L'Ange (${condamneNom}) remporte la partie !`;
  }

  // 4. Condamnation classique (+ cascade amoureux + enfant sauvage)
  const batch = writeBatch(db);
  batch.update(doc(db, 'salons', roomId, 'joueurs', condamne.id), { statut_joueur: 'mort' });

  let condamneLabel = condamneNom;
  const deadIds = new Set([condamne.id]);
  const notifs = [];
  const victimesVerdict = [{
    id: condamne.id,
    nom: condamne.nom,
    role: condamne.role,
    raison: condamne.role === 'bouc-emissaire'
      ? 'Sacrifié suite à une égalité des votes (Bouc Émissaire)'
      : 'Condamné par le vote du bûcher',
    est_infecte: !!condamne.est_infecte,
  }];

  if (Array.isArray(salonData.couple) && salonData.couple.length === 2 && salonData.couple.includes(condamne.id)) {
    const partnerId = salonData.couple.find(id => id !== condamne.id);
    const partner = joueurs.find(j => j.id === partnerId);
    if (partner && partner.statut_joueur !== 'mort') {
      batch.update(doc(db, 'salons', roomId, 'joueurs', partner.id), { statut_joueur: 'mort' });
      deadIds.add(partner.id);
      condamneLabel = `${condamneNom} + ${partner.nom} (chagrin d'amour)`;
      notifs.push(`Amoureux : ${partner.nom} meurt de chagrin suite à l'exécution de ${condamneNom}.`);
      victimesVerdict.push({
        id: partner.id,
        nom: partner.nom,
        role: partner.role,
        raison: "Mort de chagrin d'amour",
        est_infecte: !!partner.est_infecte,
      });
    }
  }

  joueurs.forEach(j => {
    if (
      j.role === 'enfant-sauvage' &&
      j.statut_joueur !== 'mort' &&
      !deadIds.has(j.id) &&
      j.modele_id &&
      deadIds.has(j.modele_id) &&
      !j.enfant_devenu_loup
    ) {
      batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), { enfant_devenu_loup: true });
      notifs.push(`Enfant Sauvage : Le modèle de ${j.nom} a été exécuté, ${j.nom} rejoint les loups !`);
    }
  });

  const updatedJoueurs = joueurs.map(j => deadIds.has(j.id) ? { ...j, statut_joueur: 'mort' } : j);
  const gameEnd = checkGameEnd(updatedJoueurs);

  const salonUpd = {
    statut: gameEnd || 'jour_resolution',
    condamne_jour: condamneLabel,
    verdict_details: {
      type: 'condamnation',
      victimes: victimesVerdict,
      timestamp: Date.now(),
    },
    auto_mj_phase_started_at: Date.now(),
    auto_mj_last_tick: Date.now(),
  };
  if (notifs.length > 0) {
    salonUpd.notifications_mj = arrayUnion(...notifs);
  }
  batch.update(doc(db, 'salons', roomId), salonUpd);
  await batch.commit();

  return `${condamneNom} a été condamné au bûcher. Son rôle était ${condamne.role}.`;
}

/**
 * Lancement automatique de la nuit suivante depuis 'jour_resolution'.
 */
export async function executeNextNightAuto(roomId, salonData, joueurs = []) {
  try {
    const batch = writeBatch(db);
    const phases = computeNightPhasesAuto(joueurs);
    const firstPhase = phases[0] || 'nuit_loups';

    let veninVictim = null;
    let veninNotif  = null;

    if (salonData.venin_chevalier_actif && salonData.index_chevalier !== null && salonData.index_chevalier !== undefined) {
      const idx = salonData.index_chevalier;
      for (let i = 1; i <= joueurs.length; i++) {
        const checkIdx = (idx + i) % joueurs.length;
        const p = joueurs[checkIdx];
        if (p.statut_joueur !== 'mort' && isWolf(p)) {
          veninVictim = p;
          break;
        }
      }
      if (veninVictim) {
        batch.update(doc(db, 'salons', roomId, 'joueurs', veninVictim.id), { statut_joueur: 'mort' });
        veninNotif = `Le venin de l'épée rouillée du Chevalier a frappé : ${veninVictim.nom} succombe à ses blessures.`;
      }
    }

    batch.update(doc(db, 'salons', roomId), {
      statut: firstPhase,
      numero_jour: (salonData.numero_jour || 1) + 1,
      victime_loups: null,
      victime_loups_visible_sorciere: null,
      victime_sauvee: false,
      victime_sorciere: null,
      vote_loup_temporaire: null,
      joueur_protege: null,
      cible_corbeau: null,
      illusion_active: false,
      infection_active: false,
      condamne_jour: null,
      verdict_details: null,
      victime_chasseur_details: null,
      morts_nuit: veninVictim ? { venin: veninVictim.nom } : null,
      morts_nuit_details: veninVictim ? [{
        id: veninVictim.id,
        nom: veninVictim.nom,
        role: veninVictim.role,
        raison: "Empoisonné par le Chevalier à l'Épée Rouillée",
        est_infecte: !!veninVictim.est_infecte,
      }] : null,
      la_liste_accuses: [],
      votes: {},
      chat_loups: [],
      chat_defense: [],
      notif_mj: null,
      notifications_mj: veninNotif ? [veninNotif] : [],
      venin_chevalier_actif: false,
      auto_mj_phase_started_at: Date.now(),
      auto_mj_last_tick: Date.now(),
    });

    joueurs.forEach(j => {
      batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
        a_vote: false,
        a_vote_sorciere: false,
        vote_jour: null,
        infection_repondu: false,
      });
    });

    await batch.commit();
    return `La nuit tombe à nouveau (phase : ${firstPhase}).`;
  } catch (err) {
    console.error('Erreur executeNextNightAuto:', err);
    return null;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOUCLE DU MAÎTRE DU JEU AUTOMATIQUE (IA MASTER)
 * ═══════════════════════════════════════════════════════════════════════════
 * Cette fonction est appelée régulièrement par les clients quand
 * salonData.mj_automatique === true.
 */
export async function runAutoMjStep(roomId, salonData, joueurs = []) {
  if (!roomId || !salonData || !salonData.mj_automatique) return null;

  const now = Date.now();
  const lastTick = salonData.auto_mj_last_tick || 0;
  if (now - lastTick < 1800) return null; // Throttle distributed triggers

  const statut = salonData.statut;
  const phaseStartedAt = salonData.auto_mj_phase_started_at || salonData.created_at || now;
  const elapsedSec = (now - phaseStartedAt) / 1000;

  const alivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');

  // 1. EN ATTENTE : Lancement automatique dès que tout le monde est prêt
  if (statut === 'en_attente') {
    const targetRoles = salonData.roles_selectionnes || [];
    if (targetRoles.length > 0 && joueurs.length >= targetRoles.length) {
      const allPicked = joueurs.every(j => j.carte_choisie !== null && j.carte_choisie !== undefined);
      if (allPicked && elapsedSec >= 3) {
        return await executeStartGameAuto(roomId, salonData, joueurs);
      }
    }
    return null;
  }

  // 2. PHASES DE NUIT
  if (statut === 'nuit_cupidon') {
    const hasCupidon = alivePlayers.some(j => j.role === 'cupidon' && !j.pouvoir_utilise);
    const coupleFormed = Array.isArray(salonData.couple) && salonData.couple.length === 2;
    if (!hasCupidon || coupleFormed || elapsedSec >= 25) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  if (statut === 'nuit_salvateur') {
    const salvateurs = alivePlayers.filter(j => j.role === 'salvateur');
    const salvateurDone = salvateurs.length === 0 || salvateurs.every(s => s.a_vote);
    if (salvateurDone || elapsedSec >= 22) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  if (statut === 'nuit_voyante') {
    const voyantes = alivePlayers.filter(j => j.role === 'voyante');
    const voyanteDone = voyantes.length === 0 || voyantes.every(v => v.a_vote);
    if (voyanteDone || elapsedSec >= 22) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  if (statut === 'nuit_loups') {
    const wolves = alivePlayers.filter(j => isWolf(j));
    const targetChosen = !!salonData.victime_loups;
    const allWolvesVoted = wolves.length > 0 && wolves.every(w => w.a_vote);
    if (wolves.length === 0 || targetChosen || allWolvesVoted || elapsedSec >= 35) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  if (statut === 'nuit_sorciere') {
    const sorcieres = alivePlayers.filter(j => j.role === 'sorciere' && (!j.potion_vie_utilisee || !j.potion_mort_utilisee));
    const sorciereDone = sorcieres.length === 0 || sorcieres.every(s => s.a_vote_sorciere);
    if (sorciereDone || elapsedSec >= 25) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  if (statut === 'nuit_voleur') {
    const voleurs = alivePlayers.filter(j => j.role === 'voleur');
    const voleurDone = voleurs.length === 0 || voleurs.every(v => v.a_vote);
    if (voleurDone || elapsedSec >= 20) {
      return await executeNextNightPhaseAuto(roomId, salonData, joueurs);
    }
  }

  // 3. MATIN : Résolution de la nuit
  if (statut === 'matin') {
    return await executeApplyNightDeathsAuto(roomId, salonData, joueurs);
  }

  // 4. JOUR ACCUSATIONS : Délibérations et désignation des suspects
  if (statut === 'jour_accusation') {
    const dureeAccusation = salonData.duree_accusation !== undefined ? salonData.duree_accusation : 60;
    const voters = alivePlayers.filter(j => !j.gracie_idiot);
    const votes = salonData.votes || {};
    const votedCount = voters.filter(v => {
      const val = votes[v.nom];
      if (Array.isArray(val)) return val.length > 0;
      return Boolean(val);
    }).length;

    // Si tout le monde a accusé ou si le temps limite d'accusation est atteint
    if ((voters.length > 0 && votedCount >= voters.length) || (dureeAccusation > 0 && elapsedSec >= dureeAccusation)) {
      return await executeCloseAccusationsAuto(roomId, salonData, joueurs);
    }
  }

  // 5. JOUR DÉFENSE : Plaidoyer des accusés dans le chat de défense
  if (statut === 'jour_defense') {
    const dureeDefense = salonData.duree_defense !== undefined ? salonData.duree_defense : 60;
    if (dureeDefense > 0 && elapsedSec >= dureeDefense) {
      return await executeCloseDefenseAuto(roomId, salonData, joueurs);
    }
  }

  // 6. JOUR VOTE : Clôture du vote d'élimination
  if (statut === 'jour_vote') {
    const dureeVote = salonData.duree_vote !== undefined ? salonData.duree_vote : 60;
    const voters = alivePlayers.filter(j => !j.gracie_idiot);
    const votes = salonData.votes || {};
    const votedCount = voters.filter(v => {
      const val = votes[v.nom];
      if (Array.isArray(val)) return val.length > 0;
      return Boolean(val);
    }).length;

    // Si tout le monde a voté, ou après expiration du délai de vote
    if ((voters.length > 0 && votedCount >= voters.length) || (dureeVote > 0 && elapsedSec >= dureeVote)) {
      return await executeApplyDaySentenceAuto(roomId, salonData, joueurs);
    }
  }

  // 5. JOUR RÉSOLUTION : Affichage de la mort et du rôle puis passage à la nuit suivante
  if (statut === 'jour_resolution') {
    // Vérifier si un chasseur mort doit tirer
    const chasseurEnAttente = alivePlayers.some(j => j.role === 'chasseur' && j.statut_joueur === 'mort' && j.tir_chasseur_fait === false);
    if (chasseurEnAttente) {
      return null; // On attend impérativement le tir de vengeance du chasseur
    }

    // Pause de 12 secondes pour que tout le monde voie qui est mort et son rôle
    if (elapsedSec >= 12) {
      return await executeNextNightAuto(roomId, salonData, joueurs);
    }
  }

  return null;
}

