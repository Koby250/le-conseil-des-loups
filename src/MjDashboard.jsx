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
  RoleDetailsModal, GrimoireModal, AutomationBadge, PhaseTimer,
} from './RoleComponents';
import {
  WolfPackChat, AccusationsChat, AccusedDefenseChat, MjMessengerPanel,
} from './GameChats';
import AiTestPanel from './AiTestPanel';
import { isBot, reconcileCardAndRoleDuplicates } from './aiBotEngine';
import { useAutoMj, checkGameEnd } from './autoMjEngine';
import {
  Users, RefreshCw, Eye, Settings, Play,
  Link as LinkIcon, Info, ChevronRight, Bell,
  BookOpen, Plus, Minus, Dices, PenLine, Trash2,
  Shield, ShieldCheck, PawPrint, Skull, Sun, Moon,
  Heart, VenetianMask, FlaskConical, Gavel, Trophy,
  CheckCircle2, AlertTriangle, Hourglass, Megaphone,
  Lock, Unlock, Sparkles, Sword, Bird, X, Bot, User, MoveHorizontal,
  RotateCcw, Edit3, Clock, Drama,
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
  if (alive.some(j => j.role === 'loup-blanc'))
    phases.push('nuit_loup_blanc');
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
  nuit_cupidon:    { label: 'Cupidon',       roleId: 'cupidon' },
  nuit_voleur:     { label: 'Voleur',        roleId: 'voleur' },
  nuit_salvateur:  { label: 'Salvateur',     roleId: 'salvateur' },
  nuit_voyante:    { label: 'Voyante',       roleId: 'voyante' },
  nuit_loups:      { label: 'Loups-Garous',  roleId: 'loup-garou' },
  nuit_loup_blanc: { label: 'Loup Blanc',    roleId: 'loup-blanc' },
  nuit_sorciere:   { label: 'Sorcière',      roleId: 'sorciere' },
};

/**
 * Modal de réglage des durées et du rythme de jeu par le Maître du Jeu.
 */
