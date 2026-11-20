import { formatAUD } from "../lib/money";
import { useCountUp } from "./motion";

/** A dollar amount that counts up the first time it is shown (see useCountUp in motion.ts). */
export function CountUp({ id, cents }: { id: string; cents: number }) {
  return <>{formatAUD(useCountUp(id, cents))}</>;
}
