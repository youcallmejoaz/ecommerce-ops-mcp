import "server-only";
import { createContext } from "@/core/runtime";
import type { OpsContext } from "@/core/context";

const g = globalThis as unknown as { __opsCtx?: OpsContext };

/** One shared context (DB handle, adapters, limits) per server process. */
export function ctx(): OpsContext {
  g.__opsCtx ??= createContext();
  return g.__opsCtx;
}
