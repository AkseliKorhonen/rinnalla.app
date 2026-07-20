import type { Language } from "../../shared/i18n";

const LANGUAGE_LOCALES: Record<Language, string> = {
  en: "en",
  fi: "fi",
};

function capitalizeFirst(value: string, locale: string) {
  if (value.length === 0) return value;
  return value[0].toLocaleUpperCase(locale) + value.slice(1);
}

export function formatSeniorDateTime(
  value: Date,
  language: Language,
  timeZone?: string,
) {
  const locale = LANGUAGE_LOCALES[language];
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
  }).format(value);

  return {
    date: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      timeZone,
      year: "numeric",
    }).format(value),
    time: new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(value),
    weekday: capitalizeFirst(weekday, locale),
  };
}
