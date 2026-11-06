import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, BookOpen, Play } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { RoleDetailsModal, GrimoireModal } from './RoleComponents';

export default function Home() {
  const navigate = useNavigate();
  const [showGrimoire, setShowGrimoire] = useState(false);
  const [inspectRole, setInspectRole]   = useState(null);

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
            <Moon size={52} />
          </div>
        </div>

        <h1 className="home-title title-font">LE CONSEIL DES LOUPS</h1>
        <p className="home-subtitle text-font">
          Le jeu de société réinventé sur smartphone — pour vos parties autour d'une table ou à distance.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button onClick={handleCreateRoom} className="btn-primary title-font">
            <Play size={20} /> Créer une table (Maître du Jeu)
          </button>

          <button
            type="button"
            onClick={() => setShowGrimoire(true)}
            className="btn-secondary text-font border-accent"
            style={{ width: '100%', padding: '0.9rem' }}
          >
            <BookOpen size={18} style={{ color: 'var(--primary)' }} /> Explorer le Grimoire des 40 Rôles
          </button>

          <div className="divider text-font">Joueurs</div>

          <div className="info-box text-font border-accent">
            <strong>Vous êtes un joueur ?</strong><br /><br />
            Scannez le QR code ou ouvrez le lien partagé par le Maître du Jeu pour rejoindre la table, tirer votre carte secrète et utiliser vos pouvoirs !
          </div>
        </div>
      </div>

      <footer className="author-signature text-font">
        Fait par KOBCODE (Koby YZD)
      </footer>

      <RoleDetailsModal role={inspectRole} onClose={() => setInspectRole(null)} showMjScript={true} />
      <GrimoireModal
        isOpen={showGrimoire}
        onClose={() => setShowGrimoire(false)}
        onSelectRole={r => setInspectRole(r)}
      />
    </div>
  );
}
