import { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, arrayUnion, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { getRole } from './rolesData';
import { RoleCardView, RoleIcon } from './RoleComponents';
import {
  MessageSquare, Send, Bell, PawPrint, Gavel, Megaphone,
  User, Users, CheckCircle2, X, Sparkles, RefreshCw, Trash2,
  Scale, AlertTriangle,
} from 'lucide-react';

// ─── 1. Chat nocturne de la Meute des Loups ──────────────────────────────────
export function WolfPackChat({ roomId, salonData, senderName, isReadOnly = false }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const messages = Array.isArray(salonData?.chat_loups) ? salonData.chat_loups : [];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending || isReadOnly) return;
    setSending(true);
    const msgObj = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      auteur: senderName,
      texte: text.trim(),
      heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        chat_loups: arrayUnion(msgObj),
      });
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        borderRadius: '12px',
        background: 'rgba(127, 29, 29, 0.22)',
        border: '1.5px solid rgba(239, 68, 68, 0.45)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
        <h4 className="title-font" style={{ margin: 0, color: '#fca5a5', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PawPrint size={16} style={{ color: '#ef4444' }} />
          <span>Chat secret de la Meute</span>
        </h4>
        <span className="text-font" style={{ fontSize: '0.72rem', color: '#fca5a5', opacity: 0.8 }}>
          {messages.length} message(s)
        </span>
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: '190px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '0.5rem',
          borderRadius: '8px',
          background: 'rgba(0, 0, 0, 0.35)',
          marginBottom: isReadOnly ? 0 : '0.65rem',
        }}
      >
        {messages.length === 0 ? (
          <p className="text-font" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem 0' }}>
            Aucun message. Concertation secrète entre loups pour choisir la victime...
          </p>
        ) : (
          messages.map((m) => {
            const isMine = m.auteur === senderName;
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isMine ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  background: isMine ? 'rgba(239, 68, 68, 0.35)' : 'rgba(255, 255, 255, 0.08)',
                  border: isMine ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.7rem', color: '#fca5a5', fontWeight: 700, marginBottom: '2px' }}>
                  <span>{m.auteur}</span>
                  <span style={{ opacity: 0.7 }}>{m.heure}</span>
                </div>
                <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: '#f8fafc', wordBreak: 'break-word', lineHeight: 1.35 }}>
                  {m.texte}
                </p>
              </div>
            );
          })
        )}
      </div>

      {!isReadOnly && (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Proposer une cible aux loups..."
            maxLength={220}
            className="text-font"
            style={{
              flex: 1,
              padding: '8px 11px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              background: 'rgba(0, 0, 0, 0.4)',
              color: '#fff',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="btn-primary"
            style={{ width: 'auto', padding: '8px 14px', background: '#ef4444', fontSize: '0.82rem' }}
          >
            <Send size={15} />
          </button>
        </form>
      )}
    </div>
  );
}

