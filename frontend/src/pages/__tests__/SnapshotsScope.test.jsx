// ============================================================================
//  SnapshotsScope.test.jsx — Baseline KAPSAMI arayuzu (Issue #128, 2. asama).
//
//  Kapsam:
//   - Kapsam secilebiliyor: tum proje / tek modul / birkac modul
//   - Birden cok modul secilince "baseline seti" uyarisi cikiyor
//   - Listede kapsam, modul surumu ve set rozetleri gorunuyor
//   - Geri yukleme onizlemesi kapsami ve kapsam disi bag sayisini soyluyor
//   - Kismi geri yukleme: yalnizca secili kayitlar gonderiliyor
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
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

// Modul baseline'i: kendi surum sayacinda 2. surum, bir set icinde.
const MODULE_BASELINE = {
  id: 'snap-srs',
  name: 'SRS',
  label: 'v1.1',
  description: '',
  reason: 'Sistem gereksinimleri donduruldu',
  isBaseline: true,
  kind: 'baseline',
  scope: 'module',
  modules: ['req-system'],
  moduleKey: 'req-system',
  version: 2,
  set: { id: 'set-1', name: 'CDR paketi', label: 'CDR' },
  createdBy: 'pm-1',
  createdAt: '2026-01-03T10:00:00.000Z',
}

const PROJECT_SNAPSHOT = {
  id: 'snap-all',
  name: 'Tum proje',
  label: null,
  description: '',
  reason: null,
  isBaseline: false,
  kind: 'manual',
  scope: 'project',
  modules: null,
  moduleKey: null,
  version: null,
  createdBy: 'pm-1',
  createdAt: '2026-01-04T10:00:00.000Z',
}

const MODULE_PLAN = {
  snapshot: { id: MODULE_BASELINE.id, name: MODULE_BASELINE.name },
  scope: 'module',
  modules: ['req-system'],
  partial: false,
  summary: {
    requirement: { added: 1, updated: 2, deleted: 1 },
    testcase: { added: 0, updated: 0, deleted: 0 },
    link: { added: 0, updated: 0, deleted: 0 },
    glossary: { added: 0, updated: 0, deleted: 0 },
    attributeDef: { added: 0, updated: 0, deleted: 0 },
  },
  totals: { added: 1, updated: 2, deleted: 1 },
  externalLinks: 3,
  entries: [
    { entityType: 'requirement', entityId: 'r1', label: 'SYS-001', action: 'update' },
    { entityType: 'requirement', entityId: 'r2', label: 'SYS-002', action: 'update' },
    { entityType: 'requirement', entityId: 'r3', label: 'SYS-003', action: 'add' },
    { entityType: 'requirement', entityId: 'r9', label: 'SYS-009', action: 'delete' },
  ],
}

const renderPage = () =>
  render(
    <LanguageProvider>
      <SnapshotsPage />
    </LanguageProvider>,
  )

/** Formu acip kapsam bolumune kadar hazirlar. */
const openForm = () => {
  renderPage()
  fireEvent.click(screen.getByTestId('snapshot-new'))
}

beforeEach(() => {
  appMock.snapshots = [MODULE_BASELINE, PROJECT_SNAPSHOT]
  appMock.loading = false
  appMock.createSnapshot = vi.fn().mockResolvedValue({})
  appMock.deleteSnapshot = vi.fn().mockResolvedValue({})
  appMock.updateSnapshot = vi.fn().mockResolvedValue({})
  appMock.restoreSnapshot = vi.fn().mockResolvedValue({ safetySnapshotName: '[otomatik] yedek' })
  authMock.value = { isPM: true, can: () => true }
  api.getRestorePreview.mockResolvedValue(MODULE_PLAN)
  api.getSnapshotDiff.mockResolvedValue({ entries: [], summary: {}, totals: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Baseline kapsami — secim', () => {
  it('varsayilan kapsam TUM PROJEDIR; modul listesi gizlidir', () => {
    openForm()
    expect(screen.getByTestId('scope-project')).toBeChecked()
    expect(screen.queryByTestId('scope-module-list')).not.toBeInTheDocument()
  })

  it('modul kapsamina gecilince modul listesi acilir', () => {
    openForm()
    fireEvent.click(screen.getByTestId('scope-module'))
    expect(screen.getByTestId('scope-module-list')).toBeInTheDocument()
    // Bos kapsam anlamsiz olurdu: ilk modul otomatik secilir.
    expect(screen.getByTestId('scope-module-req-user')).toBeChecked()
  })

  it('proje kapsaminda `modules` GONDERILMEZ', async () => {
    openForm()
    fireEvent.change(screen.getByTestId('snapshot-name-input'), { target: { value: 'Tum proje' } })
    fireEvent.click(screen.getByTestId('snapshot-create-submit'))
    await waitFor(() =>
      expect(appMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Tum proje', modules: undefined }),
      ),
    )
  })

  it('tek modul secilince yalnizca o modul gonderilir', async () => {
    openForm()
    fireEvent.click(screen.getByTestId('scope-module'))
    // Varsayilan req-user'i birak, req-system'i ekle -> ikisi de secili olur,
    // sonra req-user kaldirilir.
    fireEvent.click(screen.getByTestId('scope-module-req-system'))
    fireEvent.click(screen.getByTestId('scope-module-req-user'))
    fireEvent.change(screen.getByTestId('snapshot-name-input'), { target: { value: 'SRS' } })
    fireEvent.click(screen.getByTestId('snapshot-create-submit'))

    await waitFor(() =>
      expect(appMock.createSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ modules: ['req-system'] }),
      ),
    )
  })

  it('birden cok modul secilince BASELINE SETI uyarisi cikar', () => {
    openForm()
    fireEvent.click(screen.getByTestId('scope-module'))
    expect(screen.queryByTestId('scope-set-note')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('scope-module-req-system'))
    expect(screen.getByTestId('scope-set-note')).toHaveTextContent('2 modül')
  })
})

