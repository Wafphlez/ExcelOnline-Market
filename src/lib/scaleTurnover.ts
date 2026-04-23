/**
 * В выгрузке Excel `day_turnover` часто задан в **миллионах** ISK.
 * Во внутренней модели и в UI храним **полные ISK**.
 */
export const TURNOVER_MILLIONS_TO_ISK = 1_000_000

export function excelMillionsToIsk(millions: number): number {
  return millions * TURNOVER_MILLIONS_TO_ISK
}
