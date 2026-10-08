// ============================================================================
//  partNo.js — Parca No (Part No) bicimi + otomatik numara uretimi (Issue #135).
//
//  NEDEN AYRI BIR URETEC (idGen.js yerine)?
//    text_id bir GEREKSINIM kodudur (<codePrefix>-<TIP>-<NNN>) ve tip bazli
//    tek bir sayacla ilerler. Parca No ise URUN AGACININ DALINA baglidir:
//    AMTB dali 320.*, STC dali 340.* bloklarini kullanir; ayni ada sahip iki
//    bilesen (AMTB/GY1 ve STC/GY1) farkli bloklardan numara aldigi icin
//    birbirinden ayirt edilir. Yani sayac "proje geneli" degil "blok basi"dir.
//
//  ORTAK OLAN: OMUR BOYU BENZERSIZLIK (kara liste). idGen.js ile birebir ayni
//  mantik — silinen bir parcanin numarasi ASLA yeniden kullanilmaz. Canli
//  kayitlara ek olarak AuditLog'daki Parca No izleri de taranir (silme /
//  yeniden numaralandirma kayitlari audit'te kalir). Boylece "son parcayi
//  silip ayni numarayi tekrar uretme" acigi kapanir.
//
//  BICIM (Project.partNoFormat): 'N' = rakam, geri kalan her karakter AYIRAC
//  olarak aynen korunur.  "NNN.NN.NNN" -> 320.00.001
//    * ILK rakam grubu  -> BLOK (dalin onegi, orn. "320")
//    * SON rakam grubu  -> SIRA NUMARASI (blok icinde artan)
//    * ARADAKI gruplar  -> sifirla doldurulur (ileride ara seviye icin yer)
//
//  Bu dosya SAFTIR: prisma parametre olarak alinir (interaktif transaction
//  icinden de cagrilabilsin) ve bicim fonksiyonlari DB'ye hic dokunmaz.
// ============================================================================

export const DEFAULT_PART_NO_FORMAT = 'NNN.NN.NNN';
export const DEFAULT_PART_NO_BLOCK_STEP = 10;

// Parca No degisiklikleri AuditLog'a bu `field` ile yazilir; kara liste
// (usedPartNos) taramasi da ayni degeri kullanir — tek dogruluk kaynagi.
export const PART_NO_AUDIT_FIELD = 'partNo';

// Ayirac olarak kabul edilen karakterler. Harf/rakam ayirac OLAMAZ: 'N'
// disinda bir harf gorulurse bicim reddedilir (yazim hatasini sessizce
// ayirac saymak, format kontrolunu anlamsiz kilardi).
const SEPARATOR_RE = /^[.\-_/]$/;

/**
 * Bicim sablonunu rakam gruplarina + ayiraclara ayirir.
 * "NNN.NN.NNN" -> { groups: [3, 2, 3], separators: ['.', '.'] }
 * @throws {Error} gecersiz bicimde (status=400)
 */
export function parsePartNoFormat(format) {
  const raw = String(format ?? '').trim();
  if (!raw) throw bad('Parca No bicimi bos olamaz.');
  const groups = [];
  const separators = [];
  let run = 0;
  for (const ch of raw) {
    if (ch === 'N') {
      run += 1;
      continue;
    }
    if (!SEPARATOR_RE.test(ch)) {
      throw bad(`Parca No bicimi yalnizca 'N' ve ayirac (. - _ /) icerebilir: "${ch}" gecersiz.`);
    }
    if (run === 0) throw bad('Parca No bicimi ayiracla baslayamaz veya iki ayirac yan yana olamaz.');
    groups.push(run);
    separators.push(ch);
    run = 0;
  }
  if (run === 0) throw bad('Parca No bicimi ayiracla bitemez.');
  groups.push(run);
  if (groups.length < 2) {
    // Blok (ilk grup) ve sira (son grup) AYRI olmali; tek gruplu bicimde
    // "dalin blogu" diye bir sey olmaz, dallanma numaraya yansiyamaz.
    throw bad('Parca No bicimi en az iki rakam grubu icermelidir (orn. NNN.NNN).');
  }
  return { format: raw, groups, separators };
}

