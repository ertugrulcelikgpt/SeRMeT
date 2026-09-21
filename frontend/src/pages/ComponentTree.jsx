// ============================================================================
//  ComponentTree.jsx — Bilesen Agaci (Issue #135).
//
//  "Baglanti Agaci" (PbsTree) GEREKSINIMLERI gosterir; bu sayfa ayni urun
//  kirilimini URUN olarak gosterir: montaj / alt montaj / donanim / gomulu
//  yazilim. Her dugumun kendi kimligi vardir — ad, PARCA NO, tip, revizyon,
//  ust parca — ve ayirt edici alan Parca No'dur: AMTB/GY1 (320.00.001) ile
//  STC/GY1 (340.00.001) AYNI ADA sahip ama FARKLI parcalardir.
//
//  Parca No yeni parcada otomatik atanir (ustun blogundan siradaki bos
//  numara) ve elle degistirilebilir; cakisma sunucuda 409 ile reddedilir —
//  bu ekran o uyariyi oldugu gibi gosterir, kendi basina "duzeltmez".
//
//  Tutarlilik paneli (rozet + liste) ayni veriden beslenir: cakisan/bicimsiz/
//  blok disi numaralar, ayni adli kardesler, ustsuz-dongu-derinlik ihlalleri
//  ve gereksinimi olmayan bilesenler.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import Modal from '../components/common/Modal.jsx'
import ReasonModal from '../components/common/ReasonModal.jsx'
import {
  IconAlert,
  IconCheckCircle,
  IconChevron,
  IconEdit,
  IconLoader,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../components/common/Icons.jsx'
import { COMPONENT_TYPES, DEFAULT_PART_NO_FORMAT } from '../utils/constants.js'
import {
  allNodeIds,
  buildComponentTree,
  filterComponentTree,
  flattenComponentTree,
  issuesByComponent,
  severityOf,
} from '../utils/partTree.js'
import {
  checkComponentTree,
  createComponent,
  deleteComponent,
  listComponents,
  setPartNoConfig,
  updateComponent,
} from '../services/dataService.js'

const EMPTY_FORM = {
  name: '',
  type: 'assembly',
  revision: 'A',
  partNo: '',
  partNoBlock: '',
  description: '',
  parentId: null,
}

export default function ComponentTree() {
  const { projectId } = useApp()
  const { can, isPM } = useAuth()
  const { t } = useLang()

  const [rows, setRows] = useState([])
  const [check, setCheck] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null => yeni kayit
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  // Bilesen agacini duzenlemek, oznitelik/alan yonetimiyle AYNI izne baglidir
  // (proje yapisini kuran islem). Parca No BICIMI ayrica yalnizca PM'dir
  // (backend requirePM) — proje genelinde tum numaralari etkiler.
  const canEdit = can('manage_fields')

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError('')
    try {
      const [list, report] = await Promise.all([
        listComponents(projectId),
        checkComponentTree(projectId),
      ])
      setRows(list.items || [])
      setCheck(report)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const tree = useMemo(() => buildComponentTree(rows), [rows])
  const visibleTree = useMemo(() => filterComponentTree(tree, query), [tree, query])
  // Arama sirasinda dallar ZORLA acilir: aksi halde eslesen dugum kapali bir
  // ustun altinda kalir ve arama "sonuc yok" gibi gorunurdu.
  const effectiveExpanded = useMemo(
    () => (query.trim() ? new Set(allNodeIds(visibleTree)) : expanded),
    [query, visibleTree, expanded],
  )
  const flat = useMemo(
    () => flattenComponentTree(visibleTree, effectiveExpanded),
    [visibleTree, effectiveExpanded],
  )
  const issueMap = useMemo(() => issuesByComponent(check?.issues), [check])
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const format = check?.format || DEFAULT_PART_NO_FORMAT

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expandAll = () => setExpanded(new Set(allNodeIds(tree)))
  const collapseAll = () => setExpanded(new Set())

  const openCreate = (parentId = null) => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, parentId })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (row) => {
    setEditing(row)
    setForm({
      name: row.name || '',
      type: row.type || 'assembly',
      revision: row.revision || 'A',
      partNo: row.partNo || '',
      partNoBlock: row.partNoBlock || '',
      description: row.description || '',
      parentId: row.parentId || null,
    })
    setFormError('')
    setFormOpen(true)
  }

  const submitForm = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      if (editing) {
        await updateComponent(projectId, editing.id, {
          name: form.name,
          type: form.type,
          revision: form.revision,
          // Parca No degismediyse sunucu zaten dokunmaz; cakisma durumunda
          // 409 doner ve HICBIR alan kaydedilmez (kismi kayit yok).
          partNo: form.partNo,
          partNoBlock: form.partNoBlock,
          description: form.description,
        })
      } else {
        await createComponent(projectId, {
          name: form.name,
          type: form.type,
          revision: form.revision,
          // Bos birakilirsa numara ustun blogundan OTOMATIK atanir.
          partNo: form.partNo.trim() || undefined,
          partNoBlock: form.partNoBlock,
          description: form.description,
          parentId: form.parentId,
        })
        if (form.parentId) setExpanded((prev) => new Set(prev).add(form.parentId))
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (reason) => {
    await deleteComponent(projectId, deleteTarget.id, reason)
    setDeleteTarget(null)
    await load()
  }

  if (!projectId) return null

  const issueCount = check?.total ?? 0
  const errorCount = check?.errorCount ?? 0

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('page.componentTree.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('page.componentTree.sub')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={expandAll}>
            {t('comptree.expandAll')}
          </button>
          <button className="btn-ghost" onClick={collapseAll}>
            {t('comptree.collapseAll')}
          </button>
          {isPM && (
            <button className="btn-ghost" onClick={() => setConfigOpen(true)}>
              {t('comptree.partNoConfig')}
            </button>
          )}
          {canEdit && (
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => openCreate(null)}
            >
              <IconPlus size={16} /> {t('comptree.add')}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className="input w-full pl-9"
            placeholder={t('comptree.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={'btn-ghost flex items-center gap-2 ' + (errorCount > 0 ? 'text-rose-600' : '')}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {errorCount > 0 ? <IconAlert size={16} /> : <IconCheckCircle size={16} />}
          {issueCount > 0 ? t('comptree.issueCount', { n: issueCount }) : t('comptree.noIssues')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {panelOpen && <IssuePanel check={check} rowsById={rowsById} t={t} />}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 w-40">{t('comptree.col.partNo')}</th>
              <th className="px-4 py-3">{t('comptree.col.name')}</th>
              <th className="px-4 py-3 w-36">{t('comptree.col.type')}</th>
              <th className="px-4 py-3 w-24">{t('comptree.col.revision')}</th>
              <th className="px-4 py-3 w-28">{t('comptree.col.requirements')}</th>
              <th className="px-4 py-3 w-32 text-right">{t('comptree.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <IconLoader size={20} className="mx-auto animate-spin" />
                </td>
              </tr>
            )}
            {!loading && flat.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {query.trim() ? t('comptree.noMatch') : t('comptree.empty')}
                </td>
              </tr>
            )}
            {!loading &&
              flat.map(({ node, depth, hasChildren }) => {
                const issues = issueMap.get(node.id) || []
                const severity = severityOf(issues)
                return (
                  <tr key={node.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                      {node.partNo || <span className="text-rose-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div
                        className="flex items-center gap-1.5"
                        style={{ paddingLeft: `${depth * 18}px` }}
                      >
                        {hasChildren ? (
                          <button
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                            onClick={() => toggle(node.id)}
                            aria-label={t('comptree.toggle')}
                          >
                            <IconChevron
                              size={14}
                              className={
                                effectiveExpanded.has(node.id)
                                  ? 'rotate-90 transition'
                                  : 'transition'
                              }
                            />
                          </button>
                        ) : (
                          <span className="w-[22px]" />
                        )}
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {node.name}
                        </span>
                        {severity && (
                          <span
                            title={issues.map((i) => i.message).join('\n')}
                            className={
                              'ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ' +
                              (severity === 'error'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : severity === 'warn'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400')
                            }
                          >
                            {issues.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {t(`comp.type.${node.type}`)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {node.revision}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                      {node.requirementCount ?? 0}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <>
                            <button
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title={t('comptree.addChild')}
                              onClick={() => openCreate(node.id)}
                            >
                              <IconPlus size={15} />
                            </button>
                            <button
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title={t('comptree.edit')}
                              onClick={() => openEdit(node)}
                            >
                              <IconEdit size={15} />
                            </button>
                            <button
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 text-rose-600"
                              title={t('comptree.delete')}
                              onClick={() => setDeleteTarget(node)}
                            >
                              <IconTrash size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      <ComponentFormModal
        open={formOpen}
        editing={editing}
        form={form}
        setForm={setForm}
        onSubmit={submitForm}
        onClose={() => setFormOpen(false)}
        error={formError}
        saving={saving}
        format={format}
        parentName={form.parentId ? rowsById.get(form.parentId)?.name : null}
        t={t}
      />

      <ReasonModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('comptree.deleteTitle')}
        itemLabel={deleteTarget ? `${deleteTarget.partNo} — ${deleteTarget.name}` : ''}
        warning={t('comptree.deleteWarning')}
      />

      <PartNoConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        projectId={projectId}
        current={check}
        onSaved={load}
        t={t}
      />
    </div>
  )
}

// --- Tutarlilik paneli ------------------------------------------------------
//  Rozetlerin kaynagi ile AYNI rapor; burada raporlanabilir DUZ LISTE olarak
//  sunulur (ihlal turu + dugum + aciklama).
function IssuePanel({ check, rowsById, t }) {
  if (!check) return null
  if (check.total === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        {t('comptree.noIssues')}
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
          <tr>
            <th className="px-4 py-2.5 w-24">{t('comptree.issue.severity')}</th>
            <th className="px-4 py-2.5 w-56">{t('comptree.issue.code')}</th>
            <th className="px-4 py-2.5 w-40">{t('comptree.col.partNo')}</th>
            <th className="px-4 py-2.5">{t('comptree.issue.message')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {check.issues.map((issue, i) => (
            <tr key={`${issue.code}-${issue.componentId}-${i}`}>
              <td className="px-4 py-2">
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                    (issue.severity === 'error'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      : issue.severity === 'warn'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400')
                  }
                >
                  {t(`comptree.severity.${issue.severity}`)}
                </span>
              </td>
              <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                {t(`comptree.code.${issue.code}`)}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                {issue.partNo || '—'}
              </td>
              <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                {issue.message}
                {issue.componentId && rowsById.has(issue.componentId) && (
                  <span className="ml-2 text-xs text-slate-400">({issue.name})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- Bilesen formu ----------------------------------------------------------
function ComponentFormModal({
  open,
  editing,
  form,
  setForm,
  onSubmit,
  onClose,
  error,
  saving,
  format,
  parentName,
  t,
}) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('comptree.editTitle') : t('comptree.addTitle')}
      subtitle={parentName ? t('comptree.underParent', { name: parentName }) : undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">{t('comptree.col.name')}</label>
          <input className="input w-full" value={form.name} onChange={set('name')} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('comptree.col.type')}</label>
            <select className="input w-full" value={form.type} onChange={set('type')}>
              {COMPONENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`comp.type.${type}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('comptree.col.revision')}</label>
            <input className="input w-full" value={form.revision} onChange={set('revision')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('comptree.col.partNo')}</label>
            <input
              className="input w-full font-mono"
              value={form.partNo}
              onChange={set('partNo')}
              placeholder={editing ? format : t('comptree.partNoAuto')}
            />
            <p className="mt-1 text-xs text-slate-400">{t('comptree.partNoHint', { format })}</p>
          </div>
          <div>
            <label className="label">{t('comptree.blockLabel')}</label>
            <input
              className="input w-full font-mono"
              value={form.partNoBlock}
              onChange={set('partNoBlock')}
              placeholder="320"
            />
            <p className="mt-1 text-xs text-slate-400">{t('comptree.blockHint')}</p>
          </div>
        </div>
        <div>
          <label className="label">{t('comptree.descLabel')}</label>
          <textarea
            className="input w-full"
            rows={2}
            value={form.description}
            onChange={set('description')}
          />
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('comptree.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('comptree.saving') : t('comptree.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Parca No yapilandirmasi (proje bazli, yalnizca PM) ---------------------
function PartNoConfigModal({ open, onClose, projectId, current, onSaved, t }) {
  const [format, setFormat] = useState(DEFAULT_PART_NO_FORMAT)
  const [blockStep, setBlockStep] = useState(10)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFormat(current?.format || DEFAULT_PART_NO_FORMAT)
    setError('')
  }, [open, current])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await setPartNoConfig(projectId, format, Number(blockStep))
      onClose()
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('comptree.partNoConfig')} maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">{t('comptree.formatLabel')}</label>
          <input
            className="input w-full font-mono"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">{t('comptree.formatHint')}</p>
        </div>
        <div>
          <label className="label">{t('comptree.blockStepLabel')}</label>
          <input
            className="input w-full"
            type="number"
            min={1}
            value={blockStep}
            onChange={(e) => setBlockStep(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">{t('comptree.blockStepHint')}</p>
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('comptree.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('comptree.saving') : t('comptree.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
