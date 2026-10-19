/** ISO 639-1 codes with the other spellings people and tools use for them (639-2/B, 639-2/T, English names, common abuse). */
const LANGUAGES: Record<string, string[]> = {
  en: ['eng', 'english', 'en-us', 'en-gb'],
  el: ['ell', 'gre', 'greek', 'gr', 'ελληνικά', 'el-gr'],
  fr: ['fra', 'fre', 'french'],
  de: ['deu', 'ger', 'german'],
  es: ['spa', 'spanish', 'es-es', 'es-la'],
  it: ['ita', 'italian'],
  pt: ['por', 'portuguese', 'pt-br', 'pt-pt', 'pob'],
  ru: ['rus', 'russian'],
  tr: ['tur', 'turkish'],
  ar: ['ara', 'arabic'],
  he: ['heb', 'hebrew'],
  nl: ['nld', 'dut', 'dutch'],
  sv: ['swe', 'swedish'],
  no: ['nor', 'nob', 'norwegian'],
  da: ['dan', 'danish'],
  fi: ['fin', 'finnish'],
  pl: ['pol', 'polish'],
  cs: ['ces', 'cze', 'czech'],
  hu: ['hun', 'hungarian'],
  ro: ['ron', 'rum', 'romanian'],
  bg: ['bul', 'bulgarian'],
  sr: ['srp', 'serbian'],
  hr: ['hrv', 'croatian'],
  uk: ['ukr', 'ukrainian'],
  ja: ['jpn', 'japanese'],
  ko: ['kor', 'korean'],
  zh: ['zho', 'chi', 'chinese', 'zh-cn', 'zh-tw', 'chs', 'cht'],
  hi: ['hin', 'hindi'],
  th: ['tha', 'thai'],
  id: ['ind', 'indonesian'],
  vi: ['vie', 'vietnamese'],
  fa: ['fas', 'per', 'persian'],
}

/** Languages offered in the settings, in the order shown. */
export const KNOWN_LANGUAGES: string[] = Object.keys(LANGUAGES)

const LOOKUP = new Map<string, string>()
for (const [code, others] of Object.entries(LANGUAGES)) {
  LOOKUP.set(code, code)
  for (const o of others) LOOKUP.set(o, code)
}

/** The ISO 639-1 code for a language tag or name, or null if it is not one we know. */
export function toLanguageCode(tag: string | null | undefined): string | null {
  if (!tag) return null
  return LOOKUP.get(tag.trim().toLowerCase()) ?? null
}

/** A tag from the file itself: a known language becomes its 2-letter code, anything else is kept as written (or null). */
export function normaliseLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null
  const t = tag.trim().toLowerCase()
  if (!t || t === 'und' || t === 'unk' || t === 'mis' || t === 'mul') return null
  return LOOKUP.get(t) ?? (t.length <= 8 ? t : null)
}
