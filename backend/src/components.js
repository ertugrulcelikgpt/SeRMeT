// ============================================================================
//  components.js — ELLE tanimlanan BILESENLER (Issue #138).
//
//  NEDEN BU DOSYA VAR?
//    Issue #129'da bilesen listesi TURETILMISTI: PBS agacinda alt kirilimi
//    olan her gereksinim dugumu bir bilesen sayiliyordu. Yani bilesenin var
//    olabilmesi icin once GEREKSINIM girilmis olmasi gerekiyordu — gercek
//    calisma sirasinin tersi. Ekip once urunun bilesenlerini tanimlar
//    (Su Pompasi Unitesi, AMTB, STC...), gereksinimler bunun USTUNE kurulur.
//
//  BURADAKI MODEL
//    Bilesen KENDI BASINA bir kayittir (Component tablosu):
//      * gereksinim olmadan tek basina var olabilir,
//      * kullanicinin verdigi SIRAYI korur (sortIndex),
//      * kendi altina alt bilesen alabilir (elle urun kirilimi),
//      * kendi Parca No'sunu tasir (#135) — otomatik atama yalnizca ONERI.
//    Gereksinim -> bilesen bagi Requirement.componentId ile kurulur ve
//    ZORUNLU DEGILDIR (iki yon de bagimsiz var olabilir).
//
//  MEVCUT PROJELER BOZULMAZ
//    Bu tablo PBS turetmesinin YERINE GECMEZ; frontend her iki kaynagi da
//    sunar. `importFromPbs` tek seferlik bir ICE AKTARMADIR: bugunku turetilmis
//    agaci bire bir Component satirlarina cevirir (ad, Parca No, kirilim ve
//    gereksinim baglari korunarak), boylece kullanici elle duzenlemeye devam
//    edebilir. Idempotenttir: ayni PBS dugumu iki kez ice aktarilmaz.
//
//  SAFLIK: prisma disaridan verilir (transaction icinden de cagirilabilir).
// ============================================================================
import { MAX_COMPONENT_DEPTH } from './constants.js';
import {
  blockOf,
  childBlockOf,
  configOf,
  isValidPartNo,
  nextPartNoInBlock,
  nextRootBlock,
  usedPartNos,
} from './partNo.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

/** Kardesler arasi siralama: kullanicinin verdigi sira (esitlikte olusum ani). */
const BY_ORDER = [{ sortIndex: 'asc' }, { createdAt: 'asc' }];

async function loadProject(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, partNoFormat: true, partNoBlockStep: true },
  });
  if (!project) throw bad('Proje bulunamadi.', 404);
  return project;
}

function cleanName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw bad('Bilesen adi zorunlu.');
  if (name.length > NAME_MAX) throw bad(`Bilesen adi en fazla ${NAME_MAX} karakter olabilir.`);
  return name;
}

function cleanDescription(value) {
  return String(value ?? '')
    .trim()
    .slice(0, DESCRIPTION_MAX);
}

/** Proje kapsaminda bileseni getirir (IDOR: baska projenin kaydi 404). */
async function loadComponent(prisma, projectId, id) {
  const row = await prisma.component.findUnique({ where: { id: String(id || '') } });
  if (!row || row.projectId !== projectId) throw bad('Bilesen bulunamadi.', 404);
  return row;
}

/**
 * Bileseni + tum alt kirilimini (kendisi dahil) dondurur.
 * Bozuk/dongusel parentId zincirine karsi `seen` korumasi vardir.
 */
export function subtreeOf(rows, rootId) {
  const byParent = new Map();
  for (const row of rows) {
    const key = row.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }
  const out = [];
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const row = rows.find((r) => r.id === id);
    if (row) out.push(row);
    for (const child of byParent.get(id) || []) walk(child.id);
  };
  walk(rootId);
  return out;
}

/** Bir bilesenin derinligi (kok = 0); dongude MAX_COMPONENT_DEPTH'te durur. */
function depthOf(byId, id) {
  let depth = 0;
  let cursor = byId.get(id);
  const seen = new Set();
  while (cursor?.parentId && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    cursor = byId.get(cursor.parentId);
    depth += 1;
    if (depth > MAX_COMPONENT_DEPTH) break;
  }
  return depth;
}

// --- Listeleme --------------------------------------------------------------

/**
 * Projenin TUM bilesenleri, kullanicinin verdigi sirada + bagli gereksinim
 * sayisiyla. Liste duzdur (parentId tasinir); agaci istemci kurar — ayni
 * veri hem liste hem harita gorunumunu besler.
 */
export async function listComponents(prisma, projectId) {
  const rows = await prisma.component.findMany({
    where: { projectId },
    orderBy: BY_ORDER,
    include: { _count: { select: { requirements: true, children: true } } },
  });
  return rows.map(({ _count, ...row }) => ({
    ...row,
    requirementCount: _count.requirements,
    childCount: _count.children,
  }));
}

