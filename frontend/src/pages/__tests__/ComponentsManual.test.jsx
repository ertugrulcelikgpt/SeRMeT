// ============================================================================
//  ComponentsManual.test.jsx — ELLE tanimlanan bilesenler (Issue #138).
//
//  Kabul kriterleri:
//   - Yepyeni (hic gereksinimi olmayan) projede sayfa BOS LISTE +
//     "Yeni bileşen ekle" aksiyonuyla acilir
//   - Kullanici ad (ve varsa Parca No) vererek bilesen olusturur
//   - Listenin altindaki ekleme aksiyonuyla arka arkaya bilesen eklenebilir
//   - Bilesen adi duzenlenebilir, bilesen silinebilir (bagli gereksinim varsa
//     UYARI cikar)
//   - Bir bilesenin altina alt bilesen eklenebilir; liste bu elle kurulmus
//     kirilimi gosterir
//   - Gereksinimi olmayan bilesenler listede GORUNUR (gizlenmez)
//   - Gereksinimler SONRADAN bilesene baglanir
//   - Sira kullanicinin verdigi gibi kalir (yukari/asagi tasima)
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock, api } = vi.hoisted(() => ({
  appMock: {
    projectId: 'p1',
    requirements: [],
    testCases: [],
    links: [],
    attributeDefs: [],
    components: [],
    theme: 'light',
    refresh: vi.fn(),
    addComponent: vi.fn(),
    editComponent: vi.fn(),
    removeComponent: vi.fn(),
    reorderComponents: vi.fn(),
    linkRequirementsToComponent: vi.fn(),
    importComponentsFromPbs: vi.fn(),
  },
  authMock: { value: { can: () => true, isPM: true } },
  api: {
    ensurePartNumbers: vi.fn(),
    checkPartNumbers: vi.fn(),
    setPartNo: vi.fn(),
    setPartNoConfig: vi.fn(),
    suggestComponentPartNo: vi.fn(),
  },
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
  useProject: () => ({ activeProject: { id: 'p1', name: 'Yeni Proje' } }),
  ProjectProvider: ({ children }) => children,
}))
vi.mock('../../services/dataService.js', () => api)
vi.mock('../../components/common/ViewModal.jsx', () => ({ default: () => null }))

import Components from '../Components.jsx'

const comp = (id, name, extra = {}) => ({
  id,
  projectId: 'p1',
  parentId: null,
  name,
  partNo: null,
  sortIndex: 0,
  ...extra,
})

const CLEAN_CHECK = {
  issues: [],
  counts: {},
  total: 0,
  errorCount: 0,
  format: 'NNN.NN.NNN',
  blockStep: 10,
}

const renderPage = () =>
  render(
    <LanguageProvider>
      <Components />
    </LanguageProvider>,
  )

// Issue #144: BILESEN LISTESI (ekle / duzenle / sil / sirala / bagla) artik
// LISTE gorunumundedir; harita yalnizca urun agacini cizer. Paneli kullanan
// testler sayfayi acar ve "Liste" dugmesine basar.
const renderList = () => {
  const out = renderPage()
  fireEvent.click(screen.getByTestId('comp-view-list'))
  return out
}

