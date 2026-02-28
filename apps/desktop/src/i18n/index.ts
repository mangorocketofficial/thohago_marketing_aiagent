import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      ko: { translation: ko },
      en: { translation: en }
    },
    lng: "ko",
    fallbackLng: "ko",
    interpolation: {
      escapeValue: false
    }
  });
}

export default i18n;
