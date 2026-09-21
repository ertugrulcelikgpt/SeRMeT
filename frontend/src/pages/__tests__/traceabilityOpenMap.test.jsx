// ============================================================================
//  traceabilityOpenMap.test.jsx — Izlenebilirlik sayfasindan "Gereksinim
//  Haritasi" gorunumune gecis (Issue #122 kabul kriteri). Matris ve harita
//  birbirinin yerine gecmez; matris sayfasi degismeden kalir.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../context/LanguageContext.jsx'

const { appMock } = vi.hoisted(() => ({
  appMock: { requirements: [], testCases: [], links: [] },
}))

vi.mock('../../context/AppContext.jsx', () => ({
  useApp: () => appMock,
  AppProvider: ({ children }) => children,
}))

import Traceability from '../Traceability.jsx'

const renderPage = (props) =>
  render(
    <LanguageProvider>
      <Traceability {...props} />
    </LanguageProvider>,
  )

beforeEach(() => {
  appMock.requirements = [
    { id: 's1', text_id: 'REQ-SYS-001', type: 'System Requirement', title: 'Isitici' },
    { id: 'w1', text_id: 'REQ-SW-001', type: 'Software Requirement', title: 'Dongu' },
  ]
  appMock.testCases = []
  appMock.links = [{ id: 'l1', fromId: 's1', toId: 'w1', type: 'Satisfies' }]
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Traceability — Gereksinim Haritası girişi', () => {
  it('harita butonuna tiklayinca harita sayfasina yonlendirir', () => {
    const onNavigate = vi.fn()
    renderPage({ onNavigate })
    fireEvent.click(screen.getByTestId('trace-open-map'))
    expect(onNavigate).toHaveBeenCalledWith('requirement-map')
  })

  it('matris gorunumu degismeden kalir (iki gorunum birlikte var olur)', () => {
    renderPage({ onNavigate: vi.fn() })
    expect(screen.getByText(/Satisfies Matrisi/)).toBeInTheDocument()
    expect(screen.getByText(/Verifies Matrisi/)).toBeInTheDocument()
  })

  it('yonlendirme geri cagrisi verilmezse buton gosterilmez', () => {
    renderPage({})
    expect(screen.queryByTestId('trace-open-map')).not.toBeInTheDocument()
  })
})
