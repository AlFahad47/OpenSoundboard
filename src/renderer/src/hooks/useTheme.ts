import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'

/**
 * Applies the theme as a `data-theme` attribute on <html>. Every colour in the
 * stylesheet resolves from custom properties, so this is the only place the
 * app needs to know a theme exists — no component re-renders on a switch.
 */
export function useTheme(mode: ThemeMode, accent: string): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: 'dark' | 'light' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])

  return resolved
}

/** Reads a resolved CSS custom property, for canvas drawing. */
export function cssVar(name: string, fallback = '#888'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Canvas painting cannot participate in CSS cascade, so anything drawn with
 * cssVar needs an explicit signal to repaint when the theme flips.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((n) => n + 1))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style']
    })
    return () => observer.disconnect()
  }, [])

  return version
}
