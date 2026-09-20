// ============================================================================
//  Components.jsx  —  Issue #129: "Bileşenler" (bileşen bazli gorunum).
//
//  Gereksinim sayfalari hiyerarsi SEVIYESINE gore listeler (User / System /
//  Sub-system). Ekipler ise cogu zaman BILESEN uzerinden bakar: "Su Pompasi
//  Unitesi icin hangi gereksinimler var?" Bu sayfa o soruyu tek ekranda
//  cevaplar — secilen bilesenin TUM gereksinimleri, seviye ayrimi olmadan,
//  kullanim kilavuzundaki TID tablosu duzeninde listelenir:
//
//    TID No · Text ID · Baslik · Gereksinim Metni · Bagli SGD · Dogrulama
//
//  Bilesen kaynagi PBS AGACIDIR (Requirement.parentId) — urun kirilimi zaten
//  orada; alt kirilimi olan her dugum bir bilesendir ve altindaki her sey o
//  bilesenin gereksinimidir. Urun agaci kurulmamis projelerde ALAN (field)
//  kaynagina gecilebilir (bkz. utils/components.js).
//
//  Issue #122'deki "Zihin Haritasi" ile KARISTIRILMAMALIDIR: orasi baglanti
//  agini gorsellestirir, burasi bilesen odakli DUZ liste sunar. Ikisi birlikte
//  var olur.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useProject } from '../context/ProjectContext.jsx'
import ViewModal from '../components/common/ViewModal.jsx'
import { VerificationBadge } from '../components/common/Badge.jsx'
import { IconDownload, IconSearch, IconComponent } from '../components/common/Icons.jsx'
import { componentKeyOf } from '../utils/permissions.js'
import { buildVerificationIndex } from '../utils/verification.js'
import {
  COMPONENT_SOURCE,
  FIELD_NONE_KEY,
  VERIFICATION_METHOD_LABEL_KEY,
  buildComponentPrintHtml,
  buildComponentViewRows,
  buildComponents,
  buildRequirementTree,
  buildSatisfiesIndex,
  componentRowsToCsv,
  methodAttributeKeys,
  slugify,
  summarizeComponent,
} from '../utils/components.js'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function Components() {
  const { requirements, testCases, links, attributeDefs, refresh } = useApp()
  const { can } = useAuth()
  const { activeProject } = useProject()
  const { t } = useLang()

  // Kaynak secimi: kullanici secmediyse (null) PBS varsayilandir; PBS hic
  // bilesen uretmiyorsa (agac kurulmamis) Alan kaynagina DUSULUR — ekran
  // bos bir liste yerine calisir halde acilir.
  const [sourceChoice, setSourceChoice] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [query, setQuery] = useState('')
  const [viewRow, setViewRow] = useState(null)
  const [exportError, setExportError] = useState('')

  // Canli gorunum (MindMap ile ayni sozlesme): sayfa acildiginda ve sekmeye
  // donuldugunde proje verisi tazelenir; ayri bir "yenile" butonu yoktur.
  useEffect(() => {
    refresh?.()
    const onFocus = () => refresh?.()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Okuma izni olmayan seviyeler listeye HIC girmez (RBAC, 12 kademeli izin).
  const visibleRequirements = useMemo(
    () => (requirements || []).filter((r) => can('read', componentKeyOf('requirement', r.type))),
    [requirements, can],
  )

  const tree = useMemo(() => buildRequirementTree(visibleRequirements), [visibleRequirements])
  const pbsComponents = useMemo(
    () => buildComponents(visibleRequirements, { source: COMPONENT_SOURCE.PBS, tree }),
    [visibleRequirements, tree],
  )
  const fieldComponents = useMemo(
    () => buildComponents(visibleRequirements, { source: COMPONENT_SOURCE.FIELD, tree }),
    [visibleRequirements, tree],
  )

  const source =
    sourceChoice ||
    (pbsComponents.length === 0 && fieldComponents.length > 0
      ? COMPONENT_SOURCE.FIELD
      : COMPONENT_SOURCE.PBS)
  const components = source === COMPONENT_SOURCE.FIELD ? fieldComponents : pbsComponents

  const verificationIndex = useMemo(
    () => buildVerificationIndex(links, testCases),
    [links, testCases],
  )
  const satisfiesIndex = useMemo(() => buildSatisfiesIndex(links), [links])
  const methodKeys = useMemo(() => methodAttributeKeys(attributeDefs), [attributeDefs])

  const labelOf = (c) => (c.key === FIELD_NONE_KEY ? t('comp.fieldNone') : c.label)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    return components.filter(
      (c) =>
        labelOf(c).toLowerCase().includes(q) ||
        c.outline.includes(q) ||
        (c.node?.text_id || '').toLowerCase().includes(q),
    )
    // labelOf yalnizca t()'ye bagli; t dil degisiminde zaten yeniden render eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, query, t])

  // Secili bilesen listeden dustuyse (kaynak degisti / kayit silindi) ilk
  // siradakine gecilir; boylece sag panel hic bos kalmaz.
  const selected =
    components.find((c) => c.key === selectedKey) || filtered[0] || components[0] || null
  useEffect(() => {
    if (selected && selected.key !== selectedKey) setSelectedKey(selected.key)
  }, [selected, selectedKey])

  const viewRows = useMemo(() => {
    if (!selected) return []
    return buildComponentViewRows(selected.rows, {
      tree,
      satisfiesIndex,
      verificationIndex,
      methodKeys,
    })
  }, [selected, tree, satisfiesIndex, verificationIndex, methodKeys])

  const summaryOf = (c) => summarizeComponent(c.rows, verificationIndex)
  const summaryText = (c) => {
    const s = summaryOf(c)
    return t('comp.summary', { n: s.total, v: s.verified })
  }

  const methodLabel = (code) => t(VERIFICATION_METHOD_LABEL_KEY[code] || 'comp.method.none')
  const headers = [
    t('comp.th.outline'),
    t('comp.th.textId'),
    t('comp.th.title'),
    t('comp.th.text'),
    t('comp.th.linked'),
    t('comp.th.method'),
  ]

  const baseName = () =>
    `bilesen-${slugify(selected ? labelOf(selected) : '')}-${new Date().toISOString().slice(0, 10)}`

  const exportCsv = () => {
    setExportError('')
    try {
      const csv = componentRowsToCsv(viewRows, { headers, methodLabel })
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${baseName()}.csv`)
    } catch {
      setExportError(t('comp.exportError'))
    }
  }

  // PDF: ek bir kutuphane getirmemek icin yazdirma penceresi kullanilir
  // (tarayicinin "PDF olarak kaydet" hedefi). Acilir pencere engellenmisse
  // kullaniciya acik bir hata gosterilir.
  const exportPdf = () => {
    setExportError('')
    if (!selected) return
    try {
      const html = buildComponentPrintHtml({
        documentTitle: t('comp.printTitle'),
        projectName: activeProject?.name || '',
        componentLabel: labelOf(selected),
        summary: summaryText(selected),
        headers,
        viewRows,
        methodLabel,
      })
      const win = window.open('', '_blank')
      if (!win) {
        setExportError(t('comp.exportError'))
        return
      }
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
    } catch {
      setExportError(t('comp.exportError'))
    }
  }

  const totalRequirements = visibleRequirements.length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t('page.components.title')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span data-testid="comp-counts">
              {t('comp.componentCount', { n: components.length })} ·{' '}
              {t('comp.reqCount', { n: totalRequirements })}
            </span>{' '}
            · {t('page.components.sub')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!selected || viewRows.length === 0}
            data-testid="comp-export-csv"
            className="btn-secondary btn-sm disabled:opacity-40"
          >
            <IconDownload size={14} /> {t('comp.exportCsv')}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={!selected || viewRows.length === 0}
            data-testid="comp-export-pdf"
            className="btn-secondary btn-sm disabled:opacity-40"
          >
            <IconDownload size={14} /> {t('comp.exportPdf')}
          </button>
        </div>
      </div>

      {exportError && (
        <div
          data-testid="comp-export-error"
          className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
        >
          {exportError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Sol: bilesen listesi */}
        <aside className="card flex max-h-[70vh] flex-col overflow-hidden p-0">
          <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="flex gap-1" role="group" aria-label={t('comp.source')}>
              {[COMPONENT_SOURCE.PBS, COMPONENT_SOURCE.FIELD].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSourceChoice(s)
                    setSelectedKey(null)
                  }}
                  data-testid={`comp-source-${s}`}
                  aria-pressed={source === s}
                  className={
                    'flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ' +
                    (source === s
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')
                  }
                >
                  {t(s === COMPONENT_SOURCE.PBS ? 'comp.source.pbs' : 'comp.source.field')}
                </button>
              ))}
            </div>
            <div className="relative">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('comp.search')}
                aria-label={t('comp.search')}
                data-testid="comp-search"
                className="input w-full !py-1.5 !pl-8 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {components.length === 0 && (
              <p
                data-testid="comp-empty"
                className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
              >
                {source === COMPONENT_SOURCE.PBS ? t('comp.emptyPbs') : t('comp.empty')}
              </p>
            )}
            {components.length > 0 && filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                {t('comp.noMatch')}
              </p>
            )}
            <ul className="space-y-0.5">
              {filtered.map((c) => {
                const active = selected?.key === c.key
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(c.key)}
                      data-testid={`comp-item-${c.key}`}
                      aria-current={active ? 'true' : undefined}
                      style={
                        source === COMPONENT_SOURCE.PBS
                          ? { paddingLeft: `${0.5 + Math.min(c.depth, 5) * 0.75}rem` }
                          : undefined
                      }
                      className={
                        'w-full rounded-lg py-1.5 pr-2 text-left transition-colors ' +
                        (active
                          ? 'bg-brand-50 dark:bg-brand-900/30'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800')
                      }
                    >
                      <span className="flex items-center gap-1.5">
                        {c.outline && (
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {c.outline}
                          </span>
                        )}
                        <span
                          className={
                            'flex-1 truncate text-xs font-semibold ' +
                            (active
                              ? 'text-brand-700 dark:text-brand-300'
                              : 'text-slate-700 dark:text-slate-200')
                          }
                        >
                          {labelOf(c)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {summaryText(c)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>

        {/* Sag: secili bilesenin TUM gereksinimleri (TID tablosu duzeni) */}
        <section className="card overflow-hidden p-0">
          {!selected ? (
            <div className="px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('comp.selectHint')}
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                  <IconComponent size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3
                    data-testid="comp-selected-title"
                    className="truncate text-sm font-bold text-slate-900 dark:text-white"
                  >
                    {selected.outline && (
                      <span className="mr-1.5 font-mono text-xs text-slate-400">
                        {selected.outline}
                      </span>
                    )}
                    {labelOf(selected)}
                  </h3>
                  <p
                    data-testid="comp-selected-summary"
                    className="text-[11px] font-semibold text-slate-400"
                  >
                    {summaryText(selected)}
                  </p>
                </div>
              </header>

              {viewRows.length === 0 ? (
                <div className="px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                  {t('comp.noRows')}
                </div>
              ) : (
                <div className="max-h-[62vh] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-bold">{t('comp.th.outline')}</th>
                        <th className="px-3 py-2 font-bold">{t('comp.th.textId')}</th>
                        <th className="px-3 py-2 font-bold">{t('comp.th.title')}</th>
                        <th className="px-3 py-2 font-bold">{t('comp.th.text')}</th>
                        <th className="px-3 py-2 font-bold">{t('comp.th.linked')}</th>
                        <th className="px-3 py-2 font-bold">{t('comp.th.method')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {viewRows.map((v) => (
                        <tr
                          key={v.id}
                          onClick={() => setViewRow(v.row)}
                          data-testid={`comp-row-${v.text_id}`}
                          title={t('comp.rowOpen')}
                          className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-400 tabular-nums">
                            {v.outline}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">
                            {v.text_id}
                          </td>
                          <td className="px-3 py-2 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                            {v.title || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[13px] text-slate-600 dark:text-slate-300">
                            {v.textPreview || <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {v.linkedUp.length === 0 && v.linkedDown.length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {v.linkedUp.map((id) => (
                                  <span
                                    key={`up-${id}`}
                                    title={t('comp.linkedUp')}
                                    className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                                  >
                                    ↑ {id}
                                  </span>
                                ))}
                                {v.linkedDown.map((id) => (
                                  <span
                                    key={`down-${id}`}
                                    title={t('comp.linkedDown')}
                                    className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                                  >
                                    ↓ {id}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className="flex items-center gap-1.5">
                              <span
                                data-testid={`comp-method-${v.text_id}`}
                                title={
                                  v.method
                                    ? `${methodLabel(v.method.code)}${
                                        v.method.derived ? ` · ${t('comp.method.derived')}` : ''
                                      }`
                                    : t('comp.method.missing')
                                }
                                className={
                                  'inline-flex min-w-[2rem] justify-center rounded px-1.5 py-0.5 text-[11px] font-bold ' +
                                  (v.method
                                    ? v.method.derived
                                      ? 'bg-slate-100 text-slate-500 ring-1 ring-dashed ring-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-600'
                                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'text-slate-400')
                                }
                              >
                                {v.method ? v.method.code : '—'}
                              </span>
                              {/* Yontem (T/M/D/A/CoC) NE ile dogrulanacagini,
                                  rozet ise o dogrulamanin NEREDE oldugunu
                                  soyler — ikisi birbirinin yerine gecmez. */}
                              <VerificationBadge info={v.verification} t={t} showCount={false} />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Kayit detayi — bu sayfa SALT OKUNUR bir gorunumdur; duzenleme kendi
          hiyerarsi sayfasindan ya da urun agacindan yapilir. */}
      <ViewModal
        open={Boolean(viewRow)}
        row={viewRow}
        canWrite={false}
        showStatus={false}
        showVerification
        commentEntityType="requirement"
        onClose={() => setViewRow(null)}
      />
    </div>
  )
}
