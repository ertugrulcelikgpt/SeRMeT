// ============================================================================
//  Components.test.jsx — "Bileşenler" sayfasi (Issue #129).
//
//  Kapsam (kabul kriterleri):
//   - HARITA gorunumu varsayilandir: kutuda yalnizca ISIM yazar, kutuya
//     tiklayinca kaydin detayi (ID + aciklama) acilir, dal ucundaki nokta
//     dali acar/kapatir
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
    theme: 'dark',
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
  useProject: () => ({ activeProject: { id: 'p1', name: 'Kahve Makinesi Projesi' } }),
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
  appMock.theme = 'dark'
  appMock.refresh = vi.fn()
  authMock.value = { can: () => true }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Harita varsayilan gorunumdur; tablo tabanli beklentiler once Liste'ye gecer.
const showList = () => fireEvent.click(screen.getByTestId('comp-view-list'))
const selectPump = () => {
  showList()
  fireEvent.click(screen.getByTestId('comp-item-s2'))
}
const mapNode = (textId) => screen.queryByTestId(`mindmap-node-${textId}`)
// Dal ucundaki nokta: dali acar/kapatir (kutu tiklamasi detayi acar).
const expandDot = (textId) => fireEvent.click(screen.getByTestId(`mindmap-toggle-${textId}`))

describe('Bileşenler — harita görünümü (varsayılan)', () => {
  it('harita TEK proje dugumuyle acilir; kirilim inerek acilir', () => {
    renderPage()
    expect(screen.getByTestId('comp-view-map')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mindmap-canvas')).toBeInTheDocument()
    // Tepede proje dugumu + ilk seviye; derin dallar KAPALI baslar.
    expect(screen.getByTestId('mindmap-node-')).toBeInTheDocument() // proje dugumu
    expect(mapNode('EH-TİD-1')).toBeInTheDocument()
    expect(mapNode('EH-TİD-SYS-002')).not.toBeInTheDocument()
  })

  it('harita YUKARIDAN ASAGI dallanir: cocuk dugum ustunun ALTINDA durur', () => {
    renderPage()
    expandDot('EH-TİD-1')
    const parent = Number(mapNode('EH-TİD-1').getAttribute('y'))
    const child = Number(mapNode('EH-TİD-SYS-001').getAttribute('y'))
    expect(child).toBeGreaterThan(parent)
  })

  it('kutuda YALNIZCA ISIM yazar (ID ve aciklama kutuda degil)', () => {
    renderPage()
    expandDot('EH-TİD-1')
    expect(screen.getAllByText('Basınç Pompası Ünitesi').length).toBeGreaterThan(0)
    // Kutuda ID yoktur; ipucunda (title) ve detayda okunur.
    expect(screen.queryByText('EH-TİD-SYS-002')).not.toBeInTheDocument()
    expect(mapNode('EH-TİD-SYS-002')).toHaveTextContent('EH-TİD-SYS-002') // <title> ipucu
  })

  it('KUTUYA TIKLAYINCA kaydin detayi (ID + aciklama) acilir', () => {
    renderPage()
    expandDot('EH-TİD-1')
    fireEvent.click(mapNode('EH-TİD-SYS-002'))
    const modal = screen.getByTestId('view-modal')
    expect(modal).toHaveTextContent('EH-TİD-SYS-002')
    expect(modal).toHaveAttribute('data-can-write', 'false')
  })

  it('dal ucundaki nokta dali acar, tekrar tiklayinca kapatir', () => {
    renderPage()
    expandDot('EH-TİD-1')
    expandDot('EH-TİD-SYS-002')
    expect(mapNode('EH-TİD-HW-001')).toBeInTheDocument()
    expect(mapNode('EH-TİD-SW-001')).toBeInTheDocument()

    expandDot('EH-TİD-SYS-002')
    expect(mapNode('EH-TİD-HW-001')).not.toBeInTheDocument()
    // Kardes dal etkilenmez — dallar TEK TEK acilip kapanir.
    expect(mapNode('EH-TİD-SYS-001')).toBeInTheDocument()
  })

  it('"Tümünü Aç" / "Tümünü Kapat" tum kirilimi yonetir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-expand-all'))
    expect(mapNode('EH-TİD-HW-001')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('comp-collapse-all'))
    // Her sey kapali: geriye yalnizca proje dugumu kalir.
    expect(mapNode('EH-TİD-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('mindmap-node-')).toBeInTheDocument()
  })

  it('haritadaki secim Liste gorunumune tasinir (tek secim, iki gorunum)', () => {
    renderPage()
    expandDot('EH-TİD-1')
    fireEvent.click(mapNode('EH-TİD-SYS-002'))
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('Basınç Pompası Ünitesi')
    showList()
    expect(screen.getByTestId('comp-selected-title')).toHaveTextContent('Basınç Pompası Ünitesi')
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
  })

  it('Alan kaynaginda her Alan bir kok dugumdur', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-source-field'))
    // 'Donanim' hem harita dugumunde hem secim rozetinde gecer.
    expect(screen.getAllByText('Donanim').length).toBeGreaterThan(0)
    // Alani bos kayitlar da kendi (sanal) kok dugumunde toplanir.
    expect(screen.getByText('Alansız')).toBeInTheDocument()
  })

  it('okuma izni olmayan seviye haritada da cizilmez', () => {
    authMock.value = { can: (_perm, component) => component !== 'req-subsystem' }
    renderPage()
    fireEvent.click(screen.getByTestId('comp-expand-all'))
    expect(mapNode('EH-TİD-HW-001')).not.toBeInTheDocument()
    expect(mapNode('EH-TİD-SYS-002')).toBeInTheDocument()
  })

  it('proje dugumu secilince kapsam TUM projedir', () => {
    renderPage()
    // Proje dugumu bir KAYIT degildir: text_id'si bostur.
    fireEvent.click(screen.getByTestId('mindmap-node-'))
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('Kahve Makinesi Projesi')
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('5 gereksinim · 1 doğrulandı')
    showList()
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-001')).toBeInTheDocument()
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
  })
})

