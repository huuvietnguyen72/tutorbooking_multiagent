import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import vi from './vi.json';

void i18n.use(initReactI18next).init({
  lng: 'vi',
  fallbackLng: 'vi',
  resources: {
    vi: { translation: vi },
  },
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
