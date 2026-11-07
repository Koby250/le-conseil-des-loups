import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  runTransaction, writeBatch, arrayRemove, arrayUnion, deleteField,
} from 'firebase/firestore';

import { db } from './firebase';
import { rolesData, getRole } from './rolesData';
import { isWolf, ALL_NIGHT_PHASES, DAY_PHASES, phaseLabel, isLoupBlancWakeNight } from './gameLogic';
import {
  RoleIcon, RoleMedallion, CampBadge, RoleChip,
  RoleCardView, RoleDetailsModal, GrimoireModal, PhaseTimer,
} from './RoleComponents';
import {
  WolfPackChat,
  AccusationsChat,
  AccusedDefenseChat,
  PlayerMjNotificationAndInbox,
  RoleChangeProposalModal,
} from './GameChats';
import { useAutoMj, executeNextNightAuto } from './autoMjEngine';
import { reconcileCardAndRoleDuplicates, isBot } from './aiBotEngine';
import {
  AlertTriangle, EyeOff, Eye, User, Send, Lock, Unlock,
  Heart, HeartCrack, PawPrint, ShieldCheck, FlaskConical,
  Crosshair, Skull, Sparkles, Ghost, Trophy, BookOpen,
  CheckCircle2, Ban, Hourglass, Sun, Moon, VenetianMask,
  Info, Users, Dog, TreePine, Bird, ScanSearch, Drama, Gavel,
  CheckSquare, Square, Megaphone, ChevronRight,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

/**
 * Carte de résolution de la sentence du village (Verdict du vote / Bûcher).
 * Affiche clairement les victimes avec leur rôle révélé au grand jour,
 * ou les grâces (Idiot du Village, Illusionniste).
 */
function VerdictResolutionCard({ roomId, salonData, joueurs, onSelectRole, isMainAction = false }) {
  if (salonData?.statut !== 'jour_resolution') return null;

  let type = salonData?.verdict_details?.type;
  let victimes = salonData?.verdict_details?.victimes || [];
  let epargne = salonData?.verdict_details?.epargne;
  let raison = salonData?.verdict_details?.raison;

  // Fallback si verdict_details n'est pas encore présent (rétro-compatibilité)
  if (!type) {
    const rawCondamne = salonData?.condamne_jour || '';
    if (!rawCondamne || rawCondamne.includes('Personne') || rawCondamne.includes('Grâce') || rawCondamne.includes('Égalité')) {
      type = 'personne';
      raison = rawCondamne || "Aucun habitant n'a été éliminé par le village.";
    } else if (rawCondamne.includes('Idiot du Village') || rawCondamne.includes('Gracié')) {
      type = 'idiot_gracie';
      const p = joueurs.find(j => rawCondamne.includes(j.nom));
      epargne = p ? { id: p.id, nom: p.nom, role: p.role, raison: "Gracié par le village : perd son droit de vote" } : null;
    } else if (rawCondamne.includes('Illusion')) {
      type = 'illusion_sauve';
      const p = joueurs.find(j => rawCondamne.includes(j.nom));
      epargne = p ? { id: p.id, nom: p.nom, role: p.role, raison: "Sauvé par son pouvoir d'Illusion" } : null;
    } else {
      type = 'condamnation';
      const matched = joueurs.filter(j => rawCondamne.includes(j.nom));
      victimes = matched.map(p => ({
        id: p.id,
        nom: p.nom,
        role: p.role,
        raison: p.role === 'bouc-emissaire' ? 'Sacrifié (Bouc Émissaire)' : 'Condamné par le vote du village',
        est_infecte: !!p.est_infecte,
      }));
    }
  }

  // Ajouter la victime du chasseur si elle a tiré
  if (salonData?.victime_chasseur_details && !victimes.some(v => v.id === salonData.victime_chasseur_details.id)) {
    victimes = [...victimes, salonData.victime_chasseur_details];
  }

  // Vérifier si un chasseur mort doit encore tirer
  const chasseurEnAttente = joueurs.find(j => j.role === 'chasseur' && j.statut_joueur === 'mort' && j.tir_chasseur_fait === false);

  return (
    <div
      className="glass-panel"
      style={{
        padding: '1.25rem',
        borderRadius: '1.25rem',
        border: '2px solid rgba(239, 68, 68, 0.45)',
        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(15, 23, 42, 0.85))',
        marginBottom: '1.25rem',
        textAlign: 'center',
        boxShadow: '0 8px 30px rgba(239, 68, 68, 0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#ef4444', marginBottom: '0.35rem' }}>
        <Gavel size={24} />
        <h3 className="title-font" style={{ margin: 0, fontSize: '1.25rem', letterSpacing: '0.04em' }}>
          Sentence du Village
        </h3>
      </div>
      <p className="text-font text-muted" style={{ fontSize: '0.82rem', marginBottom: '1rem' }}>
        Le bûcher s'embrase. L'identité exacte du condamné est révélée à tous !
      </p>

      {/* Cas de condamnation avec victimes et rôles révélés */}
      {victimes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', textAlign: 'left' }}>
          {victimes.map(v => {
            const roleObj = v.role ? getRole(v.role) : null;
            return (
              <div
                key={v.id || v.nom}
                style={{
                  background: 'var(--input-bg)',
                  border: '1.5px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '12px',
                  padding: '0.9rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Skull size={18} style={{ color: '#ef4444' }} />
                    <strong style={{ fontSize: '1.05rem', color: 'var(--text-color)' }}>{v.nom}</strong>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 600 }}>
                    {v.raison || 'Condamné par le village'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid var(--card-border)' }}>
                  <span className="text-font" style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Rôle révélé :
                  </span>
                  {roleObj ? (
                    <RoleChip
                      roleObj={roleObj}
                      onSelectRole={onSelectRole}
                      suffix={v.est_infecte ? '(Infecté)' : undefined}
                      size="md"
                    />
                  ) : (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Rôle inconnu</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cas où un joueur a été épargné (Idiot du Village ou Illusionniste) */}
      {epargne && (
        <div
          style={{
            background: 'var(--input-bg)',
            border: '1.5px solid rgba(245, 158, 11, 0.45)',
            borderRadius: '12px',
            padding: '1rem',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24' }}>
            <Sparkles size={18} />
            <strong style={{ fontSize: '1rem' }}>{epargne.nom} est épargné !</strong>
          </div>
          <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-color)' }}>
            {epargne.raison}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid var(--card-border)' }}>
            <span className="text-font" style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Identité dévoilée :
            </span>
            {epargne.role && (
              <RoleChip
                roleObj={getRole(epargne.role)}
                onSelectRole={onSelectRole}
                size="md"
              />
            )}
          </div>
        </div>
      )}

      {/* Cas où personne ne meurt */}
      {type === 'personne' && (
        <div style={{ padding: '0.85rem 1rem', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid #10b981', borderRadius: '10px', color: '#10b981' }}>
          <p className="title-font" style={{ margin: '0 0 4px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <ShieldCheck size={16} /> Aucun habitant exécuté
          </p>
          <p className="text-font" style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-color)' }}>
            {raison || 'Le village a choisi de ne condamner personne ce tour-ci.'}
          </p>
        </div>
      )}

      {/* Malédiction de l'Ancien si l'Ancien a péri au vote */}
      {(salonData?.verdict_details?.malediction_ancien || salonData?.malediction_ancien_active) && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '1rem',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(185, 28, 28, 0.12))',
            border: '2px solid #ef4444',
            borderRadius: '12px',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', marginBottom: '6px' }}>
            <Hourglass size={20} />
            <strong style={{ fontSize: '1.02rem' }}>La Malédiction de l'Ancien s'abat sur le village !</strong>
          </div>
          <p className="text-font" style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-color)', lineHeight: 1.45 }}>
            Le village a commis l'irréparable en exécutant l'Ancien au vote. Bouleversés par ce sacrilège, tous les villageois possédant des pouvoirs (Voyante, Sorcière, Salvateur, Renard, etc.) perdent immédiatement leurs dons et redeviennent de <strong>Simples Villageois</strong> (seuls le Chasseur et les Loups conservent leurs attributs).
          </p>
        </div>
      )}

      {/* Alerte si le chasseur prépare son tir */}
      {chasseurEnAttente && (
        <div style={{ marginTop: '0.75rem', padding: '0.7rem 0.9rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px dashed #ef4444', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.82rem', color: '#fca5a5' }}>
          <Hourglass size={14} />
          <span>Le Chasseur ({chasseurEnAttente.nom}) prépare son ultime tir de vengeance...</span>
        </div>
      )}

      {/* Mode MJ Automatisé : Compteur avant la nuit suivante */}
      {salonData?.mj_automatique && !chasseurEnAttente && (
        <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#c4b5fd', fontWeight: 600 }}>
            <Hourglass size={14} />
            <span>Mode MJ Automatisé : La nuit tombe dans quelques instants...</span>
          </div>
          <button
            type="button"
            onClick={() => executeNextNightAuto(roomId || salonData?.id, salonData, joueurs)}
            className="btn-secondary text-font"
            style={{ padding: '6px 14px', fontSize: '0.8rem', borderRadius: '20px', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 700 }}
          >
            Lancer la nuit maintenant &rarr;
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Carte de bilan de la nuit (au matin / vote).
 * Affiche clairement les victimes avec leur rôle révélé au grand jour.
 */
function NightResolutionCard({ salonData, joueurs, onSelectRole }) {
  if (!['matin', 'jour_accusation', 'jour_defense', 'jour_vote'].includes(salonData?.statut)) return null;

  const nightVictims = [];
  const seenNames = new Set();

  if (Array.isArray(salonData?.morts_nuit_details) && salonData.morts_nuit_details.length > 0) {
    salonData.morts_nuit_details.forEach(v => {
      if (v?.nom && !seenNames.has(v.nom)) {
        seenNames.add(v.nom);
        nightVictims.push(v);
      }
    });
  } else if (salonData?.morts_nuit) {
    const causes = [
      { key: 'loups', label: 'Dévoré par les Loups-Garous' },
      { key: 'sorciere', label: 'Empoisonné par la Sorcière' },
      { key: 'venin', label: 'Empoisonné par le Chevalier' },
      { key: 'chagrin', label: 'Mort de chagrin d\'amour' },
    ];
    causes.forEach(({ key, label }) => {
      const raw = salonData.morts_nuit[key];
      if (raw) {
        const cleanNom = String(raw).replace(/\s*\(chagrin\)/i, '').trim();
        if (!seenNames.has(cleanNom)) {
          seenNames.add(cleanNom);
          const p = joueurs.find(j => j.nom === cleanNom);
          nightVictims.push({
            id: p?.id || cleanNom,
            nom: cleanNom,
            role: p?.role || null,
            raison: label,
            est_infecte: !!p?.est_infecte,
          });
        }
      }
    });
  }

  if (nightVictims.length === 0) {
    return (
      <div style={{ marginTop: '1.25rem', background: 'rgba(16,185,129,0.14)', border: '1.5px solid #10b981', borderRadius: '12px', padding: '1rem 1.25rem', textAlign: 'center' }}>
        <h3 className="title-font" style={{ color: '#10b981', fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Sparkles size={18} /> Aucune victime cette nuit !
        </h3>
        <p className="text-font" style={{ margin: '4px 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
          Le village se réveille au grand complet sous la lumière du jour.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: '1.25rem',
        background: 'linear-gradient(135deg, rgba(239,68,68,0.14), rgba(15,23,42,0.8))',
        border: '1.5px solid #ef4444',
        borderRadius: '14px',
        padding: '1.1rem 1.25rem',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '0.75rem', borderBottom: '1px solid rgba(239,68,68,0.3)', paddingBottom: '0.5rem' }}>
        <h3 className="title-font" style={{ color: '#ef4444', fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Skull size={19} /> Victimes de la nuit ({nightVictims.length})
        </h3>
        <span className="text-font" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Rôles révélés au village
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {nightVictims.map(v => {
          const roleObj = v.role ? getRole(v.role) : null;
          return (
            <div
              key={v.id || v.nom}
              style={{
                background: 'var(--input-bg)',
                borderRadius: '8px',
                padding: '8px 12px',
                border: '1px solid var(--card-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <strong style={{ fontSize: '0.94rem', color: 'var(--text-color)' }}>{v.nom}</strong>
                <span style={{ fontSize: '0.74rem', color: '#f87171' }}>{v.raison}</span>
              </div>
              {roleObj ? (
                <RoleChip
                  roleObj={roleObj}
                  onSelectRole={onSelectRole}
                  suffix={v.est_infecte ? '(Infecté)' : undefined}
                />
              ) : (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Rôle inconnu</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const [cibleLoupBlanc, setCibleLoupBlanc]                   = useState(null);
  const [renardResult, setRenardResult]                       = useState(null);

  // ── Boucle de Maître du Jeu Automatisé ───────────────────────────────────────
  useAutoMj(roomId, salonData, joueurs);

  // ── Garde d'intégrité anti-doublon des cartes et rôles en salle d'attente ────
  useEffect(() => {
    if (!roomId || salonData?.statut !== 'en_attente' || joueurs.length === 0) return;
    const timer = setTimeout(() => {
      reconcileCardAndRoleDuplicates(roomId, salonData, joueurs).catch(console.error);
    }, 350);
    return () => clearTimeout(timer);
  }, [roomId, salonData, joueurs]);

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

    const stableId = 'joueur_' + roomId + '_' + playerName.trim().toLowerCase().replace(/\s+/g, '_');
    if (joueurs.find(j => j.nom.toLowerCase() === playerName.trim().toLowerCase() && j.id !== stableId))
      return alert('Pseudo déjà pris !');

    // Gestion de la capacité du salon : un vrai joueur peut remplacer un bot IA
    let replacedBotId = null;
    if (salonData && Array.isArray(salonData.roles_selectionnes) && joueurs.length >= salonData.roles_selectionnes.length) {
      const botToReplace = joueurs.find(j => isBot(j));
      if (botToReplace) {
        replacedBotId = botToReplace.id;
      } else {
        return setError('Salon complet (toutes les places sont occupées par de vrais joueurs).');
      }
    }

    try {
      const batch = writeBatch(db);
      if (replacedBotId) {
        batch.delete(doc(db, 'salons', roomId, 'joueurs', replacedBotId));
      }

      // En salle d'attente aléatoire, libérer les cartes déjà tirées par les bots pour que le joueur humain
      // puisse choisir librement n'importe quel numéro disponible (les bots tireront après lui).
      if (salonData?.statut === 'en_attente' && salonData.distribution_mode !== 'manuelle') {
        const remainingHumansPicks = {};
        joueurs.forEach(j => {
          if (j.id === replacedBotId || j.id === stableId) return;
          if (isBot(j) && j.carte_choisie !== null) {
            batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
              carte_choisie: null,
              role: '',
              vies: 1,
              infection_dispo: false,
            });
          } else if (!isBot(j) && j.carte_choisie !== null && j.carte_choisie !== undefined && j.carte_choisie !== 999) {
            remainingHumansPicks[String(j.carte_choisie)] = j.id;
          }
        });
        batch.update(doc(db, 'salons', roomId), {
          cartes_prises: remainingHumansPicks,
        });
      }

      batch.set(doc(db, 'salons', roomId, 'joueurs', stableId), {
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
        vies: 1,
        infection_dispo: false,
        infection_repondu: false,
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
      await batch.commit();
      localStorage.setItem(`loup_garou_${roomId}_playerId`, stableId);
      setPlayerId(stableId);
      setIsJoined(true);
    } catch {
      setError('Erreur de connexion.');
    }
  };

  const handlePickCard = async index => {
    if (!salonData || !me) return;
    try {
      await runTransaction(db, async transaction => {
        const salonRef = doc(db, 'salons', roomId);
        const meRef = doc(db, 'salons', roomId, 'joueurs', me.id);
        const salonSnap = await transaction.get(salonRef);
        if (!salonSnap.exists()) throw new Error('SALON_INTROUVABLE');

        const freshSalon = salonSnap.data();
        const rolesMelanges = Array.isArray(freshSalon.roles_melanges) ? freshSalon.roles_melanges : [];
        if (index < 0 || index >= rolesMelanges.length) {
          throw new Error('CARTE_INVALIDE');
        }

        const cartesPrises = { ...(freshSalon.cartes_prises || {}) };
        const recordedOwnerId = cartesPrises[String(index)];
        const otherPlayersOnCard = joueurs.filter(j => j.id !== me.id && Number(j.carte_choisie) === Number(index));
        const humanOnCard = otherPlayersOnCard.find(j => !isBot(j));

        if (
          (recordedOwnerId && recordedOwnerId !== me.id && !String(recordedOwnerId).startsWith('bot_')) ||
          humanOnCard
        ) {
          throw new Error('CARTE_DEJA_PRISE');
        }

        // Si un Bot IA occupait cette carte, on l'évince pour donner la priorité au joueur humain
        const botIdsToEvict = new Set(otherPlayersOnCard.filter(j => isBot(j)).map(j => j.id));
        if (recordedOwnerId && String(recordedOwnerId).startsWith('bot_')) {
          botIdsToEvict.add(recordedOwnerId);
        }
        for (const botId of botIdsToEvict) {
          transaction.update(doc(db, 'salons', roomId, 'joueurs', botId), {
            carte_choisie: null,
            role: '',
            vies: 1,
            infection_dispo: false,
          });
        }

        // Nettoyer toute ancienne carte éventuellement associée à `me.id`
        for (const [k, v] of Object.entries(cartesPrises)) {
          if (v === me.id) delete cartesPrises[k];
        }
        cartesPrises[String(index)] = me.id;

        const assignedRole = rolesMelanges[index];
        transaction.update(salonRef, { cartes_prises: cartesPrises });
        transaction.update(meRef, {
          carte_choisie: index,
          role: assignedRole,
          vies: assignedRole === 'ancien' ? 2 : 1,
          infection_dispo: assignedRole === 'infect-pere-des-loups' || assignedRole === 'pere-des-loups',
          conflit_carte_msg: null,
        });
      });
    } catch (err) {
      if (err?.message === 'CARTE_DEJA_PRISE') {
        try {
          await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
            carte_choisie: null,
            role: '',
            vies: 1,
            infection_dispo: false,
            conflit_carte_msg: `La carte #${index + 1} vient d'être choisie simultanément par un autre joueur ! Veuillez sélectionner un autre numéro de carte.`,
          });
        } catch (e) {
          console.error(e);
        }
      } else {
        alert('Erreur lors du tirage de la carte.');
      }
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
          hideActiveRoles={true}
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
      const cartesPrisesMap = salonData.cartes_prises || {};
      const takenByMap = Object.entries(cartesPrisesMap)
        .filter(([, ownerId]) => ownerId && !String(ownerId).startsWith('bot_'))
        .map(([idx]) => Number(idx));
      const takenCards = new Set([
        ...joueurs
          .filter(j => j.carte_choisie !== null && j.carte_choisie !== 999)
          .map(j => Number(j.carte_choisie)),
        ...takenByMap,
      ]);
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
              {me.conflit_carte_msg && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '12px',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1.5px solid #ef4444',
                    color: '#fca5a5',
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    textAlign: 'left',
                  }}
                >
                  <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <span>{me.conflit_carte_msg}</span>
                </div>
              )}
            </div>
            <div className="mystery-cards-grid">
              {allCards.map(index => {
                if (takenCards.has(index)) return null;
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
          hideActiveRoles={true}
        />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE DE JEU (après lancement)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Early return : Fin de partie ──────────────────────────────────────────
  if (salonData?.statut === 'fin_village' || salonData?.statut === 'fin_loups' || salonData?.statut === 'fin_ange' || salonData?.statut === 'fin_loup_blanc') {
    const isVillageWin   = salonData.statut === 'fin_village';
    const isAngeWin      = salonData.statut === 'fin_ange';
    const isLoupBlancWin = salonData.statut === 'fin_loup_blanc';
    const winColor       = isVillageWin ? '#10b981' : isAngeWin ? '#fbbf24' : isLoupBlancWin ? '#f1f5f9' : '#ef4444';

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
                : isLoupBlancWin
                  ? 'VICTOIRE DU LOUP-GAROU BLANC !'
                  : 'VICTOIRE DES LOUPS !'}
          </h1>
          <p className="text-font" style={{ fontSize: '1.05rem', color: 'var(--text-color)', marginBottom: '2rem' }}>
            {isVillageWin
              ? 'Tous les Loups-Garous ont été éliminés !'
              : isAngeWin
                ? "L'Ange s'est fait éliminer au tout premier vote et gagne seul !"
                : isLoupBlancWin
                  ? 'Le Loup-Garou Blanc a éliminé la meute et le village : il est l’unique survivant !'
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
                        suffix={
                          j.est_infecte
                            ? '(Infecté)'
                            : j.pouvoirs_perdus_ancien && j.ancien_role
                              ? `(Ex-${getRole(j.ancien_role)?.name || j.ancien_role})`
                              : undefined
                        }
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
  const isMeLoup               = isWolf(me);
  const loupTargets            = allAlivePlayers.filter(j => !isWolf(j));
  const allPackMembers         = isMeLoup ? joueurs.filter(j => isWolf(j) && j.id !== me.id) : [];
  const compagnonsLoupsVivants = allPackMembers.filter(j => j.statut_joueur !== 'mort');
  const compagnonsLoups        = compagnonsLoupsVivants;
  const isNightMode            = ALL_NIGHT_PHASES.includes(salonData?.statut);

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
                    const chasseurVictim = targetDoc ? {
                      id: targetDoc.id,
                      nom: targetDoc.nom,
                      role: targetDoc.role,
                      raison: `Abattu dans le dernier souffle du Chasseur (${me.nom})`,
                      est_infecte: !!targetDoc.est_infecte,
                    } : null;
                    const salonUpdatesHunter = {
                      notifications_mj: arrayUnion(...notifs),
                    };
                    if (chasseurVictim) {
                      salonUpdatesHunter.victime_chasseur_details = chasseurVictim;
                    }
                    transaction.update(doc(db, 'salons', roomId), salonUpdatesHunter);
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

          {/* Annonce Sentence / Bilan nuit pour les spectateurs */}
          <VerdictResolutionCard roomId={roomId} salonData={salonData} joueurs={joueurs} onSelectRole={r => setInspectRole(r)} />
          <NightResolutionCard salonData={salonData} joueurs={joueurs} onSelectRole={r => setInspectRole(r)} />

          {/* Rappel du dernier condamné au bûcher pendant la nuit */}
          {isNightMode && salonData.condamne_jour && !salonData.condamne_jour.includes('Personne') && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '10px', fontSize: '0.82rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1rem' }}>
              <Skull size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span>Dernier condamné au bûcher : <strong>{salonData.condamne_jour}</strong></span>
            </div>
          )}

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

          {/* Chat des accusations en lecture seule pour les fantômes */}
          {(salonData.statut === 'matin' || salonData.statut === 'jour_accusation') && (
            <div style={{ marginBottom: '1rem' }}>
              <AccusationsChat
                roomId={roomId}
                salonData={salonData}
                senderName={me.nom}
                isDead={true}
              />
            </div>
          )}

          {/* Chat de défense des accusés en lecture seule pour les fantômes */}
          {(salonData.statut === 'jour_defense' || salonData.statut === 'jour_vote') && salonData?.la_liste_accuses?.length > 0 && (
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
                        suffix={
                          j.est_infecte
                            ? '(Infecté)'
                            : j.pouvoirs_perdus_ancien && j.ancien_role
                              ? `(Ex-${getRole(j.ancien_role)?.name || j.ancien_role})`
                              : undefined
                        }
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
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <RoleChip
                    roleObj={myRoleData}
                    onSelectRole={r => setInspectRole(r)}
                    suffix={
                      me.est_infecte
                        ? '(Infecté)'
                        : me.pouvoirs_perdus_ancien && me.ancien_role
                          ? `(Ex-${getRole(me.ancien_role)?.name || me.ancien_role})`
                          : undefined
                    }
                  />
                  {me.pouvoirs_perdus_ancien && (
                    <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '6px', padding: '2px 6px', fontWeight: 700 }}>
                      Ancien exécuté : pouvoirs perdus
                    </span>
                  )}
                </div>
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

        {/* Annonce officielle du Verdict du Village (Sentence / Bûcher) */}
        <VerdictResolutionCard roomId={roomId} salonData={salonData} joueurs={joueurs} onSelectRole={r => setInspectRole(r)} />

        {/* Bilan du réveil et victimes de la nuit */}
        <NightResolutionCard salonData={salonData} joueurs={joueurs} onSelectRole={r => setInspectRole(r)} />

        {/* Rappel du dernier condamné au bûcher pendant la nuit */}
        {isNightMode && salonData?.condamne_jour && !salonData.condamne_jour.includes('Personne') && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '10px', fontSize: '0.82rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1rem' }}>
            <Skull size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
            <span>Dernier condamné au bûcher : <strong>{salonData.condamne_jour}</strong></span>
          </div>
        )}

        {/* ── SECRETS DU JOUEUR : affichés uniquement si showRole ──────────────── */}
        {showRole && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem', textAlign: 'left' }}>

            {/* Malédiction de l'Ancien si le joueur a perdu ses pouvoirs */}
            {me.pouvoirs_perdus_ancien && (
              <div
                style={{
                  padding: '1rem 1.15rem',
                  background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22) 0%, rgba(185, 28, 28, 0.12) 100%)',
                  border: '1.5px solid #ef4444',
                  borderRadius: '14px',
                  color: '#fee2e2',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontWeight: 800, fontSize: '0.96rem', marginBottom: '0.35rem' }}>
                  <Skull size={18} /> Malédiction de l'Ancien : Vos pouvoirs sont anéantis !
                </div>
                <p style={{ margin: '0 0 0.55rem', fontSize: '0.84rem', lineHeight: 1.45, color: 'var(--text-color)' }}>
                  L'Ancien a été condamné au vote par le village. En punition, vous avez perdu l'intégralité de vos pouvoirs surnaturels et êtes redevenu un <strong>Simple Villageois</strong>.
                </p>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', background: 'rgba(0,0,0,0.35)', padding: '5px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <span>Rôle d'origine :</span>
                  <strong style={{ color: '#f87171' }}>{getRole(me.ancien_role)?.name || me.ancien_role || 'Rôle spécial'}</strong>
                  <span>&rarr;</span>
                  <strong style={{ color: '#34d399' }}>Simple Villageois</strong>
                </div>
              </div>
            )}

            {/* Carte collectionnable du rôle (compacte le jour pour laisser le Chat et les votes bien visibles en haut) */}
            {myRoleData && (
              <RoleCardView
                role={myRoleData}
                onOpenDetails={r => setInspectRole(r)}
                compact={['matin', 'jour_accusation', 'jour_defense', 'jour_vote'].includes(salonData?.statut)}
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

            {/* Meute des Loups-Garous (accessible à tous les loups, y compris le Loup Blanc) */}
            {isMeLoup && (
              <div style={{ padding: '1rem 1.15rem', background: 'rgba(239,68,68,0.1)', border: '1.5px solid #ef4444', borderRadius: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <p className="title-font" style={{ margin: 0, color: '#ef4444', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <PawPrint size={18} /> Votre Meute de Loups-Garous :
                  </p>
                  <span style={{ fontSize: '0.78rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', fontWeight: 600 }}>
                    {compagnonsLoupsVivants.length + 1} loup(s) en vie
                  </span>
                </div>

                {me.role === 'loup-blanc' && (
                  <div style={{ marginBottom: '10px', padding: '8px 10px', background: 'rgba(241,245,249,0.1)', border: '1px solid rgba(241,245,249,0.25)', borderRadius: '8px', fontSize: '0.82rem', color: '#e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                      <span style={{ fontWeight: 700 }}>Rôle spécial : Loup-Garou Blanc (Incognito)</span>
                      <span style={{
                        fontSize: '0.72rem',
                        padding: '2px 7px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        background: isLoupBlancWakeNight(salonData?.numero_jour || 1) ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.2)',
                        color: isLoupBlancWakeNight(salonData?.numero_jour || 1) ? '#34d399' : '#cbd5e1',
                        border: isLoupBlancWakeNight(salonData?.numero_jour || 1) ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(148,163,184,0.3)',
                      }}>
                        {isLoupBlancWakeNight(salonData?.numero_jour || 1)
                          ? `Nuit ${salonData?.numero_jour || 1} : Réveil solitaire actif`
                          : `Nuit ${salonData?.numero_jour || 1} : Chasse en meute uniquement (réveil solitaire Nuit ${(salonData?.numero_jour || 1) + 1})`}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', opacity: 0.9, lineHeight: 1.4 }}>
                      Vous savez qui sont les loups, mais eux vous voient comme un simple <strong>Loup-Garou</strong> et ignorent qui est le Loup Blanc. Une nuit sur deux (Nuit 2, 4, 6…), vous êtes appelé seul après la meute pour dévorer un loup en secret !
                    </p>
                  </div>
                )}

                {me.role !== 'loup-blanc' && (salonData?.loup_blanc_a_frappe || salonData?.morts_nuit?.loup_blanc) && (
                  <div style={{ marginBottom: '10px', padding: '8px 10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '8px', fontSize: '0.8rem', color: '#fcd34d', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 700 }}>Traître dans la meute :</span> Le Loup-Garou Blanc se cache parmi vous sous l'apparence d'un simple Loup-Garou ! Démasquez-le et éliminez-le pendant la journée lors du vote du village.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {/* Le joueur lui-même */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '7px 10px', background: 'rgba(239,68,68,0.18)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="text-font" style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>{me.nom}</span>
                      <span style={{ fontSize: '0.72rem', background: '#ef4444', color: '#fff', padding: '1px 6px', borderRadius: '6px', fontWeight: 700 }}>Vous</span>
                    </div>
                    {myRoleData && (
                      <RoleChip
                        roleObj={myRoleData}
                        onSelectRole={r => setInspectRole(r)}
                        suffix={me.est_infecte ? '(Infecté)' : undefined}
                      />
                    )}
                  </div>

                  {/* Les autres membres de la meute */}
                  {allPackMembers.length > 0 ? (
                    allPackMembers.map(j => {
                      const isMort = j.statut_joueur === 'mort';
                      // Les autres loups ne savent pas qui est le Loup Blanc : tant qu'il est en vie, il leur apparaît comme un simple Loup-Garou
                      const displayedRoleId = (j.role === 'loup-blanc' && me.role !== 'loup-blanc' && !isMort)
                        ? 'loup-garou'
                        : j.role;
                      const rObj = getRole(displayedRoleId);
                      return (
                        <div
                          key={j.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '7px 10px',
                            background: isMort ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.3)',
                            borderRadius: '8px',
                            border: isMort ? '1px dashed rgba(255,255,255,0.15)' : '1px solid rgba(239,68,68,0.25)',
                            opacity: isMort ? 0.6 : 1,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="text-font" style={{ fontWeight: 700, fontSize: '0.88rem', color: isMort ? '#94a3b8' : '#fca5a5', textDecoration: isMort ? 'line-through' : 'none' }}>
                              {j.nom}
                            </span>
                            {isMort && (
                              <span style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.2)', color: '#f87171', padding: '1px 5px', borderRadius: '4px' }}>
                                Éliminé
                              </span>
                            )}
                          </div>
                          {rObj && (
                            <RoleChip
                              roleObj={rObj}
                              onSelectRole={r => setInspectRole(r)}
                              suffix={j.est_infecte ? '(Infecté)' : undefined}
                            />
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-font" style={{ margin: '4px 0 0', color: '#fca5a5', fontSize: '0.84rem' }}>
                      Vous êtes le seul loup de la meute.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── BANDEAU PHASE DE NUIT ────────────────────────────────────────── */}
        {isNightMode && (() => {
          const NIGHT_META = {
            nuit_cupidon:    { roleId: 'cupidon',    label: 'Cupidon lie deux âmes...',            color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
            nuit_voleur:     { roleId: 'voleur',     label: 'Le Voleur rôde en silence...',        color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)' },
            nuit_salvateur:  { roleId: 'salvateur',  label: 'Le Salvateur protège le village...',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
            nuit_voyante:    { roleId: 'voyante',    label: 'La Voyante observe les astres...',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
            nuit_loups:      { roleId: 'loup-garou', label: 'La meute de loups chasse...',         color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
            nuit_loup_blanc: { roleId: 'loup-blanc', label: 'Le Loup-Garou Blanc rôde en secret...', color: '#cbd5e1', bg: 'rgba(203, 213, 225, 0.12)' },
            nuit_sorciere:   { roleId: 'sorciere',   label: 'La Sorcière prépare ses potions...',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
          };
          const phaseInfo = NIGHT_META[salonData.statut];
          if (!phaseInfo) return null;

          const isActiveRole =
            (salonData.statut === 'nuit_cupidon'    && me.role === 'cupidon'    && !me.pouvoir_utilise) ||
            (salonData.statut === 'nuit_voleur'     && me.role === 'voleur'     && !me.a_vote) ||
            (salonData.statut === 'nuit_salvateur'  && me.role === 'salvateur'  && !me.a_vote) ||
            (salonData.statut === 'nuit_voyante'    && me.role === 'voyante'    && !me.a_vote) ||
            (salonData.statut === 'nuit_loups'      && isMeLoup                 && !me.a_vote) ||
            (salonData.statut === 'nuit_loup_blanc' && me.role === 'loup-blanc' && !me.a_vote) ||
            (salonData.statut === 'nuit_sorciere'   && me.role === 'sorciere'   && !me.a_vote_sorciere);

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

              {/* Rappel des loups de la meute */}
              <div style={{ marginBottom: '12px', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.25)' }}>
                <span className="text-font" style={{ fontSize: '0.82rem', color: '#fca5a5', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <PawPrint size={14} /> Membres de la meute cette nuit :
                </span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  <span style={{ fontSize: '0.78rem', background: '#ef4444', color: '#fff', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                    {me.nom} (Vous)
                  </span>
                  {compagnonsLoupsVivants.map(c => (
                    <span key={c.id} style={{ fontSize: '0.78rem', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.35)' }}>
                      {c.nom}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-font" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                Désignez la victime du village à dévorer :
              </p>

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

          {/* LOUP-GAROU BLANC : ACTION SECRÈTE APRÈS LA MEUTE */}
          {salonData.statut === 'nuit_loup_blanc' && me.role === 'loup-blanc' && (
            <div style={{ padding: '1.15rem', background: 'rgba(241,245,249,0.08)', border: '1.5px solid #cbd5e1', borderRadius: '12px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.6rem' }}>
                <Moon size={22} style={{ color: '#f1f5f9' }} />
                <h3 className="title-font" style={{ color: '#f1f5f9', fontSize: '1.15rem', margin: 0 }}>
                  Réveil Secret du Loup-Garou Blanc
                </h3>
              </div>

              <p className="text-font" style={{ fontSize: '0.86rem', color: '#cbd5e1', marginBottom: '1rem', lineHeight: 1.4 }}>
                La meute s'est rendormie. C'est votre moment d'agir seul dans l'ombre. Pour gagner la partie seul, vous pouvez assassiner un autre loup cette nuit, ou épargner la meute pour le moment.
              </p>

              {me.a_vote ? (
                <div style={{ padding: '12px', background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', borderRadius: '8px', textAlign: 'center' }}>
                  <p className="text-font" style={{ color: '#10b981', fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <CheckCircle2 size={18} /> Action secrète validée !
                  </p>
                  <p className="text-font" style={{ fontSize: '0.84rem', margin: 0, color: 'var(--text-color)' }}>
                    {salonData.victime_loup_blanc
                      ? `Vous avez choisi d'éliminer ${salonData.victime_loup_blanc} en secret.`
                      : 'Vous avez choisi d\'épargner vos compères cette nuit.'}
                  </p>
                </div>
              ) : compagnonsLoupsVivants.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '10px' }}>
                  <p className="text-font text-muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                    Tous les autres loups sont déjà éliminés ! Vous êtes l'unique prédateur restant.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
                          a_vote: true,
                          a_vote_loup_blanc: true,
                        });
                      } catch (e) { console.error(e); }
                    }}
                    className="btn-primary title-font"
                    style={{ background: '#475569', width: '100%' }}
                  >
                    Continuer la nuit
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-font" style={{ fontSize: '0.86rem', fontWeight: 600, color: '#fca5a5', marginBottom: '8px' }}>
                    Choisissez un membre de la meute à dévorer :
                  </p>

                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto', marginBottom: '1rem' }}>
                    {compagnonsLoupsVivants.map(j => {
                      const isSel = cibleLoupBlanc === j.nom;
                      const rObj = getRole(j.role);
                      return (
                        <li
                          key={j.id}
                          onClick={() => setCibleLoupBlanc(j.nom)}
                          style={{
                            padding: '9px 12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: isSel ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)',
                            color: isSel ? '#fca5a5' : 'var(--text-color)',
                            border: isSel ? '1.5px solid #ef4444' : '1px solid var(--card-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontWeight: isSel ? 700 : 500,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <PawPrint size={16} style={{ color: '#ef4444' }} />
                            <span>{j.nom}</span>
                          </div>
                          {rObj && (
                            <RoleChip
                              roleObj={rObj}
                              onSelectRole={r => setInspectRole(r)}
                              suffix={j.est_infecte ? '(Infecté)' : undefined}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={!cibleLoupBlanc}
                      onClick={async () => {
                        if (!cibleLoupBlanc) return;
                        try {
                          await runTransaction(db, async transaction => {
                            transaction.update(doc(db, 'salons', roomId), {
                              victime_loup_blanc: cibleLoupBlanc,
                              notifications_mj: arrayUnion(`Le Loup Blanc a frappé un loup en secret cette nuit.`),
                            });
                            transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                              a_vote: true,
                              a_vote_loup_blanc: true,
                            });
                          });
                        } catch (e) { console.error(e); }
                      }}
                      className="btn-primary title-font glow-button"
                      style={{ background: '#ef4444', width: '100%', opacity: !cibleLoupBlanc ? 0.5 : 1 }}
                    >
                      <Skull size={18} /> Égorger {cibleLoupBlanc || 'la cible'} en secret
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await runTransaction(db, async transaction => {
                            transaction.update(doc(db, 'salons', roomId), {
                              victime_loup_blanc: null,
                              notifications_mj: arrayUnion(`Le Loup Blanc a décidé d'épargner la meute cette nuit.`),
                            });
                            transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
                              a_vote: true,
                              a_vote_loup_blanc: true,
                            });
                          });
                        } catch (e) { console.error(e); }
                      }}
                      className="btn-secondary text-font"
                      style={{ width: '100%', borderColor: '#64748b', color: '#94a3b8' }}
                    >
                      Épargner la meute cette nuit (Passer)
                    </button>
                  </div>
                </div>
              )}
            </div>
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

          {/* RENARD / RENARD-GAROU (pendant la nuit : 1 seul flair par nuit entière) */}
          {isNightMode && (me.role === 'renard' || me.role === 'renard-garou') && (() => {
            const currentDayNum = salonData?.numero_jour || 1;
            const hasFlairedTonight = Boolean(me.flair_nuit_utilise) || (me.dernier_flair_nuit != null && me.dernier_flair_nuit === currentDayNum);
            const activeResult = (me.dernier_flair_resultat?.numero_jour === currentDayNum ? me.dernier_flair_resultat : null) || renardResult;

            if (me.pouvoir_renard_perdu) {
              return (
                <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px dashed #ef4444', borderRadius: '12px', marginBottom: '1rem' }}>
                  <p className="title-font" style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.98rem', margin: '0 0 4px' }}>
                    <ScanSearch size={18} /> Flair du Renard éteint
                  </p>
                  <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Vous avez définitivement perdu votre flair car aucun loup n'a été détecté dans le dernier trio analysé.
                  </p>
                </div>
              );
            }

            if (hasFlairedTonight || activeResult) {
              return (
                <div style={{ padding: '1.15rem', background: 'rgba(249,115,22,0.1)', border: '1.5px solid #f97316', borderRadius: '12px', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <h3 className="title-font" style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', margin: 0 }}>
                      <ScanSearch size={20} /> Flair du Renard (Effectué ce soir)
                    </h3>
                    <span style={{ fontSize: '0.74rem', background: 'rgba(249,115,22,0.2)', color: '#fb923c', padding: '2px 8px', borderRadius: '8px', fontWeight: 600 }}>
                      1 fois par nuit
                    </span>
                  </div>

                  <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                    {activeResult ? (
                      <>
                        <p className="text-font" style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                          Trio flairé cette nuit : <strong style={{ color: '#f97316' }}>{activeResult.trioNames.join(', ')}</strong>
                        </p>
                        <p className="title-font" style={{ fontSize: '1.08rem', color: activeResult.hasWolf ? '#ef4444' : '#10b981', marginBottom: '0.5rem' }}>
                          {activeResult.hasWolf
                            ? 'AU MOINS UN LOUP SE CACHE DANS CE TRIO !'
                            : 'AUCUN LOUP DANS CE TRIO.'}
                        </p>
                        <p className="text-font" style={{ margin: 0, fontSize: '0.82rem', color: activeResult.hasWolf ? '#10b981' : '#f87171' }}>
                          {activeResult.hasWolf
                            ? 'Votre instinct est intact : vous conserverez votre flair pour la nuit prochaine.'
                            : 'Aucun loup décelé : vous avez perdu votre flair.'}
                        </p>
                      </>
                    ) : (
                      <p className="text-font" style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-color)' }}>
                        Vous avez choisi de préserver votre flair pour cette nuit.
                      </p>
                    )}
                  </div>

                  <div style={{ marginTop: '0.75rem', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', textAlign: 'center' }}>
                    <p className="text-font text-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      Le renard ne peut flairer qu'une seule fois dans une nuit entière. Votre flair sera à nouveau disponible la nuit prochaine.
                    </p>
                  </div>
                </div>
              );
            }

            return (
              <div style={{ padding: '1.15rem', background: 'rgba(249,115,22,0.1)', border: '1.5px solid #f97316', borderRadius: '12px', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h3 className="title-font" style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', margin: 0 }}>
                    <ScanSearch size={20} /> Flair du Renard
                  </h3>
                  <span style={{ fontSize: '0.74rem', background: 'rgba(249,115,22,0.2)', color: '#fb923c', padding: '2px 8px', borderRadius: '8px', fontWeight: 600 }}>
                    1 seule fois par nuit
                  </span>
                </div>

                <p className="text-font text-muted" style={{ fontSize: '0.84rem', marginBottom: '0.85rem' }}>
                  Vous ne pouvez flairer qu'<strong>une seule fois dans toute la nuit</strong>. Choisissez un habitant pour détecter la présence d'au moins un Loup-Garou parmi lui et ses 2 voisins vivants :
                </p>

                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto', marginBottom: '0.85rem' }}>
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
                          const isLost = me.role === 'renard' ? !hasWolf : false;

                          setRenardResult({ trioNames, hasWolf, numero_jour: currentDayNum });
                          try {
                            await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
                              flair_nuit_utilise: true,
                              dernier_flair_nuit: currentDayNum,
                              pouvoir_renard_perdu: isLost,
                              dernier_flair_resultat: {
                                trioNames,
                                hasWolf,
                                numero_jour: currentDayNum,
                              },
                            });
                            await updateDoc(doc(db, 'salons', roomId), {
                              notifications_mj: arrayUnion(
                                `Le Renard (${me.nom}) a flairé [${trioNames.join(', ')}] → ${hasWolf ? 'Présence de Loup détectée' : 'Aucun Loup (flair perdu)'}.`,
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

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
                        flair_nuit_utilise: true,
                        dernier_flair_nuit: currentDayNum,
                      });
                      await updateDoc(doc(db, 'salons', roomId), {
                        notifications_mj: arrayUnion(
                          `Le Renard (${me.nom}) a choisi de ne pas flairer cette nuit pour préserver son flair.`,
                        ),
                      });
                    } catch (e) { console.error(e); }
                  }}
                  className="btn-secondary text-font"
                  style={{ width: '100%', borderColor: 'rgba(255,255,255,0.15)', color: 'var(--text-muted)', fontSize: '0.82rem' }}
                >
                  Ne pas flairer cette nuit (Préserver son flair)
                </button>
              </div>
            );
          })()}

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

        {/* ── 0. LEVER DU SOLEIL & BILAN DU MATIN (MATIN) ─────────────────── */}
        {salonData.statut === 'matin' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
              <h3 className="title-font" style={{ color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}>
                <Sun size={20} /> Le Village se Réveille
              </h3>
              <PhaseTimer
                phaseStartedAt={salonData.phase_started_at}
                durationSec={salonData.duree_matin !== undefined ? salonData.duree_matin : 14}
                label="Ouverture des débats"
              />
            </div>
            <div style={{ padding: '1.15rem 1.25rem', background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(15,23,42,0.6))', border: '1.5px solid rgba(245,158,11,0.4)', borderRadius: '14px', marginBottom: '1rem' }}>
              <p className="text-font" style={{ fontSize: '0.92rem', color: 'var(--text-color)', lineHeight: 1.5, margin: 0 }}>
                La nuit est terminée, le soleil se lève sur le village. Vous pouvez déjà échanger vos premières impressions dans le <strong>Chat des Accusations</strong> ci-dessous.
              </p>
            </div>
            <AccusationsChat
              roomId={roomId}
              salonData={salonData}
              senderName={me.nom}
              isDead={false}
            />
          </div>
        )}

        {/* ── INDICATEUR DE PROGRESSION DES PHASES DU JOUR ── */}
        {['jour_accusation', 'jour_defense', 'jour_vote'].includes(salonData.statut) && (
          <div
            style={{
              marginTop: '1.25rem',
              marginBottom: '1rem',
              padding: '10px 14px',
              borderRadius: '14px',
              background: 'var(--input-bg)',
              border: '1.5px solid var(--card-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              overflowX: 'auto',
            }}
          >
            {/* Étape 1 : Accusations */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              opacity: salonData.statut === 'jour_accusation' ? 1 : 0.5,
              padding: '4px 8px',
              borderRadius: '8px',
              background: salonData.statut === 'jour_accusation' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
              border: salonData.statut === 'jour_accusation' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
              flexShrink: 0,
            }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: salonData.statut === 'jour_accusation' ? '#ef4444' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>1</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: salonData.statut === 'jour_accusation' ? '#ef4444' : 'var(--text-color)' }}>
                  Accusations
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Débats & Suspects</div>
              </div>
            </div>

            <ChevronRight size={15} style={{ opacity: 0.35, flexShrink: 0 }} />

            {/* Étape 2 : Défenses */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              opacity: salonData.statut === 'jour_defense' ? 1 : 0.5,
              padding: '4px 8px',
              borderRadius: '8px',
              background: salonData.statut === 'jour_defense' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              border: salonData.statut === 'jour_defense' ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid transparent',
              flexShrink: 0,
            }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: salonData.statut === 'jour_defense' ? '#8b5cf6' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>2</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: salonData.statut === 'jour_defense' ? '#8b5cf6' : 'var(--text-color)' }}>
                  Défenses
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Tribunal des accusés</div>
              </div>
            </div>

            <ChevronRight size={15} style={{ opacity: 0.35, flexShrink: 0 }} />

            {/* Étape 3 : Vote Final */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              opacity: salonData.statut === 'jour_vote' ? 1 : 0.5,
              padding: '4px 8px',
              borderRadius: '8px',
              background: salonData.statut === 'jour_vote' ? 'rgba(225, 29, 72, 0.15)' : 'transparent',
              border: salonData.statut === 'jour_vote' ? '1px solid rgba(225, 29, 72, 0.4)' : '1px solid transparent',
              flexShrink: 0,
            }}>
              <span style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: salonData.statut === 'jour_vote' ? '#e11d48' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>3</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: salonData.statut === 'jour_vote' ? '#e11d48' : 'var(--text-color)' }}>
                  Vote Final
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Bûcher du village</div>
              </div>
            </div>
          </div>
        )}

        {/* ── 1. PHASE D'ACCUSATIONS DU VILLAGE (JOUR_ACCUSATION) ─────────── */}
        {salonData.statut === 'jour_accusation' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
              <h3 className="title-font" style={{ color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}>
                <Megaphone size={20} /> Phase d'Accusations
              </h3>
              <PhaseTimer
                phaseStartedAt={salonData.phase_started_at}
                durationSec={salonData.duree_accusation !== undefined ? salonData.duree_accusation : 60}
                label="Temps d'accusation"
              />
            </div>

            {/* Chat des accusations placé en tout premier pour débattre avant d'accuser */}
            <div style={{ marginBottom: '1.25rem' }}>
              <AccusationsChat
                roomId={roomId}
                salonData={salonData}
                senderName={me.nom}
                isDead={false}
              />
            </div>

            {me.gracie_idiot ? (
              <div style={{ padding: '1rem', background: 'rgba(132,204,22,0.12)', border: '1.5px solid #84cc16', borderRadius: '12px', textAlign: 'center' }}>
                <p className="text-font" style={{ margin: 0, color: '#a3e635', fontWeight: 700, fontSize: '0.9rem' }}>
                  Vous avez été gracié en tant qu'Idiot du Village : vous êtes en vie mais vous ne pouvez plus accuser ni voter.
                </p>
              </div>
            ) : (() => {
              const rawMonVote = salonData?.votes?.[me.nom];
              const mesAccusations = Array.isArray(rawMonVote)
                ? rawMonVote
                : (rawMonVote ? [rawMonVote] : []);
              const aChoisiPersonne = mesAccusations.includes('Personne');

              const candidates = allAlivePlayers.filter(j => j.id !== me.id).map(j => j.nom);
              const isAllCandidatesSelected = candidates.length > 0 && candidates.every(nom => mesAccusations.includes(nom));

              const countAccusationsFor = (targetNom) => {
                let count = 0;
                Object.values(salonData?.votes || {}).forEach(v => {
                  if (Array.isArray(v)) {
                    if (v.includes(targetNom)) count++;
                  } else if (v === targetNom) {
                    count++;
                  }
                });
                return count;
              };

              const handleTogglePlayerAccusation = async (targetNom) => {
                let next;
                if (mesAccusations.includes(targetNom)) {
                  next = mesAccusations.filter(n => n !== targetNom && n !== 'Personne');
                } else {
                  next = [...mesAccusations.filter(n => n !== 'Personne'), targetNom];
                }

                try {
                  if (next.length === 0) {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: deleteField(),
                    });
                  } else {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: next,
                    });
                  }
                } catch (e) {
                  console.error('Erreur handleTogglePlayerAccusation:', e);
                }
              };

              const handleToggleAll = async () => {
                try {
                  if (isAllCandidatesSelected) {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: deleteField(),
                    });
                  } else {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: candidates,
                    });
                  }
                } catch (e) {
                  console.error('Erreur handleToggleAll:', e);
                }
              };

              const handleToggleNobody = async () => {
                try {
                  if (aChoisiPersonne) {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: deleteField(),
                    });
                  } else {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: 'Personne',
                    });
                  }
                } catch (e) {
                  console.error('Erreur handleToggleNobody:', e);
                }
              };

              return (
                <div>
                  <p className="text-font text-muted" style={{ marginBottom: '0.85rem', fontSize: '0.88rem', lineHeight: '1.4' }}>
                    Désignez un ou plusieurs suspects à traduire au tribunal, accusez tout le village, ou choisissez de n'accuser personne.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '0.85rem' }}>
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="text-font"
                      style={{
                        padding: '10px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        background: isAllCandidatesSelected ? 'rgba(239, 68, 68, 0.22)' : 'var(--input-bg)',
                        border: isAllCandidatesSelected ? '1.5px solid #ef4444' : '1px solid var(--card-border)',
                        color: isAllCandidatesSelected ? '#ef4444' : 'var(--text-color)',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                        <Megaphone size={16} style={{ color: isAllCandidatesSelected ? '#ef4444' : 'var(--primary)' }} />
                        <span>{isAllCandidatesSelected ? "Tout désélectionner" : "Accuser tout le village"}</span>
                      </span>
                      {isAllCandidatesSelected && (
                        <span style={{ fontSize: '0.75rem', color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <CheckCircle2 size={14} /> Tous
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleNobody}
                      className="text-font"
                      style={{
                        padding: '10px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        background: aChoisiPersonne ? 'rgba(16, 185, 129, 0.22)' : 'var(--input-bg)',
                        border: aChoisiPersonne ? '1.5px solid #10b981' : '1px solid var(--card-border)',
                        color: aChoisiPersonne ? '#10b981' : 'var(--text-color)',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                        <ShieldCheck size={16} style={{ color: '#10b981' }} />
                        <span>N'accuser personne (Vote blanc)</span>
                      </span>
                      {aChoisiPersonne && (
                        <span style={{ fontSize: '0.75rem', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <CheckCircle2 size={14} /> Choisi
                        </span>
                      )}
                    </button>
                  </div>

                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                    {candidates.map(nom => {
                      const isSelected = mesAccusations.includes(nom);
                      const accusationCount = countAccusationsFor(nom);

                      return (
                        <li
                          key={nom}
                          onClick={() => handleTogglePlayerAccusation(nom)}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: isSelected ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                            color: isSelected ? '#fff' : 'var(--text-color)',
                            border: isSelected ? '1.5px solid #ef4444' : '1px solid var(--card-border)',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {isSelected ? (
                              <CheckSquare size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                            ) : (
                              <Square size={18} style={{ opacity: 0.35, flexShrink: 0 }} />
                            )}
                            <span style={{ fontWeight: 700 }}>{nom}</span>
                            {accusationCount > 0 && (
                              <span style={{ fontSize: '0.72rem', background: isSelected ? 'rgba(0,0,0,0.3)' : 'rgba(239,68,68,0.18)', color: isSelected ? '#fff' : '#ef4444', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                                {accusationCount} accusation{accusationCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', fontWeight: 700, color: isSelected ? '#ef4444' : 'var(--text-muted)' }}>
                            {isSelected ? 'Accusé' : 'Accuser'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div style={{ marginTop: '0.85rem', textAlign: 'center', fontSize: '0.88rem' }}>
                    {aChoisiPersonne ? (
                      <p className="text-font" style={{ color: 'var(--success)', margin: 0, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} />
                        <span>Vous avez choisi de n'accuser personne (Vote blanc).</span>
                      </p>
                    ) : isAllCandidatesSelected ? (
                      <p className="text-font" style={{ color: '#ef4444', margin: 0, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} />
                        <span>Vous accusez tout le village ({candidates.length} habitants).</span>
                      </p>
                    ) : mesAccusations.length > 0 ? (
                      <p className="text-font" style={{ color: '#ef4444', margin: 0, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={16} />
                        <span>Vous accusez {mesAccusations.length} joueur(s) : <strong>{mesAccusations.join(', ')}</strong></span>
                      </p>
                    ) : (
                      <p className="text-font text-muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                        Sélectionnez une ou plusieurs personnes à accuser, ou accusez tout le village.
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── 2. PHASE DE DÉFENSE DES ACCUSÉS (JOUR_DEFENSE) ───────────────── */}
        {salonData.statut === 'jour_defense' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
              <h3 className="title-font" style={{ color: '#8b5cf6', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}>
                <Drama size={20} /> Phase de Défense des Accusés
              </h3>
              <PhaseTimer
                phaseStartedAt={salonData.phase_started_at}
                durationSec={salonData.duree_defense !== undefined ? salonData.duree_defense : 60}
                label="Temps de défense"
              />
            </div>

            {/* Pouvoir Illusionniste si accusé */}
            {me.role === 'illusionniste' && me.illusion_dispo && salonData?.la_liste_accuses?.includes(me.nom) && (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(139,92,246,0.15)', border: '1.5px solid #8b5cf6', borderRadius: '12px' }}>
                <h4 className="title-font" style={{ color: '#c4b5fd', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={16} /> Pouvoir de l'Illusionniste
                </h4>
                <p className="text-font" style={{ fontSize: '0.85rem', marginBottom: '0.85rem' }}>
                  Vous faites partie des accusés ! Activez votre miroir illusoire pour survivre si le village vote contre vous.
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

            {/* Bannière si je suis accusé */}
            {salonData.la_liste_accuses?.includes(me.nom) ? (
              <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.18)', border: '1.5px solid #ef4444', borderRadius: '10px', marginBottom: '1rem', color: '#fca5a5', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                <span>Vous êtes accusé(e) ! Prenez la parole dans le chat de défense ci-dessous pour prouver votre innocence avant le vote.</span>
              </div>
            ) : (
              <p className="text-font text-muted" style={{ marginBottom: '0.85rem', fontSize: '0.88rem' }}>
                Les accusés suivants ({salonData.la_liste_accuses?.join(', ')}) présentent leur défense. Lisez leurs arguments avant le vote d'élimination.
              </p>
            )}

            {/* Chat de défense des accusés */}
            <div style={{ marginBottom: '1rem' }}>
              <AccusedDefenseChat
                roomId={roomId}
                salonData={salonData}
                senderName={me.nom}
                isDead={false}
              />
            </div>
          </div>
        )}

        {/* ── 3. VOTE D'ÉLIMINATION DU VILLAGE (JOUR_VOTE) ─────────────────── */}
        {salonData.statut === 'jour_vote' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
              <h3 className="title-font" style={{ color: '#ef4444', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}>
                <Gavel size={20} /> Vote d'Élimination
              </h3>
              <PhaseTimer
                phaseStartedAt={salonData.phase_started_at}
                durationSec={salonData.duree_vote !== undefined ? salonData.duree_vote : 60}
                label="Temps de vote"
              />
            </div>

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

            {me.gracie_idiot ? (
              <div style={{ padding: '1rem', background: 'rgba(132,204,22,0.12)', border: '1.5px solid #84cc16', borderRadius: '12px', textAlign: 'center' }}>
                <p className="text-font" style={{ margin: 0, color: '#a3e635', fontWeight: 700, fontSize: '0.9rem' }}>
                  Vous avez été gracié en tant qu'Idiot du Village : vous êtes en vie mais vous ne pouvez plus voter.
                </p>
              </div>
            ) : (() => {
              const rawMonVote = salonData?.votes?.[me.nom];
              const monVoteCible = typeof rawMonVote === 'string' ? rawMonVote : (Array.isArray(rawMonVote) ? rawMonVote[0] : null);
              const aGracie = monVoteCible === 'Personne';

              // Uniquement les accusés (hors soi-même)
              const accusedCandidates = (salonData.la_liste_accuses || []).filter(nom => nom !== me.nom);

              const handleVoteTarget = async (nom) => {
                const nextVote = monVoteCible === nom ? null : nom;
                try {
                  if (nextVote === null) {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: deleteField(),
                    });
                  } else {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: nextVote,
                    });
                  }
                } catch (e) { console.error(e); }
              };

              const handleGracier = async () => {
                const nextVote = aGracie ? null : 'Personne';
                try {
                  if (nextVote === null) {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: deleteField(),
                    });
                  } else {
                    await updateDoc(doc(db, 'salons', roomId), {
                      [`votes.${me.nom}`]: 'Personne',
                    });
                  }
                } catch (e) { console.error(e); }
              };

              return (
                <div>
                  <p className="text-font text-muted" style={{ marginBottom: '0.85rem', fontSize: '0.88rem' }}>
                    Votez pour l'unique accusé à éliminer au bûcher, ou choisissez de gracier les accusés.
                  </p>

                  {/* Option Gracier / Vote blanc */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={handleGracier}
                      className="text-font"
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        background: aGracie ? 'rgba(16, 185, 129, 0.22)' : 'var(--input-bg)',
                        border: aGracie ? '1.5px solid #10b981' : '1px solid var(--card-border)',
                        color: aGracie ? '#10b981' : 'var(--text-color)',
                        fontWeight: 700,
                        fontSize: '0.86rem',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                        <ShieldCheck size={17} style={{ color: '#10b981' }} />
                        <span>Gracier les accusés (Ne tuer personne)</span>
                      </span>
                      {aGracie && (
                        <span style={{ fontSize: '0.8rem', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={15} /> Choisi
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Liste des accusés */}
                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                    {accusedCandidates.map(nom => {
                      const isVoted = monVoteCible === nom;
                      return (
                        <li
                          key={nom}
                          onClick={() => handleVoteTarget(nom)}
                          style={{
                            padding: '11px 14px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: isVoted ? '#ef4444' : 'rgba(255,255,255,0.05)',
                            color: isVoted ? '#fff' : 'var(--text-color)',
                            border: isVoted ? '1px solid #b91c1c' : '1px solid var(--card-border)',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>{nom}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', fontWeight: 700 }}>
                            {isVoted ? (
                              <><CheckCircle2 size={15} /> Vote pour éliminer</>
                            ) : (
                              'Voter contre'
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {monVoteCible && (
                    <div style={{ marginTop: '0.85rem', textAlign: 'center' }}>
                      <p className="text-font" style={{ color: aGracie ? 'var(--success)' : '#ef4444', margin: 0, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}>
                        <CheckCircle2 size={16} />
                        {aGracie ? (
                          "Vous avez voté pour gracier les accusés."
                        ) : (
                          <>Votre vote pour éliminer <strong>{monVoteCible}</strong> est enregistré.</>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SENTENCE & CONDAMNATION DU VILLAGE (JOUR_RESOLUTION) ─────────── */}
        {salonData.statut === 'jour_resolution' && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <VerdictResolutionCard roomId={roomId} salonData={salonData} joueurs={joueurs} onSelectRole={r => setInspectRole(r)} isMainAction={true} />
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

        {/* Cimetière du Village : tous les défunts avec leurs rôles dévoilés */}
        {joueurs.some(j => j.statut_joueur === 'mort') && (
          <div className="glass-panel" style={{ marginTop: '1.25rem', padding: '1.25rem', borderRadius: '1.25rem', textAlign: 'left', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '0.85rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem' }}>
              <h3 className="title-font" style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171' }}>
                <Skull size={18} style={{ color: '#ef4444' }} /> Cimetière ({joueurs.filter(j => j.statut_joueur === 'mort').length})
              </h3>
              <span className="text-font" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Cliquez sur un rôle pour le détail
              </span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }} className="text-font">
              {joueurs.filter(j => j.statut_joueur === 'mort').map(j => {
                const rObj = j.role ? getRole(j.role) : null;
                return (
                  <li
                    key={j.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      background: 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid var(--card-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <Skull size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.9rem' }}>
                        {j.nom} {j.id === me.id && '(Vous)'}
                      </span>
                    </div>
                    {rObj ? (
                      <RoleChip
                        roleObj={rObj}
                        onSelectRole={r => setInspectRole(r)}
                        suffix={
                          j.est_infecte
                            ? '(Infecté)'
                            : j.pouvoirs_perdus_ancien && j.ancien_role
                              ? `(Ex-${getRole(j.ancien_role)?.name || j.ancien_role})`
                              : undefined
                        }
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
        hideActiveRoles={true}
      />
    </div>
  );
}
