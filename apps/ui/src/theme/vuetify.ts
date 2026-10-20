import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'

// Warm charcoal + muted bronze, see docs/06-design-system.md for the rationale.
const theamaDark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0F0E0C',
    surface: '#171510',
    'surface-bright': '#26221A',
    'surface-light': '#1F1C16',
    'surface-variant': '#2A261E',
    'on-background': '#EFE8DA',
    'on-surface': '#EFE8DA',
    'on-surface-variant': '#B9AF9C',
    primary: '#C9A66B',
    'on-primary': '#17120A',
    secondary: '#8F7A56',
    'on-secondary': '#EFE8DA',
    error: '#E0806F',
    warning: '#DCA94E',
    success: '#93B47E',
    info: '#82A5BD',
    hairline: '#3A352A',
  },
}

const theamaLight: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F6F1E7',
    surface: '#FCF9F2',
    'surface-bright': '#FFFFFF',
    'surface-light': '#F0EADB',
    'surface-variant': '#E6DEC9',
    'on-background': '#1C1A16',
    'on-surface': '#1C1A16',
    'on-surface-variant': '#5B5446',
    primary: '#85653A',
    'on-primary': '#FFFFFF',
    secondary: '#6F6247',
    'on-secondary': '#FFFFFF',
    error: '#B3412F',
    warning: '#855A0C',
    success: '#4F7340',
    info: '#3F6783',
    hairline: '#D6CCB4',
  },
  // Vuetify's default 60 % for labels and hints is about 3.5:1 on this warm paper colour; 72 % clears 4.5:1 (WCAG AA).
  variables: { 'medium-emphasis-opacity': 0.72 },
}

export const THEME_DARK = 'theamaDark'
export const THEME_LIGHT = 'theamaLight'

export const vuetify = createVuetify({
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: THEME_DARK,
    themes: { [THEME_DARK]: theamaDark, [THEME_LIGHT]: theamaLight },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'lg', class: 'text-none' },
    VCard: { rounded: 'lg', elevation: 0 },
    VChip: { rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
  },
})
