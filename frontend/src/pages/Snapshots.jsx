// ============================================================================
//  Snapshots.jsx  —  Sürüm Yönetimi (Snapshot) sayfası.
//  PM: yeni snapshot alma, silme, listeleme.
//  Personel: listeleme, salt-okunur detay görüntüleme.
//  Issue #8: Sürüm Yönetimi (Snapshot) Altyapısı.
//
//  Issue #128 — BASELINE: snapshot'a sürüm etiketi (v1.0/SRR/PDR/CDR),
//  açıklama ve "resmî baseline" işareti eklenir. Baseline DONDURULUR
//  (normal yoldan silinemez), GERİ YÜKLENEBİLİR (önizleme + zorunlu gerekçe +
//  otomatik güvenlik kopyası) ve KARŞILAŞTIRILABİLİR (baseline ↔ baseline ya
//  da baseline ↔ canlı; CSV/PDF olarak dışa aktarılır).
// ============================================================================
import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { formatDateTime, getDisplayLabel } from '../utils/format.js'
import {
  IconHistory,
  IconPlus,
  IconTrash,
  IconEye,
  IconReset,
  IconEdit,
  IconMatrix,
  IconDownload,
  IconLock,
  IconLoader,
} from '../components/common/Icons.jsx'
import Modal from '../components/common/Modal.jsx'
import ReasonModal from '../components/common/ReasonModal.jsx'
import Pill, { AttrBadge } from '../components/common/Badge.jsx'
import { getSnapshot, getRestorePreview, getSnapshotDiff } from '../services/dataService.js'
import {
  DIFF_ENTITY_TYPES,
  buildDiffPrintHtml,
  diffToCsv,
  filterEntries,
  formatDiffValue,
  slugifyLabel,
} from '../utils/baselineDiff.js'
import { REQ_PAGES, TEST_PAGES, TYPE_SUFFIX } from '../utils/constants.js'

const dash = <span className="text-slate-300 dark:text-slate-600">—</span>

