import { useState } from 'react';
import {
  PawPrint, Eye, FlaskConical, Crosshair, Wheat, Heart, ScanEye,
  VenetianMask, Music, Laugh, Hourglass, Scale, ShieldCheck, Snowflake,
  Bird, Feather, Droplets, TreePine, Dog, ScanSearch, Users, UsersRound,
  Gavel, Sword, Drama, Megaphone, Flame, Shovel, Biohazard, Shield,
  Split, Baby, Target, Scissors, Church, TestTubes, Telescope, Gem,
  WandSparkles, Skull, Sparkles, Swords, Crown, Info, BookOpen, X,
  Search, Moon, Lightbulb, Mic, Zap, RefreshCw, HelpCircle
} from 'lucide-react';
import { ROLES_DATA, AUTOMATION_META, getRole } from './rolesData';

export const ROLE_ICON_MAP = {
  'loup-garou': PawPrint,
  'loup': PawPrint,
  'voyante': Eye,
  'sorciere': FlaskConical,
  'chasseur': Crosshair,
  'villageois': Wheat,
  'cupidon': Heart,
  'petite-fille': ScanEye,
  'voleur': VenetianMask,
  'joueur-flute': Music,
  'idiot-village': Laugh,
  'ancien': Hourglass,
  'bouc-emissaire': Scale,
  'salvateur': ShieldCheck,
  'loup-blanc': Snowflake,
  'corbeau': Bird,
  'ange': Feather,
  'grand-mechant-loup': Swords,
  'enfant-sauvage': TreePine,
  'chien-loup': Dog,
  'renard': ScanSearch,
  'soeurs': Users,
  'deux-soeurs': Users,
  'freres': UsersRound,
  'trois-freres': UsersRound,
  'juge-begue': Gavel,
  'chevalier-epee': Sword,
  'comedien': Drama,
  'montreur-ours': Crown,
  'pyromane': Flame,
  'ankou': Skull,
  'infect-pere-des-loups': Biohazard,
  'pere-des-loups': Biohazard,
  'loup-noir': Biohazard,
  'renard-garou': Droplets,
  'garde-champetre': Shield,
  'garde': Shield,
  'sectaire': Split,
  'abominable-sectaire': Split,
  'louveteau': Baby,
  'chasseur-tetes': Target,
  'barbier': Scissors,
  'confesseur': Church,
  'nonne': Church,
  'alchimiste': TestTubes,
  'devin': Telescope,
  'astronome': Telescope,
  'charmeuse': Gem,
  'gitane': Gem,
  'illusionniste': WandSparkles,
  'marionnettiste': WandSparkles,
  'necromancien': Skull,
  'aboyeur': Megaphone,
  'fossoyeur': Shovel,
  'bouffon': Sparkles,
};

export function RoleIcon({ roleId, size = 20, className = '', style = {} }) {
  const IconComponent = ROLE_ICON_MAP[roleId] || Sparkles;
  return <IconComponent size={size} className={className} style={style} />;
}

