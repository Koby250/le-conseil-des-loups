import { useState, useEffect, useRef } from 'react';
import {
  Bot, Cpu, Play, Pause, UserPlus, Trash2, Zap,
  Sparkles, CheckCircle2, AlertTriangle, RefreshCw, Dices, User,
} from 'lucide-react';
import {
  isBot, addSingleBot, fillSalonWithBots,
  botAutoPickCards, removeAllBots, runBotTurnStep,
} from './aiBotEngine';

export default function AiTestPanel({ roomId, salonData, joueurs = [] }) {
  const [isAutonomous, setIsAutonomous] = useState(() => {
    return localStorage.getItem(`loup_garou_${roomId}_ai_auto`) === 'true';
  });
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [lastActionMsg, setLastActionMsg] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const bots = joueurs.filter(j => isBot(j));
  const aliveBots = bots.filter(j => j.statut_joueur !== 'mort');
  const humanPlayers = joueurs.filter(j => !isBot(j));
  const aliveHumans = humanPlayers.filter(j => j.statut_joueur !== 'mort');
  const targetCount = Array.isArray(salonData?.roles_selectionnes)
    ? salonData.roles_selectionnes.length
    : (salonData?.roles_melanges?.length || 6);

  // Sauvegarde de la préférence IA autonome
  const toggleAutonomous = () => {
    setIsAutonomous(prev => {
      const next = !prev;
      localStorage.setItem(`loup_garou_${roomId}_ai_auto`, String(next));
      return next;
    });
  };

  // ── Boucle autonome de l'IA (active quand des bots sont présents et le mode auto est ON) ──
  const isRunningRef = useRef(false);
  useEffect(() => {
    if (!isAutonomous || bots.length === 0 || !salonData) return;

    const timer = setTimeout(async () => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      try {
        const msg = await runBotTurnStep(roomId, salonData, joueurs);
        if (msg) {
          setLastActionMsg(msg);
        }
      } catch (err) {
        console.error('Erreur boucle IA:', err);
      } finally {
        isRunningRef.current = false;
      }
    }, 1400);

    return () => clearTimeout(timer);
  }, [isAutonomous, salonData?.statut, salonData?.vote_loup_temporaire, salonData?.victime_loups, salonData?.la_liste_accuses, salonData?.votes, bots.length, joueurs]);

  // ── Handlers manuels ──
  const handleAddOneBot = async () => {
    setIsProcessing(true);
    try {
      const name = await addSingleBot(roomId, salonData, joueurs);
      if (name) setLastActionMsg(`Bot ajouté : ${name}`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFillWithBots = async () => {
    setIsProcessing(true);
    try {
      const count = await fillSalonWithBots(roomId, salonData, joueurs);
      setLastActionMsg(`${count} Bot(s) IA ajouté(s) pour compléter le salon.`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutoPickCards = async () => {
    setIsProcessing(true);
    try {
      const count = await botAutoPickCards(roomId, salonData, joueurs, { forceEvenIfHumanWaiting: true });
      setLastActionMsg(`${count} Bot(s) ont tiré leur carte.`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveAllBots = async () => {
    if (!window.confirm("Supprimer tous les Bots IA du salon ?")) return;
    setIsProcessing(true);
    try {
      const count = await removeAllBots(roomId, joueurs);
      setLastActionMsg(`${count} Bot(s) IA retiré(s).`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerStepNow = async () => {
    setIsRunningStep(true);
    try {
      const msg = await runBotTurnStep(roomId, salonData, joueurs);
      if (msg) setLastActionMsg(msg);
      else setLastActionMsg("Tous les Bots IA sont déjà à jour pour cette phase.");
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunningStep(false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        marginTop: '1.25rem',
        padding: '1.25rem 1.4rem',
        borderRadius: '1.25rem',
        border: '1.5px solid #06b6d4',
        background: 'linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(139,92,246,0.08) 100%)',
        textAlign: 'left',
      }}
    >
      {/* En-tête du panneau IA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(6,182,212,0.2)', color: '#06b6d4' }}>
            <Bot size={22} />
          </div>
          <div>
            <h3 className="title-font" style={{ margin: 0, fontSize: '1.1rem', color: '#06b6d4' }}>
              Simulateur & Joueurs IA
            </h3>
            <p className="text-font" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Mélangez de vrais joueurs et des bots IA, ou lancez une simulation à 100% de bots
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            className="text-font"
            style={{
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 700,
              background: humanPlayers.length > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
              color: humanPlayers.length > 0 ? '#10b981' : 'var(--text-muted)',
              border: '1px solid rgba(16,185,129,0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <User size={13} />
            {humanPlayers.length} Humain{humanPlayers.length > 1 ? 's' : ''} ({aliveHumans.length} en vie)
          </span>

          <span
            className="text-font"
            style={{
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 700,
              background: bots.length > 0 ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.06)',
              color: bots.length > 0 ? '#06b6d4' : 'var(--text-muted)',
              border: '1px solid rgba(6,182,212,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Bot size={14} />
            {bots.length} Bot{bots.length > 1 ? 's' : ''} ({aliveBots.length} en vie)
          </span>

          <button
            type="button"
            onClick={toggleAutonomous}
            className={`text-font ${isAutonomous ? 'glow-button' : ''}`}
            style={{
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: isAutonomous ? '1px solid #10b981' : '1px solid var(--card-border)',
              background: isAutonomous ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
              color: isAutonomous ? '#10b981' : 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isAutonomous ? <Play size={13} fill="#10b981" /> : <Pause size={13} />}
            <span>Auto IA : {isAutonomous ? 'ACTIF' : 'PAUSE'}</span>
          </button>
        </div>
      </div>

      {/* Boutons d'actions rapides */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <button
          type="button"
          onClick={handleFillWithBots}
          disabled={isProcessing || joueurs.length >= targetCount}
          className="btn-secondary text-font"
          style={{ flex: '1 1 180px', padding: '8px 12px', fontSize: '0.82rem', borderColor: '#06b6d4', color: '#06b6d4' }}
        >
          <Sparkles size={15} />
          <span>Remplir le salon ({targetCount} joueurs)</span>
        </button>

        <button
          type="button"
          onClick={handleAddOneBot}
          disabled={isProcessing || joueurs.length >= targetCount}
          className="btn-secondary text-font"
          style={{ flex: '0 1 auto', padding: '8px 12px', fontSize: '0.82rem' }}
        >
          <UserPlus size={15} />
          <span>+1 Bot</span>
        </button>

        {salonData?.statut === 'en_attente' && salonData?.distribution_mode !== 'manuelle' && (
          <button
            type="button"
            onClick={handleAutoPickCards}
            disabled={isProcessing}
            className="btn-secondary text-font"
            style={{ flex: '1 1 160px', padding: '8px 12px', fontSize: '0.82rem', borderColor: '#a855f7', color: '#c084fc' }}
          >
            <Dices size={15} />
            <span>Tirer cartes des Bots</span>
          </button>
        )}

        {salonData?.statut !== 'SETUP' && salonData?.statut !== 'en_attente' && bots.length > 0 && (
          <button
            type="button"
            onClick={handleTriggerStepNow}
            disabled={isRunningStep}
            className="btn-primary text-font"
            style={{ flex: '1 1 180px', padding: '8px 14px', fontSize: '0.82rem', background: '#06b6d4', color: '#082f49', fontWeight: 800 }}
          >
            {isRunningStep ? <RefreshCw className="spinner" size={15} /> : <Zap size={15} />}
            <span>Faire agir les Bots maintenant</span>
          </button>
        )}

        {bots.length > 0 && (
          <button
            type="button"
            onClick={handleRemoveAllBots}
            disabled={isProcessing}
            className="btn-secondary text-font"
            style={{ padding: '8px 12px', fontSize: '0.82rem', borderColor: 'rgba(239,68,68,0.5)', color: '#ef4444' }}
            title="Supprimer tous les bots"
          >
            <Trash2 size={15} />
            <span>Vider les Bots</span>
          </button>
        )}
      </div>

      {/* Message de dernière action menée par l'IA */}
      {lastActionMsg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(0,0,0,0.25)',
            borderLeft: '3px solid #06b6d4',
            fontSize: '0.82rem',
            color: 'var(--text-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Cpu size={14} style={{ color: '#06b6d4', flexShrink: 0 }} />
          <span>{lastActionMsg}</span>
        </div>
      )}
    </div>
  );
}
