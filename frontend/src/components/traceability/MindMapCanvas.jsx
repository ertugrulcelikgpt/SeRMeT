// ============================================================================
//  MindMapCanvas.jsx  —  Zihin haritasinin CIZIM katmani (SVG).
//  Sorumlulugu tek sey: hazir bir duzeni (utils/mindMap.js) ekrana cizmek ve
//  yakinlastirma / kaydirma etkilesimini yonetmek. Veri, acik/kapali durumu
//  ve kayit detayi UST bilesenin (pages/MindMap.jsx) isidir.
//
//  ETKILESIM: dugum govdesine tiklamak KAYDIN DETAYINI acar (ID, aciklama,
//  oznitelikler...), dal ucundaki NOKTA dali acar/kapatir. Ust bilesen
//  `onNodeClick` verirse tiklamanin ne yapacagina kendisi karar verir
//  (orn. ayni tiklamayla secimi de tasimak icin).
//
//  DUGUM ICERIGI iki kipte cizilir:
//    nodeDetail='full'  (varsayilan, #122): ID + tip eki, baslik, istege
//      bagli ozet satiri.
//    nodeDetail='label' (#129 Bilesenler): YALNIZCA ISIM. Kutular kucuk ve
//      sakin kalir; ID ve aciklama tiklaninca acilan detayda okunur, ustune
//      gelince de ipucu (tooltip) olarak gorunur.
//
//  PERFORMANS: 500+ dugumlu projelerde tum dugumleri DOM'a basmak pahalidir.
//  Iki kademeli koruma vardir:
//    1) KAPALI dallar zaten duzene hic girmez (kademeli yukleme),
//    2) duzene giren dugum sayisi esigi asarsa yalnizca GORUS ALANINA
//       dusenler cizilir (sanallastirma). Gorus dikdortgeni 200 birimlik
//       kovalara yuvarlanir; kucuk kaydirmalar yeniden hesap tetiklemez.
// ============================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../../context/LanguageContext.jsx'
import {
  MIND_MAP_BRANCH_COLORS,
  fitLabel,
  mindMapEdgePath,
  mindMapTheme,
} from '../../utils/mindMap.js'
import { IconPlus, IconReset, IconSearch } from '../common/Icons.jsx'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 2.5
// Bu sayidan fazla dugum cizilecekse gorus alani disi dugumler atlanir.
const VIRTUALIZE_OVER = 220
// Sanallastirma penceresi payi ve kova boyu (dunya birimi).
const CULL_MARGIN = 320
const CULL_BUCKET = 200
// Bu yakinlastirma seviyesinin altinda etiket metni okunmaz; cizilmez de.
const LABEL_MIN_ZOOM = 0.45
// Aramada bulunan dugumun vurgu rengi (amber-500) — dal renklerinden
// bilincli olarak ayrik, boylece seviye rengiyle karistirilmaz.
const FOCUS_COLOR = '#f59e0b'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const bucketize = (v) => Math.floor(v / CULL_BUCKET) * CULL_BUCKET

