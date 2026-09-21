// ============================================================================
//  SnapshotsBaseline.test.jsx — Baseline arayuzu (Issue #128).
//
//  Kapsam:
//   - Surum etiketi + aciklama girilebiliyor, baseline isaretlenebiliyor
//   - Baseline gerekce alani yalnizca isaret koyulunca cikiyor
//   - Listede baseline ROZETLE ayriliyor; kim/ne zaman/gerekce gorunuyor
//   - Geri yukleme ONCE onizleme gosteriyor, sonra gerekce istiyor
//   - Onizleme iptal edilirse restore CAGRILMIYOR
//   - Baseline silmede force (ozel izin) tasiniyor
//   - PM olmayan kullanici geri yukleme dugmesini gormuyor
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock, authMock, api } = vi.hoisted(() => ({
  appMock: {
    projectId: 'p1',
    snapshots: [],
    loading: false,
    createSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    updateSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
  },
  authMock: { value: { isPM: true, can: () => true } },
  api: {
    getSnapshot: vi.fn(),
    getRestorePreview: vi.fn(),
    getSnapshotDiff: vi.fn(),
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
vi.mock('../../services/dataService.js', () => api)

import SnapshotsPage from '../Snapshots.jsx'

const BASELINE = {
  id: 'snap-baseline',
  name: 'Teslim 1',
  label: 'v1.0',
  description: 'SRR teslimi',
  reason: 'Musteriye teslim edildi',
  isBaseline: true,
  kind: 'baseline',
  createdBy: 'pm-1',
  createdAt: '2026-01-01T10:00:00.000Z',
}
const ORDINARY = {
  id: 'snap-plain',
  name: 'Ara kayit',
  label: null,
  description: '',
  reason: null,
  isBaseline: false,
  kind: 'manual',
  createdBy: 'pm-1',
  createdAt: '2026-01-02T10:00:00.000Z',
}

const PLAN = {
  snapshot: { id: BASELINE.id, name: BASELINE.name },
  summary: {
    requirement: { added: 2, updated: 5, deleted: 1 },
    testcase: { added: 0, updated: 3, deleted: 0 },
    link: { added: 1, updated: 0, deleted: 0 },
    glossary: { added: 0, updated: 0, deleted: 0 },
    attributeDef: { added: 0, updated: 2, deleted: 0 },
  },
  totals: { added: 3, updated: 10, deleted: 1 },
}

const renderPage = () =>
  render(
    <LanguageProvider>
      <SnapshotsPage />
    </LanguageProvider>,
  )

beforeEach(() => {
  appMock.snapshots = [BASELINE, ORDINARY]
  appMock.loading = false
  appMock.createSnapshot = vi.fn().mockResolvedValue({})
  appMock.deleteSnapshot = vi.fn().mockResolvedValue({})
  appMock.updateSnapshot = vi.fn().mockResolvedValue({})
  appMock.restoreSnapshot = vi.fn().mockResolvedValue({ safetySnapshotName: '[otomatik] yedek' })
  authMock.value = { isPM: true, can: () => true }
  api.getRestorePreview.mockResolvedValue(PLAN)
  api.getSnapshotDiff.mockResolvedValue({ entries: [], summary: {}, totals: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Baseline — etiketleme', () => {
  it('yeni snapshot formunda surum etiketi ve aciklama girilebilir', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-new'))
    expect(screen.getByTestId('snapshot-label-input')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-desc-input')).toBeInTheDocument()
  })

  it('gerekce alani YALNIZCA baseline isaretlenince cikar', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-new'))
    expect(screen.queryByTestId('snapshot-reason-input')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('snapshot-baseline-checkbox'))
    expect(screen.getByTestId('snapshot-reason-input')).toBeInTheDocument()
  })

  it('baseline etiket + gerekce ile olusturulur', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-new'))
    fireEvent.change(screen.getByTestId('snapshot-name-input'), { target: { value: 'Teslim 2' } })
    fireEvent.change(screen.getByTestId('snapshot-label-input'), { target: { value: 'v2.0' } })
    fireEvent.change(screen.getByTestId('snapshot-desc-input'), { target: { value: 'CDR' } })
    fireEvent.click(screen.getByTestId('snapshot-baseline-checkbox'))
    fireEvent.change(screen.getByTestId('snapshot-reason-input'), {
      target: { value: 'CDR teslimi' },
    })
    fireEvent.click(screen.getByTestId('snapshot-create-submit'))

    await waitFor(() =>
      expect(appMock.createSnapshot).toHaveBeenCalledWith({
        name: 'Teslim 2',
        label: 'v2.0',
        description: 'CDR',
        isBaseline: true,
        reason: 'CDR teslimi',
      }),
    )
  })

  it('sunucu hatasi formda gosterilir ve form acik kalir', async () => {
    appMock.createSnapshot = vi
      .fn()
      .mockRejectedValue(new Error('Baseline icin gerekce zorunludur.'))
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-new'))
    fireEvent.change(screen.getByTestId('snapshot-name-input'), { target: { value: 'X' } })
    fireEvent.click(screen.getByTestId('snapshot-create-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('snapshot-form-error')).toHaveTextContent(/gerekce/i),
    )
    expect(screen.getByTestId('snapshot-name-input')).toBeInTheDocument()
  })
})

describe('Baseline — listede ayirt edilir', () => {
  it('baseline ROZETLE isaretlenir, siradan snapshot isaretlenmez', () => {
    renderPage()
    expect(screen.getByTestId(`snapshot-baseline-${BASELINE.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`snapshot-baseline-${ORDINARY.id}`)).not.toBeInTheDocument()
  })

  it('surum etiketi, gerekce ve alan kisi listede gorunur', () => {
    renderPage()
    expect(screen.getByText('v1.0')).toBeInTheDocument()
    expect(screen.getByText(/Musteriye teslim edildi/)).toBeInTheDocument()
    expect(screen.getAllByText('pm-1').length).toBeGreaterThan(0)
  })

  it('ust verisi ayri bir modalda duzenlenir (icerik degismez)', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-edit-${ORDINARY.id}`))
    fireEvent.change(screen.getByTestId('snapshot-meta-label'), { target: { value: 'PDR' } })
    fireEvent.click(screen.getByTestId('snapshot-meta-save'))
    await waitFor(() =>
      expect(appMock.updateSnapshot).toHaveBeenCalledWith(
        ORDINARY.id,
        expect.objectContaining({ label: 'PDR' }),
      ),
    )
  })

  it('baseline isaretini degistirmek gerekce istemeden kaydedilemez', () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-edit-${ORDINARY.id}`))
    fireEvent.click(screen.getByTestId('snapshot-meta-baseline'))
    expect(screen.getByTestId('snapshot-meta-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('snapshot-meta-reason'), { target: { value: 'PDR oldu' } })
    expect(screen.getByTestId('snapshot-meta-save')).not.toBeDisabled()
  })
})

describe('Baseline — silme', () => {
  it('baseline silmede OZEL IZIN (force) tasinir', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-delete-${BASELINE.id}`))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Yanlis alindi' } })
    fireEvent.click(screen.getByText('Sil'))
    await waitFor(() =>
      expect(appMock.deleteSnapshot).toHaveBeenCalledWith(BASELINE.id, 'Yanlis alindi', true),
    )
  })

  it('siradan snapshot silmede force FALSE gider', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-delete-${ORDINARY.id}`))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Gereksiz' } })
    fireEvent.click(screen.getByText('Sil'))
    await waitFor(() =>
      expect(appMock.deleteSnapshot).toHaveBeenCalledWith(ORDINARY.id, 'Gereksiz', false),
    )
  })
})

describe('Baseline — geri yukleme', () => {
  it('once ONIZLEME gosterilir: kac kayit eklenecek/guncellenecek/silinecek', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-restore-${BASELINE.id}`))
    await waitFor(() => expect(screen.getByTestId('restore-totals')).toBeInTheDocument())
    const totals = within(screen.getByTestId('restore-totals'))
    expect(totals.getByText('+3')).toBeInTheDocument()
    expect(totals.getByText('~10')).toBeInTheDocument()
    expect(totals.getByText('-1')).toBeInTheDocument()
    // Tip bazinda kirilim da gorunur.
    const row = within(screen.getByTestId('restore-row-requirement'))
    expect(row.getByText('2')).toBeInTheDocument()
    expect(row.getByText('5')).toBeInTheDocument()
  })

  it('onizleme HICBIR SEY uygulamaz — restore cagrilmaz', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-restore-${BASELINE.id}`))
    await waitFor(() => expect(screen.getByTestId('restore-totals')).toBeInTheDocument())
    expect(appMock.restoreSnapshot).not.toHaveBeenCalled()
  })

  it('onizlemeden sonra GEREKCE istenir ve restore o zaman calisir', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-restore-${BASELINE.id}`))
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('restore-confirm'))

    const textbox = await screen.findByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'v1.0 teslim noktasina donuluyor' } })
    fireEvent.click(screen.getByText('Sil'))

    await waitFor(() =>
      // Ucuncu arguman KISMI restore secimi; tam restore'da null gecer (#128).
      expect(appMock.restoreSnapshot).toHaveBeenCalledWith(
        BASELINE.id,
        'v1.0 teslim noktasina donuluyor',
        null,
      ),
    )
  })

  it('tamamlaninca guvenlik kopyasinin adi duyurulur (islem geri alinabilir)', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-restore-${BASELINE.id}`))
    await waitFor(() => expect(screen.getByTestId('restore-confirm')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('restore-confirm'))
    const textbox = await screen.findByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'Geri donuluyor' } })
    fireEvent.click(screen.getByText('Sil'))
    await waitFor(() => expect(screen.getByTestId('restore-done')).toBeInTheDocument())
    expect(screen.getByText(/otomatik\] yedek/)).toBeInTheDocument()
  })

  it('PM olmayan kullanici geri yukleme dugmesini gormez', () => {
    authMock.value = { isPM: false, can: () => true }
    renderPage()
    expect(screen.queryByTestId(`snapshot-restore-${BASELINE.id}`)).not.toBeInTheDocument()
  })
})

describe('Baseline — fark raporu', () => {
  it('karsilastirma penceresi iki taraf secimiyle acilir', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    expect(screen.getByTestId('diff-from')).toBeInTheDocument()
    expect(screen.getByTestId('diff-to')).toBeInTheDocument()
  })

  it('varsayilan kaynak en yeni BASELINE, hedef CANLI durumdur', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    expect(screen.getByTestId('diff-from')).toHaveValue(BASELINE.id)
    expect(screen.getByTestId('diff-to')).toHaveValue('live')
  })

  it('karsilastir dugmesi secilen taraflarla servisi cagirir', async () => {
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    fireEvent.change(screen.getByTestId('diff-to'), { target: { value: ORDINARY.id } })
    fireEvent.click(screen.getByTestId('diff-run'))
    await waitFor(() =>
      expect(api.getSnapshotDiff).toHaveBeenCalledWith('p1', BASELINE.id, ORDINARY.id),
    )
  })

  it('fark sonucu ozeti ve satirlari listelenir', async () => {
    api.getSnapshotDiff.mockResolvedValue({
      from: { id: BASELINE.id, name: 'Teslim 1' },
      to: { id: 'live', isLive: true },
      summary: {},
      totals: { added: 1, removed: 0, changed: 1, unchanged: 4 },
      entries: [
        {
          entityType: 'requirement',
          entityId: 'r1',
          label: 'REQ-SYS-001',
          status: 'changed',
          fields: [{ field: 'title', from: 'Eski', to: 'Yeni' }],
        },
        {
          entityType: 'requirement',
          entityId: 'r2',
          label: 'REQ-SYS-002',
          status: 'added',
          fields: [],
        },
      ],
    })
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    fireEvent.click(screen.getByTestId('diff-run'))

    await waitFor(() => expect(screen.getByTestId('diff-row-r1')).toBeInTheDocument())
    expect(screen.getByTestId('diff-summary')).toHaveTextContent('+1')
    const row = within(screen.getByTestId('diff-row-r1'))
    expect(row.getByText('REQ-SYS-001')).toBeInTheDocument()
    expect(row.getByText('Eski')).toBeInTheDocument()
    expect(row.getByText('Yeni')).toBeInTheDocument()
  })

  it('duruma gore filtreleme listeyi daraltir', async () => {
    api.getSnapshotDiff.mockResolvedValue({
      from: {},
      to: {},
      summary: {},
      totals: { added: 1, removed: 0, changed: 1, unchanged: 0 },
      entries: [
        { entityType: 'requirement', entityId: 'r1', label: 'A', status: 'changed', fields: [] },
        { entityType: 'requirement', entityId: 'r2', label: 'B', status: 'added', fields: [] },
      ],
    })
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    fireEvent.click(screen.getByTestId('diff-run'))
    await waitFor(() => expect(screen.getByTestId('diff-row-r1')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('diff-status-filter'), { target: { value: 'added' } })
    expect(screen.queryByTestId('diff-row-r1')).not.toBeInTheDocument()
    expect(screen.getByTestId('diff-row-r2')).toBeInTheDocument()
  })

  it('hata mesaji kullaniciya gosterilir', async () => {
    api.getSnapshotDiff.mockRejectedValue(new Error('Karsilastirma icin iki FARKLI taraf'))
    renderPage()
    fireEvent.click(screen.getByTestId('snapshot-compare'))
    fireEvent.click(screen.getByTestId('diff-run'))
    await waitFor(() => expect(screen.getByTestId('diff-error')).toHaveTextContent(/FARKLI/))
  })
})