function SnapshotDetailModal({ open, snapshot, onClose }) {
  const { t } = useLang()
  const [activeTab, setActiveTab] = useState('requirements')

  // Snapshot items'leri entityType'a göre grupla (useMemo before early return)
  const itemsByType = useMemo(() => {
    const grouped = {
      requirements: [],
      testcases: [],
      glossary: [],
      links: [],
      attributeDefs: [],
      navLayout: null,
    }
    if (!snapshot?.items) return grouped
    for (const item of snapshot.items) {
      if (item.entityType === 'requirement') grouped.requirements.push(item)
      else if (item.entityType === 'testcase') grouped.testcases.push(item)
      else if (item.entityType === 'glossary') grouped.glossary.push(item)
      else if (item.entityType === 'link') grouped.links.push(item)
      else if (item.entityType === 'attributeDef') grouped.attributeDefs.push(item.data)
      else if (item.entityType === 'navLayout') grouped.navLayout = item.data
    }
    grouped.attributeDefs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return grouped
  }, [snapshot?.items])

  // Modular öznitelik sütunları: o anki CANLI şema değil, snapshot'ın KENDİ
  // yakaladığı tanımlar kullanılır — böylece sonradan silinen/yeniden
  // adlandırılan öznitelikler bile bu snapshot'ta doğru görünür.
  const attrDefsFor = (entityType) =>
    itemsByType.attributeDefs.filter((d) => d.entityType === entityType || d.entityType === 'both')

  const reqAttrDefs = useMemo(() => attrDefsFor('requirement'), [itemsByType.attributeDefs])
  const tcAttrDefs = useMemo(() => attrDefsFor('testcase'), [itemsByType.attributeDefs])

  // Sayfa görünen adı — Hierarchy.jsx / TestCases.jsx / Sidebar.jsx ile AYNI
  // mantık (özel ad > varsayılan i18n etiketi, tip filtresi varsa sonek).
  const pageLabel = (item) => {
    const base =
      item.label ||
      REQ_PAGES[item.pageKey]?.navLabel ||
      TEST_PAGES[item.pageKey]?.navLabel ||
      (item.pageKey === 'glossary' ? t('nav.glossary') : item.pageKey)
    if (!item.typeFilter) return base
    return `${base} · ${TYPE_SUFFIX[item.typeFilter] || item.typeFilter}`
  }
  const groupLabel = (g) => (g.nameKey ? t(g.nameKey) : g.name)

  // Bir menü sayfasının o snapshot'taki gereksinim/test HAVUZUNDAN hangi
  // kayıtları gösterdiği — Hierarchy.jsx / TestCases.jsx ile AYNI filtre
  // mantığı (tip + alan), ama CANLI veri yerine snapshot'ın kendi verisi
  // üzerinde çalışır.
  const pageItemsFor = (item, pool) => {
    const reqCfg = REQ_PAGES[item.pageKey]
    if (reqCfg) {
      const types = item.typeFilter ? [item.typeFilter] : reqCfg.typeOptions
      return pool.filter(
        (r) =>
          types.includes(r.data.type) && (!item.fieldFilter || r.data.field === item.fieldFilter),
      )
    }
    const testCfg = TEST_PAGES[item.pageKey]
    if (testCfg) {
      return pool.filter(
        (tc) =>
          tc.data.type === testCfg.lockedType &&
          (!item.fieldFilter || tc.data.field === item.fieldFilter),
      )
    }
    return []
  }

  // Kullanıcı talebi: "sadece tek büyük havuz değil, o an hangi menü
  // sayfasında neyin olduğunu da görmek istiyorum". Bu yüzden Requirements /
  // Test Cases sekmeleri artık TEK tablo değil, yakalanan menü grup/sayfa
  // sırasıyla BİREBİR eşleşen ayrı bölümler halinde render edilir. Menü
  // yakalanmamış eski bir snapshot ise (navLayout yok) sections boş döner ve
  // eski düz-liste davranışına sorunsuzca geri düşülür.
  const buildSections = (matchesPageKey, pool) => {
    const nav = itemsByType.navLayout
    if (!nav) return { sections: [], unassigned: pool }
    const flatNavItems = [
      ...(nav.groups || []).flatMap((g) =>
        g.items.map((it) => ({ gLabel: groupLabel(g), item: it })),
      ),
      ...(nav.ungrouped || []).map((it) => ({ gLabel: null, item: it })),
    ]
    const sections = []
    const matchedIds = new Set()
    for (const { gLabel, item } of flatNavItems) {
      if (!matchesPageKey(item.pageKey)) continue
      const items = pageItemsFor(item, pool)
      for (const it of items) matchedIds.add(it.entityId)
      sections.push({
        key: item.id || item.pageKey,
        groupLabel: gLabel,
        pageTitle: pageLabel(item),
        items,
      })
    }
    const unassigned = pool.filter((p) => !matchedIds.has(p.entityId))
    return { sections, unassigned }
  }

  if (!open || !snapshot) return null

  const reqSectionData = buildSections((k) => Boolean(REQ_PAGES[k]), itemsByType.requirements)
  const tcSectionData = buildSections((k) => Boolean(TEST_PAGES[k]), itemsByType.testcases)

  const tabs = [
    {
      key: 'requirements',
      label: t('snapshot.tabRequirements'),
      count: itemsByType.requirements.length,
    },
    { key: 'testcases', label: t('snapshot.tabTestCases'), count: itemsByType.testcases.length },
    { key: 'glossary', label: t('snapshot.tabGlossary'), count: itemsByType.glossary.length },
    { key: 'links', label: t('snapshot.tabLinks'), count: itemsByType.links.length },
  ]

  // Öznitelik hücresi: değer snapshot anındaki 'attributes' torbasından okunur
  // (canlı veriden değil) — bkz. EntityTable.jsx ile aynı sözleşme.
  const attrCell = (def, d) => {
    const value = (d.attributes || {})[def.key]
    return (
      <td key={def.id} className="px-4 py-3 text-sm text-center">
        {value != null && value !== '' ? <AttrBadge def={def} value={value} /> : dash}
      </td>
    )
  }

  const renderItem = (item) => {
    const d = item.data
    if (item.entityType === 'requirement') {
      return (
        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">
            {d.text_id}
          </td>
          <td className="px-4 py-3 text-sm text-slate-900 dark:text-white max-w-sm">
            {(() => {
              const { text: displayTitle, isFallback } = getDisplayLabel(d)
              return isFallback ? (
                <div className="font-normal">{displayTitle}</div>
              ) : (
                <div className="truncate">{displayTitle}</div>
              )
            })()}
          </td>
          <td className="px-4 py-3 text-sm text-center">
            <Pill>{d.type}</Pill>
          </td>
          <td className="px-4 py-3 text-sm text-center">
            <Pill>{d.status}</Pill>
          </td>
          {reqAttrDefs.map((def) => attrCell(def, d))}
        </tr>
      )
    }
    if (item.entityType === 'testcase') {
      return (
        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">
            {d.text_id}
          </td>
          <td className="px-4 py-3 text-sm text-slate-900 dark:text-white max-w-sm">
            {(() => {
              const { text: displayTitle, isFallback } = getDisplayLabel(d)
              return isFallback ? (
                <div className="font-normal">{displayTitle}</div>
              ) : (
                <div className="truncate">{displayTitle}</div>
              )
            })()}
          </td>
          <td className="px-4 py-3 text-sm text-center">
            <Pill>{d.type}</Pill>
          </td>
          <td className="px-4 py-3 text-sm text-center">
            <Pill>{d.status}</Pill>
          </td>
          {tcAttrDefs.map((def) => attrCell(def, d))}
        </tr>
      )
    }
    if (item.entityType === 'glossary') {
      return (
        <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">
            {d.text_id}
          </td>
          <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{d.term}</td>
          <td className="px-4 py-3 text-sm max-w-xs truncate" colSpan={4}>
            {d.definition}
          </td>
        </tr>
      )
    }
    // link
    return (
      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">
          {d.text_id || d.id?.slice(0, 8)}
        </td>
        <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{d.type}</td>
        <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" colSpan={3}>
          {d.fromTextId || d.fromId?.slice(0, 8)} → {d.toTextId || d.toId?.slice(0, 8)}
        </td>
      </tr>
    )
  }

  const thCell = (key, label, extra) => (
    <th
      key={key}
      className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
      {...extra}
    >
      {label}
    </th>
  )

  const reqHeadCells = (
    <>
      {thCell('text_id', t('snapshot.thTextId'))}
      {thCell('title', t('snapshot.thTitle'))}
      {thCell('type', t('snapshot.thType'))}
      {thCell('status', t('snapshot.thStatus'))}
      {reqAttrDefs.map((def) => thCell(def.id, def.label))}
    </>
  )
  const tcHeadCells = (
    <>
      {thCell('text_id', t('snapshot.thTextId'))}
      {thCell('title', t('snapshot.thTitle'))}
      {thCell('type', t('snapshot.thType'))}
      {thCell('status', t('snapshot.thStatus'))}
      {tcAttrDefs.map((def) => thCell(def.id, def.label))}
    </>
  )
  const glossaryHeadCells = (
    <>
      {thCell('text_id', t('snapshot.thTextId'))}
      {thCell('term', t('snapshot.thTerm'))}
      {thCell('definition', t('snapshot.thDefinition'), { colSpan: 4 })}
    </>
  )
  const linksHeadCells = (
    <>
      {thCell('link_id', t('snapshot.thLinkId'))}
      {thCell('link_type', t('snapshot.thLinkType'))}
      {thCell('link_detail', t('snapshot.thLinkDetail'), { colSpan: 3 })}
    </>
  )

  // Tek bir bölümün (sayfanın) tablosu — hem düz sekmelerde (Sözlük/Bağlar)
  // hem de menü sayfasına göre bölünmüş Requirements/Test Cases satırlarında
  // aynı bileşen kullanılır.
  const DataTable = ({ headCells, items, emptyVariant = 'section' }) => {
    if (items.length === 0) {
      if (emptyVariant === 'full') {
        return (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
            <IconHistory size={30} />
            <p>{t('snapshot.noItems', { type: activeTab })}</p>
          </div>
        )
      }
      return (
        <div className="flex items-center justify-center py-6 text-sm text-slate-400">
          {t('snapshot.sectionEmpty')}
        </div>
      )
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            <tr>{headCells}</tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {items.map(renderItem)}
          </tbody>
        </table>
      </div>
    )
  }

  // Menü sayfasına göre bölünmüş görünüm: her sayfa kendi başlığı + kendi
  // tablosuyla, sidebar'daki SIRAYLA render edilir. navLayout yakalanmamış
  // eski bir snapshot ise (sections boş) tek düz tabloya geri düşer.
  const SectionedView = ({ sectionData, headCells, pool }) => {
    if (sectionData.sections.length === 0) {
      return (
        <div className="card overflow-hidden">
          <DataTable headCells={headCells} items={pool} emptyVariant="full" />
        </div>
      )
    }
    return (
      <div className="space-y-4">
        {sectionData.sections.map((sec) => (
          <div key={sec.key} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
              <div className="text-sm">
                {sec.groupLabel && (
                  <span className="mr-1.5 font-semibold uppercase tracking-wide text-slate-400 text-xs">
                    {sec.groupLabel} ·
                  </span>
                )}
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {sec.pageTitle}
                </span>
              </div>
              <Pill>{sec.items.length}</Pill>
            </div>
            <DataTable headCells={headCells} items={sec.items} />
          </div>
        ))}
        {sectionData.unassigned.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {t('snapshot.notOnAnyPage')}
              </span>
              <Pill>{sectionData.unassigned.length}</Pill>
            </div>
            <DataTable headCells={headCells} items={sectionData.unassigned} />
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('snapshot.modalTitle', { name: snapshot.name })}
      subtitle={t('snapshot.modalSub', { date: formatDateTime(snapshot.createdAt) })}
      maxWidth="max-w-6xl"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            {t('common.close')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Sekme çubuğu */}
        <div className="border-b border-slate-200 dark:border-slate-700">
          <nav className="flex gap-1 -mb-px" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ' +
                  (activeTab === tab.key
                    ? 'text-brand-700 border-brand-600 bg-brand-50 dark:text-brand-300 dark:border-brand-500 dark:bg-brand-900/30'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50')
                }
              >
                {tab.label} <Pill>{tab.count}</Pill>
              </button>
            ))}
          </nav>
        </div>

        {/* Requirements / Test Cases: menü sayfasına göre bölünmüş görünüm —
            kullanıcı talebi: "tek büyük havuz değil, o an hangi sayfada
            neyin olduğunu da görebilmeliyim". */}
        {activeTab === 'requirements' && (
          <SectionedView
            sectionData={reqSectionData}
            headCells={reqHeadCells}
            pool={itemsByType.requirements}
          />
        )}
        {activeTab === 'testcases' && (
          <SectionedView
            sectionData={tcSectionData}
            headCells={tcHeadCells}
            pool={itemsByType.testcases}
          />
        )}
        {activeTab === 'glossary' && (
          <div className="card overflow-hidden">
            <DataTable
              headCells={glossaryHeadCells}
              items={itemsByType.glossary}
              emptyVariant="full"
            />
          </div>
        )}
        {activeTab === 'links' && (
          <div className="card overflow-hidden">
            <DataTable headCells={linksHeadCells} items={itemsByType.links} emptyVariant="full" />
          </div>
        )}

        {/* Özet */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>{t('snapshot.totalItems', { count: (snapshot.items || []).length })}</span>
          <span className="font-mono text-slate-400">
            {t('snapshot.createdAt', { date: formatDateTime(snapshot.createdAt) })}
          </span>
        </div>
      </div>
    </Modal>
  )
}

