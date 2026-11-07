import { useMemo, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Dropdown, Input, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  AuditOutlined,
  CalendarOutlined,
  FileTextOutlined,
  FundOutlined,
  HomeOutlined,
  InboxOutlined,
  PercentageOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useStore, type ThemePref } from '../store/useStore';
import { AlertsBell } from './AlertsBell';
import { useSession } from '../api/session';
import { useInbox } from '../store/selectors';
import { DecisionDot, Logo } from './Brand';
import './layout.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
}

const titles: Record<string, string> = {
  '/': 'Accueil',
  '/a-traiter': 'À traiter',
  '/plan': 'Plan de trésorerie',
  '/indicateurs': 'Indicateurs',
  '/analyses': 'Analyses',
  '/precompta': 'Pré-comptabilité',
  '/factures/clients': 'Factures clients',
  '/factures/fournisseurs': 'Factures fournisseurs',
  '/journalier': 'Au jour le jour',
  '/operations': 'Opérations bancaires',
  '/parametres': 'Paramètres',
  '/societes': 'Mes sociétés',
};

const planLabels: Record<string, string> = {
  DISCOVERY: 'Découverte',
  ESSENTIAL: 'Essentiel',
  PERFORMANCE: 'Performance',
  GROUP: 'Groupe',
  FIRM: 'Cabinet',
  DEMO: 'Démonstration',
};

export function AppLayout() {
  const companyName = useStore((s) => s.companyName);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const company = useStore((s) => s.company);
  const clearStore = useStore((s) => s.clear);
  const me = useSession((s) => s.me);
  const switchCompany = useSession((s) => s.switchCompany);
  const logout = useSession((s) => s.logout);
  const navigate = useNavigate();
  const myRole = me?.companies.find((c) => c.id === me.activeCompanyId)?.roleLabel ?? '';
  const initials = `${me?.firstName?.[0] ?? ''}${me?.lastName?.[0] ?? ''}`.toUpperCase() || '·';
  const commitments = useStore((s) => s.commitments);
  const today = useStore((s) => s.today);
  const inbox = useInbox();
  const { pathname } = useLocation();

  const inboxCount = useMemo(
    () => inbox.reduce((n, i) => n + (i.kind === 'group' ? i.transactions.length : 1), 0),
    [inbox],
  );
  const overdueCount = commitments.filter((c) => c.flow === 'in' && c.status === 'pending' && c.dueAt < today).length;

  const sections: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { to: '/', label: 'Accueil', icon: <HomeOutlined /> },
        {
          to: '/a-traiter',
          label: 'À traiter',
          icon: <InboxOutlined />,
          badge: inboxCount > 0 && (
            <span className="nav-count" aria-label={`${inboxCount} éléments`}>
              <DecisionDot />
              {inboxCount}
            </span>
          ),
        },
      ],
    },
    {
      title: 'Trésorerie',
      items: [
        { to: '/plan', label: 'Plan de trésorerie', icon: <FundOutlined /> },
        { to: '/journalier', label: 'Au jour le jour', icon: <CalendarOutlined /> },
        { to: '/operations', label: 'Opérations bancaires', icon: <UnorderedListOutlined /> },
      ],
    },
    {
      title: 'Engagements',
      items: [
        {
          to: '/factures/clients',
          label: 'Factures clients',
          icon: <FileTextOutlined />,
          badge: overdueCount > 0 && <span className="nav-pill">{overdueCount}</span>,
        },
        { to: '/factures/fournisseurs', label: 'Factures fournisseurs', icon: <FileTextOutlined /> },
        { to: '/precompta', label: 'Pré-comptabilité', icon: <AuditOutlined /> },
      ],
    },
    {
      title: 'Analyse',
      items: [
        { to: '/analyses', label: 'Analyses', icon: <BarChartOutlined /> },
        { to: '/indicateurs', label: 'Indicateurs', icon: <PercentageOutlined /> },
      ],
    },
  ];

  const themeItems: { key: ThemePref; label: string }[] = [
    { key: 'system', label: 'Thème : automatique' },
    { key: 'light', label: 'Thème : clair' },
    { key: 'dark', label: 'Thème : sombre' },
  ];

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Navigation principale">
        <NavLink to="/" className="sidebar-logo" aria-label="Accueil Tréso Optimum">
          <Logo />
        </NavLink>

        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              ...(me?.companies ?? []).map((c) => ({ key: c.id, label: `${c.id === me?.activeCompanyId ? '✓ ' : ''}${c.name}` })),
              { type: 'divider' as const },
              { key: '__all', label: 'Toutes mes sociétés' },
              { key: '__new', label: 'Ajouter une société' },
            ],
            onClick: async ({ key }) => {
              if (key === '__all') return navigate('/societes');
              if (key === '__new') return navigate('/bienvenue');
              if (key === me?.activeCompanyId) return;
              clearStore();
              await switchCompany(key);
              navigate('/');
            },
          }}
        >
          <button className="company-switch" type="button" aria-label="Changer de société">
            <span>
              <strong>{companyName}</strong>
              <span className="company-plan">{company?.isDemo ? 'Données de démonstration' : `Offre ${planLabels[company?.plan ?? ''] ?? company?.plan ?? ''}`}</span>
            </span>
            <AppstoreOutlined aria-hidden="true" />
          </button>
        </Dropdown>

        <div className="nav-groups">
          {sections.map((section, i) => (
            <div key={i} className="nav-group">
              {section.title && <div className="nav-title">{section.title}</div>}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.badge}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="nav-bottom">
          <NavLink to="/conseiller" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true"><UserOutlined /></span>
            <span className="nav-label">Mon conseiller Optimum</span>
          </NavLink>
          <NavLink to="/parametres" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true"><SettingOutlined /></span>
            <span className="nav-label">Paramètres</span>
          </NavLink>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'profile', label: 'Mon profil' },
                { type: 'divider' as const },
                ...themeItems.map((t) => ({ key: t.key, label: `${t.key === theme ? '✓ ' : ''}${t.label}` })),
                { type: 'divider' as const },
                { key: 'logout', label: 'Se déconnecter' },
              ],
              onClick: async ({ key }) => {
                if (key === 'profile') return navigate('/parametres?onglet=profil');
                if (key === 'logout') {
                  await logout();
                  clearStore();
                  return navigate('/connexion');
                }
                setTheme(key as ThemePref);
              },
            }}
          >
            <button type="button" className="profile">
              <span className="avatar">{initials}</span>
              <span className="profile-text">
                <strong>{me?.firstName}</strong>
                <span>{myRole}</span>
              </span>
            </button>
          </Dropdown>
        </div>
      </nav>

      <div className="main-col">
        <header className="topbar">
          <h1 className="topbar-title">{titles[pathname] ?? 'Tréso Optimum'}</h1>
          <Input
            className="topbar-search"
            prefix={<SearchOutlined aria-hidden="true" />}
            placeholder="Rechercher ou lancer une action…"
            aria-label="Rechercher ou lancer une action"
            suffix={<kbd className="kbd">⌘ K</kbd>}
          />
          <Tooltip title="Synchroniser maintenant">
            <button type="button" className="sync-status">
              <span className="sync-dot" aria-hidden="true" />
              Synchronisé il y a 12 min
            </button>
          </Tooltip>
          <AlertsBell />
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