function GameTimeSettingsModal({ isOpen, onClose, roomId, salonData }) {
  const [dureeNuitPhase, setDureeNuitPhase]   = useState(salonData?.duree_nuit_phase ?? 18);
  const [dureeMatin, setDureeMatin]           = useState(salonData?.duree_matin ?? 14);
  const [dureeAccusation, setDureeAccusation] = useState(salonData?.duree_accusation ?? 60);
  const [dureeDefense, setDureeDefense]       = useState(salonData?.duree_defense ?? 60);
  const [dureeVote, setDureeVote]             = useState(salonData?.duree_vote ?? 60);

  useEffect(() => {
    if (salonData) {
      if (salonData.duree_nuit_phase !== undefined) setDureeNuitPhase(salonData.duree_nuit_phase);
      if (salonData.duree_matin !== undefined)      setDureeMatin(salonData.duree_matin);
      if (salonData.duree_accusation !== undefined) setDureeAccusation(salonData.duree_accusation);
      if (salonData.duree_defense !== undefined)    setDureeDefense(salonData.duree_defense);
      if (salonData.duree_vote !== undefined)       setDureeVote(salonData.duree_vote);
    }
  }, [salonData?.duree_nuit_phase, salonData?.duree_matin, salonData?.duree_accusation, salonData?.duree_defense, salonData?.duree_vote]);

  if (!isOpen) return null;

  const presetsDay = [30, 45, 60, 90, 120, 180];
  const presetsNight = [12, 16, 18, 24, 30];
  const presetsMatin = [8, 12, 14, 20];

  const handleSave = async () => {
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        duree_nuit_phase: Number(dureeNuitPhase) || 18,
        duree_matin:      Number(dureeMatin) || 14,
        duree_accusation: Number(dureeAccusation) || 60,
        duree_defense:    Number(dureeDefense) || 60,
        duree_vote:       Number(dureeVote) || 60,
      });
      onClose();
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la sauvegarde des durées.');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '1rem', padding: '1.5rem', background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.75rem' }}>
          <h3 className="title-font" style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={20} style={{ color: 'var(--primary)' }} />
            Paramètres des Temps & Rythme de Jeu
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p className="text-font text-muted" style={{ fontSize: '0.86rem', marginBottom: '1.25rem' }}>
          Ajustez le tempo de la partie pour laisser aux joueurs le temps de comprendre les événements et de délibérer sans précipitation.
        </p>

        {/* 1. Rythme de la nuit */}
        <div style={{ marginBottom: '1.15rem', padding: '10px 12px', background: 'rgba(30,58,138,0.18)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.88rem', fontWeight: 700 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#93c5fd' }}>
              <Moon size={15} /> Durée par appel de nuit (Voyante, Loups, etc.) :
            </span>
            <span style={{ color: '#60a5fa' }}>{dureeNuitPhase}s</span>
          </div>
          <p className="text-font text-muted" style={{ fontSize: '0.76rem', margin: '0 0 8px' }}>
            Temps alloué à chaque rôle nocturne pour se réveiller, agir et se rendormir dans le calme.
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presetsNight.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDureeNuitPhase(s)}
                className="text-font"
                style={{
                  padding: '4px 9px',
                  borderRadius: '14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dureeNuitPhase === s ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                  color: dureeNuitPhase === s ? '#fff' : 'var(--text-color)',
                  border: dureeNuitPhase === s ? '1px solid #3b82f6' : '1px solid var(--card-border)',
                }}
              >
                {s}s {s === 18 ? '(défaut)' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Pause du matin */}
        <div style={{ marginBottom: '1.15rem', padding: '10px 12px', background: 'rgba(245,158,11,0.12)', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.88rem', fontWeight: 700 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24' }}>
              <Sun size={15} /> Bilan au lever du soleil (Matin) :
            </span>
            <span style={{ color: '#f59e0b' }}>{dureeMatin}s</span>
          </div>
          <p className="text-font text-muted" style={{ fontSize: '0.76rem', margin: '0 0 8px' }}>
            Temps de pause solennelle au réveil du village pour découvrir les victimes de la nuit et leurs rôles.
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presetsMatin.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDureeMatin(s)}
                className="text-font"
                style={{
                  padding: '4px 9px',
                  borderRadius: '14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dureeMatin === s ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                  color: dureeMatin === s ? '#0f172a' : 'var(--text-color)',
                  border: dureeMatin === s ? '1px solid #f59e0b' : '1px solid var(--card-border)',
                }}
              >
                {s}s {s === 14 ? '(défaut)' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Accusations */}
        <div style={{ marginBottom: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
            <span>Temps d'Accusations :</span>
            <span style={{ color: 'var(--primary)' }}>{dureeAccusation} secondes</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presetsDay.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDureeAccusation(s)}
                className="text-font"
                style={{
                  padding: '5px 10px',
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dureeAccusation === s ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                  color: dureeAccusation === s ? '#fff' : 'var(--text-color)',
                  border: dureeAccusation === s ? '1px solid var(--primary)' : '1px solid var(--card-border)',
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        {/* 4. Défenses */}
        <div style={{ marginBottom: '1.15rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
            <span>Temps de Défense des Accusés :</span>
            <span style={{ color: '#8b5cf6' }}>{dureeDefense} secondes</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presetsDay.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDureeDefense(s)}
                className="text-font"
                style={{
                  padding: '5px 10px',
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dureeDefense === s ? '#8b5cf6' : 'rgba(255,255,255,0.06)',
                  color: dureeDefense === s ? '#fff' : 'var(--text-color)',
                  border: dureeDefense === s ? '1px solid #8b5cf6' : '1px solid var(--card-border)',
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        {/* 5. Vote d'élimination */}
        <div style={{ marginBottom: '1.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
            <span>Temps de Vote d'Élimination :</span>
            <span style={{ color: '#ef4444' }}>{dureeVote} secondes</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {presetsDay.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDureeVote(s)}
                className="text-font"
                style={{
                  padding: '5px 10px',
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dureeVote === s ? '#ef4444' : 'rgba(255,255,255,0.06)',
                  color: dureeVote === s ? '#fff' : 'var(--text-color)',
                  border: dureeVote === s ? '1px solid #ef4444' : '1px solid var(--card-border)',
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn-secondary text-font" style={{ padding: '8px 16px' }}>
            Annuler
          </button>
          <button type="button" onClick={handleSave} className="btn-primary title-font glow-button" style={{ padding: '8px 20px' }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [inspectRole, setInspectRole]       = useState(null);
  const [showGrimoire, setShowGrimoire]     = useState(false);
  const [showTimeSettings, setShowTimeSettings] = useState(false);

  const activeRoleIds = salonData?.roles_selectionnes || selectedRoles || [];

  // ── Boucle de Maître du Jeu Automatisé ────────────────────────────────────
  useAutoMj(roomId, salonData, joueurs);

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
    const nonPlayStates = ['SETUP', 'en_attente', 'fin_village', 'fin_loups', 'fin_ange', 'fin_loup_blanc'];
    if (nonPlayStates.includes(salonData.statut)) return;

    const gameEnd = checkGameEnd(joueurs);
    if (gameEnd) {
      updateDoc(doc(db, 'salons', roomId), { statut: gameEnd }).catch(console.error);
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

  // ── Garde d'intégrité anti-doublon des cartes et rôles en salle d'attente ──
  useEffect(() => {
    if (!roomId || salonData?.statut !== 'en_attente' || joueurs.length === 0) return;
    const timer = setTimeout(() => {
      reconcileCardAndRoleDuplicates(roomId, salonData, joueurs).catch(console.error);
    }, 350);
    return () => clearTimeout(timer);
  }, [roomId, salonData, joueurs]);

  // ── Ouverture du salon ────────────────────────────────────────────────────
  const handleOpenSalon = async () => {
    if (selectedRoles.length < 3)
      return alert('Veuillez sélectionner au moins 3 rôles.');
    if (hasComedien && comedienRoles.length !== 3)
      return alert('Le Comédien nécessite 3 rôles supplémentaires.');

    setIsGenerating(true);
    try {
      const shuffled = shuffleArray([...selectedRoles]);
      const batch = writeBatch(db);
      batch.set(doc(db, 'salons', roomId), {
        code: roomId,
        statut: 'en_attente',
        distribution_mode: distributionMode,
        roles_selectionnes: selectedRoles,
        roles_dispo_comedien: comedienRoles,
        roles_dispo_comedien_init: comedienRoles,
        roles_melanges: shuffled,
        cartes_prises: {},
        couple: [],
        numero_jour: 1,
        // ── Champs nuit ──
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        victime_loup_blanc: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,
        cible_corbeau: null,
        illusion_active: false,
        infection_active: false,
        malediction_ancien_active: false,
        // ── Champs jour ──
        la_liste_accuses: [],
        votes: {},
        // ── Durées paramétrables des phases (secondes) ──
        duree_nuit_phase: 18,
        duree_matin: 14,
        duree_accusation: 60,
        duree_defense: 60,
        duree_vote: 60,
        // ── Chats & Messagerie ──
        chat_loups: [],
        chat_accusation: [],
        chat_defense: [],
        messages_mj: [],
        // ── Divers ──
        notifications_mj: [],
        notif_mj: null,
        morts_nuit: null,
        condamne_jour: null,
      });

      // Réinitialiser proprement tout joueur déjà présent dans le salon pour éviter tout rôle résiduel
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
          flair_nuit_utilise: false,
          dernier_flair_nuit: null,
          dernier_flair_resultat: null,
          pouvoirs_perdus_ancien: false,
          ancien_role: null,
          proposition_role: null,
          conflit_carte_msg: null,
        });
      });

      await batch.commit();
    } catch (err) {
      console.error(err);
      alert('Erreur de création du salon.');
    } finally {
      setIsGenerating(false);
    }
  };

  const assignRoleManually = async (joueurId, roleId) => {
    try {
      if (roleId) {
        const maxQuota = (salonData?.roles_selectionnes || []).filter(r => r === roleId).length;
        const usedByOthers = joueurs.filter(j => j.id !== joueurId && j.role === roleId).length;
        if (usedByOthers >= maxQuota) {
          const rName = getRole(roleId)?.name || roleId;
          return alert(`Le rôle "${rName}" est limité à ${maxQuota} exemplaire(s) dans votre configuration et est déjà attribué.`);
        }
      }
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueurId), {
        role: roleId,
        carte_choisie: roleId ? 999 : null,
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

  // ── Ajout dynamique d'un joueur (sans remélanger les cartes déjà tirées) ────
  const handleAddPlayer = async () => {
    try {
      const newRoles = [...(salonData.roles_selectionnes || []), 'villageois'];
      const newMelanges = [...(salonData.roles_melanges || []), 'villageois'];
      await updateDoc(doc(db, 'salons', roomId), {
        roles_selectionnes: newRoles,
        roles_melanges: newMelanges,
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
    // 1. Vérifier et corriger tout doublon de carte ou de rôle avant de lancer
    const hadDuplicates = await reconcileCardAndRoleDuplicates(roomId, salonData, joueurs);
    if (hadDuplicates) {
      return alert(
        'Un doublon de carte ou de rôle (tirage simultané) a été détecté et corrigé automatiquement ! ' +
        'Veuillez vérifier que tous les joueurs ont bien tiré leur nouvelle carte avant de lancer la partie.'
      );
    }

    if (salonData.distribution_mode === 'manuelle') {
      const allAssigned = joueurs.every(j => j.role && j.role !== '');
      if (!allAssigned)
        return alert('Tous les joueurs doivent avoir un rôle assigné en mode manuel.');
    } else {
      const cartesChoisies = joueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== undefined);
      if (cartesChoisies.length !== salonData.roles_selectionnes.length) {
        if (!window.confirm(
          `Seulement ${cartesChoisies.length} joueurs ont choisi une carte sur ` +
          `${salonData.roles_selectionnes.length}. Lancer quand même ?`
        )) return;
      }
    }

    // 2. Vérification stricte des quotas configurés dans `roles_selectionnes`
    const targetCounts = {};
    (salonData.roles_selectionnes || []).forEach(r => { targetCounts[r] = (targetCounts[r] || 0) + 1; });
    const actualCounts = {};
    for (const j of joueurs) {
      if (!j.role) continue;
      actualCounts[j.role] = (actualCounts[j.role] || 0) + 1;
      if (actualCounts[j.role] > (targetCounts[j.role] || 0)) {
        const rName = getRole(j.role)?.name || j.role;
        return alert(
          `Impossible de lancer : le rôle "${rName}" est attribué ${actualCounts[j.role]} fois ` +
          `alors qu'il n'est paramétré que ${targetCounts[j.role] || 0} fois dans la configuration.`
        );
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

    if (next === 'nuit_loup_blanc') {
      const loupBlancDoc = joueurs.find(j => j.role === 'loup-blanc' && j.statut_joueur !== 'mort');
      if (loupBlancDoc) {
        updateDoc(doc(db, 'salons', roomId, 'joueurs', loupBlancDoc.id), {
          a_vote: false,
          a_vote_loup_blanc: false,
        }).catch(console.error);
      }
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
        let diedFromLoups     = false;
        let diedFromSorciere  = false;
        let diedFromLoupBlanc = false;
        let notifMj           = null;
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

        // ── 2b. Victime secrète du Loup-Garou Blanc ───────────────────────
        if (salonData.victime_loup_blanc) {
          const lbVictimDoc = joueurs.find(j => j.nom === salonData.victime_loup_blanc && j.statut_joueur !== 'mort' && !deadPlayerIds.has(j.id));
          if (lbVictimDoc) {
            const isProtected = lbVictimDoc.nom === salonData.joueur_protege;
            if (isProtected) {
              newNotifications.push(`La cible secrète du Loup Blanc (${lbVictimDoc.nom}) a été protégée par le Salvateur.`);
            } else {
              transaction.update(doc(db, 'salons', roomId, 'joueurs', lbVictimDoc.id), { statut_joueur: 'mort' });
              deadPlayerIds.add(lbVictimDoc.id);
              diedFromLoupBlanc = true;
            }
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
        const mortsNuitDetails = [];
        if (diedFromLoups && salonData.victime_loups) {
          const p = joueurs.find(j => j.nom === salonData.victime_loups);
          if (p) mortsNuitDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: 'Dévoré par les Loups-Garous', est_infecte: !!p.est_infecte });
        }
        if (diedFromLoupBlanc && salonData.victime_loup_blanc) {
          const p = joueurs.find(j => j.nom === salonData.victime_loup_blanc);
          if (p) mortsNuitDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: 'Égorgé en secret par le Loup-Garou Blanc', est_infecte: !!p.est_infecte });
        }
        if (diedFromSorciere && salonData.victime_sorciere) {
          const p = joueurs.find(j => j.nom === salonData.victime_sorciere);
          if (p) mortsNuitDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: 'Empoisonné par la Sorcière', est_infecte: !!p.est_infecte });
        }
        if (salonData.morts_nuit?.venin) {
          const p = joueurs.find(j => j.nom === salonData.morts_nuit.venin);
          if (p) mortsNuitDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: "Empoisonné par l'Épée Rouillée", est_infecte: !!p.est_infecte });
        }
        if (chagrinNom) {
          const p = joueurs.find(j => j.nom === chagrinNom);
          if (p) mortsNuitDetails.push({ id: p.id, nom: p.nom, role: p.role, raison: "Mort de chagrin d'amour", est_infecte: !!p.est_infecte });
        }

        const salonUpdates = {
          statut: 'jour_accusation',
          morts_nuit: {
            loups:      diedFromLoups      ? salonData.victime_loups      : null,
            sorciere:   diedFromSorciere   ? salonData.victime_sorciere   : null,
            loup_blanc: diedFromLoupBlanc  ? salonData.victime_loup_blanc : null,
            venin:      salonData.morts_nuit?.venin || null,
            chagrin:    chagrinNom,
          },
          morts_nuit_details: mortsNuitDetails,
          infection_active: false,
          notif_mj: notifMj,
          la_liste_accuses: [],
          votes: {},
          chat_defense: [],
          phase_started_at: Date.now(),
          auto_mj_phase_started_at: Date.now(),
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
   * Ouverture manuelle immédiate des accusations depuis le matin.
   */
  const handleOpenAccusations = async () => {
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        statut: 'jour_accusation',
        la_liste_accuses: [],
        chat_accusation: [],
        votes: {},
        phase_started_at: Date.now(),
        auto_mj_phase_started_at: Date.now(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Clôture des accusations et passage aux défenses (ou direct sentence si aucun accusé).
   */
  const handleCloseAccusationsAndStartDefense = async () => {
    const votesRaw = salonData.votes || {};
    const accusesCount = {};

    if (salonData.cible_corbeau) {
      const cibleCorbeauAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
      if (cibleCorbeauAlive) {
        accusesCount[salonData.cible_corbeau] = (accusesCount[salonData.cible_corbeau] || 0) + 2;
      }
    }

    Object.entries(votesRaw).forEach(([votant, cible]) => {
      const votantPlayer = joueurs.find(j => j.nom === votant);
      if (votantPlayer && votantPlayer.statut_joueur !== 'mort' && !votantPlayer.gracie_idiot && cible) {
        const targets = Array.isArray(cible) ? cible : [cible];
        targets.forEach(t => {
          if (t && t !== 'Personne') {
            accusesCount[t] = (accusesCount[t] || 0) + 1;
          }
        });
      }
    });

    let finalAccuses = Object.keys(accusesCount).filter(nom => accusesCount[nom] > 0);
    if (accusesMJ.length > 0) {
      finalAccuses = [...new Set([...finalAccuses, ...accusesMJ])];
    }

    if (finalAccuses.length === 0) {
      if (!window.confirm("Aucun habitant n'a été accusé par le village. Passer à la nuit sans aucun éliminé ?")) return;
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution',
          condamne_jour: 'Personne (Aucun accusé)',
          verdict_details: {
            type: 'personne',
            raison: "Le village a choisi de n'accuser personne aujourd'hui. Aucun habitant n'est éliminé.",
            timestamp: Date.now(),
          },
          phase_started_at: Date.now(),
          auto_mj_phase_started_at: Date.now(),
        });
      } catch (e) { console.error(e); }
      return;
    }

    try {
      await updateDoc(doc(db, 'salons', roomId), {
        statut: 'jour_defense',
        la_liste_accuses: finalAccuses,
        votes: {},
        chat_defense: [],
        phase_started_at: Date.now(),
        auto_mj_phase_started_at: Date.now(),
      });
      setAccusesMJ([]);
    } catch (e) { console.error(e); }
  };

  /**
   * Clôture des défenses et ouverture du vote d'élimination parmi les accusés.
   */
  const handleCloseDefenseAndStartVote = async () => {
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        statut: 'jour_vote',
        votes: {},
        phase_started_at: Date.now(),
        auto_mj_phase_started_at: Date.now(),
      });
    } catch (e) { console.error(e); }
  };

  /**
   * Résolution du vote d'élimination du jour.
   */
  const handleApplyDaySentence = async () => {
    const votesRaw   = salonData.votes || {};
    const votesCount = {};

    // Seuls les accusés et 'Personne' sont éligibles
    const allowedCandidates = Array.isArray(salonData.la_liste_accuses) && salonData.la_liste_accuses.length > 0
      ? new Set([...salonData.la_liste_accuses, 'Personne'])
      : null;

    // Pénalité du Corbeau (+2 voix d'office si parmi les accusés)
    if (salonData.cible_corbeau && (!allowedCandidates || allowedCandidates.has(salonData.cible_corbeau))) {
      const cibleCorbeauAlive = joueurs.find(j => j.nom === salonData.cible_corbeau && j.statut_joueur !== 'mort');
      if (cibleCorbeauAlive) {
        votesCount[salonData.cible_corbeau] = (votesCount[salonData.cible_corbeau] || 0) + 2;
      }
    }

    // N'agréger que les votes des joueurs encore en vie et ayant le droit de vote
    Object.entries(votesRaw).forEach(([votant, cible]) => {
      const votantPlayer = joueurs.find(j => j.nom === votant);
      if (votantPlayer && votantPlayer.statut_joueur !== 'mort' && !votantPlayer.gracie_idiot && cible) {
        const targets = Array.isArray(cible) ? cible : [cible];
        targets.forEach(t => {
          if (t && (!allowedCandidates || allowedCandidates.has(t))) {
            votesCount[t] = (votesCount[t] || 0) + 1;
          }
        });
      }
    });

    if (Object.keys(votesCount).length === 0) {
      alert("Aucun vote n'a été enregistré. Le village a décidé de ne tuer personne.");
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution',
          condamne_jour: 'Personne (Vote ignoré)',
          verdict_details: {
            type: 'personne',
            raison: "Aucun vote n'a été enregistré. Le village a décidé de ne tuer personne.",
            timestamp: Date.now(),
          },
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
            statut: 'jour_resolution',
            condamne_jour: 'Personne (Égalité)',
            verdict_details: {
              type: 'personne',
              raison: "Égalité des votes et aucun Bouc Émissaire en vie : personne n'est éliminé.",
              timestamp: Date.now(),
            },
          });
        } catch (e) { console.error(e); }
        return;
      }
    } else if (condamneNom === 'Personne' || !condamneNom) {
      alert("Le village a choisi de n'accuser personne. Le bûcher reste éteint.");
      try {
        await updateDoc(doc(db, 'salons', roomId), {
          statut: 'jour_resolution',
          condamne_jour: 'Personne (Grâce du village)',
          verdict_details: {
            type: 'personne',
            raison: "Le village a choisi de n'accuser personne : aucun habitant n'est éliminé.",
            timestamp: Date.now(),
          },
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
        const victimesVerdict = [{
          id: condamne.id,
          nom: condamne.nom,
          role: condamne.role,
          raison: condamne.role === 'bouc-emissaire'
            ? 'Sacrifié suite à une égalité des votes (Bouc Émissaire)'
            : 'Condamné par le vote du bûcher',
          est_infecte: !!condamne.est_infecte,
        }];

        // Cascade amoureux
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

        // Malédiction de l'Ancien : s'il est exécuté par le vote du village
        const ancienDiedByVote = victimesVerdict.some(v => v.role === 'ancien');
        if (ancienDiedByVote) {
          notifs.push("Malédiction de l'Ancien : Le village a voté contre son patriarche ! Tous les villageois à pouvoirs perdent leurs dons et redeviennent de Simples Villageois.");
          joueurs.forEach(j => {
            // Les loups, les infectés, le chasseur et les simples villageois ne sont pas transformés
            if (
              !deadIds.has(j.id) &&
              !isWolf(j) &&
              j.role !== 'chasseur' &&
              j.role !== 'villageois'
            ) {
              batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
                ancien_role: j.ancien_role || j.role,
                role: 'villageois',
                pouvoirs_perdus_ancien: true,
                pouvoir_utilise: true,
                pouvoir_renard_perdu: true,
                flair_nuit_utilise: true,
                potion_vie_utilisee: true,
                potion_mort_utilisee: true,
                illusion_dispo: false,
                gracie_idiot: true,
              });
            }
          });
        }

        const salonUpd = {
          statut: 'jour_resolution',
          condamne_jour: condamneLabel,
          malediction_ancien_active: Boolean(ancienDiedByVote || salonData.malediction_ancien_active),
          verdict_details: {
            type: 'condamnation',
            victimes: victimesVerdict,
            malediction_ancien: Boolean(ancienDiedByVote),
            timestamp: Date.now(),
          },
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
        victime_loup_blanc: null,
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
        chat_accusation: [],
        chat_defense: [],
        notif_mj: null,
        notifications_mj: veninNotif ? [veninNotif] : [],
        venin_chevalier_actif: false,
      });

      joueurs.forEach(j => {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          a_vote: false,
          a_vote_sorciere: false,
          a_vote_loup_blanc: false,
          vote_jour: null,
          infection_repondu: false,
          flair_nuit_utilise: false,
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
        cartes_prises: {},
        roles_dispo_comedien: salonData.roles_dispo_comedien_init || [],
        couple: [],
        victime_loups: null,
        victime_loups_visible_sorciere: null,
        victime_sauvee: false,
        victime_sorciere: null,
        victime_loup_blanc: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        derniere_cible_salvateur: null,
        cible_corbeau: null,
        illusion_active: false,
        infection_active: false,
        malediction_ancien_active: false,
        la_liste_accuses: [],
        votes: {},
        chat_loups: [],
        chat_accusation: [],
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
          flair_nuit_utilise: false,
          dernier_flair_nuit: null,
          dernier_flair_resultat: null,
          pouvoirs_perdus_ancien: false,
          ancien_role: null,
          proposition_role: null,
          conflit_carte_msg: null,
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
    if (votantPlayer && votantPlayer.statut_joueur !== 'mort' && !votantPlayer.gracie_idiot && cible) {
      const targets = Array.isArray(cible) ? cible : [cible];
      targets.forEach(t => {
        if (t) votesCountJour[t] = (votesCountJour[t] || 0) + 1;
      });
    }
  });

  const alivePlayers   = joueurs.filter(j => j.statut_joueur !== 'mort');
  const eligibleVoters = alivePlayers.filter(j => !j.gracie_idiot);
  const nbVotesDeposes = Object.entries(salonData.votes || {}).filter(([nom, val]) => {
    const p = joueurs.find(j => j.nom === nom);
    if (!p || p.statut_joueur !== 'mort' || p.gracie_idiot) return false;
    if (Array.isArray(val)) return val.length > 0;
    return Boolean(val);
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
        <div style={{ display: 'flex', gap: '8px', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={async () => {
              const next = !salonData.mj_automatique;
              try {
                await updateDoc(doc(db, 'salons', roomId), {
                  mj_automatique: next,
                  auto_mj_phase_started_at: Date.now(),
                  auto_mj_last_tick: Date.now(),
                });
              } catch (e) { console.error(e); }
            }}
            className="btn-secondary text-font"
            style={{
              background: salonData.mj_automatique ? 'rgba(147, 51, 234, 0.22)' : 'var(--input-bg)',
              borderColor: salonData.mj_automatique ? 'var(--primary)' : 'var(--card-border)',
              color: salonData.mj_automatique ? 'var(--primary)' : 'var(--text-color)',
              fontWeight: 800,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Activer ou désactiver l'automatisation complète du Maître du Jeu"
          >
            <Bot size={17} style={{ color: salonData.mj_automatique ? 'var(--primary)' : 'var(--text-muted)' }} />
            <span>MJ Automatique : {salonData.mj_automatique ? 'ACTIF' : 'INACTIF'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.open(`/${roomId}`, '_blank')}
            className="btn-secondary text-font border-accent"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
            title="Ouvrir un onglet joueur pour participer à la partie en tant que villageois"
          >
            <User size={16} style={{ color: '#10b981' }} />
            <span>Jouer en tant que Joueur</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTimeSettings(true)}
            className="btn-secondary text-font border-accent"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
            title="Régler les durées des accusations, défenses et votes de la journée"
          >
            <Clock size={16} style={{ color: 'var(--primary)' }} />
            <span>Durées ({salonData?.duree_accusation || 60}s / {salonData?.duree_defense || 60}s / {salonData?.duree_vote || 60}s)</span>
          </button>

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

            {/* Paramètres des Durées de la Journée configurables avant le lancement */}
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--card-border)', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 className="title-font" style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={16} style={{ color: 'var(--primary)' }} />
                  Durées de la Journée
                </h4>
                <button
                  type="button"
                  onClick={() => setShowTimeSettings(true)}
                  className="btn-secondary text-font"
                  style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Edit3 size={13} /> Modifier les durées
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', fontSize: '0.82rem' }}>
                <div style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--card-border)' }}>
                  <span className="text-muted" style={{ display: 'block', fontSize: '0.72rem' }}>Accusations</span>
                  <strong style={{ color: 'var(--primary)' }}>{salonData.duree_accusation || 60}s</strong>
                </div>
                <div style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--card-border)' }}>
                  <span className="text-muted" style={{ display: 'block', fontSize: '0.72rem' }}>Défenses</span>
                  <strong style={{ color: '#8b5cf6' }}>{salonData.duree_defense || 60}s</strong>
                </div>
                <div style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--card-border)' }}>
                  <span className="text-muted" style={{ display: 'block', fontSize: '0.72rem' }}>Vote Final</span>
                  <strong style={{ color: '#ef4444' }}>{salonData.duree_vote || 60}s</strong>
                </div>
              </div>
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

        {/* NUIT LOUP BLANC */}
        {isPhase('nuit_loup_blanc') && (() => {
          const loupBlanc = joueurs.find(j => j.role === 'loup-blanc' && j.statut_joueur !== 'mort');
          return (
            <div>
              <p className="text-font" style={{ color: '#e2e8f0', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Moon size={20} /> Tour du Loup-Garou Blanc — Réveil solitaire et trahison de la meute.
              </p>
              {!loupBlanc ? (
                <p className="text-font text-muted" style={{ fontStyle: 'italic', margin: '1rem 0' }}>
                  Aucun Loup-Garou Blanc en vie.
                </p>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.06)', padding: '1rem', borderRadius: '10px', margin: '1rem 0', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <p className="text-font" style={{ margin: '0 0 6px' }}>
                    Loup Blanc actif : <strong style={{ color: '#f8fafc' }}>{loupBlanc.nom}</strong>
                  </p>
                  <p className="text-font" style={{ margin: '0 0 6px' }}>
                    Cible choisie parmi les loups : <strong style={{ color: salonData.victime_loup_blanc ? '#ef4444' : '#94a3b8' }}>{salonData.victime_loup_blanc || 'Aucune (épargne la meute)'}</strong>
                  </p>
                  <p className="text-font" style={{ margin: 0, fontWeight: 'bold', color: loupBlanc.a_vote ? '#10b981' : '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {loupBlanc.a_vote ? <CheckCircle2 size={16} /> : <Hourglass size={16} />}
                    {loupBlanc.a_vote ? 'Le Loup Blanc a validé son action secrète' : 'Le Loup Blanc est en train de choisir...'}
                  </p>
                </div>
              )}
              <button
                onClick={handleNextPhase}
                className="btn-primary title-font glow-button"
                style={{ background: '#475569' }}
              >
                Séquence Suivante <ChevronRight size={20} />
              </button>
            </div>
          );
        })()}

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
              <p className="text-font text-warning" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sun size={20} /> Le village se réveille — Bilan de la nuit avant révélation.
              </p>
              <PhaseTimer
                phaseStartedAt={salonData.phase_started_at}
                durationSec={salonData.duree_matin !== undefined ? salonData.duree_matin : 14}
                label="Ouverture des débats"
              />
            </div>

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
              onClick={salonData.morts_nuit_details ? handleOpenAccusations : handleApplyNightDeaths}
              className="btn-primary title-font glow-button"
              style={{ background: '#f59e0b' }}
            >
              {salonData.morts_nuit_details ? "Ouvrir les accusations maintenant" : "Appliquer les morts et ouvrir les débats"} <ChevronRight size={20} />
            </button>
          </div>
        )}

        {/* JOURNÉE : ACCUSATIONS, DÉFENSES ET VOTE */}
        {(isPhase('jour_accusation') || isPhase('jour_defense') || isPhase('jour_vote')) && (
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

            {/* ── PHASE 1 : ACCUSATIONS DU VILLAGE ── */}
            {isPhase('jour_accusation') && (
              <div style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 className="title-font" style={{ margin: 0, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Megaphone size={18} style={{ color: 'var(--primary)' }} />
                    Phase 1 : Accusations du Village
                  </h4>
                  <PhaseTimer
                    phaseStartedAt={salonData.phase_started_at}
                    durationSec={salonData.duree_accusation !== undefined ? salonData.duree_accusation : 60}
                    label="Chrono Accusations"
                  />
                </div>

                <p className="text-font text-muted" style={{ fontSize: '0.86rem', marginBottom: '1rem' }}>
                  Les villageois (et IA) désignent les suspects à traduire au tribunal. Les joueurs ayant reçu au moins 1 accusation passeront en phase de défense.
                </p>

                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem', maxHeight: '280px', overflowY: 'auto' }}>
                  {alivePlayers.map(j => {
                    const isSel = accusesMJ.includes(j.nom);
                    const accusationCount = Object.values(salonData.votes || {}).filter(v => Array.isArray(v) ? v.includes(j.nom) : v === j.nom).length;

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
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <CheckCircle2 size={16} style={{ opacity: isSel ? 1 : 0.25 }} />
                          <span>{j.nom}</span>
                        </div>
                        {accusationCount > 0 && (
                          <span style={{ fontSize: '0.75rem', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                            {accusationCount} accusation(s)
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/* Chat des accusations (Débats du village) */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <AccusationsChat
                    roomId={roomId}
                    salonData={salonData}
                    senderName="Maître du Jeu"
                    isMj={true}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <button
                    onClick={() => {
                      const isAll = alivePlayers.length > 0 && alivePlayers.every(j => accusesMJ.includes(j.nom));
                      setAccusesMJ(isAll ? [] : alivePlayers.map(j => j.nom));
                    }}
                    className="btn-secondary text-font"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    <Megaphone size={16} />
                    <span>
                      {alivePlayers.length > 0 && alivePlayers.every(j => accusesMJ.includes(j.nom))
                        ? "Tout désélectionner"
                        : `Accuser tout le village (${alivePlayers.length} joueurs)`}
                    </span>
                  </button>
                  <button
                    onClick={handleCloseAccusationsAndStartDefense}
                    className="btn-primary title-font glow-button"
                  >
                    <ChevronRight size={18} /> Clôturer les Accusations & Passer aux Défenses
                  </button>
                </div>
              </div>
            )}

            {/* ── PHASE 2 : DÉFENSE DES ACCUSÉS ── */}
            {isPhase('jour_defense') && (
              <div style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 className="title-font" style={{ margin: 0, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Drama size={18} style={{ color: '#8b5cf6' }} />
                    Phase 2 : Défense des Accusés
                  </h4>
                  <PhaseTimer
                    phaseStartedAt={salonData.phase_started_at}
                    durationSec={salonData.duree_defense !== undefined ? salonData.duree_defense : 60}
                    label="Chrono Défenses"
                  />
                </div>

                <p className="text-font text-muted" style={{ fontSize: '0.86rem', marginBottom: '0.85rem' }}>
                  Les accusés suivants ont la parole pour convaincre le village :
                </p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                  {salonData.la_liste_accuses?.map(nom => (
                    <span
                      key={nom}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '20px',
                        background: 'rgba(239,68,68,0.2)',
                        border: '1.5px solid #ef4444',
                        color: '#fca5a5',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <AlertTriangle size={14} /> {nom}
                    </span>
                  ))}
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    onClick={handleCloseDefenseAndStartVote}
                    className="btn-primary title-font glow-button"
                    style={{ background: '#8b5cf6' }}
                  >
                    <Gavel size={18} /> Clôturer les Défenses & Lancer le Vote Final
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Gracier les accusés et passer à la nuit sans aucun éliminé ?")) return;
                      try {
                        await updateDoc(doc(db, 'salons', roomId), {
                          statut: 'jour_resolution',
                          condamne_jour: 'Personne (Grâce du village)',
                          verdict_details: {
                            type: 'personne',
                            raison: "Le village a été convaincu par les défenses : aucun habitant n'est éliminé.",
                            timestamp: Date.now(),
                          },
                          phase_started_at: Date.now(),
                          auto_mj_phase_started_at: Date.now(),
                        });
                      } catch (e) { console.error(e); }
                    }}
                    className="btn-secondary text-font"
                    style={{ width: '100%' }}
                  >
                    Gracier les accusés (Annuler le bûcher)
                  </button>
                </div>
              </div>
            )}

            {/* ── PHASE 3 : VOTE D'ÉLIMINATION ── */}
            {isPhase('jour_vote') && (
              <div style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 className="title-font" style={{ color: 'var(--text-color)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Gavel size={18} style={{ color: '#ef4444' }} />
                    Phase 3 : Vote d'Élimination parmi les Accusés
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PhaseTimer
                      phaseStartedAt={salonData.phase_started_at}
                      durationSec={salonData.duree_vote !== undefined ? salonData.duree_vote : 60}
                      label="Chrono Vote"
                    />
                    <span
                      className="text-font"
                      style={{ fontSize: '0.82rem', color: nbVotesDeposes === eligibleVoters.length ? '#10b981' : 'var(--text-muted)', background: 'rgba(255,255,255,0.08)', padding: '4px 10px', borderRadius: '1rem', fontWeight: 'bold' }}
                    >
                      {nbVotesDeposes}/{eligibleVoters.length} votes déposés
                    </span>
                  </div>
                </div>

                <p className="text-font text-muted" style={{ fontSize: '0.86rem', marginBottom: '1rem' }}>
                  Les villageois votent pour choisir l'unique habitant à éliminer parmi les accusés ({salonData.la_liste_accuses?.join(', ')}).
                </p>

                {Object.entries(votesCountJour).length === 0 ? (
                  <p className="text-muted text-font">Aucun vote déposé pour l'instant.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.25rem' }} className="text-font">
                    {Object.entries(votesCountJour).sort((a, b) => b[1] - a[1]).map(([nom, count]) => (
                      <li key={nom} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--card-border)', color: 'var(--text-color)' }}>
                        <span>{nom === 'Personne' ? "Personne (Vote blanc / Grâce)" : nom}</span>
                        <strong style={{ color: nom === 'Personne' ? '#10b981' : '#ef4444' }}>{count} voix</strong>
                      </li>
                    ))}
                  </ul>
                )}

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
                            statut: 'jour_resolution',
                            condamne_jour: 'Personne (Grâce du village)',
                            verdict_details: {
                              type: 'personne',
                              raison: "Le Maître du Jeu a accordé la grâce du village : aucun habitant n'a été éliminé.",
                              timestamp: Date.now(),
                            },
                            phase_started_at: Date.now(),
                            auto_mj_phase_started_at: Date.now(),
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
              </div>
            )}
          </div>
        )}

        {/* FIN DE PARTIE */}
        {(isPhase('fin_village') || isPhase('fin_loups') || isPhase('fin_ange') || isPhase('fin_loup_blanc')) && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: isPhase('fin_village') ? 'rgba(16,185,129,0.15)' : isPhase('fin_ange') ? 'rgba(251,191,36,0.15)' : isPhase('fin_loup_blanc') ? 'rgba(241,245,249,0.15)' : 'rgba(239,68,68,0.15)', marginBottom: '1rem' }}>
              <Trophy size={44} style={{ color: isPhase('fin_village') ? '#10b981' : isPhase('fin_ange') ? '#fbbf24' : isPhase('fin_loup_blanc') ? '#f1f5f9' : '#ef4444' }} />
            </div>
            <h1 className="title-font glow-text" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', margin: '0 0 0.75rem', color: isPhase('fin_village') ? '#10b981' : isPhase('fin_ange') ? '#fbbf24' : isPhase('fin_loup_blanc') ? '#f1f5f9' : '#ef4444' }}>
              {isPhase('fin_village')
                ? 'VICTOIRE DU VILLAGE !'
                : isPhase('fin_ange')
                  ? "VICTOIRE SOLITAIRE DE L'ANGE !"
                  : isPhase('fin_loup_blanc')
                    ? 'VICTOIRE DU LOUP-GAROU BLANC !'
                    : 'VICTOIRE DES LOUPS-GAROUS !'}
            </h1>
            <p className="text-font" style={{ fontSize: '1.1rem', color: 'var(--text-color)' }}>
              {isPhase('fin_village')
                ? 'Tous les Loups-Garous ont été démasqués et éliminés !'
                : isPhase('fin_ange')
                  ? "L'Ange a réussi à se faire condamner lors du tout premier vote du village !"
                  : isPhase('fin_loup_blanc')
                    ? 'Le Loup-Garou Blanc a éliminé la meute et le village : il est l’unique survivant !'
                    : 'La meute a pris le contrôle du village !'}
            </p>
          </div>
        )}

        {/* JOUR RÉSOLUTION */}
        {isPhase('jour_resolution') && (() => {
          const matchedVictims = salonData.verdict_details?.victimes ||
            joueurs.filter(j => salonData.condamne_jour && salonData.condamne_jour.includes(j.nom));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <h3 className="title-font" style={{ color: 'var(--success)', marginBottom: '0.5rem', fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Gavel size={22} /> Verdict du village : {salonData.condamne_jour}
                </h3>
                {matchedVictims.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                    <span className="text-font text-muted" style={{ fontSize: '0.82rem' }}>Identité(s) révélée(s) :</span>
                    {matchedVictims.map(v => {
                      const rObj = v.role ? getRole(v.role) : null;
                      if (!rObj) return null;
                      return (
                        <RoleChip
                          key={v.id || v.nom}
                          roleObj={rObj}
                          onSelectRole={r => setInspectRole(r)}
                          suffix={v.est_infecte ? '(Infecté)' : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              {(salonData.verdict_details?.malediction_ancien || salonData.malediction_ancien_active) && (
                <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.15)', border: '1.5px solid #ef4444', borderRadius: '10px' }}>
                  <p className="title-font" style={{ margin: '0 0 4px', color: '#ef4444', fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Hourglass size={18} /> Malédiction de l'Ancien activée !
                  </p>
                  <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: '#fca5a5' }}>
                    Le village a condamné son aîné au vote : tous les villageois à pouvoirs magiques perdent leurs facultés et redeviennent de Simples Villageois (seuls le Chasseur et les Loups restent intacts).
                  </p>
                </div>
              )}
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
          );
        })()}
      </div>

      {/* ── PANNEAU IA : SIMULATEUR & JOUEURS BOTS ────────────────────────── */}
      <AiTestPanel roomId={roomId} salonData={salonData} joueurs={joueurs} />

      {/* ── GRILLE BASSE : QR Code / Guide + Tableau des joueurs ─────────── */}
      <div className="mj-main-grid" style={{ marginTop: '1.75rem' }}>
        {/* QR Code (avant lancement) */}
        {!isGameRunning && (
          <div className="qr-panel glass-panel" style={{ padding: '1.5rem', borderRadius: '1.25rem', textAlign: 'center' }}>
            <h2 className="title-font" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-color)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              <LinkIcon size={20} style={{ color: 'var(--primary)' }} /> Rejoindre la partie
            </h2>
            <p className="text-font text-muted" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>
              Scannez ce QR Code avec les smartphones ({joueurs.filter(j => !isBot(j)).length} vrai(s) joueur(s) / {salonData.roles_selectionnes.length} places).
            </p>
            {joueurs.some(j => isBot(j)) && (
              <p className="text-font" style={{ fontSize: '0.8rem', color: '#06b6d4', margin: '4px 0 8px' }}>
                Des Bots IA complètent le salon : les vrais joueurs qui scannent remplaceront automatiquement un bot.
              </p>
            )}
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
                  const addedRole = e.target.value;
                  if (!addedRole) return;
                  try {
                    const newRoles = [...(salonData.roles_selectionnes || []), addedRole];
                    const newMelanges = [...(salonData.roles_melanges || []), addedRole];
                    await updateDoc(doc(db, 'salons', roomId), {
                      roles_selectionnes: newRoles,
                      roles_melanges: newMelanges,
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

          <div className="table-responsive-hint text-font">
            <MoveHorizontal size={13} />
            <span>Glissez horizontalement pour voir toutes les colonnes</span>
          </div>

          <div className="table-responsive-wrapper" style={{ maxHeight: '520px' }}>
            <table style={{ minWidth: '680px', width: '100%', textAlign: 'left', borderCollapse: 'collapse' }} className="text-font">
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
                  if (j.pouvoirs_perdus_ancien) {
                    const ancName = j.ancien_role ? (getRole(j.ancien_role)?.name || j.ancien_role) : 'Pouvoir';
                    extraTags.push(`Ex-${ancName} — Ancien mort`);
                  }

                  return (
                    <tr key={j.id} style={{ borderBottom: '1px solid var(--card-border)', opacity: j.statut_joueur === 'mort' ? 0.55 : 1 }}>
                      <td style={{ padding: '10px 8px', fontWeight: 'bold', color: 'var(--text-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{j.nom}</span>
                          {isBot(j) ? (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(6,182,212,0.18)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 'bold' }}>
                              <Bot size={11} /> IA
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(16,185,129,0.18)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 'bold' }}>
                              <User size={11} /> Humain
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
                                .map(r => {
                                  const maxAllowed = (salonData.roles_selectionnes || []).filter(id => id === r.id).length;
                                  const usedByOthers = joueurs.filter(other => other.id !== j.id && other.role === r.id).length;
                                  const isQuotaReached = usedByOthers >= maxAllowed;
                                  return (
                                    <option key={r.id} value={r.id} disabled={isQuotaReached}>
                                      {r.name} ({usedByOthers + (j.role === r.id ? 1 : 0)}/{maxAllowed}){isQuotaReached ? ' — Complet' : ''}
                                    </option>
                                  );
                                })
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
      <GameTimeSettingsModal
        isOpen={showTimeSettings}
        onClose={() => setShowTimeSettings(false)}
        roomId={roomId}
        salonData={salonData}
      />
    </div>
  );
}
