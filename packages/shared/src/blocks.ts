/**
 * The dashboard Block model: the contract between the AI, the data layer and the app.
 *
 * The AI never writes numbers. It writes a DataRequest (which engine function or
 * read-only query to run) and a view (template, Vega-Lite spec or sandboxed code).
 * The app/server runs the request and renders the result.
 */
import type { EngineFn } from "./engine/types";

export const TEMPLATE_IDS = [
  "stat",
  "category_bars",
  "trend_line",
  "baskets",
  "balance_forecast",
  "what_if",
  "peer_compare",
  "calendar_heatmap",
  "recurring_list",
  "goal_progress",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type DataRequest =
  | { kind: "engine"; fn: EngineFn; args: Record<string, unknown> }
  /** Read-only, customer-scoped SQL. Executed server-side only (phase 2). */
  | { kind: "sql"; sql: string };

export type BlockView =
  | { kind: "template"; template: TemplateId; params?: Record<string, unknown> }
  /** Vega-Lite spec; the app injects the rows as `data.values` (phase 3). */
  | { kind: "spec"; spec: Record<string, unknown> }
  /** Sandboxed widget code; receives rows via postMessage (phase 3, experimental). */
  | { kind: "code"; code: string };

/** Where a block's figures come from, shown as a badge. */
export type BlockSource = "own" | "peer" | "estimate";

/** A control on a card. Each one edits one argument of the block's DataRequest. */
export type Control =
  | { kind: "period"; arg: string }
  | { kind: "select"; arg: string; label: string; options: { value: string; label: string }[] }
  | { kind: "slider"; arg: string; label: string; min: number; max: number; step: number; unit?: string };

export interface Block {
  id: string;
  title: string;
  /** Plain-language "how was this made". */
  explanation: string;
  source: BlockSource;
  data: DataRequest;
  view: BlockView;
  controls?: Control[];
  /** Pinned blocks stay on the dashboard. An unpinned block is the latest answer and is replaced by the next one. */
  pinned?: boolean;
}

export interface Dashboard {
  customerId: string;
  blocks: Block[];
}

/** Edits the AI (or the user) can make to a dashboard. Mirrors the LLM tool set. */
export type DashboardOp =
  | { op: "add_block"; block: Block; index?: number }
  | { op: "update_block"; id: string; patch: Partial<Omit<Block, "id">> }
  | { op: "remove_block"; id: string }
  | { op: "move_block"; id: string; index: number };

export function applyOps(dashboard: Dashboard, ops: DashboardOp[]): Dashboard {
  let blocks = [...dashboard.blocks];
  for (const op of ops) {
    switch (op.op) {
      case "add_block": {
        blocks = blocks.filter((b) => b.id !== op.block.id);
        const i = op.index ?? 0;
        blocks.splice(Math.max(0, Math.min(i, blocks.length)), 0, op.block);
        break;
      }
      case "update_block":
        blocks = blocks.map((b) => (b.id === op.id ? { ...b, ...op.patch, id: b.id } : b));
        break;
      case "remove_block":
        blocks = blocks.filter((b) => b.id !== op.id);
        break;
      case "move_block": {
        const from = blocks.findIndex((b) => b.id === op.id);
        if (from < 0) break;
        const [b] = blocks.splice(from, 1);
        blocks.splice(Math.max(0, Math.min(op.index, blocks.length)), 0, b);
        break;
      }
    }
  }
  return { ...dashboard, blocks };
}
