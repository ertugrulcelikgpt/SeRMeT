// ============================================================================
//  ViewModalBaselines.test.jsx — Issue #128, madde 5.
//  Kayit detayindaki "Baseline'lar" sekmesi:
//   - Kaydin icinde oldugu baseline'lar listeleniyor (etiket/modul/surum/set)
//   - Bir baseline'a tiklaninca o surumdeki hal SALT OKUNUR aciliyor
//   - Canli halle ALAN BAZINDA fark gosteriliyor; degismemisse bu soyleniyor
//   - Hicbir baseline'da yer almayan kayit icin durum ACIKCA belirtiliyor
//   - Prop verilmezse sekme hic cizilmiyor
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../../context/LanguageContext.jsx'

const { api } = vi.hoisted(() => ({
  api: { listEntityBaselines: vi.fn(), getEntityBaselineDetail: vi.fn() },
}))

vi.mock('../../../context/AppContext.jsx', () => ({
  useApp: () => ({ attributeDefs: [], personnel: [], projectId: 'p1', links: [], testCases: [] }),
  AppProvider: ({ children }) => children,
}))
vi.mock('../../../services/dataService.js', () => api)
vi.mock('../RichTextEditor.jsx', () => ({
  default: ({ value }) => <div data-testid="rte">{value}</div>,
}))

import ViewModal from '../ViewModal.jsx'

const ROW = {
  id: 'r1',
  text_id: 'EH-SYS-001',
  title: 'Espresso demleme suresi',
  description: 'Sistem 25 saniye icinde uretmelidir.',
  type: 'System Requirement',
  status: 'Approved',
  attributes: {},
}

const BASELINE = {
  id: 'snap-srs',
  name: 'SRS',
  label: 'v1.0',
  isBaseline: true,
  kind: 'baseline',
  scope: 'module',
  modules: ['req-system'],
  moduleKey: 'req-system',
  version: 1,
  setId: 'set-1',
  setName: 'CDR paketi',
  createdBy: 'pm-1',
  createdAt: '2026-01-01T10:00:00.000Z',
}

const Wrap = ({ children }) => <LanguageProvider>{children}</LanguageProvider>

const renderModal = (props = {}) =>
  render(
    <Wrap>
      <ViewModal open row={ROW} onClose={vi.fn()} baselineEntityType="requirement" {...props} />
    </Wrap>,
  )

/** Sekmeyi acar (sekme yalnizca baselineEntityType verilince cizilir). */
const openTab = async () => {
  renderModal()
  fireEvent.click(await screen.findByTestId('view-tab-baselines'))
}

beforeEach(() => {
  api.listEntityBaselines.mockResolvedValue({
    entityType: 'requirement',
    entityId: ROW.id,
    baselines: [BASELINE],
    total: 1,
  })
  api.getEntityBaselineDetail.mockResolvedValue({
    snapshot: BASELINE,
    entityType: 'requirement',
    entityId: ROW.id,
    data: { text_id: 'EH-SYS-001', title: 'Eski baslik', status: 'In Review' },
    live: ROW,
    liveDeleted: false,
    fields: [
      { field: 'title', from: 'Eski baslik', to: 'Espresso demleme suresi' },
      { field: 'status', from: 'In Review', to: 'Approved' },
    ],
    changed: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ViewModal — Baseline'lar sekmesi", () => {
  it('prop verilmezse sekme HIC cizilmez', () => {
    render(
      <Wrap>
        <ViewModal open row={ROW} onClose={vi.fn()} />
      </Wrap>,
    )
    expect(screen.queryByTestId('view-tab-baselines')).not.toBeInTheDocument()
  })

  it("kaydin icinde oldugu baseline'lari etiket/modul/surum/set ile listeler", async () => {
    await openTab()
    const row = await screen.findByTestId(`baseline-row-${BASELINE.id}`)
    expect(row).toHaveTextContent('SRS')
    expect(row).toHaveTextContent('v1.0')
    expect(row).toHaveTextContent('Sistem Gereksinimleri')
    expect(row).toHaveTextContent('CDR paketi')
    expect(api.listEntityBaselines).toHaveBeenCalledWith('p1', 'requirement', 'r1')
  })

  it("baseline'a tiklaninca o surumdeki hal ve ALAN BAZINDA fark acilir", async () => {
    await openTab()
    fireEvent.click(await screen.findByTestId(`baseline-row-${BASELINE.id}`))

    const detail = await screen.findByTestId('baseline-detail')
    // Baseline anindaki (dondurulmus) hal.
    expect(detail).toHaveTextContent('Eski baslik')
    // Alan bazinda fark: eski -> yeni.
    const fields = screen.getByTestId('baseline-fields')
    expect(fields).toHaveTextContent('title')
    expect(fields).toHaveTextContent('Espresso demleme suresi')
    expect(fields).toHaveTextContent('status')
    expect(api.getEntityBaselineDetail).toHaveBeenCalledWith('p1', 'requirement', 'r1', BASELINE.id)
  })

  it('kayit o surumden beri degismediyse bu acikca soylenir', async () => {
    api.getEntityBaselineDetail.mockResolvedValue({
      snapshot: BASELINE,
      entityType: 'requirement',
      entityId: ROW.id,
      data: { text_id: 'EH-SYS-001', title: ROW.title, status: ROW.status },
      live: ROW,
      liveDeleted: false,
      fields: [],
      changed: false,
    })
    await openTab()
    fireEvent.click(await screen.findByTestId(`baseline-row-${BASELINE.id}`))
    expect(await screen.findByTestId('baseline-unchanged')).toHaveTextContent('değişmedi')
  })

  it('hicbir baselineda yer almayan kayit icin durum ACIKCA belirtilir', async () => {
    api.listEntityBaselines.mockResolvedValue({
      entityType: 'requirement',
      entityId: ROW.id,
      baselines: [],
      total: 0,
    })
    await openTab()
    const empty = await screen.findByTestId('baselines-empty')
    expect(empty).toHaveTextContent('hiçbir baseline’da yer almıyor')
    expect(empty).toHaveTextContent('Henüz hiçbir sürüme girmemiş')
  })

  it('detay bir kez cekilir; sekme kapanip acilinca tekrar istenmez', async () => {
    await openTab()
    const row = await screen.findByTestId(`baseline-row-${BASELINE.id}`)
    fireEvent.click(row)
    await screen.findByTestId('baseline-detail')
    fireEvent.click(row) // kapat
    fireEvent.click(row) // tekrar ac
    await screen.findByTestId('baseline-detail')
    expect(api.getEntityBaselineDetail).toHaveBeenCalledTimes(1)
  })

  it('liste yuklenemezse hata mesaji gosterilir', async () => {
    api.listEntityBaselines.mockRejectedValue(new Error('ag hatasi'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await openTab()
    await waitFor(() =>
      expect(screen.getByText('Baseline listesi yüklenemedi.')).toBeInTheDocument(),
    )
  })
})
