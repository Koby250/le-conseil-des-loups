import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  writeBatch, runTransaction, arrayUnion,
} from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import {
  Users, RefreshCw, Eye, Settings, Play,
  Link as LinkIcon, Info, ChevronRight, Bell,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * Calcule la liste ordonnée des phases de nuit actives en fonction de l'état des joueurs.
 * Les phases dont le rôle est absent ou épuisé sont automatiquement ignorées.
 */
function computeNightPhases(joueurs) {
  const alive = joueurs.filter(j => j.statut_joueur !== 'mort');
  const phases = [];

  if (alive.some(j => j.role === 'cupidon' && !j.pouvoir_utilise))
    phases.push('nuit_cupidon');
  if (alive.some(j => j.role === 'salvateur'))
    phases.push('nuit_salvateur');
  if (alive.some(j => j.role === 'voyante'))
    phases.push('nuit_voyante');
  if (alive.some(j => j.role?.toLowerCase().includes('loup') || j.est_infecte === true))
    phases.push('nuit_loups');
  if (alive.some(j => j.role === 'sorciere'))
    phases.push('nuit_sorciere');
  if (alive.some(j => j.role === 'voleur' && !j.pouvoir_utilise))
    phases.push('nuit_voleur');

  return phases.length > 0 ? phases : ['nuit_loups'];
}

function getNextNightPhase(currentPhase, joueurs) {
  const phases = computeNightPhases(joueurs);
  const currentIndex = ALL_NIGHT_PHASES.indexOf(currentPhase);
  if (currentIndex === -1) return 'matin';
  for (let i = currentIndex + 1; i < ALL_NIGHT_PHASES.length; i++) {
    if (phases.includes(ALL_NIGHT_PHASES[i])) return ALL_NIGHT_PHASES[i];
  }
  return 'matin';
}

const PHASE_LABELS = {
  nuit_cupidon:   '💖 Cupidon',
  nuit_voleur:    '🃏 Voleur',
  nuit_salvateur: '🛡️ Salvateur',
  nuit_voyante:   '👁️ Voyante',
  nuit_loups:     '🐺 Loups',
  nuit_sorciere:  '🧙‍♀️ Sorcière',
};

const ALL_NIGHT_PHASES = [
  'nuit_cupidon', 'nuit_salvateur', 'nuit_voyante',
  'nuit_loups', 'nuit_sorciere', 'nuit_voleur',
];

// ─── Composant principal ─────────────────────────────────────────────────────

export default function MjDashboard() {
  const { roomId } = useParams();

  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs]     = useState([]);
  const [accusesMJ, setAccusesMJ] = useState([]);

  // ── État de configuration (avant ouverture du salon) ──────────────────────
  const [selectedRoles, setSelectedRoles]     = useState([]);
  const [comedienRoles, setComedienRoles]     = useState([]);
  const [distributionMode, setDistributionMode] = useState('aleatoire');
  const [nbJoueurs, setNbJoueurs]             = useState(6);
  const [isGenerating, setIsGenerating]       = useState(false);

  // ── Abonnements Firestore ─────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), snap => {
      setSalonData(snap.exists() ? snap.data() : null);
    });
    const unsubJoueurs = onSnapshot(
      collection(db, 'salons', roomId, 'joueurs'),
      snap => {
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        setJoueurs(list);
      },
    );
    return () => { unsubSalon(); unsubJoueurs(); };
  }, [roomId]);

  // ── Vérification des conditions de victoire ───────────────────────────────
  useEffect(() => {
    if (!salonData || !joueurs.length) return;
    const isPlaying = salonData.statut !== 'en_attente' && salonData.statut !== 'fin_village' && salonData.statut !== 'fin_loups';
    if (!isPlaying) return;

    const alivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
    if (alivePlayers.length === 0) return; // Tout le monde est mort

    const totalLoups = alivePlayers.filter(j => j.role?.toLowerCase().includes('loup') || j.est_infecte === true).length;
    const totalVillageois = alivePlayers.length - totalLoups;

    if (totalLoups === 0) {
      updateDoc(doc(db, 'salons', roomId), { statut: 'fin_village' }).catch(console.error);
    } else if (totalLoups >= totalVillageois) {
      updateDoc(doc(db, 'salons', roomId), { statut: 'fin_loups' }).catch(console.error);
    }
  }, [joueurs, salonData?.statut, roomId]);

  // ── Gestion du thème Jour / Nuit ──────────────────────────────────────────
  useEffect(() => {
    if (!salonData) return;
    const dayPhases = ['matin', 'jour_vote', 'jour_resolution'];
    if (ALL_NIGHT_PHASES.includes(salonData.statut)) {
      document.body.classList.add('theme-nuit');
      document.body.classList.remove('theme-jour');
    } else if (dayPhases.includes(salonData.statut)) {
      document.body.classList.add('theme-jour');
      document.body.classList.remove('theme-nuit');
    } else {
      document.body.classList.remove('theme-nuit', 'theme-jour');
    }
  }, [salonData?.statut]);

  // ─── Handlers de configuration ────────────────────────────────────────────

  const addRole = roleId => setSelectedRoles(prev => [...prev, roleId]);
  const removeRole = roleId => setSelectedRoles(prev => {
    const idx = prev.lastIndexOf(roleId);
    if (idx !== -1) { const n = [...prev]; n.splice(idx, 1); return n; }
    return prev;
  });
  const addComedienRole = roleId => {
    if (comedienRoles.length < 3) setComedienRoles(prev => [...prev, roleId]);
  };
  const removeComedienRole = roleId => setComedienRoles(prev => {
    const idx = prev.lastIndexOf(roleId);
    if (idx !== -1) { const n = [...prev]; n.splice(idx, 1); return n; }
    return prev;
  });
  const hasComedien = selectedRoles.includes('comedien');

  // ── Ouverture du salon ────────────────────────────────────────────────────
  const handleOpenSalon = async () => {
    if (selectedRoles.length < 3)
      return alert('Veuillez sélectionner au moins 3 rôles.');
    if (hasComedien && comedienRoles.length !== 3)
      return alert('Le Comédien nécessite 3 rôles supplémentaires.');

    setIsGenerating(true);
    try {
      const shuffled = shuffleArray([...selectedRoles]);
      await setDoc(doc(db, 'salons', roomId), {
        code: roomId,
        statut: 'en_attente',
        distribution_mode: distributionMode,
        roles_selectionnes: selectedRoles,
        roles_dispo_comedien: comedienRoles,
        roles_dispo_comedien_init: comedienRoles,
        roles_melanges: shuffled,
        couple: [],
        // ── Champs nuit ──
        victime_loups: null,
        victime_loups_visible_sorciere: null,   // Masque L'Ancien / infection à la Sorcière
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,          // Restriction Salvateur : persiste entre les nuits
        illusion_active: false,
        infection_active: false,
        // ── Champs jour ──
        la_liste_accuses: [],
        votes: {},                               // Vote simultané : { [pseudo]: cible }
        // ── Divers ──
        notifications_mj: [],
        notif_mj: null,
        morts_nuit: null,
        condamne_jour: null,
      });
    } catch (err) {
      console.error(err);
      alert('Erreur de création du salon.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Attribution manuelle d'un rôle ───────────────────────────────────────
  const assignRoleManually = async (joueurId, roleId) => {
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueurId), {
        role: roleId,
        carte_choisie: 999,
        vies: 2,
        infection_dispo: roleId === 'infect-pere-des-loups',
        infection_repondu: false,
      });
    } catch (e) { console.error(e); }
  };

  // ── Ajout dynamique d'un joueur ───────────────────────────────────────────
  const handleAddPlayer = async () => {
    try {
      const newRoles = [...salonData.roles_selectionnes, 'villageois'];
      const shuffled = shuffleArray([...newRoles]);
      await updateDoc(doc(db, 'salons', roomId), {
        roles_selectionnes: newRoles,
        roles_melanges: shuffled,
      });
    } catch (e) {
      console.error(e);
      alert("Erreur lors de l'ajout d'un joueur");
    }
  };

  // ── Lancement de la partie ────────────────────────────────────────────────
  const handleStartGame = async () => {
    if (salonData.distribution_mode === 'manuelle') {
      const allAssigned = joueurs.every(j => j.role && j.role !== '');
      if (!allAssigned)
        return alert('Tous les joueurs doivent avoir un rôle assigné en mode manuel.');
    } else {
      const cartesChoisies = joueurs.filter(j => j.carte_choisie !== null);
      if (cartesChoisies.length !== salonData.roles_selectionnes.length) {
        if (!window.confirm(
          `Seulement ${cartesChoisies.length} joueurs ont choisi une carte sur ` +
          `${salonData.roles_selectionnes.length}. Lancer quand même ?`
        )) return;
      }
    }

    const phases = computeNightPhases(joueurs);
    const firstPhase = phases[0] || 'nuit_loups';
    try {
      await updateDoc(doc(db, 'salons', roomId), { statut: firstPhase });
    } catch (e) {
      console.error(e);
      alert('Erreur lors du lancement');
    }
  };

  /**
   * Avance à la prochaine phase de nuit valide, ou vers 'matin'.
   *
   * CRITIQUE : lors du passage depuis 'nuit_loups', on calcule ici
   * `victime_loups_visible_sorciere` pour la Sorcière.
   *   - null  → si cible = L'Ancien (1ère vie), si infection active, ou si protégée par Salvateur
   *   - nom   → sinon (victime normale, la Sorcière peut intervenir)
   */
  const handleNextPhase = async () => {
    const next = getNextNightPhase(salonData.statut, joueurs);
    const updates = { statut: next };

    if (salonData.statut === 'nuit_loups' && salonData.victime_loups) {
      const victimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
      const isProtected      = victimDoc?.nom === salonData.joueur_protege;
      const isAncienFirstLife = victimDoc?.role === 'ancien' && (victimDoc?.vies ?? 2) > 1;
      const isInfection       = !!salonData.infection_active;

      // La Sorcière ne doit pas voir la victime dans ces trois cas
      updates.victime_loups_visible_sorciere =
        (isProtected || isAncienFirstLife || isInfection) ? null : salonData.victime_loups;
    }

    try {
      await updateDoc(doc(db, 'salons', roomId), updates);
    } catch (e) { console.error(e); }
  };

  /**
   * Résolution du matin : application des morts (loups + Sorcière), infection,
   * immunité du Salvateur, résistance de l'Ancien.
   */
  const handleApplyNightDeaths = async () => {
    try {
      await runTransaction(db, async transaction => {
        let diedFromLoups    = false;
        let diedFromSorciere = false;
        let notifMj          = null;
        const newNotifications = [];

        // ── 1. Traitement de la victime des loups ─────────────────────────
        if (salonData.victime_loups && !salonData.victime_sauvee) {
          const loupVictimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
          if (loupVictimDoc) {
            const isProtected       = loupVictimDoc.nom === salonData.joueur_protege;
            const isAncienFirstLife = loupVictimDoc.role === 'ancien' && (loupVictimDoc.vies ?? 2) > 1;

            if (isProtected) {
              // ── Immunité du Salvateur ──────────────────────────────────
              if (salonData.infection_active) {
                const infectPere = joueurs.find(j => j.role === 'infect-pere-des-loups');
                if (infectPere) {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', infectPere.id),
                    { infection_dispo: true },
                  );
                }
                newNotifications.push(
                  "🛡️ L'Infection a échoué car la cible était protégée par le Salvateur (Pouvoir conservé).",
                );
              }

            } else if (isAncienFirstLife) {
              // ── L'Ancien absorbe la première attaque ───────────────────
              // La Sorcière n'a RIEN vu (victime_loups_visible_sorciere = null).
              transaction.update(
                doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                { vies: 1 },
              );
              if (salonData.infection_active) {
                // L'Ancien immunise aussi contre l'infection — pouvoir conservé
                const infectPere = joueurs.find(j => j.role === 'infect-pere-des-loups');
                if (infectPere) {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', infectPere.id),
                    { infection_dispo: true },
                  );
                }
                newNotifications.push(
                  "🛡️ L'Ancien a résisté à l'infection grâce à sa première vie (Pouvoir conservé).",
                );
              } else {
                notifMj = `🛡️ L'Ancien (${loupVictimDoc.nom}) a été attaqué mais a survécu (vies restantes : 1).`;
              }

            } else {
              // ── Mort normale ou infection ──────────────────────────────
              if (salonData.infection_active) {
                if (loupVictimDoc.role === 'chevalier') {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                    { statut_joueur: 'mort' },
                  );
                  diedFromLoups = true;
                  newNotifications.push("🛡️ L'Infection a échoué sur le Chevalier ! Il meurt de l'attaque.");
                  transaction.update(doc(db, 'salons', roomId), { 
                    venin_chevalier_actif: true, 
                    index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id)
                  });
                } else {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                    { est_infecte: true },
                  );
                  newNotifications.push(
                    `🧪 ${loupVictimDoc.nom} a été infecté et rejoint le camp des loups !`,
                  );
                }
              } else {
                transaction.update(
                  doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                  { statut_joueur: 'mort' },
                );
                diedFromLoups = true;
                if (loupVictimDoc.role === 'chevalier') {
                  transaction.update(doc(db, 'salons', roomId), { 
                    venin_chevalier_actif: true, 
                    index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id)
                  });
                }
              }
            }
          }
        } else if (salonData.victime_loups && salonData.victime_sauvee && salonData.infection_active) {
          // La Sorcière a sauvé la victime alors que l'infection était active → pouvoir conservé
          const infectPere = joueurs.find(j => j.role === 'infect-pere-des-loups');
          if (infectPere) {
            transaction.update(
              doc(db, 'salons', roomId, 'joueurs', infectPere.id),
              { infection_dispo: true },
            );
          }
          newNotifications.push(
            "🛡️ L'Infection a échoué car la cible a été sauvée (Pouvoir conservé).",
          );
        }

        // ── 2. Victime de la Sorcière ─────────────────────────────────────
        if (salonData.victime_sorciere) {
          const sorcVictimDoc = joueurs.find(j => j.nom === salonData.victime_sorciere);
          if (sorcVictimDoc) {
            transaction.update(
              doc(db, 'salons', roomId, 'joueurs', sorcVictimDoc.id),
              { statut_joueur: 'mort' },
            );
            diedFromSorciere = true;
          }
        }

        // ── 3. Mise à jour du salon ───────────────────────────────────────
        const salonUpdates = {
          statut: 'jour_vote',
          morts_nuit: {
            loups:    diedFromLoups    ? salonData.victime_loups    : null,
            sorciere: diedFromSorciere ? salonData.victime_sorciere : null,
            venin:    salonData.morts_nuit?.venin || null,
          },
          infection_active: false,
          notif_mj: notifMj,
          votes: {},   // Prêt pour le vote du jour
        };
        if (newNotifications.length > 0) {
          salonUpdates.notifications_mj = arrayUnion(...newNotifications);
        }
        transaction.update(doc(db, 'salons', roomId), salonUpdates);
      });
    } catch (e) {
      console.error(e);
      alert('Erreur résolution nuit');
    }
  };

  /**
   * Résolution du vote du jour.
   * Lit les votes depuis salonData.votes (objet clé-valeur) pour éviter les écrasements.
   */
  const handleApplyDaySentence = async () => {
    const votesRaw   = salonData.votes || {};
    const votesCount = {};

    // N'agréger que les votes des joueurs encore en vie
    Object.entries(votesRaw).forEach(([votant, cible]) => {
      const votantPlayer = joueurs.find(j => j.nom === votant);
      if (votantPlayer && votantPlayer.statut_joueur !== 'mort') {
        votesCount[cible] = (votesCount[cible] || 0) + 1;
      }
    });

    if (Object.keys(votesCount).length === 0) {
      alert("Aucun vote n'a été enregistré. Le village a décidé de ne tuer personne.");
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution', condamne_jour: 'Personne (Vote ignoré)',
        });
      } catch (e) { console.error(e); }
      return;
    }

    let maxVotes    = 0;
    let condamneNom = null;
    let tie         = false;

    for (const [nom, count] of Object.entries(votesCount)) {
      if (count > maxVotes) {
        maxVotes = count; condamneNom = nom; tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (tie) {
      const bouc = joueurs.find(j => j.role === 'bouc-emissaire' && j.statut_joueur !== 'mort');
      if (bouc) {
        alert('⚖️ Égalité des votes ! Le Bouc Émissaire est éliminé par le village !');
        condamneNom = bouc.nom;
      } else {
        alert("⚖️ Égalité ! Aucun Bouc Émissaire en vie, le village n'a pas pu trancher.");
        try {
          await updateDoc(doc(db, 'salons', roomId), {
            statut: 'jour_resolution', condamne_jour: 'Personne (Égalité)',
          });
        } catch (e) { console.error(e); }
        return;
      }
    } else if (!condamneNom) {
      alert('Aucun condamné. Personne ne meurt.');
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution', condamne_jour: 'Personne',
        });
      } catch (e) { console.error(e); }
      return;
    }

    const condamne = joueurs.find(j => j.nom === condamneNom);
    if (!condamne) return;

    if (condamne.role === 'illusionniste' && salonData.illusion_active) {
      alert("🔮 C'était une illusion ! L'Illusionniste survit !");
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          illusion_active: false,
          statut: 'jour_resolution',
          condamne_jour: condamneNom + ' (Sauvé par Illusion)',
        });
      } catch (e) { console.error(e); }
    } else {
      if (window.confirm(`Voulez-vous vraiment condamner ${condamneNom} (${maxVotes} vote(s)) ?`)) {
        try {
          await updateDoc(
            doc(db, 'salons', roomId, 'joueurs', condamne.id),
            { statut_joueur: 'mort' },
          );
          await updateDoc(doc(db, 'salons', roomId), {
            statut: 'jour_resolution', condamne_jour: condamneNom,
          });
        } catch (e) { console.error(e); }
      }
    }
  };

  /**
   * Lancement de la nuit suivante.
   * IMPORTANT : `derniere_cible_salvateur` n'est PAS réinitialisé ici —
   * il doit persister pour bloquer la même cible la nuit prochaine.
   */
  const handleNextNight = async () => {
    try {
      const batch = writeBatch(db);
      const phases     = computeNightPhases(joueurs);
      const firstPhase = phases[0] || 'nuit_loups';

      let veninVictim = null;
      let veninNotif = null;

      if (salonData.venin_chevalier_actif && salonData.index_chevalier !== null && salonData.index_chevalier !== undefined) {
        const idx = salonData.index_chevalier;
        for (let i = 1; i <= joueurs.length; i++) {
          const checkIdx = (idx + i) % joueurs.length;
          const p = joueurs[checkIdx];
          if (p.statut_joueur !== 'mort' && (p.role?.toLowerCase().includes('loup') || p.est_infecte === true)) {
            veninVictim = p;
            break;
          }
        }
        if (veninVictim) {
          batch.update(doc(db, 'salons', roomId, 'joueurs', veninVictim.id), { statut_joueur: 'mort' });
          veninNotif = `🗡️ Le venin du Chevalier a frappé : ${veninVictim.nom} meurt.`;
        }
      }

      batch.update(doc(db, 'salons', roomId), {
        statut: firstPhase,
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        // ⚠️ derniere_cible_salvateur intentionnellement conservé entre les nuits
        illusion_active: false,
        infection_active: false,
        condamne_jour: null,
        morts_nuit: veninVictim ? { venin: veninVictim.nom } : null,
        la_liste_accuses: [],
        votes: {},                    // Reset des votes pour le prochain jour
        notif_mj: null,
        notifications_mj: veninNotif ? [veninNotif] : [],
        venin_chevalier_actif: false,
      });

      // Réinitialiser les indicateurs de tour de chaque joueur
      joueurs.forEach(j => {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          a_vote: false,
          a_vote_sorciere: false,
          vote_jour: null,          // Nettoyage legacy
          infection_repondu: false,
        });
      });

      await batch.commit();
    } catch (e) { console.error(e); }
  };

  // ── Réinitialisation complète de la partie ────────────────────────────────
  const handleResetGame = async () => {
    if (!window.confirm(
      'Voulez-vous réinitialiser et redistribuer les cartes pour les joueurs connectés ?'
    )) return;
    try {
      const shuffled = shuffleArray([...salonData.roles_selectionnes]);
      const batch    = writeBatch(db);

      batch.update(doc(db, 'salons', roomId), {
        statut: 'SETUP',
        roles_melanges: shuffled,
        roles_dispo_comedien: salonData.roles_dispo_comedien_init || [],
        couple: [],
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,    // Reset complet uniquement ici
        illusion_active: false,
        infection_active: false,
        la_liste_accuses: [],
        votes: {},
        notifications_mj: [],
        notif_mj: null,
        morts_nuit: null,
        condamne_jour: null,
        venin_chevalier_actif: false,
        index_chevalier: null,
      });

      joueurs.forEach(j => {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          carte_choisie: null,
          role: '',
          statut_joueur: 'en_vie',
          pouvoir_utilise: false,
          a_vote: false,
          a_vote_sorciere: false,
          vote_jour: null,
          illusion_dispo: true,
          dernier_protege: null,
          vies: 2,
          infection_dispo: false,
          infection_repondu: false,
          est_infecte: false,
          tir_chasseur_fait: false,
        });
      });

      await batch.commit();
    } catch (e) { console.error(e); }
  };

  const getPlayerUrl = () => `${window.location.origin}/player/${roomId}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER : Écran de configuration (avant création du salon ou après reset)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!salonData || salonData.statut === 'SETUP') {
    const surplus = selectedRoles.length - nbJoueurs;

    return (
      <div className="dashboard-container">
        <ThemeToggle />
        <header className="dashboard-header">
          <div className="dashboard-title-box">
            <h1 className="title-font">
              <Eye size={28} style={{ color: 'var(--primary)' }} /> LE CONSEIL DES LOUPS
            </h1>
            <p className="text-font">
              Nouveau salon : <span className="room-id glow-text">{roomId}</span>
            </p>
          </div>
        </header>

        <div className="config-box glass-panel">
          <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={22} style={{ color: 'var(--primary)' }} /> Configuration de la partie
          </h2>

          {/* ── Slider : nombre de joueurs ─────────────────────────────── */}
          <div style={{ marginBottom: '1.5rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
            <h3 className="title-font" style={{ fontSize: '1.1rem', marginBottom: '10px' }}>
              Nombre de joueurs cible :{' '}
              <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{nbJoueurs}</span>
            </h3>
            <input
              type="range"
              min="3"
              max="24"
              value={nbJoueurs}
              onChange={e => setNbJoueurs(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span className="text-font" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>3</span>
              <span className="text-font" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>24</span>
            </div>
            {selectedRoles.length > 0 && surplus !== 0 && (
              <p className="text-font" style={{ marginTop: '8px', fontSize: '0.85rem', color: surplus < 0 ? '#f59e0b' : '#10b981' }}>
                {surplus < 0
                  ? `⚠️ Il manque ${-surplus} rôle(s) pour atteindre votre objectif.`
                  : `✅ Vous avez ${surplus} rôle(s) en surplus — parfait pour des variantes.`}
              </p>
            )}
          </div>

          {/* ── Mode de distribution ───────────────────────────────────── */}
          <div style={{ marginBottom: '1.5rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px' }}>
            <h3 className="title-font" style={{ fontSize: '1.1rem', marginBottom: '10px' }}>
              Mode de distribution
            </h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setDistributionMode('aleatoire')}
                className={`btn-secondary text-font ${distributionMode === 'aleatoire' ? 'glow-button' : ''}`}
                style={{ flex: 1, borderColor: distributionMode === 'aleatoire' ? 'var(--primary)' : '' }}
              >
                🎲 Aléatoire
              </button>
              <button
                onClick={() => setDistributionMode('manuelle')}
                className={`btn-secondary text-font ${distributionMode === 'manuelle' ? 'glow-button' : ''}`}
                style={{ flex: 1, borderColor: distributionMode === 'manuelle' ? 'var(--primary)' : '' }}
              >
                ✍️ Manuelle
              </button>
            </div>
          </div>

          {/* ── Sélection des rôles ────────────────────────────────────── */}
          <div style={{ marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ fontSize: '1.2rem' }}>Sélection des rôles</h3>
              <div
                className="role-counter text-font text-success"
                style={{ fontWeight: 'bold', padding: '0.3rem 0.8rem', background: 'var(--input-bg)', borderRadius: '1rem' }}
              >
                {selectedRoles.length} sélectionné(s)
              </div>
            </div>
            <div className="roles-grid">
              {rolesData.map(role => {
                const count = selectedRoles.filter(id => id === role.id).length;
                return (
                  <div key={role.id} className="role-selector-item glass-panel">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      <div className="role-color-dot" style={{ backgroundColor: role.color }} />
                      <span className="text-font" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-color)' }}>
                        {role.name}
                      </span>
                    </div>
                    <div className="role-counter-controls">
                      <button onClick={() => removeRole(role.id)} disabled={count === 0} className="role-btn">-</button>
                      <span className="role-count text-font" style={{ color: 'var(--text-color)' }}>{count}</span>
                      <button onClick={() => addRole(role.id)} className="role-btn">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Rôles du Comédien ──────────────────────────────────────── */}
          {hasComedien && (
            <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(251,191,36,0.1)', border: '1px solid #fbbf24', borderRadius: '12px' }}>
              <h3 className="title-font" style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>
                🎭 Rôles du Comédien ({comedienRoles.length}/3)
              </h3>
              <div className="roles-grid">
                {rolesData.filter(r => r.id !== 'comedien').map(role => {
                  const count = comedienRoles.filter(id => id === role.id).length;
                  return (
                    <div key={role.id} className="role-selector-item glass-panel">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                        <div className="role-color-dot" style={{ backgroundColor: role.color }} />
                        <span className="text-font" style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-color)' }}>
                          {role.name}
                        </span>
                      </div>
                      <div className="role-counter-controls">
                        <button onClick={() => removeComedienRole(role.id)} disabled={count === 0} className="role-btn">-</button>
                        <span className="role-count text-font" style={{ color: 'var(--text-color)' }}>{count}</span>
                        <button
                          onClick={() => addComedienRole(role.id)}
                          disabled={comedienRoles.length >= 3 && count === 0}
                          className="role-btn"
                        >+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleOpenSalon}
            disabled={isGenerating || selectedRoles.length < 3}
            className="btn-primary title-font glow-button"
            style={{ display: 'flex', justifyContent: 'center', gap: '10px', width: '100%' }}
          >
            {isGenerating ? <RefreshCw className="spinner" size={20} /> : <Users size={20} />}
            Ouvrir le salon
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER : Tableau de bord MJ (partie en cours ou en attente)
  // ═══════════════════════════════════════════════════════════════════════════

  const isPhase       = p => salonData.statut === p;
  const isNightPhase  = ALL_NIGHT_PHASES.includes(salonData.statut);
  const isGameRunning = salonData.statut !== 'en_attente';
  const displayFormat = isGameRunning
    ? '1fr'
    : (joueurs.length >= salonData.roles_selectionnes.length ? '1fr' : '1fr 1fr');

  const nightPhaseSequence = computeNightPhases(joueurs);
  const infectPere         = joueurs.find(j => j.role === 'infect-pere-des-loups' && j.statut_joueur !== 'mort');
  const chasseurActif      = joueurs.find(j => j.role === 'chasseur' && j.statut_joueur === 'mort' && j.tir_chasseur_fait === false);

  // Agrégation des votes depuis salonData.votes (objet clé-valeur — vote simultané)
  const votesCountJour = Object.entries(salonData.votes || {}).reduce((acc, [votant, cible]) => {
    const votantPlayer = joueurs.find(j => j.nom === votant);
    if (votantPlayer && votantPlayer.statut_joueur !== 'mort') {
      acc[cible] = (acc[cible] || 0) + 1;
    }
    return acc;
  }, {});

  const alivePlayers   = joueurs.filter(j => j.statut_joueur !== 'mort');
  const nbVotesDeposes = Object.keys(salonData.votes || {}).filter(nom => {
    const p = joueurs.find(j => j.nom === nom);
    return p && p.statut_joueur !== 'mort';
  }).length;

  return (
    <div className="dashboard-container">
      <ThemeToggle />

      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <header className="dashboard-header">
        <div className="dashboard-title-box">
          <h1 className="title-font">
            <Eye size={28} style={{ color: 'var(--primary)' }} /> LE CONSEIL DES LOUPS
          </h1>
          <p className="text-font">
            Code du salon : <span className="room-id glow-text">{roomId}</span> |{' '}
            Phase : <strong style={{ color: 'var(--primary)' }}>
              {salonData.statut.replace(/_/g, ' ').toUpperCase()}
            </strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
          <button
            onClick={handleResetGame}
            className="btn-secondary text-font border-accent"
            style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
          >
            <RefreshCw size={18} /> Réinitialiser
          </button>
        </div>
      </header>

      {/* ── BANDEAU SÉQUENCE DE LA NUIT ──────────────────────────────────── */}
      {isNightPhase && (
        <div
          className="glass-panel"
          style={{ marginTop: '1.5rem', padding: '1rem 1.5rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-font" style={{ margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Séquence active de cette nuit
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {nightPhaseSequence.map(phase => {
              const isCurrent = phase === salonData.statut;
              return (
                <span key={phase} className="text-font" style={{
                  padding: '5px 12px', borderRadius: '20px', fontSize: '0.8rem',
                  background: isCurrent ? 'var(--primary)' : 'rgba(255,255,255,0.07)',
                  color: isCurrent ? '#000' : 'var(--text-muted)',
                  fontWeight: isCurrent ? '700' : '400',
                  border: isCurrent ? 'none' : '1px solid rgba(255,255,255,0.1)',
                }}>
                  {PHASE_LABELS[phase] || phase}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── JOURNAL DES ACTIONS (TEMPS RÉEL) ─────────────────────────────── */}
      {Array.isArray(salonData.notifications_mj) && salonData.notifications_mj.length > 0 && (
        <div
          className="glass-panel"
          style={{ marginTop: '1rem', padding: '1rem 1.5rem', border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.04)' }}
        >
          <h3 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', marginBottom: '0.75rem', fontSize: '1rem' }}>
            <Bell size={16} /> Journal MJ — Actions de cette nuit
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {salonData.notifications_mj.map((notif, i) => (
              <li key={i} className="text-font" style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-color)', borderLeft: '3px solid #fbbf24' }}>
                {notif}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── PANNEAU DE CONTRÔLE DES PHASES ───────────────────────────────── */}
      <div
        className="glass-panel"
        style={{ marginTop: '1.5rem', border: '2px solid var(--primary)', background: 'var(--bg-color)', borderRadius: '1.5rem', padding: '2rem' }}
      >
        <h2 className="title-font" style={{ marginBottom: '1rem', color: 'var(--primary)' }}>
          🕹️ CONTRÔLE DE LA PARTIE
        </h2>

        {/* EN ATTENTE */}
        {isPhase('en_attente') && (
          <div>
            <p className="text-font text-muted" style={{ marginBottom: '1rem' }}>
              Les joueurs rejoignent le salon. Une fois tout le monde prêt et les rôles distribués, lancez la partie.
            </p>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <button
                onClick={handleAddPlayer}
                className="btn-secondary text-font border-accent"
                style={{ flex: 1, padding: '15px', fontSize: '1rem', display: 'flex', justifyContent: 'center', gap: '10px' }}
              >
                <Users size={20} /> Ajouter un joueur
              </button>
            </div>
            <button
              onClick={handleStartGame}
              className="btn-primary title-font glow-button"
              style={{ width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '10px' }}
            >
              <Play size={20} /> LANCER LA PARTIE
            </button>
          </div>
        )}

        {/* NUIT CUPIDON */}
        {isPhase('nuit_cupidon') && (
          <div>
            <p className="text-font" style={{ color: '#ec4899', fontSize: '1.1rem' }}>
              💖 C'est la nuit de Cupidon. Il doit désigner deux amoureux.
            </p>
            <p className="text-font text-muted" style={{ marginBottom: '1.5rem' }}>
              Amoureux actuels : {salonData.couple?.length === 2 ? 'Désignés ✅' : 'En attente...'}
            </p>
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#ec4899', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT VOLEUR */}
        {isPhase('nuit_voleur') && (() => {
          const voleur = joueurs.find(j => j.role === 'voleur' && j.statut_joueur !== 'mort');
          return (
            <div>
              <p className="text-font text-muted" style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>
                🃏 Le Voleur peut activer son pouvoir ce soir ou le conserver pour une nuit ultérieure.
              </p>
              {voleur && (
                <p className="text-font" style={{ margin: '0 0 1.5rem', fontWeight: 'bold', color: voleur.a_vote ? '#10b981' : '#f59e0b' }}>
                  {voleur.a_vote ? `✅ ${voleur.nom} a terminé son tour` : `⏳ ${voleur.nom} réfléchit...`}
                </p>
              )}
              <button
                onClick={handleNextPhase}
                className="btn-primary title-font glow-button"
                style={{ width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
              >
                Séquence Suivante <ChevronRight size={20} />
              </button>
            </div>
          );
        })()}

        {/* NUIT SALVATEUR */}
        {isPhase('nuit_salvateur') && (
          <div>
            <p className="text-font" style={{ color: '#3b82f6', fontSize: '1.1rem' }}>
              🛡️ Le Salvateur choisit un joueur à protéger des loups.
            </p>
            <p className="text-font text-muted" style={{ marginBottom: '0.5rem' }}>
              Joueur protégé ce tour : <strong>{salonData.joueur_protege || 'Aucun'}</strong>
            </p>
            {salonData.derniere_cible_salvateur && (
              <p className="text-font" style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.3)' }}>
                ⚠️ Cible bloquée cette nuit : <strong>{salonData.derniere_cible_salvateur}</strong>
              </p>
            )}
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#3b82f6', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT VOYANTE */}
        {isPhase('nuit_voyante') && (
          <div>
            <p className="text-font" style={{ color: '#8b5cf6', fontSize: '1.1rem', marginBottom: '1.5rem' }}>
              👁️ La Voyante observe la carte d'un joueur de son choix.
            </p>
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#8b5cf6', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT LOUPS */}
        {isPhase('nuit_loups') && (
          <div>
            <p className="text-font" style={{ color: '#ef4444', fontSize: '1.1rem' }}>
              🐺 Les loups choisissent leur victime.
            </p>

            {infectPere && (
              <div style={{ margin: '1rem 0', padding: '10px 14px', background: 'rgba(127,29,29,0.35)', border: '1px solid #991b1b', borderRadius: '8px' }}>
                <p className="text-font" style={{ margin: 0, fontSize: '0.9rem', color: '#fca5a5' }}>
                  🧪 <strong>{infectPere.nom}</strong> (Infect Père) :{' '}
                  {infectPere.infection_repondu
                    ? (salonData.infection_active ? "💉 A choisi d'INFECTER la victime" : '🐺 A laissé la victime mourir')
                    : infectPere.infection_dispo
                      ? "⏳ N'a pas encore répondu à l'infection"
                      : "Pouvoir d'infection épuisé"}
                </p>
              </div>
            )}

            <div style={{ background: 'rgba(239,68,68,0.1)', padding: '1rem', borderRadius: '8px', margin: '1rem 0' }}>
              <p className="text-font">Cible temporaire : <strong style={{ color: 'var(--text-color)' }}>{salonData.vote_loup_temporaire || '—'}</strong></p>
              <p className="text-font">Choix final : <strong style={{ color: 'var(--text-color)' }}>{salonData.victime_loups || 'En attente...'}</strong></p>
              {salonData.infection_active && (
                <p className="text-font" style={{ color: '#a78bfa', marginTop: '6px', fontWeight: 'bold' }}>
                  🧪 L'Infect va infecter la victime cette nuit !
                </p>
              )}
            </div>

            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#ef4444', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT SORCIÈRE */}
        {isPhase('nuit_sorciere') && (() => {
          const sorciere = joueurs.find(j => j.role === 'sorciere' && j.statut_joueur !== 'mort');
          return (
            <div>
              <p className="text-font" style={{ color: '#c4b5fd', fontSize: '1.1rem' }}>
                🧙‍♀️ La sorcière utilise ses potions.
              </p>
              {!sorciere ? (
                <p className="text-font text-muted" style={{ fontStyle: 'italic', margin: '1rem 0' }}>
                  Pas de sorcière en vie.
                </p>
              ) : (
                <p className="text-font" style={{ margin: '1rem 0', fontWeight: 'bold', color: sorciere.a_vote_sorciere ? '#10b981' : '#f59e0b' }}>
                  {sorciere.a_vote_sorciere ? '✅ A terminé son tour' : '⏳ En train de réfléchir...'}
                </p>
              )}
              <button
                onClick={handleNextPhase}
                className="btn-primary title-font glow-button"
                style={{ background: '#c4b5fd', color: '#000', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
              >
                Séquence Suivante <ChevronRight size={20} />
              </button>
            </div>
          );
        })()}

        {/* MATIN */}
        {isPhase('matin') && (
          <div>
            <p className="text-font text-warning" style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
              ☀️ Le village se réveille. Appliquez les sentences de la nuit.
            </p>

            {salonData.notif_mj && (
              <div style={{ marginBottom: '1rem', padding: '12px 16px', background: 'rgba(100,116,139,0.2)', border: '2px solid #64748b', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2rem' }}>🛡️</span>
                <p className="text-font" style={{ margin: 0, color: '#94a3b8', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  {salonData.notif_mj}
                </p>
              </div>
            )}

            <ul className="text-font" style={{ background: 'var(--input-bg)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', color: 'var(--text-color)', lineHeight: 2 }}>
              <li>🐺 Cible des loups : <strong>{salonData.victime_loups || 'Personne'}</strong></li>
              <li>🛡️ Salvateur a protégé : <strong>{salonData.joueur_protege || 'Personne'}</strong></li>
              <li>🧪 Sorcière a sauvé : <strong>{salonData.victime_sauvee ? 'OUI' : 'NON'}</strong></li>
              <li>💀 Sorcière a tué : <strong>{salonData.victime_sorciere || 'Personne'}</strong></li>
              {salonData.infection_active && (
                <li style={{ color: '#a78bfa', fontWeight: 'bold' }}>
                  🧪 L'Infect Père des Loups a infecté la victime — elle rejoint la meute !
                </li>
              )}
            </ul>

            <button
              onClick={handleApplyNightDeaths}
              className="btn-primary title-font glow-button"
              style={{ background: '#f59e0b', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem' }}
            >
              Appliquer les morts et passer au Vote ➔
            </button>
          </div>
        )}

        {/* JOUR VOTE */}
        {isPhase('jour_vote') && (
          <div>
            {/* Verdict de la nuit */}
            {(() => {
              const morts = [];
              if (salonData.morts_nuit?.loups)    morts.push(salonData.morts_nuit.loups);
              if (salonData.morts_nuit?.sorciere) morts.push(salonData.morts_nuit.sorciere);
              if (salonData.morts_nuit?.venin)    morts.push(salonData.morts_nuit.venin);
              const uniqueMorts = [...new Set(morts)];

              return uniqueMorts.length > 0 ? (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid #ef4444', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', textAlign: 'center', boxShadow: '0 0 20px rgba(239,68,68,0.2)' }}>
                  <h3 className="title-font" style={{ color: '#ef4444', fontSize: '1.4rem', margin: 0 }}>
                    💀 VERDICT DE LA NUIT : Les joueurs suivants ont été éliminés : {uniqueMorts.join(', ')}.
                  </h3>
                </div>
              ) : (
                <div style={{ background: 'rgba(16,185,129,0.15)', border: '2px solid #10b981', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', textAlign: 'center', boxShadow: '0 0 20px rgba(16,185,129,0.2)' }}>
                  <h3 className="title-font" style={{ color: '#10b981', fontSize: '1.4rem', margin: 0 }}>
                    ✨ VERDICT DE LA NUIT : Pas de mort ce matin !
                  </h3>
                </div>
              );
            })()}

            <p className="text-font" style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
              ☀️ Le village débat et vote pour éliminer un suspect.
            </p>

            {salonData.illusion_active && (
              <div style={{ background: '#8b5cf6', color: 'white', padding: '10px', borderRadius: '8px', marginBottom: '1rem', fontWeight: 'bold' }}>
                ✨ L'Illusionniste a activé son pouvoir !
              </div>
            )}

            {!(salonData.la_liste_accuses?.length > 0) ? (
              <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                <h4 className="title-font" style={{ marginBottom: '10px', color: 'var(--text-color)' }}>
                  Désigner les accusés :
                </h4>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem' }}>
                  {alivePlayers.map(j => {
                    const isSel = accusesMJ.includes(j.nom);
                    return (
                      <li
                        key={j.id}
                        onClick={() => setAccusesMJ(prev => isSel ? prev.filter(n => n !== j.nom) : [...prev, j.nom])}
                        style={{ padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', background: isSel ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: isSel ? '#000' : 'var(--text-color)', border: isSel ? '1px solid var(--primary)' : '1px solid transparent', fontWeight: isSel ? 'bold' : 'normal' }}
                      >
                        {isSel ? '☑' : '☐'} {j.nom}
                      </li>
                    );
                  })}
                </ul>
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <button
                    onClick={() => setAccusesMJ(alivePlayers.map(j => j.nom))}
                    className="btn-secondary text-font"
                    style={{ width: '100%', padding: '10px', fontSize: '0.95rem' }}
                  >
                    📢 Accuser tout le village
                  </button>
                  <button
                    disabled={accusesMJ.length === 0}
                    onClick={async () => {
                      try {
                        await updateDoc(doc(db, 'salons', roomId), { la_liste_accuses: accusesMJ });
                        setAccusesMJ([]);
                      } catch (e) { console.error(e); }
                    }}
                    className="btn-primary title-font glow-button"
                    style={{ width: '100%', padding: '15px', fontSize: '1.1rem' }}
                  >
                    🔓 Ouvrir le vote pour les accusés
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 className="title-font" style={{ color: 'var(--text-color)', margin: 0 }}>Urne en temps réel :</h4>
                    <span
                      className="text-font"
                      style={{ fontSize: '0.85rem', color: nbVotesDeposes === alivePlayers.length ? '#10b981' : 'var(--text-muted)', background: 'rgba(255,255,255,0.1)', padding: '3px 10px', borderRadius: '1rem', fontWeight: 'bold' }}
                    >
                      {nbVotesDeposes}/{alivePlayers.length} votes
                    </span>
                  </div>
                  {Object.entries(votesCountJour).length === 0 ? (
                    <p className="text-muted text-font">Aucun vote pour l'instant.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }} className="text-font">
                      {Object.entries(votesCountJour).sort((a, b) => b[1] - a[1]).map(([nom, count]) => (
                        <li key={nom} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--card-border)', color: 'var(--text-color)' }}>
                          <span>{nom}</span> <strong>{count} voix</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {chasseurActif ? (
                  <button disabled className="btn-secondary title-font" style={{ width: '100%', padding: '15px', fontSize: '1.2rem' }}>
                    ⏳ En attente du tir de vengeance du Chasseur...
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button
                      onClick={handleApplyDaySentence}
                      className="btn-primary title-font glow-button"
                      style={{ background: '#ef4444', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem' }}
                    >
                      Figer le Vote et Appliquer la Sentence 🔨
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Passer à la nuit sans tuer personne ?")) return;
                        try {
                          await updateDoc(doc(db, 'salons', roomId), {
                            statut: 'jour_resolution', condamne_jour: 'Personne (Vote ignoré par MJ)',
                          });
                        } catch (e) { console.error(e); }
                      }}
                      className="btn-secondary text-font"
                      style={{ width: '100%', padding: '15px', fontSize: '1.1rem', borderColor: '#64748b', color: 'var(--text-color)', justifyContent: 'center' }}
                    >
                      Passer le vote (Nuit Blanche)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* FIN DE PARTIE */}
        {(isPhase('fin_village') || isPhase('fin_loups')) && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <h1 className="title-font glow-text" style={{ fontSize: '2.5rem', margin: '0 0 1rem', color: isPhase('fin_village') ? '#10b981' : '#ef4444' }}>
              {isPhase('fin_village') ? '🎉 VICTOIRE DU VILLAGE !' : '🐺 VICTOIRE DES LOUPS !'}
            </h1>
            <p className="text-font" style={{ fontSize: '1.2rem', marginBottom: '2rem', color: 'var(--text-color)' }}>
              {isPhase('fin_village') ? 'Tous les loups ont été éliminés !' : 'Le village a été dévoré !'}
            </p>
          </div>
        )}

        {/* JOUR RÉSOLUTION */}
        {isPhase('jour_resolution') && (
          <div>
            <h3 className="title-font" style={{ color: 'var(--success)', marginBottom: '1.5rem', fontSize: '1.5rem' }}>
              Sentence appliquée. ({salonData.condamne_jour})
            </h3>
            {chasseurActif ? (
              <button disabled className="btn-secondary title-font" style={{ width: '100%', padding: '15px', fontSize: '1.2rem' }}>
                ⏳ En attente du tir de vengeance du Chasseur...
              </button>
            ) : (
              <button
                onClick={handleNextNight}
                className="btn-primary title-font glow-button"
                style={{ background: '#1d4ed8', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem' }}
              >
                🌙 Lancer la Nuit Suivante ➔
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── GRILLE BASSE : QR Code / Guide + Tableau des joueurs ─────────── */}
      <div
        className="mj-content-grid"
        style={{ display: 'grid', gridTemplateColumns: displayFormat, gap: '2rem', marginTop: '2rem' }}
      >
        {/* QR Code (avant lancement) */}
        {!isGameRunning && joueurs.length < salonData.roles_selectionnes.length && (
          <div className="qr-panel glass-panel">
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)' }}>
              <LinkIcon size={20} /> Rejoindre le salon
            </h2>
            <p className="text-font text-muted" style={{ marginBottom: '1rem' }}>
              Scannez ce code pour rejoindre. {joueurs.length}/{salonData.roles_selectionnes.length} joueurs.
            </p>
            <div className="qr-wrapper" style={{ background: 'white', padding: '15px', borderRadius: '15px', display: 'inline-block' }}>
              <QRCodeSVG value={getPlayerUrl()} size={200} bgColor="#ffffff" fgColor="#000000" level="H" includeMargin={false} />
            </div>
            <div className="qr-url text-font" style={{ marginTop: '1rem', wordBreak: 'break-all' }}>
              {getPlayerUrl()}
            </div>
          </div>
        )}

        {/* Guide MJ (partie en cours) */}
        {isGameRunning && (
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: '2rem' }}>
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)', marginBottom: '1rem' }}>
              <Info size={20} /> Guide pour le MJ
            </h2>
            <p className="text-font text-muted" style={{ lineHeight: 1.7 }}>
              Vous êtes en phase : <strong style={{ color: 'var(--primary)' }}>{salonData.statut}</strong>.<br /><br />
              Demandez à tous les joueurs de regarder leur téléphone. Appelez le rôle concerné et suivez les
              instructions à l'écran. Cliquez sur <em>Séquence Suivante</em> pour avancer.
            </p>
          </div>
        )}

        {/* Tableau des joueurs */}
        <div
          className="players-table-panel glass-panel"
          style={{ gridColumn: (!isGameRunning && joueurs.length < salonData.roles_selectionnes.length) ? 'auto' : '1 / -1' }}
        >
          <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)' }}>
            <Users size={20} /> Joueurs ({joueurs.filter(j => j.statut_joueur !== 'mort').length} en vie / {joueurs.length} total)
          </h2>
          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }} className="text-font">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <th style={{ padding: '10px 5px', color: 'var(--text-muted)' }}>Nom</th>
                  <th style={{ padding: '10px 5px', color: 'var(--text-muted)' }}>Statut</th>
                  <th style={{ padding: '10px 5px', color: 'var(--text-muted)' }}>Rôle</th>
                </tr>
              </thead>
              <tbody>
                {joueurs.map(j => {
                  const roleObj    = j.role ? rolesData.find(r => r.id === j.role) : null;
                  const statutColor = j.statut_joueur === 'mort'
                    ? 'var(--danger)'
                    : j.est_infecte === true
                      ? '#a78bfa'
                      : 'var(--success)';
                  return (
                    <tr key={j.id} style={{ borderBottom: '1px solid var(--card-border)', opacity: j.statut_joueur === 'mort' ? 0.5 : 1 }}>
                      <td style={{ padding: '10px 5px', fontWeight: 'bold', color: 'var(--text-color)' }}>{j.nom}</td>
                      <td style={{ padding: '10px 5px' }}>
                        <select
                          value={j.statut_joueur || 'en_vie'}
                          onChange={e => updateDoc(doc(db, 'salons', roomId, 'joueurs', j.id), { statut_joueur: e.target.value })}
                          style={{ background: 'var(--input-bg)', color: statutColor, border: '1px solid var(--card-border)', borderRadius: '6px', padding: '4px', fontWeight: 'bold' }}
                        >
                          <option value="en_vie">En vie</option>
                          <option value="mort">Mort</option>
                          <option value="infecte">Infecté</option>
                          <option value="En couple">En couple</option>
                        </select>
                      </td>
                      <td style={{ padding: '10px 5px' }}>
                        {salonData.statut === 'en_attente' && salonData.distribution_mode === 'manuelle' ? (
                          <select
                            value={j.role || ''}
                            onChange={e => assignRoleManually(j.id, e.target.value)}
                            style={{ background: 'var(--input-bg)', color: 'var(--text-color)', padding: '5px', borderRadius: '5px', border: '1px solid var(--card-border)' }}
                          >
                            <option value="">Sélectionner...</option>
                            {/* FILTRAGE : seuls les rôles sélectionnés lors de la configuration */}
                            {rolesData
                              .filter(r => (salonData.roles_selectionnes || []).includes(r.id))
                              .map(r => <option key={r.id} value={r.id}>{r.name}</option>)
                            }
                          </select>
                        ) : (
                          <span style={{ color: roleObj?.color || 'var(--text-color)', fontWeight: 'bold' }}>
                            {j.est_infecte === true
                              ? `${roleObj?.name || j.role} (Infecté)`
                              : roleObj?.name || 'Caché'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
