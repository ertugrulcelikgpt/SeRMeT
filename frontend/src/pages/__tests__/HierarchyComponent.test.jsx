// ============================================================================
//  HierarchyComponent.test.jsx — Issue #140: bilesen bazli gereksinim listesi.
//
//  Ayni gereksinim tablosu (sutunlar + filtreler) `componentId` verildiginde
//  SEVIYE yerine BILESENE gore listeler: User / System / Sub-system bir arada.
//  Kapsam:
//   - Bilesene ve ALT bilesenlerine bagli kayitlar seviye farki gozetmeksizin
//   - Bagsiz / baska bilesene bagli kayitlar listede YOK
//   - Izin: kaydin KENDI sayfa anahtari uzerinden (yetkisiz kayit gorunmez)
//   - Bilesen gorunumu salt listedir: "gereksinim ekle" dugmesi yoktur
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { canMock, appMock } = vi.hoisted(() => ({
  canMock: { fn: () => true },
  appMock: { requirements: [], components: [] },
}))

vi.mock('../../context/AppContext.jsx', () => ({
  useApp: () => ({
    projectId: 'p-1',
    requirements: appMock.requirements,
    components: appMock.components,
    testCases: [],
    links: [],
    glossary: [],
    fields: [],
    attributeDefs: [],
    personnel: [],
    approvals: [],
    bulkRemoveRequirements: vi.fn(),
    editRequirement: vi.fn(),
    refresh: vi.fn(),
  }),
  AppProvider: ({ children }) => children,
}))

vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: (...a) => canMock.fn(...a), isPM: true, currentUser: { name: 'PM' } }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../../components/requirements/RequirementForm.jsx', () => ({ default: () => null }))
vi.mock('../../components/requirements/FieldManager.jsx', () => ({ default: () => null }))
vi.mock('../../components/requirements/AttributeManager.jsx', () => ({ default: () => null }))
vi.mock('../../components/traceability/LinkManager.jsx', () => ({ default: () => null }))
vi.mock('../../components/traceability/ImpactAnalysisModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/common/BulkLinkModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/common/BulkAssignModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/common/ViewModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/common/ReasonModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/documents/SourceDocumentModal.jsx', () => ({ default: () => null }))

import Hierarchy from '../Hierarchy.jsx'

const components = [
  { id: 'c1', parentId: null, name: 'A Donanımı', sortIndex: 0 },
  { id: 'c2', parentId: 'c1', name: 'Alt Kart', sortIndex: 0 },
  { id: 'c9', parentId: null, name: 'B Donanımı', sortIndex: 1 },
]

const req = (over) => ({
  description: '',
  field: 'Arayuz / HMI',
  status: 'In Review',
  attributes: {},
  locked: false,
  ...over,
})

const requirements = [
  req({
    id: 'r1',
    text_id: 'EH-USR-001',
    title: 'Kullanici',
    type: 'User Requirement',
    componentId: 'c1',
  }),
  req({
    id: 'r2',
    text_id: 'EH-SYS-001',
    title: 'Sistem',
    type: 'System Requirement',
    componentId: 'c1',
  }),
  req({
    id: 'r3',
    text_id: 'EH-SW-001',
    title: 'Yazilim',
    type: 'Software Requirement',
    componentId: 'c2',
  }),
  req({
    id: 'r4',
    text_id: 'EH-USR-002',
    title: 'Bagsiz',
    type: 'User Requirement',
    componentId: null,
  }),
  req({
    id: 'r5',
    text_id: 'EH-USR-003',
    title: 'Baska',
    type: 'User Requirement',
    componentId: 'c9',
  }),
]

const renderPage = (props = {}) =>
  render(
    <LanguageProvider>
      <Hierarchy
        pageKey="req-component"
        navKey="req-component:c1"
        componentId="c1"
        titleOverride="A Donanımı Gereksinimleri"
        {...props}
      />
    </LanguageProvider>,
  )

const codes = () => screen.getAllByText(/^EH-(USR|SYS|SW)-\d+$/).map((el) => el.textContent.trim())

describe('Hierarchy — bilesen gorunumu (Issue #140)', () => {
  beforeEach(() => {
    appMock.requirements = requirements
    appMock.components = components
    canMock.fn = () => true
  })

  afterEach(() => cleanup())

  it('bilesene ve alt bilesenine bagli kayitlari seviye farki gozetmeksizin listeler', () => {
    renderPage()
    expect(codes()).toEqual(['EH-SW-001', 'EH-SYS-001', 'EH-USR-001'])
  })

  it('bagsiz ya da baska bilesene bagli kayit listede yoktur', () => {
    renderPage()
    expect(screen.queryByText('EH-USR-002')).not.toBeInTheDocument()
    expect(screen.queryByText('EH-USR-003')).not.toBeInTheDocument()
  })

  it('bag kaldirilinca kayit bu listeden duser', () => {
    appMock.requirements = requirements.map((r) =>
      r.id === 'r1' ? { ...r, componentId: null } : r,
    )
    renderPage()
    expect(codes()).toEqual(['EH-SW-001', 'EH-SYS-001'])
  })

  it('yetkisiz kullanici goremedigi kayitlari bu liste uzerinden de goremez', () => {
    // Yalnizca User Gereksinimleri okunabilir.
    canMock.fn = (perm, key) => perm === 'read' && key === 'req-user'
    renderPage()
    expect(codes()).toEqual(['EH-USR-001'])
  })

  it('bilesen gorunumunde gereksinim ekleme dugmesi yoktur (salt liste)', () => {
    renderPage()
    expect(screen.queryByText(/Gereksinimi Ekle/i)).not.toBeInTheDocument()
  })

  it('baslik bilesen adini tasir', () => {
    renderPage()
    expect(screen.getByText('A Donanımı Gereksinimleri')).toBeInTheDocument()
  })
})