beforeEach(() => {
  appMock.requirements = []
  appMock.components = []
  appMock.refresh = vi.fn()
  authMock.value = { can: () => true, isPM: true }
  api.ensurePartNumbers.mockResolvedValue({ assigned: 0, skipped: 0, items: [] })
  api.checkPartNumbers.mockResolvedValue(CLEAN_CHECK)
  api.suggestComponentPartNo.mockResolvedValue({
    partNo: '010.00.001',
    format: 'NNN.NN.NNN',
    block: '010',
  })
  appMock.addComponent.mockResolvedValue({ id: 'new-1', name: 'Yeni' })
  appMock.editComponent.mockResolvedValue({})
  appMock.removeComponent.mockResolvedValue({ ok: true })
  appMock.reorderComponents.mockResolvedValue({ ordered: 2 })
  appMock.linkRequirementsToComponent.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Boş proje: bileşen oluşturma', () => {
  it('hiç gereksinimi olmayan projede boş liste + "Yeni bileşen ekle" ile açılır', () => {
    renderList()
    expect(screen.getByTestId('comp-manual-panel')).toBeInTheDocument()
    expect(screen.getByTestId('comp-manual-empty')).toBeInTheDocument()
    expect(screen.getByTestId('comp-add-root')).toBeInTheDocument()
  })

  it('ad (ve Parça No) verilerek bileşen oluşturulur', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-add-root'))
    const nameInput = await screen.findByTestId('comp-name-input')
    fireEvent.change(nameInput, { target: { value: 'Su Pompası Ünitesi' } })
    fireEvent.change(screen.getByTestId('comp-partno-input'), {
      target: { value: '320.00.001' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))

    await waitFor(() =>
      expect(appMock.addComponent).toHaveBeenCalledWith({
        name: 'Su Pompası Ünitesi',
        partNo: '320.00.001',
        parentId: null,
      }),
    )
  })

  it('Parça No ÖNERİLİR ama zorunlu değildir: alan boşaltılabilir', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-add-root'))
    const partNoInput = await screen.findByTestId('comp-partno-input')
    // Sunucudan gelen oneri alana on-doldurulur.
    await waitFor(() => expect(partNoInput.value).toBe('010.00.001'))
    fireEvent.change(partNoInput, { target: { value: '' } })
    fireEvent.change(screen.getByTestId('comp-name-input'), { target: { value: 'AMTB' } })
    fireEvent.click(screen.getByTestId('comp-form-save'))

    await waitFor(() =>
      expect(appMock.addComponent).toHaveBeenCalledWith({
        name: 'AMTB',
        partNo: '',
        parentId: null,
      }),
    )
  })

  it('adsız bileşen kaydedilmez', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-add-root'))
    fireEvent.click(await screen.findByTestId('comp-form-save'))
    expect(await screen.findByTestId('comp-form-error')).toBeInTheDocument()
    expect(appMock.addComponent).not.toHaveBeenCalled()
  })

  it('ekleme aksiyonu listenin ALTINDADIR ve arka arkaya kullanılabilir', async () => {
    appMock.components = [comp('c1', 'Birinci', { sortIndex: 0 })]
    renderList()
    // Bir bilesen varken de ekleme aksiyonu durur (ikinci, ucuncu... eklenir).
    fireEvent.click(screen.getByTestId('comp-add-root'))
    fireEvent.change(await screen.findByTestId('comp-name-input'), {
      target: { value: 'İkinci' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() => expect(appMock.addComponent).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('comp-add-root')).toBeInTheDocument()
  })
})

describe('Liste: kırılım, sıra ve boş bileşenler', () => {
  beforeEach(() => {
    appMock.components = [
      comp('c1', 'Zeta', { sortIndex: 0 }),
      comp('c2', 'Alfa', { sortIndex: 1 }),
      comp('c3', 'Donanım', { parentId: 'c2', sortIndex: 0 }),
    ]
  })

  it('gereksinimi olmayan bileşenler listede görünür (gizlenmez)', () => {
    renderList()
    expect(screen.getByTestId('comp-item-c1')).toHaveTextContent('Zeta')
    expect(screen.getByTestId('comp-item-c1')).toHaveTextContent('0 gereksinim')
  })

  it('elle kurulmuş kırılım gösterilir (alt bileşen üstünün altında)', () => {
    renderList()
    const child = screen.getByTestId('comp-item-c3')
    // Anahat numarasi kirilimi yansitir: Alfa = 2, Donanim = 2.1
    expect(child).toHaveTextContent('2.1')
    expect(child).toHaveTextContent('Donanım')
  })

  it('sıra kullanıcının verdiği gibi kalır (alfabetik değil)', () => {
    renderList()
    const items = screen.getAllByTestId(/^comp-item-/)
    expect(items.map((el) => el.dataset.testid)).toEqual([
      'comp-item-c1',
      'comp-item-c2',
      'comp-item-c3',
    ])
  })

  it('aşağı taşıma yeni sırayı kaydeder', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-down-c1'))
    await waitFor(() => expect(appMock.reorderComponents).toHaveBeenCalledWith(null, ['c2', 'c1']))
  })

  it('en üstteki bileşen yukarı taşınamaz', () => {
    renderList()
    expect(screen.getByTestId('comp-up-c1')).toBeDisabled()
  })

  it('bir bileşenin altına alt bileşen eklenebilir', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-add-child-c1'))
    fireEvent.change(await screen.findByTestId('comp-name-input'), {
      target: { value: 'Kentel' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() =>
      expect(appMock.addComponent).toHaveBeenCalledWith({
        name: 'Kentel',
        partNo: expect.any(String),
        parentId: 'c1',
      }),
    )
  })
})

