import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Home() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  };

  const handleCreateRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/mj/${newRoomId}`);
  };

  return (
    <div className="home-container">
      <ThemeToggle />
      
      <div className="home-card glass-panel">
        <div className="home-icon-wrapper">
          <div className="home-icon glow-effect">
            <Moon size={56} />
          </div>
        </div>
        
        <h1 className="home-title title-font">LE CONSEIL DES LOUPS</h1>
        <p className="home-subtitle text-font">Le jeu de société réinventé avec vos smartphones.</p>

        <div>
          <button onClick={handleCreateRoom} className="btn-primary title-font">
            Créer une table (Maître du Jeu)
          </button>
          
          <div className="divider text-font">Joueurs</div>
          
          <div className="info-box text-font border-accent">
            Vous êtes un joueur ? <br/><br/>
            Scannez le QR code ou entrez le lien fourni par le Maître du Jeu pour rejoindre le salon et choisir votre rôle secret !
          </div>
        </div>
      </div>
      
      <footer className="author-signature text-font">
        Fait par KOBCODE (Koby YZD)
      </footer>
    </div>
  );
}