export default function MindMapCanvas({
  mapLayout,
  theme = 'dark',
  onToggle,
  onOpenNode,
  canOpenNode = () => true,
  // Verilirse dugum tiklamasini TAMAMEN ust bilesen yonetir (detayi acmak
  // da dahil); verilmezse tiklama `onOpenNode` ile detayi acar.
  onNodeClick = null,
  // 'full' | 'label' — bkz. dosya basligi.
  nodeDetail = 'full',
  // Issue #122 arama: verilen yol anahtarindaki dugum vurgulanir ve
  // ekranin ORTASINA alinir. `focusSeq` her arama isteginde artirilir;
  // boylece AYNI dugume tekrar odaklanmak (kullanici haritayi kaydirdiktan
  // sonra yeniden "Bul" demesi) da gorusu geri getirir.
  focusKey = null,
  focusSeq = 0,
  // Ekran okuyucu etiketi. Ayni motor iki farkli haritayi cizdigi icin
  // (Gereksinim Haritasi #122, Bilesenler #129) adi sayfa belirler.
  ariaLabel = null,
  className = '',
}) {
  const { t } = useLang()
  const boxRef = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [panning, setPanning] = useState(false)
  const panRef = useRef(null)
  const fittedRef = useRef(false)
  const colors = mindMapTheme(theme)
  const L = mapLayout.layout

  // --- Kapsayici olcusu -----------------------------------------------------
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const read = () => setSize({ w: el.clientWidth || 0, h: el.clientHeight || 0 })
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- Haritayi ekrana sigdir ----------------------------------------------
  //  `readable`: ILK acilista kullanilir. Genis bir agaci zorla ekrana
  //  sigdirmak olcegi etiketlerin cizilmedigi seviyenin altina dusurur ve
  //  kullanici bos kutulardan olusan bir duvar gorur. Bu kipte olcek
  //  okunur sinirin altina inmez; sigmayan harita, KOK dugum ust-ortada
  //  olacak sekilde konumlanir ve kullanici kaydirarak gezer.
  const fitView = useCallback(
    ({ readable = false } = {}) => {
      const { w, h } = { w: size.w, h: size.h }
      if (!w || !h || !mapLayout.width || !mapLayout.height) return
      const raw = Math.min(w / mapLayout.width, h / mapLayout.height)
      // Okunur kipte once GENISLIGE sigdirilir: sikisik harita bilerek
      // uzundur, yuksekligi de sigdirmaya calismak olcegi gereksiz yere
      // kucultur. Alt sinir, etiketlerin cizildigi olcektir.
      const k = clamp(
        readable ? Math.max(Math.min(w / mapLayout.width, 1.1), LABEL_MIN_ZOOM) : raw,
        MIN_ZOOM,
        1.1,
      )
      const fitsW = mapLayout.width * k <= w
      const fitsH = mapLayout.height * k <= h
      const anchor = mapLayout.nodes[0]
      setView({
        k,
        x:
          fitsW || !anchor
            ? -mapLayout.minX * k + (w - mapLayout.width * k) / 2
            : w / 2 - (anchor.x + mapLayout.layout.nodeWidth / 2) * k,
        y: fitsH ? -mapLayout.minY * k + (h - mapLayout.height * k) / 2 : -mapLayout.minY * k,
      })
    },
    [size.w, size.h, mapLayout],
  )

  // Ilk anlamli duzende bir kez sigdir. SONRAKI tazelemelerde (canli
  // guncelleme) gorus BILEREK korunur — kullanicinin baktigi yer kaymasin.
  useEffect(() => {
    if (fittedRef.current) return
    if (!size.w || mapLayout.nodes.length === 0) return
    fittedRef.current = true
    fitView({ readable: true })
  }, [size.w, mapLayout.nodes.length, fitView])

  // --- Aramadan gelen odaklanma --------------------------------------------
  //  Hedef dugum gorus alaninin ortasina alinir; cok uzaklasilmissa okunur
  //  bir olcege donulur. Duzen once yeniden hesaplandigi (kapali dallar
  //  acildigi) icin bu etki mapLayout guncellendikten SONRA calisir.
  useEffect(() => {
    if (!focusKey || !size.w) return
    const target = mapLayout.nodes.find((n) => n.key === focusKey)
    if (!target) return
    setView((v) => {
      const k = v.k < LABEL_MIN_ZOOM ? 0.8 : v.k
      return {
        k,
        x: size.w / 2 - (target.x + L.nodeWidth / 2) * k,
        y: size.h / 2 - target.y * k,
      }
    })
    // focusSeq bilerek bagimliliktir: ayni anahtara tekrar odaklanmak da
    // gorusu hedefe geri getirmelidir.
  }, [focusKey, focusSeq, mapLayout, size.w, size.h, L.nodeWidth])

  const zoomBy = useCallback(
    (factor, cx, cy) => {
      setView((v) => {
        const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM)
        if (k === v.k) return v
        const px = cx ?? size.w / 2
        const py = cy ?? size.h / 2
        return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }
      })
    },
    [size.w, size.h],
  )

  // Tekerlek KAYDIRIR, Ctrl/Cmd + tekerlek YAKINLASTIRIR (Figma/Miro
  // sozlesmesi). Sikisik dikey harita ekrana sigmayacak kadar UZUN oldugu
  // icin tekerlegin yakinlastirmasi gezinmeyi zorlastiriyordu; belge gibi
  // kaydirmak dogal olani. Shift ile yatay kaydirilir.
  // React'in onWheel'i pasif dinleyiciye baglandigi icin sayfanin kaymasini
  // engelleyebilmek adina elle baglanir.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
        return
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      const dy = e.shiftKey ? 0 : e.deltaY
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // --- Kaydirma (pan) -------------------------------------------------------
  const onPointerDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest?.('[data-mindmap-hit]')) return // dugum/nokta tiklamasi
    panRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }
    setPanning(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const p = panRef.current
    if (!p) return
    setView((v) => ({ ...v, x: p.x + (e.clientX - p.px), y: p.y + (e.clientY - p.py) }))
  }
  const endPan = (e) => {
    if (!panRef.current) return
    panRef.current = null
    setPanning(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // --- Sanallastirma --------------------------------------------------------
  //  Gorus dikdortgeni kovalara yuvarlanir; kucuk kaydirmalarda memo korunur.
  const cullOn = size.w > 0 && mapLayout.nodes.length > VIRTUALIZE_OVER
  const win = cullOn
    ? {
        x1: bucketize(-view.x / view.k - CULL_MARGIN),
        y1: bucketize(-view.y / view.k - CULL_MARGIN),
        x2: bucketize((size.w - view.x) / view.k + CULL_MARGIN) + CULL_BUCKET,
        y2: bucketize((size.h - view.y) / view.k + CULL_MARGIN) + CULL_BUCKET,
      }
    : null

  const drawn = useMemo(() => {
    if (!win) return { nodes: mapLayout.nodes, edges: mapLayout.edges }
    const nodes = mapLayout.nodes.filter(
      (n) =>
        n.x + L.nodeWidth >= win.x1 &&
        n.x <= win.x2 &&
        n.y + L.nodeHeight >= win.y1 &&
        n.y - L.nodeHeight <= win.y2,
    )
    const edges = mapLayout.edges.filter(
      (e) =>
        Math.max(e.x1, e.x2) >= win.x1 &&
        Math.min(e.x1, e.x2) <= win.x2 &&
        Math.max(e.y1, e.y2) >= win.y1 &&
        Math.min(e.y1, e.y2) <= win.y2,
    )
    return { nodes, edges }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayout, L.nodeWidth, L.nodeHeight, win?.x1, win?.y1, win?.x2, win?.y2])

  const showLabels = view.k >= LABEL_MIN_ZOOM

  // Ac/kapa noktasi dalin CIKTIGI kenarda durur: yatay duzende sag orta,
  // dikey (yukaridan asagi) duzende alt orta.
  const labelOnly = nodeDetail === 'label'
  const vertical = mapLayout.orientation === 'vertical'
  const dotXOf = (n) => (vertical ? n.x + L.nodeWidth / 2 : n.x + L.nodeWidth)
  const dotYOf = (n) => (vertical ? n.y + L.nodeHeight / 2 : n.y)

  const ctrl = (label, onClick, children, testId) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {children}
    </button>
  )

  return (
    <div
      ref={boxRef}
      data-testid="mindmap-canvas"
      className={`relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${className}`}
      style={{ background: colors.bg }}
    >
      <svg
        ref={svgRef}
        role="tree"
        aria-label={ariaLabel || t('mindmap.canvasLabel')}
        width="100%"
        height="100%"
        className={panning ? 'cursor-grabbing' : 'cursor-grab'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {/* Ok uclari dal rengine gore hazirlanir (SVG marker'lari boya
            degerini miras almaz, her renk icin ayri tanim gerekir). */}
        <defs>
          {Object.entries(MIND_MAP_BRANCH_COLORS).map(([level, color]) => (
            <marker
              key={level}
              id={`mm-arrow-${level}`}
              viewBox="0 0 8 8"
              refX="7.5"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 Z" fill={color} opacity="0.85" />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g>
            {drawn.edges.map((e) => (
              <path
                key={e.key}
                d={mindMapEdgePath(e)}
                fill="none"
                stroke={e.color}
                strokeWidth={2}
                strokeOpacity={0.75}
                strokeLinecap="round"
                markerEnd={e.level ? `url(#mm-arrow-${e.level})` : undefined}
              />
            ))}
          </g>
          <g>
            {drawn.nodes.map((n) => {
              const top = n.y - L.nodeHeight / 2
              const openable = canOpenNode(n)
              return (
                <g
                  key={n.key}
                  role="treeitem"
                  aria-expanded={n.hasChildren ? n.expanded : undefined}
                >
                  <rect
                    data-mindmap-hit="node"
                    data-testid={`mindmap-node-${n.node.text_id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.node.text_id} ${n.node.label}`}
                    x={n.x}
                    y={top}
                    width={L.nodeWidth}
                    height={L.nodeHeight}
                    rx={10}
                    fill={colors.nodeBg}
                    stroke={n.key === focusKey ? FOCUS_COLOR : n.color}
                    strokeWidth={n.key === focusKey ? 3 : 1.5}
                    style={{ cursor: onNodeClick || openable ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (onNodeClick) onNodeClick(n)
                      else if (openable) onOpenNode?.(n)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      if (onNodeClick) onNodeClick(n)
                      else if (openable) onOpenNode?.(n)
                    }}
                  >
                    {/* Kutuda yalnizca isim yazdiginda ID ve ozet ustune
                        gelince ipucu olarak gorunur. */}
                    <title>
                      {[n.node.text_id, n.node.label, n.node.meta].filter(Boolean).join(' — ')}
                    </title>
                  </rect>
                  <rect
                    x={n.x}
                    y={top + 6}
                    width={4}
                    height={L.nodeHeight - 12}
                    rx={2}
                    fill={n.color}
                    pointerEvents="none"
                  />
                  {showLabels && labelOnly && (
                    // YALNIZCA ISIM: tek satir, kutunun dikey ortasinda.
                    <text
                      x={n.x + 14}
                      y={n.y + 4}
                      fontSize={12}
                      fontWeight={600}
                      fill={colors.nodeText}
                      pointerEvents="none"
                    >
                      {fitLabel(n.node.label, L.nodeWidth)}
                    </text>
                  )}
                  {showLabels && !labelOnly && (
                    <>
                      <text
                        x={n.x + 14}
                        y={top + 17}
                        fontSize={10}
                        fontWeight={700}
                        fill={n.color}
                        className="font-mono"
                        pointerEvents="none"
                      >
                        {n.node.text_id}
                        {n.node.typeSuffix ? (
                          <tspan fill={colors.subText}> · {n.node.typeSuffix}</tspan>
                        ) : null}
                      </text>
                      <text
                        x={n.x + 14}
                        y={top + 32}
                        fontSize={11}
                        fill={colors.nodeText}
                        pointerEvents="none"
                      >
                        {fitLabel(n.node.label, L.nodeWidth)}
                      </text>
                      {/* Ucuncu satir (istege bagli): dugumun kendi ozeti —
                          orn. "6 gereksinim · 2 doğrulandı". Yalnizca veren
                          sayfalarda vardir; dugum yuksekligi o sayfanin
                          duzeninden (layout.nodeHeight) gelir. */}
                      {n.node.meta && (
                        <text
                          x={n.x + 14}
                          y={top + 47}
                          fontSize={10}
                          fontWeight={600}
                          fill={colors.subText}
                          pointerEvents="none"
                        >
                          {fitLabel(n.node.meta, L.nodeWidth)}
                        </text>
                      )}
                    </>
                  )}
                  {/* Dalin ucundaki nokta: dali acar / kapatir. */}
                  {n.hasChildren && (
                    <g
                      data-mindmap-hit="dot"
                      data-testid={`mindmap-toggle-${n.node.text_id}`}
                      role="button"
                      tabIndex={0}
                      aria-label={t(
                        n.expanded ? 'mindmap.collapseBranch' : 'mindmap.expandBranch',
                        {
                          id: n.node.text_id,
                          n: n.childCount,
                        },
                      )}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onToggle?.(n.key, n)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onToggle?.(n.key, n)
                      }}
                    >
                      <circle
                        cx={dotXOf(n)}
                        cy={dotYOf(n)}
                        r={9}
                        fill={colors.dotBg}
                        stroke={n.color}
                        strokeWidth={2}
                      />
                      <path
                        d={
                          `M ${dotXOf(n) - 4} ${dotYOf(n)} H ${dotXOf(n) + 4}` +
                          (n.expanded ? '' : ` M ${dotXOf(n)} ${dotYOf(n) - 4} V ${dotYOf(n) + 4}`)
                        }
                        stroke={n.color}
                        strokeWidth={1.9}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                      {!n.expanded && (
                        <text
                          x={dotXOf(n) + 14}
                          y={dotYOf(n) + 4}
                          fontSize={10}
                          fontWeight={700}
                          fill={colors.subText}
                          pointerEvents="none"
                        >
                          {n.childCount}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {/* Zoom kontrolleri */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        {ctrl(t('mindmap.zoomIn'), () => zoomBy(1.25), <IconPlus size={15} />, 'mindmap-zoom-in')}
        {ctrl(
          t('mindmap.zoomOut'),
          () => zoomBy(1 / 1.25),
          <span className="text-base font-bold leading-none">−</span>,
          'mindmap-zoom-out',
        )}
        {ctrl(t('mindmap.fit'), () => fitView(), <IconSearch size={15} />, 'mindmap-fit')}
        {ctrl(
          t('mindmap.resetZoom'),
          () => setView((v) => ({ ...v, k: 1 })),
          <IconReset size={15} />,
          'mindmap-zoom-reset',
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold tabular-nums text-white">
        {Math.round(view.k * 100)}%
      </div>
    </div>
  )
}
