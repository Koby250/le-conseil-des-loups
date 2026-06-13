import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, setDoc, updateDoc, onSnapshot, runTransaction, writeBatch, arrayRemove } from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import { AlertTriangle, EyeOff, User, Send } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function PlayerScreen() {
  const { roomId } = useParams();
  
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState(localStorage.getItem(`loup_garou_${roomId}_playerId`) || null);
  const [isJoined, setIsJoined] = useState(!!playerId);
  
  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs] = useState([]);
  const [me, setMe] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRole, setShowRole] = useState(false);
  
  // Modals & States for Powers
  const [showVoleurModal, setShowVoleurModal] = useState(false);
  const [showComedienModal, setShowComedienModal] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState([]); // Cupidon
  const [voyanteCible, setVoyanteCible] = useState(null);
  const [salvateurCible, setSalvateurCible] = useState(null);
  const [potionVieActive, setPotionVieActive] = useState(false);
  const [showPotionMortSelection, setShowPotionMortSelection] = useState(false);
  const [cibleMortLocal, setCibleMortLocal] = useState(null);

  // Subscribe to Salon and Joueurs
  useEffect(() => {
    if (!roomId) return;
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), (docSnap) => {
      if (docSnap.exists()) setSalonData({ id: docSnap.id, ...docSnap.data() });
      else setError("Ce salon n'existe pas ou a été fermé.");
      setLoading(false);
    });

    const unsubJoueurs = onSnapshot(collection(db, 'salons', roomId, 'joueurs'), (snapshot) => {
      const jList = [];
      snapshot.forEach(d => jList.push({ id: d.id, ...d.data() }));
      setJoueurs(jList);
    });

    return () => { unsubSalon(); unsubJoueurs(); };
  }, [roomId]);

  // Sync "me"
  useEffect(() => {
    if (playerId && joueurs.length > 0) {
      const myData = joueurs.find(j => j.id === playerId);
      if (myData) {
         setMe(myData);
         if (myData.carte_choisie === null) setShowRole(false);
      }
    }
  }, [playerId, joueurs]);

  // Theme Management (Jour / Nuit)
  useEffect(() => {
    if (!salonData) return;
    const nightPhases = ['nuit_cupidon', 'nuit_voleur', 'nuit_salvateur', 'nuit_voyante', 'nuit_loups', 'nuit_sorciere'];
    const dayPhases = ['matin', 'jour_vote', 'jour_resolution'];
    
    if (nightPhases.includes(salonData.statut)) {
      document.body.classList.add('theme-nuit');
      document.body.classList.remove('theme-jour');
    } else if (dayPhases.includes(salonData.statut)) {
      document.body.classList.add('theme-jour');
      document.body.classList.remove('theme-nuit');
    } else {
      document.body.classList.remove('theme-nuit', 'theme-jour'); // Reset if en_attente
    }
  }, [salonData?.statut]);

  useEffect(() => {
    if (!salonData?.couple || salonData.couple.length !== 2 || !me) return;
    const aliveStatuses = ['en_vie', 'En couple'];
    if (salonData.couple.includes(me.id) && aliveStatuses.includes(me.statut_joueur)) {
      const partnerId = salonData.couple.find(id => id !== me.id);
      const partner = joueurs.find(j => j.id === partnerId);
      if (partner && partner.statut_joueur === 'mort') {
        updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { statut_joueur: 'mort' }).catch(console.error);
        return;
      }
    }
    if (me.role === 'cupidon' && me.pouvoir_utilise && me.statut_joueur !== 'mort') {
      const p1 = joueurs.find(j => j.id === salonData.couple[0]);
      const p2 = joueurs.find(j => j.id === salonData.couple[1]);
      if (p1?.statut_joueur === 'mort' && p2?.statut_joueur === 'mort') {
        const isLoup = (j) => j?.role?.toLowerCase().includes('loup') || j?.statut_joueur === 'infecte';
        if (!isLoup(p1) && !isLoup(p2)) updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { statut_joueur: 'mort' }).catch(console.error);
      }
    }
  }, [joueurs, salonData?.couple, me?.statut_joueur, me?.id, me?.role, me?.pouvoir_utilise, roomId]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    if (salonData && joueurs.length >= salonData.roles_selectionnes.length) return setError("Salon complet.");
    
    const stableId = "joueur_" + roomId + "_" + playerName.trim().toLowerCase().replace(/\s+/g, '_');
    if (joueurs.find(j => j.nom.toLowerCase() === playerName.trim().toLowerCase() && j.id !== stableId)) return alert("Pseudo déjà pris !");
    
    try {
      await setDoc(doc(db, 'salons', roomId, 'joueurs', stableId), {
        nom: playerName.trim(),
        carte_choisie: null,
        role: "",
        statut_joueur: "en_vie",
        est_mj: false,
        pouvoir_utilise: false,
        a_vote: false,
        a_vote_sorciere: false,
        vote_jour: null,
        illusion_dispo: true,
        dernier_protege: null,
        potion_vie_utilisee: false,
        potion_mort_utilisee: false
      });
      localStorage.setItem(`loup_garou_${roomId}_playerId`, stableId);
      setPlayerId(stableId);
      setIsJoined(true);
    } catch (err) { setError("Erreur de connexion."); }
  };

  const handlePickCard = async (index) => {
    if (!salonData || !me) return;
    if (joueurs.some(j => j.carte_choisie === index)) return alert("Carte déjà prise !");
    const assignedRole = salonData.roles_melanges[index];
    try { await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { carte_choisie: index, role: assignedRole }); } 
    catch (err) { alert("Erreur."); }
  };

  const handleVoleurAction = async (targetPlayerId) => {
    if (!me || me.role !== 'voleur' || me.pouvoir_utilise) return;
    
    if (targetPlayerId === 'passer') {
       try {
         await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { pouvoir_utilise: true, a_vote: true });
         setShowVoleurModal(false);
         alert("Vous avez décidé de ne pas voler de carte.");
       } catch(e) { console.error(e); }
       return;
    }

    const targetPlayer = joueurs.find(j => j.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.role) return alert("Ce joueur n'a pas encore de rôle.");
    if (!window.confirm(`Voler le rôle de ${targetPlayer.nom} ?`)) return;

    try {
      const stolenRoleData = rolesData.find(r => r.id === targetPlayer.role);
      const isLoup = stolenRoleData?.name?.toLowerCase().includes('loup') || false;

      await runTransaction(db, async (transaction) => {
        const voleurRef = doc(db, 'salons', roomId, 'joueurs', me.id);
        const targetRef = doc(db, 'salons', roomId, 'joueurs', targetPlayerId);
        const targetSnap = await transaction.get(targetRef);

        const vraiRoleCible = targetSnap.data().role;
        const statutCible = targetSnap.data().statut_joueur;
        const stolenRoleCheck = rolesData.find(r => r.id === vraiRoleCible);
        const isLoupFinal = stolenRoleCheck?.name?.toLowerCase().includes('loup') || false;
        
        transaction.update(voleurRef, { role: vraiRoleCible, pouvoir_utilise: true, a_vote: true, statut_joueur: 'en_vie' });

        const targetUpdates = { role: 'voleur' };
        if (isLoupFinal || statutCible === 'infecte') targetUpdates.statut_joueur = 'mort';
        transaction.update(targetRef, targetUpdates);
      });

      setShowVoleurModal(false);
      let msg = `Vol réussi ! Vous êtes : ${stolenRoleData?.name || targetPlayer.role}`;
      if (isLoup) msg += '\n⚠️ La cible était un Loup — elle est éliminée.';
      alert(msg);
    } catch (err) { alert('Erreur vol : ' + err.message); }
  };

  const handleComedienAction = async (roleId) => {
    if (!me || me.role !== 'comedien') return;
    if (!window.confirm("Incarner ce rôle ?")) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'salons', roomId, 'joueurs', me.id), { role: roleId });
      batch.update(doc(db, 'salons', roomId), { roles_dispo_comedien: arrayRemove(roleId) });
      await batch.commit();
      setShowComedienModal(false);
    } catch (err) { alert("Erreur."); }
  };

  if (loading) return <div className="player-screen"><div className="loading"><div className="spinner"></div></div></div>;
  if (error) return <div className="player-screen"><div className="error-box"><div className="error-content"><AlertTriangle size={48} /><h2>Erreur</h2><p>{error}</p></div></div></div>;

  if (!isJoined || !me) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="player-content" style={{justifyContent: 'center'}}>
          <div className="glass-panel" style={{maxWidth: '400px', width: '100%', margin: '0 auto', textAlign: 'center'}}>
             <div className="home-icon glow-effect" style={{margin: '0 auto 1.5rem'}}><User size={48} /></div>
             <h2 className="title-font" style={{marginBottom: '1rem'}}>Rejoindre le salon {roomId}</h2>
             <form onSubmit={handleJoin} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <input type="text" className="text-font" style={{padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-color)'}} placeholder="Votre Pseudo" value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={20} required />
                <button type="submit" className="btn-primary title-font glow-button" style={{display: 'flex', justifyContent: 'center', gap: '10px'}}><Send size={18} /> Rejoindre</button>
             </form>
          </div>
        </div>
      </div>
    );
  }

  const myRoleData = me.role ? rolesData.find(r => r.id === me.role) : null;

  if (salonData.statut === "en_attente" || salonData.statut === "en_cours") {
    if (salonData.statut === "en_attente" && salonData.distribution_mode === 'manuelle' && !me.role) {
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
    
    if (me.carte_choisie === null && salonData.distribution_mode !== 'manuelle') {
      const totalRoles = salonData.roles_selectionnes.length;
      const allCards = Array.from({ length: totalRoles }, (_, i) => i);
      const takenCards = joueurs.filter(j => j.carte_choisie !== null && j.carte_choisie !== 999).map(j => j.carte_choisie);
      return (
        <div className="player-screen">
          <ThemeToggle />
          <div className="player-content">
            <div>
              <span className="room-badge">SALON {roomId}</span>
              <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
              <p className="text-font text-muted">Choisissez une carte pour découvrir votre rôle.</p>
            </div>
            <div className="cards-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '15px', marginTop: '2rem'}}>
              {allCards.map(index => {
                 if (takenCards.includes(index)) return null;
                 return <button key={index} onClick={() => handlePickCard(index)} className="mystery-card glass-panel text-font" style={{height: '120px', fontSize: '2rem', fontWeight: 'bold', borderRadius: '12px'}}>{index + 1}</button>;
              })}
            </div>
          </div>
        </div>
      );
    }
    
    // Rôle assigné, attente du lancement de la nuit -> Affichage de la Flip Card
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: myRoleData?.color || '#000' }}></div>
        <div className="player-content">
          <div><span className="room-badge">SALON {roomId}</span><h1 className="player-title">La nuit va bientôt tomber...</h1></div>
          <div className="perspective-container">
            <button onClick={() => setShowRole(!showRole)} className={`flip-card ${showRole ? 'flipped' : ''}`}>
              <div className="flip-card-front">
                <div style={{width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem'}}>
                  <EyeOff size={32} style={{color: 'var(--text-color)'}} />
                </div>
                <p>Carte Mystère</p>
                <small>Appuyez pour révéler</small>
              </div>
              <div className="flip-card-back" style={{ borderColor: myRoleData?.color, boxShadow: `0 10px 40px ${myRoleData?.color}40` }}>
                <div className="card-gradient" style={{ background: `linear-gradient(to bottom, ${myRoleData?.color}30, transparent)` }}></div>
                <div className="card-inner">
                  <h2 className="role-name" style={{ color: myRoleData?.color }}>{myRoleData?.name}</h2>
                  <div className="role-divider" style={{ backgroundColor: myRoleData?.color }}></div>
                  <div className="role-desc">{myRoleData?.description}</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Game Phases
  const isDead = me.statut_joueur === "mort";
  const allAlivePlayers = joueurs.filter(j => j.statut_joueur !== "mort");
  const isMeLoup = me.role?.toLowerCase().includes('loup') || me.statut_joueur === 'infecte';
  const loupTargets = allAlivePlayers.filter(j => !(j.role?.toLowerCase().includes('loup') || j.statut_joueur === 'infecte'));

  return (
    <div className="player-screen">
      <ThemeToggle />
      <div className="ambient-bg" style={{ backgroundColor: isDead ? '#450a0a' : (myRoleData?.color || '#000') }}></div>
      <div className="player-content">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <span className="room-badge">SALON {roomId}</span>
           {isDead && <span className="room-badge" style={{background: 'var(--danger)', color: 'white', border: '1px solid #dc2626'}}>MORT</span>}
        </div>
        
        <div style={{marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
           <div>
              <h1 className="player-title" style={{fontSize: '1.8rem', margin: 0, color: 'var(--text-color)'}}>{me.nom}</h1>
              <p className="text-font" style={{color: myRoleData?.color, fontWeight: 'bold'}}>{showRole ? myRoleData?.name : 'Rôle Masqué'}</p>
           </div>
           {!isDead && (
              <button onClick={() => setShowRole(!showRole)} className="btn-secondary text-font" style={{padding: '8px 12px', fontSize: '0.9rem', borderColor: myRoleData?.color, color: myRoleData?.color}}>
                 {showRole ? 'Cacher' : 'Voir Rôle'}
              </button>
           )}
        </div>

        {salonData?.couple?.includes(me.id) && (() => {
          const partnerId = salonData.couple.find(id => id !== me.id);
          const partner = joueurs.find(j => j.id === partnerId);
          if (!partner) return null;
          const pRoleData = rolesData.find(r => r.id === partner.role);
          return (
            <div style={{marginTop: '1rem', padding: '12px 14px', background: 'rgba(236,72,153,0.15)', border: '2px solid #ec4899', borderRadius: '10px'}}>
              <p className="text-font" style={{margin: 0, color: '#ec4899', fontWeight: 'bold'}}>💖 En couple avec {partner.nom}</p>
              <p className="text-font" style={{margin: '4px 0 0', fontSize: '0.9rem'}}>Rôle : <strong style={{color: pRoleData?.color||'#ec4899'}}>{pRoleData?.name||'Inconnu'}</strong></p>
            </div>
          );
        })()}

        {!isDead && (
           <div className="powers-section" style={{marginTop: '2rem'}}>
              
              {/* CUPIDON */}
              {salonData.statut === 'nuit_cupidon' && me.role === 'cupidon' && !me.pouvoir_utilise && (
                 <div style={{padding: '1rem', background: 'rgba(236,72,153,0.1)', border: '1px solid #ec4899', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font" style={{color: '#ec4899'}}>Cupidon</h3>
                   <p className="text-font text-muted" style={{fontSize: '0.85rem', marginBottom: '1rem'}}>Sélectionnez 2 joueurs pour former le couple.</p>
                   <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                     {allAlivePlayers.map(j => {
                       const isSel = selectedPlayers.includes(j.id);
                       return (
                         <li key={j.id} onClick={() => {
                             if (isSel) setSelectedPlayers(selectedPlayers.filter(id => id !== j.id));
                             else if (selectedPlayers.length < 2) setSelectedPlayers([...selectedPlayers, j.id]);
                           }}
                           style={{padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel?'#ec4899':'rgba(255,255,255,0.05)', color: isSel?'#fff':'var(--text-color)', border: isSel?'1px solid #be185d':'1px solid transparent'}}
                         >
                           {isSel ? '♥️' : '○'} {j.nom}
                         </li>
                       );
                     })}
                   </ul>
                   <button onClick={async () => {
                       if (selectedPlayers.length !== 2) return;
                       try {
                         await runTransaction(db, async (transaction) => {
                           transaction.update(doc(db, 'salons', roomId), { couple: [selectedPlayers[0], selectedPlayers[1]] });
                           transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { pouvoir_utilise: true, a_vote: true });
                           transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[0]), { statut_joueur: 'En couple' });
                           transaction.update(doc(db, 'salons', roomId, 'joueurs', selectedPlayers[1]), { statut_joueur: 'En couple' });
                         });
                       } catch(e) { console.error(e); }
                     }} 
                     disabled={selectedPlayers.length !== 2} className="btn-primary title-font glow-button" style={{marginTop: '1rem', width: '100%', background: '#ec4899', border: 'none'}}
                   >Valider le couple</button>
                 </div>
              )}

              {/* VOLEUR */}
              {salonData.statut === 'nuit_voleur' && me.role === 'voleur' && !me.a_vote && (
                 <div style={{padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font text-danger">Action du Voleur</h3>
                   <button onClick={() => setShowVoleurModal(true)} className="btn-primary title-font glow-button" style={{width: '100%', marginBottom: '1rem', background: 'var(--danger)', border: 'none'}}>Voler une carte</button>
                   <button onClick={() => handleVoleurAction('passer')} className="btn-secondary text-font" style={{width: '100%', justifyContent: 'center'}}>Ne rien faire / Passer</button>
                 </div>
              )}

              {/* SALVATEUR */}
              {salonData.statut === 'nuit_salvateur' && me.role === 'salvateur' && !me.a_vote && (
                 <div style={{padding: '1rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3b82f6', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font" style={{color: '#3b82f6'}}>🛡️ Tour du Salvateur</h3>
                   <p className="text-font text-muted" style={{fontSize: '0.85rem', marginBottom: '1rem'}}>Protégez un joueur. Vous ne pouvez pas protéger la même personne deux nuits de suite.</p>
                   <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                     {allAlivePlayers.map(j => {
                       const isSel = salvateurCible === j.nom;
                       const disabled = j.nom === me.dernier_protege;
                       return (
                         <li key={j.id} onClick={() => { if(!disabled) setSalvateurCible(j.nom); }}
                           style={{padding: '10px', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? 'rgba(0,0,0,0.5)' : isSel ? '#3b82f6' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-color)'}}
                         >
                           {isSel ? '🛡️' : disabled ? '🚫' : '○'} {j.nom} {disabled && "(Protégé dernièrement)"}
                         </li>
                       );
                     })}
                   </ul>
                   <button onClick={async () => {
                       if (!salvateurCible) return;
                       try {
                         await updateDoc(doc(db, 'salons', roomId), { joueur_protege: salvateurCible });
                         await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true, dernier_protege: salvateurCible });
                       } catch(e) { console.error(e); }
                     }} 
                     disabled={!salvateurCible} className="btn-primary title-font glow-button" style={{marginTop: '1rem', width: '100%', background: '#3b82f6', border: 'none'}}
                   >Protéger {salvateurCible}</button>
                 </div>
              )}

              {/* VOYANTE */}
              {salonData.statut === 'nuit_voyante' && me.role === 'voyante' && !me.a_vote && (
                 <div style={{padding: '1rem', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font" style={{color: '#8b5cf6'}}>👁️ Tour de la Voyante</h3>
                   {voyanteCible ? (
                     <div style={{textAlign: 'center'}}>
                       <p className="text-font" style={{marginBottom: '1rem'}}>Le rôle de {voyanteCible.nom} est :</p>
                       <h2 className="title-font" style={{color: voyanteCible.roleObj?.color, fontSize: '2rem', marginBottom: '1rem'}}>{voyanteCible.roleObj?.name}</h2>
                       <button onClick={async () => {
                           try { await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true }); } catch(e) {}
                         }} className="btn-primary title-font glow-button" style={{width: '100%', background: '#8b5cf6', border: 'none'}}
                       >Fermer les yeux</button>
                     </div>
                   ) : (
                     <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                       {allAlivePlayers.filter(j=>j.id!==me.id).map(j => (
                         <li key={j.id} onClick={() => {
                             const rData = rolesData.find(r => r.id === j.role);
                             setVoyanteCible({nom: j.nom, roleObj: rData});
                           }}
                           style={{padding: '10px', borderRadius: '8px', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px'}}
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
                 <div style={{padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font text-danger">🐺 Tour des Loups</h3>
                   <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                     {loupTargets.map(j => {
                       const isSel = salonData.vote_loup_temporaire === j.nom;
                       return (
                         <li key={j.id} onClick={() => updateDoc(doc(db, 'salons', roomId), { vote_loup_temporaire: j.nom }).catch(e=>{})}
                           style={{padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #b91c1c' : '1px solid transparent'}}
                         >
                           {isSel ? '🩸' : '○'} {j.nom}
                         </li>
                       );
                     })}
                   </ul>
                   <button onClick={async () => {
                       if (!salonData.vote_loup_temporaire) return;
                       try {
                         await runTransaction(db, async (transaction) => {
                           transaction.update(doc(db, 'salons', roomId), { victime_loups: salonData.vote_loup_temporaire });
                           transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), { a_vote: true });
                         });
                       } catch (e) { console.error(e); }
                     }} 
                     disabled={!salonData.vote_loup_temporaire} className="btn-primary title-font glow-button" style={{marginTop: '1rem', width: '100%', background: '#ef4444', border: 'none'}}
                   >Confirmer le festin</button>
                 </div>
              )}

              {/* SORCIÈRE */}
              {salonData.statut === 'nuit_sorciere' && me.role === 'sorciere' && !me.a_vote_sorciere && (
                 <div style={{padding: '1rem', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid #8b5cf6', borderRadius: '12px', marginBottom: '1rem'}}>
                   <h3 className="title-font" style={{color: '#8b5cf6'}}>🧙‍♀️ Tour de la Sorcière</h3>
                   
                   <div style={{marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(139, 92, 246, 0.3)'}}>
                     <p className="text-font">🐺 Les loups ont décidé de tuer : <strong>{salonData.victime_loups || "Personne"}</strong></p>
                     {!me.potion_vie_utilisee ? (
                        <button onClick={() => setPotionVieActive(!potionVieActive)} className={`btn-secondary text-font ${potionVieActive ? 'glow-button' : ''}`} style={{marginTop: '10px', width: '100%', borderColor: potionVieActive ? '#10b981' : '#8b5cf6', color: potionVieActive ? '#10b981' : 'var(--text-color)', justifyContent: 'center'}}>
                          {potionVieActive ? '✅ Potion de Vie (Sauver)' : '🧪 Utiliser Potion de Vie'}
                        </button>
                     ) : <p className="text-font text-muted" style={{marginTop: '10px'}}>🧪 Potion de vie indisponible</p>}
                   </div>

                   <div style={{marginBottom: '1rem'}}>
                     {!me.potion_mort_utilisee ? (
                        <>
                          <button onClick={() => setShowPotionMortSelection(!showPotionMortSelection)} className="btn-secondary text-font" style={{width: '100%', borderColor: '#ef4444', color: cibleMortLocal ? '#ef4444' : 'var(--text-color)', justifyContent: 'center'}}>
                            {cibleMortLocal ? `💀 Cible de mort : ${cibleMortLocal}` : '💀 Utiliser Potion de Mort'}
                          </button>
                          {showPotionMortSelection && (
                            <ul style={{listStyle: 'none', padding: 0, marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '8px'}}>
                              {allAlivePlayers.filter(j=>j.id!==me.id).map(j => {
                                const isSel = cibleMortLocal === j.nom;
                                return (
                                  <li key={j.id} onClick={() => { setCibleMortLocal(isSel ? null : j.nom); if(!isSel) setShowPotionMortSelection(false); }}
                                    style={{padding: '10px', borderRadius: '8px', cursor: 'pointer', background: isSel ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isSel ? '#fff' : 'var(--text-color)', border: isSel ? '1px solid #b91c1c' : '1px solid transparent'}}
                                  >
                                    {isSel ? '💀' : '○'} {j.nom}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </>
                     ) : <p className="text-font text-muted">💀 Potion de mort indisponible</p>}
                   </div>

                   <button onClick={async () => {
                       try {
                         await runTransaction(db, async (transaction) => {
                           const updatesSalon = {};
                           const updatesMe = { a_vote_sorciere: true };
                           if (potionVieActive) { updatesSalon.victime_sauvee = true; updatesMe.potion_vie_utilisee = true; }
                           if (cibleMortLocal) { updatesSalon.victime_sorciere = cibleMortLocal; updatesMe.potion_mort_utilisee = true; }
                           if (Object.keys(updatesSalon).length > 0) transaction.update(doc(db, 'salons', roomId), updatesSalon);
                           transaction.update(doc(db, 'salons', roomId, 'joueurs', me.id), updatesMe);
                         });
                       } catch (err) { console.error(err); }
                     }} className="btn-primary title-font glow-button" style={{width: '100%', background: '#8b5cf6', border: 'none'}}
                   >Terminer le tour</button>
                 </div>
              )}

              {/* COMEDIEN */}
              {me.role === 'comedien' && salonData.roles_dispo_comedien && salonData.roles_dispo_comedien.length > 0 && (
                 <button onClick={() => setShowComedienModal(true)} className="btn-primary title-font glow-button" style={{width: '100%', marginBottom: '1rem', background: '#fbbf24', color: 'black', border: 'none'}}>Incarner un Rôle</button>
              )}
           </div>
        )}

        {/* VILLAGE VOTE (JOUR_VOTE) */}
        {!isDead && salonData.statut === 'jour_vote' && (
           <div style={{marginTop: '2rem'}}>
             <h3 className="title-font" style={{color: '#f59e0b', marginBottom: '1rem'}}>☀️ Phase de Vote du Village</h3>
             
             {/* POUVOIR ILLUSIONNISTE */}
             {me.role === 'illusionniste' && me.illusion_dispo && (
                <div style={{marginBottom: '1rem', padding: '1rem', background: 'rgba(139, 92, 246, 0.15)', border: '1px solid #8b5cf6', borderRadius: '12px'}}>
                   <h4 className="title-font" style={{color: '#c4b5fd', marginBottom: '0.5rem'}}>✨ Pouvoir de l'Illusionniste</h4>
                   <p className="text-font" style={{fontSize: '0.85rem', marginBottom: '1rem'}}>Vous pouvez annuler la mort du prochain condamné au bûcher (vous y compris). Utilisable 1 fois.</p>
                   <button onClick={async () => {
                       if(!window.confirm("Activer l'Illusion pour ce vote ?")) return;
                       try {
                         await updateDoc(doc(db, 'salons', roomId), { illusion_active: true });
                         await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { illusion_dispo: false });
                         alert("Illusion activée secrètement pour le vote de ce jour !");
                       } catch(e) {}
                     }} className="btn-primary title-font glow-button" style={{width: '100%', background: '#8b5cf6', border: 'none'}}
                   >Activer mon Illusion</button>
                </div>
             )}

             <p className="text-font text-muted" style={{marginBottom: '1rem'}}>Qui voulez-vous éliminer aujourd'hui ?</p>
             <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
               {allAlivePlayers.filter(j=>j.id!==me.id).map(j => {
                 const isMyVote = me.vote_jour === j.nom;
                 return (
                   <li key={j.id} onClick={async () => {
                       try {
                         await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), { vote_jour: isMyVote ? null : j.nom });
                       } catch(e) {}
                     }}
                     style={{padding: '12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isMyVote ? '#ef4444' : 'rgba(255,255,255,0.05)', color: isMyVote ? '#fff' : 'var(--text-color)', border: isMyVote ? '1px solid #b91c1c' : '1px solid transparent'}}
                   >
                     <span>{j.nom}</span>
                     <span>{isMyVote ? '✅ Voté' : 'Voter contre'}</span>
                   </li>
                 );
               })}
             </ul>
           </div>
        )}

        {/* Display list of players (alive) */}
        <div className="players-list-panel glass-panel" style={{marginTop: '2rem'}}>
           <h3 className="title-font" style={{marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem', fontSize: '1.2rem'}}>Joueurs en vie</h3>
           <ul style={{listStyle: 'none', padding: 0}} className="text-font">
              {joueurs.filter(j => j.statut_joueur !== "mort").map(j => (
                 <li key={j.id} style={{padding: '10px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <div style={{width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)'}}></div>
                    <span style={{fontWeight: j.id === me.id ? 'bold' : 'normal', color: 'var(--text-color)'}}>{j.nom} {j.id === me.id && "(Vous)"}</span>
                 </li>
              ))}
           </ul>
        </div>
      </div>

      {/* MODALS */}
      {showVoleurModal && (
        <div className="modal-overlay">
           <div className="modal-content border-accent" style={{borderColor: 'var(--danger)'}}>
              <h3 className="title-font text-danger" style={{marginBottom: '1rem'}}>Action du Voleur</h3>
              <p className="text-font text-muted" style={{marginBottom: '1.5rem'}}>Choisissez un joueur à voler.</p>
              <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                 {joueurs.filter(j => j.id !== me.id && j.role && j.statut_joueur !== "mort").map(p => (
                    <button key={p.id} onClick={() => handleVoleurAction(p.id)} className="btn-secondary text-font" style={{justifyContent: 'flex-start'}}>Voler {p.nom}</button>
                 ))}
              </div>
              <button onClick={() => setShowVoleurModal(false)} className="btn-secondary text-font" style={{marginTop: '1.5rem', width: '100%', justifyContent: 'center'}}>Annuler</button>
           </div>
        </div>
      )}

      {showComedienModal && (
        <div className="modal-overlay">
           <div className="modal-content border-accent" style={{borderColor: '#fbbf24'}}>
              <h3 className="title-font" style={{marginBottom: '1rem', color: '#fbbf24'}}>Action du Comédien</h3>
              <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                 {salonData.roles_dispo_comedien.map(rId => {
                    const rData = rolesData.find(rd => rd.id === rId);
                    return <button key={rId} onClick={() => handleComedienAction(rId)} className="btn-secondary text-font" style={{color: rData?.color, borderColor: rData?.color}}>Incarner {rData?.name}</button>
                 })}
              </div>
              <button onClick={() => setShowComedienModal(false)} className="btn-secondary text-font" style={{marginTop: '1.5rem', width: '100%', justifyContent: 'center'}}>Annuler</button>
           </div>
        </div>
      )}
    </div>
  );
}
