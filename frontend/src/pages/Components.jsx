// ============================================================================
//  Components.jsx  —  Issue #129: "Bileşenler" (bileşen bazli gorunum).
//
//  Gereksinim sayfalari hiyerarsi SEVIYESINE gore listeler (User / System /
//  Sub-system). Ekipler ise cogu zaman BILESEN uzerinden bakar: "Su Pompasi
//  Unitesi icin hangi gereksinimler var?" Bu sayfa o soruyu cevaplar.
//
//  IKI GORUNUM, TEK SECIM:
//    HARITA (varsayilan) — urun kirilimi zaten bir agac oldugu icin akis
//      semasi dogal sunumdur. YUKARIDAN ASAGI dallanir: kokten disa acilan
//      yelpaze, yaprak yiginlari ise ust kutunun altinda ayni hizada bir
//      zincir (bkz. layoutMindMap `compact`).
//      Kutuda YALNIZCA ISIM yazar; KUTUYA TIKLAYINCA kaydin detayi (ID,
//      aciklama, oznitelikler) acilir ve secim oraya tasinir, dal ucundaki
//      NOKTA dali acar/kapatir. Harita tek bir proje dugumuyle acilir ve
//      asagi inildikce genisler — kalabaligi doguran sey tum kayitlarin
//      ayni anda ekranda olmasiydi.
//    LISTE — ayni secimin kullanim kilavuzundaki TID tablosu duzeni:
//      TID No · Text ID · Baslik · Gereksinim Metni · Bagli SGD · Dogrulama.
//    Iki gorunum AYNI secimi paylasir; CSV/PDF disa aktarimi her ikisinde de
//    secili bilesenin gereksinimlerini yazar.
//
//  Cizim ve yerlesim Issue #122'de yazilan TEK motoru yeniden kullanir
//  (utils/mindMap.js + MindMapCanvas). Ama harita ORADAKINDEN farklidir:
//  #122 izlenebilirlik bag grafigidir (Satisfies/Verifies, testler dahil),
//  burasi tek-ebeveynli URUN AGACIDIR. Ikisi birlikte var olur.
//
//  Bilesen kaynagi PBS agacidir; urun agaci kurulmamis projelerde ALAN
//  (field) kaynagina gecilebilir (bkz. utils/components.js).
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useProject } from '../context/ProjectContext.jsx'
import MindMapCanvas from '../components/traceability/MindMapCanvas.jsx'
import ViewModal from '../components/common/ViewModal.jsx'
import {
  IconDownload,
  IconSearch,
  IconComponent,
  IconMindMap,
  IconList,
} from '../components/common/Icons.jsx'
import { componentKeyOf } from '../utils/permissions.js'
import { getDisplayLabel } from '../utils/format.js'
import { buildVerificationIndex } from '../utils/verification.js'
import { collectExpandableKeys, defaultExpandedKeys, layoutMindMap } from '../utils/mindMap.js'
import {
  COMPONENT_SOURCE,
  FIELD_NONE_KEY,
  PROJECT_ROOT_KEY,
  VERIFICATION_METHOD_LABEL_KEY,
  buildComponentGraph,
  buildComponentPrintHtml,
  buildComponentViewRows,
  buildComponents,
  buildRequirementTree,
  buildSatisfiesIndex,
  componentRowsToCsv,
  methodAttributeKeys,
  slugify,
  subtreeRows,
  subtreeStats,
  summarizeComponent,
} from '../utils/components.js'

// Dikey duzende `rowGap` SEVIYELER arasi (dikey) bosluk, `columnGap` ise
// KARDESLER arasi (yatay) bosluktur. Kutuda YALNIZCA ISIM yazdigi icin
// (ID ve aciklama tiklayinca acilan detayda) dugumler kucuk ve tek
// satirdir — hem daha sakin gorunur hem de harita belirgin sekilde daralir.
const MAP_LAYOUT = { nodeWidth: 176, nodeHeight: 36, rowGap: 30, columnGap: 18 }

