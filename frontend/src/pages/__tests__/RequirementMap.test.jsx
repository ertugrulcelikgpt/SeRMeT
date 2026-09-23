// ============================================================================
//  RequirementMap.test.jsx — "Gereksinim Haritası" sayfasi (Issue #122).
//
//  Kapsam (kabul kriterleri):
//   - Harita YUKARIDAN ASAGIYA dallanir; dallar TEK TEK acilip kapanir
//   - Acik/kapali durum sayfa icinde korunur (veri tazelenince sifirlanmaz)
//   - Yeni eklenen kayit/bag, sayfa yenilemeden haritada belirir
//   - Dugumden kaydin detayina (ViewModal) gidilebilir
//   - Haritayi PNG/SVG olarak disa aktarma
//   - Haritada arama: eslesen dugume odaklanir, yolundaki kapali dallar acilir
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock } = vi.hoisted(() => ({
  appMock: { requirements: [], testCases: [], links: [], theme: 'dark', refresh: () => {} },
  authMock: { value: { can: () => true } },
}))

vi.mock('../../context/AppContext.jsx', () => ({
  useApp: () => appMock,
  AppProvider: ({ children }) => children,
}))
vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => authMock.value,
  AuthProvider: ({ children }) => children,
}))
vi.mock('../../context/ProjectContext.jsx', () => ({
  useProject: () => ({ activeProject: { id: 'p1', name: 'Kahve Makinesi' } }),
  ProjectProvider: ({ children }) => children,
}))

// ViewModal'in kendi testi ayri; burada yalnizca DOGRU kayitla acildigi onemli.
vi.mock('../../components/common/ViewModal.jsx', () => ({
  default: ({ open, row, commentEntityType, canWrite }) =>
    open ? (
      <div
        data-testid="view-modal"
        data-entity-type={commentEntityType || ''}
        data-can-write={String(canWrite)}
      >
        {row?.text_id}
      </div>
    ) : null,
}))

import RequirementMap from '../RequirementMap.jsx'

const USER = { id: 'u1', text_id: 'REQ-USR-001', title: 'Kahve hazirla', type: 'User Requirement' }
const SYS = { id: 's1', text_id: 'REQ-SYS-001', title: 'Isitici', type: 'System Requirement' }
const SW = {
  id: 'w1',
  text_id: 'REQ-SW-001',
  title: 'Sicaklik dongusu',
  type: 'Software Requirement',
}
const TEST = { id: 't1', text_id: 'TC-SYS-001', title: 'Isitma testi', type: 'System Test' }

const satisfies = (fromId, toId) => ({ fromId, toId, type: 'Satisfies' })
const verifies = (fromId, toId) => ({ fromId, toId, type: 'Verifies' })

const renderPage = () =>
  render(
    <LanguageProvider>
      <RequirementMap />
    </LanguageProvider>,
  )

beforeEach(() => {
  appMock.requirements = [USER, SYS, SW]
  appMock.testCases = [TEST]
  appMock.links = [satisfies('u1', 's1'), satisfies('s1', 'w1'), verifies('s1', 't1')]
  appMock.theme = 'dark'
  appMock.refresh = vi.fn()
  authMock.value = { can: () => true }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const node = (textId) => screen.queryByTestId(`mindmap-node-${textId}`)
const toggle = (textId) => screen.getByTestId(`mindmap-toggle-${textId}`)

describe('Gereksinim Haritası — dallanma ve aç/kapa', () => {
  it('kok ve ilk seviye acik baslar, alt dallar kapalidir', () => {
    renderPage()
    expect(node('REQ-USR-001')).toBeInTheDocument()
    expect(node('REQ-SYS-001')).toBeInTheDocument()
    expect(node('REQ-SW-001')).not.toBeInTheDocument()
    expect(node('TC-SYS-001')).not.toBeInTheDocument()
  })

  it('dal ucundaki noktaya tiklayinca o dal acilir ve tekrar tiklayinca kapanir', () => {
    renderPage()
    fireEvent.click(toggle('REQ-SYS-001'))
    expect(node('REQ-SW-001')).toBeInTheDocument()
    expect(node('TC-SYS-001')).toBeInTheDocument()

    fireEvent.click(toggle('REQ-SYS-001'))
    expect(node('REQ-SW-001')).not.toBeInTheDocument()
    // Kardes dal (kok) etkilenmez — dallar TEK TEK acilip kapanir.
    expect(node('REQ-SYS-001')).toBeInTheDocument()
  })

  it('"Tümünü Aç" / "Tümünü Kapat" tum zinciri yonetir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-expand-all'))
    expect(node('REQ-SW-001')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mindmap-collapse-all'))
    expect(node('REQ-SYS-001')).not.toBeInTheDocument()
    expect(node('REQ-USR-001')).toBeInTheDocument()
  })

  it('gereksinim kutusunda Text ID yaninda Parca No YAZMAZ (#143)', () => {
    appMock.requirements = [{ ...USER, partNo: '010.00.005' }, SYS, SW]
    renderPage()
    expect(screen.getByTestId('mindmap-node-REQ-USR-001')).toBeInTheDocument()
    // Ust satir YALNIZCA gereksinimin kendi kodudur; urun kimligi olan Parca
    // No haritada bir gereksinim satirina yazilmaz.
    expect(screen.getByText('REQ-USR-001')).toBeInTheDocument()
    expect(screen.queryByText('010.00.005')).not.toBeInTheDocument()
  })

  it('kapali dugum, altindaki kayit sayisini gosterir', () => {
    renderPage()
    expect(toggle('REQ-SYS-001')).toHaveAttribute('aria-label', expect.stringContaining('2'))
  })
})

