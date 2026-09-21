// ============================================================================
//  BaselinesTab.jsx — Issue #128, madde 5: kaydın yer aldığı BASELINE'lar.
//
//  Buradaki soru "bu kayda baseline atayalım mı" DEĞİLDİR — baseline bir
//  kayıt kümesini (modülü) bir bütün olarak dondurur. Burada gösterilen şey
//  şudur: BU KAYIT hangi modül baseline'larının içinde kaldı?
//
//  Bir baseline'a tıklanınca kaydın o sürümdeki hali SALT OKUNUR açılır ve
//  canlı halle ALAN BAZINDA farkı gösterilir ("v1.0'dan bu yana ne değişti").
//  Kayıt hiçbir baseline'da yer almıyorsa bu durum AÇIKÇA belirtilir — henüz
//  hiçbir sürüme girmemiş yeni bir kayıttır.
//
//  Sürüm geçmişinden (HistoryTab, #57) farkı: orası tek kaydın kendi
//  değişiklik geçmişidir; burası kaydın içinde bulunduğu TESLİM noktalarıdır.
// ============================================================================
import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useLang } from '../../context/LanguageContext.jsx'
import { formatDateTime, stripHtml } from '../../utils/format.js'
import { listEntityBaselines, getEntityBaselineDetail } from '../../services/dataService.js'
import { IconChevron, IconHistory, IconLock } from './Icons.jsx'

/** Fark değerini okunur kısa metne indirger (uzun HTML açıklamalar dahil). */
function showValue(value, t) {
  if (value === null || value === undefined || value === '') return t('baselines.empty')
  if (Array.isArray(value)) return value.length ? value.join(', ') : t('baselines.empty')
  if (typeof value === 'object') return JSON.stringify(value)
  const text = stripHtml(String(value))
  return text.length > 160 ? `${text.slice(0, 160)}…` : text || t('baselines.empty')
}

export default function BaselinesTab({ entityType, row }) {
  const { projectId } = useApp()
  const { t } = useLang()
  const [data, setData] = useState(null) // null = yukleniyor
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  // Acilan baseline'in detayi (o andaki hal + canli halle fark) tembel cekilir:
  // bir kayit onlarca baseline'da yer alabilir, hepsini bastan yuklemek gereksiz.
  const [details, setDetails] = useState({})

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    setOpenId(null)
    setDetails({})
    ;(async () => {
      try {
        const res = await listEntityBaselines(projectId, entityType, row.id)
        if (!cancelled) setData(res)
      } catch (e) {
        console.error('[baselines] yuklenemedi:', e?.message || e)
        if (!cancelled) setError(t('baselines.error'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, entityType, row.id, t])

  const toggle = async (snapshotId) => {
    if (openId === snapshotId) {
      setOpenId(null)
      return
    }
    setOpenId(snapshotId)
    if (details[snapshotId]) return
    try {
      const detail = await getEntityBaselineDetail(projectId, entityType, row.id, snapshotId)
      setDetails((d) => ({ ...d, [snapshotId]: detail }))
    } catch (e) {
      console.error('[baselines] detay yuklenemedi:', e?.message || e)
      setDetails((d) => ({ ...d, [snapshotId]: { error: t('baselines.detailError') } }))
    }
  }

  if (error) {
    return <p className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>
  }
  if (!data) {
    return <p className="py-6 text-center text-sm text-slate-400">{t('baselines.loading')}</p>
  }
  // Hicbir baseline'da yer almayan kayit: bu durum acikca soylenir.
  if (data.total === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 py-10 text-slate-400"
        data-testid="baselines-empty"
      >
        <IconHistory size={28} />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {t('baselines.emptyTitle')}
        </p>
        <p className="max-w-sm text-center text-xs">{t('baselines.emptyDesc')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="baselines-list">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('baselines.intro', { n: data.total })}
      </p>
      {data.baselines.map((b) => (
        <BaselineRow
          key={b.id}
          baseline={b}
          open={openId === b.id}
          detail={details[b.id]}
          onToggle={() => toggle(b.id)}
          t={t}
        />
      ))}
    </div>
  )
}

function BaselineRow({ baseline, open, detail, onToggle, t }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`baseline-row-${baseline.id}`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {baseline.name}
            </span>
            {baseline.label && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                {baseline.label}
              </span>
            )}
            {/* Resmî baseline, sıradan ara kayıttan rozetle ayrılır. */}
            {baseline.isBaseline && (
              <span className="inline-flex items-center gap-1 rounded bg-brand-600/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                <IconLock size={10} /> {t('snapshot.baselineBadge')}
              </span>
            )}
            {baseline.moduleKey && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t(`module.${baseline.moduleKey}`)}
                {baseline.version != null
                  ? ` · ${t('snapshot.versionBadge', { n: baseline.version })}`
                  : ''}
              </span>
            )}
            {baseline.setName && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                {baseline.setName}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(baseline.createdAt)}
            {baseline.createdBy ? ` · ${baseline.createdBy}` : ''}
          </span>
        </span>
        <IconChevron
          size={15}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          {!detail ? (
            <p className="text-xs text-slate-400">{t('baselines.loading')}</p>
          ) : detail.error ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">{detail.error}</p>
          ) : (
            <BaselineDetail detail={detail} t={t} />
          )}
        </div>
      )}
    </div>
  )
}

/** Kaydın o baseline'daki hali + canlı halle ALAN BAZINDA farkı. */
function BaselineDetail({ detail, t }) {
  return (
    <div className="space-y-2" data-testid="baseline-detail">
      {/* Kayıt canlıda silinmiş olabilir: dondurulmuş hali yine okunur. */}
      {detail.liveDeleted && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {t('baselines.liveDeleted')}
        </p>
      )}

      <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto,1fr]">
        <dt className="font-semibold text-slate-500 dark:text-slate-400">
          {t('snapshot.thTextId')}
        </dt>
        <dd className="font-mono text-slate-700 dark:text-slate-200">
          {detail.data.text_id || '—'}
        </dd>
        <dt className="font-semibold text-slate-500 dark:text-slate-400">
          {t('snapshot.thTitle')}
        </dt>
        <dd className="text-slate-700 dark:text-slate-200">
          {detail.data.title || detail.data.term || '—'}
        </dd>
        {detail.data.status && (
          <>
            <dt className="font-semibold text-slate-500 dark:text-slate-400">
              {t('snapshot.thStatus')}
            </dt>
            <dd className="text-slate-700 dark:text-slate-200">{detail.data.status}</dd>
          </>
        )}
      </dl>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('baselines.diffTitle')}
        </p>
        {!detail.changed ? (
          <p
            className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
            data-testid="baseline-unchanged"
          >
            {t('baselines.unchanged')}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="baseline-fields">
            {detail.fields.map((f) => (
              <li key={f.field} className="rounded bg-white px-2 py-1 text-xs dark:bg-slate-900/40">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{f.field}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through dark:bg-rose-900/30 dark:text-rose-300">
                    {showValue(f.from, t)}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {showValue(f.to, t)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