describe('Düzenleme ve silme', () => {
  beforeEach(() => {
    appMock.components = [comp('c1', 'Eski Ad', { sortIndex: 0, partNo: '320.00.001' })]
  })

  it('bileşen adı düzenlenebilir', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-edit-c1'))
    const nameInput = await screen.findByTestId('comp-name-input')
    expect(nameInput.value).toBe('Eski Ad')
    fireEvent.change(nameInput, { target: { value: 'Yeni Ad' } })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() =>
      expect(appMock.editComponent).toHaveBeenCalledWith('c1', {
        name: 'Yeni Ad',
        partNo: '320.00.001',
      }),
    )
  })

  it('bileşen gerekçe ile silinir', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-delete-c1'))
    fireEvent.change(await screen.findByTestId('reason-modal-textarea'), {
      target: { value: 'Ürün kırılımı değişti' },
    })
    fireEvent.click(screen.getByTestId('reason-modal-confirm'))
    await waitFor(() =>
      expect(appMock.removeComponent).toHaveBeenCalledWith('c1', 'Ürün kırılımı değişti', true),
    )
  })

  it('bağlı gereksinimi olan bileşende silme UYARISI gösterilir', async () => {
    appMock.requirements = [
      {
        id: 'r1',
        text_id: 'R-001',
        title: 'Pompa basıncı',
        type: 'System Requirement',
        componentId: 'c1',
      },
    ]
    renderList()
    fireEvent.click(screen.getByTestId('comp-delete-c1'))
    const warning = await screen.findByText(/gereksinimi var/i)
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveTextContent(/SİLİNMEZ/i)
  })
})