const EMPTY_FORM = { name: '', label: '', description: '', isBaseline: false, reason: '' }

export default function SnapshotsPage() {
  const {
    snapshots,
    loading,
    createSnapshot,
    deleteSnapshot,
    updateSnapshot,
    restoreSnapshot,
    projectId,
  } = useApp()
  const { t } = useLang()
  const { isPM, can } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState(null)
  // Silme oncesi zorunlu gerekce (izlenebilirlik) — bkz. ReasonModal.
  const [deleteTarget, setDeleteTarget] = useState(null)
  // Issue #128 ---------------------------------------------------------------
  const [editTarget, setEditTarget] = useState(null) // ust veri duzenleme
  const [restorePlan, setRestorePlan] = useState(null) // { snap, plan } onizleme
  const [restoreReasonFor, setRestoreReasonFor] = useState(null)
  const [restoreResult, setRestoreResult] = useState(null)
  const [diffOpen, setDiffOpen] = useState(false)

  const canManageSnapshots = isPM || can('manage_snapshots')
  // Geri yukleme TUM proje verisini degistirir: backend yalnizca PM'e izin
  // verir (requirePM), arayuz de ayni cizgiyi tutar.
  const canRestore = isPM

  const closeForm = () => {
    setModalOpen(false)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setBusy(true)
    setFormError('')
    try {
      await createSnapshot({
        name: form.name.trim(),
        label: form.label.trim() || undefined,
        description: form.description.trim(),
        isBaseline: form.isBaseline,
        reason: form.reason.trim() || undefined,
      })
      closeForm()
    } catch (e) {
      setFormError(e?.message || t('snapshot.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = (snap) => setDeleteTarget(snap)
  const confirmDelete = async (reason) => {
    // Baseline dondurulmustur: silme ancak ozel izinle (force) gecer.
    await deleteSnapshot(deleteTarget.id, reason, Boolean(deleteTarget.isBaseline))
    setDeleteTarget(null)
  }

  // Geri yukleme: ONCE onizleme (hicbir sey yazmaz), sonra gerekce, sonra
  // uygulama. Kullanici kac kaydin degisecegini gormeden onay veremez.
  const openRestore = async (snap) => {
    setBusy(true)
    try {
      const plan = await getRestorePreview(projectId, snap.id)
      setRestorePlan({ snap, plan })
    } catch (e) {
      alert(e?.message || t('snapshot.previewFailed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async (reason) => {
    const snap = restoreReasonFor
    const result = await restoreSnapshot(snap.id, reason)
    setRestoreReasonFor(null)
    setRestorePlan(null)
    setRestoreResult({ snap, result })
  }

  const handleView = async (snap) => {
    try {
      const detail = await getSnapshot(projectId, snap.id)
      setSelectedSnapshot(detail)
    } catch (e) {
      alert(e?.message || 'Snapshot detayı yüklenemedi')
    }
  }

  return (
    <div className="space-y-6">
      {/* Başlık + Yeni snapshot butonu */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('page.snapshots.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('page.snapshots.sub')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Fark raporu okuma yetkisi gerektirmez: denetim gorunumudur. */}
          <button
            onClick={() => setDiffOpen(true)}
            className="btn-secondary"
            disabled={snapshots.length === 0}
            data-testid="snapshot-compare"
          >
            <IconMatrix size={18} className="mr-2" /> {t('snapshot.compare')}
          </button>
          {canManageSnapshots && (
            <button
              onClick={() => setModalOpen(true)}
              className="btn-primary"
              disabled={loading}
              data-testid="snapshot-new"
            >
              <IconPlus size={18} className="mr-2" /> {t('snapshot.new')}
            </button>
          )}
        </div>
      </div>

      {/* Snapshot listesi */}
      <div className="card overflow-hidden">
        {snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <IconHistory size={40} />
            <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-300">
              {t('snapshot.emptyTitle')}
            </h3>
            <p className="text-sm max-w-md text-center">{t('snapshot.emptyDesc')}</p>
            {canManageSnapshots && (
              <button onClick={() => setModalOpen(true)} className="btn-primary mt-4">
                <IconPlus size={18} className="mr-2" /> {t('snapshot.new')}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('snapshot.thName')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('snapshot.thLabel')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('snapshot.thCreatedBy')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('snapshot.thCreatedAt')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('snapshot.thItems')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right pr-6">
                    {t('snapshot.thActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {snapshots.map((snap) => (
                  <tr key={snap.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {snap.name}
                        </span>
                        {/* Baseline ROZETI: resmi kayitlari siradan ara
                            kayitlardan bir bakista ayirir. */}
                        {snap.isBaseline && (
                          <span
                            data-testid={`snapshot-baseline-${snap.id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                          >
                            <IconLock size={11} /> {t('snapshot.baselineBadge')}
                          </span>
                        )}
                        {snap.kind === 'safety' && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {t('snapshot.safetyBadge')}
                          </span>
                        )}
                      </div>
                      {snap.description && (
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {snap.description}
                        </div>
                      )}
                      {snap.reason && (
                        <div className="mt-0.5 text-xs italic text-slate-400">
                          {t('snapshot.reasonPrefix')}: {snap.reason}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {t('snapshot.snapshotId', { id: snap.id.slice(0, 8) })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {snap.label ? (
                        <span className="font-mono font-semibold text-brand-700 dark:text-brand-300">
                          {snap.label}
                        </span>
                      ) : (
                        dash
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                      {snap.createdBy || t('common.unknown')}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(snap.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                      <Pill>{snap.items?.length || 0}</Pill>
                    </td>
                    <td className="px-6 py-4 text-right pr-6">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleView(snap)}
                          className="btn-ghost btn-sm"
                          title={t('snapshot.view')}
                        >
                          <IconEye size={17} />
                        </button>
                        {canRestore && (
                          <button
                            onClick={() => openRestore(snap)}
                            className="btn-ghost btn-sm"
                            title={t('snapshot.restore')}
                            data-testid={`snapshot-restore-${snap.id}`}
                            disabled={busy}
                          >
                            <IconReset size={17} />
                          </button>
                        )}
                        {canManageSnapshots && (
                          <button
                            onClick={() => setEditTarget(snap)}
                            className="btn-ghost btn-sm"
                            title={t('snapshot.editMeta')}
                            data-testid={`snapshot-edit-${snap.id}`}
                          >
                            <IconEdit size={17} />
                          </button>
                        )}
                        {canManageSnapshots && (
                          <button
                            onClick={() => handleDelete(snap)}
                            className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                            title={
                              snap.isBaseline ? t('snapshot.deleteBaseline') : t('snapshot.delete')
                            }
                            data-testid={`snapshot-delete-${snap.id}`}
                          >
                            <IconTrash size={17} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Yeni snapshot / baseline modali */}
      <Modal
        open={modalOpen}
        onClose={closeForm}
        title={t('snapshot.newTitle')}
        subtitle={t('snapshot.newSub')}
        maxWidth="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button onClick={closeForm} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={busy || !form.name.trim()}
              className="btn-primary"
              data-testid="snapshot-create-submit"
            >
              {t('common.create')}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('snapshot.nameLabel')}
            </label>
            <input
              type="text"
              className="input"
              placeholder={t('snapshot.namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={100}
              data-testid="snapshot-name-input"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('snapshot.nameHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('snapshot.labelLabel')}
            </label>
            <input
              type="text"
              className="input font-mono"
              placeholder={t('snapshot.labelPlaceholder')}
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              maxLength={40}
              data-testid="snapshot-label-input"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('snapshot.labelHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('snapshot.descLabel')}
            </label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={500}
              data-testid="snapshot-desc-input"
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.isBaseline}
              onChange={(e) => setForm((f) => ({ ...f, isBaseline: e.target.checked }))}
              data-testid="snapshot-baseline-checkbox"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t('snapshot.markBaseline')}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {t('snapshot.markBaselineHint')}
              </span>
            </span>
          </label>

          {/* Baseline "resmi" bir isarettir: gerekcesiz alinamaz (backend de
              ayni kurali uygular — burasi yalnizca UX). */}
          {form.isBaseline && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('snapshot.reasonLabel')}
              </label>
              <textarea
                className="input"
                rows={2}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={t('snapshot.reasonPlaceholder')}
                maxLength={500}
                data-testid="snapshot-reason-input"
              />
            </div>
          )}

          {formError && (
            <div
              data-testid="snapshot-form-error"
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            >
              {formError}
            </div>
          )}
        </div>
      </Modal>

      {/* Baseline ust verisi duzenleme (icerik ASLA degismez) */}
      <BaselineMetaModal
        open={Boolean(editTarget)}
        snapshot={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={async (payload) => {
          await updateSnapshot(editTarget.id, payload)
          setEditTarget(null)
        }}
        t={t}
      />

      {/* Geri yukleme onizlemesi — uygulanmadan once ne olacagini gosterir */}
      <RestorePreviewModal
        open={Boolean(restorePlan)}
        data={restorePlan}
        onClose={() => setRestorePlan(null)}
        onConfirm={() => setRestoreReasonFor(restorePlan.snap)}
        t={t}
      />

      {/* Geri yukleme sonucu: guvenlik kopyasinin adi burada duyurulur ki
          kullanici islemi nasil geri alacagini bilsin. */}
      <Modal
        open={Boolean(restoreResult)}
        onClose={() => setRestoreResult(null)}
        title={t('snapshot.restoreDoneTitle')}
        maxWidth="max-w-md"
      >
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p data-testid="restore-done">
            {t('snapshot.restoreDoneBody', { name: restoreResult?.snap?.name || '' })}
          </p>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
            {t('snapshot.restoreSafetyNote', {
              name: restoreResult?.result?.safetySnapshotName || '',
            })}
          </div>
        </div>
      </Modal>

      {/* Fark raporu */}
      <DiffModal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        snapshots={snapshots}
        projectId={projectId}
        t={t}
      />

      {/* Detay modalı (salt okunur) */}
      <SnapshotDetailModal
        open={!!selectedSnapshot}
        snapshot={selectedSnapshot}
        onClose={() => setSelectedSnapshot(null)}
      />
      <ReasonModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        itemLabel={deleteTarget?.name}
        warning={deleteTarget?.isBaseline ? t('snapshot.deleteBaselineWarning') : undefined}
      />
      {/* Geri yukleme GEREKCESI zorunludur; audit log'a bu metin yazilir. */}
      <ReasonModal
        open={Boolean(restoreReasonFor)}
        onClose={() => setRestoreReasonFor(null)}
        onConfirm={confirmRestore}
        title={t('snapshot.restoreReasonTitle')}
        itemLabel={restoreReasonFor?.name}
        warning={t('snapshot.restoreWarning')}
      />
    </div>
  )
}

// ============================================================================
//  Baseline ust verisi (Issue #128)
//  Snapshot bir FOTOGRAFTIR: icerigi (items) asla degismez. Burada yalnizca
//  ad / surum etiketi / aciklama ve "resmi baseline" isareti duzenlenir.
//  Baseline isaretini koymak da kaldirmak da GEREKCE ister.
// ============================================================================
function BaselineMetaModal({ open, snapshot, onClose, onSave, t }) {
  const [form, setForm] = useState({ name: '', label: '', description: '', isBaseline: false })
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedId, setLoadedId] = useState(null)

  // Modal her acilista secili snapshot'in degerleriyle doldurulur.
  if (open && snapshot && loadedId !== snapshot.id) {
    setLoadedId(snapshot.id)
    setForm({
      name: snapshot.name || '',
      label: snapshot.label || '',
      description: snapshot.description || '',
      isBaseline: Boolean(snapshot.isBaseline),
    })
    setReason('')
    setError('')
  }

  if (!open || !snapshot) return null
  const baselineChanged = form.isBaseline !== Boolean(snapshot.isBaseline)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await onSave({
        name: form.name.trim(),
        label: form.label.trim(),
        description: form.description.trim(),
        isBaseline: form.isBaseline,
        reason: reason.trim() || undefined,
      })
      setLoadedId(null)
    } catch (e) {
      setError(e?.message || t('snapshot.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('snapshot.editMetaTitle')}
      subtitle={t('snapshot.editMetaSub')}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            className="btn-primary"
            disabled={busy || !form.name.trim() || (baselineChanged && !reason.trim())}
            data-testid="snapshot-meta-save"
          >
            {t('snapshot.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('snapshot.nameLabel')}
          </label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            maxLength={100}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('snapshot.labelLabel')}
          </label>
          <input
            className="input font-mono"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder={t('snapshot.labelPlaceholder')}
            maxLength={40}
            data-testid="snapshot-meta-label"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('snapshot.descLabel')}
          </label>
          <textarea
            className="input"
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={500}
          />
        </div>
        <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.isBaseline}
            onChange={(e) => setForm((f) => ({ ...f, isBaseline: e.target.checked }))}
            data-testid="snapshot-meta-baseline"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t('snapshot.markBaseline')}
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {t('snapshot.markBaselineHint')}
            </span>
          </span>
        </label>
        {baselineChanged && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('snapshot.reasonLabel')}
            </label>
            <textarea
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('snapshot.reasonPlaceholder')}
              maxLength={500}
              data-testid="snapshot-meta-reason"
            />
          </div>
        )}
        {error && (
          <div
            data-testid="snapshot-meta-error"
            className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ============================================================================
//  Geri yukleme onizlemesi (Issue #128)
//  Uygulamadan ONCE ne olacagini gosterir: kac kayit eklenecek / guncellenecek
//  / silinecek. Onizleme sunucuda da SALT OKUNURDUR (hicbir sey yazmaz).
// ============================================================================
const PREVIEW_ROWS = [
  { key: 'requirement', labelKey: 'diff.entity.requirement' },
  { key: 'testcase', labelKey: 'diff.entity.testcase' },
  { key: 'link', labelKey: 'diff.entity.link' },
  { key: 'glossary', labelKey: 'diff.entity.glossary' },
  { key: 'attributeDef', labelKey: 'diff.entity.attributeDef' },
]

function RestorePreviewModal({ open, data, onClose, onConfirm, t }) {
  if (!open || !data) return null
  const { snap, plan } = data
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('snapshot.restorePreviewTitle')}
      subtitle={snap.label ? `${snap.name} · ${snap.label}` : snap.name}
      maxWidth="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm} className="btn-primary" data-testid="restore-confirm">
            {t('snapshot.restoreContinue')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('snapshot.restoreExplain')}</p>

        <div className="grid grid-cols-3 gap-2 text-center" data-testid="restore-totals">
          <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/30">
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
              +{plan.totals.added}
            </div>
            <div className="text-[11px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
              {t('snapshot.willAdd')}
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/30">
            <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
              ~{plan.totals.updated}
            </div>
            <div className="text-[11px] font-semibold uppercase text-amber-600 dark:text-amber-400">
              {t('snapshot.willUpdate')}
            </div>
          </div>
          <div className="rounded-lg bg-rose-50 px-3 py-2 dark:bg-rose-900/30">
            <div className="text-lg font-bold text-rose-700 dark:text-rose-300">
              -{plan.totals.deleted}
            </div>
            <div className="text-[11px] font-semibold uppercase text-rose-600 dark:text-rose-400">
              {t('snapshot.willDelete')}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-bold">{t('diff.thEntity')}</th>
                <th className="px-3 py-2 font-bold">{t('snapshot.willAdd')}</th>
                <th className="px-3 py-2 font-bold">{t('snapshot.willUpdate')}</th>
                <th className="px-3 py-2 font-bold">{t('snapshot.willDelete')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {PREVIEW_ROWS.map((row) => {
                const cell = plan.summary[row.key] || { added: 0, updated: 0, deleted: 0 }
                return (
                  <tr key={row.key} data-testid={`restore-row-${row.key}`}>
                    <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">
                      {t(row.labelKey)}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{cell.added}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{cell.updated}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{cell.deleted}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {t('snapshot.restoreLockNote')}
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
//  Fark raporu (Issue #128)
//  Iki baseline ya da baseline <-> CANLI durum karsilastirilir. Fark HESABI
//  backend'dedir (src/baselines.js); burasi secim, filtre ve DISA AKTARIM
//  (CSV / PDF) katmanidir — rapor denetim kaydi olarak saklanabilmeli.
// ============================================================================
const LIVE_REF = 'live'

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

function DiffModal({ open, onClose, snapshots, projectId, t }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(LIVE_REF)
  const [diff, setDiff] = useState(null)
  const [status, setStatus] = useState('all')
  const [entityType, setEntityType] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Varsayilan sol taraf: en yeni BASELINE, yoksa en yeni snapshot — "su an
  // neredeyiz, en son resmi noktadan ne kadar uzaklastik" en sik sorulan soru.
  const defaultFrom = useMemo(() => {
    const baseline = snapshots.find((s) => s.isBaseline)
    return (baseline || snapshots[0])?.id || ''
  }, [snapshots])

  if (open && !from && defaultFrom) setFrom(defaultFrom)

  const nameOf = (ref) => {
    if (ref === LIVE_REF) return t('diff.live')
    const snap = snapshots.find((s) => s.id === ref)
    if (!snap) return ref
    return snap.label ? `${snap.name} (${snap.label})` : snap.name
  }

  const run = async () => {
    setBusy(true)
    setError('')
    setDiff(null)
    try {
      setDiff(await getSnapshotDiff(projectId, from, to))
    } catch (e) {
      setError(e?.message || t('diff.failed'))
    } finally {
      setBusy(false)
    }
  }

  const visible = useMemo(
    () => filterEntries(diff?.entries, { status, entityType, query }),
    [diff, status, entityType, query],
  )

  const labelOf = (key) => {
    const entity = DIFF_ENTITY_TYPES.find((e) => e.key === key)
    if (entity) return t(entity.labelKey)
    return t(`diff.status.${key}`)
  }

  const summaryText = diff
    ? t('diff.summary', {
        added: diff.totals.added,
        removed: diff.totals.removed,
        changed: diff.totals.changed,
      })
    : ''

  const headers = [t('diff.thEntity'), t('diff.thRecord'), t('diff.thStatus'), t('diff.thChanges')]
  const baseName = () =>
    `fark-${slugifyLabel(nameOf(from))}-${slugifyLabel(nameOf(to))}-${new Date()
      .toISOString()
      .slice(0, 10)}`

  const exportCsv = () => {
    const csv = diffToCsv(diff, { headers, labelOf, emptyLabel: t('diff.empty') })
    download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${baseName()}.csv`)
  }

  const exportPdf = () => {
    const html = buildDiffPrintHtml({
      documentTitle: t('diff.reportTitle'),
      projectName: '',
      fromLabel: nameOf(from),
      toLabel: nameOf(to),
      summaryText,
      headers,
      diff,
      labelOf,
      emptyLabel: t('diff.empty'),
    })
    const win = window.open('', '_blank')
    if (!win) {
      setError(t('diff.popupBlocked'))
      return
    }
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  if (!open) return null

  const tone = (s) =>
    s === 'added'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : s === 'removed'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('diff.title')}
      subtitle={t('diff.sub')}
      fullScreen
    >
      <div className="space-y-4">
        {/* Taraf secimi */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[12rem]">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">
              {t('diff.from')}
            </span>
            <select
              className="input w-full"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="diff-from"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isBaseline ? '★ ' : ''}
                  {nameOf(s.id)}
                </option>
              ))}
              <option value={LIVE_REF}>{t('diff.live')}</option>
            </select>
          </label>
          <label className="flex-1 min-w-[12rem]">
            <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">
              {t('diff.to')}
            </span>
            <select
              className="input w-full"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="diff-to"
            >
              <option value={LIVE_REF}>{t('diff.live')}</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isBaseline ? '★ ' : ''}
                  {nameOf(s.id)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={run}
            className="btn-primary"
            disabled={busy || !from}
            data-testid="diff-run"
          >
            {busy ? <IconLoader size={16} className="animate-spin" /> : t('diff.run')}
          </button>
        </div>

        {error && (
          <div
            data-testid="diff-error"
            className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        {diff && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="diff-summary"
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {summaryText}
              </span>
              <select
                className="input !py-1 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label={t('diff.thStatus')}
                data-testid="diff-status-filter"
              >
                <option value="all">{t('diff.allStatuses')}</option>
                <option value="added">{t('diff.status.added')}</option>
                <option value="removed">{t('diff.status.removed')}</option>
                <option value="changed">{t('diff.status.changed')}</option>
              </select>
              <select
                className="input !py-1 text-xs"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                aria-label={t('diff.thEntity')}
                data-testid="diff-entity-filter"
              >
                <option value="all">{t('diff.allEntities')}</option>
                {DIFF_ENTITY_TYPES.map((e) => (
                  <option key={e.key} value={e.key}>
                    {t(e.labelKey)}
                  </option>
                ))}
              </select>
              <input
                className="input !py-1 text-xs"
                placeholder={t('diff.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="diff-search"
              />
              <div className="flex-1" />
              <button
                onClick={exportCsv}
                className="btn-secondary btn-sm"
                data-testid="diff-export-csv"
              >
                <IconDownload size={14} /> CSV
              </button>
              <button
                onClick={exportPdf}
                className="btn-secondary btn-sm"
                data-testid="diff-export-pdf"
              >
                <IconDownload size={14} /> PDF
              </button>
            </div>

            <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">{t('diff.thEntity')}</th>
                    <th className="px-3 py-2 text-left font-bold">{t('diff.thRecord')}</th>
                    <th className="px-3 py-2 text-left font-bold">{t('diff.thStatus')}</th>
                    <th className="px-3 py-2 text-left font-bold">{t('diff.thChanges')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visible.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-10 text-center text-slate-500 dark:text-slate-400"
                        data-testid="diff-empty"
                      >
                        {t('diff.noChanges')}
                      </td>
                    </tr>
                  )}
                  {visible.map((entry) => (
                    <tr
                      key={`${entry.entityType}-${entry.entityId}`}
                      data-testid={`diff-row-${entry.entityId}`}
                    >
                      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400">
                        {labelOf(entry.entityType)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-800 dark:text-slate-100">
                        {entry.label}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={
                            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ' +
                            tone(entry.status)
                          }
                        >
                          {t(`diff.status.${entry.status}`)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                        {entry.fields.length === 0 ? (
                          dash
                        ) : (
                          <ul className="space-y-0.5">
                            {entry.fields.map((f) => (
                              <li key={f.field}>
                                <span className="font-semibold">{f.field}</span>:{' '}
                                <span className="text-rose-600 line-through dark:text-rose-400">
                                  {formatDiffValue(f.from, { emptyLabel: t('diff.empty') })}
                                </span>{' '}
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {formatDiffValue(f.to, { emptyLabel: t('diff.empty') })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
