import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, writeBatch, arrayRemove } from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import { ShieldAlert, AlertTriangle, EyeOff, User, Send, Play } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function PlayerScreen() {
  const { roomId } = useParams();
  
  // State
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState(localStorage.getItem(`loup_garou_${roomId}_playerId`) || null);
  const [isJoined, setIsJoined] = useState(!!playerId);
  
  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs] = useState([]);
  const [me, setMe] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRole, setShowRole] = useState(false);
  
  // UI states for powers
  const [showVoleurModal, setShowVoleurModal] = useState(false);
  const [showComedienModal, setShowComedienModal] = useState(false);

  // Subscribe to Salon and Joueurs
  useEffect(() => {
    if (!roomId) return;
    
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), (docSnap) => {
      if (docSnap.exists()) {
        setSalonData({ id: docSnap.id, ...docSnap.data() });
      } else {
        setError("Ce salon n'existe pas ou a été fermé.");
      }
      setLoading(false);
    });

    const unsubJoueurs = onSnapshot(collection(db, 'salons', roomId, 'joueurs'), (snapshot) => {
      const jList = [];
      snapshot.forEach(d => jList.push({ id: d.id, ...d.data() }));
      setJoueurs(jList);
    });

    return () => {
      unsubSalon();
      unsubJoueurs();
    };
  }, [roomId]);

  // Sync "me" object
  useEffect(() => {
    if (playerId && joueurs.length > 0) {
      const myData = joueurs.find(j => j.id === playerId);
      if (myData) {
         setMe(myData);
         // If a reset happens, carte_choisie is null, we can reset showRole
         if (myData.carte_choisie === null) {
            setShowRole(false);
         }
      }
    }
  }, [playerId, joueurs]);

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    
    const newPlayerId = "joueur_" + Math.random().toString(36).substring(2, 9);
    
    try {
      await setDoc(doc(db, 'salons', roomId, 'joueurs', newPlayerId), {
        nom: playerName.trim(),
        carte_choisie: null,
        role: "",
        statut_joueur: "en_vie",
        est_mj: false,
        pouvoir_utilise: false
      });
      
      localStorage.setItem(`loup_garou_${roomId}_playerId`, newPlayerId);
      setPlayerId(newPlayerId);
      setIsJoined(true);
    } catch (err) {
      console.error(err);
      setError("Erreur lors de la connexion au salon.");
    }
  };

  const handlePickCard = async (index) => {
    if (!salonData || !me) return;
    
    // Check if card already taken
    const isTaken = joueurs.some(j => j.carte_choisie === index);
    if (isTaken) {
      alert("Cette carte a déjà été choisie !");
      return;
    }

    const assignedRole = salonData.roles_melanges[index];
    
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', me.id), {
        carte_choisie: index,
        role: assignedRole
      });
    } catch (err) {
      console.error(err);
      alert("Erreur lors du choix de la carte.");
    }
  };

  const handleVoleurAction = async (targetPlayerId) => {
    if (!me || me.role !== 'voleur' || me.pouvoir_utilise) return;

    const targetPlayer = joueurs.find(j => j.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.role) {
      alert("Ce joueur n'a pas encore de rôle assigné.");
      return;
    }

    if (!window.confirm(`Êtes-vous sûr de vouloir voler le rôle de ${targetPlayer.nom} ?`)) return;

    try {
      const stolenRoleData = rolesData.find(r => r.id === targetPlayer.role);
      // Vérification : le nom du rôle contient-il "loup" (insensible à la casse) ?
      const isLoup = stolenRoleData?.name?.toLowerCase().includes('loup') || false;

      await runTransaction(db, async (transaction) => {
        // Lecture fraîche du voleur et de la cible
        const voleurRef = doc(db, 'salons', roomId, 'joueurs', me.id);
        const targetRef = doc(db, 'salons', roomId, 'joueurs', targetPlayerId);

        const voleurSnap = await transaction.get(voleurRef);
        const targetSnap = await transaction.get(targetRef);

        if (!voleurSnap.exists() || !targetSnap.exists()) {
          throw new Error('Joueur introuvable en base.');
        }
        if (voleurSnap.data().pouvoir_utilise) {
          throw new Error('Pouvoir déjà utilisé.');
        }

        const vraiRoleCible = targetSnap.data().role;
        const statutCible = targetSnap.data().statut_joueur;
        const stolenRoleCheck = rolesData.find(r => r.id === vraiRoleCible);
        const isLoupFinal = stolenRoleCheck?.name?.toLowerCase().includes('loup') || false;
        const isInfecte = statutCible === 'infecte';

        // Le Voleur prend le rôle de la cible, reste toujours "en_vie" (jamais infecté)
        transaction.update(voleurRef, {
          role: vraiRoleCible,
          pouvoir_utilise: true,
          statut_joueur: 'en_vie'
        });

        // La cible reçoit le rôle "Voleur" et meurt si c'était un Loup OU si elle était Infectée
        const targetUpdates = { role: 'voleur' };
        if (isLoupFinal || isInfecte) {
          targetUpdates.statut_joueur = 'mort';
        }
        transaction.update(targetRef, targetUpdates);
      });

      setShowVoleurModal(false);
      const stolenName = stolenRoleData?.name || targetPlayer.role;
      let msg = `Vol réussi ! Vous êtes maintenant : ${stolenName}`;
      if (isLoup) msg += '\n⚠️ La cible était un Loup — elle est éliminée.';
      else if (targetPlayer.statut_joueur === 'infecte') msg += '\n☣️ La cible était Infectée — elle est éliminée. Vous restez sain.';
      alert(msg);
    } catch (err) {
      console.error('Erreur lors du vol:', err);
      alert('Erreur lors du vol : ' + (err.message || 'Erreur inconnue'));
    }
  };

  const handleComedienAction = async (roleId) => {
    if (!me || me.role !== 'comedien') return;
    if (!window.confirm("Voulez-vous incarner ce rôle pour cette nuit ?")) return;

    try {
      const batch = writeBatch(db);
      
      batch.update(doc(db, 'salons', roomId, 'joueurs', me.id), {
        role: roleId
      });
      
      batch.update(doc(db, 'salons', roomId), {
        roles_dispo_comedien: arrayRemove(roleId)
      });
      
      await batch.commit();
      setShowComedienModal(false);
      alert("Vous incarnez désormais ce rôle.");
    } catch (err) {
      console.error(err);
      alert("Erreur lors du choix.");
    }
  };

  if (loading) {
    return (
      <div className="player-screen"><div className="loading"><div className="spinner"></div></div></div>
    );
  }

  if (error) {
    return (
      <div className="player-screen"><div className="error-box"><div className="error-content"><AlertTriangle size={48} /><h2>Erreur</h2><p>{error}</p></div></div></div>
    );
  }

  // Phase 0: Login
  if (!isJoined || !me) {
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="player-content" style={{justifyContent: 'center'}}>
          <div className="glass-panel" style={{maxWidth: '400px', width: '100%', margin: '0 auto', textAlign: 'center'}}>
             <div className="home-icon glow-effect" style={{margin: '0 auto 1.5rem'}}><User size={48} /></div>
             <h2 className="title-font" style={{marginBottom: '1rem'}}>Rejoindre le salon {roomId}</h2>
             <form onSubmit={handleJoin} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                <input 
                  type="text" 
                  className="text-font"
                  style={{padding: '12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--text-color)'}}
                  placeholder="Votre Nom ou Pseudo" 
                  value={playerName} 
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  required
                />
                <button type="submit" className="btn-primary title-font glow-button" style={{display: 'flex', justifyContent: 'center', gap: '10px'}}>
                  <Send size={18} /> Rejoindre
                </button>
             </form>
          </div>
        </div>
      </div>
    );
  }

  // Current role info
  const myRoleData = me.role ? rolesData.find(r => r.id === me.role) : null;

  // Phase 1: Card Selection & Waiting Room
  if (salonData.statut === "en_attente") {
    // If I haven't picked a card yet
    if (me.carte_choisie === null) {
      // Calculate available cards
      const totalRoles = salonData.roles_selectionnes.length;
      const allCards = Array.from({ length: totalRoles }, (_, i) => i);
      const takenCards = joueurs.filter(j => j.carte_choisie !== null).map(j => j.carte_choisie);
      
      return (
        <div className="player-screen">
          <ThemeToggle />
          <div className="player-content">
            <div>
              <span className="room-badge">SALON {roomId}</span>
              <h1 className="player-title">Bienvenue, <strong>{me.nom}</strong></h1>
              <p className="text-font text-muted">Choisissez une carte pour découvrir votre rôle secret.</p>
            </div>
            
            <div className="cards-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '15px', marginTop: '2rem'}}>
              {allCards.map(index => {
                 const isTaken = takenCards.includes(index);
                 if (isTaken) return null; // Card disappeared
                 
                 return (
                   <button 
                     key={index} 
                     onClick={() => handlePickCard(index)}
                     className="mystery-card glass-panel text-font"
                     style={{height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.3s'}}
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
    
    // If I picked a card but we wait for MJ
    return (
      <div className="player-screen">
        <ThemeToggle />
        <div className="ambient-bg" style={{ backgroundColor: myRoleData?.color || '#000' }}></div>
        <div className="player-content">
          <div>
            <span className="room-badge">SALON {roomId}</span>
            <h1 className="player-title">En attente du Maître du Jeu...</h1>
          </div>
          
          <div className="perspective-container">
            <button onClick={() => setShowRole(!showRole)} className={`flip-card ${showRole ? 'flipped' : ''}`}>
              <div className="flip-card-front">
                <EyeOff size={64} style={{color: 'var(--text-muted)', marginBottom: '1.5rem'}} />
                <p>Appuyez pour révéler</p>
                <small>Assurez-vous que personne ne regarde votre écran.</small>
              </div>
              <div className="flip-card-back" style={{ borderColor: myRoleData?.color || 'var(--card-border)', boxShadow: `0 10px 40px ${myRoleData?.color}40` }}>
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

  // Phase 2: In Game (statut === "en_cours" or "nuit_0")
  const isDead = me.statut_joueur === "mort";
  // Cibles valides pour le Voleur : tous les autres joueurs avec un rôle assigné
  const voleurTargets = joueurs.filter(j => j.id !== me.id && j.role);
  const otherAlivePlayers = joueurs.filter(j => j.id !== me.id && j.statut_joueur !== "mort");


  return (
    <div className="player-screen">
      <ThemeToggle />
      <div className="ambient-bg" style={{ backgroundColor: isDead ? '#450a0a' : (myRoleData?.color || '#000') }}></div>
      <div className="player-content">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <span className="room-badge">SALON {roomId}</span>
           {isDead && <span className="room-badge" style={{background: 'var(--danger)', color: 'white'}}>VOUS ÊTES MORT</span>}
        </div>
        
        <div style={{marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
           <div>
              <h1 className="player-title" style={{fontSize: '1.8rem', marginBottom: '0.2rem'}}>{me.nom}</h1>
              <p className="text-font" style={{color: myRoleData?.color, fontWeight: 'bold'}}>{showRole ? myRoleData?.name : 'Rôle Masqué'}</p>
           </div>
           {!isDead && (
              <button 
                 onClick={() => setShowRole(!showRole)} 
                 className="btn-secondary text-font" 
                 style={{padding: '8px 12px', fontSize: '0.9rem', borderColor: myRoleData?.color, color: myRoleData?.color}}
              >
                 {showRole ? 'Cacher' : 'Voir Rôle'}
              </button>
           )}
        </div>

        {/* Powers Section */}
        {!isDead && (
           <div className="powers-section" style={{marginTop: '2rem'}}>
              {/* VOLEUR */}
              {me.role === 'voleur' && !me.pouvoir_utilise && (
                 <button 
                   onClick={() => setShowVoleurModal(true)} 
                   className="btn-primary title-font glow-button" 
                   style={{width: '100%', marginBottom: '1rem', background: 'var(--danger)', border: 'none'}}
                 >
                    Activer le Vol
                 </button>
              )}
              {me.role === 'voleur' && me.pouvoir_utilise && (
                 <div style={{padding: '0.75rem', background: 'rgba(100,100,100,0.2)', borderRadius: '8px', textAlign: 'center', marginBottom: '1rem'}}>
                   <p className="text-font text-muted" style={{fontSize: '0.9rem'}}>🔒 Vol déjà effectué</p>
                 </div>
              )}

              
              {/* COMEDIEN */}
              {me.role === 'comedien' && salonData.roles_dispo_comedien && salonData.roles_dispo_comedien.length > 0 && (
                 <button 
                   onClick={() => setShowComedienModal(true)} 
                   className="btn-primary title-font glow-button" 
                   style={{width: '100%', marginBottom: '1rem', background: '#fbbf24', color: 'black', border: 'none'}}
                 >
                    Incarner un Rôle
                 </button>
              )}
           </div>
        )}

        <div className="players-list-panel glass-panel" style={{marginTop: '2rem'}}>
           <h3 className="title-font" style={{marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.5rem'}}>Joueurs en vie</h3>
           <ul style={{listStyle: 'none', padding: 0, margin: 0}} className="text-font">
              {joueurs.filter(j => j.statut_joueur !== "mort").map(j => (
                 <li key={j.id} style={{padding: '10px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <div style={{width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)'}}></div>
                    <span style={{fontWeight: j.id === me.id ? 'bold' : 'normal'}}>{j.nom} {j.id === me.id && "(Vous)"}</span>
                 </li>
              ))}
           </ul>
        </div>
      </div>

      {/* MODALS FOR POWERS */}
      {showVoleurModal && (
        <div className="modal-overlay">
           <div className="modal-content glass-panel border-accent" style={{borderColor: 'var(--danger)'}}>
              <h3 className="title-font text-danger" style={{marginBottom: '1rem'}}>Action du Voleur</h3>
              <p className="text-font text-muted" style={{marginBottom: '1.5rem'}}>Choisissez un joueur à voler. S'il s'agit d'un loup, il mourra instantanément.</p>
              
              <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                 {voleurTargets.map(p => {
                    const pRoleData = rolesData.find(r => r.id === p.role);
                    return (
                      <button key={p.id} onClick={() => handleVoleurAction(p.id)} className="btn-secondary text-font" style={{justifyContent: 'flex-start'}}>
                         Voler {p.nom} {pRoleData ? `(${pRoleData.name})` : ''}
                      </button>
                    );
                 })}
                 {voleurTargets.length === 0 && <p className="text-font text-muted">Aucun joueur avec un rôle disponible.</p>}
              </div>

              <button onClick={() => setShowVoleurModal(false)} className="btn-secondary text-font" style={{marginTop: '1.5rem', width: '100%', justifyContent: 'center'}}>Annuler</button>
           </div>
        </div>
      )}

      {showComedienModal && (
        <div className="modal-overlay">
           <div className="modal-content glass-panel border-accent" style={{borderColor: '#fbbf24'}}>
              <h3 className="title-font" style={{marginBottom: '1rem', color: '#fbbf24'}}>Action du Comédien</h3>
              <p className="text-font text-muted" style={{marginBottom: '1.5rem'}}>Choisissez un rôle à incarner. Ce rôle ne sera plus disponible par la suite.</p>
              
              <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                 {salonData.roles_dispo_comedien.map(rId => {
                    const rData = rolesData.find(rd => rd.id === rId);
                    return (
                       <button key={rId} onClick={() => handleComedienAction(rId)} className="btn-secondary text-font" style={{justifyContent: 'flex-start', color: rData?.color, borderColor: rData?.color}}>
                          Incarner {rData?.name}
                       </button>
                    )
                 })}
              </div>
              <button onClick={() => setShowComedienModal(false)} className="btn-secondary text-font" style={{marginTop: '1.5rem', width: '100%', justifyContent: 'center'}}>Annuler</button>
           </div>
        </div>
      )}
    </div>
  );
}
