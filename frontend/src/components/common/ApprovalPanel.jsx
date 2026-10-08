// ============================================================================
//  ApprovalPanel.jsx  —  Issue #126: kayit detayindaki (ViewModal) KALICI
//  "Onaylar" paneli.
//
//  NEDEN: onay bilgisi bugune kadar yalnizca PM'in acabildigi
//  ApprovalMatrixModal ("Onay Detayi") icinde gorunuyordu; kaydi inceleyen
//  diger kullanicilar surecin nerede takildigini goremiyordu. Bu panel ayni
//  veriyi (GET /approvals/matrix) HERKESE, kayit detayinin icinde gosterir.
//
//  Panel su bolumlerden olusur:
//    - Ust sayaclar: Onaylandi: N / Reddedildi: N (tiklaninca liste filtrelenir)
//    - Onaylayan / Reddeden / Bekleniyor listeleri (bos ise "—")
//    - "Onaya davet et": bilesende yetkili, listede olmayan kullanicilar
//    - Her satirda oy geri cekme (×) — YALNIZCA satirin sahibi icin
//    - "Yorum Ekle": yorum kendi OY kaydina baglanir, satirin altinda gorunur
//
//  Canli guncelleme: panel kendi verisini tutar; her aksiyondan sonra ve
//  kaydin onay durumu (approvalStatus/locked) disaridan degistiginde
//  yeniden ceker.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconCheckCircle, IconXCircle, IconClose, IconComment, IconPlus } from './Icons.jsx'
import { useLang } from '../../context/LanguageContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

// "Bekleniyor" listesi uzunsa kisaltilir: ilk N kisi + "… ve N kişi daha".
const WAITING_PREVIEW = 4

