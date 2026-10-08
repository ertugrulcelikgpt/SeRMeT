// ============================================================================
//  issue135-part-numbers.test.js — Parca No (Issue #135).
//
//  Bilesenler PBS agacindan turetildigi icin (bkz. #129) parca kimligi de o
//  dugumun uzerinde (Requirement.partNo) yasar. Kapsam:
//    * Yeni dugum eklenince Parca No OTOMATIK atanir.
//    * Ayni adli ama FARKLI dallardaki dugumler farkli numara alir
//      (AMTB/GY1 != STC/GY1) — issue'daki ornek agacin ta kendisi.
//    * Numara elle degistirilebilir; cakisma KAYDEDILMEZ (409).
//    * Silinen numara yeniden kullanilmaz; degisiklikler audit log'a yazilir.
//    * Bicim + kok blok adimi proje bazli yapilandirilabilir.
//    * Tutarlilik kontrolu ihlalleri listeler.
// ============================================================================
import { resetDb } from './_setup.js';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';

const { default: app } = await import('../src/server.js');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let proj;
let pmToken;

const auth = (r) => r.set('Authorization', `Bearer ${pmToken}`);
const base = () => `/api/projects/${proj.id}`;

/** Gereksinim (PBS dugumu) olusturur; yanit govdesini dondurur. */
const addNode = async (title, type, parentId) => {
  const res = await auth(request(app).post(`${base()}/requirements`)).send({ title, type, parentId });
  assert.equal(res.status, 201, `dugum olusturulamadi: ${JSON.stringify(res.body)}`);
  return res.body;
};

const setPartNo = (id, body) => auth(request(app).patch(`${base()}/requirements/${id}/part-no`)).send(body);

before(async () => {
  resetDb();

  const { hashPassword, signToken } = await import('../src/auth.js');
  const user = await prisma.user.create({
    data: {
      username: 'pm-partno',
      passwordHash: await hashPassword('pm-pass'),
      name: 'PartNo PM',
      role: 'Proje Yöneticisi',
      clearanceLevel: 5,
    },
  });
  pmToken = signToken({ userId: user.id, roleKey: 'pm', clearanceLevel: 5 });

  proj = await prisma.project.create({ data: { name: 'Parca No Projesi', description: 'Issue #135' } });
});

after(async () => {
  await prisma.$disconnect();
});

// --- Otomatik atama ---------------------------------------------------------

test('yeni kok dugum olusturulunca Parca No otomatik atanir', async () => {
  const root = await addNode('Sistem', 'User Requirement', null);
  assert.match(root.partNo, /^\d{3}\.\d{2}\.\d{3}$/);
});

test('issue ornegi: ayni adli GY1 iki farkli dalda FARKLI numara alir', async () => {
  const sistem = await addNode('Sistem (ornek)', 'User Requirement', null);
  // Dallar kendi blok araliklarini belirler: AMTB -> 320.*, STC -> 340.*
  const amtb = await addNode('AMTB', 'System Requirement', sistem.id);
  const stc = await addNode('STC', 'System Requirement', sistem.id);
  assert.equal((await setPartNo(amtb.id, { partNoBlock: '320' })).status, 200);
  assert.equal((await setPartNo(stc.id, { partNoBlock: '340' })).status, 200);

  const amtbGy1 = await addNode('GY1', 'Software Requirement', amtb.id);
  const amtbGy2 = await addNode('GY2', 'Software Requirement', amtb.id);
  const stcGy1 = await addNode('GY1', 'Software Requirement', stc.id);
  const stcGy2 = await addNode('GY2', 'Software Requirement', stc.id);
  const stcGy3 = await addNode('GY3', 'Software Requirement', stc.id);

  assert.equal(amtbGy1.partNo, '320.00.001');
  assert.equal(amtbGy2.partNo, '320.00.002');
  assert.equal(stcGy1.partNo, '340.00.001');
  assert.equal(stcGy2.partNo, '340.00.002');
  assert.equal(stcGy3.partNo, '340.00.003');
  // Ayni ad, FARKLI parca — ayirt eden sey Parca No'dur.
  assert.equal(amtbGy1.title, stcGy1.title);
  assert.notEqual(amtbGy1.partNo, stcGy1.partNo);
});

