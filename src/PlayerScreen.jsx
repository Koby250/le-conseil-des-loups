import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  runTransaction, writeBatch, arrayRemove, arrayUnion,
} from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import { AlertTriangle, EyeOff, User, Send } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

// ─── Constantes ───────────────────────────────────────────────────────────────
const NIGHT_PHASES = [
  'nuit_cupidon', 'nuit_voleur', 'nuit_salvateur',
  'nuit_voyante', 'nuit_loups', 'nuit_sorciere',
];

// ─── Composant principal ──────────────────────────────────────────────────────
export default function PlayerScreen() {
  const { roomId } = useParams();

  // ── Identité du joueur ──────────────────────────────────────────────────────
  const [playerName, setPlayerName] = useState('');
  const [playerId, setPlayerId]     = useState(
    localStorage.getItem(`loup_garou_${roomId}_playerId`) || null,
  );
  const [isJoined, setIsJoined] = useState(!!playerId);

  // ── Données Firebase ────────────────────────────────────────────────────────
  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs]     = useState([]);
  const [me, setMe]               = useState(null);

  // ── UI générale ─────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showRole, setShowRole] = useState(false);

  // ── États des pouvoirs (tous réinitialisés à chaque changement de phase) ────
  const [showVoleurModal, setShowVoleurModal]             = useState(false);
  const [showComedienModal, setShowComedienModal]         = useState(false);
  const [selectedPlayers, setSelectedPlayers]             = useState([]); // Cupidon
  const [voyanteCible, setVoyanteCible]                   = useState(null);
  const [salvateurCible, setSalvateurCible]               = useState(null);
  const [potionVieActive, setPotionVieActive]             = useState(false);
  const [showPotionMortSelection, setShowPotionMortSelection] = useState(false);
  const [cibleMortLocal, setCibleMortLocal]               = useState(null);
  const [cibleChasseur, setCibleChasseur]                 = useState(null);

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
      },
    );
    return () => { unsubSalon(); unsubJoueurs(); };
  }, [roomId]);

  // ── Synchronisation du "moi" ────────────────────────────────────────────────
  useEffect(() => {
    if (playerId && joueurs.length > 0) {
      const myData = joueurs.find(j => j.id === playerId);
      if (myData) {
        setMe(myData);
        if (myData.carte_choisie === null) setShowRole(false);
      }
    }
  }, [playerId, joueurs]);

  // ── Thème Jour / Nuit ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!salonData) return;
    const dayPhases = ['matin', 'jour_vote', 'jour_resolution'];
    if (NIGHT_PHASES.includes(salonData.statut)) {
      document.body.classList.add('theme-nuit');
      document.body.classList.remove('theme-jour');
    } else if (dayPhases.includes(salonData.statut)) {
      document.body.classList.add('theme-jour');
      document.body.classList.remove('theme-nuit');
    } else {
      document.body.classList.remove('theme-nuit', 'theme-jour');
    }
  }, [salonData?.statut]);

  /**
   * CORRECTIF VOYANTE (et tous les pouvoirs) :
   * Réinitialise tous les états locaux des pouvoirs à chaque changement de phase.
   * Empêche la Voyante (et les autres rôles) de rester bloquée entre deux nuits.
   */
  useEffect(() => {
    setVoyanteCible(null);
    setSalvateurCible(null);
    setSelectedPlayers([]);
    setPotionVieActive(false);
    setShowPotionMortSelection(false);
    setCibleMortLocal(null);
  }, [salonData?.statut]);

  // ── Gestion du couple et de l'Ancien ───────────────────────────────────────
  useEffect(() => {
    if (!salonData?.couple || salonData.couple.length !== 2 || !me) return;
    const aliveStatuses = ['en_vie', 'En couple'];
    if (salonData.couple.includes(me.id) && aliveStatuses.includes(me.statut_joueur)) {
      const partnerId = salonData.couple.find(id => id !== me.id);
      const partner   = joueurs.find(j => j.id === partnerId);
      if (partner && partner.statut_joueur === 'mort') {
        updateDoc(
          doc(db, 'salons', roomId, 'joueurs', me.id),
          { statut_joueur: 'mort' },
        ).catch(console.error);
        return;
      }
    }
    if (me.role === 'cupidon' && me.pouvoir_utilise && me.statut_joueur !== 'mort') {
      const p1 = joueurs.find(j => j.id === salonData.couple[0]);
      const p2 = joueurs.find(j => j.id === salonData.couple[1]);
      if (p1?.statut_joueur === 'mort' && p2?.statut_joueur === 'mort') {
        const isLoup = j => j?.role?.toLowerCase().includes('loup') || j?.est_infecte === true;
        if (!isLoup(p1) && !isLoup(p2)) {
          updateDoc(
            doc(db, 'salons', roomId, 'joueurs', me.id),
            { statut_joueur: 'mort' },
          ).catch(console.error);
        }
      }
    }
  }, [joueurs, salonData?.couple, me?.statut_joueur, me?.id, me?.role, me?.pouvoir_utilise, roomId]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleJoin = async e => {
    e.preventDefault();
    if (!playerName.trim()) return;
    if (salonData && joueurs.length >= salonData.roles_selectionnes.length)
      return setError('Salon complet.');

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
        pouvoir_utilise: false,
        a_vote: false,
        a_vote_sorciere: false,
        vote_jour: null,        // Champ legacy, conservé pour compatibilité
        illusion_dispo: true,
        dernier_protege: null,
        potion_vie_utilisee: false,
        potion_mort_utilisee: false,
        vies: 2,
        infection_dispo: false,
        infection_repondu: false,
        tir_chasseur_fait: false,
      });
      localStorage.setItem(`loup_garou_${roomId}_playerId`, stableId);
      setPlayerId(stableId);
      setIsJoined(true);
    } catch (err) {
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
        infection_dispo: assignedRole === 'infect-pere-des-loups',
      });
    } catch (err) { alert('Erreur.'); }
  };

  const handleVoleurAction = async (action, targetPlayerId = null) => {
    if (!me || me.role !== 'voleur' || me.pouvoir_utilise) return;

    if (action === 'conserver') {
      try {
        await runTransaction(db, async transaction => {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true });
          transaction.update(doc(db, 'salons', roomId), {
            notifications_mj: arrayUnion(`🃏 Le Voleur (${me.nom}) a conservé son pouvoir pour une prochaine nuit.`),
          });
        });
        alert('Pouvoir conservé !');
      } catch (e) { console.error(e); }
      return;
    }

    if (action === 'activer') {
      const targetPlayer = joueurs.find(j => j.id === targetPlayerId);
      if (!targetPlayer || !targetPlayer.role) return alert("Ce joueur n'a pas encore de rôle.");
      if (!window.confirm(`Voler le rôle de ${targetPlayer.nom} ?`)) return;

      try {
        const stolenRoleData = rolesData.find(r => r.id === targetPlayer.role);
        const isLoup = stolenRoleData?.name?.toLowerCase().includes('loup') || false;

        await runTransaction(db, async transaction => {
          const voleurRef = doc(db, 'salons', roomId, 'joueurs', me.id);
          const targetRef = doc(db, 'salons', roomId, 'joueurs', targetPlayerId);
          const targetSnap = await transaction.get(targetRef);

          const vraiRoleCible   = targetSnap.data().role;
          const infecteCible    = targetSnap.data().est_infecte;
          const stolenRoleCheck = rolesData.find(r => r.id === vraiRoleCible);
          const isLoupFinal     = stolenRoleCheck?.name?.toLowerCase().includes('loup') || false;

          transaction.update(voleurRef, {
            role: vraiRoleCible,
            pouvoir_utilise: true,
            a_vote: true,
            statut_joueur: 'en_vie',
            infection_dispo: vraiRoleCible === 'infect-pere-des-loups',
          });

          const targetUpdates = { role: 'voleur' };
          if (isLoupFinal || infecteCible === true) targetUpdates.statut_joueur = 'mort';
          transaction.update(targetRef, targetUpdates);

          transaction.update(doc(db, 'salons', roomId), {
            notifications_mj: arrayUnion(
              `🃏 Le Voleur (${me.nom}) a volé la carte de ${targetPlayer.nom} (${stolenRoleCheck?.name || vraiRoleCible}).`,
            ),
          });
        });

        setShowVoleurModal(false);
        let msg = `Vol réussi ! Vous êtes : ${stolenRoleData?.name || targetPlayer.role}`;
        if (isLoup) msg += '\n⚠️ La cible était un Loup — elle est éliminée.';
        alert(msg);
      } catch (err) { alert('Erreur vol : ' + err.message); }
    }
  };

  const handleComedienAction = async roleId => {
    if (!me || me.role !== 'comedien') return;
    if (!window.confirm('Incarner ce rôle ?')) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
        role: roleId,
        infection_dispo: roleId === 'infect-pere-des-loups',
      });
      batch.update(doc(db, 'salons', roomId), { roles_dispo_comedien: arrayRemove(roleId) });
      await batch.commit();
      setShowComedienModal(false);
    } catch (err) { alert('Erreur.'); }
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
        <div className="player-content" style={{ justifyContent: 'center' }}>
          <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', margin: '0 auto', textAlign: 'center' }}>
            <div className="home-icon glow-effect" style={{ margin: '0 auto 1.5rem' }}>
              <User size={48} />
            </div>
            <h2 className="title-font" style={{ marginBottom: '1rem' }}>Rejoindre le salon {roomId}</h2>
            <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input
                type="text"
                className="text-font"
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-color)' }}
                placeholder="Votre Pseudo"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                maxLength={20}
                required
              />
              <button type="submit" className="btn-primary title-font glow-button" style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <Send size={18} /> Rejoindre
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const myRoleData = me.role ? rolesData.find(r => r.id === me.role) : null;

  // ─── Phase d'attente / Choix des cartes ───────────────────────────────────
  if (salonData.statut === 'en_attente') {
    // Mode manuel — en attente d'attribution par le MJ
    if (salonData.distribution_mode === 'manuelle' && !me.role) {
      return (
        <div className="player-screen">
          <ThemeToggle />
          <div className="player-content">
            <div>
              <span className="room-badge">SALON {roomId}</span>
              <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
              <p className="text-font text-muted">Le MJ distribue les rôles manuellement. Veuillez patienter...</p>
            </div>
          </div>
        </div>
      );
    }

    // Mode aléatoire — choix de la carte
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
              <span className="room-badge">SALON {roomId}</span>
              <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
              <p className="text-font text-muted">Choisissez une carte pour découvrir votre rôle.</p>
            </div>
            <div className="cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '15px', marginTop: '2rem' }}>
              {allCards.map(index => {
                if (takenCards.includes(index)) return null;
                return (
                  <button
                    key={index}
                    onClick={() => handlePickCard(index)}
                    className="mystery-card glass-panel text-font"
                    style={{ height: '120px', fontSize: '2rem', fontWeight: 'bold', borderRadius: '12px' }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    // Rôle assigné — Flip Card de révélation
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: myRoleData?.color || '#000' }} />
        <div className="player-content">
          <div>
            <span className="room-badge">SALON {roomId}</span>
            <h1 className="player-title">La nuit va bientôt tomber...</h1>
          </div>
          <div className="perspective-container">
            <button onClick={() => setShowRole(!showRole)} className={`flip-card ${showRole ? 'flipped' : ''}`}>
              <div className="flip-card-front">
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                  <EyeOff size={32} style={{ color: 'var(--text-color)' }} />
                </div>
                <p>Carte Mystère</p>
                <small>Appuyez pour révéler</small>
              </div>
              <div
                className="flip-card-back"
                style={{ borderColor: myRoleData?.color, boxShadow: `0 10px 40px ${myRoleData?.color}40` }}
              >
                <div className="card-gradient" style={{ background: `linear-gradient(to bottom, ${myRoleData?.color}30, transparent)` }} />
                <div className="card-inner">
                  <h2 className="role-name" style={{ color: myRoleData?.color }}>{myRoleData?.name}</h2>
                  <div className="role-divider" style={{ backgroundColor: myRoleData?.color }} />
                  <div className="role-desc">{myRoleData?.description}</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE DE JEU (après lancement)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Early return : Fin de partie ──────────────────────────────────────────
  if (salonData?.statut === 'fin_village' || salonData?.statut === 'fin_loups') {
    const isVillageWin = salonData.statut === 'fin_village';
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: isVillageWin ? '#064e3b' : '#450a0a' }} />
        <div className="player-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center' }}>
          <h1 className="title-font" style={{ fontSize: '3rem', color: isVillageWin ? '#10b981' : '#ef4444', marginBottom: '1rem', textShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
            {isVillageWin ? '🎉 VICTOIRE DU VILLAGE !' : '🐺 VICTOIRE DES LOUPS !'}
          </h1>
          <p className="text-font" style={{ fontSize: '1.5rem', color: '#f8fafc', marginBottom: '3rem' }}>
            {isVillageWin ? 'Tous les loups ont été éliminés !' : 'Le village a été dévoré !'}
          </p>
          
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '1.5rem', textAlign: 'left', margin: '0 auto' }}>
            <h3 className="title-font" style={{ marginBottom: '1rem', color: 'var(--text-color)', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem' }}>
              Rôles de la partie
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {joueurs.map(j => {
                const rObj = rolesData.find(r => r.id === j.role);
                return (
                  <li key={j.id} className="text-font" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
                    <span style={{ color: j.statut_joueur === 'mort' ? 'var(--text-muted)' : 'var(--text-color)', textDecoration: j.statut_joueur === 'mort' ? 'line-through' : 'none', fontWeight: 'bold' }}>
                      {j.nom}
                    </span>
                    <span style={{ color: rObj?.color || 'var(--text-muted)', fontWeight: 'bold' }}>
                      {rObj?.name || j.role} {j.est_infecte === true && '(Infecté)'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const isDead         = me.statut_joueur === 'mort';
  const allAlivePlayers = joueurs.filter(j => j.statut_joueur !== 'mort');
  const isMeLoup       = me.role?.toLowerCase().includes('loup') || me.est_infecte === true;
  const loupTargets    = allAlivePlayers.filter(j => !(j.role?.toLowerCase().includes('loup') || j.est_infecte === true));
  const compagnonsLoups = isMeLoup
    ? joueurs.filter(j => (j.role?.toLowerCase().includes('loup') || j.est_infecte === true) && j.id !== me.id && j.statut_joueur !== 'mort')
    : [];
  const isNightMode    = NIGHT_PHASES.includes(salonData?.statut);

  // Vote simultané — lecture depuis le document salon
  const monVote = salonData?.votes?.[me.nom] || null;

  // ─── Early return : Chasseur mort — tir de vengeance ─────────────────────
  if (isDead && me.role === 'chasseur' && me.tir_chasseur_fait === false) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: '#450a0a' }} />
        <div className="player-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="room-badge">SALON {roomId}</span>
            <span className="room-badge" style={{ background: 'var(--danger)', color: 'white', border: '1px solid #dc2626' }}>MORT</span>
          </div>
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(239,68,68,0.1)', border: '2px solid #ef4444', borderRadius: '12px', textAlign: 'center' }}>
            <h3 className="title-font" style={{ color: '#ef4444', marginBottom: '1rem' }}>🎯 Vous avez été éliminé !</h3>
            <p className="text-font" style={{ marginBottom: '1.5rem', color: '#f8fafc' }}>
              Dans un dernier souffle, choisissez le joueur que vous emportez dans la tombe.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.5rem' }}>
              {allAlivePlayers.map(j => {
                const isSel = cibleChasseur === j.nom;
                return (
                  <li
                    key={j.id}
                    onClick={() => setCibleChasseur(j.nom)}
                    style={{ padding: '12px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #b91c1c' : '1px solid transparent' }}
                  >
                    {isSel ? '🎯' : '○'} {j.nom}
                  </li>
                );
              })}
            </ul>
            <button
              onClick={async () => {
                if (!cibleChasseur) return;
                if (!window.confirm(`Tirer sur ${cibleChasseur} ? Il/Elle mourra instantanément.`)) return;
                try {
                  await runTransaction(db, async transaction => {
                    const targetDoc = joueurs.find(j => j.nom === cibleChasseur);
                    if (targetDoc) {
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', targetDoc.id), { statut_joueur: 'mort' });
                    }
                    transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { tir_chasseur_fait: true });
                    transaction.update(doc(db, 'salons', roomId), {
                      notifications_mj: arrayUnion(`🎯 Le Chasseur a éliminé ${cibleChasseur} dans son dernier souffle.`),
                    });
                  });
                } catch (e) { console.error(e); }
              }}
              disabled={!cibleChasseur}
              className="btn-primary title-font glow-button"
              style={{ width: '100%', background: '#ef4444', border: 'none', fontSize: '1.2rem', padding: '15px' }}
            >
              🔥 Tirer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Early return : Mode Fantôme (joueur mort hors Chasseur) ─────────────
  if (isDead) {
    const phaseLabel = salonData.statut.replace(/_/g, ' ').toUpperCase();
    return (
      <div className="player-screen">
        <ThemeToggle />
        {/* Fond spectral sombre */}
        <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at center, rgba(139,92,246,0.12) 0%, rgba(0,0,0,0) 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <div className="player-content" style={{ position: 'relative', zIndex: 1 }}>

          {/* Bandeau Fantôme */}
          <div style={{ marginBottom: '1.5rem', padding: '12px 20px', background: 'rgba(139,92,246,0.15)', border: '2px solid #7c3aed', borderRadius: '12px', textAlign: 'center', backdropFilter: 'blur(8px)' }}>
            <p className="title-font" style={{ margin: 0, color: '#c4b5fd', fontSize: '1rem', letterSpacing: '0.05em' }}>
              👻 Mode Fantôme — Vous voyez tout le jeu dans l'ombre, gardez le secret !
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span className="room-badge">SALON {roomId}</span>
            <span className="room-badge" style={{ background: 'rgba(139,92,246,0.3)', color: '#c4b5fd', border: '1px solid #7c3aed' }}>SPECTRE</span>
          </div>

          {/* Phase actuelle */}
          <div style={{ padding: '1rem', background: 'var(--input-bg)', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--card-border)' }}>
            <p className="text-font" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>Phase actuelle</p>
            <p className="title-font" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--primary)' }}>{phaseLabel}</p>
          </div>

          {/* Infos de la nuit (si phase nuit) */}
          {isNightMode && (
            <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p className="title-font" style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '4px' }}>👁️ Vision spectrale de la nuit</p>
              <p className="text-font" style={{ margin: 0 }}>
                🐺 Cible des loups : <strong style={{ color: '#ef4444' }}>{salonData.victime_loups || 'Non confirmée'}</strong>
              </p>
              <p className="text-font" style={{ margin: 0 }}>
                🛡️ Joueur protégé : <strong style={{ color: '#3b82f6' }}>{salonData.joueur_protege || 'Personne'}</strong>
              </p>
              {salonData.infection_active && (
                <p className="text-font" style={{ margin: 0, color: '#a78bfa', fontWeight: 'bold' }}>
                  🧪 L'Infect Père des Loups a activé l'infection !
                </p>
              )}
            </div>
          )}

          {/* Vote (si jour_vote) */}
          {salonData.statut === 'jour_vote' && (
            <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', marginBottom: '1rem' }}>
              <p className="title-font" style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>☀️ Vote du village en cours</p>
              {Object.entries(salonData.votes || {}).length === 0 ? (
                <p className="text-font text-muted" style={{ margin: 0 }}>Aucun vote encore.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {Object.entries(salonData.votes).map(([votant, cible]) => (
                    <li key={votant} className="text-font" style={{ padding: '6px 0', borderBottom: '1px solid var(--card-border)', color: 'var(--text-color)' }}>
                      <strong>{votant}</strong> → {cible}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Liste complète des joueurs avec rôles (vision omnisciente) */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="title-font" style={{ marginBottom: '1rem', fontSize: '1.1rem', color: '#c4b5fd' }}>
              👥 Tableau omniscient des joueurs
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {joueurs.map(j => {
                const rObj     = j.role ? rolesData.find(r => r.id === j.role) : null;
                const isDead_j = j.statut_joueur === 'mort';
                return (
                  <li
                    key={j.id}
                    className="text-font"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '8px', background: isDead_j ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.04)', opacity: isDead_j ? 0.6 : 1, border: '1px solid var(--card-border)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isDead_j ? 'var(--danger)' : j.est_infecte === true ? '#a78bfa' : 'var(--success)' }} />
                      <span style={{ fontWeight: j.id === me.id ? 'bold' : 'normal', color: 'var(--text-color)' }}>
                        {j.nom} {j.id === me.id && '(Vous)'}
                      </span>
                    </div>
                    <span style={{ color: rObj?.color || 'var(--text-muted)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                      {isDead_j ? '💀' : ''} {rObj?.name || '—'}
                      {j.est_infecte === true ? ' (Infecté)' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉCRAN NORMAL — Joueur vivant en phase de jeu
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="player-screen">
      <ThemeToggle />
      <div className="ambient-bg" style={{ backgroundColor: 'transparent' }} />
      <div className="player-content">

        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="room-badge">SALON {roomId}</span>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="player-title" style={{ fontSize: '1.8rem', margin: 0, color: 'var(--text-color)' }}>{me.nom}</h1>
            <p className="text-font" style={{ color: isNightMode ? '#f8fafc' : '#111827', fontWeight: 'bold', display: 'inline-block', marginTop: '6px' }}>
              {showRole ? (myRoleData?.name || 'Rôle Inconnu') : 'Rôle Masqué'}
            </p>
          </div>
          <button
            onClick={() => setShowRole(!showRole)}
            className="btn-secondary text-font"
            style={{ padding: '8px 12px', fontSize: '0.9rem', borderColor: '#6b7280', color: 'var(--text-color)' }}
          >
            {showRole ? 'Cacher' : 'Voir Rôle'}
          </button>
        </div>

        {/* Verdict de la nuit (affiché au matin pour tous) */}
        {salonData?.statut === 'jour_vote' && (() => {
          const morts = [];
          if (salonData.morts_nuit?.loups)    morts.push(salonData.morts_nuit.loups);
          if (salonData.morts_nuit?.sorciere) morts.push(salonData.morts_nuit.sorciere);
          const uniqueMorts = [...new Set(morts)];
          return uniqueMorts.length > 0 ? (
            <div style={{ marginTop: '1.5rem', background: 'rgba(239,68,68,0.15)', border: '2px solid #ef4444', borderRadius: '12px', padding: '1.5rem', textAlign: 'center', boxShadow: '0 0 20px rgba(239,68,68,0.2)' }}>
              <h3 className="title-font" style={{ color: '#ef4444', fontSize: '1.2rem', margin: 0 }}>
                💀 VERDICT DE LA NUIT : Les joueurs suivants ont été éliminés : {uniqueMorts.join(', ')}.
              </h3>
            </div>
          ) : (
            <div style={{ marginTop: '1.5rem', background: 'rgba(16,185,129,0.15)', border: '2px solid #10b981', borderRadius: '12px', padding: '1.5rem', textAlign: 'center', boxShadow: '0 0 20px rgba(16,185,129,0.2)' }}>
              <h3 className="title-font" style={{ color: '#10b981', fontSize: '1.2rem', margin: 0 }}>
                ✨ VERDICT DE LA NUIT : Pas de mort ce matin !
              </h3>
            </div>
          );
        })()}

        {/* Couple */}
        {salonData?.couple?.includes(me.id) && (() => {
          const partnerId = salonData.couple.find(id => id !== me.id);
          const partner   = joueurs.find(j => j.id === partnerId);
          if (!partner) return null;
          return (
            <div style={{ marginTop: '1rem', padding: '12px 14px', background: 'rgba(236,72,153,0.15)', border: '2px solid #ec4899', borderRadius: '10px' }}>
              <p className="text-font" style={{ margin: 0, color: '#ec4899', fontWeight: 'bold' }}>
                💖 En couple avec {partner.nom}
              </p>
            </div>
          );
        })()}

        {/* Compagnons loups */}
        {isMeLoup && showRole && compagnonsLoups.length > 0 && (
          <div style={{ marginTop: '1rem', padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '2px solid #ef4444', borderRadius: '10px' }}>
            <p className="text-font" style={{ margin: 0, color: '#ef4444', fontWeight: 'bold' }}>🐺 Tes compagnons loups :</p>
            <ul style={{ margin: '6px 0 0', padding: '0 0 0 1.2rem' }} className="text-font">
              {compagnonsLoups.map(j => {
                const exactRoleName = rolesData.find(r => r.id === j.role)?.name || j.role;
                return (
                  <li key={j.id} style={{ color: '#fca5a5', marginTop: '4px' }}>
                    {j.nom} ({exactRoleName}{j.est_infecte === true ? ' - Infecté' : ''})
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {isMeLoup && showRole && compagnonsLoups.length === 0 && (
          <div style={{ marginTop: '1rem', padding: '10px 14px', background: 'rgba(239,68,68,0.07)', border: '1px solid #ef444488', borderRadius: '10px' }}>
            <p className="text-font" style={{ margin: 0, color: '#ef4444', fontSize: '0.9rem' }}>🐺 Tu es seul loup en vie ce soir.</p>
          </div>
        )}

        {/* ── SECTION POUVOIRS ────────────────────────────────────────────── */}
        <div className="powers-section" style={{ marginTop: '2rem' }}>

          {/* CUPIDON */}
          {salonData.statut === 'nuit_cupidon' && me.role === 'cupidon' && !me.pouvoir_utilise && (
            <div style={{ padding: '1rem', background: 'rgba(236,72,153,0.1)', border: '1px solid #ec4899', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#ec4899' }}>Cupidon</h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>Sélectionnez 2 joueurs pour former le couple.</p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {allAlivePlayers.map(j => {
                  const isSel = selectedPlayers.includes(j.id);
                  return (
                    <li
                      key={j.id}
                      onClick={() => {
                        if (isSel) setSelectedPlayers(selectedPlayers.filter(id => id !== j.id));
                        else if (selectedPlayers.length < 2) setSelectedPlayers([...selectedPlayers, j.id]);
                      }}
                      style={{ padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ec4899' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #be185d' : '1px solid transparent' }}
                    >
                      {isSel ? '♥️' : '○'} {j.nom}
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
                        notifications_mj: arrayUnion(`💖 Cupidon (${me.nom}) a mis en couple ${j1} et ${j2}.`),
                      });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { pouvoir_utilise: true, a_vote: true });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[0]), { statut_joueur: 'En couple' });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[1]), { statut_joueur: 'En couple' });
                    });
                  } catch (e) { console.error(e); }
                }}
                disabled={selectedPlayers.length !== 2}
                className="btn-primary title-font glow-button"
                style={{ marginTop: '1rem', width: '100%', background: '#ec4899', border: 'none' }}
              >
                Valider le couple
              </button>
            </div>
          )}

          {/* VOLEUR */}
          {salonData.statut === 'nuit_voleur' && me.role === 'voleur' && !me.a_vote && (
            <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font text-danger">Action du Voleur</h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>Vous pouvez voler le rôle d'un joueur ou conserver votre pouvoir.</p>
              <button onClick={() => setShowVoleurModal(true)} className="btn-primary title-font glow-button" style={{ width: '100%', marginBottom: '1rem', background: 'var(--danger)', border: 'none' }}>
                Activer mon pouvoir
              </button>
              <button onClick={() => handleVoleurAction('conserver')} className="btn-secondary text-font" style={{ width: '100%', justifyContent: 'center' }}>
                Conserver mon pouvoir
              </button>
            </div>
          )}

          {/* SALVATEUR */}
          {salonData.statut === 'nuit_salvateur' && me.role === 'salvateur' && !me.a_vote && (
            <div style={{ padding: '1rem', background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#3b82f6' }}>🛡️ Tour du Salvateur</h3>
              <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                Protégez un joueur. Vous ne pouvez pas protéger la même personne deux nuits de suite.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {allAlivePlayers.map(j => {
                  const isSel    = salvateurCible === j.nom;
                  // CORRECTIF : lit la restriction depuis le document salon (robuste sur reload)
                  const disabled = j.nom === salonData.derniere_cible_salvateur;
                  return (
                    <li
                      key={j.id}
                      onClick={() => { if (!disabled) setSalvateurCible(j.nom); }}
                      style={{ padding: '10px', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? 'rgba(0,0,0,0.5)' : isSel ? '#3b82f6' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-color)' }}
                    >
                      {isSel ? '🛡️' : disabled ? '🚫' : '○'} {j.nom} {disabled && '(Protégé dernièrement)'}
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
                        derniere_cible_salvateur: salvateurCible,   // Persiste pour bloquer au prochain tour
                        notifications_mj: arrayUnion(`🛡️ Salvateur (${me.nom}) a protégé ${salvateurCible}.`),
                      });
                      transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                        a_vote: true,
                        dernier_protege: salvateurCible,    // Legacy — conservé pour compatibilité
                      });
                    });
                  } catch (e) { console.error(e); }
                }}
                disabled={!salvateurCible}
                className="btn-primary title-font glow-button"
                style={{ marginTop: '1rem', width: '100%', background: '#3b82f6', border: 'none' }}
              >
                Protéger {salvateurCible}
              </button>
            </div>
          )}

          {/* VOYANTE */}
          {salonData.statut === 'nuit_voyante' && me.role === 'voyante' && !me.a_vote && (
            <div style={{ padding: '1rem', background: 'rgba(139,92,246,0.1)', border: '1px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font" style={{ color: '#8b5cf6' }}>👁️ Tour de la Voyante</h3>
              {voyanteCible ? (
                <div style={{ textAlign: 'center' }}>
                  <p className="text-font" style={{ marginBottom: '1rem' }}>Le rôle de {voyanteCible.nom} est :</p>
                  <h2 className="title-font" style={{ color: voyanteCible.roleObj?.color, fontSize: '2rem', marginBottom: '1rem' }}>
                    {voyanteCible.roleObj?.name}
                  </h2>
                  <button
                    onClick={async () => {
                      try { await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true }); } catch (e) { console.error(e); }
                    }}
                    className="btn-primary title-font glow-button"
                    style={{ width: '100%', background: '#8b5cf6', border: 'none' }}
                  >
                    Fermer les yeux
                  </button>
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {allAlivePlayers.filter(j => j.id !== me.id).map(j => (
                    <li
                      key={j.id}
                      onClick={async () => {
                        const rData = rolesData.find(r => r.id === j.role);
                        setVoyanteCible({ nom: j.nom, roleObj: rData });
                        try {
                          await updateDoc(doc(db, 'salons', roomId), {
                            notifications_mj: arrayUnion(`👁️ Voyante (${me.nom}) regarde la carte de ${j.nom}.`),
                          });
                        } catch (e) { console.error(e); }
                      }}
                      style={{ padding: '10px', borderRadius: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px' }}
                    >
                      👁️ {j.nom}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* LOUPS-GAROUS */}
          {salonData.statut === 'nuit_loups' && isMeLoup && !me.a_vote && (
            <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '12px', marginBottom: '1rem' }}>
              <h3 className="title-font text-danger">🐺 Tour des Loups</h3>
              <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {loupTargets.map(j => {
                  const isSel = salonData.vote_loup_temporaire === j.nom;
                  return (
                    <li
                      key={j.id}
                      onClick={() => updateDoc(doc(db, 'salons', roomId), { vote_loup_temporaire: j.nom }).catch(() => {})}
                      style={{ padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #b91c1c' : '1px solid transparent' }}
                    >
                      {isSel ? '🩸' : '○'} {j.nom}
                    </li>
                  );
                })}
              </ul>

              {/* Infect Père des Loups */}
              {me.role === 'infect-pere-des-loups' && me.infection_dispo && !me.infection_repondu ? (
                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', flexDirection: 'column', background: 'rgba(127,29,29,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid #991b1b' }}>
                  <p className="text-font" style={{ color: '#fca5a5', fontSize: '0.95rem', margin: '0 0 10px', fontWeight: 'bold' }}>
                    🧪 Confirmez le choix pour la meute :
                  </p>
                  <button
                    onClick={async () => {
                      if (!salonData.vote_loup_temporaire) return;
                      try {
                        await runTransaction(db, async transaction => {
                          transaction.update(doc(db, 'salons', roomId), {
                            victime_loups: salonData.vote_loup_temporaire,
                            infection_active: true,
                            notifications_mj: arrayUnion(`🧪 L'Infect Père des Loups a infecté la cible : ${salonData.vote_loup_temporaire}.`),
                          });
                          transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                            a_vote: true,
                            infection_dispo: false,
                            infection_repondu: true,
                          });
                        });
                        alert("Votre meute s'agrandit !");
                      } catch (e) { console.error(e); }
                    }}
                    disabled={!salonData.vote_loup_temporaire}
                    className="btn-primary title-font glow-button"
                    style={{ width: '100%', background: '#8b5cf6', border: 'none' }}
                  >
                    Infecter la cible
                  </button>
                  <button
                    onClick={async () => {
                      if (!salonData.vote_loup_temporaire) return;
                      try {
                        await runTransaction(db, async transaction => {
                          transaction.update(doc(db, 'salons', roomId), {
                            victime_loups: salonData.vote_loup_temporaire,
                            notifications_mj: arrayUnion(`🐺 L'Infect Père des Loups a refusé d'infecter. La cible est : ${salonData.vote_loup_temporaire}.`),
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
                    style={{ width: '100%', border: '1px solid #ef4444', color: '#ef4444', justifyContent: 'center' }}
                  >
                    Laisser mourir
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
                          notifications_mj: arrayUnion(`🐺 Un loup a confirmé la cible : ${salonData.vote_loup_temporaire}.`),
                        });
                        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true });
                      });
                    } catch (e) { console.error(e); }
                  }}
                  disabled={!salonData.vote_loup_temporaire}
                  className="btn-primary title-font glow-button"
                  style={{ marginTop: '1rem', width: '100%', background: '#ef4444', border: 'none' }}
                >
                  Confirmer le festin
                </button>
              )}
            </div>
          )}

          {/* SORCIÈRE
              CORRECTIF ANCIEN : la Sorcière lit `victime_loups_visible_sorciere`
              (null si L'Ancien a absorbé le coup, ou si infection active, ou si Salvateur a protégé).
              Elle voit alors "pas de victime" et ne peut pas utiliser sa potion de vie.
          */}
          {salonData.statut === 'nuit_sorciere' && me.role === 'sorciere' && !me.a_vote_sorciere && (() => {
            const victimVisible = salonData.victime_loups_visible_sorciere ?? null;
            return (
              <div style={{ padding: '1rem', background: 'rgba(139,92,246,0.1)', border: '1px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem' }}>
                <h3 className="title-font" style={{ color: '#8b5cf6' }}>🧙‍♀️ Tour de la Sorcière</h3>

                {/* Victime des loups (ou absence) */}
                <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(139,92,246,0.3)' }}>
                  {victimVisible ? (
                    <>
                      <p className="text-font">
                        🐺 Les loups ont décidé de tuer : <strong>{victimVisible}</strong>
                      </p>
                      {!me.potion_vie_utilisee ? (
                        <button
                          onClick={() => setPotionVieActive(!potionVieActive)}
                          className={`btn-secondary text-font ${potionVieActive ? 'glow-button' : ''}`}
                          style={{ marginTop: '10px', width: '100%', borderColor: potionVieActive ? '#10b981' : '#8b5cf6', color: potionVieActive ? '#10b981' : 'var(--text-color)', justifyContent: 'center' }}
                        >
                          {potionVieActive ? '✅ Potion de Vie (Sauver)' : '🧪 Utiliser Potion de Vie'}
                        </button>
                      ) : (
                        <p className="text-font text-muted" style={{ marginTop: '10px' }}>🧪 Potion de vie indisponible</p>
                      )}
                    </>
                  ) : (
                    // L'Ancien a absorbé le coup, infection active, ou Salvateur a protégé
                    <p className="text-font" style={{ color: '#f8fafc' }}>
                      🐺 Les loups n'ont fait aucune victime cette nuit.
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
                        style={{ width: '100%', borderColor: '#ef4444', color: cibleMortLocal ? '#ef4444' : 'var(--text-color)', justifyContent: 'center' }}
                      >
                        {cibleMortLocal ? `💀 Cible de mort : ${cibleMortLocal}` : '💀 Utiliser Potion de Mort'}
                      </button>
                      {showPotionMortSelection && (
                        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {allAlivePlayers.filter(j => j.id !== me.id).map(j => {
                            const isSel = cibleMortLocal === j.nom;
                            return (
                              <li
                                key={j.id}
                                onClick={() => { setCibleMortLocal(isSel ? null : j.nom); if (!isSel) setShowPotionMortSelection(false); }}
                                style={{ padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #b91c1c' : '1px solid transparent' }}
                              >
                                {isSel ? '💀' : '○'} {j.nom}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-font text-muted">💀 Potion de mort indisponible</p>
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
                          notifs.push(`🧪 Sorcière (${me.nom}) a sauvé la victime des loups.`);
                        }
                        if (cibleMortLocal) {
                          updatesSalon.victime_sorciere = cibleMortLocal;
                          updatesMe.potion_mort_utilisee = true;
                          notifs.push(`💀 Sorcière (${me.nom}) a tué ${cibleMortLocal}.`);
                        }
                        if (notifs.length === 0) {
                          notifs.push(`🧙‍♀️ Sorcière (${me.nom}) n'a rien fait.`);
                        }
                        updatesSalon.notifications_mj = arrayUnion(...notifs);
                        if (Object.keys(updatesSalon).length > 0)
                          transaction.update(doc(db, 'salons', roomId), updatesSalon);
                        transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), updatesMe);
                      });
                    } catch (err) { console.error(err); }
                  }}
                  className="btn-primary title-font glow-button"
                  style={{ width: '100%', background: '#8b5cf6', border: 'none' }}
                >
                  Terminer le tour
                </button>
              </div>
            );
          })()}

          {/* COMÉDIEN */}
          {me.role === 'comedien' && salonData.roles_dispo_comedien && salonData.roles_dispo_comedien.length > 0 && (
            <button
              onClick={() => setShowComedienModal(true)}
              className="btn-primary title-font glow-button"
              style={{ width: '100%', marginBottom: '1rem', background: '#fbbf24', color: 'black', border: 'none' }}
            >
              Incarner un Rôle
            </button>
          )}
        </div>

        {/* ── VOTE DU VILLAGE (JOUR_VOTE) ─────────────────────────────────── */}
        {salonData.statut === 'jour_vote' && (
          <div style={{ marginTop: '2rem' }}>
            <h3 className="title-font" style={{ color: '#f59e0b', marginBottom: '1rem' }}>☀️ Phase de Vote du Village</h3>

            {/* Pouvoir Illusionniste */}
            {me.role === 'illusionniste' && me.illusion_dispo && salonData?.la_liste_accuses?.includes(me.nom) && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(139,92,246,0.15)', border: '1px solid #8b5cf6', borderRadius: '12px' }}>
                <h4 className="title-font" style={{ color: '#c4b5fd', marginBottom: '0.5rem' }}>✨ Pouvoir de l'Illusionniste</h4>
                <p className="text-font" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Vous pouvez annuler la mort du prochain condamné au bûcher. Utilisable 1 fois.
                </p>
                <button
                  onClick={async () => {
                    if (!window.confirm("Activer l'Illusion pour ce vote ?")) return;
                    try {
                      await updateDoc(doc(db, 'salons', roomId), { illusion_active: true });
                      await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { illusion_dispo: false });
                      alert('Illusion activée secrètement pour le vote de ce jour !');
                    } catch (e) { console.error(e); }
                  }}
                  className="btn-primary title-font glow-button"
                  style={{ width: '100%', background: '#8b5cf6', border: 'none' }}
                >
                  Activer mon Illusion
                </button>
              </div>
            )}

            {!(salonData?.la_liste_accuses?.length > 0) ? (
              <p className="text-font text-muted" style={{ textAlign: 'center', padding: '2rem 0', fontStyle: 'italic' }}>
                ⏳ En attente du MJ qui désigne les accusés du jour...
              </p>
            ) : (
              <>
                <p className="text-font text-muted" style={{ marginBottom: '1rem' }}>
                  Les accusés du jour sont désignés. Qui voulez-vous éliminer ?
                </p>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {salonData.la_liste_accuses.filter(nom => nom !== me.nom).map(nom => {
                    const isMyVote = monVote === nom;
                    return (
                      <li
                        key={nom}
                        onClick={async () => {
                          if (monVote) return; // Vote déjà enregistré — verrou strict
                          if (!window.confirm(`Confirmez-vous votre vote irrévocable contre ${nom} ?`)) return;
                          try {
                            // CORRECTIF VOTE SIMULTANÉ : notation pointée pour ne pas écraser les autres
                            await updateDoc(doc(db, 'salons', roomId), {
                              [`votes.${me.nom}`]: nom,
                            });
                          } catch (e) { console.error(e); }
                        }}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          cursor: monVote ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: isMyVote ? '#ef4444' : 'rgba(255,255,255,0.05)',
                          color: isMyVote ? '#fff' : (monVote ? 'rgba(255,255,255,0.3)' : 'var(--text-color)'),
                          border: isMyVote ? '1px solid #b91c1c' : '1px solid transparent',
                          opacity: monVote && !isMyVote ? 0.5 : 1,
                        }}
                      >
                        <span>{nom}</span>
                        <span>{isMyVote ? '✅ Vous avez voté' : (monVote ? 'Bloqué' : 'Voter contre')}</span>
                      </li>
                    );
                  })}
                </ul>
                {monVote && (
                  <p className="text-font" style={{ color: 'var(--success)', marginTop: '1rem', textAlign: 'center', fontWeight: 'bold' }}>
                    ✅ Votre vote pour <strong>{monVote}</strong> a bien été enregistré.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Liste des joueurs en vie */}
        <div className="players-list-panel glass-panel" style={{ marginTop: '2rem' }}>
          <h3 className="title-font" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem', fontSize: '1.2rem' }}>
            Joueurs en vie
          </h3>
          <ul style={{ listStyle: 'none', padding: 0 }} className="text-font">
            {joueurs.filter(j => j.statut_joueur !== 'mort').map(j => (
              <li key={j.id} style={{ padding: '10px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)' }} />
                <span style={{ fontWeight: j.id === me.id ? 'bold' : 'normal', color: 'var(--text-color)' }}>
                  {j.nom} {j.id === me.id && '(Vous)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Modal Voleur */}
      {showVoleurModal && (
        <div className="modal-overlay">
          <div className="modal-content border-accent" style={{ borderColor: 'var(--danger)' }}>
            <h3 className="title-font text-danger" style={{ marginBottom: '1rem' }}>Action du Voleur</h3>
            <p className="text-font text-muted" style={{ marginBottom: '1.5rem' }}>
              Choisissez un joueur à voler. Votre rôle précédent sera perdu.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '50vh', overflowY: 'auto' }}>
              {joueurs.filter(j => j.id !== me.id && j.role && j.statut_joueur !== 'mort').map(p => (
                <button
                  key={p.id}
                  onClick={() => handleVoleurAction('activer', p.id)}
                  className="btn-secondary text-font"
                  style={{ justifyContent: 'flex-start' }}
                >
                  Voler {p.nom}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowVoleurModal(false)}
              className="btn-secondary text-font"
              style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Modal Comédien */}
      {showComedienModal && (
        <div className="modal-overlay">
          <div className="modal-content border-accent" style={{ borderColor: '#fbbf24' }}>
            <h3 className="title-font" style={{ marginBottom: '1rem', color: '#fbbf24' }}>Action du Comédien</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {salonData.roles_dispo_comedien.map(rId => {
                const rData = rolesData.find(rd => rd.id === rId);
                return (
                  <button
                    key={rId}
                    onClick={() => handleComedienAction(rId)}
                    className="btn-secondary text-font"
                    style={{ color: rData?.color, borderColor: rData?.color }}
                  >
                    Incarner {rData?.name}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowComedienModal(false)}
              className="btn-secondary text-font"
              style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
