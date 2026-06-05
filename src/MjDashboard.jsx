import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { rolesData } from './rolesData';
import { Users, RefreshCw, Eye, Settings, CheckCircle2, XCircle } from 'lucide-react';
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
  const [playerCount, setPlayerCount] = useState(8);
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  
  const [selectedRoles, setSelectedRoles] = useState([]);

  useEffect(() => {
    if (!roomId) return;
    const unsubscribe = onSnapshot(collection(db, 'rooms', roomId, 'players'), (snapshot) => {
      const playersList = [];
      snapshot.forEach((doc) => {
        playersList.push({ id: doc.id, ...doc.data() });
      });
      playersList.sort((a, b) => a.playerNum - b.playerNum);
      
      if (playersList.length > 0) {
        setPlayers(playersList);
        setShowConfig(false);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  const toggleRoleSelection = (roleId) => {
    setSelectedRoles(prev => {
      // Pour autoriser plusieurs fois le même rôle (ex: plusieurs loups), on ajoute simplement l'ID.
      // Mais ici, l'interface propose des cases à cocher simples (1 par type). 
      // Si on veut permettre plusieurs loups, on peut ajouter plusieurs fois l'ID dans le tableau.
      // Pour simplifier l'UI comme demandé : une checkbox = 1 rôle sélectionné. 
      if (prev.includes(roleId)) {
        const index = prev.indexOf(roleId);
        const newRoles = [...prev];
        newRoles.splice(index, 1);
        return newRoles;
      } else {
        return [...prev, roleId];
      }
    });
  };

  const addRoleInstance = (roleId) => {
    setSelectedRoles(prev => [...prev, roleId]);
  };

  const removeRoleInstance = (roleId) => {
    setSelectedRoles(prev => {
      const index = prev.lastIndexOf(roleId);
      if (index !== -1) {
        const newRoles = [...prev];
        newRoles.splice(index, 1);
        return newRoles;
      }
      return prev;
    });
  };

  const generateDefaultComposition = (count) => {
    const compo = [];
    compo.push(rolesData.find(r => r.id === 'voyante'));
    compo.push(rolesData.find(r => r.id === 'sorciere'));
    compo.push(rolesData.find(r => r.id === 'cupidon'));
    
    const wolfCount = Math.max(1, Math.floor(count / 4));
    for (let i = 0; i < wolfCount; i++) {
      compo.push(rolesData.find(r => r.id === 'loup-garou'));
    }
    
    const otherRoles = ['chasseur', 'petite-fille'];
    let roleIdx = 0;
    
    while (compo.length < count) {
      if (roleIdx < otherRoles.length) {
         compo.push(rolesData.find(r => r.id === otherRoles[roleIdx]));
         roleIdx++;
      } else {
         compo.push(rolesData.find(r => r.id === 'villageois'));
      }
    }
    return compo.slice(0, count);
  };

  const handleGenerateGame = async () => {
    if (selectedRoles.length > 0 && selectedRoles.length !== playerCount) {
      alert(`Vous avez sélectionné ${selectedRoles.length} rôles pour ${playerCount} joueurs. Veuillez équilibrer ou vider la sélection pour générer automatiquement.`);
      return;
    }

    setIsGenerating(true);
    try {
      let composition = [];
      if (selectedRoles.length === playerCount) {
        composition = selectedRoles.map(id => rolesData.find(r => r.id === id));
      } else {
        composition = generateDefaultComposition(playerCount);
      }

      const shuffledRoles = shuffleArray(composition);

      for (let i = 0; i < playerCount; i++) {
        const playerRef = doc(db, 'rooms', roomId, 'players', `player_${i + 1}`);
        await setDoc(playerRef, {
          playerNum: i + 1,
          role: shuffledRoles[i],
          scanned: false,
          updatedAt: new Date().toISOString()
        });
      }
      setShowConfig(false);
    } catch (error) {
      console.error("Erreur:", error);
      alert("Erreur de connexion Firebase.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleResetGame = async () => {
    if (!window.confirm("Voulez-vous recommencer avec de nouveaux rôles ?")) return;
    setShowConfig(true); // Retourner à la configuration pour choisir
  };

  const getPlayerUrl = (playerNum) => {
    return `${window.location.origin}/player/${roomId}/${playerNum}`;
  };

  return (
    <div className="dashboard-container">
      <ThemeToggle />

      <header className="dashboard-header">
        <div className="dashboard-title-box">
          <h1 className="title-font"><Eye size={28} style={{color: 'var(--primary)'}} /> LE CONSEIL DES LOUPS</h1>
          <p className="text-font">Code de la table : <span className="room-id glow-text">{roomId}</span></p>
        </div>
        
        {!showConfig && (
          <button onClick={handleResetGame} className="btn-secondary text-font border-accent">
            <RefreshCw size={18} /> Reconfigurer
          </button>
        )}
      </header>

      {showConfig ? (
        <div className="config-box glass-panel">
          <h2 className="title-font"><Settings size={22} style={{color: 'var(--primary)'}} /> Configuration de la partie</h2>
          
          <div style={{marginBottom: '2rem'}}>
            <label className="text-font" style={{fontWeight: 'bold', color: 'var(--text-color)'}}>Nombre de joueurs</label>
            <div className="slider-container">
              <input 
                type="range" min="4" max="30" 
                value={playerCount}
                onChange={(e) => setPlayerCount(parseInt(e.target.value))}
              />
              <span className="title-font" style={{fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)', width: '45px', textAlign: 'center'}}>{playerCount}</span>
            </div>
          </div>

          <div style={{marginBottom: '2rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.5rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h3 className="title-font" style={{fontSize: '1.2rem', color: 'var(--text-color)'}}>Sélection des rôles (Optionnel)</h3>
              <div className={`role-counter text-font ${selectedRoles.length > 0 && selectedRoles.length !== playerCount ? 'text-danger' : 'text-success'}`} style={{fontWeight: 'bold', padding: '0.3rem 0.8rem', background: 'var(--input-bg)', borderRadius: '1rem'}}>
                {selectedRoles.length} / {playerCount}
              </div>
            </div>
            <p className="text-font" style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>Si vous laissez la sélection vide (0/{playerCount}), une composition équilibrée sera générée automatiquement.</p>
            
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
                      <button onClick={() => removeRoleInstance(role.id)} disabled={count === 0} className="role-btn">-</button>
                      <span className="role-count text-font">{count}</span>
                      <button onClick={() => addRoleInstance(role.id)} className="role-btn">+</button>
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

          <button onClick={handleGenerateGame} disabled={isGenerating} className="btn-primary title-font glow-button" style={{display: 'flex', justifyContent: 'center', gap: '10px'}}>
            {isGenerating ? <RefreshCw className="spinner" style={{width: 20, height: 20, borderTopColor: 'white'}} /> : <Users size={20} />}
            {isGenerating ? "Génération..." : "Ouvrir la table"}
          </button>
        </div>
      ) : (
        <div>
          <p className="player-grid-instructions text-font">Cliquez sur un joueur pour afficher son QR code. Les scannés seront mis en évidence avec une aura magique.</p>
          
          <div className="player-grid">
            {players.map((player) => (
              <button
                key={player.playerNum}
                onClick={() => setSelectedPlayer(player.playerNum)}
                className={`player-card glass-panel ${player.scanned ? 'scanned glow-border' : ''}`}
              >
                {player.scanned && <CheckCircle2 size={24} className="check-icon" />}
                <span className="player-number title-font">{player.playerNum}</span>
                <span className="player-status text-font">{player.scanned ? 'Prêt' : 'En attente'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedPlayer && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel border-accent">
            <button onClick={() => setSelectedPlayer(null)} className="close-btn"><XCircle size={32} /></button>
            
            <h3 className="title-font" style={{fontSize: '1.8rem', marginBottom: '0.5rem', color: 'var(--text-color)'}}>Joueur {selectedPlayer}</h3>
            <p className="text-font" style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Faites scanner ce code par le joueur.</p>
            
            <div className="qr-wrapper">
              <QRCodeSVG 
                value={getPlayerUrl(selectedPlayer)} 
                size={220}
                bgColor={"#ffffff"} fgColor={"#000000"} level={"H"} includeMargin={false}
              />
            </div>
            
            <div className="qr-url text-font">{getPlayerUrl(selectedPlayer)}</div>
          </div>
        </div>
      )}

      <footer className="author-signature text-font">
        Fait par KOBCODE (Koby YZD)
      </footer>
    </div>
  );
}
