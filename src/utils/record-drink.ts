import { invoke } from "@tauri-apps/api/core";
import type { DrinkReceipt } from "@/lib/drink-day";

export function recordDrink(amount: number, requestId: string) {
  return invoke<DrinkReceipt>("record_drink", { amount, requestId });
}