describe('Bileşenler — harita düzeni (ürün ağacı / feature tree)', () => {
  const expandPump = () => {
    expandDot('EH-TİD-1')
    expandDot('EH-TİD-SYS-002')
  }

  it('varsayilan duzen AGAC: kardesler ust kutunun altinda YAN YANA durur', () => {
    renderPage()
    expect(screen.getByTestId('comp-mapstyle-tree')).toHaveAttribute('aria-pressed', 'true')
    expandPump()
    const hw = mapNode('EH-TİD-HW-001')
    const sw = mapNode('EH-TİD-SW-001')
    // Ayni seviyedeki iki kardes ayni satirda (y esit), farkli sutunlarda.
    expect(Number(hw.getAttribute('y'))).toBe(Number(sw.getAttribute('y')))
    expect(Number(hw.getAttribute('x'))).not.toBe(Number(sw.getAttribute('x')))
  })

  it('agac duzeninde ust kutu cocuklarinin TAM ORTASINDA durur', () => {
    renderPage()
    expandPump()
    const parent = Number(mapNode('EH-TİD-SYS-002').getAttribute('x'))
    const left = Number(mapNode('EH-TİD-HW-001').getAttribute('x'))
    const right = Number(mapNode('EH-TİD-SW-001').getAttribute('x'))
    expect(parent).toBeCloseTo((Math.min(left, right) + Math.max(left, right)) / 2, 5)
  })

  it('SIKISIK duzene gecince ayni kardesler zincire doner (alt alta, ayni hizada)', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-mapstyle-compact'))
    expect(screen.getByTestId('comp-mapstyle-compact')).toHaveAttribute('aria-pressed', 'true')
    expandPump()
    const hw = mapNode('EH-TİD-HW-001')
    const sw = mapNode('EH-TİD-SW-001')
    expect(Number(hw.getAttribute('x'))).toBe(Number(sw.getAttribute('x')))
    expect(Number(hw.getAttribute('y'))).not.toBe(Number(sw.getAttribute('y')))
  })

  it('duzen secimi acik dallari korur; geri donulunce agac duzeni gelir', () => {
    renderPage()
    expandPump()
    fireEvent.click(screen.getByTestId('comp-mapstyle-compact'))
    expect(mapNode('EH-TİD-HW-001')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('comp-mapstyle-tree'))
    const hw = mapNode('EH-TİD-HW-001')
    const sw = mapNode('EH-TİD-SW-001')
    expect(Number(hw.getAttribute('y'))).toBe(Number(sw.getAttribute('y')))
  })

  it('duzen secimi yalnizca haritada gorunur (Liste gorunumunde yok)', () => {
    renderPage()
    showList()
    expect(screen.queryByTestId('comp-mapstyle-tree')).not.toBeInTheDocument()
  })
})

