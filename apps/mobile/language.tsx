import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  detectLanguage,
  translate,
  translateError,
  type Language,
  type TranslationValues,
} from "../../shared/i18n";
import { setNativeCallLanguage } from "./native-call-service";

const LANGUAGE_STORAGE_KEY = "rinnalla.language.v1";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: TranslationValues) => string;
  tError: (error: unknown, fallback: string) => string;
};

const defaultLanguage = detectLanguage(
  Intl.DateTimeFormat().resolvedOptions().locale,
);
setNativeCallLanguage(defaultLanguage);

const LanguageContext = createContext<LanguageContextValue>({
  language: defaultLanguage,
  setLanguage: () => undefined,
  t: (key, values) => translate(defaultLanguage, key, values),
  tError: (error, fallback) => translateError(defaultLanguage, error, fallback),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === "en" || stored === "fi")) {
          setLanguageState(stored);
          setNativeCallLanguage(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    setNativeCallLanguage(nextLanguage);
    void SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, nextLanguage)
      .catch(() => undefined);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, values) => translate(language, key, values),
    tError: (error, fallback) => translateError(language, error, fallback),
  }), [language, setLanguage]);

  if (!ready) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
