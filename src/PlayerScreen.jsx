import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  runTransaction, writeBatch, arrayRemove, arrayUnion,
} from 'firebase/firestore';

import { db } from './firebase';
import { rolesData, getRole } from './rolesData';
import { isWolf, ALL_NIGHT_PHASES, DAY_PHASES, phaseLabel } from './gameLogic';
import {
  RoleIcon, RoleMedallion, CampBadge, RoleChip,
  RoleCardView, RoleDetailsModal, GrimoireModal,
} from './RoleComponents';
import {
  WolfPackChat,
  AccusedDefenseChat,
  PlayerMjNotificationAndInbox,
  RoleChangeProposalModal,
} from './GameChats';
import {
  AlertTriangle, EyeOff, Eye, User, Send, Lock, Unlock,
  Heart, HeartCrack, PawPrint, ShieldCheck, FlaskConical,
  Crosshair, Skull, Sparkles, Ghost, Trophy, BookOpen,
  CheckCircle2, Ban, Hourglass, Sun, Moon, VenetianMask,
  Info, Users, Dog, TreePine, Bird, ScanSearch, Drama,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function PlayerScreen() {
  const { roomId } = useParams();

  // ── Identité du joueur ──────────────────────────────────────────────────────
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId]     = useState(
    localStorage.getItem(`loup_garou_${roomId}_playerId`) || null,
  );
  const [isJoined, setIsJoined] = useState(!!playerId);

  // ── Données Firebase ────────────────────────────────────────────────────────
  const [salonData, setSalonData]         = useState(null);
  const [joueurs, setJoueurs]             = useState([]);
  const [joueursLoaded, setJoueursLoaded] = useState(false);
  const [me, setMe]                       = useState(null);

  // ── UI générale & Modals ────────────────────────────────────────────────────
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [showRole, setShowRole]       = useState(false);
  const [inspectRole, setInspectRole] = useState(null);
  const [showGrimoire, setShowGrimoire] = useState(false);

  // ── États des pouvoirs (réinitialisés à chaque changement de phase) ────────
  const [showVoleurModal, setShowVoleurModal]                 = useState(false);
  const [showComedienModal, setShowComedienModal]             = useState(false);
  const [selectedPlayers, setSelectedPlayers]                 = useState([]); // Cupidon
  const [voyanteCible, setVoyanteCible]                       = useState(null);
  const [salvateurCible, setSalvateurCible]                   = useState(null);
  const [potionVieActive, setPotionVieActive]                 = useState(false);
  const [showPotionMortSelection, setShowPotionMortSelection] = useState(false);
  const [cibleMortLocal, setCibleMortLocal]                   = useState(null);
  const [cibleChasseur, setCibleChasseur]                     = useState(null);
  const [corbeauCible, setCorbeauCible]                       = useState(null);
  const [renardResult, setRenardResult]                       = useState(null);

  // ── Abonnements Firestore ───────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), snap => {
      if (snap.exists()) setSalonData({ id: snap.id, ...snap.data() });
      else setError("Ce salon n'existe pas ou a été fermé.");
      setLoading(false);
    });
    const unsubJoueurs = onSnapshot(
      collection(db, 'salons', roomId, 'joueurs'),
      snap => {
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        setJoueurs(list);
        setJoueursLoaded(true);
      },
    );
    return () => { unsubSalon(); unsubJoueurs(); };
  }, [roomId]);

  // ── Synchronisation du "moi" (et détection si retiré par le MJ) ─────────────
  useEffect(() => {
    if (!joueursLoaded || !playerId) return;
    const myData = joueurs.find(j => j.id === playerId);
    if (myData) {
      setMe(myData);
      if (myData.carte_choisie === null) setShowRole(false);
    } else {
      // Le joueur a été supprimé du salon par le MJ
      localStorage.removeItem(`loup_garou_${roomId}_playerId`);
      setMe(null);
      setPlayerId(null);
      setIsJoined(false);
      setShowRole(false);
    }
  }, [playerId, joueurs, joueursLoaded, roomId]);

  // ── Thème Jour / Nuit ───────────────────────────────────────────────────────
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

  // ── Réinitialisation des états locaux à chaque changement de phase ──────────
  useEffect(() => {
    setVoyanteCible(null);
    setSalvateurCible(null);
    setSelectedPlayers([]);
    setPotionVieActive(false);
    setShowPotionMortSelection(false);
    setCibleMortLocal(null);
    setCorbeauCible(null);
    setRenardResult(null);
  }, [salonData?.statut]);

  // ── Sécurité additionnelle : cascade du couple côté client ─────────────────
  useEffect(() => {
    if (!salonData?.couple || salonData.couple.length !== 2 || !me) return;
    if (salonData.couple.includes(me.id) && me.statut_joueur !== 'mort') {
      const partnerId = salonData.couple.find(id => id !== me.id);
      const partner   = joueurs.find(j => j.id === partnerId);
      if (partner && partner.statut_joueur === 'mort') {
        updateDoc(
          doc(db, 'salons', roomId, 'joueurs', me.id),
          { statut_joueur: 'mort' },
        ).catch(console.error);
      }
    }
  }, [joueurs, salonData?.couple, me?.statut_joueur, me?.id, roomId]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleJoin = async e => {
    e.preventDefault();
    if (!playerName.trim()) return;

    // Gestion de la capacité du salon : un vrai joueur peut remplacer un bot IA
    if (salonData && Array.isArray(salonData.roles_selectionnes) && joueurs.length >= salonData.roles_selectionnes.length) {
      const botToReplace = joueurs.find(j => j.est_bot === true || String(j.nom || '').endsWith('(IA)'));
      if (botToReplace) {
        try {
          await deleteDoc(doc(db, 'salons', roomId, 'joueurs', botToReplace.id));
        } catch (delErr) {
          console.error('Erreur remplacement bot:', delErr);
        }
      } else {
        return setError('Salon complet (toutes les places sont occupées par de vrais joueurs).');
      }
    }

    const stableId = 'joueur_' + roomId + '_' + playerName.trim().toLowerCase().replace(/\s+/g, '_');
    if (joueurs.find(j => j.nom.toLowerCase() === playerName.trim().toLowerCase() && j.id !== stableId))
      return alert('Pseudo déjà pris !');

    try {
      await setDoc(doc(db, 'salons', roomId, 'joueurs', stableId), {
        nom: playerName.trim(),
        carte_choisie: null,
        role: '',
        statut_joueur: 'en_vie',
        est_mj: false,
        est_bot: false,
        pouvoir_utilise: false,
        a_vote: false,
        a_vote_sorciere: false,
        vote_jour: null,
        illusion_dispo: true,
        dernier_protege: null,
        potion_vie_utilisee: false,
        potion_mort_utilisee: false,
        vies: 2,
        infection_dispo: false,
        infection_repondu: false,
        tir_chasseur_fait: false,
        gracie_idiot: false,
        choix_chien: null,
        modele_id: null,
        modele_nom: null,
        enfant_devenu_loup: false,
        pouvoir_renard_perdu: false,
        proposition_role: null,
      });
      localStorage.setItem(`loup_garou_${roomId}_playerId`, stableId);
      setPlayerId(stableId);
      setIsJoined(true);
    } catch {
      setError('Erreur de connexion.');
    }
  };

  const handlePickCard = async index => {
    if (!salonData || !me) return;
    if (joueurs.some(j => j.carte_choisie === index)) return alert('Carte déjà prise !');
    const assignedRole = salonData.roles_melanges[index];
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
        carte_choisie: index,
        role: assignedRole,
        vies: assignedRole === 'ancien' ? 2 : 1,
        infection_dispo: assignedRole === 'infect-pere-des-loups' || assignedRole === 'pere-des-loups',
      });
    } catch {
      alert('Erreur lors du tirage de la carte.');
    }
  };

  const handleChienLoupChoice = async campChoice => {
    if (!me || me.role !== 'chien-loup' || me.choix_chien) return;
    try {
      await runTransaction(db, async transaction => {
        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
          choix_chien: campChoice,
        });
        transaction.update(doc(db, 'salons', roomId), {
          notifications_mj: arrayUnion(
            `Le Chien-Loup (${me.nom}) a choisi son camp : ${campChoice === 'loup' ? 'Meute des Loups-Garous' : 'Camp du Village'}.`,
          ),
        });
      });
    } catch (e) { console.error(e); }
  };

  const handleEnfantSauvageModel = async targetPlayer => {
    if (!me || me.role !== 'enfant-sauvage' || me.modele_id) return;
    try {
      await runTransaction(db, async transaction => {
        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
          modele_id: targetPlayer.id,
          modele_nom: targetPlayer.nom,
        });
        transaction.update(doc(db, 'salons', roomId), {
          notifications_mj: arrayUnion(
            `L'Enfant Sauvage (${me.nom}) a choisi ${targetPlayer.nom} comme modèle.`,
          ),
        });
      });
    } catch (e) { console.error(e); }
  };

  const handleVoleurAction = async (action, targetPlayerId = null) => {
    if (!me || me.role !== 'voleur' || me.pouvoir_utilise) return;

    if (action === 'conserver') {
      try {
        await runTransaction(db, async transaction => {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true });
          transaction.update(doc(db, 'salons', roomId), {
            notifications_mj: arrayUnion(`Le Voleur (${me.nom}) a conservé son pouvoir pour une prochaine nuit.`),
          });
        });
      } catch (e) { console.error(e); }
      return;
    }

    if (action === 'activer') {
      const targetPlayer = joueurs.find(j => j.id === targetPlayerId);
      if (!targetPlayer || !targetPlayer.role) return alert("Ce joueur n'a pas encore de rôle.");
      if (!window.confirm(`Voler le rôle de ${targetPlayer.nom} ?`)) return;

      try {
        const stolenRoleData = getRole(targetPlayer.role);
        const isTargetLoup   = isWolf(targetPlayer);

        await runTransaction(db, async transaction => {
          const voleurRef  = doc(db, 'salons', roomId, 'joueurs', me.id);
          const targetRef  = doc(db, 'salons', roomId, 'joueurs', targetPlayerId);
          const targetSnap = await transaction.get(targetRef);

          const targetData      = targetSnap.data();
          const vraiRoleCible   = targetData.role;
          const stolenRoleCheck = getRole(vraiRoleCible);
          const isLoupFinal     = isWolf(targetData);

          transaction.update(voleurRef, {
            role: vraiRoleCible,
            pouvoir_utilise: true,
            a_vote: true,
            statut_joueur: 'en_vie',
            infection_dispo: vraiRoleCible === 'infect-pere-des-loups' || vraiRoleCible === 'pere-des-loups',
          });

          const targetUpdates = { role: 'voleur' };
          if (isLoupFinal) targetUpdates.statut_joueur = 'mort';
          transaction.update(targetRef, targetUpdates);

          transaction.update(doc(db, 'salons', roomId), {
            notifications_mj: arrayUnion(
              `Le Voleur (${me.nom}) a volé la carte de ${targetPlayer.nom} (${stolenRoleCheck?.name || vraiRoleCible}).`,
            ),
          });
        });

        setShowVoleurModal(false);
        let msg = `Vol réussi ! Votre nouveau rôle : ${stolenRoleData?.name || targetPlayer.role}`;
        if (isTargetLoup) msg += '\nLa cible faisait partie des Loups — elle est éliminée.';
        alert(msg);
      } catch (err) { alert('Erreur vol : ' + err.message); }
    }
  };

  const handleComedienAction = async roleId => {
    if (!me || me.role !== 'comedien') return;
    const rObj = getRole(roleId);
    if (!window.confirm(`Incarner le rôle ${rObj?.name || roleId} ?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
        role: roleId,
        infection_dispo: roleId === 'infect-pere-des-loups' || roleId === 'pere-des-loups',
      });
      batch.update(doc(db, 'salons', roomId), {
        roles_dispo_comedien: arrayRemove(roleId),
        notifications_mj: arrayUnion(`Le Comédien (${me.nom}) a choisi d'incarner : ${rObj?.name || roleId}.`),
      });
      await batch.commit();
      setShowComedienModal(false);
    } catch { alert('Erreur.'); }
  };

  // ─── Gardes early-return ───────────────────────────────────────────────────
  if (loading) return (
    <div className="player-screen">
      <div className="loading"><div className="spinner" /></div>
    </div>
  );
  if (error) return (
    <div className="player-screen">
      <div className="error-box">
        <div className="error-content">
          <AlertTriangle size={48} /><h2>Erreur</h2><p>{error}</p>
        </div>
      </div>
    </div>
  );

  // ─── Écran de connexion (pseudo) ──────────────────────────────────────────
  if (!isJoined || !me) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="player-content" style={{ margin: 'auto' }}>
          <div className="glass-panel" style={{ padding: '2.25rem 1.75rem', borderRadius: '1.5rem', textAlign: 'center' }}>
            <div className="home-icon glow-effect" style={{ margin: '0 auto 1.25rem' }}>
              <User size={42} />
            </div>
            <h2 className="title-font" style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>Rejoindre le salon {roomId}</h2>
            <p className="text-font text-muted" style={{ fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              Entrez votre prénom ou pseudo pour recevoir votre carte secrète.
            </p>
            <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input
                type="text"
                className="text-font"
                style={{ padding: '13px 15px', borderRadius: '10px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-color)', fontSize: '1rem', outline: 'none' }}
                placeholder="Votre Pseudo"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                maxLength={20}
                required
              />
              <button type="submit" className="btn-primary title-font glow-button">
                <Send size={18} /> Rejoindre la table
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const myRoleData = me.role ? getRole(me.role) : null;
  const activeRoleIds = salonData?.roles_selectionnes || [];

  // ─── Phase de configuration initiale (SETUP) ──────────────────────────────
  if (salonData.statut === 'SETUP') {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="player-content" style={{ margin: 'auto' }}>
          <div className="glass-panel" style={{ padding: '2rem 1.5rem', borderRadius: '1.5rem' }}>
            <span className="room-badge">SALON {roomId}</span>
            <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)' }}>
              <Hourglass size={36} style={{ color: 'var(--primary)' }} />
              <p className="text-font" style={{ fontSize: '0.98rem', lineHeight: 1.55 }}>
                Le Maître du Jeu compose les rôles de la partie. Vos cartes apparaîtront ici dès l'ouverture du salon.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowGrimoire(true)}
              className="btn-secondary text-font"
              style={{ marginTop: '1.5rem', width: '100%' }}
            >
              <BookOpen size={16} style={{ color: 'var(--primary)' }} /> Consulter le Grimoire des Rôles
            </button>
          </div>
        </div>
        <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
        <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
        <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
        <GrimoireModal
          isOpen={showGrimoire}
          onClose={() => setShowGrimoire(false)}
          onSelectRole={r => setInspectRole(r)}
          activeRoleIds={activeRoleIds}
        />
      </div>
    );
  }

  // ─── Phase d'attente / Choix des cartes ───────────────────────────────────
  if (salonData.statut === 'en_attente') {
    // Mode manuel — en attente d'attribution par le MJ
    if (salonData.distribution_mode === 'manuelle' && !me.role) {
      return (
        <div className="player-screen">
          <ThemeToggle />
          <div className="player-content" style={{ margin: 'auto' }}>
            <div className="glass-panel" style={{ padding: '2rem 1.5rem', borderRadius: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span className="room-badge" style={{ marginBottom: 0 }}>SALON {roomId}</span>
                <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
              </div>
              <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
              <Hourglass size={34} style={{ color: 'var(--primary)', marginBottom: '0.75rem' }} />
              <p className="text-font text-muted">Le Maître du Jeu distribue les rôles manuellement. Veuillez patienter...</p>
            </div>
          </div>
          <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
          <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
        </div>
      );
    }

    // Mode aléatoire — choix de la carte mystère
    if (me.carte_choisie === null && salonData.distribution_mode !== 'manuelle') {
      const totalRoles = salonData.roles_selectionnes.length;
      const allCards   = Array.from({ length: totalRoles }, (_, i) => i);
      const takenCards = joueurs
        .filter(j => j.carte_choisie !== null && j.carte_choisie !== 999)
        .map(j => j.carte_choisie);
      return (
        <div className="player-screen">
          <ThemeToggle />
          <div className="player-content">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span className="room-badge" style={{ marginBottom: 0 }}>SALON {roomId}</span>
                <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
              </div>
              <h1 className="player-title" style={{ marginBottom: '0.4rem' }}>Bienvenue, <strong>{me.nom}</strong></h1>
              <p className="text-font text-muted" style={{ fontSize: '0.92rem', marginBottom: '1.25rem' }}>
                Touchez une carte scellée pour tirer votre rôle secret.
              </p>
            </div>
            <div className="mystery-cards-grid">
              {allCards.map(index => {
                if (takenCards.includes(index)) return null;
                return (
                  <button
                    key={index}
                    onClick={() => handlePickCard(index)}
                    className="mystery-card-btn"
                  >
                    <Moon size={22} />
                    <span className="mystery-card-number">#{index + 1}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
          <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
        </div>
      );
    }

    // Rôle assigné — 3D Flip Card de révélation avec design collectionnable
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: showRole ? (myRoleData?.color || 'transparent') : 'transparent' }} />
        <div className="player-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span className="room-badge" style={{ marginBottom: 0 }}>SALON {roomId}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
              <button
                type="button"
                onClick={() => setShowGrimoire(true)}
                className="btn-secondary text-font"
                style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', borderRadius: '2rem' }}
              >
                <BookOpen size={14} style={{ color: 'var(--primary)' }} /> Grimoire
              </button>
            </div>
          </div>

          <p className="text-font text-muted" style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>
            Touchez votre carte pour la retourner ou la masquer aux regards indiscrets.
          </p>

          <div className="perspective-container">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setShowRole(!showRole)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setShowRole(!showRole); }}
              className={`flip-card ${showRole ? 'flipped' : ''}`}
            >
              <div className="flip-card-front">
                <div className="flip-card-front-emblem">
                  <EyeOff size={40} />
                </div>
                <p>Carte Secrète</p>
                <small>Appuyez pour révéler votre identité</small>
              </div>
              <div className="flip-card-back">
                <RoleCardView
                  role={myRoleData}
                  onOpenDetails={r => setInspectRole(r)}
                />
              </div>
            </div>
          </div>

          {/* Choix immédiat pour Chien-Loup ou Enfant Sauvage dès la découverte de la carte */}
          {showRole && me.role === 'chien-loup' && !me.choix_chien && (
            <div className="glass-panel" style={{ marginTop: '1rem', padding: '1rem', borderRadius: '1rem', border: '1px solid #a1a1aa', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, color: 'var(--text-color)', marginBottom: '0.5rem', fontSize: '0.92rem' }}>
                <Dog size={18} /> Choix du Chien-Loup : Choisissez votre camp
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleChienLoupChoice('villageois')}
                  className="btn-secondary text-font"
                  style={{ flex: 1, borderColor: '#3b82f6', color: '#60a5fa' }}
                >
                  <ShieldCheck size={16} /> Villageois
                </button>
                <button
                  type="button"
                  onClick={() => handleChienLoupChoice('loup')}
                  className="btn-secondary text-font"
                  style={{ flex: 1, borderColor: '#ef4444', color: '#f87171' }}
                >
                  <PawPrint size={16} /> Loup-Garou
                </button>
              </div>
            </div>
          )}

          {showRole && myRoleData && (
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setInspectRole(myRoleData)}
                className="btn-secondary text-font"
                style={{
                  flex: 1,
                  fontSize: '0.82rem',
                  color: 'var(--text-color)',
                  borderColor: 'var(--card-border)',
                  background: 'var(--card-bg)',
                }}
              >
                <Info size={15} style={{ color: 'var(--text-muted)' }} /> Fiche détaillée de mon rôle
              </button>
            </div>
          )}
        </div>

        <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
        <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
        <GrimoireModal
          isOpen={showGrimoire}
          onClose={() => setShowGrimoire(false)}
          onSelectRole={r => setInspectRole(r)}
          activeRoleIds={activeRoleIds}
        />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE DE JEU (après lancement)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Early return : Fin de partie ──────────────────────────────────────────
  if (salonData?.statut === 'fin_village' || salonData?.statut === 'fin_loups' || salonData?.statut === 'fin_ange') {
    const isVillageWin = salonData.statut === 'fin_village';
    const isAngeWin    = salonData.statut === 'fin_ange';
    const winColor     = isVillageWin ? '#10b981' : isAngeWin ? '#fbbf24' : '#ef4444';

    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: winColor }} />
        <div className="player-content" style={{ paddingBottom: '2rem' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: `${winColor}22`, border: `2px solid ${winColor}`, marginBottom: '1rem' }}>
            <Trophy size={42} style={{ color: winColor }} />
          </div>
          <h1 className="title-font" style={{ fontSize: 'clamp(1.65rem, 5vw, 2.5rem)', color: winColor, marginBottom: '0.5rem' }}>
            {isVillageWin
              ? 'VICTOIRE DU VILLAGE !'
              : isAngeWin
                ? "VICTOIRE DE L'ANGE !"
                : 'VICTOIRE DES LOUPS !'}
          </h1>
          <p className="text-font" style={{ fontSize: '1.05rem', color: 'var(--text-color)', marginBottom: '2rem' }}>
            {isVillageWin
              ? 'Tous les Loups-Garous ont été éliminés !'
              : isAngeWin
                ? "L'Ange s'est fait éliminer au tout premier vote et gagne seul !"
                : 'La meute a dévoré le village !'}
          </p>

          <div className="glass-panel" style={{ width: '100%', padding: '1.25rem', borderRadius: '1.25rem', textAlign: 'left' }}>
            <h3 className="title-font" style={{ marginBottom: '0.85rem', color: 'var(--text-color)', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem', fontSize: '1.05rem' }}>
              Rôles de la partie (cliquez sur un rôle pour le détail)
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {joueurs.map(j => {
                const rObj = getRole(j.role);
                return (
                  <li key={j.id} className="text-font" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
                    <span style={{ color: j.statut_joueur === 'mort' ? 'var(--text-muted)' : 'var(--text-color)', textDecoration: j.statut_joueur === 'mort' ? 'line-through' : 'none', fontWeight: 'bold', fontSize: '0.9rem' }}>
                      {j.nom}
                    </span>
                    {rObj ? (
                      <RoleChip
                        roleObj={rObj}
                        onSelectRole={r => setInspectRole(r)}
                        suffix={j.est_infecte ? '(Infecté)' : undefined}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{j.role || '—'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
      </div>
    );
  }

  const isDead          = me.statut_joueur === 'mort';
  const allAlivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
  const isMeLoup        = isWolf(me);
  const loupTargets     = allAlivePlayers.filter(j => !isWolf(j));
  const compagnonsLoups = isMeLoup
    ? joueurs.filter(j => isWolf(j) && j.id !== me.id && j.statut_joueur !== 'mort')
    : [];
  const isNightMode     = ALL_NIGHT_PHASES.includes(salonData?.statut);

  // Vote simultané — lecture depuis le document salon
  const monVote = salonData?.votes?.[me.nom] || null;

  // ─── Early return : Chasseur mort — tir de vengeance ─────────────────────
  if (isDead && me.role === 'chasseur' && me.tir_chasseur_fait === false) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: '#7f1d1d' }} />
        <div className="player-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="room-badge">SALON {roomId}</span>
            <span className="room-badge" style={{ background: 'var(--danger)', color: 'white', border: '1px solid #dc2626' }}>
              <Skull size={13} /> ÉLIMINÉ
            </span>
          </div>
          <div style={{ marginTop: '1.5rem', padding: '1.5rem', background: 'rgba(239,68,68,0.12)', border: '2px solid #ef4444', borderRadius: '1rem', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', padding: '0.8rem', borderRadius: '50%', background: 'rgba(239,68,68,0.2)', color: '#ef4444', marginBottom: '0.75rem' }}>
              <Crosshair size={32} />
            </div>
            <h3 className="title-font" style={{ color: '#ef4444', marginBottom: '0.5rem', fontSize: '1.35rem' }}>
              Dernier souffle du Chasseur
            </h3>
            <p className="text-font" style={{ marginBottom: '1.25rem', color: 'var(--text-color)', fontSize: '0.92rem' }}>
              Vous avez été éliminé. Désignez immédiatement le joueur sur qui vous tirez votre dernière balle :
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem', maxHeight: '280px', overflowY: 'auto', textAlign: 'left' }}>
              {allAlivePlayers.map(j => {
                const isSel = cibleChasseur === j.nom;
                return (
                  <li
                    key={j.id}
                    onClick={() => setCibleChasseur(j.nom)}
                    style={{
                      padding: '11px 14px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)',
                      color: isSel ? '#fff' : 'var(--text-color)',
                      border: isSel ? '1px solid #b91c1c' : '1px solid var(--card-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontWeight: isSel ? 700 : 500,
                    }}
                  >
                    <Crosshair size={16} style={{ opacity: isSel ? 1 : 0.4 }} />
                    <span>{j.nom}</span>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={async () => {
                if (!cibleChasseur) return;
                if (!window.confirm(`Tirer sur ${cibleChasseur} ? Ce joueur sera éliminé sur-le-champ.`)) return;
                try {
                  await runTransaction(db, async transaction => {
                    const targetDoc = joueurs.find(j => j.nom === cibleChasseur);
                    const notifs = [`Le Chasseur (${me.nom}) a abattu ${cibleChasseur} dans son dernier souffle.`];
                    const deadIds = new Set();

                    if (targetDoc) {
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', targetDoc.id), { statut_joueur: 'mort' });
                      deadIds.add(targetDoc.id);

                      // Cascade amoureux si la cible du chasseur est en couple
                      if (Array.isArray(salonData.couple) && salonData.couple.length === 2 && salonData.couple.includes(targetDoc.id)) {
                        const partnerId = salonData.couple.find(id => id !== targetDoc.id);
                        const partner = joueurs.find(j => j.id === partnerId);
                        if (partner && partner.statut_joueur !== 'mort') {
                          transaction.update(doc(db, 'salons', roomId, 'joueurs', partner.id), { statut_joueur: 'mort' });
                          deadIds.add(partner.id);
                          notifs.push(`Amoureux : ${partner.nom} meurt de chagrin suite à la mort de ${targetDoc.nom}.`);
                        }
                      }

                      // Enfant Sauvage
                      joueurs.forEach(p => {
                        if (p.role === 'enfant-sauvage' && p.statut_joueur !== 'mort' && !deadIds.has(p.id) && p.modele_id && deadIds.has(p.modele_id) && !p.enfant_devenu_loup) {
                          transaction.update(doc(db, 'salons', roomId, 'joueurs', p.id), { enfant_devenu_loup: true });
                          notifs.push(`Enfant Sauvage : Le modèle de ${p.nom} est mort, ${p.nom} rejoint les loups !`);
                        }
                      });
                    }
                    transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { tir_chasseur_fait: true });
                    transaction.update(doc(db, 'salons', roomId), {
                      notifications_mj: arrayUnion(...notifs),
                    });
                  });
                } catch (e) { console.error(e); }
              }}
              disabled={!cibleChasseur}
              className="btn-primary title-font glow-button"
              style={{ background: '#ef4444' }}
            >
              <Crosshair size={18} /> Tirer sur {cibleChasseur || '...'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Early return : Mode Fantôme (joueur mort hors Chasseur) ─────────────
  if (isDead) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at center, rgba(139,92,246,0.12) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <div className="player-content" style={{ position: 'relative', zIndex: 1 }}>
          {/* Bandeau Fantôme */}
          <div style={{ marginBottom: '1rem', padding: '12px 16px', background: 'rgba(139,92,246,0.15)', border: '1.5px solid #7c3aed', borderRadius: '12px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Ghost size={20} style={{ color: '#c4b5fd', flexShrink: 0 }} />
            <p className="title-font" style={{ margin: 0, color: '#c4b5fd', fontSize: '0.88rem', letterSpacing: '0.04em' }}>
              Mode Fantôme — Vous observez toute la partie dans l'ombre.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span className="room-badge" style={{ marginBottom: 0 }}>SALON {roomId}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
              <span className="room-badge" style={{ marginBottom: 0, background: 'rgba(139,92,246,0.3)', color: '#c4b5fd', border: '1px solid #7c3aed' }}>
                <Ghost size={13} /> SPECTRE
              </span>
            </div>
          </div>

          {/* Phase actuelle */}
          <div style={{ padding: '0.9rem 1rem', background: 'var(--input-bg)', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
            <p className="text-font" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
              Phase actuelle
            </p>
            <p className="title-font" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--primary)' }}>
              {phaseLabel(salonData.statut)}
            </p>
          </div>

          {/* Infos de la nuit (si phase nuit) */}
          {isNightMode && (
            <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
              <p className="title-font" style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Eye size={15} /> Vision spectrale de la nuit
              </p>
              <p className="text-font" style={{ margin: 0, fontSize: '0.88rem' }}>
                Cible des loups : <strong style={{ color: '#ef4444' }}>{salonData.victime_loups || 'Non confirmée'}</strong>
              </p>
              <p className="text-font" style={{ margin: 0, fontSize: '0.88rem' }}>
                Joueur protégé : <strong style={{ color: '#3b82f6' }}>{salonData.joueur_protege || 'Personne'}</strong>
              </p>
            </div>
          )}

          {/* Chat des loups en lecture seule pour les fantômes */}
          {salonData.statut === 'nuit_loups' && (
            <div style={{ marginBottom: '1rem' }}>
              <WolfPackChat
                roomId={roomId}
                salonData={salonData}
                senderName={me.nom}
                isReadOnly={true}
              />
            </div>
          )}

          {/* Chat de défense des accusés en lecture seule pour les fantômes */}
          {salonData.statut === 'jour_vote' && salonData?.la_liste_accuses?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <AccusedDefenseChat
                roomId={roomId}
                salonData={salonData}
                senderName={me.nom}
                isDead={true}
              />
            </div>
          )}

          {/* Liste complète des joueurs avec rôles cliquables */}
          <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '1.25rem', textAlign: 'left' }}>
            <h3 className="title-font" style={{ marginBottom: '0.85rem', fontSize: '1rem', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} /> Tableau omniscient (cliquez sur un rôle)
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto' }}>
              {joueurs.map(j => {
                const rObj     = j.role ? getRole(j.role) : null;
                const isDead_j = j.statut_joueur === 'mort';
                return (
                  <li
                    key={j.id}
                    className="text-font"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', background: isDead_j ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.04)', opacity: isDead_j ? 0.65 : 1, border: '1px solid var(--card-border)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isDead_j ? 'var(--danger)' : j.est_infecte === true ? '#a78bfa' : 'var(--success)', flexShrink: 0 }} />
                      <span style={{ fontWeight: j.id === me.id ? 'bold' : 'normal', color: 'var(--text-color)', fontSize: '0.88rem' }}>
                        {j.nom} {j.id === me.id && '(Vous)'}
                      </span>
                    </div>
                    {rObj ? (
                      <RoleChip
                        roleObj={rObj}
                        onSelectRole={r => setInspectRole(r)}
                        suffix={j.est_infecte ? '(Infecté)' : undefined}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
        <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉCRAN NORMAL — Joueur vivant en phase de jeu
  // ═══════════════════════════════════════════════════════════════════════════

  const soeursAllies = me.role === 'soeurs'
    ? joueurs.filter(j => j.role === 'soeurs' && j.id !== me.id)
    : [];
  const freresAllies = me.role === 'freres'
    ? joueurs.filter(j => j.role === 'freres' && j.id !== me.id)
    : [];

  return (
    <div className="player-screen">
      <ThemeToggle />
      <div className="ambient-bg" style={{ backgroundColor: showRole ? (myRoleData?.color || 'transparent') : 'transparent' }} />
      <div className="player-content">

        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="room-badge" style={{ marginBottom: 0 }}>SALON {roomId}</span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <PlayerMjNotificationAndInbox roomId={roomId} me={me} salonData={salonData} />
            <button
              type="button"
              onClick={() => setShowGrimoire(true)}
              className="btn-secondary text-font"
              style={{ padding: '0.38rem 0.85rem', fontSize: '0.78rem', borderRadius: '2rem' }}
            >
              <BookOpen size={14} style={{ color: 'var(--primary)' }} /> Grimoire
            </button>
          </div>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', textAlign: 'left' }}>
          <div>
            <h1 className="player-title" style={{ fontSize: '1.55rem', margin: 0, color: 'var(--text-color)' }}>{me.nom}</h1>
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {showRole && myRoleData ? (
                <RoleChip roleObj={myRoleData} onSelectRole={r => setInspectRole(r)} />
              ) : (
                <span className="text-font" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                  <Lock size={13} /> Identité secrète masquée
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowRole(!showRole)}
            className="btn-secondary text-font"
            style={{
              padding: '8px 12px',
              fontSize: '0.82rem',
              borderColor: showRole ? '#ec4899' : 'var(--primary)',
              color: showRole ? '#ec4899' : 'var(--text-color)',
              fontWeight: 'bold',
              flexShrink: 0,
            }}
          >
            {showRole ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{showRole ? 'Masquer' : 'Ma Carte'}</span>
          </button>
        </div>

        {/* Verdict de la nuit (affiché au matin pour tous) */}
        {salonData?.statut === 'jour_vote' && (() => {
          const morts = [];
          if (salonData.morts_nuit?.loups)    morts.push(salonData.morts_nuit.loups);
          if (salonData.morts_nuit?.sorciere) morts.push(salonData.morts_nuit.sorciere);
          if (salonData.morts_nuit?.venin)    morts.push(salonData.morts_nuit.venin);
          if (salonData.morts_nuit?.chagrin)  morts.push(`${salonData.morts_nuit.chagrin} (chagrin)`);
          const uniqueMorts = [...new Set(morts)];
          return uniqueMorts.length > 0 ? (
            <div style={{ marginTop: '1.25rem', background: 'rgba(239,68,68,0.14)', border: '1.5px solid #ef4444', borderRadius: '12px', padding: '1rem 1.25rem', textAlign: 'center' }}>
              <h3 className="title-font" style={{ color: '#ef4444', fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={18} /> Victimes de la nuit : {uniqueMorts.join(', ')}
              </h3>
            </div>
          ) : (
            <div style={{ marginTop: '1.25rem', background: 'rgba(16,185,129,0.14)', border: '1.5px solid #10b981', borderRadius: '12px', padding: '1rem 1.25rem', textAlign: 'center' }}>
              <h3 className="title-font" style={{ color: '#10b981', fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={18} /> Aucune victime cette nuit !
              </h3>
            </div>
          );
        })()}

        {/* ── SECRETS DU JOUEUR : affichés uniquement si showRole ──────────────── */}
        {showRole && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem', textAlign: 'left' }}>

            {/* Carte collectionnable du rôle */}
            {myRoleData && (
              <RoleCardView
                role={myRoleData}
                onOpenDetails={r => setInspectRole(r)}
                compact={false}
              />
            )}

            {/* Alliances fraternelles : Deux Sœurs / Trois Frères */}
            {soeursAllies.length > 0 && (
              <div style={{ padding: '1rem', background: 'rgba(244,114,182,0.12)', border: '1.5px solid #f472b6', borderRadius: '12px' }}>
                <p className="title-font" style={{ margin: '0 0 4px', color: '#f472b6', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={16} /> Votre Sœur de confiance :
                </p>
                <p className="text-font" style={{ margin: 0, fontWeight: 700, color: 'var(--text-color)' }}>
                  {soeursAllies.map(s => s.nom).join(', ')}
                </p>
              </div>
            )}

            {freresAllies.length > 0 && (
              <div style={{ padding: '1rem', background: 'rgba(59,130,246,0.12)', border: '1.5px solid #3b82f6', borderRadius: '12px' }}>
                <p className="title-font" style={{ margin: '0 0 4px', color: '#60a5fa', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={16} /> Vos Frères de confiance :
                </p>
                <p className="text-font" style={{ margin: 0, fontWeight: 700, color: 'var(--text-color)' }}>
                  {freresAllies.map(f => f.nom).join(', ')}
                </p>
              </div>
            )}

            {/* Encart Couple (Cupidon) */}
            {salonData?.couple?.includes(me.id) && (() => {
              const partnerId     = salonData.couple.find(id => id !== me.id);
              const partner       = joueurs.find(j => j.id === partnerId);
              if (!partner) return null;
              const partnerRole   = getRole(partner.role);
              const isPartnerDead = partner.statut_joueur === 'mort';
              return (
                <div style={{
                  padding: '1rem 1.15rem',
                  background: 'rgba(236,72,153,0.12)',
                  border: '1.5px solid #ec4899',
                  borderRadius: '14px',
                }}>
                  <p className="title-font" style={{ margin: '0 0 6px', color: '#ec4899', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Heart size={16} /> Votre Âme Sœur : <strong>{partner.nom}</strong>
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="text-font" style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Son rôle :</span>
                    {partnerRole && (
                      <RoleChip
                        roleObj={partnerRole}
                        onSelectRole={r => setInspectRole(r)}
                        suffix={partner.est_infecte ? '(Infecté)' : undefined}
                      />
                    )}
                  </div>
                  {isPartnerDead && (
                    <p className="text-font" style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <HeartCrack size={14} /> Votre âme sœur est morte.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Statut Infecté ou Enfant Sauvage devenu Loup */}
            {(me.est_infecte === true || me.enfant_devenu_loup === true) && (
              <div style={{
                padding: '1rem 1.15rem',
                background: 'rgba(167,139,250,0.12)',
                border: '1.5px solid #8b5cf6',
                borderRadius: '14px',
              }}>
                <p className="title-font" style={{ margin: '0 0 4px', color: '#a78bfa', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PawPrint size={16} />
                  {me.est_infecte ? 'Vous avez été infecté !' : 'Votre modèle est mort : vous êtes devenu Loup-Garou !'}
                </p>
                <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  Vous faites désormais partie intégrante de la meute des Loups-Garous.
                </p>
              </div>
            )}

            {/* Compagnons loups */}
            {isMeLoup && (
              <div style={{ padding: '1rem 1.15rem', background: 'rgba(239,68,68,0.1)', border: '1.5px solid #ef4444', borderRadius: '14px' }}>
                <p className="title-font" style={{ margin: '0 0 8px', color: '#ef4444', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PawPrint size={16} /> Meute des Loups-Garous :
                </p>
                {compagnonsLoups.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {compagnonsLoups.map(j => {
                      const rObj = getRole(j.role);
                      return (
                        <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                          <span className="text-font" style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fca5a5' }}>{j.nom}</span>
                          {rObj && (
                            <RoleChip
                              roleObj={rObj}
                              onSelectRole={r => setInspectRole(r)}
                              suffix={j.est_infecte ? '(Infecté)' : undefined}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-font" style={{ margin: 0, color: '#fca5a5', fontSize: '0.86rem' }}>
                    Vous êtes le seul loup en vie ce soir.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BANDEAU PHASE DE NUIT ────────────────────────────────────────── */}
        {isNightMode && (() => {
          const NIGHT_META = {
            nuit_cupidon:   { roleId: 'cupidon',    label: 'Cupidon lie deux âmes...',            color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
            nuit_voleur:    { roleId: 'voleur',     label: 'Le Voleur rôde en silence...',        color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)' },
            nuit_salvateur: { roleId: 'salvateur',  label: 'Le Salvateur protège le village...',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
            nuit_voyante:   { roleId: 'voyante',    label: 'La Voyante observe les astres...',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
            nuit_loups:     { roleId: 'loup-garou', label: 'La meute de loups chasse...',         color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
            nuit_sorciere:  { roleId: 'sorciere',   label: 'La Sorcière prépare ses potions...',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
          };
          const phaseInfo = NIGHT_META[salonData.statut];
          if (!phaseInfo) return null;

          const isActiveRole =
            (salonData.statut === 'nuit_cupidon'   && me.role === 'cupidon'   && !me.pouvoir_utilise) ||
            (salonData.statut === 'nuit_voleur'    && me.role === 'voleur'    && !me.a_vote) ||
            (salonData.statut === 'nuit_salvateur' && me.role === 'salvateur' && !me.a_vote) ||
            (salonData.statut === 'nuit_voyante'   && me.role === 'voyante'   && !me.a_vote) ||
            (salonData.statut === 'nuit_loups'     && isMeLoup                && !me.a_vote) ||
            (salonData.statut === 'nuit_sorciere'  && me.role === 'sorciere'  && !me.a_vote_sorciere);

          return (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1.15rem',
                background: phaseInfo.bg,
                border: `1.5px solid ${phaseInfo.color}`,
                borderRadius: '1rem',
                textAlign: 'center',
                animation: 'pulse-subtle 3s infinite',
              }}
            >
              <div style={{ display: 'inline-flex', padding: '0.65rem', borderRadius: '50%', background: `${phaseInfo.color}22`, color: phaseInfo.color, marginBottom: '0.4rem' }}>
                <RoleIcon roleId={phaseInfo.roleId} size={26} />
              </div>
              <p className="title-font" style={{ margin: '0 0 4px', fontSize: '1.05rem', color: phaseInfo.color }}>
                {phaseInfo.label}
              </p>
              <p className="text-font" style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {isActiveRole
                  ? "C'est votre tour — utilisez votre pouvoir ci-dessous."
                  : 'Gardez le silence pendant que la nuit suit son cours.'}
              </p>
            </div>
          );
        })()}

        {/* ── SECTION POUVOIRS ────────────────────────────────────────────── */}
        <div className="powers-section" style={{ marginTop: '1.5rem', textAlign: 'left' }}>

          {/* CHIEN-LOUP (s'il n'a pas encore choisi son camp) */}
          {me.role === 'chien-loup' && !me.choix_chien && (
            <div style={{ padding: '1.15rem', background: 'rgba(161,161,170,0.12)', border: '1.5px solid #a1a1aa', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#e4e4e7', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <Dog size={20} /> Choix du Chien-Loup
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.86rem', marginBottom: '1rem' }}>
                Choisissez définitivement votre camp pour toute la partie :
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleChienLoupChoice('villageois')}
                  className="btn-primary title-font"
                  style={{ flex: 1, background: '#2563eb' }}
                >
                  <ShieldCheck size={18} /> Villageois
                </button>
                <button
                  type="button"
                  onClick={() => handleChienLoupChoice('loup')}
                  className="btn-primary title-font"
                  style={{ flex: 1, background: '#dc2626' }}
                >
                  <PawPrint size={18} /> Loup-Garou
                </button>
              </div>
            </div>
          )}

          {/* ENFANT SAUVAGE (choix du modèle) */}
          {me.role === 'enfant-sauvage' && !me.modele_id && (
            <div style={{ padding: '1.15rem', background: 'rgba(180,83,9,0.12)', border: '1.5px solid #b45309', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#f59e0b', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
                <TreePine size={20} /> Enfant Sauvage — Choisissez votre Modèle
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.85rem' }}>
                Si votre modèle meurt au cours de la partie, vous rejoindrez automatiquement la meute des Loups-Garous.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                {allAlivePlayers.filter(j => j.id !== me.id).map(j => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => handleEnfantSauvageModel(j)}
                      className="btn-secondary text-font"
                      style={{ width: '100%', justifyContent: 'space-between' }}
                    >
                      <span>{j.nom}</span>
                      <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>Choisir comme modèle</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CUPIDON */}
          {salonData.statut === 'nuit_cupidon' && me.role === 'cupidon' && !me.pouvoir_utilise && (
            <div style={{ padding: '1.15rem', background: 'rgba(236,72,153,0.1)', border: '1.5px solid #ec4899', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#ec4899', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                <Heart size={20} /> Flèches de Cupidon
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                Sélectionnez 2 joueurs (vous pouvez vous inclure) pour les unir par l'amour :
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {allAlivePlayers.map(j => {
                  const isSel = selectedPlayers.includes(j.id);
                  return (
                    <li
                      key={j.id}
                      onClick={() => {
                        if (isSel) setSelectedPlayers(selectedPlayers.filter(id => id !== j.id));
                        else if (selectedPlayers.length < 2) setSelectedPlayers([...selectedPlayers, j.id]);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: isSel ? '#ec4899' : 'rgba(255,255,255,0.05)',
                        color: isSel ? '#fff' : 'var(--text-color)',
                        border: isSel ? '1px solid #be185d' : '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: isSel ? 700 : 500,
                      }}
                    >
                      <Heart size={16} style={{ opacity: isSel ? 1 : 0.35 }} />
                      <span>{j.nom}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={async () => {
                  if (selectedPlayers.length !== 2) return;
                  try {
                    await runTransaction(db, async transaction => {
                      const j1 = joueurs.find(j => j.id === selectedPlayers[0])?.nom;
                      const j2 = joueurs.find(j => j.id === selectedPlayers[1])?.nom;
                      transaction.update(doc(db, 'salons', roomId), {
                        couple: [selectedPlayers[0], selectedPlayers[1]],
                        notifications_mj: arrayUnion(`Cupidon (${me.nom}) a uni ${j1} et ${j2}.`),
                      });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { pouvoir_utilise: true, a_vote: true });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[0]), { statut_joueur: 'En couple' });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[1]), { statut_joueur: 'En couple' });
                    });
                  } catch (e) { console.error(e); }
                }}
                disabled={selectedPlayers.length !== 2}
                className="btn-primary title-font glow-button"
                style={{ marginTop: '1rem', background: '#ec4899' }}
              >
                <Heart size={18} /> Unir le couple ({selectedPlayers.length}/2)
              </button>
            </div>
          )}

          {/* VOLEUR */}
          {salonData.statut === 'nuit_voleur' && me.role === 'voleur' && !me.a_vote && (
            <div style={{ padding: '1.15rem', background: 'rgba(161,161,170,0.1)', border: '1.5px solid #a1a1aa', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#e4e4e7', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                <VenetianMask size={20} /> Tour du Voleur
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                Vous pouvez voler la carte d'un joueur ce soir ou conserver votre pouvoir pour une prochaine nuit.
              </p>
              <button onClick={() => setShowVoleurModal(true)} className="btn-primary title-font glow-button" style={{ marginBottom: '0.75rem', background: 'var(--danger)' }}>
                <VenetianMask size={18} /> Voler un rôle maintenant
              </button>
              <button onClick={() => handleVoleurAction('conserver')} className="btn-secondary text-font" style={{ width: '100%' }}>
                Conserver mon pouvoir pour plus tard
              </button>
            </div>
          )}

          {/* SALVATEUR */}
          {salonData.statut === 'nuit_salvateur' && me.role === 'salvateur' && !me.a_vote && (
            <div style={{ padding: '1.15rem', background: 'rgba(59,130,246,0.1)', border: '1.5px solid #3b82f6', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '0.4rem' }}>
                <ShieldCheck size={20} /> Tour du Salvateur
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                Choisissez un joueur à protéger contre les loups (interdit de protéger la même personne 2 nuits de suite).
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {allAlivePlayers.map(j => {
                  const isSel    = salvateurCible === j.nom;
                  const disabled = j.nom === salonData.derniere_cible_salvateur;
                  return (
                    <li
                      key={j.id}
                      onClick={() => { if (!disabled) setSalvateurCible(j.nom); }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        background: disabled ? 'rgba(0,0,0,0.45)' : isSel ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                        color: isSel ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-color)',
                        border: isSel ? '1px solid #2563eb' : '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {disabled ? <Ban size={16} /> : <ShieldCheck size={16} style={{ opacity: isSel ? 1 : 0.4 }} />}
                      <span>{j.nom} {disabled && '(Déjà protégé la nuit dernière)'}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={async () => {
                  if (!salvateurCible) return;
                  try {
                    await runTransaction(db, async transaction => {
                      transaction.update(doc(db, 'salons', roomId), {
                        joueur_protege: salvateurCible,
                        derniere_cible_salvateur: salvateurCible,
                        notifications_mj: arrayUnion(`Le Salvateur (${me.nom}) a protégé ${salvateurCible}.`),
                      });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                        a_vote: true,
                        dernier_protege: salvateurCible,
                      });
                    });
                  } catch (e) { console.error(e); }
                }}
                disabled={!salvateurCible}
                className="btn-primary title-font glow-button"
                style={{ marginTop: '1rem', background: '#3b82f6' }}
              >
                <ShieldCheck size={18} /> Protéger {salvateurCible || '...'}
              </button>
            </div>
          )}

          {/* VOYANTE */}
          {salonData.statut === 'nuit_voyante' && me.role === 'voyante' && !me.a_vote && (
            <div style={{ padding: '1.15rem', background: 'rgba(139,92,246,0.1)', border: '1.5px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '0.6rem' }}>
                <Eye size={20} /> Vision de la Voyante
              </h3>
              {voyanteCible ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <p className="text-font" style={{ marginBottom: '0.75rem' }}>
                    L'identité secrète de <strong>{voyanteCible.nom}</strong> est :
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
                    <RoleMedallion role={voyanteCible.roleObj} size="lg" onClick={() => setInspectRole(voyanteCible.roleObj)} />
                    <RoleChip roleObj={voyanteCible.roleObj} onSelectRole={r => setInspectRole(r)} size="md" />
                  </div>
                  <button
                    onClick={async () => {
                      try { await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true }); } catch (e) { console.error(e); }
                    }}
                    className="btn-primary title-font glow-button"
                    style={{ background: '#8b5cf6' }}
                  >
                    Refermer la vision
                  </button>
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {allAlivePlayers.filter(j => j.id !== me.id).map(j => (
                    <li
                      key={j.id}
                      onClick={async () => {
                        const rData = getRole(j.role);
                        setVoyanteCible({ nom: j.nom, roleObj: rData });
                        try {
                          await updateDoc(doc(db, 'salons', roomId), {
                            notifications_mj: arrayUnion(`La Voyante (${me.nom}) a observé la carte de ${j.nom} (${rData?.name || j.role}).`),
                          });
                        } catch (e) { console.error(e); }
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <Eye size={16} style={{ color: '#a78bfa' }} />
                      <span>Observer {j.nom}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* LOUPS-GAROUS */}
          {salonData.statut === 'nuit_loups' && isMeLoup && !me.a_vote && (
            <div style={{ padding: '1.15rem', background: 'rgba(239,68,68,0.1)', border: '1.5px solid #ef4444', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font text-danger" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '0.6rem' }}>
                <PawPrint size={20} /> Chasse de la Meute
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                {loupTargets.map(j => {
                  const isSel = salonData.vote_loup_temporaire === j.nom;
                  return (
                    <li
                      key={j.id}
                      onClick={() => updateDoc(doc(db, 'salons', roomId), { vote_loup_temporaire: j.nom }).catch(() => {})}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)',
                        color: isSel ? '#fff' : 'var(--text-color)',
                        border: isSel ? '1px solid #b91c1c' : '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: isSel ? 700 : 500,
                      }}
                    >
                      <PawPrint size={16} style={{ opacity: isSel ? 1 : 0.35 }} />
                      <span>{j.nom}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Infect Père des Loups */}
              {(me.role === 'infect-pere-des-loups' || me.role === 'pere-des-loups') && me.infection_dispo && !me.infection_repondu ? (
                <div style={{ marginTop: '1.25rem', display: 'flex', gap: '10px', flexDirection: 'column', background: 'rgba(127,29,29,0.3)', padding: '12px', borderRadius: '10px', border: '1px solid #991b1b' }}>
                  <p className="text-font" style={{ color: '#fca5a5', fontSize: '0.9rem', margin: 0, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RoleIcon roleId="infect-pere-des-loups" size={16} /> Pouvoir de l'Infect Père des Loups :
                  </p>
                  <button
                    onClick={async () => {
                      if (!salonData.vote_loup_temporaire) return;
                      try {
                        await runTransaction(db, async transaction => {
                          transaction.update(doc(db, 'salons', roomId), {
                            victime_loups: salonData.vote_loup_temporaire,
                            infection_active: true,
                            notifications_mj: arrayUnion(`L'Infect Père des Loups a infecté la cible : ${salonData.vote_loup_temporaire}.`),
                          });
                          transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                            a_vote: true,
                            infection_dispo: false,
                            infection_repondu: true,
                          });
                        });
                      } catch (e) { console.error(e); }
                    }}
                    disabled={!salonData.vote_loup_temporaire}
                    className="btn-primary title-font glow-button"
                    style={{ background: '#8b5cf6' }}
                  >
                    Infecter {salonData.vote_loup_temporaire || 'la cible'} (Rejoint la meute)
                  </button>
                  <button
                    onClick={async () => {
                      if (!salonData.vote_loup_temporaire) return;
                      try {
                        await runTransaction(db, async transaction => {
                          transaction.update(doc(db, 'salons', roomId), {
                            victime_loups: salonData.vote_loup_temporaire,
                            notifications_mj: arrayUnion(`L'Infect Père des Loups a laissé mourir la cible : ${salonData.vote_loup_temporaire}.`),
                          });
                          transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                            a_vote: true,
                            infection_repondu: true,
                          });
                        });
                      } catch (e) { console.error(e); }
                    }}
                    disabled={!salonData.vote_loup_temporaire}
                    className="btn-secondary title-font"
                    style={{ width: '100%', borderColor: '#ef4444', color: '#ef4444' }}
                  >
                    Dévorer la cible normalement
                  </button>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    if (!salonData.vote_loup_temporaire) return;
                    try {
                      await runTransaction(db, async transaction => {
                        transaction.update(doc(db, 'salons', roomId), {
                          victime_loups: salonData.vote_loup_temporaire,
                          notifications_mj: arrayUnion(`La meute a confirmé sa proie : ${salonData.vote_loup_temporaire}.`),
                        });
                        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true });
                      });
                    } catch (e) { console.error(e); }
                  }}
                  disabled={!salonData.vote_loup_temporaire}
                  className="btn-primary title-font glow-button"
                  style={{ marginTop: '1rem', background: '#ef4444' }}
                >
                  <PawPrint size={18} /> Confirmer la proie
                </button>
              )}
            </div>
          )}

          {/* CHAT SECRET DE LA MEUTE (LOUPS-GAROUS) */}
          {salonData.statut === 'nuit_loups' && isMeLoup && (
            <WolfPackChat
              roomId={roomId}
              salonData={salonData}
              senderName={me.nom}
              isReadOnly={false}
            />
          )}

          {/* SORCIÈRE */}
          {salonData.statut === 'nuit_sorciere' && me.role === 'sorciere' && !me.a_vote_sorciere && (() => {
            const victimVisible = salonData.victime_loups_visible_sorciere ?? null;
            return (
              <div style={{ padding: '1.15rem', background: 'rgba(139,92,246,0.1)', border: '1.5px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem' }}>
                <h3 className="title-font" style={{ color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                  <FlaskConical size={20} /> Grimoire de la Sorcière
                </h3>

                {/* Victime des loups */}
                <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(139,92,246,0.3)' }}>
                  {victimVisible ? (
                    <>
                      <p className="text-font" style={{ fontSize: '0.92rem' }}>
                        Cible attaquée par les loups : <strong style={{ color: '#ef4444' }}>{victimVisible}</strong>
                      </p>
                      {!me.potion_vie_utilisee ? (
                        <button
                          onClick={() => setPotionVieActive(!potionVieActive)}
                          className={`btn-secondary text-font ${potionVieActive ? 'glow-button' : ''}`}
                          style={{ marginTop: '10px', width: '100%', borderColor: potionVieActive ? '#10b981' : '#8b5cf6', color: potionVieActive ? '#10b981' : 'var(--text-color)' }}
                        >
                          <FlaskConical size={16} />
                          <span>{potionVieActive ? 'Potion de Guérison activée (Sauver)' : 'Utiliser la Potion de Guérison'}</span>
                        </button>
                      ) : (
                        <p className="text-font text-muted" style={{ marginTop: '8px', fontSize: '0.84rem' }}>
                          Potion de Guérison déjà utilisée.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-font" style={{ color: 'var(--text-color)', fontSize: '0.9rem' }}>
                      Aucune victime des loups ne requiert votre potion cette nuit.
                    </p>
                  )}
                </div>

                {/* Potion de mort */}
                <div style={{ marginBottom: '1rem' }}>
                  {!me.potion_mort_utilisee ? (
                    <>
                      <button
                        onClick={() => setShowPotionMortSelection(!showPotionMortSelection)}
                        className="btn-secondary text-font"
                        style={{ width: '100%', borderColor: '#ef4444', color: cibleMortLocal ? '#ef4444' : 'var(--text-color)' }}
                      >
                        <Skull size={16} />
                        <span>{cibleMortLocal ? `Poison préparé contre : ${cibleMortLocal}` : 'Utiliser la Potion de Mort'}</span>
                      </button>
                      {showPotionMortSelection && (
                        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
                          {allAlivePlayers.filter(j => j.id !== me.id).map(j => {
                            const isSel = cibleMortLocal === j.nom;
                            return (
                              <li
                                key={j.id}
                                onClick={() => { setCibleMortLocal(isSel ? null : j.nom); if (!isSel) setShowPotionMortSelection(false); }}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)',
                                  color: isSel ? '#fff' : 'var(--text-color)',
                                  border: isSel ? '1px solid #b91c1c' : '1px solid var(--card-border)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                              >
                                <Skull size={15} />
                                <span>{j.nom}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-font text-muted" style={{ fontSize: '0.84rem' }}>Potion de Mort déjà utilisée.</p>
                  )}
                </div>

                <button
                  onClick={async () => {
                    try {
                      await runTransaction(db, async transaction => {
                        const updatesSalon = {};
                        const updatesMe    = { a_vote_sorciere: true };
                        const notifs       = [];
                        if (potionVieActive) {
                          updatesSalon.victime_sauvee = true;
                          updatesMe.potion_vie_utilisee = true;
                          notifs.push(`La Sorcière (${me.nom}) a sauvé la victime des loups.`);
                        }
                        if (cibleMortLocal) {
                          updatesSalon.victime_sorciere = cibleMortLocal;
                          updatesMe.potion_mort_utilisee = true;
                          notifs.push(`La Sorcière (${me.nom}) a empoisonné ${cibleMortLocal}.`);
                        }
                        if (notifs.length === 0) {
                          notifs.push(`La Sorcière (${me.nom}) n'a utilisé aucune potion.`);
                        }
                        updatesSalon.notifications_mj = arrayUnion(...notifs);
                        transaction.update(doc(db, 'salons', roomId), updatesSalon);
                        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), updatesMe);
                      });
                    } catch (err) { console.error(err); }
                  }}
                  className="btn-primary title-font glow-button"
                  style={{ background: '#8b5cf6' }}
                >
                  Terminer mon tour
                </button>
              </div>
            );
          })()}

          {/* CORBEAU (pendant la nuit) */}
          {isNightMode && me.role === 'corbeau' && !salonData.cible_corbeau && (
            <div style={{ padding: '1.15rem', background: 'rgba(71,85,105,0.18)', border: '1.5px solid #64748b', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', marginBottom: '0.4rem' }}>
                <Bird size={20} /> Malédiction du Corbeau
              </h3>
              <p className="text-font text-muted" style={{ fontSize: '0.84rem', marginBottom: '0.85rem' }}>
                Désignez un joueur qui recevra d'office 2 voix contre lui lors du vote de demain :
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                {allAlivePlayers.filter(j => j.id !== me.id).map(j => {
                  const isSel = corbeauCible === j.nom;
                  return (
                    <li
                      key={j.id}
                      onClick={() => setCorbeauCible(j.nom)}
                      style={{
                        padding: '9px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: isSel ? '#475569' : 'rgba(255,255,255,0.05)',
                        color: isSel ? '#fff' : 'var(--text-color)',
                        border: '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <Bird size={15} />
                      <span>{j.nom}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={!corbeauCible}
                onClick={async () => {
                  if (!corbeauCible) return;
                  try {
                    await updateDoc(doc(db, 'salons', roomId), {
                      cible_corbeau: corbeauCible,
                      notifications_mj: arrayUnion(`Le Corbeau (${me.nom}) a maudit ${corbeauCible} (+2 voix au vote).`),
                    });
                  } catch (e) { console.error(e); }
                }}
                className="btn-primary title-font"
                style={{ marginTop: '0.85rem', background: '#475569' }}
              >
                <Bird size={16} /> Maudire {corbeauCible || '...'}
              </button>
            </div>
          )}

          {/* RENARD / RENARD-GAROU (pendant la nuit) */}
          {isNightMode && (me.role === 'renard' || me.role === 'renard-garou') && !me.pouvoir_renard_perdu && !me.a_vote && (
            <div style={{ padding: '1.15rem', background: 'rgba(249,115,22,0.1)', border: '1.5px solid #f97316', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', marginBottom: '0.4rem' }}>
                <ScanSearch size={20} /> Flair du Renard
              </h3>
              {renardResult ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <p className="text-font" style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    Trio flairé : <strong>{renardResult.trioNames.join(', ')}</strong>
                  </p>
                  <p className="title-font" style={{ fontSize: '1.1rem', color: renardResult.hasWolf ? '#ef4444' : '#10b981', marginBottom: '1rem' }}>
                    {renardResult.hasWolf
                      ? 'AU MOINS UN LOUP SE CACHE DANS CE TRIO !'
                      : 'AUCUN LOUP DANS CE TRIO (Vous perdez votre flair).'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-font text-muted" style={{ fontSize: '0.84rem', marginBottom: '0.85rem' }}>
                    Choisissez un joueur pour flairer s'il y a un loup parmi lui et ses 2 voisins vivants :
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                    {allAlivePlayers.map((j, idx) => (
                      <li key={j.id}>
                        <button
                          type="button"
                          onClick={async () => {
                            const len = allAlivePlayers.length;
                            const left = allAlivePlayers[(idx - 1 + len) % len];
                            const right = allAlivePlayers[(idx + 1) % len];
                            const trio = Array.from(new Set([left, j, right]));
                            const hasWolf = trio.some(p => isWolf(p));
                            const trioNames = trio.map(p => p.nom);
                            setRenardResult({ trioNames, hasWolf });
                            try {
                              await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
                                pouvoir_renard_perdu: me.role === 'renard' ? !hasWolf : false,
                              });
                              await updateDoc(doc(db, 'salons', roomId), {
                                notifications_mj: arrayUnion(
                                  `Le Renard (${me.nom}) a flairé [${trioNames.join(', ')}] → ${hasWolf ? 'Présence de Loup' : 'Aucun Loup (flair perdu)'}.`,
                                ),
                              });
                            } catch (e) { console.error(e); }
                          }}
                          className="btn-secondary text-font"
                          style={{ width: '100%', justifyContent: 'flex-start' }}
                        >
                          <ScanSearch size={15} style={{ color: '#f97316' }} />
                          <span>Flairer {j.nom} et ses 2 voisins</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* COMÉDIEN */}
          {me.role === 'comedien' && salonData.roles_dispo_comedien && salonData.roles_dispo_comedien.length > 0 && (
            <button
              onClick={() => setShowComedienModal(true)}
              className="btn-primary title-font glow-button"
              style={{ marginBottom: '1rem', background: '#eab308', color: '#0f172a' }}
            >
              <Drama size={18} /> Incarner un rôle de la réserve ({salonData.roles_dispo_comedien.length} restant(s))
            </button>
          )}
        </div>

        {/* ── VOTE DU VILLAGE (JOUR_VOTE) ─────────────────────────────────── */}
        {salonData.statut === 'jour_vote' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <h3 className="title-font" style={{ color: '#f59e0b', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}>
              <Sun size={20} /> Vote du Village
            </h3>

            {/* Pouvoir Illusionniste */}
            {me.role === 'illusionniste' && me.illusion_dispo && salonData?.la_liste_accuses?.includes(me.nom) && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(139,92,246,0.15)', border: '1.5px solid #8b5cf6', borderRadius: '12px' }}>
                <h4 className="title-font" style={{ color: '#c4b5fd', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={16} /> Pouvoir de l'Illusionniste
                </h4>
                <p className="text-font" style={{ fontSize: '0.85rem', marginBottom: '0.85rem' }}>
                  Vous faites partie des accusés. Activez votre illusion pour survivre si le village vous condamne aujourd'hui.
                </p>
                <button
                  onClick={async () => {
                    if (!window.confirm("Activer l'Illusion pour ce vote ?")) return;
                    try {
                      await updateDoc(doc(db, 'salons', roomId), { illusion_active: true });
                      await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { illusion_dispo: false });
                    } catch (e) { console.error(e); }
                  }}
                  className="btn-primary title-font glow-button"
                  style={{ background: '#8b5cf6' }}
                >
                  <Sparkles size={16} /> Activer mon Illusion secrète
                </button>
              </div>
            )}

            {/* Chat de Défense des Accusés (ouvert dès que la liste des accusés est ouverte) */}
            {salonData?.la_liste_accuses?.length > 0 && (
              <div style={{ marginBottom: '1.15rem' }}>
                <AccusedDefenseChat
                  roomId={roomId}
                  salonData={salonData}
                  senderName={me.nom}
                  isDead={false}
                />
              </div>
            )}

            {me.gracie_idiot ? (
              <div style={{ padding: '1rem', background: 'rgba(132,204,22,0.12)', border: '1.5px solid #84cc16', borderRadius: '12px', textAlign: 'center' }}>
                <p className="text-font" style={{ margin: 0, color: '#a3e635', fontWeight: 700, fontSize: '0.9rem' }}>
                  Vous avez été gracié en tant qu'Idiot du Village : vous êtes en vie mais vous ne pouvez plus voter.
                </p>
              </div>
            ) : !(salonData?.la_liste_accuses?.length > 0) ? (
              <p className="text-font text-muted" style={{ textAlign: 'center', padding: '1.5rem 0', fontStyle: 'italic' }}>
                En attente du Maître du Jeu qui ouvre la liste des accusés...
              </p>
            ) : (
              <>
                <p className="text-font text-muted" style={{ marginBottom: '0.75rem', fontSize: '0.88rem' }}>
                  Qui souhaitez-vous condamner aujourd'hui ?
                </p>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {salonData.la_liste_accuses.filter(nom => nom !== me.nom).map(nom => {
                    const isMyVote = monVote === nom;
                    return (
                      <li
                        key={nom}
                        onClick={async () => {
                          if (monVote) return;
                          if (!window.confirm(`Confirmez-vous votre vote irrévocable contre ${nom} ?`)) return;
                          try {
                            await updateDoc(doc(db, 'salons', roomId), {
                              [`votes.${me.nom}`]: nom,
                            });
                          } catch (e) { console.error(e); }
                        }}
                        style={{
                          padding: '11px 14px',
                          borderRadius: '8px',
                          cursor: monVote ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: isMyVote ? '#ef4444' : 'rgba(255,255,255,0.05)',
                          color: isMyVote ? '#fff' : (monVote ? 'var(--text-muted)' : 'var(--text-color)'),
                          border: isMyVote ? '1px solid #b91c1c' : '1px solid var(--card-border)',
                          opacity: monVote && !isMyVote ? 0.55 : 1,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{nom}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', fontWeight: 700 }}>
                          {isMyVote ? (
                            <><CheckCircle2 size={15} /> Vote enregistré</>
                          ) : monVote ? (
                            <><Lock size={14} /> Verrouillé</>
                          ) : (
                            'Voter contre'
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {monVote && (
                  <p className="text-font" style={{ color: 'var(--success)', marginTop: '0.85rem', textAlign: 'center', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.9rem' }}>
                    <CheckCircle2 size={16} /> Votre vote contre <strong>{monVote}</strong> est enregistré.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Liste des joueurs en vie */}
        <div className="players-list-panel glass-panel" style={{ marginTop: '1.75rem', padding: '1.25rem', borderRadius: '1.25rem', textAlign: 'left' }}>
          <h3 className="title-font" style={{ marginBottom: '0.85rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} style={{ color: 'var(--primary)' }} /> Survivants ({allAlivePlayers.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: '280px', overflowY: 'auto' }} className="text-font">
            {allAlivePlayers.map(j => (
              <li key={j.id} style={{ padding: '9px 6px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--success)' }} />
                  <span style={{ fontWeight: j.id === me.id ? 'bold' : 'normal', color: 'var(--text-color)', fontSize: '0.92rem' }}>
                    {j.nom} {j.id === me.id && '(Vous)'}
                  </span>
                </div>
                {salonData.cible_corbeau === j.nom && (
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                    <Bird size={13} /> +2 voix (Corbeau)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Modal Voleur */}
      {showVoleurModal && (
        <div className="modal-overlay" onClick={() => setShowVoleurModal(false)}>
          <div className="modal-content border-accent" style={{ borderColor: 'var(--danger)' }} onClick={e => e.stopPropagation()}>
            <h3 className="title-font text-danger" style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <VenetianMask size={22} /> Action du Voleur
            </h3>
            <p className="text-font text-muted" style={{ marginBottom: '1.25rem', fontSize: '0.88rem' }}>
              Choisissez un joueur à qui dérober le rôle secret :
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
              {joueurs.filter(j => j.id !== me.id && j.role && j.statut_joueur !== 'mort').map(p => (
                <button
                  key={p.id}
                  onClick={() => handleVoleurAction('activer', p.id)}
                  className="btn-secondary text-font"
                  style={{ justifyContent: 'space-between' }}
                >
                  <span>Voler la carte de <strong>{p.nom}</strong></span>
                  <VenetianMask size={16} />
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowVoleurModal(false)}
              className="btn-secondary text-font"
              style={{ marginTop: '1.25rem', width: '100%' }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Modal Comédien */}
      {showComedienModal && (
        <div className="modal-overlay" onClick={() => setShowComedienModal(false)}>
          <div className="modal-content border-accent" style={{ borderColor: '#fbbf24' }} onClick={e => e.stopPropagation()}>
            <h3 className="title-font" style={{ marginBottom: '0.75rem', color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Drama size={22} /> Réserve du Comédien
            </h3>
            <p className="text-font text-muted" style={{ marginBottom: '1rem', fontSize: '0.86rem' }}>
              Cliquez sur un rôle pour l'incarner ou sur l'icône Info pour lire son pouvoir :
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {salonData.roles_dispo_comedien.map(rId => {
                const rData = getRole(rId);
                return (
                  <div key={rId} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => handleComedienAction(rId)}
                      className="btn-secondary text-font"
                      style={{ flex: 1, color: rData?.color, borderColor: rData?.color, justifyContent: 'flex-start' }}
                    >
                      <RoleIcon roleId={rId} size={18} />
                      <span>Incarner {rData?.name}</span>
                    </button>
                    {rData && (
                      <button
                        type="button"
                        onClick={() => setInspectRole(rData)}
                        className="btn-secondary"
                        style={{ padding: '0.65rem' }}
                        title="Voir la fiche du rôle"
                      >
                        <Info size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setShowComedienModal(false)}
              className="btn-secondary text-font"
              style={{ marginTop: '1.25rem', width: '100%' }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Modals Fiche détaillée, Proposition de Rôle & Grimoire */}
      <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
      <RoleChangeProposalModal roomId={roomId} me={me} onInspectRole={r => setInspectRole(r)} />
      <GrimoireModal
        isOpen={showGrimoire}
        onClose={() => setShowGrimoire(false)}
        onSelectRole={r => setInspectRole(r)}
        activeRoleIds={activeRoleIds}
      />
    </div>
  );
}
