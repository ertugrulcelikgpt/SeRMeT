// ============================================================================
//  ApprovalPanel.test.jsx — Issue #126: kayit detayindaki kalici "Onaylar"
//  paneli.
//
//  Kapsam:
//    1) Onaylayan / Reddeden / Bekleniyor listeleri PM OLMAYAN kullaniciya da
//       gorunur; bos liste "—" gosterir.
//    2) Sayaclar backend ozetinden gelir; tiklaninca ilgili liste filtrelenir.
//    3) Uzun "Bekleniyor" listesi "… ve N kişi daha" ile kisaltilir.
//    4) Oy geri cekme (×) YALNIZCA oturum kullanicisinin satirinda cikar ve
//       /approvals/vote sozlesmesiyle (action: 'withdraw') cagrilir.
//    5) "Onaya davet et" adaylari listeler ve daveti gonderir.
//    6) Onay yorumu kendi oy kaydina yazilir ve satirin altinda gorunur.
//    7) Kaydin onay durumu degisince panel kendini yeniden ceker (canli).
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LanguageProvider } from '../../../context/LanguageContext.jsx'
import ApprovalPanel from '../ApprovalPanel.jsx'

const mocks = vi.hoisted(() => ({
  getApprovalMatrix: vi.fn(),
  voteApproval: vi.fn(),
  inviteApproval: vi.fn(),
  commentApproval: vi.fn(),
}))

vi.mock('../../../context/AppContext.jsx', () => ({
  useApp: () => mocks,
  AppProvider: ({ children }) => children,
}))

// Oturum: PM OLMAYAN bir kullanici — panelin herkese acik oldugunu dogrular.
vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { id: 'u-me', name: 'Ben', roleKey: 'system_engineer' } }),
}))

const person = (id, name, decision, extra = {}) => ({
  voterId: id,
  name,
  role: 'Sistem Mühendisi',
  decision,
  voted: decision === 'approve',
  comment: null,
  invited: false,
  ...extra,
})

const MATRIX = {
  approvalStatus: 'Pending',
  locked: false,
  currentUserId: 'u-me',
  approvers: [person('u-me', 'Ben', 'approve'), person('u-1', 'Ayşe', 'approve')],
  rejecters: [person('u-2', 'Burak', 'reject')],
  waiting: [person('u-3', 'Cem', 'pending')],
  counts: { approved: 2, rejected: 1, pending: 1 },
  candidates: [{ id: 'u-9', name: 'Deniz', role: 'Test Mühendisi' }],
  voters: [],
}

const ROW = { id: 'r1', text_id: 'EH-SYS-001', approvalStatus: 'Pending', locked: false }

const renderPanel = (row = ROW) =>
  render(
    <LanguageProvider>
      <ApprovalPanel entityType="requirement" row={row} />
    </LanguageProvider>,
  )

