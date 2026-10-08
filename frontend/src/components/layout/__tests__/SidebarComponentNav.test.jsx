// ============================================================================
//  SidebarComponentNav.test.jsx — Issue #140.
//
//  Bilesene gereksinim baglandiginda "Gereksinimler" menusunde ELLE bir islem
//  yapilmadan "<Bilesen adi> Gereksinimleri" girdisi belirir. Girdiler bilesen
//  agacindan turetilir: yeni pageKey / NavItem uretilmez, sabit sayfalar
//  (req-user...) yerinde kalir.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../../context/LanguageContext.jsx'

const { appMock, authMock } = vi.hoisted(() => ({
  appMock: { nav: null, components: [], requirements: [] },
  authMock: { isPM: true, can: () => true },
}))

vi.mock('../../../context/AppContext.jsx', () => ({
  useApp: () => ({
    nav: appMock.nav,
    components: appMock.components,
    requirements: appMock.requirements,
    addNavItem: vi.fn(),
    materializeNav: vi.fn(),
  }),
  AppProvider: ({ children }) => children,
}))

vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ isPM: authMock.isPM, can: (...a) => authMock.can(...a) }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../../../context/ProjectContext.jsx', () => ({
  useProject: () => ({ activeProject: { name: 'Test Proje' }, closeProject: () => {} }),
  ProjectProvider: ({ children }) => children,
}))

vi.mock('../NavManager.jsx', () => ({ default: () => null }))

import Sidebar from '../Sidebar.jsx'

const defaultNav = {
  materialized: false,
  groups: [
    {
      id: null,
      name: 'Gereksinimler',
      nameKey: 'nav.groupRequirements',
      order: 0,
      items: [{ pageKey: 'req-user' }, { pageKey: 'req-system' }, { pageKey: 'req-subsystem' }],
    },
    {
      id: null,
      name: 'Testler',
      nameKey: 'nav.groupTests',
      order: 1,
      items: [{ pageKey: 'test-acceptance' }],
    },
  ],
  ungrouped: [{ pageKey: 'glossary' }],
}

const components = [
  { id: 'c1', parentId: null, name: 'A Donanımı', sortIndex: 0 },
  { id: 'c2', parentId: 'c1', name: 'Alt Kart', sortIndex: 0 },
]

const requirements = [
  { id: 'r1', text_id: 'EH-USR-001', type: 'User Requirement', componentId: 'c1' },
  { id: 'r2', text_id: 'EH-SW-001', type: 'Software Requirement', componentId: 'c2' },
]

const renderSidebar = (props = {}) =>
  render(
    <LanguageProvider>
      <Sidebar active="dashboard" onNavigate={() => {}} {...props} />
    </LanguageProvider>,
  )

describe('Sidebar — bilesen gereksinim girdileri (Issue #140)', () => {
  beforeEach(() => {
    appMock.nav = defaultNav
    appMock.components = components
    appMock.requirements = requirements
    authMock.isPM = true
    authMock.can = () => true
  })

  afterEach(() => cleanup())

  it('bilesen girdisi Gereksinimler grubunda, sabit sayfalarin yaninda belirir', () => {
    renderSidebar()
    expect(screen.getByText('A Donanımı Gereksinimleri')).toBeInTheDocument()
    // Sabit sayfalar yerinde kalir.
    expect(screen.getByText('Kullanıcı Gereksinimleri')).toBeInTheDocument()
    expect(screen.getByText('Sistem Gereksinimleri')).toBeInTheDocument()
    expect(screen.getByText('Alt Sistem Gereksinimleri')).toBeInTheDocument()
  })

  it('girdide gereksinim sayisi (alt kirilim dahil) gorunur', () => {
    renderSidebar()
    expect(screen.getByTestId('nav-component-count-c1')).toHaveTextContent('2')
    expect(screen.getByTestId('nav-component-count-c2')).toHaveTextContent('1')
  })

  it('alt bilesen ust bilesenin altinda ic ice durur ve kapatilabilir', () => {
    renderSidebar()
    expect(screen.getByText('Alt Kart Gereksinimleri')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('nav-component-toggle-c1'))
    expect(screen.queryByText('Alt Kart Gereksinimleri')).not.toBeInTheDocument()
  })

  it('girdiye tiklanica o bilesenin sayfasina gidilir', () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })
    fireEvent.click(screen.getByTestId('nav-component-c1'))
    expect(onNavigate).toHaveBeenCalledWith('req-component:c1')
  })

  it('bilesen adi degisince etiket guncellenir', () => {
    const { rerender } = renderSidebar()
    appMock.components = components.map((c) => (c.id === 'c1' ? { ...c, name: 'B Donanımı' } : c))
    rerender(
      <LanguageProvider>
        <Sidebar active="dashboard" onNavigate={() => {}} />
      </LanguageProvider>,
    )
    expect(screen.getByText('B Donanımı Gereksinimleri')).toBeInTheDocument()
    expect(screen.queryByText('A Donanımı Gereksinimleri')).not.toBeInTheDocument()
  })

  it('bilesen silinince girdi kaybolur', () => {
    const { rerender } = renderSidebar()
    appMock.components = components.filter((c) => c.id !== 'c2')
    rerender(
      <LanguageProvider>
        <Sidebar active="dashboard" onNavigate={() => {}} />
      </LanguageProvider>,
    )
    expect(screen.queryByText('Alt Kart Gereksinimleri')).not.toBeInTheDocument()
    expect(screen.getByText('A Donanımı Gereksinimleri')).toBeInTheDocument()
  })

  it('gereksinimi olmayan bilesen 0 rozetiyle gorunur', () => {
    appMock.requirements = []
    renderSidebar()
    expect(screen.getByTestId('nav-component-count-c1')).toHaveTextContent('0')
  })

  it('kullanicinin goremedigi kayitlar sayaca girmez', () => {
    authMock.can = (perm, key) => perm === 'read' && key === 'req-user'
    renderSidebar()
    expect(screen.getByTestId('nav-component-count-c1')).toHaveTextContent('1')
    expect(screen.getByTestId('nav-component-count-c2')).toHaveTextContent('0')
  })

  it('hicbir grupta gereksinim sayfasi yoksa girdiler yine gorunur', () => {
    appMock.nav = { ...defaultNav, groups: [defaultNav.groups[1]] }
    renderSidebar()
    expect(screen.getByText('A Donanımı Gereksinimleri')).toBeInTheDocument()
  })
})
