import { ref, watchEffect } from 'vue'
import { THEMES } from '@/lib/themes'

const DARK_KEY = 'umamidash-dark-mode'
const THEME_KEY = 'umamidash-theme'

// All CSS var names that any theme might set (used for cleanup)
const ALL_VARS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover',
  'popover-foreground', 'primary', 'primary-foreground', 'secondary',
  'secondary-foreground', 'muted', 'muted-foreground', 'accent',
  'accent-foreground', 'destructive', 'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
  'sidebar', 'sidebar-foreground', 'sidebar-primary',
  'sidebar-primary-foreground', 'sidebar-accent',
  'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
]

function getInitialDark(): boolean {
  const stored = localStorage.getItem(DARK_KEY)
  if (stored !== null) return stored === 'true'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function getInitialTheme(): string {
  return localStorage.getItem(THEME_KEY) ?? 'neutral'
}

const isDark = ref(getInitialDark())
const themeName = ref(getInitialTheme())

function applyTheme() {
  const el = document.documentElement

  // Clear all inline CSS var overrides
  for (const v of ALL_VARS) {
    el.style.removeProperty(`--${v}`)
  }

  // Toggle dark class
  el.classList.toggle('dark', isDark.value)

  // Find the selected theme
  const theme = THEMES.find((t) => t.name === themeName.value)
  if (!theme) return

  // Apply the mode-specific vars as inline styles
  const vars = isDark.value ? theme.cssVars.dark : theme.cssVars.light
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(`--${key}`, value)
  }
}

export function useTheme() {
  watchEffect(() => {
    // Access reactive refs to trigger on change
    isDark.value
    themeName.value
    applyTheme()
    localStorage.setItem(DARK_KEY, String(isDark.value))
    localStorage.setItem(THEME_KEY, themeName.value)
  })

  function toggleDark() {
    isDark.value = !isDark.value
  }

  function setTheme(name: string) {
    themeName.value = name
  }

  return {
    isDark,
    themeName,
    themes: THEMES,
    toggleDark,
    setTheme,
  }
}