export function RoleMedallion({ role, size = 'md', onClick, className = '' }) {
  if (!role) return null;
  const dimensions = {
    xs: { box: 28, icon: 15, radius: '0.55rem' },
    sm: { box: 36, icon: 18, radius: '0.7rem' },
    md: { box: 48, icon: 24, radius: '0.9rem' },
    lg: { box: 68, icon: 34, radius: '1.2rem' },
    xl: { box: 84, icon: 42, radius: '1.4rem' },
  }[size] || { box: 48, icon: 24, radius: '0.9rem' };

  return (
    <div
      onClick={onClick}
      className={`role-medallion ${className}`}
      style={{
        width: `${dimensions.box}px`,
        height: `${dimensions.box}px`,
        minWidth: `${dimensions.box}px`,
        borderRadius: dimensions.radius,
        background: `radial-gradient(circle at 30% 30%, ${role.color}38, ${role.color}12 70%)`,
        border: `1.5px solid ${role.color}80`,
        boxShadow: `0 4px 16px ${role.color}28, inset 0 0 12px ${role.color}22`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: role.color,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      <RoleIcon roleId={role.id} size={dimensions.icon} />
    </div>
  );
}

export function CampBadge({ role, size = 'sm' }) {
  if (!role) return null;
  const campStyles = {
    village: { bg: 'rgba(59, 130, 246, 0.14)', border: 'rgba(59, 130, 246, 0.4)', color: '#60a5fa', Icon: Shield },
    loups: { bg: 'rgba(239, 68, 68, 0.14)', border: 'rgba(239, 68, 68, 0.4)', color: '#f87171', Icon: PawPrint },
    solitaire: { bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 138, 11, 0.4)', color: '#fbbf24', Icon: Sparkles },
    solo: { bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24', Icon: Sparkles },
    neutre: { bg: 'rgba(168, 85, 247, 0.14)', border: 'rgba(168, 85, 247, 0.4)', color: '#c084fc', Icon: HelpCircle },
    ambigu: { bg: 'rgba(168, 85, 247, 0.14)', border: 'rgba(168, 85, 247, 0.4)', color: '#c084fc', Icon: HelpCircle },
  };
  const cfg = campStyles[role.camp] || campStyles.village;
  const Icon = cfg.Icon;
  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: isSmall ? '0.22rem 0.65rem' : '0.32rem 0.85rem',
        borderRadius: '2rem',
        fontSize: isSmall ? '0.7rem' : '0.78rem',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={isSmall ? 12 : 14} />
      {role.campLabel}
    </span>
  );
}

export function AutomationBadge({ automation = 'auto', size = 'sm' }) {
  const meta = AUTOMATION_META[automation] || AUTOMATION_META.auto;
  const Icon = automation === 'auto' ? Zap : automation === 'partiel' ? RefreshCw : Mic;
  const isSmall = size === 'sm';

  return (
    <span
      title={meta.desc}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: isSmall ? '0.2rem 0.6rem' : '0.3rem 0.75rem',
        borderRadius: '2rem',
        fontSize: isSmall ? '0.68rem' : '0.75rem',
        fontWeight: 700,
        background: `${meta.color}18`,
        border: `1px solid ${meta.color}50`,
        color: meta.color,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={isSmall ? 11 : 13} />
      {meta.label}
    </span>
  );
}

export function RoleChip({ roleId, roleObj, onSelectRole, count, suffix, size = 'sm', style = {} }) {
  const role = roleObj || getRole(roleId);
  if (!role) return null;
  const isSmall = size === 'sm';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (onSelectRole) onSelectRole(role);
      }}
      className="role-chip-clickable"
      title={`Cliquer pour voir les détails du rôle ${role.name}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? '0.4rem' : '0.5rem',
        padding: isSmall ? '0.28rem 0.65rem' : '0.4rem 0.85rem',
        borderRadius: '0.65rem',
        background: `${role.color}16`,
        border: `1px solid ${role.color}55`,
        color: 'var(--text-color)',
        fontSize: isSmall ? '0.78rem' : '0.88rem',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        ...style,
      }}
    >
      <span style={{ color: role.color, display: ' inline-flex', alignItems: 'center' }}>
        <RoleIcon roleId={role.id} size={isSmall ? 14 : 16} />
      </span>
      <span>{role.name}</span>
      {typeof count === 'number' && (
        <span
          style={{
            background: role.color,
            color: '#fff',
            borderRadius: '1rem',
            padding: '0.05rem 0.42rem',
            fontSize: '0.7rem',
            fontWeight: 800,
          }}
        >
          ×{count}
        </span>
      )}
      {suffix && <span style={{ opacity: 0.8, fontSize: '0.75rem' }}>{suffix}</span>}
      <Info size={12} style={{ opacity: 0.55, marginLeft: '0.1rem' }} />
    </button>
  );
}

export function RoleCardView({ role, onOpenDetails, compact = false }) {
  if (!role) return null;

  return (
    <div
      className="ornate-role-card"
      style={{
        '--role-color': role.color,
        borderColor: role.color,
      }}
    >
      {/* Ambient top glow */}
      <div
        className="ornate-card-glow"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${role.color}55 0%, ${role.color}15 55%, transparent 80%)`,
        }}
      />

      {/* Corner ornaments */}
      <div className="ornate-corner ornate-corner-tl" style={{ borderColor: `${role.color}88` }} />
      <div className="ornate-corner ornate-corner-tr" style={{ borderColor: `${role.color}88` }} />
      <div className="ornate-corner ornate-corner-bl" style={{ borderColor: `${role.color}88` }} />
      <div className="ornate-corner ornate-corner-br" style={{ borderColor: `${role.color}88` }} />

      <div className="ornate-card-inner">
        {/* Top bar: Camp & Timing */}
        <div className="ornate-card-topbar">
          <CampBadge role={role} size="sm" />
          {role.timing && (
            <span className="ornate-timing-pill">
              <Moon size={11} />
              {role.timing}
            </span>
          )}
        </div>

        {/* Hero Medallion & Title */}
        <div className="ornate-card-hero">
          <RoleMedallion role={role} size={compact ? 'md' : 'lg'} />
          <div className="ornate-card-titles">
            <h2 className="ornate-role-title title-font" style={{ color: role.color }}>
              {role.name}
            </h2>
            <div className="ornate-role-divider" style={{ background: `linear-gradient(90deg, ${role.color}, transparent)` }} />
          </div>
        </div>

        {/* Structured Details */}
        <div className="ornate-card-body">
          {role.objective && (
            <div className="ornate-section ornate-section-objective">
              <div className="ornate-section-header" style={{ color: role.color }}>
                <Target size={13} />
                <span>Objectif</span>
              </div>
              <p>{role.objective}</p>
            </div>
          )}

          <div className="ornate-section ornate-section-power">
            <div className="ornate-section-header" style={{ color: 'var(--text-color)' }}>
              <WandSparkles size={13} style={{ color: role.color }} />
              <span>Pouvoir</span>
            </div>
            <p>{role.power || role.description}</p>
          </div>

          {!compact && role.advice && (
            <div className="ornate-section ornate-section-advice">
              <div className="ornate-section-header" style={{ color: '#fbbf24' }}>
                <Lightbulb size={13} />
                <span>Conseil tactique</span>
              </div>
              <p>{role.advice}</p>
            </div>
          )}
        </div>

        {/* Footer button to open detailed modal */}
        {onOpenDetails && (
          <div className="ornate-card-footer">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails(role);
              }}
              className="ornate-detail-btn"
              style={{
                borderColor: 'var(--card-border, rgba(255, 255, 255, 0.18))',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--text-color, #f8fafc)',
              }}
            >
              <Info size={14} style={{ color: 'var(--text-muted, #94a3b8)' }} />
              <span>Fiche détaillée du rôle</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RoleDetailsModal({ role, onClose, showMjScript = true }) {
  if (!role) return null;
  const autoMeta = AUTOMATION_META[role.automation || 'auto'] || AUTOMATION_META.auto;

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 350 }}
      onClick={onClose}
    >
      <div
        className="modal-content glass-panel role-details-modal"
        style={{
          maxWidth: '540px',
          width: '100%',
          padding: '1.75rem',
          textAlign: 'left',
          border: `2px solid ${role.color}`,
          boxShadow: `0 25px 60px rgba(0,0,0,0.55), 0 0 35px ${role.color}33`,
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="close-btn" title="Fermer">
          <X size={20} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem', marginBottom: '1.25rem', paddingRight: '2rem' }}>
          <RoleMedallion role={role} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.45rem' }}>
              <CampBadge role={role} size="sm" />
              <AutomationBadge automation={role.automation} size="sm" />
            </div>
            <h2
              className="title-font"
              style={{
                color: role.color,
                fontSize: '1.55rem',
                fontWeight: 900,
                lineHeight: 1.15,
                margin: 0,
              }}
            >
              {role.name}
            </h2>
            {role.timing && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontWeight: 600 }}>
                <Moon size={13} style={{ color: role.color }} />
                <span>Activation : {role.timing}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Objective */}
          <div
            style={{
              padding: '0.9rem 1rem',
              borderRadius: '0.85rem',
              background: `${role.color}15`,
              border: `1px solid ${role.color}45`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: role.color, marginBottom: '0.3rem' }}>
              <Target size={15} />
              <span>Objectif de victoire</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-color)', lineHeight: 1.45 }}>
              {role.objective}
            </p>
          </div>

          {/* Power */}
          <div
            style={{
              padding: '1rem',
              borderRadius: '0.85rem',
              background: 'var(--input-bg)',
              border: '1px solid var(--card-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-color)', marginBottom: '0.35rem' }}>
              <WandSparkles size={15} style={{ color: role.color }} />
              <span>Pouvoir & Règles</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-color)', lineHeight: 1.55 }}>
              {role.power || role.description}
            </p>
          </div>

          {/* Strategic Advice */}
          {role.advice && (
            <div
              style={{
                padding: '0.9rem 1rem',
                borderRadius: '0.85rem',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#f59e0b', marginBottom: '0.3rem' }}>
                <Lightbulb size={15} />
                <span>Conseil Stratégique</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {role.advice}
              </p>
            </div>
          )}

          {/* Automation / Remote play info */}
          <div
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '0.85rem',
              background: `${autoMeta.color}10`,
              border: `1px solid ${autoMeta.color}35`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: autoMeta.color, marginBottom: '0.25rem' }}>
              <Zap size={14} />
              <span>Mode de jeu : {autoMeta.label}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              {autoMeta.desc}
            </p>
          </div>

          {/* MJ Script for Physical / Eyes-Closed Games */}
          {showMjScript && role.mjScript && (
            <div
              style={{
                padding: '0.9rem 1rem',
                borderRadius: '0.85rem',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#a78bfa', marginBottom: '0.3rem' }}>
                <Mic size={15} />
                <span>Consigne MJ (Partie yeux fermés)</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-color)', lineHeight: 1.45, fontStyle: 'italic' }}>
                « {role.mjScript} »
              </p>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="btn-primary title-font"
          style={{ marginTop: '1.25rem', padding: '0.85rem', fontSize: '0.95rem' }}
        >
          Fermer la fiche
        </button>
      </div>
    </div>
  );
}

export function GrimoireModal({ isOpen, onClose, activeRoleIds = [], onSelectRole, hideActiveRoles = false }) {
  const [search, setSearch] = useState('');
  const [campFilter, setCampFilter] = useState('tous');

  if (!isOpen) return null;

  const uniqueActiveSet = hideActiveRoles ? new Set() : new Set(activeRoleIds);

  const filteredRoles = ROLES_DATA.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.power?.toLowerCase().includes(search.toLowerCase()) ||
      r.mjScript?.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (campFilter === 'en_jeu') return uniqueActiveSet.has(r.id);
    if (campFilter === 'solitaire') return r.camp === 'solitaire' || r.camp === 'solo';
    if (campFilter === 'neutre') return r.camp === 'neutre' || r.camp === 'ambigu';
    if (campFilter !== 'tous') return r.camp === campFilter;
    return true;
  });

  const filterTabs = [
    { id: 'tous', label: `Tous (${ROLES_DATA.length})` },
    ...(uniqueActiveSet.size > 0 ? [{ id: 'en_jeu', label: `En jeu (${uniqueActiveSet.size})` }] : []),
    { id: 'village', label: 'Village' },
    { id: 'loups', label: 'Loups' },
    { id: 'solitaire', label: 'Solitaires' },
    { id: 'neutre', label: 'Évolutifs' },
  ];

  return (
    <div className="modal-overlay" style={{ zIndex: 250 }} onClick={onClose}>
      <div
        className="modal-content glass-panel"
        style={{
          maxWidth: '960px',
          width: '100%',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.75rem',
          textAlign: 'left',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="close-btn">
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.35rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '0.8rem',
              background: 'rgba(139, 92, 246, 0.15)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
            }}
          >
            <BookOpen size={22} />
          </div>
          <div>
            <h2 className="title-font" style={{ fontSize: '1.5rem', margin: 0 }}>
              Grimoire des Rôles
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Cliquez sur n'importe quel rôle pour ouvrir sa carte complète et son script d'appel.
            </p>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: '1 1 240px', position: 'relative' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '0.85rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Rechercher un rôle, un pouvoir..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem 0.65rem 2.4rem',
                borderRadius: '0.65rem',
                border: '1px solid var(--card-border)',
                background: 'var(--input-bg)',
                color: 'var(--text-color)',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCampFilter(tab.id)}
                style={{
                  padding: '0.5rem 0.85rem',
                  borderRadius: '0.6rem',
                  border: campFilter === tab.id ? '1px solid var(--primary)' : '1px solid var(--card-border)',
                  background: campFilter === tab.id ? 'var(--primary)' : 'var(--input-bg)',
                  color: campFilter === tab.id ? '#fff' : 'var(--text-color)',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid of Roles */}
        <div
          style={{
            overflowY: 'auto',
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))',
            gap: '0.9rem',
            paddingRight: '0.25rem',
          }}
        >
          {filteredRoles.map((role) => {
            const isInGame = uniqueActiveSet.has(role.id);
            return (
              <div
                key={role.id}
                onClick={() => onSelectRole && onSelectRole(role)}
                className="grimoire-role-card"
                style={{
                  padding: '1rem',
                  borderRadius: '0.95rem',
                  background: 'var(--input-bg)',
                  border: `1.5px solid ${isInGame ? role.color : 'var(--card-border)'}`,
                   borderLeft: `5px solid ${role.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.55rem',
                  cursor: 'pointer',
                  transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                    <RoleMedallion role={role} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div className="title-font" style={{ fontWeight: 800, fontSize: '1rem', color: role.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {role.name}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {role.timing || 'Passif'}
                      </div>
                    </div>
                  </div>
                  <CampBadge role={role} size="sm" />
                </div>

                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-color)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {role.power}
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '0.35rem' }}>
                  <AutomationBadge automation={role.automation} size="sm" />
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: role.color, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Info size={13} /> Détails
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
