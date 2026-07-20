"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  detectLanguage,
  translate,
  translateError,
  type Language,
  type TranslationValues,
} from "../../../../shared/i18n";

const LANGUAGE_STORAGE_KEY = "rinnalla.language.v1";
const LANGUAGE_CHANGE_EVENT = "rinnalla-language-change";
let sessionLanguage: Language | null = null;

function getBrowserLanguage(): Language {
  if (sessionLanguage) return sessionLanguage;
  let language = detectLanguage(window.navigator.language);
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "fi") language = stored;
  } catch {
    // Browser language remains the fallback when storage is unavailable.
  }
  return language;
}

function subscribeToLanguage(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    sessionLanguage = event.newValue === "en" || event.newValue === "fi"
      ? event.newValue
      : null;
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  };
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: TranslationValues) => string;
  tError: (error: unknown, fallback: string) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: (key, values) => translate("en", key, values),
  tError: (error, fallback) => translateError("en", error, fallback),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore<Language>(
    subscribeToLanguage,
    getBrowserLanguage,
    (): Language => "en",
  );

  useEffect(() => {
    document.documentElement.lang = language;
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute(
        "content",
        translate(language, "Stay connected with the people alongside you."),
      );
  }, [language]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    sessionLanguage = nextLanguage;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The in-memory choice still applies for this session.
    }
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, values) => translate(language, key, values),
    tError: (error, fallback) => translateError(language, error, fallback),
  }), [language, setLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
