import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { collection, doc, setDoc, updateDoc, onSnapshot, writeBatch, runTransaction } from 'firebase/firestore';

import { db } from './firebase';
import { rolesData } from './rolesData';
import { Users, RefreshCw, Eye, Settings, Play, Link as LinkIcon, Info } from 'lucide-react';
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
  
  // Config state
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [comedienRoles, setComedienRoles] = useState([]);
  const [distributionMode, setDistributionMode] = useState('aleatoire'); // 'aleatoire' ou 'manuelle'
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const unsubSalon = onSnapshot(doc(db, 'salons', roomId), (docSnap) => {
      setSalonData(docSnap.exists() ? docSnap.data() : null);
    });
    const unsubJoueurs = onSnapshot(collection(db, 'salons', roomId, 'joueurs'), (snapshot) => {
      const jList = [];
      snapshot.forEach((d) => jList.push({ id: d.id, ...d.data() }));
      setJoueurs(jList);
    });
    return () => { unsubSalon(); unsubJoueurs(); };
  }, [roomId]);

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

  // Config handlers
  const addRole = (roleId) => setSelectedRoles(prev => [...prev, roleId]);
  const removeRole = (roleId) => setSelectedRoles(prev => {
    const index = prev.lastIndexOf(roleId);
    if (index !== -1) { const n = [...prev]; n.splice(index, 1); return n; }
    return prev;
  });
  const addComedienRole = (roleId) => { if (comedienRoles.length < 3) setComedienRoles(prev => [...prev, roleId]); };
  const removeComedienRole = (roleId) => setComedienRoles(prev => {
    const index = prev.lastIndexOf(roleId);
    if (index !== -1) { const n = [...prev]; n.splice(index, 1); return n; }
    return prev;
  });
  const hasComedien = selectedRoles.includes('comedien');

  const handleOpenSalon = async () => {
    if (selectedRoles.length < 3) return alert("Veuillez sélectionner au moins 3 rôles.");
    if (hasComedien && comedienRoles.length !== 3) return alert("Le Comédien nécessite 3 rôles supplémentaires.");
    
    setIsGenerating(true);
    try {
      const shuffled = shuffleArray([...selectedRoles]);
      await setDoc(doc(db, 'salons', roomId), {
        code: roomId,
        statut: "en_attente",
        distribution_mode: distributionMode,
        roles_selectionnes: selectedRoles,
        roles_dispo_comedien: comedienRoles,
        roles_dispo_comedien_init: comedienRoles,
        roles_melanges: shuffled,
        couple: [],
        victime_loups: null,
        victime_sauvee: false,
        victime_sorciere: null,
        vote_loup_temporaire: null,
        joueur_protege: null,
        illusion_active: false
      });
    } catch (error) {
      console.error(error); alert("Erreur de création du salon.");
    } finally {
      setIsGenerating(false);
    }
  };

  const assignRoleManually = async (joueurId, roleId) => {
    try {
      await updateDoc(doc(db, 'salons', roomId, 'joueurs', joueurId), {
        role: roleId,
        carte_choisie: 999 // Indique qu'une carte a été assignée manuellement
      });
    } catch (e) { console.error(e); }
  };

  const handleStartGame = async () => {
    if (salonData.distribution_mode === 'manuelle') {
      const allAssigned = joueurs.every(j => j.role && j.role !== "");
      if (!allAssigned) return alert("Tous les joueurs doivent avoir un rôle assigné en mode manuel.");
    } else {
      const cartesChoisies = joueurs.filter(j => j.carte_choisie !== null);
      if (cartesChoisies.length !== salonData.roles_selectionnes.length) {
         if (!window.confirm(`Seulement ${cartesChoisies.length} joueurs ont choisi une carte sur ${salonData.roles_selectionnes.length}. Lancer quand même ?`)) return;
      }
    }
    
    try {
      await updateDoc(doc(db, 'salons', roomId), { statut: "nuit_cupidon" });
    } catch (e) { console.error(e); alert("Erreur lors du lancement"); }
  };

  const changePhase = async (newPhase) => {
    try { await updateDoc(doc(db, 'salons', roomId), { statut: newPhase }); } 
    catch (e) { console.error(e); }
  };

  const handleApplyNightDeaths = async () => {
    try {
      await runTransaction(db, async (transaction) => {
        const joueursRef = collection(db, 'salons', roomId, 'joueurs');
        
        let diedFromLoups = false;
        let diedFromSorciere = false;

        // 1. Victime Loups
        if (salonData.victime_loups && !salonData.victime_sauvee) {
          const loupVictimDoc = joueurs.find(j => j.nom === salonData.victime_loups);
          if (loupVictimDoc && loupVictimDoc.nom !== salonData.joueur_protege) {
             transaction.update(doc(db, 'salons', roomId, 'joueurs', loupVictimDoc.id), { statut_joueur: 'mort' });
             diedFromLoups = true;
          }
        }
        
        // 2. Victime Sorcière
        if (salonData.victime_sorciere) {
          const sorcVictimDoc = joueurs.find(j => j.nom === salonData.victime_sorciere);
          if (sorcVictimDoc) {
             transaction.update(doc(db, 'salons', roomId, 'joueurs', sorcVictimDoc.id), { statut_joueur: 'mort' });
             diedFromSorciere = true;
          }
        }

        // Nettoyage variables de nuit
        transaction.update(doc(db, 'salons', roomId), { 
           statut: 'jour_vote',
           morts_nuit: { loups: diedFromLoups ? salonData.victime_loups : null, sorciere: diedFromSorciere ? salonData.victime_sorciere : null }
        });
      });
    } catch (e) { console.error(e); alert("Erreur résolution nuit"); }
  };

  const handleApplyDaySentence = async () => {
    const votesCount = {};
    joueurs.filter(j => j.statut_joueur !== 'mort' && j.vote_jour).forEach(j => {
       votesCount[j.vote_jour] = (votesCount[j.vote_jour] || 0) + 1;
    });
    
    if (Object.keys(votesCount).length === 0) return alert("Aucun vote n'a été enregistré.");
    
    let maxVotes = 0;
    let condamneNom = null;
    let tie = false;

    for (const [nom, count] of Object.entries(votesCount)) {
       if (count > maxVotes) { maxVotes = count; condamneNom = nom; tie = false; }
       else if (count === maxVotes) { tie = true; }
    }

    if (tie || !condamneNom) {
       alert("Égalité parfaite ou aucun condamné. Personne ne meurt.");
       // Passer directement à la résolution sans tuer
       try { await updateDoc(doc(db, 'salons', roomId), { statut: 'jour_resolution', condamne_jour: 'Personne (Égalité)' }); } catch(e){}
       return;
    }

    const condamne = joueurs.find(j => j.nom === condamneNom);
    if (!condamne) return;

    if (condamne.role === 'illusionniste' && salonData.illusion_active) {
       alert("🔮 C'était une illusion ! L'Illusionniste survit !");
       try {
         await updateDoc(doc(db, 'salons', roomId), { illusion_active: false, statut: 'jour_resolution', condamne_jour: condamneNom + ' (Sauvé par Illusion)' });
       } catch(e) { console.error(e); }
    } else {
       if (window.confirm(`Voulez-vous vraiment condamner ${condamneNom} (${maxVotes} votes) ?`)) {
          try {
             await updateDoc(doc(db, 'salons', roomId, 'joueurs', condamne.id), { statut_joueur: 'mort' });
             await updateDoc(doc(db, 'salons', roomId), { statut: 'jour_resolution', condamne_jour: condamneNom });
          } catch(e) { console.error(e); }
       }
    }
  };

  const handleNextNight = async () => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'salons', roomId), {
         statut: 'nuit_salvateur',
         victime_loups: null,
         victime_sauvee: false,
         victime_sorciere: null,
         vote_loup_temporaire: null,
         joueur_protege: null,
         illusion_active: false,
         condamne_jour: null,
         morts_nuit: null
      });
      joueurs.forEach(j => {
         batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), { a_vote: false, a_vote_sorciere: false, vote_jour: null });
      });
      await batch.commit();
    } catch(e) { console.error(e); }
  };

  const handleResetGame = async () => {
    if (!window.confirm("Voulez-vous réinitialiser et redistribuer les cartes pour les joueurs connectés ?")) return;
    try {
      const shuffled = shuffleArray([...salonData.roles_selectionnes]);
      const batch = writeBatch(db);
      
      batch.update(doc(db, 'salons', roomId), {
        statut: "en_attente",
        roles_melanges: shuffled,
        roles_dispo_comedien: salonData.roles_dispo_comedien_init || [],
        couple: [], victime_loups: null, victime_sauvee: false, victime_sorciere: null, vote_loup_temporaire: null, joueur_protege: null, illusion_active: false
      });

      joueurs.forEach(j => {
        batch.update(doc(db, 'salons', roomId, 'joueurs', j.id), {
          carte_choisie: null, role: "", statut_joueur: "en_vie", pouvoir_utilise: false, a_vote: false, a_vote_sorciere: false, vote_jour: null, illusion_dispo: true, dernier_protege: null
        });
      });
      await batch.commit();
    } catch (e) { console.error(e); }
  };

  const getPlayerUrl = () => `${window.location.origin}/player/${roomId}`;

  if (!salonData) {
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
          
          <div style={{marginBottom: '1.5rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px'}}>
             <h3 className="title-font" style={{fontSize: '1.1rem', marginBottom: '10px'}}>Mode de distribution</h3>
             <div style={{display: 'flex', gap: '10px'}}>
               <button onClick={() => setDistributionMode('aleatoire')} className={`btn-secondary text-font ${distributionMode === 'aleatoire' ? 'glow-button' : ''}`} style={{flex: 1, borderColor: distributionMode === 'aleatoire' ? 'var(--primary)' : ''}}>🎲 Aléatoire</button>
               <button onClick={() => setDistributionMode('manuelle')} className={`btn-secondary text-font ${distributionMode === 'manuelle' ? 'glow-button' : ''}`} style={{flex: 1, borderColor: distributionMode === 'manuelle' ? 'var(--primary)' : ''}}>✍️ Manuelle</button>
             </div>
          </div>

          <div style={{marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h3 className="title-font" style={{fontSize: '1.2rem'}}>Sélection des rôles</h3>
              <div className="role-counter text-font text-success" style={{fontWeight: 'bold', padding: '0.3rem 0.8rem', background: 'var(--input-bg)', borderRadius: '1rem'}}>
                {selectedRoles.length} sélectionnés
              </div>
            </div>
            <div className="roles-grid">
              {rolesData.map(role => {
                const count = selectedRoles.filter(id => id === role.id).length;
                return (
                  <div key={role.id} className="role-selector-item glass-panel">
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1}}>
                      <div className="role-color-dot" style={{backgroundColor: role.color}}></div>
                      <span className="text-font" style={{fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-color)'}}>{role.name}</span>
                    </div>
                    <div className="role-counter-controls">
                      <button onClick={() => removeRole(role.id)} disabled={count === 0} className="role-btn">-</button>
                      <span className="role-count text-font" style={{color: 'var(--text-color)'}}>{count}</span>
                      <button onClick={() => addRole(role.id)} className="role-btn">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button onClick={handleOpenSalon} disabled={isGenerating || selectedRoles.length < 3} className="btn-primary title-font glow-button" style={{display: 'flex', justifyContent: 'center', gap: '10px', width: '100%'}}>
            {isGenerating ? <RefreshCw className="spinner" size={20} /> : <Users size={20} />}
            Ouvrir le salon
          </button>
        </div>
      </div>
    );
  }

  // MJ Control Panel (Game in progress)
  const isPhase = (p) => salonData.statut === p;
  const isGameRunning = salonData.statut !== 'en_attente';
  const displayFormat = isGameRunning ? '1fr' : (joueurs.length >= salonData.roles_selectionnes.length ? '1fr' : '1fr 1fr');

  return (
    <div className="dashboard-container">
      <ThemeToggle />
      <header className="dashboard-header">
        <div className="dashboard-title-box">
          <h1 className="title-font"><Eye size={28} style={{color: 'var(--primary)'}} /> LE CONSEIL DES LOUPS</h1>
          <p className="text-font">Code du salon : <span className="room-id glow-text">{roomId}</span> | Phase : <strong style={{color: 'var(--primary)'}}>{salonData.statut.replace('_', ' ').toUpperCase()}</strong></p>
        </div>
        <div style={{display: 'flex', gap: '10px', flexDirection: 'column'}}>
           <button onClick={handleResetGame} className="btn-secondary text-font border-accent" style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
              <RefreshCw size={18} /> Réinitialiser
           </button>
        </div>
      </header>

      {/* PANNEAU DE CONTRÔLE DES PHASES */}
      <div className="glass-panel" style={{marginTop: '2rem', border: '2px solid var(--primary)', background: 'var(--bg-color)', borderRadius: '1.5rem', padding: '2rem'}}>
        <h2 className="title-font" style={{marginBottom: '1rem', color: 'var(--primary)'}}>🕹️ CONTRÔLE DE LA PARTIE</h2>
        
        {isPhase('en_attente') && (
           <div>
             <p className="text-font text-muted" style={{marginBottom: '1rem'}}>Les joueurs rejoignent le salon. Une fois tout le monde prêt et les rôles distribués, lancez la partie.</p>
             <button onClick={handleStartGame} className="btn-primary title-font glow-button" style={{width: '100%', padding: '15px', fontSize: '1.2rem'}}><Play size={20}/> LANCER LA PARTIE (NUIT CUPIDON)</button>
           </div>
        )}

        {isPhase('nuit_cupidon') && (
          <div>
            <p className="text-font" style={{color: '#ec4899', fontSize: '1.1rem'}}>💖 C'est la nuit de Cupidon. S'il est en jeu, il doit désigner deux amoureux.</p>
            <p className="text-font text-muted" style={{marginBottom: '1.5rem'}}>Amoureux actuels : {salonData.couple?.length === 2 ? `Choisis` : 'En attente...'}</p>
            <button onClick={() => changePhase('nuit_voleur')} className="btn-primary title-font glow-button" style={{background: '#ec4899', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer au Voleur ➔</button>
          </div>
        )}

        {isPhase('nuit_voleur') && (
          <div>
            <p className="text-font text-muted" style={{marginBottom: '1.5rem', fontSize: '1.1rem'}}>🕵️ Le Voleur peut échanger sa carte avec un autre joueur ou passer son tour.</p>
            <button onClick={() => changePhase('nuit_salvateur')} className="btn-primary title-font glow-button" style={{width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer au Salvateur ➔</button>
          </div>
        )}

        {isPhase('nuit_salvateur') && (
          <div>
            <p className="text-font" style={{color: '#3b82f6', fontSize: '1.1rem'}}>🛡️ Le Salvateur choisit un joueur à protéger des loups.</p>
            <p className="text-font text-muted" style={{marginBottom: '1.5rem'}}>Joueur protégé ce tour : <strong>{salonData.joueur_protege || 'Aucun'}</strong></p>
            <button onClick={() => changePhase('nuit_voyante')} className="btn-primary title-font glow-button" style={{background: '#3b82f6', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer à la Voyante ➔</button>
          </div>
        )}

        {isPhase('nuit_voyante') && (
          <div>
            <p className="text-font" style={{color: '#8b5cf6', fontSize: '1.1rem', marginBottom: '1.5rem'}}>👁️ La Voyante observe la carte d'un joueur.</p>
            <button onClick={() => changePhase('nuit_loups')} className="btn-primary title-font glow-button" style={{background: '#8b5cf6', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer aux Loups-Garous ➔</button>
          </div>
        )}

        {isPhase('nuit_loups') && (
          <div>
            <p className="text-font" style={{color: '#ef4444', fontSize: '1.1rem'}}>🐺 Les loups choisissent leur victime.</p>
            <div style={{background: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '8px', margin: '1rem 0'}}>
              <p className="text-font">Cible temporaire : <strong style={{color: 'var(--text-color)'}}>{salonData.vote_loup_temporaire || '-'}</strong></p>
              <p className="text-font">Choix final : <strong style={{color: 'var(--text-color)'}}>{salonData.victime_loups || 'En attente...'}</strong></p>
            </div>
            <button onClick={() => changePhase('nuit_sorciere')} className="btn-primary title-font glow-button" style={{background: '#ef4444', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer à la Sorcière ➔</button>
          </div>
        )}

        {isPhase('nuit_sorciere') && (() => {
          const sorciere = joueurs.find(j => j.role === 'sorciere' && j.statut_joueur !== 'mort');
          return (
            <div>
              <p className="text-font" style={{color: '#c4b5fd', fontSize: '1.1rem'}}>🧙‍♀️ La sorcière utilise ses potions.</p>
              {!sorciere ? (
                <p className="text-font text-muted" style={{fontStyle: 'italic', margin: '1rem 0'}}>Pas de sorcière en vie.</p>
              ) : (
                <p className="text-font" style={{margin: '1rem 0', fontWeight: 'bold', color: sorciere.a_vote_sorciere ? '#10b981' : '#f59e0b'}}>{sorciere.a_vote_sorciere ? '✅ A terminé' : '⏳ En train de réfléchir'}</p>
              )}
              <button onClick={() => changePhase('matin')} className="btn-primary title-font glow-button" style={{background: '#c4b5fd', color: '#000', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Passer au MATIN ➔</button>
            </div>
          );
        })()}

        {isPhase('matin') && (
          <div>
            <p className="text-font text-warning" style={{marginBottom: '1rem', fontSize: '1.1rem'}}>☀️ Le village se réveille. Le MJ doit appliquer les sentences de la nuit.</p>
            <ul className="text-font" style={{background: 'var(--input-bg)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', color: 'var(--text-color)'}}>
              <li>🐺 Cible des loups : <strong>{salonData.victime_loups || 'Personne'}</strong></li>
              <li>🛡️ Salvateur a protégé : <strong>{salonData.joueur_protege || 'Personne'}</strong></li>
              <li>🧪 Sorcière a sauvé : <strong>{salonData.victime_sauvee ? 'OUI' : 'NON'}</strong></li>
              <li>💀 Sorcière a tué : <strong>{salonData.victime_sorciere || 'Personne'}</strong></li>
            </ul>
            <button onClick={handleApplyNightDeaths} className="btn-primary title-font glow-button" style={{background: '#f59e0b', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Appliquer les morts et passer au Vote ➔</button>
          </div>
        )}

        {isPhase('jour_vote') && (() => {
           const votesCount = {};
           joueurs.filter(j => j.statut_joueur !== 'mort' && j.vote_jour).forEach(j => {
              votesCount[j.vote_jour] = (votesCount[j.vote_jour] || 0) + 1;
           });
           return (
              <div>
                <p className="text-font" style={{marginBottom: '1rem', fontSize: '1.1rem'}}>☀️ Le village débat et vote pour éliminer un suspect.</p>
                {salonData.illusion_active && <div style={{background: '#8b5cf6', color: 'white', padding: '10px', borderRadius: '8px', marginBottom: '1rem', fontWeight: 'bold'}}>✨ L'Illusionniste a activé son pouvoir !</div>}
                <div style={{background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem'}}>
                  <h4 className="title-font" style={{marginBottom: '10px', color: 'var(--text-color)'}}>Urne en temps réel :</h4>
                  {Object.entries(votesCount).length === 0 ? <p className="text-muted text-font">Aucun vote.</p> : (
                    <ul style={{listStyle: 'none', padding: 0}} className="text-font">
                      {Object.entries(votesCount).sort((a,b)=>b[1]-a[1]).map(([nom, count]) => (
                        <li key={nom} style={{display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--card-border)', color: 'var(--text-color)'}}>
                           <span>{nom}</span> <strong>{count} voix</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button onClick={handleApplyDaySentence} className="btn-primary title-font glow-button" style={{background: '#ef4444', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>Figer le Vote et Appliquer la Sentence 🔨</button>
              </div>
           );
        })()}

        {isPhase('jour_resolution') && (
           <div>
             <h3 className="title-font" style={{color: 'var(--success)', marginBottom: '1.5rem', fontSize: '1.5rem'}}>Sentence appliquée. ({salonData.condamne_jour})</h3>
             <button onClick={handleNextNight} className="btn-primary title-font glow-button" style={{background: '#1d4ed8', border: 'none', width: '100%', padding: '15px', fontSize: '1.2rem'}}>🌙 Lancer la Nuit Suivante (Salvateur) ➔</button>
           </div>
        )}
      </div>

      <div className="mj-content-grid" style={{display: 'grid', gridTemplateColumns: displayFormat, gap: '2rem', marginTop: '2rem'}}>
         {/* HIDE QR CODE WHEN GAME IS RUNNING */}
         {!isGameRunning && joueurs.length < salonData.roles_selectionnes.length && (
           <div className="qr-panel glass-panel">
             <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)'}}><LinkIcon size={20} /> Rejoindre le salon</h2>
             <p className="text-font text-muted" style={{marginBottom: '1rem'}}>Scannez ce code pour rejoindre. {joueurs.length}/{salonData.roles_selectionnes.length} joueurs.</p>
             <div className="qr-wrapper" style={{background: 'white', padding: '15px', borderRadius: '15px', display: 'inline-block'}}>
               <QRCodeSVG value={getPlayerUrl()} size={200} bgColor={"#ffffff"} fgColor={"#000000"} level={"H"} includeMargin={false} />
             </div>
             <div className="qr-url text-font" style={{marginTop: '1rem', wordBreak: 'break-all'}}>{getPlayerUrl()}</div>
           </div>
         )}
         
         {/* RESUME DE LA PHASE (Quand la partie est lancée et remplace le QR) */}
         {isGameRunning && (
           <div className="glass-panel" style={{display: 'flex', flexDirection: 'column', padding: '2rem'}}>
             <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)', marginBottom: '1rem'}}><Info size={20} /> Guide pour le MJ</h2>
             <p className="text-font text-muted" style={{lineHeight: 1.6}}>
               Vous êtes en phase : <strong style={{color: 'var(--primary)'}}>{salonData.statut}</strong>.<br/><br/>
               Demandez à tous les joueurs de regarder leur téléphone et de fermer les yeux si nécessaire. Appelez le rôle concerné et suivez les instructions à l'écran. 
             </p>
           </div>
         )}

         <div className="players-table-panel glass-panel" style={{gridColumn: (!isGameRunning && joueurs.length < salonData.roles_selectionnes.length) ? 'auto' : '1 / -1'}}>
            <h2 className="title-font" style={{display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color)'}}><Users size={20} /> Joueurs ({joueurs.filter(j => j.statut_joueur !== 'mort').length} en vie / {joueurs.length} total)</h2>
            <div style={{marginTop: '1rem', overflowX: 'auto'}}>
               <table style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}} className="text-font">
                  <thead>
                     <tr style={{borderBottom: '1px solid var(--card-border)'}}>
                        <th style={{padding: '10px 5px', color: 'var(--text-muted)'}}>Nom</th>
                        <th style={{padding: '10px 5px', color: 'var(--text-muted)'}}>Statut</th>
                        <th style={{padding: '10px 5px', color: 'var(--text-muted)'}}>Rôle</th>
                     </tr>
                  </thead>
                  <tbody>
                      {joueurs.map(j => {
                         const roleObj = j.role ? rolesData.find(r => r.id === j.role) : null;
                         return (
                            <tr key={j.id} style={{borderBottom: '1px solid var(--card-border)', opacity: j.statut_joueur === 'mort' ? 0.5 : 1}}>
                               <td style={{padding: '10px 5px', fontWeight: 'bold', color: 'var(--text-color)'}}>{j.nom}</td>
                               <td style={{padding: '10px 5px'}}>
                                 <select
                                   value={j.statut_joueur || 'en_vie'}
                                   onChange={(e) => updateDoc(doc(db, 'salons', roomId, 'joueurs', j.id), { statut_joueur: e.target.value })}
                                   style={{ background: 'var(--input-bg)', color: j.statut_joueur==='mort'?'var(--danger)':'var(--success)', border: '1px solid var(--card-border)', borderRadius: '6px', padding: '4px', fontWeight: 'bold' }}
                                 >
                                   <option value="en_vie">En vie</option>
                                   <option value="mort">Mort</option>
                                   <option value="infecte">Infecté</option>
                                   <option value="En couple">En couple</option>
                                 </select>
                               </td>
                               <td style={{padding: '10px 5px'}}>
                                  {salonData.statut === 'en_attente' && salonData.distribution_mode === 'manuelle' ? (
                                    <select value={j.role || ''} onChange={(e) => assignRoleManually(j.id, e.target.value)} style={{background: 'var(--input-bg)', color: 'var(--text-color)', padding: '5px', borderRadius: '5px', border: '1px solid var(--card-border)'}}>
                                      <option value="">Sélectionner...</option>
                                      {rolesData.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                  ) : (
                                    <span style={{color: roleObj?.color || 'var(--text-color)', fontWeight: 'bold'}}>{roleObj?.name || 'Caché'}</span>
                                  )}
                               </td>
                            </tr>
                         );
                      })}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
    </div>
  );
}