/** Bicime uyan, bastan sona sabitlenmis bir RegExp uretir. */
export function partNoRegex(format) {
  const { groups, separators } = parsePartNoFormat(format);
  const body = groups.map((len, i) => `\\d{${len}}` + (i < separators.length ? escapeRe(separators[i]) : '')).join('');
  return new RegExp(`^${body}$`);
}

/** Parca No verilen bicime uyuyor mu? */
export function isValidPartNo(partNo, format) {
  if (typeof partNo !== 'string' || !partNo) return false;
  return partNoRegex(format).test(partNo);
}

/**
 * Parca No'nun BLOK bolumu (ilk rakam grubu). Bicime uymayan degerde null.
 * "320.00.001" -> "320"
 */
export function blockOf(partNo, format) {
  if (!isValidPartNo(partNo, format)) return null;
  const { groups } = parsePartNoFormat(format);
  return String(partNo).slice(0, groups[0]);
}

/** Parca No'nun SIRA bolumu (son rakam grubu) sayi olarak; uymuyorsa null. */
export function sequenceOf(partNo, format) {
  if (!isValidPartNo(partNo, format)) return null;
  const { groups } = parsePartNoFormat(format);
  const tail = String(partNo).slice(-groups[groups.length - 1]);
  return parseInt(tail, 10);
}

/**
 * Blok + sira numarasindan tam Parca No uretir.
 * ("320", 1, "NNN.NN.NNN") -> "320.00.001"
 * @throws {Error} blok veya sira, bicime sigmiyorsa (status=409)
 */
export function buildPartNo(block, sequence, format) {
  const { groups, separators } = parsePartNoFormat(format);
  const headLen = groups[0];
  const tailLen = groups[groups.length - 1];
  const head = String(block ?? '').trim();
  if (!/^\d+$/.test(head) || head.length > headLen) {
    throw bad(`Blok "${block}" ${headLen} haneye sigmiyor (bicim: ${format}).`, 409);
  }
  if (!Number.isInteger(sequence) || sequence < 0 || String(sequence).length > tailLen) {
    throw bad(`Blok ${head} icindeki numaralar tukendi (bicim: ${format}).`, 409);
  }
  const parts = groups.map((len, i) => {
    if (i === 0) return head.padStart(len, '0');
    if (i === groups.length - 1) return String(sequence).padStart(len, '0');
    return '0'.repeat(len); // ara gruplar simdilik rezerve
  });
  return parts.reduce((acc, part, i) => acc + (i > 0 ? separators[i - 1] : '') + part, '');
}

/** Proje kaydindan bicim ayarlarini (varsayilanlariyla) okur. */
export function configOf(project) {
  const format = project?.partNoFormat || DEFAULT_PART_NO_FORMAT;
  const step =
    Number.isInteger(project?.partNoBlockStep) && project.partNoBlockStep > 0
      ? project.partNoBlockStep
      : DEFAULT_PART_NO_BLOCK_STEP;
  parsePartNoFormat(format); // gecersiz bicimi burada yakala
  return { format, blockStep: step };
}

/**
 * KULLANILMIS (canli + silinmis) tum Parca No'lari toplar — kara liste.
 * Kaynak: canli Requirement.partNo + Component.partNo degerleri (Issue #138
 * ile bilesen kendi basina bir kayittir; iki tablo AYNI numara uzayini
 * paylasir) + AuditLog'daki Parca No izleri (PARTNO action'lari; silinen
 * kayitlarin numarasi orada kalir).
 * AuditLog.textId "320.00.001 -> 320.00.007" gibi birlesik de olabildigi
 * icin bosluk/ok'a gore parcalanip her parca degerlendirilir (idGen.js ile
 * ayni ayristirma).
 * @returns {Promise<Set<string>>}
 */