test('ensure: numarasiz eski kayitlara numara atar ve idempotenttir', async () => {
  const p = await prisma.project.create({ data: { name: 'Ensure Projesi' } });
  const root = await prisma.requirement.create({
    data: { projectId: p.id, text_id: 'R-001', title: 'Kok', type: 'User Requirement' },
  });
  await prisma.requirement.create({
    data: { projectId: p.id, text_id: 'R-002', title: 'Alt', type: 'System Requirement', parentId: root.id },
  });

  const first = await auth(request(app).post(`/api/projects/${p.id}/part-numbers/ensure`)).send({});
  assert.equal(first.status, 200);
  assert.equal(first.body.assigned, 2);

  const again = await auth(request(app).post(`/api/projects/${p.id}/part-numbers/ensure`)).send({});
  assert.equal(again.body.assigned, 0, 'ikinci cagri hicbir sey atamamali');
  assert.equal(again.body.skipped, 2);
});

test('ensure: kullanicinin ELLE verdigi numaraya dokunmaz', async () => {
  const p = await prisma.project.create({ data: { name: 'Ensure Koruma' } });
  await prisma.requirement.create({
    data: { projectId: p.id, text_id: 'R-001', title: 'Kok', type: 'User Requirement', partNo: '777.00.007' },
  });
  await auth(request(app).post(`/api/projects/${p.id}/part-numbers/ensure`)).send({});
  const row = await prisma.requirement.findFirst({ where: { projectId: p.id } });
  assert.equal(row.partNo, '777.00.007');
});

// --- Elle degistirme + tekillik ---------------------------------------------

test("Parca No elle degistirilebilir ve degisiklik audit log'a yazilir", async () => {
  const root = await addNode('Elle Duzenleme', 'User Requirement', null);
  assert.equal((await setPartNo(root.id, { partNoBlock: '510' })).status, 200);
  const child = await addNode('Cocuk', 'System Requirement', root.id);
  assert.equal(child.partNo, '510.00.001');

  const res = await setPartNo(child.id, { partNo: '510.00.042' });
  assert.equal(res.status, 200);
  assert.equal(res.body.partNo, '510.00.042');

  const log = await prisma.auditLog.findFirst({
    where: { projectId: proj.id, entityId: child.id, action: 'PARTNO_CHANGE' },
  });
  assert.ok(log, 'PARTNO_CHANGE audit kaydi yazilmali');
  assert.equal(log.oldValue, '510.00.001');
  assert.equal(log.newValue, '510.00.042');
  assert.equal(log.textId, '510.00.001 -> 510.00.042');
});

test('cakisan Parca No KAYDEDILMEZ (409) ve kayit degismeden kalir', async () => {
  const root = await addNode('Cakisma Dali', 'User Requirement', null);
  await setPartNo(root.id, { partNoBlock: '520' });
  const a = await addNode('A', 'System Requirement', root.id);
  const b = await addNode('B', 'System Requirement', root.id);

  const res = await setPartNo(b.id, { partNo: a.partNo });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /zaten kullanilmis/i);

  const stored = await prisma.requirement.findUnique({ where: { id: b.id } });
  assert.equal(stored.partNo, b.partNo, 'cakismada hicbir sey yazilmamali');
});

