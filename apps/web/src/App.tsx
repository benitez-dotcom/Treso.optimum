import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import frFR from 'antd/locale/fr_FR';
import { antdTheme } from './theme/antdTheme';
import { useStore } from './store/useStore';
import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { PlanPage } from './pages/PlanPage';
import { InboxPage } from './pages/InboxPage';
import { ComingSoon } from './pages/ComingSoon';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'a-traiter', element: <InboxPage /> },
      { path: 'plan', element: <PlanPage /> },
      { path: '*', element: <ComingSoon /> },
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
  return (
    <ConfigProvider locale={frFR} theme={antdTheme(dark)}>
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}
