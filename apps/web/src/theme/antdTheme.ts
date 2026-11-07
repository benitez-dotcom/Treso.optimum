import { theme, type ThemeConfig } from 'antd';

/** Thème Ant Design aligné sur les tokens Optimum. */
export function antdTheme(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#2B8A9F' : '#114C5C',
      colorLink: dark ? '#84ADB7' : '#114C5C',
      colorSuccess: dark ? '#4CBF93' : '#1E7A5A',
      colorError: dark ? '#F97066' : '#B42318',
      colorWarning: dark ? '#F5A05A' : '#B54708',
      colorText: dark ? '#F2F2F1' : '#303031',
      colorBorder: dark ? '#2A3A3F' : '#E5E4E4',
      colorBgLayout: dark ? '#0E1A1E' : '#F6F6F5',
      colorBgContainer: dark ? '#14262B' : '#FFFFFF',
      borderRadius: 8,
      borderRadiusLG: 12,
      fontFamily: "'Raleway', system-ui, sans-serif",
      fontSize: 14,
    },
    components: {
      Button: { fontWeight: 700, controlHeight: 40 },
      Segmented: { itemSelectedColor: dark ? '#84ADB7' : '#114C5C' },
      Tabs: { titleFontSize: 14 },
      DatePicker: { cellActiveWithRangeBg: dark ? '#17323a' : '#eef3f4', cellHoverWithRangeBg: dark ? '#1f414a' : '#dde8eb' },
    },
  };
}