// ─── 2. Chat des Accusations (Débats de la Place Publique) ────────────────────
export function AccusationsChat({ roomId, salonData, senderName, isMj = false, isDead = false }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const messages = Array.isArray(salonData?.chat_accusation) ? salonData.chat_accusation : [];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending || isDead) return;
    setSending(true);
    const msgObj = {
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      auteur: senderName,
      roleBadge: isMj ? 'MJ' : 'VILLAGE',
      texte: text.trim(),
      heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        chat_accusation: arrayUnion(msgObj),
      });
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        borderRadius: '14px',
        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(220, 38, 38, 0.03) 100%)',
        border: '1.5px solid rgba(239, 68, 68, 0.45)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Megaphone size={16} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h4 className="title-font" style={{ margin: 0, color: '#ef4444', fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Place Publique — Débats & Accusations
            </h4>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Échangez vos soupçons et donnez vos arguments pour inciter le village à accuser
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 800,
            padding: '3px 8px',
            borderRadius: '6px',
            background: '#ef4444',
            color: '#fff',
            letterSpacing: '0.4px',
          }}
        >
          PHASE 1 · ACCUSATIONS
        </span>
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: '210px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '0.55rem',
          borderRadius: '8px',
          background: 'rgba(0, 0, 0, 0.3)',
          marginBottom: isDead ? 0 : '0.65rem',
        }}
      >
        {messages.length === 0 ? (
          <p className="text-font" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem 0' }}>
            Aucun argument déposé pour le moment. Proposez un suspect et incitez vos concitoyens à l'accuser !
          </p>
        ) : (
          messages.map((m) => {
            const isMine = m.auteur === senderName;
            const isMjMsg = m.roleBadge === 'MJ';
            return (
              <div
                key={m.id}
                style={{
                  padding: '7px 10px',
                  borderRadius: '8px',
                  background: isMine
                    ? 'rgba(239, 68, 68, 0.18)'
                    : isMjMsg
                      ? 'rgba(139, 92, 246, 0.2)'
                      : 'rgba(255, 255, 255, 0.06)',
                  borderLeft: `3px solid ${isMine ? '#ef4444' : isMjMsg ? '#8b5cf6' : 'rgba(239, 68, 68, 0.4)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong className="text-font" style={{ fontSize: '0.78rem', color: isMine ? '#fca5a5' : 'var(--text-color)' }}>
                      {m.auteur}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '1rem',
                        background: isMjMsg ? '#8b5cf6' : 'rgba(239, 68, 68, 0.22)',
                        color: isMjMsg ? '#fff' : '#fca5a5',
                        border: isMjMsg ? 'none' : '1px solid rgba(239, 68, 68, 0.4)',
                      }}
                    >
                      {isMjMsg ? 'MAÎTRE DU JEU' : 'HABITANT'}
                    </span>
                  </div>
                  <span className="text-font" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {m.heure}
                  </span>
                </div>
                <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-color)', wordBreak: 'break-word', lineHeight: 1.38 }}>
                  {m.texte}
                </p>
              </div>
            );
          })
        )}
      </div>

      {!isDead && (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              isMj
                ? "Intervenir dans le débat en tant que Maître du Jeu..."
                : "Partager des soupçons ou inciter à accuser un joueur..."
            }
            maxLength={260}
            className="text-font"
            style={{
              flex: 1,
              padding: '8px 11px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              background: 'var(--input-bg)',
              color: 'var(--text-color)',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="btn-primary"
            style={{ width: 'auto', padding: '8px 14px', background: '#ef4444', fontSize: '0.82rem' }}
          >
            <Send size={15} />
          </button>
        </form>
      )}
    </div>
  );
}

// ─── 3. Chat de Défense des Accusés (Tribunal du Village) ────────────────────
export function AccusedDefenseChat({ roomId, salonData, senderName, isMj = false, isDead = false }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const accusesList = Array.isArray(salonData?.la_liste_accuses) ? salonData.la_liste_accuses : [];
  const isSenderAccused = accusesList.includes(senderName);
  const messages = Array.isArray(salonData?.chat_defense) ? salonData.chat_defense : [];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending || isDead) return;
    setSending(true);
    const msgObj = {
      id: `def_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      auteur: senderName,
      roleBadge: isMj ? 'MJ' : isSenderAccused ? 'ACCUSÉ' : 'VILLAGE',
      texte: text.trim(),
      heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        chat_defense: arrayUnion(msgObj),
      });
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        borderRadius: '14px',
        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(109, 40, 217, 0.03) 100%)',
        border: '1.5px solid rgba(139, 92, 246, 0.45)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: 'rgba(139, 92, 246, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Gavel size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h4 className="title-font" style={{ margin: 0, color: '#c4b5fd', fontSize: '0.96rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Tribunal du Village — Plaidoyers & Défenses
            </h4>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Les accusés ont la parole pour prouver leur innocence avant le vote final
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {isSenderAccused && (
            <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.25)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
              VOUS ÊTES ACCUSÉ
            </span>
          )}
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: '6px',
              background: '#8b5cf6',
              color: '#fff',
              letterSpacing: '0.4px',
            }}
          >
            PHASE 2 · DÉFENSES
          </span>
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: '210px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '0.55rem',
          borderRadius: '8px',
          background: 'rgba(0, 0, 0, 0.3)',
          marginBottom: isDead ? 0 : '0.65rem',
        }}
      >
        {messages.length === 0 ? (
          <p className="text-font" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem 0' }}>
            Les accusés peuvent présenter leur plaidoyer ici avant que le village ne tranche...
          </p>
        ) : (
          messages.map((m) => {
            const isAccusedMsg = m.roleBadge === 'ACCUSÉ' || accusesList.includes(m.auteur);
            const isMjMsg = m.roleBadge === 'MJ';
            const isMine = m.auteur === senderName;
            return (
              <div
                key={m.id}
                style={{
                  padding: '7px 10px',
                  borderRadius: '8px',
                  background: isAccusedMsg
                    ? 'rgba(239, 68, 68, 0.16)'
                    : isMjMsg
                      ? 'rgba(139, 92, 246, 0.2)'
                      : 'rgba(255, 255, 255, 0.06)',
                  borderLeft: `3px solid ${isAccusedMsg ? '#ef4444' : isMjMsg ? '#8b5cf6' : '#64748b'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong className="text-font" style={{ fontSize: '0.78rem', color: isMine ? '#c4b5fd' : 'var(--text-color)' }}>
                      {m.auteur}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '1rem',
                        background: isAccusedMsg ? '#ef4444' : isMjMsg ? '#8b5cf6' : 'rgba(255,255,255,0.12)',
                        color: '#fff',
                      }}
                    >
                      {isAccusedMsg ? 'ACCUSÉ' : isMjMsg ? 'MAÎTRE DU JEU' : 'VILLAGE'}
                    </span>
                  </div>
                  <span className="text-font" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {m.heure}
                  </span>
                </div>
                <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-color)', wordBreak: 'break-word', lineHeight: 1.38 }}>
                  {m.texte}
                </p>
              </div>
            );
          })
        )}
      </div>

      {!isDead && (
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              isSenderAccused
                ? 'Écrivez votre plaidoyer pour vous défendre...'
                : isMj
                  ? 'Intervenir dans le débat en tant que MJ...'
                  : 'Poser une question aux accusés ou argumenter...'
            }
            maxLength={260}
            className="text-font"
            style={{
              flex: 1,
              padding: '8px 11px',
              borderRadius: '8px',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              background: 'var(--input-bg)',
              color: 'var(--text-color)',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="btn-primary"
            style={{ width: 'auto', padding: '8px 14px', background: '#8b5cf6', fontSize: '0.82rem' }}
          >
            <Send size={15} />
          </button>
        </form>
      )}
    </div>
  );
}

// ─── 3. Panneau de Messagerie du MJ (vers Tous ou un Joueur précis) ──────────
export function MjMessengerPanel({ roomId, salonData, joueurs }) {
  const [cible, setCible] = useState('TOUS');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const messages = Array.isArray(salonData?.messages_mj) ? salonData.messages_mj : [];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const targetPlayer = cible === 'TOUS' ? null : joueurs.find((j) => j.id === cible);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);

    const msgObj = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      cible: cible,
      cible_nom: cible === 'TOUS' ? 'Tous les joueurs' : (targetPlayer?.nom || 'Joueur'),
      texte: text.trim(),
      timestamp: Date.now(),
      heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    try {
      await updateDoc(doc(db, 'salons', roomId), {
        messages_mj: arrayUnion(msgObj),
      });
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm("Effacer tout l'historique des messages du Maître du Jeu ?")) return;
    try {
      await updateDoc(doc(db, 'salons', roomId), { messages_mj: [] });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '1.25rem',
        borderRadius: '1.25rem',
        border: '1.5px solid var(--border-accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* En-tête avec bouton vider */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 className="title-font" style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={19} style={{ color: 'var(--primary)' }} />
          <span>Messagerie du Maître du Jeu</span>
        </h3>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClearHistory}
            className="text-font"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.74rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Trash2 size={12} /> Vider l'historique
          </button>
        )}
      </div>

      {/* Sélection du destinataire : Bouton "Tous les joueurs" + Liste déroulante compacte */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setCible('TOUS')}
          className="text-font"
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: cible === 'TOUS' ? 'var(--primary)' : 'var(--input-bg)',
            color: cible === 'TOUS' ? '#fff' : 'var(--text-color)',
            border: cible === 'TOUS' ? '1.5px solid var(--primary)' : '1px solid var(--card-border)',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap',
          }}
        >
          <Users size={15} /> Tous les joueurs
        </button>

        <select
          value={cible === 'TOUS' ? '' : cible}
          onChange={(e) => setCible(e.target.value || 'TOUS')}
          className="text-font"
          style={{
            flex: '1 1 200px',
            padding: '8px 12px',
            borderRadius: '8px',
            border: cible !== 'TOUS' ? '1.5px solid #ec4899' : '1px solid var(--card-border)',
            background: 'var(--input-bg)',
            color: 'var(--text-color)',
            fontSize: '0.86rem',
            fontWeight: cible !== 'TOUS' ? 700 : 500,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">Sélectionner un joueur en particulier...</option>
          {joueurs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.nom} {j.statut_joueur === 'mort' ? '(Mort)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Indicateur de destinataire */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span>Destinataire :</span>
        <strong style={{ color: cible === 'TOUS' ? 'var(--primary)' : '#ec4899', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {cible === 'TOUS' ? (
            <><Users size={12} /> Tous les joueurs (Annonce publique)</>
          ) : (
            <><User size={12} /> Message privé pour {targetPlayer?.nom || 'Joueur'}</>
          )}
        </strong>
      </div>

      {/* Historique des messages envoyés */}
      {messages.length > 0 && (
        <div
          ref={listRef}
          style={{
            maxHeight: '135px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '0.5rem',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--card-border)',
          }}
        >
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: '6px 9px',
                borderRadius: '6px',
                background: 'var(--input-bg)',
                borderLeft: `3px solid ${m.cible === 'TOUS' ? 'var(--primary)' : '#ec4899'}`,
                fontSize: '0.8rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                <strong style={{ color: m.cible === 'TOUS' ? 'var(--primary)' : '#ec4899' }}>
                  À : {m.cible_nom}
                </strong>
                <span>{m.heure}</span>
              </div>
              <div className="text-font" style={{ color: 'var(--text-color)', wordBreak: 'break-word' }}>
                {m.texte}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire d'envoi */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: '6px', width: '100%' }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            cible === 'TOUS'
              ? "Message d'annonce à tous les joueurs..."
              : `Message privé pour ${targetPlayer?.nom || 'le joueur'}...`
          }
          maxLength={280}
          className="text-font"
          style={{
            flex: 1,
            padding: '9px 12px',
            borderRadius: '8px',
            border: '1px solid var(--card-border)',
            background: 'var(--input-bg)',
            color: 'var(--text-color)',
            fontSize: '0.86rem',
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="btn-primary"
          style={{
            width: 'auto',
            padding: '9px 15px',
            fontSize: '0.84rem',
            background: cible === 'TOUS' ? 'var(--primary)' : '#ec4899',
            flexShrink: 0,
          }}
        >
          <Send size={15} />
          <span>Envoyer</span>
        </button>
      </form>
    </div>
  );
}

// ─── 4. Réception et Notification des messages du MJ côté Joueur ─────────────
export function PlayerMjNotificationAndInbox({ roomId, me, salonData }) {
  const storageKey = `loup_garou_${roomId}_${me?.id}_lastMjMsg`;
  const [lastSeenId, setLastSeenId] = useState(() => localStorage.getItem(storageKey) || '');
  const [unreadPopupMsg, setUnreadPopupMsg] = useState(null);
  const [showInbox, setShowInbox] = useState(false);

  const allMjMessages = Array.isArray(salonData?.messages_mj) ? salonData.messages_mj : [];
  const myMessages = allMjMessages.filter(
    (m) => m.cible === 'TOUS' || m.cible === me?.id,
  );

  useEffect(() => {
    if (myMessages.length === 0) return;
    const latest = myMessages[myMessages.length - 1];
    if (latest && latest.id !== lastSeenId) {
      setUnreadPopupMsg(latest);
      try {
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      } catch {
        // Ignore vibration errors
      }
    }
  }, [myMessages.length, lastSeenId]);

  const handleDismissNotification = () => {
    if (unreadPopupMsg) {
      localStorage.setItem(storageKey, unreadPopupMsg.id);
      setLastSeenId(unreadPopupMsg.id);
    }
    setUnreadPopupMsg(null);
  };

  return (
    <>
      {/* Bouton discret d'accès à la boîte de réception s'il y a des messages du MJ */}
      {myMessages.length > 0 && (
        <div style={{ marginTop: '0.75rem', textAlign: 'left' }}>
          <button
            type="button"
            onClick={() => setShowInbox(!showInbox)}
            className="btn-secondary text-font"
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '0.55rem 0.9rem',
              fontSize: '0.8rem',
              borderColor: 'var(--border-accent)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <MessageSquare size={15} style={{ color: 'var(--primary)' }} />
              <span>Messages du Maître du Jeu ({myMessages.length})</span>
            </span>
            <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
              {showInbox ? 'Masquer' : 'Lire'}
            </span>
          </button>

          {showInbox && (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                borderRadius: '10px',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                maxHeight: '180px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {myMessages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.2)',
                    borderLeft: `3px solid ${m.cible === me?.id ? '#ec4899' : 'var(--primary)'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    <strong style={{ color: m.cible === me?.id ? '#ec4899' : 'var(--primary)' }}>
                      {m.cible === me?.id ? 'Message privé du MJ' : 'Annonce générale du MJ'}
                    </strong>
                    <span>{m.heure}</span>
                  </div>
                  <p className="text-font" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-color)' }}>
                    {m.texte}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notification modale instantanée quand le MJ envoie un message */}
      {unreadPopupMsg && (
        <div
          className="modal-overlay"
          style={{ zIndex: 420 }}
          onClick={handleDismissNotification}
        >
          <div
            className="modal-content glass-panel"
            style={{
              maxWidth: '420px',
              border: '2px solid var(--primary)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 30px var(--accent-glow)',
              textAlign: 'center',
              padding: '1.75rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'rgba(139, 92, 246, 0.18)',
                border: '1.5px solid var(--primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                marginBottom: '0.85rem',
              }}
            >
              <Bell size={26} />
            </div>

            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: unreadPopupMsg.cible === me?.id ? '#ec4899' : 'var(--primary)',
                marginBottom: '0.35rem',
              }}
            >
              {unreadPopupMsg.cible === me?.id ? 'Message Privé' : 'Annonce Générale'}
            </div>

            <h3 className="title-font" style={{ fontSize: '1.2rem', margin: '0 0 1rem', color: 'var(--text-color)' }}>
              Le Maître du Jeu vous a envoyé un message
            </h3>

            <div
              className="text-font"
              style={{
                padding: '1rem 1.15rem',
                borderRadius: '12px',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--text-color)',
                fontSize: '0.96rem',
                lineHeight: 1.5,
                marginBottom: '1.25rem',
                wordBreak: 'break-word',
              }}
            >
              « {unreadPopupMsg.texte} »
            </div>

            <button
              type="button"
              onClick={handleDismissNotification}
              className="btn-primary title-font glow-button"
            >
              <CheckCircle2 size={18} /> J'ai bien reçu le message
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 5. Modale d'Acceptation / Refus de Changement de Rôle en cours de partie ─
export function RoleChangeProposalModal({ roomId, me, onInspectRole }) {
  const [processing, setProcessing] = useState(false);

  const proposedRoleId = me?.proposition_role?.roleId;
  if (!proposedRoleId) return null;

  const proposedRole = getRole(proposedRoleId);
  if (!proposedRole) return null;

  const handleDecision = async (accepted) => {
    if (processing) return;
    setProcessing(true);
    try {
      await runTransaction(db, async (transaction) => {
        const playerRef = doc(db, 'salons', roomId, 'joueurs', me.id);
        const salonRef  = doc(db, 'salons', roomId);

        if (accepted) {
          transaction.update(playerRef, {
            role: proposedRole.id,
            vies: proposedRole.id === 'ancien' ? 2 : 1,
            infection_dispo: proposedRole.id === 'infect-pere-des-loups' || proposedRole.id === 'pere-des-loups',
            proposition_role: null,
          });
          transaction.update(salonRef, {
            notifications_mj: arrayUnion(
              `${me.nom} a ACCEPTÉ son nouveau rôle : ${proposedRole.name}.`,
            ),
          });
        } else {
          transaction.update(playerRef, {
            proposition_role: null,
          });
          transaction.update(salonRef, {
            notifications_mj: arrayUnion(
              `${me.nom} a REFUSÉ le changement de rôle proposé (${proposedRole.name}).`,
            ),
          });
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 450 }}>
      <div
        className="modal-content glass-panel"
        style={{
          maxWidth: '460px',
          width: '100%',
          padding: '1.5rem',
          border: `2px solid ${proposedRole.color}`,
          boxShadow: `0 25px 60px rgba(0,0,0,0.6), 0 0 35px ${proposedRole.color}40`,
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '2rem', background: 'rgba(245, 158, 11, 0.16)', border: '1px solid rgba(245, 158, 11, 0.45)', color: '#fbbf24', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.6rem' }}>
          <RefreshCw size={13} /> Proposition du Maître du Jeu
        </div>

        <h3 className="title-font" style={{ fontSize: '1.25rem', color: 'var(--text-color)', marginBottom: '0.4rem' }}>
          Nouveau rôle proposé
        </h3>
        <p className="text-font text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.45 }}>
          Le Maître du Jeu souhaite changer votre rôle contre celui-ci. Examinez la carte ci-dessous et choisissez d'accepter ou de refuser :
        </p>

        {/* Aperçu complet de la nouvelle carte */}
        <div style={{ marginBottom: '1.15rem' }}>
          <RoleCardView
            role={proposedRole}
            onOpenDetails={onInspectRole}
            compact={false}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={processing}
            onClick={() => handleDecision(true)}
            className="btn-primary title-font glow-button"
            style={{ flex: '1 1 180px', background: '#16a34a', padding: '0.85rem' }}
          >
            <CheckCircle2 size={18} /> Accepter ce rôle
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => handleDecision(false)}
            className="btn-secondary title-font"
            style={{ flex: '1 1 140px', borderColor: '#ef4444', color: '#ef4444', padding: '0.85rem' }}
          >
            <X size={18} /> Refuser
          </button>
        </div>
      </div>
    </div>
  );
}