// ============================================================================
//  Issue #140: BILESEN bir URUNDUR, gereksinim degildir. Ikisi ekranda
//  birbirine benzemez:
//   - Haritada bilesen kutusu KOSELI, kendi (camgobegi) renginde ve ust
//     satirinda Parca No / "BILESEN" etiketi tasir; gereksinim kutusu
//     yuvarlak ve kendi seviye renginde kalir.
//   - Listede bilesen TABLONUN BASLIGIDIR (rozetiyle); tablonun satirlari
//     yalnizca gereksinimdir — alt kirilimi olan bir gereksinim artik
//     "bilesen satiri" gibi gosterilmez.
// ============================================================================
describe('Bileşen ile gereksinim ayrımı', () => {
  beforeEach(() => {
    appMock.components = [
      comp('c1', 'A Donanımı', { sortIndex: 0, partNo: '010.00.001' }),
      comp('c2', 'Alt Kart', { sortIndex: 0, parentId: 'c1' }),
    ]
    appMock.requirements = [
      {
        id: 'r1',
        text_id: 'R-001',
        title: 'Üst gereksinim',
        type: 'System Requirement',
        componentId: 'c1',
      },
      {
        id: 'r2',
        text_id: 'R-002',
        title: 'Alt gereksinim',
        type: 'Software Requirement',
        componentId: 'c1',
        parentId: 'r1',
      },
    ]
  })

  it('haritadaki TUM kutular bilesendir: koseli ve kendi renginde (#144)', () => {
    renderPage()
    // URUN dugumleri (proje koku + bilesenler): koseli kutu, camgobegi renk.
    const products = screen.getAllByTestId(/^mindmap-node-/)
    expect(products.length).toBeGreaterThan(0)
    for (const box of products) {
      expect(box).toHaveAttribute('rx', '3')
      expect(box.getAttribute('stroke')).toBe('#0d9488')
    }
  })

  it('harita GEREKSINIM kutusu cizmez; gereksinimler Liste gorunumundedir (#144)', () => {
    renderPage()
    // Tum dallar acilsa bile haritada gereksinim kutusu YOKTUR.
    for (const dot of screen.getAllByTestId(/^mindmap-toggle-/)) fireEvent.click(dot)
    expect(screen.queryByTestId('mindmap-node-R-001')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mindmap-node-R-002')).not.toBeInTheDocument()
    // Bagli gereksinim sayisi bilesenin ozet satirinda durur.
    expect(screen.getAllByText(/2 gereksinim/).length).toBeGreaterThan(0)
  })

  it('bileşen kutusu ÜRÜN olduğunu söyler (Parça No / BİLEŞEN etiketi)', () => {
    renderPage()
    // Parca No'su olan bilesen numarasini, olmayan "BİLEŞEN" etiketini tasir.
    expect(screen.getAllByText('010.00.001').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BİLEŞEN').length).toBeGreaterThan(0)
  })

  it('liste görünümünde başlık bileşendir, satırlar gereksinimdir', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-view-list'))
    fireEvent.click(screen.getByTestId('comp-item-c1'))
    // Baslik: bilesen rozeti + "bu bilesene bagli gereksinimler".
    expect(screen.getByTestId('comp-selected-kind')).toHaveTextContent('Bileşen')
    expect(screen.getByTestId('comp-selected-summary')).toHaveTextContent(
      /bu bileşene bağlı gereksinimler/i,
    )
    // Satirlar: her biri tipiyle birlikte bir GEREKSINIM.
    expect(screen.getByTestId('comp-row-type-R-001')).toHaveTextContent('SYS')
    expect(screen.getByTestId('comp-row-type-R-002')).toHaveTextContent('SW')
  })

  it('alt kırılımı olan gereksinim artık "bileşen satırı" gibi gösterilmez', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('comp-view-list'))
    fireEvent.click(screen.getByTestId('comp-item-c1'))
    // R-001'in alti var ama o bir gereksinim: bilesen isaretini TASIMAZ.
    expect(screen.getByTestId('comp-row-R-001')).not.toHaveAttribute('data-component')
  })
})