const VIEW = { MAP: 'map', LIST: 'list' }

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
  const { requirements, testCases, links, attributeDefs, theme, refresh } = useApp()
  const { can } = useAuth()
  const { activeProject } = useProject()
  const { t } = useLang()

  const [view, setView] = useState(VIEW.MAP)
  // Kaynak secimi: kullanici secmediyse (null) PBS varsayilandir; PBS hic
  // bilesen uretmiyorsa (agac kurulmamis) Alan kaynagina DUSULUR — ekran
  // bos bir liste yerine calisir halde acilir.
  const [sourceChoice, setSourceChoice] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [viewRow, setViewRow] = useState(null)
  const [exportError, setExportError] = useState('')
  // Ilk gorulduginde kendiliginden acilan kokler; kullanicinin sonradan
  // kapattigi bir kok TEKRAR acilmasin diye "gorulenler" ayri tutulur.
  const seenRoots = useRef(new Set())

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
  const stats = useMemo(() => subtreeStats(tree, verificationIndex), [tree, verificationIndex])

  const labelOf = (c) => (c.key === FIELD_NONE_KEY ? t('comp.fieldNone') : c.label)
  const summaryText = (s) => t('comp.summary', { n: s.total, v: s.verified })

  // --- Harita grafigi -------------------------------------------------------
  //  Kutuda YALNIZCA ISIM yazar. Ozet ("6 gereksinim · 2 doğrulandı") artik
  //  kutunun ustune gelince IPUCU olarak gorunur; sayfa ust seridindeki
  //  secim rozetinde ve Liste gorunumunde zaten tam haliyle durur.
  const projectLabel = activeProject?.name || t('comp.projectRoot')
  const graph = useMemo(() => {
    const metaOf = (row, { childCount }) =>
      childCount > 0 ? summaryText(stats.get(row.id) || { total: 1, verified: 0 }) : ''
    return buildComponentGraph(visibleRequirements, {
      source,
      tree,
      metaOf,
      groupMetaOf: (g) => summaryText(summarizeComponent(g.rows, verificationIndex)),
      fieldNoneLabel: t('comp.fieldNone'),
      // Onlarca kok gereksinim tek bir proje dugumunun altinda toplanir:
      // harita "kapali" baslar, kullanici inerek acar.
      rootLabel: projectLabel,
      rootMeta: summaryText(summarizeComponent(visibleRequirements, verificationIndex)),
    })
    // summaryText/labelOf yalnizca t()'ye bagli; dil degisimi zaten render eder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRequirements, source, tree, stats, verificationIndex, projectLabel, t])

  // Yeni gorunen kokler kendiliginden acilir: yeni eklenen bir kayit sayfa
  // yenilemeden haritada dallariyla belirir.
  useEffect(() => {
    const fresh = graph.rootIds.filter((id) => !seenRoots.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) seenRoots.current.add(id)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of defaultExpandedKeys({ rootIds: fresh })) next.add(id)
      return next
    })
  }, [graph])

  const mapLayout = useMemo(
    () =>
      layoutMindMap(graph, expanded, {
        layout: MAP_LAYOUT,
        orientation: 'vertical',
        // Genis seviyeler (onlarca kardes) yan yana dizilince harita
        // binlerce piksel genisliyor ve ekrana sigdirmak icin gereken
        // yakinlastirmada etiketler okunmuyordu. Sikisik duzen bu
        // seviyeleri girintili listeye cevirir: harita daralir, asagi uzar.
        compact: true,
      }),
    [graph, expanded],
  )

  const toggle = useCallback((key, record) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // Dal acmak ayni zamanda SECIMDIR: disa aktarim ve Liste gorunumu bu
    // dugumun gereksinimlerini kullanir.
    if (record?.id) setSelectedId(record.id)
  }, [])

  const expandAll = () => setExpanded(collectExpandableKeys(graph).keys)
  const collapseAll = () => setExpanded(new Set())

  const canOpenNode = useCallback(
    (record) =>
      record?.node?.kind === 'requirement' &&
      can('read', componentKeyOf('requirement', record.node.type)),
    [can],
  )

  // Kutuya tiklamak KAYDIN DETAYINI acar (ID + aciklama + oznitelikler) ve
  // ayni tiklamayla secimi tasir; dal acma/kapama dal ucundaki noktadadir.
  // Kaydi olmayan sanal dugumler (proje / Alan grubu) yalnizca secilir.
  const handleNodeClick = useCallback(
    (record) => {
      if (record?.id) setSelectedId(record.id)
      if (canOpenNode(record) && record.node.row) setViewRow(record.node.row)
    },
    [canOpenNode],
  )

  // --- Secim (iki gorunum ortak) -------------------------------------------
  //  Secim bir BILESEN anahtari (Alan modu) ya da agactaki bir DUGUM id'si
  //  olabilir; yaprak secilirse tek satirlik bir liste cikar — bu da gecerli
  //  bir "bu kaydin kirilimi" gorunumudur.
  const selection = useMemo(() => {
    // Sanal proje dugumu secildiyse kapsam TUM projedir (disa aktarim da).
    if (selectedId === PROJECT_ROOT_KEY) {
      return {
        key: PROJECT_ROOT_KEY,
        label: projectLabel,
        outline: '',
        rows: tree.roots.flatMap((r) => subtreeRows(tree, r.id)),
      }
    }
    const comp = components.find((c) => c.key === selectedId)
    if (comp) return { key: comp.key, label: labelOf(comp), outline: comp.outline, rows: comp.rows }
    const node = tree.byId.get(selectedId)
    if (node) {
      return {
        key: node.id,
        label: getDisplayLabel(node).text || node.text_id,
        outline: tree.infoById.get(node.id)?.outline || '',
        rows: subtreeRows(tree, node.id),
      }
    }
    // Varsayilan: TUM PROJE. Boylece Liste gorunumu, kullanim kilavuzundaki
    // TID tablosunun tamami gibi acilir; bir bilesen secmek onu daraltir.
    if (tree.roots.length > 0) {
      return {
        key: PROJECT_ROOT_KEY,
        label: projectLabel,
        outline: '',
        rows: tree.roots.flatMap((r) => subtreeRows(tree, r.id)),
      }
    }
    const first = components[0]
    if (!first) return null
    return { key: first.key, label: labelOf(first), outline: first.outline, rows: first.rows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, selectedId, tree, projectLabel, t])

  const selectionSummary = useMemo(
    () => (selection ? summarizeComponent(selection.rows, verificationIndex) : null),
    [selection, verificationIndex],
  )

  const viewRows = useMemo(() => {
    if (!selection) return []
    return buildComponentViewRows(selection.rows, {
      tree,
      satisfiesIndex,
      verificationIndex,
      methodKeys,
    })
  }, [selection, tree, satisfiesIndex, verificationIndex, methodKeys])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    return components.filter(
      (c) =>
        labelOf(c).toLowerCase().includes(q) ||
        c.outline.includes(q) ||
        (c.node?.text_id || '').toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, query, t])

  // --- Disa aktarim ---------------------------------------------------------
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
    `bilesen-${slugify(selection?.label || '')}-${new Date().toISOString().slice(0, 10)}`

  const exportCsv = () => {
    setExportError('')
    try {
      const csv = componentRowsToCsv(viewRows, { headers })
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
    if (!selection) return
    try {
      const html = buildComponentPrintHtml({
        documentTitle: t('comp.printTitle'),
        projectName: activeProject?.name || '',
        componentLabel: selection.label,
        summary: summaryText(selectionSummary),
        headers,
        viewRows,
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

  const isEmpty = graph.nodes.size === 0
  const viewBtn = (key, label, Icon) => (
    <button
      type="button"
      onClick={() => setView(key)}
      data-testid={`comp-view-${key}`}
      aria-pressed={view === key}
      className={
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ' +
        (view === key
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')
      }
    >
      <Icon size={14} /> {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Baslik + gorunum secimi + disa aktarim */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t('page.components.title')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span data-testid="comp-counts">
              {t('comp.componentCount', { n: components.length })} ·{' '}
              {t('comp.reqCount', { n: visibleRequirements.length })}
            </span>{' '}
            · {t('page.components.sub')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-800"
            role="group"
            aria-label={t('comp.view')}
          >
            {viewBtn(VIEW.MAP, t('comp.view.map'), IconMindMap)}
            {viewBtn(VIEW.LIST, t('comp.view.list'), IconList)}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={viewRows.length === 0}
            data-testid="comp-export-csv"
            className="btn-secondary btn-sm disabled:opacity-40"
          >
            <IconDownload size={14} /> {t('comp.exportCsv')}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={viewRows.length === 0}
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

      {/* Arac cubugu: kaynak + (haritada) dal kontrolleri + secim ozeti */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-800">
          {[COMPONENT_SOURCE.PBS, COMPONENT_SOURCE.FIELD].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSourceChoice(s)
                setSelectedId(null)
                seenRoots.current = new Set()
                setExpanded(new Set())
              }}
              data-testid={`comp-source-${s}`}
              aria-pressed={source === s}
              className={
                'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ' +
                (source === s
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')
              }
            >
              {t(s === COMPONENT_SOURCE.PBS ? 'comp.source.pbs' : 'comp.source.field')}
            </button>
          ))}
        </div>

        {view === VIEW.MAP && !isEmpty && (
          <>
            <button
              type="button"
              onClick={expandAll}
              data-testid="comp-expand-all"
              className="btn-secondary btn-sm"
            >
              {t('mindmap.expandAll')}
            </button>
            <button
              type="button"
              onClick={collapseAll}
              data-testid="comp-collapse-all"
              className="btn-secondary btn-sm"
            >
              {t('mindmap.collapseAll')}
            </button>
            <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
              {t('comp.mapCounts', { visible: mapLayout.nodes.length, total: graph.nodes.size })}
            </span>
          </>
        )}

        <div className="flex-1" />

        {selection && (
          <span
            data-testid="comp-selection"
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <IconComponent size={13} className="text-brand-600 dark:text-brand-400" />
            {selection.outline && (
              <span className="font-mono text-slate-400">{selection.outline}</span>
            )}
            <span className="max-w-[16rem] truncate">{selection.label}</span>
            <span className="text-slate-400">· {summaryText(selectionSummary)}</span>
          </span>
        )}
      </div>

      {isEmpty ? (
        <div
          data-testid="comp-empty"
          className="card flex-1 px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400"
        >
          {source === COMPONENT_SOURCE.PBS ? t('comp.emptyPbs') : t('comp.empty')}
        </div>
      ) : view === VIEW.MAP ? (
        <>
          <MindMapCanvas
            mapLayout={mapLayout}
            theme={theme}
            onToggle={toggle}
            onNodeClick={handleNodeClick}
            canOpenNode={canOpenNode}
            nodeDetail="label"
            className="min-h-[460px] flex-1"
          />
          <p className="text-[11px] text-slate-400" data-testid="comp-map-hint">
            {t('comp.mapHint')}
          </p>
          {mapLayout.truncated && (
            <div
              data-testid="comp-truncated"
              className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
            >
              {t('mindmap.truncated', { n: mapLayout.nodes.length })}
            </div>
          )}
        </>
      ) : (
        <div className="grid flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Sol: bilesen listesi */}
          <aside className="card flex max-h-[70vh] flex-col overflow-hidden p-0">
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
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
              {filtered.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t('comp.noMatch')}
                </p>
              )}
              <ul className="space-y-0.5">
                {filtered.map((c) => {
                  const active = selection?.key === c.key
                  const s = summarizeComponent(c.rows, verificationIndex)
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.key)}
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
                          {summaryText(s)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>

          {/* Sag: secimin TUM gereksinimleri (TID tablosu duzeni) */}
          <section className="card overflow-hidden p-0">
            {!selection ? (
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
                      {selection.outline && (
                        <span className="mr-1.5 font-mono text-xs text-slate-400">
                          {selection.outline}
                        </span>
                      )}
                      {selection.label}
                    </h3>
                    <p
                      data-testid="comp-selected-summary"
                      className="text-[11px] font-semibold text-slate-400"
                    >
                      {summaryText(selectionSummary)}
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
                            data-component={v.isComponent ? 'true' : undefined}
                            title={t('comp.rowOpen')}
                            className={
                              'cursor-pointer align-top ' +
                              // Alt kirilimi olan kayit kendi blogunun BASLIK
                              // satiridir: koyu yazi + gri zemin (kilavuzdaki
                              // TID tablosuyla ayni okuma duzeni).
                              (v.isComponent
                                ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60')
                            }
                          >
                            <td
                              className={
                                'whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums ' +
                                (v.isComponent
                                  ? 'font-bold text-slate-700 dark:text-slate-200'
                                  : 'text-slate-400')
                              }
                            >
                              {v.outline}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-300">
                              {v.text_id}
                            </td>
                            {/* Girinti = agactaki derinlik: "Depo Kapasitesi"
                                basligi "Su Deposu Alt Sistemi"nin altinda
                                iceri kayar. */}
                            <td
                              className={
                                'px-3 py-2 text-[13px] ' +
                                (v.isComponent
                                  ? 'font-bold text-slate-900 dark:text-white'
                                  : 'font-semibold text-slate-800 dark:text-slate-100')
                              }
                              style={{ paddingLeft: `${0.75 + v.depth * 1.15}rem` }}
                            >
                              {v.title || <span className="font-normal text-slate-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-[13px] text-slate-600 dark:text-slate-300">
                              {v.text || <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {v.linkedText ? (
                                <span title={`${t('comp.linkedUp')} / ${t('comp.linkedDown')}`}>
                                  {v.linkedText}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <span
                                data-testid={`comp-method-${v.text_id}`}
                                title={
                                  v.method
                                    ? `${v.method.codes.map(methodLabel).join(' · ')}${
                                        v.method.derived ? ` · ${t('comp.method.derived')}` : ''
                                      }`
                                    : t('comp.method.missing')
                                }
                                className={
                                  'text-[12px] font-bold ' +
                                  (v.method
                                    ? v.method.derived
                                      ? 'text-slate-500 underline decoration-dotted underline-offset-2 dark:text-slate-400'
                                      : 'text-slate-800 dark:text-slate-100'
                                    : 'text-slate-400')
                                }
                              >
                                {v.method ? v.method.label : '—'}
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
      )}

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