// --- Parca No (oneri) -------------------------------------------------------

/**
 * Bilesen icin bir sonraki BOS Parca No'yu onerir. Bu bir ONERIDIR: kullanici
 * numarayi bos birakabilir ya da elle baska bir numara verebilir (Issue #138).
 * Numara uzayi gereksinimlerle ORTAKTIR (bkz. partNo.js usedPartNos) — ayni
 * numara iki farkli kayitta duramaz.
 */
export async function suggestPartNo(prisma, projectId, parentId = null) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const [used, parent, roots] = await Promise.all([
    usedPartNos(prisma, projectId),
    parentId ? prisma.component.findUnique({ where: { id: String(parentId) } }) : Promise.resolve(null),
    prisma.component.findMany({
      where: { projectId, parentId: null },
      select: { partNo: true, partNoBlock: true },
    }),
  ]);
  if (parentId && (!parent || parent.projectId !== projectId)) throw bad('Ust bilesen bulunamadi.', 404);
  let block = childBlockOf(parent, cfg.format);
  if (!block) {
    const existing = roots.map((r) => String(r.partNoBlock || '').trim() || blockOf(r.partNo, cfg.format));
    block = nextRootBlock(existing, cfg);
  }
  return { partNo: nextPartNoInBlock(block, used, cfg.format), format: cfg.format, block };
}

/**
 * Elle verilen Parca No'yu dogrular. Bos deger GECERLIDIR (numarasiz bilesen
 * da bir bilesendir); doluysa bicime uymali ve projede BENZERSIZ olmalidir.
 * `selfId` verilirse kaydin kendi numarasi cakisma sayilmaz.
 */
async function validatePartNo(prisma, projectId, value, selfId = null) {
  const partNo = String(value ?? '').trim();
  if (!partNo) return null;
  const project = await loadProject(prisma, projectId);
  const { format } = configOf(project);
  if (!isValidPartNo(partNo, format)) {
    throw bad(`Parca No bicime uymuyor (beklenen: ${format}).`);
  }
  const [clashComponent, clashRequirement] = await Promise.all([
    prisma.component.findFirst({ where: { projectId, partNo }, select: { id: true, name: true } }),
    prisma.requirement.findFirst({ where: { projectId, partNo }, select: { id: true, text_id: true } }),
  ]);
  if (clashComponent && clashComponent.id !== selfId) {
    throw bad(`Parca No zaten kullanimda: ${partNo} ("${clashComponent.name}").`, 409);
  }
  if (clashRequirement) {
    throw bad(`Parca No zaten kullanimda: ${partNo} (${clashRequirement.text_id}).`, 409);
  }
  return partNo;
}

// --- Olusturma / guncelleme / silme ----------------------------------------

/** Kardeslerin sonuna eklenecek sira degeri. */
async function nextSortIndex(prisma, projectId, parentId) {
  const last = await prisma.component.findFirst({
    where: { projectId, parentId: parentId ?? null },
    orderBy: { sortIndex: 'desc' },
    select: { sortIndex: true },
  });
  return (last?.sortIndex ?? -1) + 1;
}

/**
 * Yeni bilesen. GEREKSINIM GEREKTIRMEZ — bos bir projede ilk kayit bu olabilir.
 * Parca No verilmezse: `autoPartNo` true ise onerilen numara yazilir, degilse
 * numarasiz kalir (kullanici sonra verebilir).
 */
