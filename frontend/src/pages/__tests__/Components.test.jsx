// ============================================================================
//  Components.test.jsx — "Bileşenler" sayfasi (Issue #129).
//
//  Kapsam (kabul kriterleri):
//   - Bilesen secilince O BILESENE ait TUM gereksinimler (User/System/
//     Sub-system birlikte) tek listede gorunur
//   - Liste sutunlari: TID No / Text ID / Baslik / Gereksinim Metni /
//     Bagli SGD / Dogrulama yontemi
//   - Bilesen adinin yaninda gereksinim sayisi + dogrulanma ozeti
//   - Kayda tiklayinca detay (ViewModal) acilir
//   - Liste CSV / PDF olarak disa aktarilabilir
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock } = vi.hoisted(() => ({
  appMock: {
    requirements: [],
    testCases: [],
    links: [],
    attributeDefs: [],
    refresh: () => {},
  },
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
  default: ({ open, row, canWrite }) =>
    open ? (
      <div data-testid="view-modal" data-can-write={String(canWrite)}>
        {row?.text_id}
      </div>
    ) : null,
}))

import Components from '../Components.jsx'

const USER = { id: 'u1', text_id: 'EH-TİD-1', title: 'Kahve Makinesi', type: 'User Requirement' }
const TANK = {
  id: 's1',
  parentId: 'u1',
  text_id: 'EH-TİD-SYS-001',
  title: 'Su Deposu Alt Sistemi',
  type: 'System Requirement',
  field: 'Donanim',
}
const PUMP = {
  id: 's2',
  parentId: 'u1',
  text_id: 'EH-TİD-SYS-002',
  title: 'Basınç Pompası Ünitesi',
  type: 'System Requirement',
  field: 'Donanim',
}
const PUMP_HW = {
  id: 'h1',
  parentId: 's2',
  text_id: 'EH-TİD-HW-001',
  title: 'Pompa basıncı',
  description: '<p>Pompa <b>9 bar</b> basınç üretmelidir.</p>',
  type: 'Hardware Requirement',
  attributes: { verification_method: 'Test' },
}
const PUMP_SW = {
  id: 'w1',
  parentId: 's2',
  text_id: 'EH-TİD-SW-001',
  title: 'Pompa sürücüsü',
  type: 'Software Requirement',
}
const TEST = { id: 'tc1', text_id: 'TC-SUB-001', title: 'Basınç testi', status: 'Approved' }

const renderPage = () =>
  render(
    <LanguageProvider>
      <Components />
    </LanguageProvider>,
  )

beforeEach(() => {
  appMock.requirements = [USER, TANK, PUMP, PUMP_HW, PUMP_SW]
  appMock.testCases = [TEST]
  appMock.links = [
    { type: 'Satisfies', fromId: 'u1', toId: 's1' },
    { type: 'Satisfies', fromId: 'u1', toId: 's2' },
    { type: 'Satisfies', fromId: 's2', toId: 'h1' },
    { type: 'Verifies', fromId: 'h1', toId: 'tc1' },
  ]
  appMock.attributeDefs = [
    {
      entityType: 'requirement',
      key: 'verification_method',
      label: 'Doğrulama Yöntemi',
      dataType: 'text',
    },
  ]
  appMock.refresh = vi.fn()
  authMock.value = { can: () => true }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const selectPump = () => fireEvent.click(screen.getByTestId('comp-item-s2'))

describe('Bileşenler — bileşen listesi', () => {
  it('urun agacindaki alt kirilimli dugumler bilesen olarak listelenir', () => {
    renderPage()
    expect(screen.getByTestId('comp-item-u1')).toHaveTextContent('Kahve Makinesi')
    expect(screen.getByTestId('comp-item-s2')).toHaveTextContent('Basınç Pompası Ünitesi')
    // Yaprak kayit bilesen degildir.
    expect(screen.queryByTestId('comp-item-h1')).not.toBeInTheDocument()
  })

  it('bilesen adinin yaninda gereksinim sayisi ve dogrulanma ozeti gorunur', () => {
    renderPage()
    // Pompa unitesi: kendisi + 2 alt gereksinim; yalnizca HW-001 dogrulanmis.
    expect(screen.getByTestId('comp-item-s2')).toHaveTextContent('3 gereksinim · 1 doğrulandı')
  })

  it('arama ile bilesen listesi daraltilir', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('comp-search'), { target: { value: 'pompa' } })
    expect(screen.getByTestId('comp-item-s2')).toBeInTheDocument()
    expect(screen.queryByTestId('comp-item-s1')).not.toBeInTheDocument()
  })

  it('urun agaci kurulmamissa Alan kaynagina dusulur', () => {
    appMock.requirements = appMock.requirements.map((r) => ({ ...r, parentId: null }))
    renderPage()
    expect(screen.getByTestId('comp-source-field')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('comp-item-Donanim')).toBeInTheDocument()
  })

  it('kaynak Alan olarak degistirilebilir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-source-field'))
    expect(screen.getByTestId('comp-item-Donanim')).toHaveTextContent('2 gereksinim')
  })

  it('okuma izni olmayan seviye listeye HIC girmez', () => {
    // Alt sistem gereksinimleri gizlenince pompa unitesinin altinda gorunur
    // bir kirilim kalmaz: ne bilesen olarak, ne de satir olarak listelenir.
    authMock.value = { can: (_perm, component) => component !== 'req-subsystem' }
    renderPage()
    expect(screen.queryByTestId('comp-item-s2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comp-row-EH-TİD-HW-001')).not.toBeInTheDocument()
    // Geriye yalnizca kok bilesen kalir: kendisi + iki sistem gereksinimi.
    expect(screen.getByTestId('comp-item-u1')).toHaveTextContent('3 gereksinim')
  })
})

