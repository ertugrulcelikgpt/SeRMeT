// ============================================================================
//  EntityTableLinks.test.jsx — Issue #123: satir genisletme ile bag okumasi.
//
//  Kapsam:
//   - Satir genisletildiginde ust/alt baglar ve bagli testler KOD + BASLIK ile
//     listelenir (kapali haldeyken panel cizilmez)
//   - Bag listesindeki koda tiklayinca hedef kayit acilir (onOpenLinked)
//   - Bagli test senaryolarinin sonuc durumu satir icinde gorunur
//   - Bagsiz (yetim) kayitlar ve alt bagi eksik kayitlar rozetle ayirt edilir
//   - Ek sorgu maliyeti yok: ozet TOPLU indeksten okunur — bilesen satir
//     basina yeni bir cagri yapmaz (linkSummaryFor cagri sayisi sinirli)
//   - "Üst Bağlar" / "Alt Bağlar" AYRI SUTUN olarak da acilabilir
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../../context/LanguageContext.jsx'
import { buildLinkIndex, linkSummaryOf } from '../../../utils/linkIndex.js'
import { LINK_TYPE, REQ_TYPE, TEST_TYPE, STATUS } from '../../../utils/constants.js'

vi.mock('../../../context/AppContext.jsx', () => ({
  useApp: () => ({ attributeDefs: [] }),
  AppProvider: ({ children }) => children,
}))

import EntityTable from '../EntityTable.jsx'

const USR1 = {
  id: 'u1',
  text_id: 'EH-KAHVE-TİD-USR-001',
  title: 'Kullanici kahve secer',
  type: REQ_TYPE.USER,
}
const USR2 = {
  id: 'u2',
  text_id: 'EH-KAHVE-TİD-USR-002',
  title: 'Kullanici sut ekler',
  type: REQ_TYPE.USER,
}
const SGO14 = {
  id: 's14',
  text_id: 'EH-KAHVE-TİD-SGO-014',
  title: 'Demleme sicakligi',
  type: REQ_TYPE.SYSTEM,
}
const ORPHAN = {
  id: 'o1',
  text_id: 'EH-KAHVE-TİD-SGO-099',
  title: 'Bagsiz gereksinim',
  type: REQ_TYPE.SYSTEM,
}
const TEST_OK = {
  id: 't1',
  text_id: 'EH-KAHVE-TST-001',
  title: 'Sicaklik testi',
  type: TEST_TYPE.SYSTEM,
  status: STATUS.APPROVED,
}
const TEST_FAIL = {
  id: 't2',
  text_id: 'EH-KAHVE-TST-002',
  title: 'Basinc testi',
  type: TEST_TYPE.SYSTEM,
  status: STATUS.REJECTED,
}

const requirements = [USR1, USR2, SGO14, ORPHAN]
const testCases = [TEST_OK, TEST_FAIL]
const links = [
  { id: 'l1', type: LINK_TYPE.SATISFIES, fromId: 'u1', toId: 's14' },
  { id: 'l2', type: LINK_TYPE.SATISFIES, fromId: 'u2', toId: 's14' },
  { id: 'l3', type: LINK_TYPE.VERIFIES, fromId: 's14', toId: 't1' },
  { id: 'l4', type: LINK_TYPE.VERIFIES, fromId: 's14', toId: 't2' },
]

function renderTable(props = {}) {
  const index = buildLinkIndex({ links, requirements, testCases })
  const summarySpy = vi.fn((r) => linkSummaryOf(index, r))
  const utils = render(
    <LanguageProvider>
      <EntityTable
        rows={[SGO14, ORPHAN]}
        columns={['type', 'links', 'linkTargets']}
        expandable
        linkSummaryFor={summarySpy}
        {...props}
      />
    </LanguageProvider>,
  )
  return { ...utils, summarySpy }
}

const expandFirstRow = () => fireEvent.click(screen.getAllByTestId('row-expand-toggle')[0])

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(cleanup)