describe('Gereksinim bağlama (sonradan)', () => {
  beforeEach(() => {
    appMock.components = [comp('c1', 'Su Pompası Ünitesi', { sortIndex: 0 })]
    appMock.requirements = [
      { id: 'r1', text_id: 'R-001', title: 'Pompa basıncı', type: 'System Requirement' },
      {
        id: 'r2',
        text_id: 'R-002',
        title: 'Zaten bağlı',
        type: 'System Requirement',
        componentId: 'c1',
      },
    ]
  })

  it('bileşen gereksinim olmadan var olur; gereksinim sonradan bağlanır', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-link-c1'))
    const modal = await screen.findByTestId('comp-link-modal')
    // Zaten bagli olan isaretli gelir.
    expect(within(modal).getByTestId('comp-link-row-R-002')).toBeChecked()
    fireEvent.click(within(modal).getByTestId('comp-link-row-R-001'))
    fireEvent.click(within(modal).getByTestId('comp-link-save'))

    await waitFor(() =>
      expect(appMock.linkRequirementsToComponent).toHaveBeenCalledWith('c1', ['r1']),
    )
  })

  it('bir bileşene TEK SEFERDE birden fazla gereksinim bağlanır', async () => {
    appMock.requirements = [
      { id: 'r1', text_id: 'R-001', title: 'Bir', type: 'System Requirement' },
      { id: 'r2', text_id: 'R-002', title: 'Iki', type: 'System Requirement' },
      { id: 'r3', text_id: 'R-003', title: 'Uc', type: 'System Requirement' },
    ]
    renderList()
    fireEvent.click(screen.getByTestId('comp-link-c1'))
    const modal = await screen.findByTestId('comp-link-modal')
    fireEvent.click(within(modal).getByTestId('comp-link-row-R-001'))
    fireEvent.click(within(modal).getByTestId('comp-link-row-R-003'))
    expect(within(modal).getByTestId('comp-link-selected-count')).toHaveTextContent('2')
    fireEvent.click(within(modal).getByTestId('comp-link-save'))

    await waitFor(() =>
      expect(appMock.linkRequirementsToComponent).toHaveBeenCalledWith('c1', ['r1', 'r3']),
    )
  })

  it('"tümünü seç" ile listedeki tüm gereksinimler tek istekte bağlanır', async () => {
    appMock.requirements = [
      { id: 'r1', text_id: 'R-001', title: 'Bir', type: 'System Requirement' },
      { id: 'r2', text_id: 'R-002', title: 'Iki', type: 'System Requirement' },
      { id: 'r3', text_id: 'R-003', title: 'Uc', type: 'System Requirement' },
    ]
    renderList()
    fireEvent.click(screen.getByTestId('comp-link-c1'))
    const modal = await screen.findByTestId('comp-link-modal')
    fireEvent.click(within(modal).getByTestId('comp-link-select-all'))
    fireEvent.click(within(modal).getByTestId('comp-link-save'))

    await waitFor(() =>
      expect(appMock.linkRequirementsToComponent).toHaveBeenCalledWith('c1', ['r1', 'r2', 'r3']),
    )
  })

  // Regresyon: AppContext her mutasyondan sonra tum koleksiyonlari tazeler.
  // Modal acikken gelen bu tazeleme, kullanicinin isaretledigi kutulari
  // SILMEMELIDIR — aksi halde tek seferde yalnizca tek bir gereksinim
  // baglanabiliyordu.
  it('modal açıkken veri tazelense de işaretlenen gereksinimler korunur', async () => {
    const fresh = () => [
      { id: 'r1', text_id: 'R-001', title: 'Bir', type: 'System Requirement' },
      { id: 'r2', text_id: 'R-002', title: 'Iki', type: 'System Requirement' },
    ]
    appMock.requirements = fresh()
    const { rerender } = renderList()
    fireEvent.click(screen.getByTestId('comp-link-c1'))
    const modal = await screen.findByTestId('comp-link-modal')
    fireEvent.click(within(modal).getByTestId('comp-link-row-R-001'))

    // Arka planda tazeleme: ayni veri, YENI dizi kimligi.
    appMock.requirements = fresh()
    rerender(
      <LanguageProvider>
        <Components />
      </LanguageProvider>,
    )
    expect(within(modal).getByTestId('comp-link-row-R-001')).toBeChecked()

    fireEvent.click(within(modal).getByTestId('comp-link-row-R-002'))
    fireEvent.click(within(modal).getByTestId('comp-link-save'))
    await waitFor(() =>
      expect(appMock.linkRequirementsToComponent).toHaveBeenCalledWith('c1', ['r1', 'r2']),
    )
  })

  it('bağ kaldırılabilir', async () => {
    renderList()
    fireEvent.click(screen.getByTestId('comp-link-c1'))
    const modal = await screen.findByTestId('comp-link-modal')
    fireEvent.click(within(modal).getByTestId('comp-link-row-R-002'))
    fireEvent.click(within(modal).getByTestId('comp-link-save'))
    await waitFor(() =>
      expect(appMock.linkRequirementsToComponent).toHaveBeenCalledWith(null, ['r2']),
    )
  })
})

