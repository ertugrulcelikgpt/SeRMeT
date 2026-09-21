// ============================================================================
//  issue135-components.test.js — Bilesen (parca) agaci + Parca No (Issue #135).
//
//  Kapsam (kabul kriterleri birebir):
//    * Yeni parcada Parca No OTOMATIK atanir, elle degistirilebilir.
//    * Ayni adli ama FARKLI dallardaki bilesenler farkli Parca No alir
//      (AMTB/GY1 != STC/GY1) — issue'daki ornek agacin ta kendisi.
//    * Parca No proje icinde TEKIL; cakisma KAYDEDILMEZ (409).
//    * Silinen Parca No yeniden kullanilmaz; degisiklikler audit log'a yazilir.
//    * Bicim + kok blok adimi proje bazli yapilandirilabilir.
//    * Tutarlilik kontrolu tum ihlal turlerini listeler.
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

const createComponent = (body) => auth(request(app).post(`${base()}/components`)).send(body);
const patchComponent = (id, body) => auth(request(app).patch(`${base()}/components/${id}`)).send(body);

before(async () => {
  resetDb();

  const { hashPassword, signToken } = await import('../src/auth.js');
  const user = await prisma.user.create({
    data: {
      username: 'pm-components',
      passwordHash: await hashPassword('pm-pass'),
      name: 'Component PM',
      role: 'Proje Yöneticisi',
      clearanceLevel: 5,
    },
  });
  pmToken = signToken({ userId: user.id, roleKey: 'pm', clearanceLevel: 5 });

  proj = await prisma.project.create({ data: { name: 'Bilesen Proje', description: 'Issue #135' } });
});

after(async () => {
  await prisma.$disconnect();
});

// --- Otomatik numara + dal bloklari -----------------------------------------

test('kok dal olusturulunca Parca No otomatik atanir (varsayilan bicim)', async () => {
  const res = await createComponent({ name: 'Sistem', type: 'assembly' });
  assert.equal(res.status, 201);
  assert.match(res.body.partNo, /^\d{3}\.\d{2}\.\d{3}$/);
  assert.equal(res.body.type, 'assembly');
  assert.equal(res.body.revision, 'A');
});

test('issue ornegi: ayni adli GY1 iki farkli dalda FARKLI Parca No alir', async () => {
  const sistem = (await createComponent({ name: 'Sistem (ornek)', type: 'assembly' })).body;
  // Dallar kendi blok araliklarini belirler: AMTB -> 320.*, STC -> 340.*
  const amtb = (await createComponent({ name: 'AMTB', parentId: sistem.id, partNoBlock: '320' })).body;
  const stc = (await createComponent({ name: 'STC', parentId: sistem.id, partNoBlock: '340' })).body;

  const amtbGy1 = (await createComponent({ name: 'GY1', type: 'software', parentId: amtb.id })).body;
  const amtbGy2 = (await createComponent({ name: 'GY2', type: 'software', parentId: amtb.id })).body;
  const stcGy1 = (await createComponent({ name: 'GY1', type: 'software', parentId: stc.id })).body;
  const stcGy2 = (await createComponent({ name: 'GY2', type: 'software', parentId: stc.id })).body;
  const stcGy3 = (await createComponent({ name: 'GY3', type: 'software', parentId: stc.id })).body;

  assert.equal(amtbGy1.partNo, '320.00.001');
  assert.equal(amtbGy2.partNo, '320.00.002');
  assert.equal(stcGy1.partNo, '340.00.001');
  assert.equal(stcGy2.partNo, '340.00.002');
  assert.equal(stcGy3.partNo, '340.00.003');
  // Ayni ad, FARKLI parca — ayirt eden sey Parca No'dur.
  assert.equal(amtbGy1.name, stcGy1.name);
  assert.notEqual(amtbGy1.partNo, stcGy1.partNo);
});

// --- Elle degistirme + tekillik ---------------------------------------------