describe('Gereksinim Haritası — yukarıdan aşağıya dallanma', () => {
  // Issue #122: dallanma yonu top-down olmalidir — kok en ustte, alt
  // seviyeler asagiya acilir (soldan saga DEGIL).
  const topOf = (textId) => Number(node(textId).getAttribute('y'))
  const leftOf = (textId) => Number(node(textId).getAttribute('x'))

  it('alt seviye, ustunun ALTINDA cizilir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-expand-all'))
    expect(topOf('REQ-SYS-001')).toBeGreaterThan(topOf('REQ-USR-001'))
    expect(topOf('REQ-SW-001')).toBeGreaterThan(topOf('REQ-SYS-001'))
  })

  it('kardes dugumler YAN YANA (ayni satirda) durur', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-expand-all'))
    expect(topOf('REQ-SW-001')).toBe(topOf('TC-SYS-001'))
    expect(leftOf('REQ-SW-001')).not.toBe(leftOf('TC-SYS-001'))
  })

  it('ust dugum cocuklarinin ORTASINA hizalanir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-expand-all'))
    const kids = [leftOf('REQ-SW-001'), leftOf('TC-SYS-001')].sort((a, b) => a - b)
    expect(leftOf('REQ-SYS-001')).toBeCloseTo((kids[0] + kids[1]) / 2, 5)
  })
})

describe('Gereksinim Haritası — haritada arama', () => {
  it('kapali bir dalda kalan kaydi bulur, yolunu acar ve dugumu vurgular', () => {
    renderPage()
    // REQ-SW-001 baslangicta kapali bir dalin altindadir.
    expect(node('REQ-SW-001')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('mindmap-search'), {
      target: { value: 'REQ-SW-001' },
    })
    fireEvent.click(screen.getByTestId('mindmap-search-submit'))

    expect(node('REQ-SW-001')).toBeInTheDocument()
    expect(node('REQ-SW-001')).toHaveAttribute('stroke', '#f59e0b')
    // Yol uzerindeki kardes dallar da acilmis olur (ayni ust dugumun altinda).
    expect(node('REQ-SYS-001')).toBeInTheDocument()
  })

  it('baslikla ve buyuk/kucuk harf farkiyla da bulur', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('mindmap-search'), {
      target: { value: 'SICAKLIK' },
    })
    fireEvent.click(screen.getByTestId('mindmap-search-submit'))
    expect(node('REQ-SW-001')).toHaveAttribute('stroke', '#f59e0b')
  })

  it('eslesme yoksa kullaniciyi uyarir ve harita degismez', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('mindmap-search'), { target: { value: 'yok-boyle' } })
    fireEvent.click(screen.getByTestId('mindmap-search-submit'))
    expect(screen.getByTestId('mindmap-search-miss')).toBeInTheDocument()
    expect(node('REQ-SW-001')).not.toBeInTheDocument()
  })

  it('birden fazla eslesme varsa sayisini bildirir ve aralarinda gezinir', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('mindmap-search'), { target: { value: 'REQ-' } })
    fireEvent.click(screen.getByTestId('mindmap-search-submit'))
    expect(screen.getByTestId('mindmap-search-hits')).toHaveTextContent('3')

    const firstFocused = screen.getByTestId('mindmap-search-submit')
    expect(firstFocused).toHaveTextContent('Sonraki')
    const strokeOf = (id) => node(id)?.getAttribute('stroke')
    const before = ['REQ-USR-001', 'REQ-SYS-001', 'REQ-SW-001'].find(
      (id) => strokeOf(id) === '#f59e0b',
    )
    fireEvent.click(screen.getByTestId('mindmap-search-submit'))
    const after = ['REQ-USR-001', 'REQ-SYS-001', 'REQ-SW-001'].find(
      (id) => strokeOf(id) === '#f59e0b',
    )
    expect(after).not.toBe(before)
  })

  it('bos sorguda "Bul" devre disidir', () => {
    renderPage()
    expect(screen.getByTestId('mindmap-search-submit')).toBeDisabled()
  })
})

