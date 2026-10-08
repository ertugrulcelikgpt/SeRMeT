// ============================================================================
//  issue126-approvals.test.js — Onay ozetinin (approvals.js) saf mantigi.
//  DB gerektirmez: konsensus kurali ve panel listeleri tek bir yerde
//  (summarizeApprovals) tanimlidir; recomputeApproval ve cascade.js'teki
//  toplu SQL ayni kurali uygular. Bu suit o kurali kilitler.
// ============================================================================
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeApprovals, decisionOf, DECISION } from '../src/approvals.js';

const voter = (id, name = id.toUpperCase()) => ({ id, name, roleName: 'Sistem Mühendisi' });
const vote = (voterId, decision, extra = {}) => ({
  voterId,
  voterName: voterId.toUpperCase(),
  decision,
  ...extra,
});

test('decisionOf: eski (decision NULL) kayitlar onay sayilir', () => {
  assert.equal(decisionOf({ voterId: 'a' }), DECISION.APPROVE);
  assert.equal(decisionOf({ voterId: 'a', decision: null }), DECISION.APPROVE);
  assert.equal(decisionOf({ voterId: 'a', decision: 'reject' }), DECISION.REJECT);
});

test('havuzun tamami onaylayinca konsensus saglanir', () => {
  const s = summarizeApprovals([voter('a'), voter('b')], [vote('a', DECISION.APPROVE), vote('b', DECISION.APPROVE)]);
  assert.equal(s.consensus, true);
  assert.equal(s.approvedCount, 2);
  assert.equal(s.rejectedCount, 0);
  assert.equal(s.pendingCount, 0);
});

test('eksik oy varsa konsensus yok; oy vermeyen "Bekleniyor" listesinde', () => {
  const s = summarizeApprovals([voter('a'), voter('b')], [vote('a', DECISION.APPROVE)]);
  assert.equal(s.consensus, false);
  assert.deepEqual(
    s.waiting.map((r) => r.voterId),
    ['b'],
  );
});

test('bos havuz asla onaylanmaz (proje uyesi yok)', () => {
  assert.equal(summarizeApprovals([], []).consensus, false);
  assert.equal(summarizeApprovals([], [vote('x', DECISION.APPROVE)]).consensus, false);
});

test('red oyu konsensusu bloklar ve "Reddeden" listesine dusler', () => {
  const s = summarizeApprovals([voter('a'), voter('b')], [vote('a', DECISION.APPROVE), vote('b', DECISION.REJECT)]);
  assert.equal(s.consensus, false);
  assert.equal(s.rejectedCount, 1);
  assert.equal(s.rejecters[0].voterId, 'b');
  // Reddeden kisi ayni anda onaylayan sayilmaz.
  assert.equal(s.approvedCount, 1);
});

test('bekleyen DAVET konsensusu bloklar; davetli oy verince kilit acilir', () => {
  const pool = [voter('a'), voter('b')];
  const votes = [
    vote('a', DECISION.APPROVE),
    vote('b', DECISION.APPROVE),
    vote('c', DECISION.PENDING, { invitedById: 'a' }),
  ];
  const pending = summarizeApprovals(pool, votes);
  assert.equal(pending.consensus, false, 'davet edilen oy verene kadar kilitlenmemeli');
  const invited = pending.waiting.find((r) => r.voterId === 'c');
  assert.ok(invited, 'davetli "Bekleniyor" listesinde olmali');
  assert.equal(invited.invited, true);
  assert.equal(invited.departed, false, 'davetli, projeden ayrilmis sayilmaz');

  votes[2] = vote('c', DECISION.APPROVE, { invitedById: 'a' });
  assert.equal(summarizeApprovals(pool, votes).consensus, true);
});

test('projeden ayrilmis oy sahibi "departed" olarak listelenir, havuzu buyutmez', () => {
  const s = summarizeApprovals([voter('a')], [vote('a', DECISION.APPROVE), vote('z', DECISION.APPROVE)]);
  assert.equal(s.consensus, true, 'ayrilan kisinin gecmis onayi konsensusu bozmaz');
  const dep = s.rows.find((r) => r.voterId === 'z');
  assert.equal(dep.departed, true);
  assert.equal(dep.required, false);
  assert.equal(dep.voted, true);
});

test('yorum oy kaydiyla iliskilidir ve satirda tasinir', () => {
  const s = summarizeApprovals([voter('a')], [vote('a', DECISION.APPROVE, { comment: 'Izlenebilirlik tamam.' })]);
  assert.equal(s.approvers[0].comment, 'Izlenebilirlik tamam.');
});

test('geriye donuk alan: ApprovalMatrixModal icin voted YALNIZCA onay demektir', () => {
  const s = summarizeApprovals(
    [voter('a'), voter('b'), voter('c')],
    [vote('a', DECISION.APPROVE), vote('b', DECISION.REJECT)],
  );
  const byId = Object.fromEntries(s.rows.map((r) => [r.voterId, r]));
  assert.equal(byId.a.voted, true);
  assert.equal(byId.b.voted, false, 'red "oy verildi" olarak gosterilmemeli');
  assert.equal(byId.c.voted, false);
});

test('her oy sahibi listede TEK satirdir (havuz + oy cakismasi cogaltmaz)', () => {
  const s = summarizeApprovals([voter('a'), voter('a')], [vote('a', DECISION.APPROVE), vote('a', DECISION.APPROVE)]);
  assert.equal(s.rows.length, 1);
});