describe('Mevcut projeler bozulmaz', () => {
  it('kaynak secici YOKTUR: bilesenler tek kaynaktir (#147)', () => {
    appMock.components = []
    appMock.requirements = [
      { id: 'u1', text_id: 'R-001', title: 'Sistem', type: 'User Requirement' },
      {
        id: 's1',
        parentId: 'u1',
        text_id: 'R-002',
        title: 'Su Deposu',
        type: 'System Requirement',
      },
    ]
    renderPage()
    expect(screen.queryByTestId('comp-source-pbs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comp-source-manual')).not.toBeInTheDocument()
    // PBS kirilimi bir bilesen kaynagi degildir: bilesen sayisi 0'dir.
    expect(screen.getByTestId('comp-counts')).toHaveTextContent('0 bileşen')
  })

  it('PBS kırılımı olan projede tek seferlik içe aktarma sunulur', async () => {
    appMock.components = []
    appMock.requirements = [
      { id: 'u1', text_id: 'R-001', title: 'Sistem', type: 'User Requirement' },
      {
        id: 's1',
        parentId: 'u1',
        text_id: 'R-002',
        title: 'Su Deposu',
        type: 'System Requirement',
      },
    ]
    renderList()
    fireEvent.click(await screen.findByTestId('comp-import-pbs'))
    await waitFor(() => expect(appMock.importComponentsFromPbs).toHaveBeenCalled())
  })
})

describe('Harita görünümü', () => {
  it('elle kurulmuş kırılımı harita da gösterir', async () => {
    appMock.components = [
      comp('c1', 'Su Pompası Ünitesi', { sortIndex: 0 }),
      comp('c2', 'Donanım', { parentId: 'c1', sortIndex: 0 }),
    ]
    renderPage()
    // Harita varsayilan gorunumdur; bilesen kutusu erisilebilir adiyla bulunur
    // (kaydi olmadigi icin text_id bos, etiket bilesen adidir).
    expect(screen.getByTestId('mindmap-canvas')).toBeInTheDocument()
    expect(
      await screen.findByLabelText(/^Bileşen \(ürün\):.*Su Pompası Ünitesi/),
    ).toBeInTheDocument()
  })
})

// Issue #155: alt bilesen Liste'ye gecmeden HARITA uzerinden eklenir.
describe('Harita: alt bileşen ekleme', () => {
  beforeEach(() => {
    appMock.components = [
      comp('c1', 'Su Pompası Ünitesi', { sortIndex: 0 }),
      comp('c2', 'Tank', { sortIndex: 1 }),
    ]
  })

  it('kutunun köşesindeki + ile açılan form ebeveyni doğru kaydeder', async () => {
    renderPage()
    fireEvent.click(await screen.findByTestId('mindmap-add-c1'))
    fireEvent.change(await screen.findByTestId('comp-name-input'), {
      target: { value: 'Donanım' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() =>
      expect(appMock.addComponent).toHaveBeenCalledWith({
        name: 'Donanım',
        partNo: expect.any(String),
        parentId: 'c1',
      }),
    )
  })

  it('proje kökündeki + üst seviye bileşen ekler', async () => {
    renderPage()
    fireEvent.click(await screen.findByTestId('mindmap-add-__project__'))
    fireEvent.change(await screen.findByTestId('comp-name-input'), {
      target: { value: 'STC' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() =>
      expect(appMock.addComponent).toHaveBeenCalledWith({
        name: 'STC',
        partNo: expect.any(String),
        parentId: null,
      }),
    )
  })

  it('kayıttan sonra ebeveynin dalı açılır ve yeni kutu görünür', async () => {
    const { rerender } = renderPage()
    fireEvent.click(await screen.findByTestId('mindmap-add-c1'))
    fireEvent.change(await screen.findByTestId('comp-name-input'), {
      target: { value: 'Donanım' },
    })
    fireEvent.click(screen.getByTestId('comp-form-save'))
    await waitFor(() => expect(appMock.addComponent).toHaveBeenCalledTimes(1))
    appMock.components = [...appMock.components, comp('new-1', 'Donanım', { parentId: 'c1' })]
    rerender(
      <LanguageProvider>
        <Components />
      </LanguageProvider>,
    )
    expect(await screen.findByTestId('mindmap-node-new-1')).toBeInTheDocument()
  })

  it('yazma yetkisi yoksa haritada + görünmez', async () => {
    authMock.value = { can: () => false, isPM: false }
    renderPage()
    expect(await screen.findByTestId('mindmap-node-c1')).toBeInTheDocument()
    expect(screen.queryByTestId('mindmap-add-c1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comp-map-hint-add')).not.toBeInTheDocument()
  })
})