describe('Bileşenler — bileşen listesi', () => {
  it('urun agacindaki alt kirilimli dugumler bilesen olarak listelenir', () => {
    renderPage()
    showList()
    expect(screen.getByTestId('comp-item-u1')).toHaveTextContent('Kahve Makinesi')
    expect(screen.getByTestId('comp-item-s2')).toHaveTextContent('Basınç Pompası Ünitesi')
    // Yaprak kayit bilesen degildir.
    expect(screen.queryByTestId('comp-item-h1')).not.toBeInTheDocument()
  })

  it('bilesen adinin yaninda gereksinim sayisi ve dogrulanma ozeti gorunur', () => {
    renderPage()
    showList()
    // Pompa unitesi: kendisi + 2 alt gereksinim; yalnizca HW-001 dogrulanmis.
    expect(screen.getByTestId('comp-item-s2')).toHaveTextContent('3 gereksinim · 1 doğrulandı')
  })

  it('arama ile bilesen listesi daraltilir', () => {
    renderPage()
    showList()
    fireEvent.change(screen.getByTestId('comp-search'), { target: { value: 'pompa' } })
    expect(screen.getByTestId('comp-item-s2')).toBeInTheDocument()
    expect(screen.queryByTestId('comp-item-s1')).not.toBeInTheDocument()
  })

  it('urun agaci kurulmamissa Alan kaynagina dusulur', () => {
    appMock.requirements = appMock.requirements.map((r) => ({ ...r, parentId: null }))
    renderPage()
    showList()
    expect(screen.getByTestId('comp-source-field')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('comp-item-Donanim')).toBeInTheDocument()
  })

  it('kaynak Alan olarak degistirilebilir', () => {
    renderPage()
    showList()
    fireEvent.click(screen.getByTestId('comp-source-field'))
    expect(screen.getByTestId('comp-item-Donanim')).toHaveTextContent('2 gereksinim')
  })

  it('okuma izni olmayan seviye listeye HIC girmez', () => {
    // Alt sistem gereksinimleri gizlenince pompa unitesinin altinda gorunur
    // bir kirilim kalmaz: ne bilesen olarak, ne de satir olarak listelenir.
    authMock.value = { can: (_perm, component) => component !== 'req-subsystem' }
    renderPage()
    showList()
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
    showList()
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual([
      'TİD No',
      'Parça No',
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
    // Bagli ust kayit (karsiladigi System gereksinimi) — kilavuzdaki gibi
    // duz kod listesi.
    expect(row.getByText('EH-TİD-SYS-002')).toBeInTheDocument()
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

describe('Bileşenler — TİD tablosu (liste görünümü)', () => {
  it('varsayilan olarak TUM proje tek tabloda, kilavuzdaki sirayla gelir', () => {
    renderPage()
    showList()
    // Bilesen basligi ve ALTINDAKILER ayni tabloda, arka arkaya.
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-002')).toBeInTheDocument()
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
    // Baska bir bilesenin blogu da ayni tabloda durur.
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-001')).toBeInTheDocument()
  })

  it('alt kirilimi olan kayit BASLIK satiri olarak isaretlenir', () => {
    renderPage()
    showList()
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-002')).toHaveAttribute('data-component', 'true')
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).not.toHaveAttribute('data-component')
  })

  it('alt kayitlarin basligi daha iceride (girintili) cizilir', () => {
    renderPage()
    showList()
    const cellOf = (textId) =>
      // 0: TİD No · 1: Parça No · 2: Text ID · 3: Başlık (girintili sutun)
      within(screen.getByTestId(`comp-row-${textId}`)).getAllByRole('cell')[3]
    const pad = (el) => parseFloat(el.style.paddingLeft)
    expect(pad(cellOf('EH-TİD-HW-001'))).toBeGreaterThan(pad(cellOf('EH-TİD-SYS-002')))
    expect(pad(cellOf('EH-TİD-SYS-002'))).toBeGreaterThan(pad(cellOf('EH-TİD-1')))
  })

  it('birlesik dogrulama yontemi "T/CoC" olarak gosterilir', () => {
    appMock.requirements = appMock.requirements.map((r) =>
      r.id === 'h1' ? { ...r, attributes: { verification_method: 'T/CoC' } } : r,
    )
    renderPage()
    showList()
    expect(screen.getByTestId('comp-method-EH-TİD-HW-001')).toHaveTextContent('T/CoC')
  })

  it('bilesen secilince tablo o bilesene daralir', () => {
    renderPage()
    showList()
    fireEvent.click(screen.getByTestId('comp-item-s2'))
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
    expect(screen.queryByTestId('comp-row-EH-TİD-SYS-001')).not.toBeInTheDocument()
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
    expect(blobs[0].text).toContain('TİD No,Parça No,Text ID,Başlık,Gereksinim Metni,Bağlı SGD')
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
