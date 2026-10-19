import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LibraryType } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useLibraryStore } from '@/stores/library'

export interface AddFolderFlow {
  open: Ref<boolean>
  path: Ref<string>
  type: Ref<LibraryType>
  recursive: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string | null>
  /** True when a native folder picker is available (desktop app). */
  canBrowse: boolean
  begin(): Promise<void>
  browse(): Promise<void>
  submit(): Promise<boolean>
}

/**
 * The "add a media folder" flow shared by the empty states and Settings → Library:
 * native folder picker (desktop) → confirm type and subfolders → POST to the service.
 * In a plain browser there is no picker, so the path is typed.
 */
export function useAddFolder(defaultType: () => LibraryType = () => 'auto'): AddFolderFlow {
  const { t, te } = useI18n()
  const library = useLibraryStore()
  const bridge = getBridge()
  const open = ref(false)
  const path = ref('')
  const type = ref<LibraryType>('auto')
  const recursive = ref(true)
  const busy = ref(false)
  const error = ref<string | null>(null)

  async function browse(): Promise<void> {
    const picked = await bridge?.pickFolder()
    if (picked) path.value = picked
  }

  async function begin(): Promise<void> {
    error.value = null
    type.value = defaultType()
    recursive.value = true
    path.value = ''
    if (bridge) {
      const picked = await bridge.pickFolder()
      if (!picked) return
      path.value = picked
    }
    open.value = true
  }

  async function submit(): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      const result = await library.add(path.value, type.value, recursive.value)
      if (result.ok) {
        open.value = false
        return true
      }
      const key = `library.errors.${result.code}`
      error.value = te(key) ? t(key) : result.message
      return false
    } finally {
      busy.value = false
    }
  }

  return { open, path, type, recursive, busy, error, canBrowse: bridge !== null, begin, browse, submit }
}