export default function ApprovalPanel({ entityType, row }) {
  const { t } = useLang()
  const { getApprovalMatrix, voteApproval, inviteApproval, commentApproval } = useApp()
  const { currentUser } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // null = filtre yok (tum bolumler); 'approve' | 'reject' = yalnizca o liste.
  const [filter, setFilter] = useState(null)
  const [expandWaiting, setExpandWaiting] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteId, setInviteId] = useState('')
  // Yorum kutusu acik olan satirin voterId'si (her an tek satir duzenlenir).
  const [commentFor, setCommentFor] = useState(null)
  const [commentText, setCommentText] = useState('')

  const entityId = row?.id

  const load = useCallback(async () => {
    if (!entityType || !entityId) return
    setLoading(true)
    setError(null)
    try {
      setData(await getApprovalMatrix(entityType, entityId))
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId, getApprovalMatrix])

  // Canli guncelleme: kayit degisince VE kaydin onay durumu disaridan
  // (baska bir aksiyon/refresh ile) degisince panel kendini tazeler.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load, row?.approvalStatus, row?.locked])

  // Kayit degisince gecici UI durumu sifirlanir.
  useEffect(() => {
    setFilter(null)
    setExpandWaiting(false)
    setInviteOpen(false)
    setInviteId('')
    setCommentFor(null)
  }, [entityId])

  const meId = data?.currentUserId || currentUser?.id || null
  const approvers = useMemo(() => data?.approvers || [], [data])
  const rejecters = useMemo(() => data?.rejecters || [], [data])
  const waiting = useMemo(() => data?.waiting || [], [data])
  const candidates = useMemo(() => data?.candidates || [], [data])
  const counts = data?.counts || { approved: 0, rejected: 0, pending: 0 }

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const withdraw = (voterId) =>
    run(async () => {
      if (voterId !== meId) return
      await voteApproval({ entityType, entityId, action: 'withdraw' })
    })

  const invite = () =>
    run(async () => {
      if (!inviteId) return
      await inviteApproval({ entityType, entityId, userId: inviteId })
      setInviteId('')
      setInviteOpen(false)
    })

  const saveComment = () =>
    run(async () => {
      await commentApproval({ entityType, entityId, comment: commentText })
      setCommentFor(null)
      setCommentText('')
    })

  // NOT: asagidakiler ic ICE BILESEN degil, render FONKSIYONUDUR. Bilesen
  // olarak tanimlansalardi her tus vurusunda kimlikleri degisir, React agaci
  // yeniden kurar ve yorum kutusu odagini kaybederdi.
  // Sayac kutusu: tiklaninca ilgili listeyi filtreler, tekrar tiklaninca acar.
  const renderCounter = ({ kind, value, label, tone }) => {
    const active = filter === kind
    return (
      <button
        type="button"
        data-testid={`approval-count-${kind}`}
        aria-pressed={active}
        onClick={() => setFilter(active ? null : kind)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${tone} ${
          active ? 'ring-2 ring-inset ring-brand-500' : ''
        }`}
      >
        {label}: <span className="tabular-nums">{value}</span>
      </button>
    )
  }

  const renderRow = (person) => {
    const mine = person.voterId === meId
    const editing = commentFor === person.voterId
    return (
      <li
        key={person.voterId}
        data-testid={`approval-row-${person.voterId}`}
        className="rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">
            <span className="font-semibold">{person.name}</span>
            <span className="ml-2 text-xs text-slate-400">{person.role}</span>
            {person.invited && (
              <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                {t('apnl.invited')}
              </span>
            )}
            {person.departed && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                {t('apnl.departed')}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {mine && (
              <button
                type="button"
                data-testid={`approval-comment-${person.voterId}`}
                title={t('apnl.addComment')}
                onClick={() => {
                  setCommentFor(editing ? null : person.voterId)
                  setCommentText(person.comment || '')
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              >
                <IconComment size={14} />
              </button>
            )}
            {/* Oy geri cekme (×): YALNIZCA satirin sahibi ve fiilen oy
                kullanilmis satirlar icin (bekleyen davet geri cekilemez). */}
            {mine && person.decision !== 'pending' && (
              <button
                type="button"
                data-testid={`approval-withdraw-${person.voterId}`}
                title={t('apnl.withdraw')}
                aria-label={t('apnl.withdraw')}
                disabled={busy}
                onClick={() => withdraw(person.voterId)}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
              >
                <IconClose size={14} />
              </button>
            )}
          </span>
        </div>
        {person.comment && !editing && (
          <p className="mt-1 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500 dark:border-slate-600 dark:text-slate-400">
            {person.comment}
          </p>
        )}
        {editing && (
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={t('apnl.commentPlaceholder')}
              data-testid="approval-comment-input"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={busy}
              onClick={saveComment}
              data-testid="approval-comment-save"
              className="btn-primary px-2 py-1 text-xs disabled:opacity-60"
            >
              {t('apnl.commentSave')}
            </button>
          </div>
        )}
      </li>
    )
  }

  const renderSection = ({ kind, title, people, testid }) => {
    if (filter && filter !== kind) return null
    const hidden = kind === 'pending' && !expandWaiting ? people.length - WAITING_PREVIEW : 0
    const shown = hidden > 0 ? people.slice(0, WAITING_PREVIEW) : people
    return (
      <div className="mt-3" data-testid={testid}>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          <>
            <ul className="space-y-1">{shown.map((p) => renderRow(p))}</ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpandWaiting(true)}
                data-testid="approval-waiting-more"
                className="mt-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                {t('apnl.andMore', { n: hidden })}
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  if (!entityType || !row) return null

  return (
    <div className="mb-4" data-testid="view-approvals">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('apnl.title')}
        </span>
        {renderCounter({
          kind: 'approve',
          value: counts.approved,
          label: t('apnl.approvedCount'),
          tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        })}
        {renderCounter({
          kind: 'reject',
          value: counts.rejected,
          label: t('apnl.rejectedCount'),
          tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
        })}
        {filter && (
          <button
            type="button"
            onClick={() => setFilter(null)}
            data-testid="approval-filter-clear"
            className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
          >
            {t('apnl.showAll')}
          </button>
        )}
      </div>

      {loading && !data ? (
        <p className="text-sm text-slate-400">…</p>
      ) : (
        <>
          {error && (
            <p
              data-testid="approval-error"
              className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {error}
            </p>
          )}
          {renderSection({
            kind: 'approve',
            title: (
              <span className="inline-flex items-center gap-1">
                <IconCheckCircle size={13} /> {t('apnl.approvers')}
              </span>
            ),
            people: approvers,
            testid: 'approval-approvers',
          })}
          {renderSection({
            kind: 'reject',
            title: (
              <span className="inline-flex items-center gap-1">
                <IconXCircle size={13} /> {t('apnl.rejecters')}
              </span>
            ),
            people: rejecters,
            testid: 'approval-rejecters',
          })}
          {renderSection({
            kind: 'pending',
            title: t('apnl.waiting'),
            people: waiting,
            testid: 'approval-waiting',
          })}

          {/* Onaya davet et: bilesende yetkili, listede HENUZ olmayanlar. */}
          <div className="mt-3">
            {inviteOpen ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  data-testid="approval-invite-select"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">{t('apnl.invitePick')}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !inviteId}
                  onClick={invite}
                  data-testid="approval-invite-submit"
                  className="btn-primary px-2 py-1 text-xs disabled:opacity-60"
                >
                  {t('apnl.inviteSubmit')}
                </button>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="btn-secondary px-2 py-1 text-xs"
                >
                  {t('view.close')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                disabled={candidates.length === 0}
                data-testid="approval-invite-open"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-brand-400"
              >
                <IconPlus size={13} />{' '}
                {candidates.length === 0 ? t('apnl.inviteNone') : t('apnl.invite')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
