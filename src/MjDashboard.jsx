import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { collection, doc, setDoc, updateDoc, onSnapshot, writeBatch } from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import { Users, RefreshCw, Eye, Settings, Play, Link as LinkIcon } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export default function MjDashboard() {
  const { roomId } = useParams();
  const [salonData, setSalonData] = useState(null);
  const [joueurs, setJoueurs] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [comedienRoles, setComedienRoles] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    
    // Ecoute du salon
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), (docSnap) => {
      if (docSnap.exists()) {
        setSalonData(docSnap.data());
      } else {
        setSalonData(null);
      }
    });

    // Ecoute des joueurs
    const unsubJoueurs = onSnapshot(collection(db, 'salons', roomId, 'joueurs'), (snapshot) => {
      const jList = [];
      snapshot.forEach((d) => jList.push({ id: d.id, ...d.data() }));
      setJoueurs(jList);
    });

    return () => {
      unsubSalon();
      unsubJoueurs();
    };
  }, [roomId]);

  const addRole = (roleId) => setSelectedRoles(prev => [...prev, roleId]);
  const removeRole = (roleId) => {
    setSelectedRoles(prev => {
      const index = prev.lastIndexOf(roleId);
      if (index !== -1) {
        const n = [...prev];
        n.splice(index, 1);
        return n;
      }
      return prev;
    });
  };

  const addComedienRole = (roleId) => {
    if (comedienRoles.length < 3) setComedienRoles(prev => [...prev, roleId]);
  };
  const removeComedienRole = (roleId) => {
    setComedienRoles(prev => {
      const index = prev.lastIndexOf(roleId);
      if (index !== -1) {
        const n = [...prev];
        n.splice(index, 1);
        return n;
      }
      return prev;
    });
  };

  const hasComedien = selectedRoles.includes('comedien');

  const handleOpenSalon = async () => {
    if (selectedRoles.length < 3) {
      alert("Veuillez sélectionner au moins 3 rôles pour jouer.");
      return;
    }
    if (hasComedien && comedienRoles.length !== 3) {
      alert("Le rôle du Comédien nécessite exactement 3 rôles supplémentaires disponibles.");
      return;
    }

    setIsGenerating(true);
    try {
      const shuffled = shuffleArray([...selectedRoles]);
      await setDoc(doc(db, 'salons', roomId), {
        code: roomId,
        statut: "en_attente",
        roles_selectionnes: selectedRoles,
        roles_dispo_comedien: comedienRoles,
        roles_dispo_comedien_init: comedienRoles, // backup for reset
        roles_melanges: shuffled,
        couple: []
      });
    } catch (error) {
      console.error("Erreur:", error);
      alert("Erreur de connexion Firebase.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartGame = async () => {
    const cartesChoisies = joueurs.filter(j => j.carte_choisie !== null);
    if (cartesChoisies.length !== salonData.roles_selectionnes.length) {
       if (!window.confirm(`Seulement ${cartesChoisies.length} joueurs ont choisi une carte sur ${salonData.roles_selectionnes.length} rôles. Lancer quand même la partie ?`)) {
           return;
       }
    }
    try {
      await updateDoc(doc(db, 'salons', roomId), {
        statut: "en_cours"
      });
    } catch (e) {
      console.error(e);
      alert("Erreur lors du lancement");
    }
  };

  const handleResetGame = async () => {
    if (!window.confirm("Voulez-vous réinitialiser et redistribuer les cartes pour les joueurs connectés ?")) return;
    
    try {
      const shuffled = shuffleArray([...salonData.roles_selectionnes]);
      const batch = writeBatch(db);
      
      batch.update(doc(db, 'salons', roomId), {
        statut: "en_attente",
        roles_melanges: shuffled,
        roles_dispo_comedien: salonData.roles_dispo_comedien_init || []
      });

      joueurs.forEach(j => {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          carte_choisie: null,
          role: "",
          statut_joueur: "en_vie"
        });
      });

      await batch.commit();
    } catch (e) {
      console.error(e);
      alert("Erreur lors de la réinitialisation");
    }
  };

  const getPlayerUrl = () => {
    return `${window.location.origin}/player/${roomId}`;
  };

  if (salonData) {
    return (
      <div className="dashboard-container">
        <ThemeToggle />
        <header className="dashboard-header">
          <div className="dashboard-title-box">
            <h1 className="title-font"><Eye size={28} style={{color: 'var(--primary)'}} /> LE CONSEIL DES LOUPS</h1>
            <p className="text-font">Code du salon : <span className="room-id glow-text">{roomId}</span></p>
          </div>
          
          <div style={{display: 'flex', gap: '10px', flexDirection: 'column'}}>
             {salonData.statut === "en_attente" && (
                <button onClick={handleStartGame} className="btn-primary title-font glow-button" style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                  <Play size={18} /> Lancer la partie
                </button>
             )}
             <button onClick={handleResetGame} className="btn-secondary text-font border-accent" style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                <RefreshCw size={18} /> Réinitialiser
             </button>
          </div>
        </header>

        <div className="mj-content-grid" style={{display: 'grid', gridTemplateColumns: joueurs.length >= salonData.roles_selectionnes.length ? '1fr' : '1fr 1fr', gap: '2rem', marginTop: '2rem'}}>
           {joueurs.length < salonData.roles_selectionnes.length && (
             <div className="qr-panel glass-panel">
               <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px'}}><LinkIcon size={20} /> Rejoindre le salon</h2>
               <p className="text-font text-muted" style={{marginBottom: '1rem'}}>Les joueurs doivent scanner ce code ou utiliser le lien pour rejoindre la partie.</p>
               <div className="qr-wrapper" style={{background: 'white', padding: '15px', borderRadius: '15px', display: 'inline-block'}}>
                 <QRCodeSVG 
                   value={getPlayerUrl()} 
                   size={200}
                   bgColor={"#ffffff"} fgColor={"#000000"} level={"H"} includeMargin={false}
                 />
               </div>
               <div className="qr-url text-font" style={{marginTop: '1rem', wordBreak: 'break-all'}}>{getPlayerUrl()}</div>
             </div>
           )}

           <div className="players-table-panel glass-panel">
              <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Users size={20} /> Joueurs connectés ({joueurs.length})</h2>
              {joueurs.length === 0 ? (
                 <p className="text-font text-muted" style={{fontStyle: 'italic', marginTop: '1rem'}}>En attente de joueurs...</p>
              ) : (
                 <div style={{marginTop: '1rem', overflowX: 'auto'}}>
                    <table style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}} className="text-font">
                       <thead>
                          <tr style={{borderBottom: '1px solid var(--card-border)'}}>
                             <th style={{padding: '10px 5px'}}>Nom</th>
                             <th style={{padding: '10px 5px'}}>Carte</th>
                             <th style={{padding: '10px 5px'}}>Rôle</th>
                             <th style={{padding: '10px 5px'}}>Statut</th>
                          </tr>
                       </thead>
                       <tbody>
                          {joueurs.map(j => {
                             const roleObj = j.role ? rolesData.find(r => r.id === j.role) : null;
                             return (
                                <tr key={j.id} style={{borderBottom: '1px solid var(--card-border)', opacity: j.statut_joueur === 'mort' ? 0.5 : 1}}>
                                   <td style={{padding: '10px 5px', fontWeight: 'bold'}}>{j.nom}</td>
                                   <td style={{padding: '10px 5px'}}>{j.carte_choisie !== null ? j.carte_choisie + 1 : '-'}</td>
                                   <td style={{padding: '10px 5px'}}>
                                      {roleObj ? <span style={{color: roleObj.color, fontWeight: 'bold'}}>{roleObj.name}</span> : <span className="text-muted">Caché</span>}
                                   </td>
                                   <td style={{padding: '10px 5px'}}>
                                     <select
                                       value={j.statut_joueur || 'en_vie'}
                                       onChange={async (e) => {
                                         try {
                                           await updateDoc(doc(db, 'salons', roomId, 'joueurs', j.id), {
                                             statut_joueur: e.target.value
                                           });
                                         } catch (err) {
                                           console.error('Erreur mise à jour statut:', err);
                                         }
                                       }}
                                       style={{
                                         background: 'var(--input-bg)',
                                         color: j.statut_joueur === 'mort' ? 'var(--danger)'
                                             : j.statut_joueur === 'infecte' ? '#a855f7'
                                             : j.statut_joueur === 'en_couple' ? '#ec4899'
                                             : 'var(--success)',
                                         border: '1px solid var(--card-border)',
                                         borderRadius: '6px',
                                         padding: '4px 8px',
                                         fontSize: '0.85rem',
                                         fontWeight: 'bold',
                                         cursor: 'pointer'
                                       }}
                                     >
                                       <option value="en_vie">En vie</option>
                                       <option value="mort">Mort</option>
                                       <option value="infecte">Infecté</option>
                                       <option value="en_couple">En couple</option>
                                     </select>
                                   </td>
                                </tr>
                             );
                          })}
                       </tbody>
                    </table>
                 </div>
              )}
           </div>
        </div>
      </div>
    );
  }

  // Configuration Phase
  return (
    <div className="dashboard-container">
      <ThemeToggle />
      <header className="dashboard-header">
        <div className="dashboard-title-box">
          <h1 className="title-font"><Eye size={28} style={{color: 'var(--primary)'}} /> LE CONSEIL DES LOUPS</h1>
          <p className="text-font">Nouveau salon : <span className="room-id glow-text">{roomId}</span></p>
        </div>
      </header>

      <div className="config-box glass-panel">
        <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px'}}><Settings size={22} style={{color: 'var(--primary)'}} /> Configuration de la partie</h2>
        
        <div style={{marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
            <h3 className="title-font" style={{fontSize: '1.2rem', color: 'var(--text-color)'}}>1. Sélection des rôles</h3>
            <div className={`role-counter text-font text-success`} style={{fontWeight: 'bold', padding: '0.3rem 0.8rem', background: 'var(--input-bg)', borderRadius: '1rem'}}>
              {selectedRoles.length} sélectionnés
            </div>
          </div>
          <p className="text-font" style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>
             Ajoutez les rôles qui seront présents dans la partie. Le nombre de rôles correspondra au nombre de joueurs max.
          </p>
          
          <div className="roles-grid">
            {rolesData.map(role => {
              const count = selectedRoles.filter(id => id === role.id).length;
              return (
                <div key={role.id} className="role-selector-item glass-panel">
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1}}>
                    <div className="role-color-dot" style={{backgroundColor: role.color}}></div>
                    <span className="text-font" style={{fontSize: '0.85rem', fontWeight: '600'}}>{role.name}</span>
                  </div>
                  <div className="role-counter-controls">
                    <button onClick={() => removeRole(role.id)} disabled={count === 0} className="role-btn">-</button>
                    <span className="role-count text-font">{count}</span>
                    <button onClick={() => addRole(role.id)} className="role-btn">+</button>
                  </div>
                </div>
              );
            })}
          </div>
          {selectedRoles.length > 0 && (
            <button onClick={() => setSelectedRoles([])} className="btn-secondary text-font" style={{marginTop: '1rem', width: '100%', justifyContent: 'center'}}>
              Vider la sélection
            </button>
          )}
        </div>

        {hasComedien && (
           <div style={{marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem', background: 'rgba(251, 191, 36, 0.05)', borderRadius: '10px', padding: '1rem'}}>
             <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
               <h3 className="title-font" style={{fontSize: '1.2rem', color: '#fbbf24'}}>2. Rôles pour le Comédien</h3>
               <div className={`role-counter text-font ${comedienRoles.length !== 3 ? 'text-danger' : 'text-success'}`} style={{fontWeight: 'bold', padding: '0.3rem 0.8rem', background: 'var(--input-bg)', borderRadius: '1rem'}}>
                 {comedienRoles.length} / 3
               </div>
             </div>
             <p className="text-font" style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>
                Le Comédien a été sélectionné. Vous devez obligatoirement choisir 3 rôles supplémentaires dans lesquels il pourra piocher.
             </p>
             <div className="roles-grid">
               {rolesData.map(role => {
                 const count = comedienRoles.filter(id => id === role.id).length;
                 return (
                   <div key={`com-${role.id}`} className="role-selector-item glass-panel" style={{borderColor: count > 0 ? '#fbbf24' : ''}}>
                     <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1}}>
                       <div className="role-color-dot" style={{backgroundColor: role.color}}></div>
                       <span className="text-font" style={{fontSize: '0.85rem', fontWeight: '600'}}>{role.name}</span>
                     </div>
                     <div className="role-counter-controls">
                       <button onClick={() => removeComedienRole(role.id)} disabled={count === 0} className="role-btn">-</button>
                       <span className="role-count text-font">{count}</span>
                       <button onClick={() => addComedienRole(role.id)} disabled={comedienRoles.length >= 3} className="role-btn">+</button>
                     </div>
                   </div>
                 );
               })}
             </div>
           </div>
        )}

        <button onClick={handleOpenSalon} disabled={isGenerating || selectedRoles.length < 3 || (hasComedien && comedienRoles.length !== 3)} className="btn-primary title-font glow-button" style={{display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '1rem'}}>
          {isGenerating ? <RefreshCw className="spinner" style={{width: 20, height: 20, borderTopColor: 'white'}} /> : <Users size={20} />}
          {isGenerating ? "Génération..." : "Ouvrir le salon"}
        </button>
      </div>

      <footer className="author-signature text-font">
        Fait par KOBCODE (Koby YZD)
      </footer>
    </div>
  );
}