describe('ApprovalPanel — Onaylar paneli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApprovalMatrix.mockResolvedValue(MATRIX)
    mocks.voteApproval.mockResolvedValue({})
    mocks.inviteApproval.mockResolvedValue({})
    mocks.commentApproval.mockResolvedValue({})
  })
  afterEach(cleanup)

  it('onaylayan / reddeden / bekleyen listelerini PM olmayan kullaniciya gosterir', async () => {
    renderPanel()
    expect(await screen.findByTestId('approval-approvers')).toBeInTheDocument()
    expect(within(screen.getByTestId('approval-approvers')).getByText('Ayşe')).toBeInTheDocument()
    expect(within(screen.getByTestId('approval-rejecters')).getByText('Burak')).toBeInTheDocument()
    expect(within(screen.getByTestId('approval-waiting')).getByText('Cem')).toBeInTheDocument()
  })

  it('bos listede em-dash (—) gosterir', async () => {
    mocks.getApprovalMatrix.mockResolvedValue({
      ...MATRIX,
      rejecters: [],
      counts: { approved: 2, rejected: 0, pending: 1 },
    })
    renderPanel()
    const section = await screen.findByTestId('approval-rejecters')
    expect(within(section).getByText('—')).toBeInTheDocument()
  })

  it('sayaclar backend ozetini gosterir ve tiklaninca ilgili listeyi filtreler', async () => {
    renderPanel()
    const approved = await screen.findByTestId('approval-count-approve')
    expect(approved).toHaveTextContent('2')
    expect(screen.getByTestId('approval-count-reject')).toHaveTextContent('1')

    fireEvent.click(screen.getByTestId('approval-count-reject'))
    expect(screen.getByTestId('approval-rejecters')).toBeInTheDocument()
    expect(screen.queryByTestId('approval-approvers')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-waiting')).not.toBeInTheDocument()

    // Tekrar tiklamak filtreyi kaldirir.
    fireEvent.click(screen.getByTestId('approval-count-reject'))
    expect(screen.getByTestId('approval-approvers')).toBeInTheDocument()
  })

  it('uzun bekleyen listesini "… ve N kişi daha" ile kisaltir', async () => {
    const many = ['C', 'D', 'E', 'F', 'G', 'H'].map((n, i) => person(`w-${i}`, n, 'pending'))
    mocks.getApprovalMatrix.mockResolvedValue({ ...MATRIX, waiting: many })
    renderPanel()
    const more = await screen.findByTestId('approval-waiting-more')
    expect(more).toHaveTextContent('… ve 2 kişi daha')
    expect(screen.queryByText('H')).not.toBeInTheDocument()

    fireEvent.click(more)
    expect(screen.getByText('H')).toBeInTheDocument()
  })

  it('oy geri cekme (×) yalnizca oturum kullanicisinin satirinda cikar', async () => {
    renderPanel()
    expect(await screen.findByTestId('approval-withdraw-u-me')).toBeInTheDocument()
    expect(screen.queryByTestId('approval-withdraw-u-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-withdraw-u-2')).not.toBeInTheDocument()
  })

  it('× mevcut /approvals/vote sozlesmesiyle oyu geri ceker ve paneli tazeler', async () => {
    renderPanel()
    fireEvent.click(await screen.findByTestId('approval-withdraw-u-me'))
    await waitFor(() =>
      expect(mocks.voteApproval).toHaveBeenCalledWith({
        entityType: 'requirement',
        entityId: 'r1',
        action: 'withdraw',
      }),
    )
    await waitFor(() => expect(mocks.getApprovalMatrix).toHaveBeenCalledTimes(2))
  })

  it('bekleyen davet satirinda geri cekme dugmesi yoktur (henuz oy yok)', async () => {
    mocks.getApprovalMatrix.mockResolvedValue({
      ...MATRIX,
      approvers: [person('u-1', 'Ayşe', 'approve')],
      waiting: [person('u-me', 'Ben', 'pending', { invited: true })],
    })
    renderPanel()
    await screen.findByTestId('approval-waiting')
    expect(screen.queryByTestId('approval-withdraw-u-me')).not.toBeInTheDocument()
  })

  it('"Onaya davet et" adaylari listeler ve daveti gonderir', async () => {
    renderPanel()
    fireEvent.click(await screen.findByTestId('approval-invite-open'))
    const select = screen.getByTestId('approval-invite-select')
    expect(within(select).getByText('Deniz — Test Mühendisi')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'u-9' } })
    fireEvent.click(screen.getByTestId('approval-invite-submit'))
    await waitFor(() =>
      expect(mocks.inviteApproval).toHaveBeenCalledWith({
        entityType: 'requirement',
        entityId: 'r1',
        userId: 'u-9',
      }),
    )
  })

  it('aday yoksa davet dugmesi pasiftir', async () => {
    mocks.getApprovalMatrix.mockResolvedValue({ ...MATRIX, candidates: [] })
    renderPanel()
    expect(await screen.findByTestId('approval-invite-open')).toBeDisabled()
  })

  it('onay yorumu kendi oy kaydina yazilir', async () => {
    renderPanel()
    fireEvent.click(await screen.findByTestId('approval-comment-u-me'))
    fireEvent.change(screen.getByTestId('approval-comment-input'), {
      target: { value: 'DAL-B kontrolu tamam' },
    })
    fireEvent.click(screen.getByTestId('approval-comment-save'))
    await waitFor(() =>
      expect(mocks.commentApproval).toHaveBeenCalledWith({
        entityType: 'requirement',
        entityId: 'r1',
        comment: 'DAL-B kontrolu tamam',
      }),
    )
  })

  it('kayitli yorum ilgili oy satirinin altinda gorunur', async () => {
    mocks.getApprovalMatrix.mockResolvedValue({
      ...MATRIX,
      approvers: [person('u-1', 'Ayşe', 'approve', { comment: 'Kabul, izlenebilirlik tamam.' })],
    })
    renderPanel()
    const row = await screen.findByTestId('approval-row-u-1')
    expect(within(row).getByText('Kabul, izlenebilirlik tamam.')).toBeInTheDocument()
  })

  it('kaydin onay durumu degisince panel yeniden cekilir (canli guncelleme)', async () => {
    const { rerender } = renderPanel()
    await waitFor(() => expect(mocks.getApprovalMatrix).toHaveBeenCalledTimes(1))
    rerender(
      <LanguageProvider>
        <ApprovalPanel
          entityType="requirement"
          row={{ ...ROW, approvalStatus: 'Approved', locked: true }}
        />
      </LanguageProvider>,
    )
    await waitFor(() => expect(mocks.getApprovalMatrix).toHaveBeenCalledTimes(2))
  })
})