test('bicime uymayan Parca No reddedilir (400)', async () => {
  const node = await addNode('Bicim Dali', 'User Requirement', null);
  const res = await setPartNo(node.id, { partNo: 'GY-1' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bicime uymuyor/i);
});

// --- Kara liste (silinen numara yeniden kullanilmaz) ------------------------

test('silinen dugumun numarasi yeniden URETILMEZ', async () => {
  const root = await addNode('Silme Dali', 'User Requirement', null);
  await setPartNo(root.id, { partNoBlock: '610' });
  const first = await addNode('Ilk', 'System Requirement', root.id);
  assert.equal(first.partNo, '610.00.001');

  const del = await auth(request(app).delete(`${base()}/requirements/${first.id}`)).send({
    reason: 'Test silme',
  });
  assert.equal(del.status, 200);

  const next = await addNode('Ikinci', 'System Requirement', root.id);
  assert.equal(next.partNo, '610.00.002', 'silinen 001 tekrar kullanilmamali');
});

test('silinen numara ELLE de geri alinamaz (409)', async () => {
  const root = await addNode('Silme Dali 2', 'User Requirement', null);
  await setPartNo(root.id, { partNoBlock: '620' });
  const first = await addNode('Ilk', 'System Requirement', root.id);
  const firstPartNo = first.partNo;
  await auth(request(app).delete(`${base()}/requirements/${first.id}`)).send({ reason: 'Test silme' });
  const other = await addNode('Ikinci', 'System Requirement', root.id);

  const res = await setPartNo(other.id, { partNo: firstPartNo });
  assert.equal(res.status, 409);
});

// --- Proje bazli yapilandirma -----------------------------------------------

test('Parca No bicimi proje bazli yapilandirilabilir', async () => {
  const other = await prisma.project.create({ data: { name: 'Bicim Projesi' } });
  const cfg = await auth(request(app).put(`/api/projects/${other.id}/part-no-config`)).send({
    format: 'NN-NNNN',
    blockStep: 5,
  });
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.body, { format: 'NN-NNNN', blockStep: 5 });

  const created = await auth(request(app).post(`/api/projects/${other.id}/requirements`)).send({
    title: 'Kok',
    type: 'User Requirement',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.partNo, '05-0001');
});

test('gecersiz bicim reddedilir ve proje ayari degismez', async () => {
  const other = await prisma.project.create({ data: { name: 'Gecersiz Bicim' } });
  const res = await auth(request(app).put(`/api/projects/${other.id}/part-no-config`)).send({ format: 'ABC' });
  assert.equal(res.status, 400);
  const row = await prisma.project.findUnique({ where: { id: other.id } });
  assert.equal(row.partNoFormat, 'NNN.NN.NNN');
});

// --- Tutarlilik kontrolu ----------------------------------------------------

test('tutarlilik kontrolu ihlalleri listeler', async () => {
  const p = await prisma.project.create({ data: { name: 'Tutarlilik Projesi' } });
  const mk = (data) => prisma.requirement.create({ data: { projectId: p.id, ...data } });

  const amtb = await mk({
    text_id: 'T-001',
    title: 'AMTB',
    type: 'User Requirement',
    partNo: '320.00.000',
    partNoBlock: '320',
  });
  const stc = await mk({
    text_id: 'T-002',
    title: 'STC',
    type: 'User Requirement',
    partNo: '340.00.000',
    partNoBlock: '340',
  });
  // Ustunun blok araligi DISINDA numara almis cocuk (STC altinda 320.*)
  await mk({ text_id: 'T-003', title: 'Kacak', type: 'System Requirement', partNo: '320.00.009', parentId: stc.id });
  // Ayni ust altinda ayni ada sahip iki kardes
  await mk({ text_id: 'T-004', title: 'GY1', type: 'System Requirement', partNo: '320.00.001', parentId: amtb.id });
  await mk({ text_id: 'T-005', title: 'GY1', type: 'System Requirement', partNo: '320.00.002', parentId: amtb.id });
  // Bicime uymayan kayit
  await mk({ text_id: 'T-006', title: 'Bicimsiz', type: 'System Requirement', partNo: 'GY-X', parentId: amtb.id });
  // Alt kirilimi olan ama numarasiz bilesen
  const numarasiz = await mk({ text_id: 'T-007', title: 'Numarasiz', type: 'User Requirement' });
  await mk({ text_id: 'T-008', title: 'Yaprak', type: 'System Requirement', parentId: numarasiz.id });

  const check = await auth(request(app).get(`/api/projects/${p.id}/part-numbers/check`));
  assert.equal(check.status, 200);
  const codes = new Set(check.body.issues.map((i) => i.code));
  assert.ok(codes.has('BLOCK_MISMATCH'), 'blok disi numara raporlanmali');
  assert.ok(codes.has('DUPLICATE_SIBLING_NAME'), 'ayni ad kardesler raporlanmali');
  assert.ok(codes.has('INVALID_FORMAT'), 'bicime uymayan kayit raporlanmali');
  assert.ok(codes.has('MISSING_PART_NO'), 'numarasiz bilesen raporlanmali');
  assert.ok(check.body.errorCount > 0);
  assert.equal(check.body.format, 'NNN.NN.NNN');
});

test('tutarlilik kontrolu: yaprak gereksinimin numarasizligi ihlal SAYILMAZ', async () => {
  const p = await prisma.project.create({ data: { name: 'Yaprak Projesi' } });
  await prisma.requirement.create({
    data: { projectId: p.id, text_id: 'Y-001', title: 'Tek yaprak', type: 'User Requirement' },
  });
  const check = await auth(request(app).get(`/api/projects/${p.id}/part-numbers/check`));
  assert.equal(check.body.counts.MISSING_PART_NO, undefined);
});
