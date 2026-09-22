// ============================================================================
//  ComponentsPartNo.test.jsx — Parca No, "Bileşenler" sayfasinda (Issue #135).
//
//  Kabul kriterleri bu sayfada karsilanir — AYRI bir ekran yoktur:
//   - Sayfa acilinca numarasiz dugumlere Parca No atanir (ensure, idempotent)
//   - Her bilesen listede/tabloda/haritada Parca No ile gorunur
//   - Ayni adli ama farkli dallardaki bilesenler FARKLI numara tasir
//   - Kullanici numarayi elle degistirebilir; cakisma kaydedilmez, uyari cikar
//   - Parca No ile arama yapilabilir
//   - Tutarlilik bulgulari rozet + liste olarak sunulur
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock, api } = vi.hoisted(() => ({
  appMock: {
    projectId: 'p1',
    requirements: [],
    testCases: [],
    links: [],
    attributeDefs: [],
    theme: 'light',
    refresh: vi.fn(),
  },
  authMock: { value: { can: () => true, isPM: true } },
  api: {
    ensurePartNumbers: vi.fn(),
    checkPartNumbers: vi.fn(),
    setPartNo: vi.fn(),
    setPartNoConfig: vi.fn(),
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
  useProject: () => ({ activeProject: { id: 'p1', name: 'Sistem' } }),
  ProjectProvider: ({ children }) => children,
}))
vi.mock('../../services/dataService.js', () => api)
vi.mock('../../components/common/ViewModal.jsx', () => ({ default: () => null }))

import Components from '../Components.jsx'

// Issue'daki ornek agac: ayni adli GY1'ler AMTB ve STC dallarinda.
const SISTEM = {
  id: 'sys',
  text_id: 'R-001',
  title: 'Sistem',
  type: 'User Requirement',
  partNo: '100.00.001',
}
const AMTB = {
  id: 'amtb',
  parentId: 'sys',
  text_id: 'R-002',
  title: 'AMTB',
  type: 'System Requirement',
  partNo: '100.00.002',
  partNoBlock: '320',
}
const STC = {
  id: 'stc',
  parentId: 'sys',
  text_id: 'R-003',
  title: 'STC',
  type: 'System Requirement',
  partNo: '100.00.003',
  partNoBlock: '340',
}
const AMTB_GY1 = {
  id: 'a-gy1',
  parentId: 'amtb',
  text_id: 'R-004',
  title: 'GY1',
  type: 'Software Requirement',
  partNo: '320.00.001',
}
const STC_GY1 = {
  id: 's-gy1',
  parentId: 'stc',
  text_id: 'R-005',
  title: 'GY1',
  type: 'Software Requirement',
  partNo: '340.00.001',
}

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

const showList = () => fireEvent.click(screen.getByTestId('comp-view-list'))

beforeEach(() => {
  appMock.requirements = [SISTEM, AMTB, STC, AMTB_GY1, STC_GY1]
  appMock.testCases = []
  appMock.links = []
  appMock.refresh = vi.fn()
  authMock.value = { can: () => true, isPM: true }
  api.ensurePartNumbers.mockResolvedValue({ assigned: 0, skipped: 5, items: [] })
  api.checkPartNumbers.mockResolvedValue(CLEAN_CHECK)
  api.setPartNo.mockResolvedValue({})
  api.setPartNoConfig.mockResolvedValue({ format: 'NNN.NN.NNN', blockStep: 10 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Parça No — otomatik atama', () => {
  it('sayfa acilinca numarasiz düğümlere numara atanır (kullanıcı eylemi gerekmez)', async () => {
    renderPage()
    await waitFor(() => expect(api.ensurePartNumbers).toHaveBeenCalledWith('p1'))
  })

  it('atama yapıldıysa veri tazelenir ki numaralar aynı renderda görünsün', async () => {
    api.ensurePartNumbers.mockResolvedValue({ assigned: 3, skipped: 2, items: [] })
    renderPage()
    await waitFor(() => expect(appMock.refresh).toHaveBeenCalled())
  })

  it('atama başarısız olsa bile sayfa açılır', async () => {
    api.ensurePartNumbers.mockRejectedValue(new Error('yetki yok'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('comp-counts')).toBeInTheDocument())
  })
})

describe('Parça No — görünürlük', () => {
  it('bileşen listesinde her bileşenin Parça No’su yazar', async () => {
    renderPage()
    showList()
    await waitFor(() =>
      expect(screen.getByTestId('comp-partno-amtb')).toHaveTextContent('100.00.002'),
    )
    expect(screen.getByTestId('comp-partno-stc')).toHaveTextContent('100.00.003')
  })

  it('TİD tablosunda Parça No sütunu kayıt bazında dolar', async () => {
    renderPage()
    showList()
    await waitFor(() => expect(screen.getByTestId('comp-row-partno-R-004')).toBeInTheDocument())
    expect(screen.getByTestId('comp-row-partno-R-004')).toHaveTextContent('320.00.001')
    expect(screen.getByTestId('comp-row-partno-R-005')).toHaveTextContent('340.00.001')
  })

  it('aynı adlı GY1 bileşenleri FARKLI Parça No taşır (AMTB ≠ STC)', async () => {
    renderPage()
    showList()
    await waitFor(() => expect(screen.getByTestId('comp-row-partno-R-004')).toBeInTheDocument())
    const amtbGy1 = screen.getByTestId('comp-row-partno-R-004').textContent
    const stcGy1 = screen.getByTestId('comp-row-partno-R-005').textContent
    expect(amtbGy1).not.toBe(stcGy1)
  })

  it('haritada gereksinim kutusu Parça No YAZMAZ, numara ipucunda kalır (#143)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('mindmap-node-R-001')).toBeInTheDocument())
    // Kutunun ust satirinda gereksinimin KENDI kodu durur (#140); urun
    // kimligi olan Parca No gereksinim satirina yazilmaz (#143).
    expect(screen.getByText('R-001')).toBeInTheDocument()
    expect(screen.queryByText('100.00.001')).not.toBeInTheDocument()
    expect(screen.getByTestId('mindmap-node-R-001').querySelector('title')?.textContent).toContain(
      '100.00.001',
    )
  })
})

describe('Parça No — arama', () => {
  it('bileşenler Parça No ile aranabilir', async () => {
    renderPage()
    showList()
    await waitFor(() => expect(screen.getByTestId('comp-item-amtb')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('comp-search'), { target: { value: '100.00.003' } })
    expect(screen.queryByTestId('comp-item-amtb')).not.toBeInTheDocument()
    expect(screen.getByTestId('comp-item-stc')).toBeInTheDocument()
  })
})

describe('Parça No — elle düzenleme', () => {
  const openEditor = async () => {
    renderPage()
    showList()
    await waitFor(() => expect(screen.getByTestId('comp-item-amtb')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('comp-item-amtb'))
    fireEvent.click(screen.getByTestId('partno-edit'))
  }

  it('seçili bileşenin numarası aynı sayfada değiştirilebilir', async () => {
    await openEditor()
    fireEvent.change(screen.getByTestId('partno-input'), { target: { value: '100.00.099' } })
    fireEvent.click(screen.getByTestId('partno-save'))
    await waitFor(() =>
      expect(api.setPartNo).toHaveBeenCalledWith('p1', 'amtb', {
        partNo: '100.00.099',
        partNoBlock: '320',
      }),
    )
  })

  it('çakışma kaydedilmez; sunucunun uyarısı gösterilir ve form açık kalır', async () => {
    api.setPartNo.mockRejectedValue(new Error('Parca No 100.00.003 zaten kullanilmis'))
    await openEditor()
    fireEvent.change(screen.getByTestId('partno-input'), { target: { value: '100.00.003' } })
    fireEvent.click(screen.getByTestId('partno-save'))
    await waitFor(() => expect(screen.getByTestId('partno-error')).toHaveTextContent(/zaten/i))
    expect(screen.getByTestId('partno-form')).toBeInTheDocument()
  })

  it('yazma izni olmayan kullanıcıya düzenleme düğmesi gösterilmez', async () => {
    authMock.value = { can: () => false, isPM: false }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('comp-counts')).toBeInTheDocument())
    expect(screen.queryByTestId('partno-edit')).not.toBeInTheDocument()
  })
})

describe('Parça No — tutarlılık kontrolü', () => {
  it('bulgu yoksa rozet "temiz" der', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('partno-issues')).toHaveTextContent(/temiz/i))
  })

  it('ihlaller rozette sayılır ve panelde listelenir', async () => {
    api.checkPartNumbers.mockResolvedValue({
      ...CLEAN_CHECK,
      total: 2,
      errorCount: 1,
      issues: [
        {
          code: 'BLOCK_MISMATCH',
          severity: 'error',
          requirementId: 'a-gy1',
          partNo: '320.00.001',
          message: 'Blok dışında.',
        },
        {
          code: 'DUPLICATE_SIBLING_NAME',
          severity: 'warn',
          requirementId: 'stc',
          partNo: '100.00.003',
          message: 'Aynı adlı kardeş.',
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('partno-issues')).toHaveTextContent('2'))
    fireEvent.click(screen.getByTestId('partno-issues'))
    const panel = within(screen.getByTestId('partno-panel'))
    expect(panel.getByText('Blok aralığı dışında')).toBeInTheDocument()
    expect(panel.getByText('Aynı adlı kardeş')).toBeInTheDocument()
  })
})

describe('Parça No — proje ayarları', () => {
  it('PM biçimi aynı sayfadan değiştirebilir', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('partno-settings')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('partno-settings'))
    fireEvent.change(screen.getByTestId('partno-format-input'), { target: { value: 'NN-NNNN' } })
    fireEvent.click(screen.getByText('Kaydet'))
    await waitFor(() => expect(api.setPartNoConfig).toHaveBeenCalledWith('p1', 'NN-NNNN', 10))
  })

  it('PM olmayan kullanıcıya ayar düğmesi gösterilmez', async () => {
    authMock.value = { can: () => true, isPM: false }
    renderPage()
    await waitFor(() => expect(screen.getByTestId('comp-counts')).toBeInTheDocument())
    expect(screen.queryByTestId('partno-settings')).not.toBeInTheDocument()
  })
})
