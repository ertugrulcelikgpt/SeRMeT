// ============================================================================
//  LinkExpandPanel.jsx  —  Issue #123: Satir genisletildiginde acilan bag
//  paneli. Bir kaydin UST baglari, ALT baglari, DOGRULAYAN test senaryolari
//  (sonucuyla) ve atanan sozluk terimleri KOD + BASLIK ile listelenir; bir
//  koda tiklaninca hedef kayit acilir (ViewModal).
//
//  Veri CAGIRAN tarafindan TOPLU olarak hazirlanir (utils/linkIndex.js):
//  bu bilesen hicbir istek atmaz, yalnizca hazir ozeti cizer — bu yuzden
//  satir acmak ek sorgu maliyeti getirmez.
// ============================================================================
import { TypeBadge, VerificationBadge } from './Badge.jsx'
import { IconLink } from './Icons.jsx'
import { getDisplayLabel } from '../../utils/format.js'
import { testResultState } from '../../utils/verification.js'

function LinkItem({ item, onOpen, t }) {
  const { node, kind } = item
  const label = getDisplayLabel(node).text
  // Test senaryolarinda sonuc durumu (Doğrulandı / Bekliyor / Başarısız)
  // SATIR ICINDE gorunur — LinkManager'i acmaya gerek kalmaz.
  const state = kind === 'testcase' ? testResultState(node.status) : null
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onOpen && onOpen(item)}
        disabled={!onOpen}
        data-testid="link-chip"
        data-code={node.text_id}
        title={onOpen ? t('links.openTarget') : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/60 disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-brand-800 dark:hover:bg-brand-950/30 dark:disabled:hover:bg-slate-800/60"
      >
        <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">
          {node.text_id}
        </span>
        <span className="truncate text-xs text-slate-700 dark:text-slate-200">{label}</span>
        {node.type && <TypeBadge value={node.type} />}
        {state && <VerificationBadge info={{ state }} t={t} showCount={false} />}
      </button>
    </li>
  )
}

function Section({ title, items, onOpen, t }) {
  return (
    <div>
      <h5 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title} <span className="text-slate-400">({items.length})</span>
      </h5>
      {items.length === 0 ? (
        <p className="rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-slate-400 dark:bg-slate-800/40">
          {t('links.none')}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <LinkItem key={it.linkId} item={it} onOpen={onOpen} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * @param {Object}   summary  utils/linkIndex.js -> linkSummaryOf ciktisi
 * @param {Function} onOpen   (item) => void — bagli kayda git
 * @param {boolean}  showChildren  Alt bag bolumu anlamli mi (testlerde degil)
 */
export default function LinkExpandPanel({ summary, onOpen, t, showChildren = true }) {
  const s = summary || {}
  const terms = s.terms || []
  const tests = s.tests || []
  return (
    <div
      data-testid="link-expand-panel"
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40"
    >
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
        <IconLink size={14} /> {t('links.panelTitle')}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title={t('links.up')} items={s.parents || []} onOpen={onOpen} t={t} />
        {showChildren && (
          <Section title={t('links.down')} items={s.children || []} onOpen={onOpen} t={t} />
        )}
        {/* Testler ve sozluk terimleri yalnizca gereksinim tarafinda anlamli;
            bos olsalar bile test bolumu gosterilir (kapsam acigi gorunsun). */}
        {showChildren && <Section title={t('links.tests')} items={tests} onOpen={onOpen} t={t} />}
        {terms.length > 0 && (
          <Section title={t('links.terms')} items={terms} onOpen={onOpen} t={t} />
        )}
      </div>
    </div>
  )
}
