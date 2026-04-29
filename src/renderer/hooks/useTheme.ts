import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ThemeFile, Page, Item } from '../../shared/types'
import { CANVAS_W, CANVAS_H, GRID_COLS, GRID_ROWS } from '../../shared/types'

export interface ThemeState {
  theme: ThemeFile | null
  filePath: string | null
  assets: Record<string, string>  // devicePath → base64 raw data
  dirty: boolean
  currentPageId: string | null
}

function blankPage(name = 'New Page'): Page {
  return {
    id: uuidv4(),
    pageName: name,
    canvas: { canvas_w: CANVAS_W, canvas_h: CANVAS_H, canvas_flip: true, canvas_rotate: false },
    items: []
  }
}

function blankTheme(): ThemeFile {
  const page = blankPage('Page 1')
  return {
    main: { currentPage: page.pageName, version: 'V3.0' },
    pages: [page]
  }
}

export function useTheme() {
  const [state, setState] = useState<ThemeState>({
    theme: null,
    filePath: null,
    assets: {},
    dirty: false,
    currentPageId: null
  })

  const newTheme = useCallback(() => {
    const theme = blankTheme()
    setState({
      theme,
      filePath: null,
      assets: {},
      dirty: false,
      currentPageId: theme.pages[0].id
    })
  }, [])

  const loadTheme = useCallback(async () => {
    const result = await (window as any).sk18.openTheme()
    if (!result) return
    setState({
      theme: result.theme,
      filePath: result.filePath,
      assets: result.assets || {},
      dirty: false,
      currentPageId: result.theme.main.currentPage || result.theme.pages[0]?.id || null
    })
  }, [])

  const saveTheme = useCallback(async (st: ThemeState) => {
    if (!st.theme) return
    if (st.filePath) {
      await (window as any).sk18.saveTheme(st.filePath, st.theme, st.assets)
      setState(prev => ({ ...prev, dirty: false }))
    } else {
      const result = await (window as any).sk18.saveThemeAs(st.theme, st.assets)
      if (result?.filePath) {
        setState(prev => ({ ...prev, filePath: result.filePath, dirty: false }))
      }
    }
  }, [])

  const saveThemeAs = useCallback(async (st: ThemeState) => {
    if (!st.theme) return
    const result = await (window as any).sk18.saveThemeAs(st.theme, st.assets)
    if (result?.filePath) {
      setState(prev => ({ ...prev, filePath: result.filePath, dirty: false }))
    }
  }, [])

  const updateTheme = useCallback((updater: (t: ThemeFile) => ThemeFile) => {
    setState(prev => {
      if (!prev.theme) return prev
      return { ...prev, theme: updater(prev.theme), dirty: true }
    })
  }, [])

  const addPage = useCallback(() => {
    const page = blankPage()
    setState(prev => {
      if (!prev.theme) return prev
      const theme = {
        ...prev.theme,
        pages: [...prev.theme.pages, page]
      }
      return { ...prev, theme, dirty: true, currentPageId: page.id }
    })
  }, [])

  const deletePage = useCallback((pageId: string) => {
    setState(prev => {
      if (!prev.theme) return prev
      const pages = prev.theme.pages.filter(p => p.id !== pageId)
      if (pages.length === 0) return prev
      const nextId = pages.find(p => p.id !== pageId)?.id || pages[0].id
      const theme = { ...prev.theme, pages }
      return { ...prev, theme, dirty: true, currentPageId: nextId }
    })
  }, [])

  const renamePage = useCallback((pageId: string, name: string) => {
    setState(prev => {
      if (!prev.theme) return prev
      const theme = {
        ...prev.theme,
        pages: prev.theme.pages.map(p => p.id === pageId ? { ...p, pageName: name } : p)
      }
      return { ...prev, theme, dirty: true }
    })
  }, [])

  const setCurrentPage = useCallback((pageId: string) => {
    setState(prev => ({ ...prev, currentPageId: pageId }))
  }, [])

  const updatePage = useCallback((pageId: string, updater: (p: Page) => Page) => {
    setState(prev => {
      if (!prev.theme) return prev
      const theme = {
        ...prev.theme,
        pages: prev.theme.pages.map(p => p.id === pageId ? updater(p) : p)
      }
      return { ...prev, theme, dirty: true }
    })
  }, [])

  const upsertItem = useCallback((pageId: string, item: Item) => {
    setState(prev => {
      if (!prev.theme) return prev
      const theme = {
        ...prev.theme,
        pages: prev.theme.pages.map(p => {
          if (p.id !== pageId) return p
          const exists = p.items.some(i => i.id === item.id)
          const items = exists
            ? p.items.map(i => i.id === item.id ? item : i)
            : [...p.items, item]
          return { ...p, items }
        })
      }
      return { ...prev, theme, dirty: true }
    })
  }, [])

  const addAsset = useCallback((devicePath: string, dataB64: string) => {
    setState(prev => ({ ...prev, assets: { ...prev.assets, [devicePath]: dataB64 }, dirty: true }))
  }, [])

  const deleteItem = useCallback((pageId: string, itemId: string) => {
    setState(prev => {
      if (!prev.theme) return prev
      const theme = {
        ...prev.theme,
        pages: prev.theme.pages.map(p =>
          p.id !== pageId ? p : { ...p, items: p.items.filter(i => i.id !== itemId) }
        )
      }
      return { ...prev, theme, dirty: true }
    })
  }, [])

  return {
    state,
    newTheme,
    loadTheme,
    saveTheme: () => saveTheme(state),
    saveThemeAs: () => saveThemeAs(state),
    updateTheme,
    addPage,
    deletePage,
    renamePage,
    setCurrentPage,
    updatePage,
    upsertItem,
    deleteItem,
    addAsset
  }
}
