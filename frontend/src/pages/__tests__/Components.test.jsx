// ============================================================================
//  Components.test.jsx — "Bileşenler" sayfasi (Issue #129, #144, #147).
//
//  Kapsam (kabul kriterleri):
//   - HARITA gorunumu varsayilandir ve YALNIZCA urun agacini cizer (#144):
//     kutular bilesendir, kutuya tiklayinca secim tasinir, dal ucundaki
//     nokta dali acar/kapatir
//   - Bilesen kaynagi TEKTIR: elle tanimli bilesenler (#147) — "Ürün Ağacı"
//     kaynagi ve kaynak secici ekranda YOKTUR
//   - Bilesen secilince O BILESENE bagli TUM gereksinimler (User/System/
//     Sub-system birlikte) tek listede gorunur
//   - Liste sutunlari: TID No / Parca No / Text ID / Baslik / Gereksinim
//     Metni / Bagli SGD / Dogrulama yontemi
//   - Kayda tiklayinca detay (ViewModal) acilir
//   - Liste CSV / PDF olarak disa aktarilabilir
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock } = vi.hoisted(() => ({
  appMock: {
    projectId: 'p1',
    requirements: [],
    testCases: [],
    links: [],
    attributeDefs: [],
    components: [],
    theme: 'dark',
    refresh: () => {},
    addComponent: vi.fn(),
    editComponent: vi.fn(),
    removeComponent: vi.fn(),
    reorderComponents: vi.fn(),
    linkRequirementsToComponent: vi.fn(),
    importComponentsFromPbs: vi.fn(),
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

//  URUN KIRILIMI (elle tanimli bilesenler — tek kaynak, #147):
//    Kahve Makinesi (c1)
//      ├─ Su Deposu Alt Sistemi (c2)
//      └─ Basınç Pompası Ünitesi (c3)
//  Gereksinimler bu bilesenlere BAGLIDIR; kendi (PBS) hiyerarsileri TID
//  numarasini ve tablodaki girintiyi belirlemeye devam eder.
const comp = (id, name, extra = {}) => ({
  id,
  projectId: 'p1',
  name,
  parentId: null,
  partNo: '',
  sortIndex: 0,
  ...extra,
})
const COMPONENTS = [
  comp('c1', 'Kahve Makinesi', { partNo: '100.00.001', sortIndex: 0 }),
  comp('c2', 'Su Deposu Alt Sistemi', { parentId: 'c1', partNo: '100.00.002', sortIndex: 0 }),
  comp('c3', 'Basınç Pompası Ünitesi', { parentId: 'c1', partNo: '100.00.003', sortIndex: 1 }),
]

const USER = {
  id: 'u1',
  text_id: 'EH-TİD-1',
  title: 'Kahve Makinesi',
  type: 'User Requirement',
  componentId: 'c1',
}
const TANK = {
  id: 's1',
  parentId: 'u1',
  text_id: 'EH-TİD-SYS-001',
  title: 'Su Deposu Alt Sistemi',
  type: 'System Requirement',
  componentId: 'c2',
}
const PUMP = {
  id: 's2',
  parentId: 'u1',
  text_id: 'EH-TİD-SYS-002',
  title: 'Basınç Pompası Ünitesi',
  type: 'System Requirement',
  componentId: 'c3',
}
const PUMP_HW = {
  id: 'h1',
  parentId: 's2',
  text_id: 'EH-TİD-HW-001',
  title: 'Pompa basıncı',
  description: '<p>Pompa <b>9 bar</b> basınç üretmelidir.</p>',
  type: 'Hardware Requirement',
  attributes: { verification_method: 'Test' },
  componentId: 'c3',
}
const PUMP_SW = {
  id: 'w1',
  parentId: 's2',
  text_id: 'EH-TİD-SW-001',
  title: 'Pompa sürücüsü',
  type: 'Software Requirement',
  componentId: 'c3',
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
  appMock.components = COMPONENTS
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
  fireEvent.click(screen.getByTestId('comp-item-c3'))
}
// Harita kutulari BILESENDIR; kimlikleri bilesen id'sidir (proje kokunun
// anahtari __project__).
const mapNode = (key) => screen.queryByTestId(`mindmap-node-${key}`)
// Dal ucundaki nokta: dali acar/kapatir (kutu tiklamasi secimi tasir).
const expandDot = (key) => fireEvent.click(screen.getByTestId(`mindmap-toggle-${key}`))

describe('Bileşenler — harita görünümü (varsayılan)', () => {
  it('harita TEK proje dugumuyle acilir; kirilim inerek acilir', () => {
    renderPage()
    expect(screen.getByTestId('comp-view-map')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mindmap-canvas')).toBeInTheDocument()
    // Tepede proje dugumu + ilk seviye; derin dallar KAPALI baslar.
    expect(mapNode('__project__')).toBeInTheDocument()
    expect(mapNode('c1')).toBeInTheDocument()
    expect(mapNode('c3')).not.toBeInTheDocument()
  })

  it('harita YUKARIDAN ASAGI dallanir: cocuk dugum ustunun ALTINDA durur', () => {
    renderPage()
    expandDot('c1')
    const parent = Number(mapNode('c1').getAttribute('y'))
    const child = Number(mapNode('c3').getAttribute('y'))
    expect(child).toBeGreaterThan(parent)
  })

  it('haritada GEREKSINIM kutusu yoktur; yalnizca bilesenler cizilir (#144)', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-expand-all'))
    expect(mapNode('c2')).toBeInTheDocument()
    expect(mapNode('c3')).toBeInTheDocument()
    expect(mapNode('EH-TİD-SYS-002')).not.toBeInTheDocument()
    expect(mapNode('EH-TİD-HW-001')).not.toBeInTheDocument()
  })

  it('kutuda bilesenin Parca No su ve adi yazar (aciklama kutuda degil)', () => {
    renderPage()
    expandDot('c1')
    expect(screen.getAllByText('Basınç Pompası Ünitesi').length).toBeGreaterThan(0)
    expect(screen.getByText('100.00.003')).toBeInTheDocument()
    // Gereksinim metni kutuda yazmaz.
    expect(screen.queryByText(/9 bar basınç üretmelidir/i)).not.toBeInTheDocument()
  })

  it('KUTUYA TIKLAYINCA secim o bilesene gecer (harita urun agacidir)', () => {
    renderPage()
    expandDot('c1')
    fireEvent.click(mapNode('c3'))
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('Basınç Pompası Ünitesi')
    // Bilesen bir GEREKSINIM kaydi degildir: detay modali acilmaz.
    expect(screen.queryByTestId('view-modal')).not.toBeInTheDocument()
  })

  it('dal ucundaki nokta dali acar, tekrar tiklayinca kapatir', () => {
    renderPage()
    expandDot('c1')
    expect(mapNode('c2')).toBeInTheDocument()
    expect(mapNode('c3')).toBeInTheDocument()

    expandDot('c1')
    expect(mapNode('c2')).not.toBeInTheDocument()
    // Proje dugumu (ust dal) etkilenmez — dallar TEK TEK acilip kapanir.
    expect(mapNode('c1')).toBeInTheDocument()
  })

  it('"Tümünü Aç" / "Tümünü Kapat" tum kirilimi yonetir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-expand-all'))
    expect(mapNode('c3')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('comp-collapse-all'))
    // Her sey kapali: geriye yalnizca proje dugumu kalir.
    expect(mapNode('c1')).not.toBeInTheDocument()
    expect(mapNode('__project__')).toBeInTheDocument()
  })

  it('haritadaki secim Liste gorunumune tasinir (tek secim, iki gorunum)', () => {
    renderPage()
    expandDot('c1')
    fireEvent.click(mapNode('c3'))
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('Basınç Pompası Ünitesi')
    showList()
    expect(screen.getByTestId('comp-selected-title')).toHaveTextContent('Basınç Pompası Ünitesi')
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
  })

  it('kaynak secici ekranda YOKTUR: tek kaynak elle tanimli bilesenler (#147)', () => {
    renderPage()
    expect(screen.queryByTestId('comp-source-manual')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comp-source-pbs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comp-source-field')).not.toBeInTheDocument()
  })

  it('"Yeni bileşen ekle" gorunum dugumlerinin yaninda, HER gorunumde durur (#147)', () => {
    renderPage()
    expect(screen.getByTestId('comp-add-root')).toBeInTheDocument()
    showList()
    expect(screen.getByTestId('comp-add-root')).toBeInTheDocument()
  })

  it('proje dugumu secilince kapsam TUM projedir', () => {
    renderPage()
    fireEvent.click(mapNode('__project__'))
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('Kahve Makinesi Projesi')
    expect(screen.getByTestId('comp-selection')).toHaveTextContent('5 gereksinim · 1 doğrulandı')
    showList()
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-001')).toBeInTheDocument()
    expect(screen.getByTestId('comp-row-EH-TİD-HW-001')).toBeInTheDocument()
  })
})

describe('Bileşenler — harita düzeni (ürün ağacı / feature tree)', () => {
  // Kardes iki bilesen: Su Deposu (c2) ve Pompa Ünitesi (c3), ustleri c1.
  const expandPump = () => expandDot('c1')

  it('varsayilan duzen AGAC: kardesler ust kutunun altinda YAN YANA durur', () => {
    renderPage()
    expect(screen.getByTestId('comp-mapstyle-tree')).toHaveAttribute('aria-pressed', 'true')
    expandPump()
    const tank = mapNode('c2')
    const pump = mapNode('c3')
    // Ayni seviyedeki iki kardes ayni satirda (y esit), farkli sutunlarda.
    expect(Number(tank.getAttribute('y'))).toBe(Number(pump.getAttribute('y')))
    expect(Number(tank.getAttribute('x'))).not.toBe(Number(pump.getAttribute('x')))
  })

  it('agac duzeninde ust kutu cocuklarinin TAM ORTASINDA durur', () => {
    renderPage()
    expandPump()
    const parent = Number(mapNode('c1').getAttribute('x'))
    const left = Number(mapNode('c2').getAttribute('x'))
    const right = Number(mapNode('c3').getAttribute('x'))
    expect(parent).toBeCloseTo((Math.min(left, right) + Math.max(left, right)) / 2, 5)
  })

  it('SIKISIK duzene gecince ayni kardesler zincire doner (alt alta, ayni hizada)', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-mapstyle-compact'))
    expect(screen.getByTestId('comp-mapstyle-compact')).toHaveAttribute('aria-pressed', 'true')
    expandPump()
    const tank = mapNode('c2')
    const pump = mapNode('c3')
    expect(Number(tank.getAttribute('x'))).toBe(Number(pump.getAttribute('x')))
    expect(Number(tank.getAttribute('y'))).not.toBe(Number(pump.getAttribute('y')))
  })

  it('duzen secimi acik dallari korur; geri donulunce agac duzeni gelir', () => {
    renderPage()
    expandPump()
    fireEvent.click(screen.getByTestId('comp-mapstyle-compact'))
    expect(mapNode('c2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('comp-mapstyle-tree'))
    expect(Number(mapNode('c2').getAttribute('y'))).toBe(Number(mapNode('c3').getAttribute('y')))
  })

  it('duzen secimi yalnizca haritada gorunur (Liste gorunumunde yok)', () => {
    renderPage()
    showList()
    expect(screen.queryByTestId('comp-mapstyle-tree')).not.toBeInTheDocument()
  })
})

describe('Bileşenler — bileşen listesi', () => {
  it('elle tanimli bilesenler kirilimiyla listelenir; gereksinim bilesen degildir', () => {
    renderPage()
    showList()
    expect(screen.getByTestId('comp-item-c1')).toHaveTextContent('Kahve Makinesi')
    expect(screen.getByTestId('comp-item-c3')).toHaveTextContent('Basınç Pompası Ünitesi')
    expect(screen.queryByTestId('comp-item-h1')).not.toBeInTheDocument()
  })

  it('bilesen adinin yaninda bagli gereksinim sayisi gorunur', () => {
    renderPage()
    showList()
    // Pompa unitesi: 3 bagli gereksinim (kendi sistem gereksinimi + ikisi).
    expect(screen.getByTestId('comp-item-c3')).toHaveTextContent('3 gereksinim')
    // Dogrulanma ozeti secili bilesenin basliginda tam haliyle durur.
    fireEvent.click(screen.getByTestId('comp-item-c3'))
    expect(screen.getByTestId('comp-selected-summary')).toHaveTextContent(
      '3 gereksinim · 1 doğrulandı',
    )
  })

  it('okuma izni olmayan seviye listeye HIC girmez', () => {
    // Alt sistem gereksinimleri gizlenince pompa unitesinin altinda yalnizca
    // kendi sistem gereksinimi kalir; gizli kayitlar tabloya da girmez.
    authMock.value = { can: (_perm, component) => component !== 'req-subsystem' }
    renderPage()
    showList()
    expect(screen.getByTestId('comp-item-c3')).toHaveTextContent('1 gereksinim')
    expect(screen.queryByTestId('comp-row-EH-TİD-HW-001')).not.toBeInTheDocument()
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
    appMock.components = []
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

  it('hicbir GEREKSINIM satiri bilesen basligi gibi isaretlenmez (#140)', () => {
    renderPage()
    showList()
    // Alt kirilimi olan bir gereksinim de (SYS-002) yalnizca bir kayittir;
    // bilesen tablonun BASLIGIDIR, satiri degil.
    expect(screen.getByTestId('comp-row-EH-TİD-SYS-002')).not.toHaveAttribute('data-component')
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
    fireEvent.click(screen.getByTestId('comp-item-c3'))
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