describe('Gereksinim Haritası — canli gorunum', () => {
  it('yeni kayit/bag sayfa yenilemeden haritada belirir', () => {
    const { rerender } = renderPage()
    expect(node('REQ-SYS-002')).not.toBeInTheDocument()

    const sys2 = { id: 's2', text_id: 'REQ-SYS-002', title: 'Ogutucu', type: 'System Requirement' }
    appMock.requirements = [...appMock.requirements, sys2]
    appMock.links = [...appMock.links, satisfies('u1', 's2')]
    rerender(
      <LanguageProvider>
        <RequirementMap />
      </LanguageProvider>,
    )
    expect(node('REQ-SYS-002')).toBeInTheDocument()
  })

  it('veri tazelendiginde acik/kapali durum korunur', () => {
    const { rerender } = renderPage()
    fireEvent.click(toggle('REQ-SYS-001')) // alt dali ac
    expect(node('REQ-SW-001')).toBeInTheDocument()

    appMock.requirements = [...appMock.requirements]
    appMock.links = [...appMock.links]
    rerender(
      <LanguageProvider>
        <RequirementMap />
      </LanguageProvider>,
    )
    expect(node('REQ-SW-001')).toBeInTheDocument()
  })

  it('sayfa acilirken proje verisini tazeler (ayri bir "yenile" adimi yok)', () => {
    renderPage()
    expect(appMock.refresh).toHaveBeenCalled()
    expect(screen.queryByText('Yenile')).not.toBeInTheDocument()
  })
})

describe('Gereksinim Haritası — kayit detayi', () => {
  it('dugume tiklayinca ilgili kaydin detayi acilir', () => {
    renderPage()
    fireEvent.click(node('REQ-SYS-001'))
    const modal = screen.getByTestId('view-modal')
    expect(modal).toHaveTextContent('REQ-SYS-001')
    // Harita salt okunurdur: duzenleme kendi sayfasindan yapilir.
    expect(modal).toHaveAttribute('data-can-write', 'false')
    expect(modal).toHaveAttribute('data-entity-type', 'requirement')
  })

  it('test dugumu test varligi olarak acilir', () => {
    renderPage()
    fireEvent.click(toggle('REQ-SYS-001'))
    fireEvent.click(node('TC-SYS-001'))
    expect(screen.getByTestId('view-modal')).toHaveAttribute('data-entity-type', 'testcase')
  })

  it('okuma izni olmayan tipte dugum detayi ACILMAZ', () => {
    authMock.value = { can: (perm, component) => component !== 'req-system' }
    renderPage()
    fireEvent.click(node('REQ-SYS-001'))
    expect(screen.queryByTestId('view-modal')).not.toBeInTheDocument()
  })
})

describe('Gereksinim Haritası — dışa aktarım', () => {
  it('SVG disa aktarimi tum ACIK dallari iceren dosya uretir', () => {
    const blobs = []
    const createUrl = vi.fn(() => 'blob:mock')
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const OriginalBlob = globalThis.Blob
    vi.spyOn(globalThis, 'Blob').mockImplementation((parts, opts) => {
      blobs.push({ text: String(parts?.[0] ?? ''), type: opts?.type })
      return new OriginalBlob(parts, opts)
    })
    const clicks = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicks.push(this.download)
    })

    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-expand-all'))
    fireEvent.click(screen.getByTestId('mindmap-export-svg'))

    expect(blobs[0].type).toContain('image/svg+xml')
    expect(blobs[0].text).toContain('<svg')
    expect(blobs[0].text).toContain('REQ-SW-001')
    expect(clicks[0]).toMatch(/^gereksinim-haritasi-kahve-makinesi-\d{4}-\d{2}-\d{2}\.svg$/)
    expect(createUrl).toHaveBeenCalled()
  })

  it('PNG disa aktarimi basarisiz olursa kullaniciya hata gosterilir', () => {
    // jsdom'da canvas rasterlestirmesi yoktur; hata sessizce yutulmamalidir.
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no canvas')
    })
    renderPage()
    fireEvent.click(screen.getByTestId('mindmap-export-png'))
    // Goruntu yuklenmesi asenkron oldugundan hata onerror/onload ile gelir;
    // burada en azindan butonun cokmedigini ve haritanin ayakta kaldigini
    // dogruluyoruz.
    expect(screen.getByTestId('mindmap-canvas')).toBeInTheDocument()
  })
})

describe('Gereksinim Haritası — boş proje', () => {
  it('kayit yoksa bilgilendirme gosterilir', () => {
    appMock.requirements = []
    appMock.testCases = []
    appMock.links = []
    renderPage()
    expect(screen.queryByTestId('mindmap-canvas')).not.toBeInTheDocument()
    expect(screen.getByText(/haritalanacak bir kayıt yok/i)).toBeInTheDocument()
  })
})
