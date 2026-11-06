import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  writeBatch, runTransaction, arrayUnion,
} from 'firebase/firestore';

import { db } from './firebase';
import { rolesData, getRole } from './rolesData';
import {
  isWolf, ALL_NIGHT_PHASES, DAY_PHASES,
  phaseLabel, stripEmoji, notifRoleId, shuffleArray,
} from './gameLogic';
import {
  RoleIcon, RoleMedallion, RoleChip,
  RoleDetailsModal, GrimoireModal, AutomationBadge,
} from './RoleComponents';
import {
  WolfPackChat, AccusedDefenseChat, MjMessengerPanel,
} from './GameChats';
import AiTestPanel from './AiTestPanel';
import { isBot } from './aiBotEngine';
import {
  Users, RefreshCw, Eye, Settings, Play,
  Link as LinkIcon, Info, ChevronRight, Bell,
  BookOpen, Plus, Minus, Dices, PenLine, Trash2,
  Shield, ShieldCheck, PawPrint, Skull, Sun, Moon,
  Heart, VenetianMask, FlaskConical, Gavel, Trophy,
  CheckCircle2, AlertTriangle, Hourglass, Megaphone,
  Lock, Unlock, Sparkles, Sword, Bird, X, Bot,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

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
  if (alive.some(j => isWolf(j)))
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

const PHASE_BADGE_META = {
  nuit_cupidon:   { label: 'Cupidon',       roleId: 'cupidon' },
  nuit_voleur:    { label: 'Voleur',        roleId: 'voleur' },
  nuit_salvateur: { label: 'Salvateur',     roleId: 'salvateur' },
  nuit_voyante:   { label: 'Voyante',       roleId: 'voyante' },
  nuit_loups:     { label: 'Loups-Garous',  roleId: 'loup-garou' },
  nuit_sorciere:  { label: 'Sorcière',      roleId: 'sorciere' },
};

export default function MjDashboard() {
  const { roomId } = useParams();

  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs]     = useState([]);
  const [accusesMJ, setAccusesMJ] = useState([]);

  // ── État de configuration (avant ouverture du salon) ──────────────────────
  const [selectedRoles, setSelectedRoles]       = useState([]);
  const [comedienRoles, setComedienRoles]       = useState([]);
  const [distributionMode, setDistributionMode] = useState('aleatoire');
  const [nbJoueurs, setNbJoueurs]               = useState(6);
  const [isGenerating, setIsGenerating]         = useState(false);

  // ── Modals Grimoire & Fiches Rôles pour le MJ ─────────────────────────────
  const [inspectRole, setInspectRole]   = useState(null);
  const [showGrimoire, setShowGrimoire] = useState(false);

  const activeRoleIds = salonData?.roles_selectionnes || selectedRoles || [];

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
    const nonPlayStates = ['SETUP', 'en_attente', 'fin_village', 'fin_loups', 'fin_ange'];
    if (nonPlayStates.includes(salonData.statut)) return;

    const alivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
    if (alivePlayers.length === 0) return;

    const totalLoups = alivePlayers.filter(j => isWolf(j)).length;
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
    if (ALL_NIGHT_PHASES.includes(salonData.statut)) {
      document.body.classList.add('theme-nuit');
      document.body.classList.remove('theme-jour');
    } else if (DAY_PHASES.includes(salonData.statut)) {
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
        numero_jour: 1,
        // ── Champs nuit ──
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,
        cible_corbeau: null,
        illusion_active: false,
        infection_active: false,
        // ── Champs jour ──
        la_liste_accuses: [],
        votes: {},
        // ── Chats & Messagerie ──
        chat_loups: [],
        chat_defense: [],
        messages_mj: [],
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

  const assignRoleManually = async (joueurId, roleId) => {
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueurId), {
        role: roleId,
        carte_choisie: 999,
        vies: roleId === 'ancien' ? 2 : 1,
        infection_dispo: roleId === 'infect-pere-des-loups' || roleId === 'pere-des-loups',
        infection_repondu: false,
      });
    } catch (e) { console.error(e); }
  };

  // ── Proposition de changement de rôle en cours de partie (avec acceptation du joueur) ──
  const proposeRoleChange = async (joueur, newRoleId) => {
    if (!joueur || !newRoleId || newRoleId === joueur.role) return;
    const newRoleObj = getRole(newRoleId);
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueur.id), {
        proposition_role: {
          roleId: newRoleId,
          timestamp: Date.now(),
        },
      });
      await updateDoc(doc(db, 'salons', roomId), {
        notifications_mj: arrayUnion(
          `Proposition de nouveau rôle (${newRoleObj?.name || newRoleId}) envoyée à ${joueur.nom}. En attente de son acceptation...`,
        ),
      });
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la proposition de changement de rôle.');
    }
  };

  const cancelRoleProposal = async (joueur) => {
    if (!joueur) return;
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueur.id), {
        proposition_role: null,
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

  // ── Suppression d'un joueur du salon en cours ─────────────────────────────
  const handleRemovePlayer = async (joueur) => {
    if (!joueur) return;
    if (!window.confirm(`Voulez-vous vraiment supprimer "${joueur.nom}" du salon en cours ?`)) return;

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'salons', roomId, 'joueurs', joueur.id));

      const salonUpdates = {};

      // Nettoyage des votes liés à ce joueur
      if (salonData?.votes && typeof salonData.votes === 'object') {
        const cleanedVotes = {};
        Object.entries(salonData.votes).forEach(([votant, cible]) => {
          if (votant !== joueur.nom && cible !== joueur.nom) {
            cleanedVotes[votant] = cible;
          }
        });
        salonUpdates.votes = cleanedVotes;
      }

      // Nettoyage de la liste des accusés
      if (Array.isArray(salonData?.la_liste_accuses) && salonData.la_liste_accuses.includes(joueur.nom)) {
        salonUpdates.la_liste_accuses = salonData.la_liste_accuses.filter(n => n !== joueur.nom);
      }

      // Nettoyage du couple
      if (Array.isArray(salonData?.couple) && salonData.couple.includes(joueur.id)) {
        salonUpdates.couple = [];
      }

      // Nettoyage des cibles nocturnes éventuelles
      if (salonData?.victime_loups === joueur.nom) salonUpdates.victime_loups = null;
      if (salonData?.victime_loups_visible_sorciere === joueur.nom) salonUpdates.victime_loups_visible_sorciere = null;
      if (salonData?.vote_loup_temporaire === joueur.nom) salonUpdates.vote_loup_temporaire = null;
      if (salonData?.victime_sorciere === joueur.nom) salonUpdates.victime_sorciere = null;
      if (salonData?.joueur_protege === joueur.nom) salonUpdates.joueur_protege = null;
      if (salonData?.cible_corbeau === joueur.nom) salonUpdates.cible_corbeau = null;

      salonUpdates.notifications_mj = arrayUnion(`${joueur.nom} a été retiré du salon par le Maître du Jeu.`);

      batch.update(doc(db, 'salons', roomId), salonUpdates);
      await batch.commit();

      setAccusesMJ(prev => prev.filter(n => n !== joueur.nom));
    } catch (e) {
      console.error(e);
      alert("Erreur lors de la suppression du joueur.");
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
   */
  const handleNextPhase = async () => {
    const next = getNextNightPhase(salonData.statut, joueurs);
    const updates = { statut: next };

    if (salonData.statut === 'nuit_loups' && salonData.victime_loups) {
      const victimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
      const isProtected       = victimDoc?.nom === salonData.joueur_protege;
      const isAncienFirstLife = victimDoc?.role === 'ancien' && (victimDoc?.vies ?? 2) > 1;
      const isInfection       = !!salonData.infection_active;

      updates.victime_loups_visible_sorciere =
        (isProtected || isAncienFirstLife || isInfection) ? null : salonData.victime_loups;
    }

    try {
      await updateDoc(doc(db, 'salons', roomId), updates);
    } catch (e) { console.error(e); }
  };

  /**
   * Résolution du matin : application des morts (loups + Sorcière + chagrin amoureux + modèle Enfant Sauvage),
   * infection, immunité du Salvateur, résistance de l'Ancien, venin du Chevalier.
   */
  const handleApplyNightDeaths = async () => {
    try {
      await runTransaction(db, async transaction => {
        let diedFromLoups    = false;
        let diedFromSorciere = false;
        let notifMj          = null;
        const newNotifications = [];
        const deadPlayerIds = new Set();

        const isInfectRole = r => r === 'infect-pere-des-loups' || r === 'pere-des-loups';
        const isChevalierRole = r => r === 'chevalier-epee' || r === 'chevalier';

        // ── 1. Traitement de la victime des loups ─────────────────────────
        if (salonData.victime_loups && !salonData.victime_sauvee) {
          const loupVictimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
          if (loupVictimDoc) {
            const isProtected       = loupVictimDoc.nom === salonData.joueur_protege;
            const isAncienFirstLife = loupVictimDoc.role === 'ancien' && (loupVictimDoc.vies ?? 2) > 1;

            if (isProtected) {
              if (salonData.infection_active) {
                const infectPere = joueurs.find(j => isInfectRole(j.role));
                if (infectPere) {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', infectPere.id),
                    { infection_dispo: true },
                  );
                }
                newNotifications.push(
                  "L'Infection a échoué car la cible était protégée par le Salvateur (Pouvoir conservé).",
                );
              }
            } else if (isAncienFirstLife) {
              transaction.update(
                doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                { vies: 1 },
              );
              if (salonData.infection_active) {
                const infectPere = joueurs.find(j => isInfectRole(j.role));
                if (infectPere) {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', infectPere.id),
                    { infection_dispo: true },
                  );
                }
                newNotifications.push(
                  "L'Ancien a résisté à l'infection grâce à sa première vie (Pouvoir conservé).",
                );
              } else {
                notifMj = `L'Ancien (${loupVictimDoc.nom}) a été attaqué mais a survécu (vies restantes : 1).`;
              }
            } else {
              if (salonData.infection_active) {
                if (isChevalierRole(loupVictimDoc.role)) {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                    { statut_joueur: 'mort' },
                  );
                  deadPlayerIds.add(loupVictimDoc.id);
                  diedFromLoups = true;
                  newNotifications.push("L'Infection a échoué sur le Chevalier à l'Épée Rouillée : il meurt de l'attaque et empoisonne un loup.");
                  transaction.update(doc(db, 'salons', roomId), {
                    venin_chevalier_actif: true,
                    index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id),
                  });
                } else {
                  transaction.update(
                    doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                    { est_infecte: true },
                  );
                  newNotifications.push(
                    `${loupVictimDoc.nom} a été infecté et rejoint le camp des loups.`,
                  );
                }
              } else {
                transaction.update(
                  doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id),
                  { statut_joueur: 'mort' },
                );
                deadPlayerIds.add(loupVictimDoc.id);
                diedFromLoups = true;
                if (isChevalierRole(loupVictimDoc.role)) {
                  transaction.update(doc(db, 'salons', roomId), {
                    venin_chevalier_actif: true,
                    index_chevalier: joueurs.findIndex(j => j.id === loupVictimDoc.id),
                  });
                  newNotifications.push(
                    `Le Chevalier à l'Épée Rouillée (${loupVictimDoc.nom}) a été dévoré : son épée empoisonne le loup à sa gauche.`,
                  );
                }
              }
            }
          }
        } else if (salonData.victime_loups && salonData.victime_sauvee && salonData.infection_active) {
          const infectPere = joueurs.find(j => isInfectRole(j.role));
          if (infectPere) {
            transaction.update(
              doc(db, 'salons', roomId, 'joueurs', infectPere.id),
              { infection_dispo: true },
            );
          }
          newNotifications.push(
            "L'Infection a échoué car la cible a été sauvée par la Sorcière (Pouvoir conservé).",
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
            deadPlayerIds.add(sorcVictimDoc.id);
            diedFromSorciere = true;
          }
        }

        // ── 3. Cascade Amoureux (Cupidon) ─────────────────────────────────
        let chagrinNom = null;
        if (Array.isArray(salonData.couple) && salonData.couple.length === 2) {
          const [c1, c2] = salonData.couple;
          if (deadPlayerIds.has(c1) && !deadPlayerIds.has(c2)) {
            const p2 = joueurs.find(j => j.id === c2);
            if (p2 && p2.statut_joueur !== 'mort') {
              transaction.update(doc(db, 'salons', roomId, 'joueurs', p2.id), { statut_joueur: 'mort' });
              deadPlayerIds.add(p2.id);
              chagrinNom = p2.nom;
              newNotifications.push(`Amoureux : ${p2.nom} meurt de chagrin suite à la perte de son âme sœur.`);
            }
          } else if (deadPlayerIds.has(c2) && !deadPlayerIds.has(c1)) {
            const p1 = joueurs.find(j => j.id === c1);
            if (p1 && p1.statut_joueur !== 'mort') {
              transaction.update(doc(db, 'salons', roomId, 'joueurs', p1.id), { statut_joueur: 'mort' });
              deadPlayerIds.add(p1.id);
              chagrinNom = p1.nom;
              newNotifications.push(`Amoureux : ${p1.nom} meurt de chagrin suite à la perte de son âme sœur.`);
            }
          }
        }

        // ── 4. Modèle de l'Enfant Sauvage ─────────────────────────────────
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
            newNotifications.push(`Enfant Sauvage : Le modèle de ${j.nom} est mort, ${j.nom} rejoint désormais la meute des loups !`);
          }
        });

        // ── 5. Mise à jour du salon ───────────────────────────────────────
        const salonUpdates = {
          statut: 'jour_vote',
          morts_nuit: {
            loups:    diedFromLoups    ? salonData.victime_loups    : null,
            sorciere: diedFromSorciere ? salonData.victime_sorciere : null,
            venin:    salonData.morts_nuit?.venin || null,
            chagrin:  chagrinNom,
          },
          infection_active: false,
          notif_mj: notifMj,
          votes: {},
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
   */
  const handleApplyDaySentence = async () => {
    const votesRaw   = salonData.votes || {};
    const votesCount = {};

    // Pénalité du Corbeau (+2 voix d'office)
    if (salonData.cible_corbeau) {
      const cibleCorbeauAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
      if (cibleCorbeauAlive) {
        votesCount[salonData.cible_corbeau] = (votesCount[salonData.cible_corbeau] || 0) + 2;
      }
    }

    // N'agréger que les votes des joueurs encore en vie et ayant le droit de vote
    Object.entries(votesRaw).forEach(([votant, cible]) => {
      const votantPlayer = joueurs.find(j => j.nom === votant);
      if (votantPlayer && votantPlayer.statut_joueur !== 'mort' && !votantPlayer.gracie_idiot) {
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
        alert(`Égalité des votes ! Le Bouc Émissaire (${bouc.nom}) est éliminé à la place des suspects.`);
        condamneNom = bouc.nom;
      } else {
        alert("Égalité des votes ! Aucun Bouc Émissaire en vie, personne n'est éliminé.");
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

    // 1. Illusionniste
    if (condamne.role === 'illusionniste' && salonData.illusion_active) {
      alert("C'était une illusion ! L'Illusionniste survit au bûcher !");
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          illusion_active: false,
          statut: 'jour_resolution',
          condamne_jour: `${condamneNom} (Sauvé par son Illusion)`,
        });
      } catch (e) { console.error(e); }
      return;
    }

    // 2. Idiot du Village (gracié mais perd son droit de vote)
    if (condamne.role === 'idiot-village' && !condamne.gracie_idiot) {
      alert(`${condamneNom} est l'Idiot du Village ! Le village l'épargne, mais il ne pourra plus voter.`);
      try {
        await updateDoc(doc(db, 'salons', roomId, 'joueurs', condamne.id), {
          gracie_idiot: true,
        });
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution',
          condamne_jour: `${condamneNom} (Gracié — Idiot du Village)`,
          notifications_mj: arrayUnion(`Idiot du Village : ${condamneNom} a été gracié par le village et perd son droit de vote.`),
        });
      } catch (e) { console.error(e); }
      return;
    }

    // 3. Ange (condamné au tout premier vote du village → victoire solitaire immédiate)
    if (condamne.role === 'ange' && (salonData.numero_jour || 1) === 1) {
      if (window.confirm(`Condamner ${condamneNom} (${maxVotes} voix) ?`)) {
        try {
          await updateDoc(doc(db, 'salons', roomId, 'joueurs', condamne.id), { statut_joueur: 'mort' });
          await updateDoc(doc(db, 'salons', roomId), {
            statut: 'fin_ange',
            condamne_jour: `${condamneNom} (Victoire de l'Ange)`,
            notifications_mj: arrayUnion(`L'Ange (${condamneNom}) s'est fait éliminer lors du premier vote et remporte la partie seul !`),
          });
        } catch (e) { console.error(e); }
      }
      return;
    }

    // 4. Condamnation classique (+ cascade Amoureux + modèle Enfant Sauvage)
    if (window.confirm(`Voulez-vous vraiment condamner ${condamneNom} (${maxVotes} vote(s)) ?`)) {
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'salons', roomId, 'joueurs', condamne.id), { statut_joueur: 'mort' });

        let condamneLabel = condamneNom;
        const deadIds = new Set([condamne.id]);
        const notifs = [];

        // Cascade amoureux
        if (Array.isArray(salonData.couple) && salonData.couple.length === 2 && salonData.couple.includes(condamne.id)) {
          const partnerId = salonData.couple.find(id => id !== condamne.id);
          const partner = joueurs.find(j => j.id === partnerId);
          if (partner && partner.statut_joueur !== 'mort') {
            batch.update(doc(db, 'salons', roomId, 'joueurs', partner.id), { statut_joueur: 'mort' });
            deadIds.add(partner.id);
            condamneLabel = `${condamneNom} + ${partner.nom} (chagrin d'amour)`;
            notifs.push(`Amoureux : ${partner.nom} meurt de chagrin suite à l'exécution de ${condamneNom}.`);
          }
        }

        // Enfant Sauvage
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
            notifs.push(`Enfant Sauvage : Le modèle de ${j.nom} a été exécuté, ${j.nom} rejoint la meute des loups !`);
          }
        });

        // Ancien tué par le village
        if (condamne.role === 'ancien') {
          notifs.push(`Attention : Le village a exécuté l'Ancien (${condamneNom}) ! Selon la règle, les villageois perdent leurs pouvoirs.`);
        }

        const salonUpd = {
          statut: 'jour_resolution',
          condamne_jour: condamneLabel,
        };
        if (notifs.length > 0) {
          salonUpd.notifications_mj = arrayUnion(...notifs);
        }
        batch.update(doc(db, 'salons', roomId), salonUpd);
        await batch.commit();
      } catch (e) { console.error(e); }
    }
  };

  /**
   * Lancement de la nuit suivante.
   */
  const handleNextNight = async () => {
    try {
      const batch = writeBatch(db);
      const phases     = computeNightPhases(joueurs);
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
        morts_nuit: veninVictim ? { venin: veninVictim.nom } : null,
        la_liste_accuses: [],
        votes: {},
        chat_loups: [],
        chat_defense: [],
        notif_mj: null,
        notifications_mj: veninNotif ? [veninNotif] : [],
        venin_chevalier_actif: false,
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
        numero_jour: 1,
        roles_melanges: shuffled,
        roles_dispo_comedien: salonData.roles_dispo_comedien_init || [],
        couple: [],
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,
        cible_corbeau: null,
        illusion_active: false,
        infection_active: false,
        la_liste_accuses: [],
        votes: {},
        chat_loups: [],
        chat_defense: [],
        messages_mj: [],
        notifications_mj: [],
        notif_mj: null,
        morts_nuit: null,
        condamne_jour: null,
        venin_chevalier_actif: false,
        index_chevalier: null,
        etape_activation: 1,
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
          potion_vie_utilisee: false,
          potion_mort_utilisee: false,
          vies: 1,
          infection_dispo: false,
          infection_repondu: false,
          est_infecte: false,
          tir_chasseur_fait: false,
          gracie_idiot: false,
          choix_chien: null,
          modele_id: null,
          modele_nom: null,
          enfant_devenu_loup: false,
          pouvoir_renard_perdu: false,
          proposition_role: null,
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
          <div>
            <button
              type="button"
              onClick={() => setShowGrimoire(true)}
              className="btn-secondary text-font border-accent"
            >
              <BookOpen size={18} style={{ color: 'var(--primary)' }} /> Grimoire des 40 Rôles
            </button>
          </div>
        </header>

        <div className="config-box glass-panel">
          <h2 className="title-font">
            <Settings size={22} style={{ color: 'var(--primary)' }} /> Configuration de la partie
          </h2>

          {/* ── Slider : nombre de joueurs ─────────────────────────────── */}
          <div style={{ marginBottom: '1.5rem', background: 'var(--input-bg)', padding: '1.15rem', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 className="title-font" style={{ fontSize: '1.05rem', margin: 0 }}>
                Nombre de joueurs cible :{' '}
                <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{nbJoueurs}</span>
              </h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setNbJoueurs(prev => Math.max(3, prev - 1))}
                  className="role-btn"
                  style={{ width: '32px', height: '32px', background: 'var(--card-bg)', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setNbJoueurs(prev => Math.min(35, prev + 1))}
                  className="role-btn"
                  style={{ width: '32px', height: '32px', background: 'var(--card-bg)', borderRadius: '6px', border: '1px solid var(--card-border)' }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <input
              type="range"
              min="3"
              max="35"
              value={nbJoueurs}
              onChange={e => setNbJoueurs(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span className="text-font" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>3 joueurs</span>
              <span className="text-font" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>35 joueurs</span>
            </div>

            {/* Raccourcis rapides */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
              {[6, 8, 10, 12, 15, 20, 25, 30, 35].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNbJoueurs(n)}
                  className="text-font"
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--card-border)',
                    background: nbJoueurs === n ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                    color: nbJoueurs === n ? '#fff' : 'var(--text-color)',
                    cursor: 'pointer',
                    fontWeight: nbJoueurs === n ? 'bold' : 'normal',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {selectedRoles.length > 0 && surplus !== 0 && (
              <div style={{ marginTop: '12px', borderTop: '1px solid var(--card-border)', paddingTop: '10px' }}>
                <p className="text-font" style={{ margin: 0, fontSize: '0.85rem', color: surplus < 0 ? '#f59e0b' : '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {surplus < 0 ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                  {surplus < 0
                    ? `Il manque ${-surplus} rôle(s) pour atteindre votre objectif de ${nbJoueurs} joueurs.`
                    : `Vous avez ${surplus} rôle(s) en surplus — idéal pour des variantes.`}
                </p>
                {surplus < 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const needed = -surplus;
                      setSelectedRoles(prev => [...prev, ...Array(needed).fill('villageois')]);
                    }}
                    className="btn-secondary text-font"
                    style={{ marginTop: '8px', padding: '6px 12px', fontSize: '0.82rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
                  >
                    <Plus size={14} /> Compléter automatiquement avec {-surplus} Simple Villageois
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Mode de distribution ───────────────────────────────────── */}
          <div style={{ marginBottom: '1.5rem', background: 'var(--input-bg)', padding: '1.15rem', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
            <h3 className="title-font" style={{ fontSize: '1.05rem', marginBottom: '10px' }}>
              Mode de distribution
            </h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setDistributionMode('aleatoire')}
                className={`btn-secondary text-font ${distributionMode === 'aleatoire' ? 'glow-button' : ''}`}
                style={{ flex: '1 1 180px', borderColor: distributionMode === 'aleatoire' ? 'var(--primary)' : '' }}
              >
                <Dices size={18} style={{ color: 'var(--primary)' }} /> Tirage Aléatoire (Cartes)
              </button>
              <button
                type="button"
                onClick={() => setDistributionMode('manuelle')}
                className={`btn-secondary text-font ${distributionMode === 'manuelle' ? 'glow-button' : ''}`}
                style={{ flex: '1 1 180px', borderColor: distributionMode === 'manuelle' ? 'var(--primary)' : '' }}
              >
                <PenLine size={18} style={{ color: 'var(--primary)' }} /> Attribution Manuelle (MJ)
              </button>
            </div>
          </div>

          {/* ── Sélection des rôles ────────────────────────────────────── */}
          <div style={{ marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <h3 className="title-font" style={{ fontSize: '1.15rem', margin: 0 }}>Sélection des rôles</h3>
                <p className="text-font" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Cliquez sur le nom ou l'icône d'un rôle pour ouvrir sa fiche détaillée.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {selectedRoles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedRoles([])}
                    className="text-font"
                    style={{
                      padding: '0.35rem 0.7rem',
                      fontSize: '0.75rem',
                      borderRadius: '1rem',
                      border: '1px solid rgba(239,68,68,0.5)',
                      background: 'rgba(239,68,68,0.1)',
                      color: '#ef4444',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: 700,
                    }}
                  >
                    <Trash2 size={12} /> Vider
                  </button>
                )}
                <div
                  className="role-counter text-font text-success"
                  style={{ fontWeight: 'bold', padding: '0.35rem 0.85rem', background: 'var(--input-bg)', borderRadius: '1rem', fontSize: '0.85rem', border: '1px solid var(--card-border)' }}
                >
                  {selectedRoles.length} / {nbJoueurs} sélectionné(s)
                </div>
              </div>
            </div>

            <div className="roles-grid" style={{ marginTop: '0.85rem' }}>
              {rolesData.map(role => {
                const count = selectedRoles.filter(id => id === role.id).length;
                return (
                  <div
                    key={role.id}
                    className="role-selector-item glass-panel"
                    style={{
                      borderColor: count > 0 ? role.color : undefined,
                      background: count > 0 ? `${role.color}12` : undefined,
                    }}
                  >
                    <div
                      className="role-selector-info"
                      onClick={() => setInspectRole(role)}
                      title={`Voir l'explication détaillée de ${role.name}`}
                    >
                      <RoleMedallion role={role} size="xs" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="role-selector-name text-font" style={{ color: count > 0 ? role.color : 'var(--text-color)' }}>
                          {role.name}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Info size={10} /> Voir la fiche
                        </div>
                      </div>
                    </div>
                    <div className="role-counter-controls" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => removeRole(role.id)} disabled={count === 0} className="role-btn">
                        <Minus size={13} />
                      </button>
                      <span className="role-count text-font" style={{ color: 'var(--text-color)' }}>{count}</span>
                      <button type="button" onClick={() => addRole(role.id)} className="role-btn">
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Rôles du Comédien ──────────────────────────────────────── */}
          {hasComedien && (
            <div style={{ marginBottom: '2rem', padding: '1.15rem', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.45)', borderRadius: '12px' }}>
              <h3 className="title-font" style={{ color: '#fbbf24', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem' }}>
                <RoleIcon roleId="comedien" size={20} /> Réserve du Comédien ({comedienRoles.length}/3)
              </h3>
              <div className="roles-grid">
                {rolesData.filter(r => r.id !== 'comedien').map(role => {
                  const count = comedienRoles.filter(id => id === role.id).length;
                  return (
                    <div key={role.id} className="role-selector-item glass-panel">
                      <div
                        className="role-selector-info"
                        onClick={() => setInspectRole(role)}
                        title={`Voir l'explication de ${role.name}`}
                      >
                        <RoleMedallion role={role} size="xs" />
                        <span className="role-selector-name text-font" style={{ color: 'var(--text-color)' }}>
                          {role.name}
                        </span>
                      </div>
                      <div className="role-counter-controls" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={() => removeComedienRole(role.id)} disabled={count === 0} className="role-btn">
                          <Minus size={13} />
                        </button>
                        <span className="role-count text-font" style={{ color: 'var(--text-color)' }}>{count}</span>
                        <button
                          type="button"
                          onClick={() => addComedienRole(role.id)}
                          disabled={comedienRoles.length >= 3 && count === 0}
                          className="role-btn"
                        >
                          <Plus size={13} />
                        </button>
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
          >
            {isGenerating ? <RefreshCw className="spinner" size={20} /> : <Users size={20} />}
            Ouvrir le salon ({selectedRoles.length} cartes)
          </button>
        </div>

        {/* Modals Guide & Fiche pour le MJ */}
        <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
        <GrimoireModal
          isOpen={showGrimoire}
          onClose={() => setShowGrimoire(false)}
          onSelectRole={role => setInspectRole(role)}
          activeRoleIds={activeRoleIds}
        />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER : Tableau de bord MJ (partie en cours ou en attente)
  // ═══════════════════════════════════════════════════════════════════════════

  const isPhase       = p => salonData.statut === p;
  const isNightPhase  = ALL_NIGHT_PHASES.includes(salonData.statut);
  const isGameRunning = salonData.statut !== 'en_attente';

  const nightPhaseSequence = computeNightPhases(joueurs);
  const infectPere         = joueurs.find(j => (j.role === 'infect-pere-des-loups' || j.role === 'pere-des-loups') && j.statut_joueur !== 'mort');
  const chasseurActif      = joueurs.find(j => j.role === 'chasseur' && j.statut_joueur === 'mort' && j.tir_chasseur_fait === false);

  // Agrégation des votes depuis salonData.votes + pénalité du Corbeau
  const votesCountJour = {};
  if (salonData.cible_corbeau) {
    const corbeauTargetAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
    if (corbeauTargetAlive) {
      votesCountJour[salonData.cible_corbeau] = 2;
    }
  }
  Object.entries(salonData.votes || {}).forEach(([votant, cible]) => {
    const votantPlayer = joueurs.find(j => j.nom === votant);
    if (votantPlayer && votantPlayer.statut_joueur !== 'mort' && !votantPlayer.gracie_idiot) {
      votesCountJour[cible] = (votesCountJour[cible] || 0) + 1;
    }
  });

  const alivePlayers   = joueurs.filter(j => j.statut_joueur !== 'mort');
  const eligibleVoters = alivePlayers.filter(j => !j.gracie_idiot);
  const nbVotesDeposes = Object.keys(salonData.votes || {}).filter(nom => {
    const p = joueurs.find(j => j.nom === nom);
    return p && p.statut_joueur !== 'mort' && !p.gracie_idiot;
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
              {phaseLabel(salonData.statut).toUpperCase()}
            </strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexDirection: 'row', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowGrimoire(true)}
            className="btn-secondary text-font border-accent"
          >
            <BookOpen size={18} style={{ color: 'var(--primary)' }} /> Grimoire des Rôles
          </button>
          <button
            onClick={handleResetGame}
            className="btn-secondary text-font border-accent"
          >
            <RefreshCw size={18} /> Réinitialiser
          </button>
        </div>
      </header>

      {/* ── BANDEAU SÉQUENCE DE LA NUIT ──────────────────────────────────── */}
      {isNightPhase && (
        <div
          className="glass-panel"
          style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem' }}
        >
          <p className="text-font" style={{ margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            Séquence active de cette nuit
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {nightPhaseSequence.map(phase => {
              const isCurrent = phase === salonData.statut;
              const meta = PHASE_BADGE_META[phase] || { label: phase, roleId: 'loup-garou' };
              return (
                <span
                  key={phase}
                  className="text-font"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 13px',
                    borderRadius: '20px',
                    fontSize: '0.82rem',
                    background: isCurrent ? 'var(--primary)' : 'rgba(255,255,255,0.07)',
                    color: isCurrent ? '#fff' : 'var(--text-muted)',
                    fontWeight: isCurrent ? '800' : '500',
                    border: isCurrent ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <RoleIcon roleId={meta.roleId} size={14} />
                  {meta.label}
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
          style={{ marginTop: '1rem', padding: '1rem 1.35rem', border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.05)', borderRadius: '1rem' }}
        >
          <h3 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', marginBottom: '0.75rem', fontSize: '0.98rem' }}>
            <Bell size={16} /> Journal MJ — Événements & Pouvoirs
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {salonData.notifications_mj.map((notif, i) => {
              const cleanText = stripEmoji(notif);
              const rId = notifRoleId(cleanText);
              const rObj = rId ? getRole(rId) : null;
              return (
                <li
                  key={i}
                  className="text-font"
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(0,0,0,0.22)',
                    borderRadius: '8px',
                    fontSize: '0.88rem',
                    color: 'var(--text-color)',
                    borderLeft: `3px solid ${rObj?.color || '#fbbf24'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ color: rObj?.color || '#fbbf24', display: 'inline-flex' }}>
                    <RoleIcon roleId={rId || 'loup-garou'} size={16} />
                  </span>
                  <span>{cleanText}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── PANNEAU DE CONTRÔLE DES PHASES ───────────────────────────────── */}
      <div
        className="glass-panel"
        style={{ marginTop: '1.5rem', border: '2px solid var(--primary)', borderRadius: '1.5rem', padding: 'clamp(1.25rem, 3vw, 2rem)' }}
      >
        <h2 className="title-font" style={{ marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.3rem' }}>
          <Settings size={22} /> CONTRÔLE DE LA PARTIE
        </h2>

        {/* EN ATTENTE */}
        {isPhase('en_attente') && (
          <div>
            <p className="text-font text-muted" style={{ marginBottom: '1rem' }}>
              Les joueurs rejoignent le salon via le QR Code ou le lien. Une fois les cartes choisies, lancez la première nuit.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button
                onClick={handleAddPlayer}
                className="btn-secondary text-font border-accent"
                style={{ flex: 1, padding: '12px' }}
              >
                <Plus size={18} /> Ajouter une place (Simple Villageois)
              </button>
            </div>
            <button
              onClick={handleStartGame}
              className="btn-primary title-font glow-button"
            >
              <Play size={20} /> LANCER LA PARTIE
            </button>
          </div>
        )}

        {/* NUIT CUPIDON */}
        {isPhase('nuit_cupidon') && (
          <div>
            <p className="text-font" style={{ color: '#ec4899', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
              <Heart size={20} /> Tour de Cupidon — Désignation des deux amoureux.
            </p>
            <p className="text-font text-muted" style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Statut du couple :{' '}
              {salonData.couple?.length === 2 ? (
                <span style={{ color: '#10b981', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={16} /> Amoureux liés
                </span>
              ) : (
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>En attente du choix de Cupidon...</span>
              )}
            </p>
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#ec4899' }}
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
              <p className="text-font" style={{ color: '#a1a1aa', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <VenetianMask size={20} /> Tour du Voleur — Il peut échanger sa carte ou conserver son pouvoir.
              </p>
              {voleur && (
                <p className="text-font" style={{ margin: '0 0 1.25rem', fontWeight: 'bold', color: voleur.a_vote ? '#10b981' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {voleur.a_vote ? <CheckCircle2 size={16} /> : <Hourglass size={16} />}
                  {voleur.a_vote ? `${voleur.nom} a terminé son tour` : `${voleur.nom} réfléchit...`}
                </p>
              )}
              <button
                onClick={handleNextPhase}
                className="btn-primary title-font glow-button"
              >
                Séquence Suivante <ChevronRight size={20} />
              </button>
            </div>
          );
        })()}

        {/* NUIT SALVATEUR */}
        {isPhase('nuit_salvateur') && (
          <div>
            <p className="text-font" style={{ color: '#3b82f6', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
              <ShieldCheck size={20} /> Tour du Salvateur — Choix du joueur protégé cette nuit.
            </p>
            <p className="text-font text-muted" style={{ marginBottom: '0.5rem' }}>
              Joueur protégé ce tour : <strong style={{ color: 'var(--text-color)' }}>{salonData.joueur_protege || 'Aucun'}</strong>
            </p>
            {salonData.derniere_cible_salvateur && (
              <p className="text-font" style={{ marginBottom: '1.25rem', fontSize: '0.88rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.3)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={15} /> Cible non re-protégeable cette nuit : <strong>{salonData.derniere_cible_salvateur}</strong>
              </p>
            )}
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#3b82f6' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT VOYANTE */}
        {isPhase('nuit_voyante') && (
          <div>
            <p className="text-font" style={{ color: '#8b5cf6', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
              <Eye size={20} /> Tour de la Voyante — Elle sonde le rôle secret d'un joueur.
            </p>
            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#8b5cf6' }}
            >
              Séquence Suivante <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* NUIT LOUPS */}
        {isPhase('nuit_loups') && (
          <div>
            <p className="text-font" style={{ color: '#ef4444', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PawPrint size={20} /> Tour des Loups-Garous — La meute désigne sa proie.
            </p>

            {infectPere && (
              <div style={{ margin: '1rem 0', padding: '10px 14px', background: 'rgba(127,29,29,0.35)', border: '1px solid #991b1b', borderRadius: '8px' }}>
                <p className="text-font" style={{ margin: 0, fontSize: '0.9rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RoleIcon roleId="infect-pere-des-loups" size={16} />
                  <strong>{infectPere.nom}</strong> (Infect Père des Loups) :{' '}
                  {infectPere.infection_repondu
                    ? (salonData.infection_active ? "A choisi d'INFECTER la victime" : 'A laissé la victime mourir')
                    : infectPere.infection_dispo
                      ? "N'a pas encore répondu à l'infection"
                      : "Pouvoir d'infection déjà utilisé"}
                </p>
              </div>
            )}

            <div style={{ background: 'rgba(239,68,68,0.1)', padding: '1rem', borderRadius: '10px', margin: '1rem 0', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p className="text-font">Cible pointée : <strong style={{ color: 'var(--text-color)' }}>{salonData.vote_loup_temporaire || '—'}</strong></p>
              <p className="text-font" style={{ marginTop: '4px' }}>Victime validée : <strong style={{ color: '#ef4444' }}>{salonData.victime_loups || 'En attente...'}</strong></p>
              {salonData.infection_active && (
                <p className="text-font" style={{ color: '#a78bfa', marginTop: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RoleIcon roleId="infect-pere-des-loups" size={16} /> L'Infect Père des Loups va convertir la victime cette nuit !
                </p>
              )}
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <WolfPackChat
                roomId={roomId}
                salonData={salonData}
                senderName="Maître du Jeu"
                isReadOnly={false}
              />
            </div>

            <button
              onClick={handleNextPhase}
              className="btn-primary title-font glow-button"
              style={{ background: '#ef4444' }}
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
              <p className="text-font" style={{ color: '#c4b5fd', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FlaskConical size={20} /> Tour de la Sorcière — Utilisation des potions de Vie et de Mort.
              </p>
              {!sorciere ? (
                <p className="text-font text-muted" style={{ fontStyle: 'italic', margin: '1rem 0' }}>
                  Aucune Sorcière en vie.
                </p>
              ) : (
                <p className="text-font" style={{ margin: '1rem 0', fontWeight: 'bold', color: sorciere.a_vote_sorciere ? '#10b981' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {sorciere.a_vote_sorciere ? <CheckCircle2 size={16} /> : <Hourglass size={16} />}
                  {sorciere.a_vote_sorciere ? 'La Sorcière a terminé son tour' : 'La Sorcière réfléchit...'}
                </p>
              )}
              <button
                onClick={handleNextPhase}
                className="btn-primary title-font glow-button"
                style={{ background: '#8b5cf6' }}
              >
                Séquence Suivante <ChevronRight size={20} />
              </button>
            </div>
          );
        })()}

        {/* MATIN */}
        {isPhase('matin') && (
          <div>
            <p className="text-font text-warning" style={{ marginBottom: '1rem', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sun size={20} /> Le village se réveille — Bilan de la nuit avant révélation.
            </p>

            {salonData.notif_mj && (
              <div style={{ marginBottom: '1rem', padding: '12px 16px', background: 'rgba(100,116,139,0.2)', border: '2px solid #64748b', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Shield size={20} style={{ color: '#94a3b8' }} />
                <p className="text-font" style={{ margin: 0, color: '#94a3b8', fontWeight: 'bold', fontSize: '0.92rem' }}>
                  {stripEmoji(salonData.notif_mj)}
                </p>
              </div>
            )}

            <ul className="text-font" style={{ listStyle: 'none', background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem', color: 'var(--text-color)', lineHeight: 2, border: '1px solid var(--card-border)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PawPrint size={16} style={{ color: '#ef4444' }} /> Cible des loups : <strong>{salonData.victime_loups || 'Personne'}</strong>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={16} style={{ color: '#3b82f6' }} /> Salvateur a protégé : <strong>{salonData.joueur_protege || 'Personne'}</strong>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FlaskConical size={16} style={{ color: '#10b981' }} /> Sorcière a sauvé : <strong>{salonData.victime_sauvee ? 'OUI' : 'NON'}</strong>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Skull size={16} style={{ color: '#a855f7' }} /> Sorcière a empoisonné : <strong>{salonData.victime_sorciere || 'Personne'}</strong>
              </li>
              {salonData.cible_corbeau && (
                <li style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
                  <Bird size={16} /> Corbeau a maudit (+2 voix) : <strong>{salonData.cible_corbeau}</strong>
                </li>
              )}
              {salonData.infection_active && (
                <li style={{ color: '#a78bfa', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RoleIcon roleId="infect-pere-des-loups" size={16} /> L'Infect Père des Loups a infecté la victime — elle rejoint la meute !
                </li>
              )}
            </ul>

            <button
              onClick={handleApplyNightDeaths}
              className="btn-primary title-font glow-button"
              style={{ background: '#f59e0b' }}
            >
              Appliquer les morts et ouvrir les débats <ChevronRight size={20} />
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
              if (salonData.morts_nuit?.chagrin)  morts.push(`${salonData.morts_nuit.chagrin} (chagrin d'amour)`);
              const uniqueMorts = [...new Set(morts)];

              return uniqueMorts.length > 0 ? (
                <div style={{ background: 'rgba(239,68,68,0.14)', border: '2px solid #ef4444', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem', textAlign: 'center' }}>
                  <h3 className="title-font" style={{ color: '#ef4444', fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Skull size={22} /> VERDICT DE LA NUIT : {uniqueMorts.join(', ')}
                  </h3>
                </div>
              ) : (
                <div style={{ background: 'rgba(16,185,129,0.14)', border: '2px solid #10b981', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem', textAlign: 'center' }}>
                  <h3 className="title-font" style={{ color: '#10b981', fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Sparkles size={22} /> VERDICT DE LA NUIT : Aucune victime ce matin !
                  </h3>
                </div>
              );
            })()}

            {salonData.cible_corbeau && (
              <div style={{ background: 'rgba(71,85,105,0.25)', border: '1px solid #64748b', padding: '10px 14px', borderRadius: '10px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                <Bird size={18} style={{ color: '#94a3b8' }} />
                <span>Le Corbeau a désigné <strong>{salonData.cible_corbeau}</strong> : il/elle commence le vote avec <strong>2 voix contre lui/elle</strong>.</span>
              </div>
            )}

            {salonData.illusion_active && (
              <div style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid #8b5cf6', color: '#c4b5fd', padding: '10px 14px', borderRadius: '10px', marginBottom: '1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} /> L'Illusionniste a activé secrètement son pouvoir pour ce vote !
              </div>
            )}

            {!(salonData.la_liste_accuses?.length > 0) ? (
              <div style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
                <h4 className="title-font" style={{ marginBottom: '10px', color: 'var(--text-color)' }}>
                  Désigner les joueurs accusés au vote :
                </h4>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem', maxHeight: '280px', overflowY: 'auto' }}>
                  {alivePlayers.map(j => {
                    const isSel = accusesMJ.includes(j.nom);
                    return (
                      <li
                        key={j.id}
                        onClick={() => setAccusesMJ(prev => isSel ? prev.filter(n => n !== j.nom) : [...prev, j.nom])}
                        style={{
                          padding: '10px 14px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          background: isSel ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                          color: isSel ? '#fff' : 'var(--text-color)',
                          border: isSel ? '1px solid var(--primary)' : '1px solid var(--card-border)',
                          fontWeight: isSel ? 'bold' : 'normal',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <CheckCircle2 size={16} style={{ opacity: isSel ? 1 : 0.25 }} />
                        <span>{j.nom}</span>
                      </li>
                    );
                  })}
                </ul>
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <button
                    onClick={() => setAccusesMJ(alivePlayers.map(j => j.nom))}
                    className="btn-secondary text-font"
                    style={{ width: '100%' }}
                  >
                    <Megaphone size={16} /> Accuser tous les survivants
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
                  >
                    <Unlock size={18} /> Ouvrir le vote sur les smartphones ({accusesMJ.length} accusés)
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 className="title-font" style={{ color: 'var(--text-color)', margin: 0 }}>Urne en temps réel :</h4>
                    <span
                      className="text-font"
                      style={{ fontSize: '0.82rem', color: nbVotesDeposes === eligibleVoters.length ? '#10b981' : 'var(--text-muted)', background: 'rgba(255,255,255,0.08)', padding: '4px 10px', borderRadius: '1rem', fontWeight: 'bold' }}
                    >
                      {nbVotesDeposes}/{eligibleVoters.length} votes déposés
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

                {/* Chat de défense des accusés */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <AccusedDefenseChat
                    roomId={roomId}
                    salonData={salonData}
                    senderName="Maître du Jeu"
                    isMj={true}
                  />
                </div>

                {chasseurActif ? (
                  <button disabled className="btn-secondary title-font" style={{ width: '100%', padding: '15px' }}>
                    <Hourglass size={18} /> En attente du tir de vengeance du Chasseur ({chasseurActif.nom})...
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button
                      onClick={handleApplyDaySentence}
                      className="btn-primary title-font glow-button"
                      style={{ background: '#ef4444' }}
                    >
                      <Gavel size={20} /> Clôturer le Vote et Appliquer la Sentence
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Passer à la nuit sans éliminer personne ?")) return;
                        try {
                          await updateDoc(doc(db, 'salons', roomId), {
                            statut: 'jour_resolution', condamne_jour: 'Personne (Grâce du village)',
                          });
                        } catch (e) { console.error(e); }
                      }}
                      className="btn-secondary text-font"
                      style={{ width: '100%' }}
                    >
                      Ignorer le vote (Aucun éliminé)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* FIN DE PARTIE */}
        {(isPhase('fin_village') || isPhase('fin_loups') || isPhase('fin_ange')) && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: isPhase('fin_village') ? 'rgba(16,185,129,0.15)' : isPhase('fin_ange') ? 'rgba(251,191,36,0.15)' : 'rgba(239,68,68,0.15)', marginBottom: '1rem' }}>
              <Trophy size={44} style={{ color: isPhase('fin_village') ? '#10b981' : isPhase('fin_ange') ? '#fbbf24' : '#ef4444' }} />
            </div>
            <h1 className="title-font glow-text" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', margin: '0 0 0.75rem', color: isPhase('fin_village') ? '#10b981' : isPhase('fin_ange') ? '#fbbf24' : '#ef4444' }}>
              {isPhase('fin_village')
                ? 'VICTOIRE DU VILLAGE !'
                : isPhase('fin_ange')
                  ? "VICTOIRE SOLITAIRE DE L'ANGE !"
                  : 'VICTOIRE DES LOUPS-GAROUS !'}
            </h1>
            <p className="text-font" style={{ fontSize: '1.1rem', color: 'var(--text-color)' }}>
              {isPhase('fin_village')
                ? 'Tous les Loups-Garous ont été démasqués et éliminés !'
                : isPhase('fin_ange')
                  ? "L'Ange a réussi à se faire condamner lors du tout premier vote du village !"
                  : 'La meute a pris le contrôle du village !'}
            </p>
          </div>
        )}

        {/* JOUR RÉSOLUTION */}
        {isPhase('jour_resolution') && (
          <div>
            <h3 className="title-font" style={{ color: 'var(--success)', marginBottom: '1.25rem', fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={22} /> Verdict du village : {salonData.condamne_jour}
            </h3>
            {chasseurActif ? (
              <button disabled className="btn-secondary title-font" style={{ width: '100%', padding: '15px' }}>
                <Hourglass size={18} /> En attente du tir de vengeance du Chasseur ({chasseurActif.nom})...
              </button>
            ) : (
              <button
                onClick={handleNextNight}
                className="btn-primary title-font glow-button"
                style={{ background: '#1d4ed8' }}
              >
                <Moon size={20} /> Lancer la Nuit Suivante <ChevronRight size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── PANNEAU IA : SIMULATEUR & JOUEURS BOTS ────────────────────────── */}
      <AiTestPanel roomId={roomId} salonData={salonData} joueurs={joueurs} />

      {/* ── GRILLE BASSE : QR Code / Guide + Tableau des joueurs ─────────── */}
      <div className="mj-main-grid" style={{ marginTop: '1.75rem' }}>
        {/* QR Code (avant lancement) */}
        {!isGameRunning && joueurs.length < salonData.roles_selectionnes.length && (
          <div className="qr-panel glass-panel" style={{ padding: '1.5rem', borderRadius: '1.25rem', textAlign: 'center' }}>
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-color)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              <LinkIcon size={20} style={{ color: 'var(--primary)' }} /> Rejoindre la partie
            </h2>
            <p className="text-font text-muted" style={{ fontSize: '0.9rem' }}>
              Scannez ce QR Code avec les smartphones ({joueurs.length}/{salonData.roles_selectionnes.length} inscrits).
            </p>
            <div className="qr-wrapper">
              <QRCodeSVG value={getPlayerUrl()} size={190} bgColor="#ffffff" fgColor="#000000" level="H" includeMargin={false} />
            </div>
            <div className="qr-url text-font">
              {getPlayerUrl()}
            </div>
          </div>
        )}

        {/* Guide MJ (partie en cours) */}
        {isGameRunning && (
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', borderRadius: '1.25rem' }}>
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)', marginBottom: '0.75rem', fontSize: '1.15rem' }}>
              <Info size={20} style={{ color: 'var(--primary)' }} /> Guide d'animation (Table & Distance)
            </h2>
            <div className="text-font text-muted" style={{ lineHeight: 1.6, fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ background: 'var(--input-bg)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--primary)' }}>
                <strong style={{ color: 'var(--text-color)' }}>Partie autour d'une table (Yeux fermés) :</strong> Cliquez sur n'importe quel badge de rôle dans la liste des joueurs pour afficher sa fiche et lire à voix haute le script exact d'appel nocturne.
              </div>
              <div style={{ background: 'var(--input-bg)', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid #22c55e' }}>
                <strong style={{ color: 'var(--text-color)' }}>Partie à distance sur smartphone :</strong> Les rôles automatisés agissent directement sur leur téléphone. Utilisez le bouton <em>Séquence Suivante</em> pour faire défiler la nuit.
              </div>
            </div>
          </div>
        )}

        {/* Messagerie du Maître du Jeu (Vers Tous ou un joueur en particulier) */}
        <MjMessengerPanel
          roomId={roomId}
          salonData={salonData}
          joueurs={joueurs}
        />

        {/* Tableau des joueurs */}
        <div
          className="players-table-panel glass-panel"
          style={{ padding: '1.5rem', borderRadius: '1.25rem', gridColumn: '1 / -1' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)', margin: 0, fontSize: '1.2rem' }}>
              <Users size={20} style={{ color: 'var(--primary)' }} /> Joueurs ({joueurs.filter(j => j.statut_joueur !== 'mort').length} en vie / {joueurs.length} total)
            </h2>
            {(salonData.statut === 'en_attente' || salonData.statut === 'SETUP') && (
              <select
                onChange={async (e) => {
                  if (!e.target.value) return;
                  try {
                    const newRoles = [...salonData.roles_selectionnes, e.target.value];
                    await updateDoc(doc(db, 'salons', roomId), {
                      roles_selectionnes: newRoles,
                      roles_melanges: shuffleArray(newRoles),
                    });
                    e.target.value = "";
                  } catch (error) { console.error(error); }
                }}
                className="btn-secondary text-font"
                style={{ padding: '8px 12px', fontSize: '0.85rem', borderRadius: '8px', border: '1px solid var(--primary)' }}
              >
                <option value="">+ Ajouter un rôle à la partie...</option>
                {rolesData.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>

          <div style={{ marginTop: '1rem', overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }} className="text-font">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <th style={{ padding: '10px 8px', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'uppercase' }}>Joueur</th>
                  <th style={{ padding: '10px 8px', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ padding: '10px 8px', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'uppercase' }}>Rôle (Cliquer pour détails)</th>
                  <th style={{ padding: '10px 8px', color: 'var(--text-muted)', fontSize: '0.82rem', textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {joueurs.map(j => {
                  const roleObj = j.role ? getRole(j.role) : null;
                  const statutColor = j.statut_joueur === 'mort'
                    ? 'var(--danger)'
                    : j.est_infecte === true
                      ? '#a78bfa'
                      : 'var(--success)';

                  const extraTags = [];
                  if (j.est_infecte) extraTags.push('Infecté');
                  if (j.enfant_devenu_loup) extraTags.push('Modèle mort → Loup');
                  if (j.choix_chien) extraTags.push(`Choix: ${j.choix_chien === 'loup' ? 'Loup' : 'Village'}`);
                  if (j.gracie_idiot) extraTags.push('Gracié (sans vote)');
                  if (Array.isArray(salonData.couple) && salonData.couple.includes(j.id)) extraTags.push('En couple');

                  return (
                    <tr key={j.id} style={{ borderBottom: '1px solid var(--card-border)', opacity: j.statut_joueur === 'mort' ? 0.55 : 1 }}>
                      <td style={{ padding: '10px 8px', fontWeight: 'bold', color: 'var(--text-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{j.nom}</span>
                          {isBot(j) && (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(6,182,212,0.18)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 'bold' }}>
                              <Bot size={11} /> IA
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <select
                          value={j.statut_joueur || 'en_vie'}
                          onChange={e => updateDoc(doc(db, 'salons', roomId, 'joueurs', j.id), { statut_joueur: e.target.value })}
                          style={{ background: 'var(--input-bg)', color: statutColor, border: '1px solid var(--card-border)', borderRadius: '6px', padding: '5px 8px', fontWeight: 'bold', fontSize: '0.82rem' }}
                        >
                          <option value="en_vie">En vie</option>
                          <option value="mort">Mort</option>
                          <option value="infecte">Infecté</option>
                          <option value="En couple">En couple</option>
                        </select>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {salonData.statut === 'en_attente' && salonData.distribution_mode === 'manuelle' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <select
                              value={j.role || ''}
                              onChange={e => assignRoleManually(j.id, e.target.value)}
                              style={{ background: 'var(--input-bg)', color: 'var(--text-color)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--card-border)', fontSize: '0.85rem' }}
                            >
                              <option value="">Sélectionner...</option>
                              {rolesData
                                .filter(r => (salonData.roles_selectionnes || []).includes(r.id))
                                .map(r => <option key={r.id} value={r.id}>{r.name}</option>)
                              }
                            </select>
                            {roleObj && (
                              <RoleChip
                                roleObj={roleObj}
                                onSelectRole={r => setInspectRole(r)}
                                suffix={extraTags.length > 0 ? `(${extraTags.join(', ')})` : undefined}
                              />
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {roleObj ? (
                              <RoleChip
                                roleObj={roleObj}
                                onSelectRole={r => setInspectRole(r)}
                                suffix={extraTags.length > 0 ? `(${extraTags.join(', ')})` : undefined}
                              />
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                En attente de tirage...
                              </span>
                            )}

                            {/* Sélecteur pour proposer un changement de rôle en cours de partie */}
                            <select
                              value=""
                              onChange={e => {
                                if (!e.target.value) return;
                                proposeRoleChange(j, e.target.value);
                                e.target.value = '';
                              }}
                              style={{
                                background: 'var(--input-bg)',
                                color: 'var(--text-muted)',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px dashed var(--card-border)',
                                fontSize: '0.76rem',
                                cursor: 'pointer',
                              }}
                              title="Proposer un nouveau rôle à ce joueur (il devra accepter ou refuser sur son écran)"
                            >
                              <option value="">Changer son rôle...</option>
                              {rolesData.map(r => (
                                <option key={r.id} value={r.id} disabled={r.id === j.role}>
                                  {r.name}
                                </option>
                              ))}
                            </select>

                            {/* Indicateur si une proposition est en attente d'acceptation */}
                            {j.proposition_role?.roleId && (() => {
                              const propObj = getRole(j.proposition_role.roleId);
                              return (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    borderRadius: '1rem',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    background: 'rgba(245, 158, 11, 0.16)',
                                    border: '1px solid rgba(245, 158, 11, 0.45)',
                                    color: '#fbbf24',
                                  }}
                                >
                                  <Hourglass size={11} />
                                  <span>En attente : {propObj?.name || j.proposition_role.roleId}</span>
                                  <button
                                    type="button"
                                    onClick={() => cancelRoleProposal(j)}
                                    title="Annuler la proposition"
                                    style={{ background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', display: 'inline-flex', padding: '1px' }}
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleRemovePlayer(j)}
                          title={`Supprimer ${j.nom} du salon`}
                          style={{
                            background: 'rgba(239, 68, 68, 0.12)',
                            border: '1px solid rgba(239, 68, 68, 0.45)',
                            color: '#ef4444',
                            borderRadius: '0.55rem',
                            padding: '0.4rem 0.65rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Retirer</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modals Guide & Fiche pour le MJ */}
      <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
      <GrimoireModal
        isOpen={showGrimoire}
        onClose={() => setShowGrimoire(false)}
        onSelectRole={role => setInspectRole(role)}
        activeRoleIds={activeRoleIds}
      />
    </div>
  );
}