test("Parca No elle degistirilebilir ve degisiklik audit log'a yazilir", async () => {
  const root = (await createComponent({ name: 'Elle Duzenleme', partNoBlock: '510' })).body;
  const child = (await createComponent({ name: 'Cocuk', parentId: root.id })).body;
  assert.equal(child.partNo, '510.00.001');

  const res = await patchComponent(child.id, { partNo: '510.00.042' });
  assert.equal(res.status, 200);
  assert.equal(res.body.partNo, '510.00.042');

  const log = await prisma.auditLog.findFirst({
    where: { projectId: proj.id, entityType: 'component', entityId: child.id, action: 'RENAME' },
  });
  assert.ok(log, 'RENAME audit kaydi yazilmali');
  assert.equal(log.oldValue, '510.00.001');
  assert.equal(log.newValue, '510.00.042');
  assert.equal(log.textId, '510.00.001 -> 510.00.042');
});

test('cakisan Parca No KAYDEDILMEZ (409) ve kayit degismeden kalir', async () => {
  const root = (await createComponent({ name: 'Cakisma Dali', partNoBlock: '520' })).body;
  const a = (await createComponent({ name: 'A', parentId: root.id })).body;
  const b = (await createComponent({ name: 'B', parentId: root.id })).body;

  const res = await patchComponent(b.id, { partNo: a.partNo });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /zaten kullanilmis/i);

  const stored = await prisma.component.findUnique({ where: { id: b.id } });
  assert.equal(stored.partNo, b.partNo, 'cakismada hicbir sey yazilmamali');
});

