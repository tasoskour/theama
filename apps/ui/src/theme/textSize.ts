import type { TextSize } from '@theama/contracts'

export const TEXT_SIZE_SCALE: Record<TextSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.15,
  'extra-large': 1.3,
}

export function applyTextSize(size: TextSize): void {
  document.documentElement.style.setProperty('--th-text-scale', String(TEXT_SIZE_SCALE[size]))
}
