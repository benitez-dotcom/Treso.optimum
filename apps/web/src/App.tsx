import { useEffect, useState } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import frFR from 'antd/locale/fr_FR';
import { antdTheme } from './theme/antdTheme';
import { setErrorNotifier, useStore } from './store/useStore';
import { useSession } from './api/session';
import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { PlanPage } from './pages/PlanPage';
import { InboxPage } from './pages/InboxPage';
import { ComingSoon } from './pages/ComingSoon';
import { SettingsPage } from './pages/SettingsPage';
import { OperationsPage } from './pages/OperationsPage';
import { BankCallbackPage } from './pages/settings/BanksTab';
import { CompaniesPage } from './pages/CompaniesPage';
import { GuestOnly, RequireAuth, RequireCompany } from './auth/Guards';
import { ForgotPasswordPage, InvitationPage, LoginPage, MagicLinkPage, ResetPasswordPage, SignupPage, VerifyEmailPage } from './auth/AuthPages';
import { OnboardingPage } from './auth/OnboardingPage';

/** Relie les erreurs de synchronisation du store aux messages Ant Design. */
function ErrorBridge() {
  const { message } = AntApp.useApp();
  useEffect(() => setErrorNotifier((m) => message.error(m)), [message]);
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <ErrorBridge />,
    children: [
      { path: '/connexion', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: '/connexion/lien', element: <MagicLinkPage /> },
      { path: '/inscription', element: <GuestOnly><SignupPage /></GuestOnly> },
      { path: '/verification-email', element: <VerifyEmailPage /> },
      { path: '/mot-de-passe-oublie', element: <GuestOnly><ForgotPasswordPage /></GuestOnly> },
      { path: '/reinitialiser', element: <ResetPasswordPage /> },
      { path: '/invitation', element: <InvitationPage /> },
      { path: '/bienvenue', element: <RequireAuth><OnboardingPage /></RequireAuth> },
      {
        path: '/',
        element: (
          <RequireAuth>
            <RequireCompany>
              <AppLayout />
            </RequireCompany>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HomePage /> },
          { path: 'a-traiter', element: <InboxPage /> },
          { path: 'plan', element: <PlanPage /> },
          { path: 'operations', element: <OperationsPage /> },
          { path: 'parametres', element: <SettingsPage /> },
          { path: 'parametres/banques/retour', element: <BankCallbackPage /> },
          { path: 'societes', element: <CompaniesPage /> },
          { path: '*', element: <ComingSoon /> },
        ],
      },
    ],
  },
]);

function useDarkMode(): boolean {
  const pref = useStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return dark;
}

export function App() {
  const dark = useDarkMode();
  const init = useSession((s) => s.init);
  const meTheme = useSession((s) => s.me?.theme);
  useEffect(() => {
    void init();
  }, [init]);
  // Le thème enregistré dans le profil suit l'utilisateur d'un appareil à l'autre
  useEffect(() => {
    if (meTheme) useStore.setState({ theme: meTheme });
  }, [meTheme]);
  return (
    <ConfigProvider locale={frFR} theme={antdTheme(dark)}>
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}