test('bicime uymayan Parca No reddedilir (400)', async () => {
  const root = (await createComponent({ name: 'Bicim Dali', partNoBlock: '530' })).body;
  const res = await patchComponent(root.id, { partNo: 'GY-1' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bicime uymuyor/i);
});

// --- Kara liste (silinen numara yeniden kullanilmaz) ------------------------

test('silinen parcanin numarasi yeniden URETILMEZ', async () => {
  const root = (await createComponent({ name: 'Silme Dali', partNoBlock: '610' })).body;
  const first = (await createComponent({ name: 'Ilk', parentId: root.id })).body;
  assert.equal(first.partNo, '610.00.001');

  const del = await auth(request(app).delete(`${base()}/components/${first.id}`)).send({ reason: 'Test' });
  assert.equal(del.status, 200);

  const next = (await createComponent({ name: 'Ikinci', parentId: root.id })).body;
  assert.equal(next.partNo, '610.00.002', 'silinen 001 tekrar kullanilmamali');
});

test('silinen numara ELLE de geri alinamaz (409)', async () => {
  const root = (await createComponent({ name: 'Silme Dali 2', partNoBlock: '620' })).body;
  const first = (await createComponent({ name: 'Ilk', parentId: root.id })).body;
  await auth(request(app).delete(`${base()}/components/${first.id}`)).send({ reason: 'Test' });
  const other = (await createComponent({ name: 'Ikinci', parentId: root.id })).body;

  const res = await patchComponent(other.id, { partNo: first.partNo });
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

  const created = await auth(request(app).post(`/api/projects/${other.id}/components`)).send({ name: 'Kok' });
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

// --- Gereksinim <-> bilesen bagi (#129) -------------------------------------

test('gereksinim bir bilesene baglanir ve bilesen uzerinden listelenir', async () => {
  const comp = (await createComponent({ name: 'Su Pompasi', type: 'hardware', partNoBlock: '710' })).body;
  const req1 = await auth(request(app).post(`${base()}/requirements`)).send({
    type: 'System Requirement',
    title: 'Pompa debisi',
    componentId: comp.id,
  });
  assert.equal(req1.status, 201);
  assert.equal(req1.body.componentId, comp.id);

  const list = await auth(request(app).get(`${base()}/components/${comp.id}/requirements`));
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].title, 'Pompa debisi');

  const all = await auth(request(app).get(`${base()}/components`));
  const row = all.body.items.find((c) => c.id === comp.id);
  assert.equal(row.requirementCount, 1);
});

test('baska projenin bileseni gereksinime baglanamaz (404)', async () => {
  const other = await prisma.project.create({ data: { name: 'Yabanci Proje' } });
  const foreign = await prisma.component.create({
    data: { projectId: other.id, name: 'Yabanci', partNo: '999.00.001' },
  });
  const res = await auth(request(app).post(`${base()}/requirements`)).send({
    type: 'System Requirement',
    title: 'Yanlis bag',
    componentId: foreign.id,
  });
  assert.equal(res.status, 404);
});

// --- Tutarlilik kontrolu ----------------------------------------------------

test('tutarlilik kontrolu tum ihlal turlerini listeler', async () => {
  const p = await prisma.project.create({ data: { name: 'Tutarlilik Projesi' } });
  const mk = (data) => prisma.component.create({ data: { projectId: p.id, ...data } });

  const amtb = await mk({ name: 'AMTB', partNo: '320.00.000', partNoBlock: '320' });
  const stc = await mk({ name: 'STC', partNo: '340.00.000', partNoBlock: '340' });
  // Ustunun blok araligi DISINDA numara almis cocuk (STC altinda 320.*)
  await mk({ name: 'Kacak', partNo: '320.00.009', parentId: stc.id });
  // Ayni ust altinda ayni ada sahip iki kardes
  await mk({ name: 'GY1', partNo: '320.00.001', parentId: amtb.id });
  await mk({ name: 'GY1', partNo: '320.00.002', parentId: amtb.id });
  // Bicime uymayan kayit
  await mk({ name: 'Bicimsiz', partNo: 'GY-X', parentId: amtb.id });
  // NOT: ORPHAN (ustu bulunamayan dugum) FK + SetNull sayesinde normal
  // akista OLUSAMAZ; kontrol bozuk/tasinmis veriye karsi savunmadir, bu
  // yuzden burada uretilmez.
  const check = await auth(request(app).get(`/api/projects/${p.id}/components/check`));
  assert.equal(check.status, 200);
  const codes = new Set(check.body.issues.map((i) => i.code));
  assert.ok(codes.has('BLOCK_MISMATCH'), 'blok disi numara raporlanmali');
  assert.ok(codes.has('DUPLICATE_SIBLING_NAME'), 'ayni ad kardesler raporlanmali');
  assert.ok(codes.has('INVALID_FORMAT'), 'bicime uymayan kayit raporlanmali');
  assert.ok(codes.has('NO_REQUIREMENTS'), 'gereksinimsiz bilesen bilgi olarak raporlanmali');
  assert.ok(check.body.errorCount > 0);
  assert.equal(check.body.format, 'NNN.NN.NNN');
});

test('tutarlilik kontrolu: dongu (cycle) tespit edilir', async () => {
  const p = await prisma.project.create({ data: { name: 'Dongu Projesi' } });
  const a = await prisma.component.create({ data: { projectId: p.id, name: 'A', partNo: '010.00.001' } });
  const b = await prisma.component.create({
    data: { projectId: p.id, name: 'B', partNo: '010.00.002', parentId: a.id },
  });
  // Dongu yalnizca dogrudan DB mudahalesiyle olusabilir (API resolveParent
  // ile engeller); rapor yine de bunu gormelidir.
  await prisma.component.update({ where: { id: a.id }, data: { parentId: b.id } });

  const check = await auth(request(app).get(`/api/projects/${p.id}/components/check`));
  const codes = new Set(check.body.issues.map((i) => i.code));
  assert.ok(codes.has('CYCLE'), 'dongu raporlanmali');
});

test('API bir bileseni kendi alt agacina tasimaya izin vermez', async () => {
  const root = (await createComponent({ name: 'Tasima Koku', partNoBlock: '810' })).body;
  const child = (await createComponent({ name: 'Tasima Cocuk', parentId: root.id })).body;
  const res = await patchComponent(root.id, { parentId: child.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /dongu/i);
});
