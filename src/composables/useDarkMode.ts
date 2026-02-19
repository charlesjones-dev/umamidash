import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'umamidash-dark-mode'

function getInitialValue(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored !== null) return stored === 'true'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const isDark = ref(getInitialValue())

export function useDarkMode() {
  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value)
    localStorage.setItem(STORAGE_KEY, String(isDark.value))
  })

  function toggle() {
    isDark.value = !isDark.value
  }

  return { isDark, toggle }
}