export async function createComponent(prisma, projectId, input = {}) {
  const name = cleanName(input.name);
  const parentId = input.parentId ? String(input.parentId) : null;
  if (parentId) {
    const parent = await loadComponent(prisma, projectId, parentId);
    const rows = await prisma.component.findMany({ where: { projectId }, select: { id: true, parentId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (depthOf(byId, parent.id) + 1 >= MAX_COMPONENT_DEPTH) {
      throw bad(`Bilesen kirilimi en fazla ${MAX_COMPONENT_DEPTH} seviye olabilir.`);
    }
  }
  let partNo = await validatePartNo(prisma, projectId, input.partNo);
  if (!partNo && input.autoPartNo) {
    try {
      partNo = (await suggestPartNo(prisma, projectId, parentId)).partNo;
    } catch {
      partNo = null; // numara uretilemedi: bilesen yine de olusur (oneri, zorunluluk degil)
    }
  }
  return prisma.component.create({
    data: {
      projectId,
      parentId,
      name,
      description: cleanDescription(input.description),
      partNo,
      partNoBlock: String(input.partNoBlock ?? '').trim() || null,
      sortIndex: await nextSortIndex(prisma, projectId, parentId),
    },
  });
}

/**
 * Ad / aciklama / Parca No / blok / ust bilesen guncellemesi.
 * Ust degisiminde DONGU ve derinlik kontrolu yapilir: bir bilesen kendi alt
 * kiriliminin altina tasinamaz.
 */
export async function updateComponent(prisma, projectId, id, input = {}) {
  const before = await loadComponent(prisma, projectId, id);
  const data = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.description !== undefined) data.description = cleanDescription(input.description);
  if (input.partNo !== undefined) data.partNo = await validatePartNo(prisma, projectId, input.partNo, before.id);
  if (input.partNoBlock !== undefined) data.partNoBlock = String(input.partNoBlock ?? '').trim() || null;
  if (input.parentId !== undefined) {
    const parentId = input.parentId ? String(input.parentId) : null;
    if (parentId === before.id) throw bad('Bilesen kendi altina tasinamaz.');
    if (parentId) {
      await loadComponent(prisma, projectId, parentId);
      const rows = await prisma.component.findMany({ where: { projectId }, select: { id: true, parentId: true } });
      if (subtreeOf(rows, before.id).some((r) => r.id === parentId)) {
        throw bad('Bilesen kendi alt kiriliminin altina tasinamaz.');
      }
      const byId = new Map(rows.map((r) => [r.id, r]));
      if (depthOf(byId, parentId) + 1 >= MAX_COMPONENT_DEPTH) {
        throw bad(`Bilesen kirilimi en fazla ${MAX_COMPONENT_DEPTH} seviye olabilir.`);
      }
    }
    if (parentId !== before.parentId) {
      data.parentId = parentId;
      data.sortIndex = await nextSortIndex(prisma, projectId, parentId);
    }
  }
  if (Object.keys(data).length === 0) return before;
  return prisma.component.update({ where: { id: before.id }, data });
}

/**
 * Silmeden ONCE etkiyi ozetler: alt bilesenler + bagli gereksinimler.
 * UI bunu uyari olarak gosterir; `force` verilmeden silme reddedilir.
 */
export async function deleteImpact(prisma, projectId, id) {
  const target = await loadComponent(prisma, projectId, id);
  const rows = await prisma.component.findMany({
    where: { projectId },
    select: { id: true, parentId: true, name: true },
  });
  const subtree = subtreeOf(rows, target.id);
  const ids = subtree.map((r) => r.id);
  const requirementCount = await prisma.requirement.count({ where: { projectId, componentId: { in: ids } } });
  return {
    component: { id: target.id, name: target.name },
    childCount: subtree.length - 1,
    requirementCount,
    ids,
  };
}

/**
 * Bileseni siler. Alt kirilimi ya da bagli gereksinimi varsa `force`
 * ISTENIR — kullanici uyariyi gormeden veri kaybi olmaz.
 * Bagli gereksinimler SILINMEZ: yalnizca baglari bosa duser (SetNull).
 */
export async function deleteComponent(prisma, projectId, id, { force = false } = {}) {
  const impact = await deleteImpact(prisma, projectId, id);
  if (!force && (impact.childCount > 0 || impact.requirementCount > 0)) {
    throw Object.assign(
      new Error(
        `Bu bilesenin ${impact.childCount} alt bileseni ve ${impact.requirementCount} bagli gereksinimi var. ` +
          'Silmek icin onay gerekir.',
      ),
      { status: 409, impact },
    );
  }
  // Alt kirilim FK cascade ile silinir; gereksinim baglari SetNull ile
  // kendiliginden bosa duser (gereksinimin kendisine dokunulmaz).
  await prisma.component.delete({ where: { id: impact.component.id } });
  return impact;
}

/**
 * Kardesler arasinda YENIDEN SIRALAMA. `orderedIds` kullanicinin gordugu
 * sirayi tasir; listede olmayan kardesler sona eklenir (sira kaybolmaz).
 */
export async function reorderComponents(prisma, projectId, parentId, orderedIds) {
  const ids = Array.isArray(orderedIds) ? orderedIds.map(String) : [];
  const siblings = await prisma.component.findMany({
    where: { projectId, parentId: parentId ? String(parentId) : null },
    orderBy: BY_ORDER,
    select: { id: true },
  });
  const known = new Set(siblings.map((s) => s.id));
  for (const id of ids) if (!known.has(id)) throw bad('Siralama listesi bu kirilime ait olmayan bir bilesen iceriyor.');
  const finalOrder = [...ids, ...siblings.map((s) => s.id).filter((id) => !ids.includes(id))];
  await prisma.$transaction(
    finalOrder.map((id, i) => prisma.component.update({ where: { id }, data: { sortIndex: i } })),
  );
  return { ordered: finalOrder.length };
}

// --- Gereksinim <-> bilesen bagi -------------------------------------------

/**
 * Gereksinimleri bir bilesene baglar (componentId = id) ya da bagi kaldirir
 * (componentId = null). Bag kurmak gereksinimin ICERIGINI degistirmez; bu
 * yuzden onay/kilit (locked) kontrolu YOKTUR — urun kirilimi, gereksinim
 * metninden bagimsiz bir siniflandirmadir.
 */
export async function setRequirementComponent(prisma, projectId, requirementIds, componentId) {
  const ids = [...new Set((Array.isArray(requirementIds) ? requirementIds : []).map(String))].filter(Boolean);
  if (ids.length === 0) throw bad('Gereksinim secilmedi.');
  if (componentId) await loadComponent(prisma, projectId, componentId);
  const found = await prisma.requirement.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) throw bad('Bazi gereksinimler bu projede bulunamadi.', 404);
  const { count } = await prisma.requirement.updateMany({
    where: { projectId, id: { in: ids } },
    data: { componentId: componentId ? String(componentId) : null },
  });
  return { count };
}

// --- Tek seferlik ICE AKTARMA (PBS -> Component) ---------------------------

/**
 * Bugunku TURETILMIS bilesenleri kalici kayitlara cevirir (Issue #138 gecisi).
 *
 * Kural, #129'daki turetmeyle BIREBIR aynidir: alt kirilimi olan her PBS
 * dugumu bir bilesendir. Her dugum icin:
 *   ad      = baslik (yoksa text_id)
 *   partNo  = dugumun Parca No'su (varsa; cakisirsa bos birakilir)
 *   ust     = en yakin bilesen olan ATA (arada bilesen olmayan dugumler atlanir)
 * Gereksinimler, kendisini iceren EN YAKIN bilesene baglanir (kendisi bilesen
 * ise kendisine) — boylece ice aktarmadan sonra liste bugunkuyle ayni okunur.
 *
 * IDEMPOTENT: ayni ada + ayni ust sahip bir bilesen zaten varsa yenisi
 * uretilmez; var olan kullanilir. Boylece ikinci calistirma kopya uretmez.
 *
 * @returns {Promise<{created:number, linked:number, skipped:number}>}
 */
export async function importFromPbs(prisma, projectId) {
  const requirements = await prisma.requirement.findMany({
    where: { projectId },
    select: { id: true, parentId: true, title: true, text_id: true, partNo: true, partNoBlock: true },
  });
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const childrenOf = new Map();
  for (const r of requirements) {
    const key = r.parentId && byId.has(r.parentId) && r.parentId !== r.id ? r.parentId : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(r);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => String(a.text_id || '').localeCompare(String(b.text_id || ''), undefined, { numeric: true }));
  }

  const existing = await prisma.component.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true, partNo: true },
  });
  const keyOf = (parentId, name) => `${parentId || ''}::${name.toLowerCase()}`;
  const existingByKey = new Map(existing.map((c) => [keyOf(c.parentId, c.name), c.id]));
  const takenPartNos = new Set(existing.map((c) => c.partNo).filter(Boolean));

  let created = 0;
  let skipped = 0;
  const componentIdOf = new Map(); // requirement id -> component id

  // Yukaridan asagi: ust bilesen olusmadan cocugu olusturulamaz.
  const walk = async (requirementId, parentComponentId) => {
    for (const node of childrenOf.get(requirementId) || []) {
      const kids = childrenOf.get(node.id) || [];
      let componentId = parentComponentId;
      if (kids.length > 0) {
        const name = String(node.title || '').trim() || node.text_id || 'Bilesen';
        const key = keyOf(parentComponentId, name);
        if (existingByKey.has(key)) {
          componentId = existingByKey.get(key);
          skipped += 1;
        } else {
          const partNo = node.partNo && !takenPartNos.has(node.partNo) ? node.partNo : null;
          const row = await prisma.component.create({
            data: {
              projectId,
              parentId: parentComponentId,
              name,
              partNo,
              partNoBlock: node.partNoBlock || null,
              sortIndex: await nextSortIndex(prisma, projectId, parentComponentId),
            },
          });
          if (partNo) takenPartNos.add(partNo);
          existingByKey.set(key, row.id);
          componentId = row.id;
          created += 1;
        }
      }
      if (componentId) componentIdOf.set(node.id, componentId);
      await walk(node.id, componentId);
    }
  };
  await walk(null, null);

  // Gereksinim baglari: yalnizca HENUZ BAGSIZ olanlar yazilir (kullanicinin
  // elle kurdugu bag ice aktarmayla EZILMEZ).
  let linked = 0;
  const groups = new Map();
  for (const [requirementId, componentId] of componentIdOf) {
    if (!groups.has(componentId)) groups.set(componentId, []);
    groups.get(componentId).push(requirementId);
  }
  for (const [componentId, ids] of groups) {
    const { count } = await prisma.requirement.updateMany({
      where: { projectId, componentId: null, id: { in: ids } },
      data: { componentId },
    });
    linked += count;
  }

  return { created, linked, skipped };
}