describe('Bileşenler — seçilen bileşenin gereksinimleri', () => {
  it('seviyeden bagimsiz TUM gereksinimler tek listede gosterilir', () => {
    renderPage()
    selectPump()
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-002')).toBeInTheDocument() // System
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument() // Hardware
    expect(screen.getByTestId('comp-row-EH-TİD-SW-001')).toBeInTheDocument() // Software
    // Baska bilesenin gereksinimi listede YOKTUR.
    expect(screen.queryByTestId('comp-row-EH-TİD-SYS-001')).not.toBeInTheDocument()
  })

  it('liste sutunlari TİD tablosundaki gibidir', () => {
    renderPage()
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual([
      'TİD No',
      'Text ID',
      'Başlık',
      'Gereksinim Metni',
      'Bağlı SGD',
      'Doğrulama Yöntemi',
    ])
  })

  it('satir TİD numarasi, metni ve bagli SGD kayitlarini tasir', () => {
    renderPage()
    selectPump()
    const row = within(screen.getByTestId('comp-row-EH-TİD-HW-001'))
    expect(row.getByText('1.2.1')).toBeInTheDocument()
    expect(row.getByText(/9 bar basınç üretmelidir/)).toBeInTheDocument()
    // Bagli ust kayit (karsiladigi System gereksinimi).
    expect(row.getByText('↑ EH-TİD-SYS-002')).toBeInTheDocument()
  })

  it('dogrulama yontemi sutunu oznitelikten okunur, yoksa testten turetilir', () => {
    renderPage()
    selectPump()
    expect(screen.getByTestId('comp-method-EH-TİD-HW-001')).toHaveTextContent('T')
    // Ne oznitelik ne de bagli test var: uydurulmaz.
    expect(screen.getByTestId('comp-method-EH-TİD-SW-001')).toHaveTextContent('—')
  })

  it('secili bilesen basliginda ozet gorunur', () => {
    renderPage()
    selectPump()
    expect(screen.getByTestId('comp-selected-title')).toHaveTextContent('Basınç Pompası Ünitesi')
    expect(screen.getByTestId('comp-selected-summary')).toHaveTextContent(
      '3 gereksinim · 1 doğrulandı',
    )
  })

  it('kayda tiklayinca detay (ViewModal) acilir', () => {
    renderPage()
    selectPump()
    fireEvent.click(screen.getByTestId('comp-row-EH-TİD-HW-001'))
    const modal = screen.getByTestId('view-modal')
    expect(modal).toHaveTextContent('EH-TİD-HW-001')
    // Sayfa salt okunurdur: duzenleme kendi sayfasindan yapilir.
    expect(modal).toHaveAttribute('data-can-write', 'false')
  })

  it('sayfa acilirken proje verisini tazeler', () => {
    renderPage()
    expect(appMock.refresh).toHaveBeenCalled()
  })

  it('bos projede bilgilendirme gosterilir', () => {
    appMock.requirements = []
    appMock.links = []
    renderPage()
    expect(screen.getByTestId('comp-empty')).toBeInTheDocument()
    expect(screen.getByTestId('comp-export-csv')).toBeDisabled()
  })
})

describe('Bileşenler — dışa aktarım', () => {
  it('CSV dosyasi TİD sutunlariyla uretilir', () => {
    const blobs = []
    URL.createObjectURL = vi.fn(() => 'blob:mock')
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
    selectPump()
    fireEvent.click(screen.getByTestId('comp-export-csv'))

    expect(blobs[0].type).toContain('text/csv')
    expect(blobs[0].text).toContain('TİD No,Text ID,Başlık,Gereksinim Metni,Bağlı SGD')
    expect(blobs[0].text).toContain('EH-TİD-HW-001')
    expect(clicks[0]).toMatch(/^bilesen-basinc-pompasi-unitesi-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('PDF yazdirma penceresi acilir ve liste yazdirilir', () => {
    const win = {
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(win)

    renderPage()
    selectPump()
    fireEvent.click(screen.getByTestId('comp-export-pdf'))

    expect(win.document.write).toHaveBeenCalled()
    expect(win.document.write.mock.calls[0][0]).toContain('EH-TİD-HW-001')
    expect(win.print).toHaveBeenCalled()
  })

  it('acilir pencere engellenirse kullaniciya hata gosterilir', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderPage()
    selectPump()
    fireEvent.click(screen.getByTestId('comp-export-pdf'))
    expect(screen.getByTestId('comp-export-error')).toBeInTheDocument()
  })
})