describe('Baseline kapsami — liste rozetleri', () => {
  it('modul baseline kapsam, surum ve set rozetleriyle gorunur', () => {
    renderPage()
    expect(screen.getByTestId(`snapshot-scope-${MODULE_BASELINE.id}`)).toHaveTextContent(
      'Sistem Gereksinimleri',
    )
    expect(screen.getByTestId(`snapshot-version-${MODULE_BASELINE.id}`)).toHaveTextContent('v2')
    expect(screen.getByTestId(`snapshot-set-${MODULE_BASELINE.id}`)).toHaveTextContent('CDR paketi')
  })

  it('proje kapsamli snapshot "Tum proje" rozeti tasir, surum/set rozeti tasimaz', () => {
    renderPage()
    expect(screen.getByTestId(`snapshot-scope-${PROJECT_SNAPSHOT.id}`)).toHaveTextContent(
      'Tüm proje',
    )
    expect(screen.queryByTestId(`snapshot-version-${PROJECT_SNAPSHOT.id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`snapshot-set-${PROJECT_SNAPSHOT.id}`)).not.toBeInTheDocument()
  })
})

describe('Geri yukleme — kapsam ve kismi secim', () => {
  const openPreview = async () => {
    renderPage()
    fireEvent.click(screen.getByTestId(`snapshot-restore-${MODULE_BASELINE.id}`))
    await waitFor(() => expect(screen.getByTestId('restore-totals')).toBeInTheDocument())
  }

  it('onizleme kapsami ve kapsam disi bag sayisini soyler', async () => {
    await openPreview()
    const scope = screen.getByTestId('restore-scope')
    expect(scope).toHaveTextContent('Sistem Gereksinimleri')
    expect(scope).toHaveTextContent('Diğer modüllere dokunulmaz')
    expect(scope).toHaveTextContent('3')
  })

  it('kismi secim acilinca SILINECEK kayitlar listelenmez', async () => {
    await openPreview()
    fireEvent.click(screen.getByTestId('restore-partial-toggle'))
    expect(screen.getByTestId('restore-pick-r1')).toBeInTheDocument()
    expect(screen.getByTestId('restore-pick-r3')).toBeInTheDocument()
    // Kismi restore silmez: silinecek kayit secilemez.
    expect(screen.queryByTestId('restore-pick-r9')).not.toBeInTheDocument()
  })

  it('hicbir kayit secilmeden devam edilemez', async () => {
    await openPreview()
    fireEvent.click(screen.getByTestId('restore-partial-toggle'))
    expect(screen.getByTestId('restore-confirm')).toBeDisabled()
    fireEvent.click(screen.getByTestId('restore-pick-r1'))
    expect(screen.getByTestId('restore-confirm')).not.toBeDisabled()
  })

  it('kismi secimde toplamlar yalnizca secilenleri sayar ve SILME gostermez', async () => {
    await openPreview()
    fireEvent.click(screen.getByTestId('restore-partial-toggle'))
    fireEvent.click(screen.getByTestId('restore-pick-r1'))
    const totals = screen.getByTestId('restore-totals')
    expect(totals).toHaveTextContent('~1')
    expect(totals).toHaveTextContent('-0')
  })

  it('kismi geri yukleme YALNIZCA secili kayitlari gonderir', async () => {
    await openPreview()
    fireEvent.click(screen.getByTestId('restore-partial-toggle'))
    fireEvent.click(screen.getByTestId('restore-pick-r1'))
    fireEvent.click(screen.getByTestId('restore-pick-r3'))
    fireEvent.click(screen.getByTestId('restore-confirm'))

    const textbox = await screen.findByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'Yalnizca iki kayit geri alindi' } })
    fireEvent.click(screen.getByText('Sil'))

    await waitFor(() =>
      expect(appMock.restoreSnapshot).toHaveBeenCalledWith(
        MODULE_BASELINE.id,
        'Yalnizca iki kayit geri alindi',
        ['r1', 'r3'],
      ),
    )
  })

  it('kismi secim kapaliyken TAM restore yapilir (selection null)', async () => {
    await openPreview()
    fireEvent.click(screen.getByTestId('restore-confirm'))
    const textbox = await screen.findByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'Tum modul geri alindi' } })
    fireEvent.click(screen.getByText('Sil'))

    await waitFor(() =>
      expect(appMock.restoreSnapshot).toHaveBeenCalledWith(
        MODULE_BASELINE.id,
        'Tum modul geri alindi',
        null,
      ),
    )
  })
})
