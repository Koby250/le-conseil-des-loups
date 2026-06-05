import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { ShieldAlert, AlertTriangle, EyeOff } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function PlayerScreen() {
  const { roomId, playerNum } = useParams();
  const [roleData, setRoleData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRole, setShowRole] = useState(false);
  
  useEffect(() => {
    const fetchRole = async () => {
      try {
        const playerKey = `loup_garou_player_token`;
        const currentToken = localStorage.getItem(playerKey);
        const thisSessionToken = `${roomId}_${playerNum}`;

        if (currentToken && currentToken !== thisSessionToken) {
          setError("Triche détectée ! Vous êtes déjà assigné à un autre numéro de joueur sur ce téléphone.");
          setLoading(false);
          return;
        }

        if (!currentToken) {
          localStorage.setItem(playerKey, thisSessionToken);
        }

        const playerRef = doc(db, 'rooms', roomId, 'players', `player_${playerNum}`);
        const playerSnap = await getDoc(playerRef);

        if (playerSnap.exists()) {
          const data = playerSnap.data();
          setRoleData(data.role);
          
          if (!data.scanned) {
             await updateDoc(playerRef, { scanned: true });
          }
        } else {
          setError("Joueur introuvable. La partie n'a peut-être pas été générée correctement.");
        }
      } catch (err) {
        console.error("Erreur:", err);
        setError("Erreur de connexion avec le serveur.");
      } finally {
        setLoading(false);
      }
    };

    if (roomId && playerNum) {
      fetchRole();
    }
  }, [roomId, playerNum]);

  if (loading) {
    return (
      <div className="player-screen">
        <div className="loading">
          <div className="spinner"></div>
          <p style={{color: 'var(--text-muted)', fontWeight: '500'}}>Connexion aux esprits...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="player-screen">
        <div className="error-box">
          <div className="error-content">
            <AlertTriangle size={48} />
            <h2>Accès Refusé</h2>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-screen">
      <ThemeToggle />

      <div 
        className="ambient-bg"
        style={{ backgroundColor: roleData?.color || '#000' }}
      ></div>

      <div className="player-content">
        <div>
          <span className="room-badge">SALON {roomId}</span>
          <h1 className="player-title">
            Vous êtes le Joueur <strong>{playerNum}</strong>
          </h1>
        </div>

        <div className="perspective-container">
          <button 
            onClick={() => setShowRole(!showRole)}
            className={`flip-card ${showRole ? 'flipped' : ''}`}
          >
            {/* Recto (Caché) */}
            <div className="flip-card-front">
              <EyeOff size={64} style={{color: 'var(--text-muted)', marginBottom: '1.5rem'}} />
              <p>Appuyez pour révéler</p>
              <small>Assurez-vous que personne ne regarde votre écran.</small>
            </div>

            {/* Verso (Révélé) */}
            <div 
              className="flip-card-back"
              style={{ 
                borderColor: roleData?.color || 'var(--card-border)',
                boxShadow: `0 10px 40px ${roleData?.color}40`
              }}
            >
              <div 
                className="card-gradient"
                style={{ background: `linear-gradient(to bottom, ${roleData?.color}30, transparent)` }}
              ></div>
              
              <div className="card-inner">
                <h2 className="role-name" style={{ color: roleData?.color }}>
                  {roleData?.name}
                </h2>
                <div className="role-divider" style={{ backgroundColor: roleData?.color }}></div>
                
                <div className="role-desc">
                  {roleData?.description}
                </div>
              </div>
            </div>
          </button>
        </div>
        
        <div className="warning-text">
          <ShieldAlert size={20} />
          <span>Ne rafraîchissez pas cette page, sous peine de perdre l'accès à votre rôle.</span>
        </div>
      </div>

      <footer className="author-signature text-font">
        Fait par KOBCODE (Koby YZD)
      </footer>
    </div>
  );
}
