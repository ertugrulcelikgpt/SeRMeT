// ============================================================================
//  approvals.js  —  Issue #126: onay oylarinin TEK yorumlama noktasi.
//  Approval satiri artik bir "oy yuvasi"dir (decision): 'approve' | 'reject' |
//  'pending' (onaya davet edildi, henuz oy vermedi).
//
//  Konsensus kurali (recomputeApproval ve cascade.js'teki toplu SQL ayni
//  kurali uygular — panel sayaclari da bu ozetten beslenir):
//    Approved  <=>  gerekli oy verenlerin HEPSI 'approve' dedi
//                   VE kayit icin bloklayan satir (reject/pending) YOK.
//  'pending' davetin de bloklamasi bilincli: davet edilen yetkili oy verene
//  kadar kayit kilitlenmemelidir.
// ============================================================================

export const DECISION = {
  APPROVE: 'approve',
  REJECT: 'reject',
  PENDING: 'pending',
};

export const VALID_DECISIONS = [DECISION.APPROVE, DECISION.REJECT, DECISION.PENDING];

/** Eski kayitlarda decision NULL olabilir -> 'approve' sayilir (geriye donuk). */
export function decisionOf(approval) {
  return approval?.decision || DECISION.APPROVE;
}

/**
 * Bir kaydin onay tablosunu (panel + konsensus) tek yerden uretir.
 * @param {Array<{id,name,roleName}>} requiredVoters getRequiredVoters ciktisi
 * @param {Array<object>} approvals o varliga ait Approval satirlari
 * @returns {{
 *   rows: Array<object>, approvers: Array<object>, rejecters: Array<object>,
 *   waiting: Array<object>, approvedCount: number, rejectedCount: number,
 *   pendingCount: number, consensus: boolean
 * }}
 */
export function summarizeApprovals(requiredVoters, approvals) {
  const byVoter = new Map(approvals.map((a) => [a.voterId, a]));
  const rows = [];
  const seen = new Set();
  const rowOf = (voterId, name, role, approval, extra = {}) => ({
    voterId,
    name,
    role: role || '-',
    decision: approval ? decisionOf(approval) : DECISION.PENDING,
    // Geriye donuk alan: ApprovalMatrixModal 'voted' bekliyor (yalnizca onay).
    voted: approval ? decisionOf(approval) === DECISION.APPROVE : false,
    comment: approval?.comment || null,
    votedAt: approval?.updatedAt || approval?.createdAt || null,
    invited: Boolean(approval?.invitedById),
    ...extra,
  });
  // 1) Gerekli oy verenler (havuz) — oy vermemis olsalar da listelenir.
  for (const v of requiredVoters) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    rows.push(rowOf(v.id, v.name, v.roleName, byVoter.get(v.id), { required: true }));
  }
  // 2) Havuz disindaki satirlar: onaya DAVET edilenler ve projeden ayrilmis
  //    ama gecmiste oy vermis kullanicilar (Issue #103, Karar #9).
  for (const a of approvals) {
    if (seen.has(a.voterId)) continue;
    seen.add(a.voterId);
    const invited = Boolean(a.invitedById);
    rows.push(
      rowOf(a.voterId, a.voterName || a.voterId, a.voterRole, a, {
        required: invited,
        departed: !invited,
      }),
    );
  }
  const approvers = rows.filter((r) => r.decision === DECISION.APPROVE);
  const rejecters = rows.filter((r) => r.decision === DECISION.REJECT);
  const waiting = rows.filter((r) => r.decision === DECISION.PENDING);
  // Konsensus: havuzun tamami onayladi VE bloklayan (reject/pending) satir yok.
  // Not: 'departed' satirlar da bloklar — onlarin oyu gecmiste 'approve' ise
  // zaten bloklamaz; reddi duruyorsa kayit kilitlenmemelidir.
  const approvedIds = new Set(approvers.map((r) => r.voterId));
  const allRequiredApproved = requiredVoters.length > 0 && requiredVoters.every((v) => approvedIds.has(v.id));
  const blocked = approvals.some((a) => decisionOf(a) !== DECISION.APPROVE);
  return {
    rows,
    approvers,
    rejecters,
    waiting,
    approvedCount: approvers.length,
    rejectedCount: rejecters.length,
    pendingCount: waiting.length,
    consensus: allRequiredApproved && !blocked,
  };
}
