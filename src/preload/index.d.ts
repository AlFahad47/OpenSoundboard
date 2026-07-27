import type { OpenSoundboardApi } from './index'

declare global {
  interface Window {
    soundboard: OpenSoundboardApi
  }
}

export {}
