/**
 * src/payer.mjs — fee stub (Phase 1: network is free)
 */
export async function checkPayerAllowance() {
  return { ok: true, balance: Infinity }; // no fees yet
}
export default { checkPayerAllowance };