export async function usedPartNos(prisma, projectId) {
  const [rows, componentRows, auditRows] = await Promise.all([
    prisma.requirement.findMany({
      where: { projectId, partNo: { not: null } },
      select: { partNo: true },
    }),
    prisma.component.findMany({
      where: { projectId, partNo: { not: null } },
      select: { partNo: true },
    }),
    prisma.auditLog.findMany({
      where: { projectId, field: PART_NO_AUDIT_FIELD },
      select: { textId: true, oldValue: true, newValue: true },
    }),
  ]);
  const used = new Set();
  const consider = (raw) => {
    if (!raw) return;
    for (const token of String(raw).split(/\s*->\s*|\s+|,/)) {
      const clean = token.trim();
      if (clean) used.add(clean);
    }
  };
  for (const { partNo } of rows) consider(partNo);
  for (const { partNo } of componentRows) consider(partNo);
  for (const row of auditRows) {
    consider(row.textId);
    consider(row.oldValue);
    consider(row.newValue);
  }
  return used;
}

/**
 * Bir dugumun cocuklarinin kullanacagi blogu belirler.
 * Once dugumun ELLE verdigi blok (partNoBlock), yoksa KENDI Parca No'sunun
 * blok bolumu. Ikisi de yoksa null (cagiran yeni blok ayirir).
 */
export function childBlockOf(parent, format) {
  if (!parent) return null;
  const explicit = String(parent.partNoBlock ?? '').trim();
  if (explicit) return explicit;
  return blockOf(parent.partNo, format);
}

/**
 * KOK seviyede yeni bir dal icin bir sonraki bos blogu ayirir.
 * Adim (blockStep) proje bazlidir: 10 -> 010, 020, 030...
 * Kullanilmis bloklar canli kayitlarin BLOK bolumunden turetilir (kara liste
 * burada gerekmez: blok cakismasi zaten numara cakismasi olarak yakalanir).
 */
export function nextRootBlock(existingBlocks, { format, blockStep }) {
  const { groups } = parsePartNoFormat(format);
  const headLen = groups[0];
  const taken = new Set(
    existingBlocks
      .filter(Boolean)
      .map((b) => parseInt(b, 10))
      .filter((n) => !Number.isNaN(n)),
  );
  const max = 10 ** headLen - 1;
  for (let n = blockStep; n <= max; n += blockStep) {
    if (!taken.has(n)) return String(n).padStart(headLen, '0');
  }
  throw bad(`Kok seviyede bos blok kalmadi (bicim: ${format}).`, 409);
}

/**
 * Verilen blok icinde, kara listeyi de dikkate alarak bir sonraki BOS Parca
 * No'yu uretir. Silinen numaralar atlanir (asla yeniden kullanilmaz).
 */
export function nextPartNoInBlock(block, used, format) {
  const { groups } = parsePartNoFormat(format);
  const tailLen = groups[groups.length - 1];
  const max = 10 ** tailLen - 1;
  for (let seq = 1; seq <= max; seq += 1) {
    const candidate = buildPartNo(block, seq, format);
    if (!used.has(candidate)) return candidate;
  }
  throw bad(`Blok ${block} icindeki numaralar tukendi (bicim: ${format}).`, 409);
}

/**
 * Tek bir dugum icin Parca No ayirir (ust dugumun blogundan siradaki bos
 * numara; ust yoksa yeni bir kok blok). Toplu atama icin partNumbers.js
 * `ensurePartNumbers` kullanilir — o, tum agaci TEK gecisde numaralar.
 * @returns {Promise<string>}
 */
export async function allocatePartNo(prisma, projectId, parentId, project) {
  const cfg = configOf(project);
  const [used, parent, roots] = await Promise.all([
    usedPartNos(prisma, projectId),
    parentId ? prisma.requirement.findUnique({ where: { id: parentId } }) : Promise.resolve(null),
    prisma.requirement.findMany({
      where: { projectId, parentId: null },
      select: { partNo: true, partNoBlock: true },
    }),
  ]);
  let block = childBlockOf(parent, cfg.format);
  if (!block) {
    const existing = roots.map((r) => String(r.partNoBlock || '').trim() || blockOf(r.partNo, cfg.format));
    block = nextRootBlock(existing, cfg);
  }
  return nextPartNoInBlock(block, used, cfg.format);
}

// --- yardimcilar ------------------------------------------------------------
function escapeRe(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function bad(msg, status = 400) {
  return Object.assign(new Error(msg), { status });
}