describe('EntityTable — satir genisletme ile bag okumasi', () => {
  it('kapali haldeyken bag paneli cizilmez', () => {
    renderTable()
    expect(screen.queryByTestId('link-expand-panel')).not.toBeInTheDocument()
  })

  it('genisletince ust ve alt baglar kod + baslik ile listelenir', () => {
    renderTable()
    expandFirstRow()
    const panel = screen.getByTestId('link-expand-panel')
    const codes = within(panel)
      .getAllByTestId('link-chip')
      .map((b) => b.getAttribute('data-code'))
    // Ust: iki User Requirement; alt/test: iki test senaryosu.
    expect(codes).toEqual(
      expect.arrayContaining([
        'EH-KAHVE-TİD-USR-001',
        'EH-KAHVE-TİD-USR-002',
        'EH-KAHVE-TST-001',
        'EH-KAHVE-TST-002',
      ]),
    )
    expect(within(panel).getByText('Kullanici kahve secer')).toBeInTheDocument()
    expect(within(panel).getByText('Sicaklik testi')).toBeInTheDocument()
  })

  it('tekrar tiklayinca panel kapanir', () => {
    renderTable()
    expandFirstRow()
    expect(screen.getByTestId('link-expand-panel')).toBeInTheDocument()
    expandFirstRow()
    expect(screen.queryByTestId('link-expand-panel')).not.toBeInTheDocument()
  })

  it('bagli koda tiklayinca hedef kayit acilir', () => {
    const onOpenLinked = vi.fn()
    renderTable({ onOpenLinked })
    expandFirstRow()
    const chip = screen
      .getAllByTestId('link-chip')
      .find((b) => b.getAttribute('data-code') === 'EH-KAHVE-TİD-USR-001')
    fireEvent.click(chip)
    expect(onOpenLinked).toHaveBeenCalledTimes(1)
    expect(onOpenLinked.mock.calls[0][0].node).toMatchObject({ id: 'u1' })
  })

  it('bagli test senaryolarinin sonuc durumu satir icinde gorunur', () => {
    renderTable()
    expandFirstRow()
    const panel = screen.getByTestId('link-expand-panel')
    const states = within(panel)
      .getAllByTestId('verification-badge')
      .map((b) => b.getAttribute('data-state'))
    expect(states).toContain('verified') // onayli test  -> Doğrulandı
    expect(states).toContain('failed') // reddedilen test -> Doğrulama Başarısız
  })

  it('bagsiz (yetim) kayit rozetle ayirt edilir', () => {
    renderTable()
    // Yalnizca ikinci satir (hicbir bagi olmayan) yetim rozetini tasir.
    const orphanBadges = screen.getAllByTestId('orphan-badge')
    expect(orphanBadges).toHaveLength(1)
    const row = orphanBadges[0].closest('tr')
    expect(within(row).getByText('EH-KAHVE-TİD-SGO-099')).toBeInTheDocument()
  })

  it('alt bagi beklenen ama olmayan kayit ayrica isaretlenir', () => {
    // USR-001'in alt bagi var (SGO-014), USR-002'nin de; alt bagi olmayan
    // bir User Requirement eklenirse "alt bag yok" rozeti cikar.
    const lonely = { id: 'u9', text_id: 'EH-KAHVE-TİD-USR-009', title: 'Tek', type: REQ_TYPE.USER }
    const index = buildLinkIndex({
      links: [{ id: 'x', type: LINK_TYPE.VERIFIES, fromId: 'u9', toId: 't1' }],
      requirements: [lonely],
      testCases,
    })
    render(
      <LanguageProvider>
        <EntityTable
          rows={[lonely]}
          columns={['links']}
          expandable
          linkSummaryFor={(r) => linkSummaryOf(index, r)}
        />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('missing-children-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('orphan-badge')).not.toBeInTheDocument()
  })

  it('ozet TOPLU indeksten okunur: satir basina tek cagri, acmak yeni veri cekmez', () => {
    const { summarySpy } = renderTable()
    const initial = summarySpy.mock.calls.length
    expect(initial).toBe(2) // iki satir, satir basina bir ozet okumasi
    summarySpy.mockClear()
    expandFirstRow()
    // Genisletme yalnizca yeniden cizim yapar; satir sayisindan fazla okuma
    // (ve hicbir istek) olmaz.
    expect(summarySpy.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('"Üst Bağlar" / "Alt Bağlar" ayri sutun olarak acilabilir', () => {
    renderTable({ columnKeys: ['code', 'linksUp', 'linksDown'] })
    expect(screen.getByText('Üst Bağlar')).toBeInTheDocument()
    expect(screen.getByText('Alt Bağlar')).toBeInTheDocument()
    const codes = screen.getAllByTestId('link-code').map((b) => b.getAttribute('data-code'))
    expect(codes).toEqual(expect.arrayContaining(['EH-KAHVE-TİD-USR-001', 'EH-KAHVE-TST-001']))
  })

  it('expandable verilmezse eski davranis korunur (ok cikmaz)', () => {
    render(
      <LanguageProvider>
        <EntityTable rows={[SGO14]} columns={['links']} />
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('row-expand-toggle')).not.toBeInTheDocument()
  })
})
