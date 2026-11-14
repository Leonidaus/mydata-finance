import { applyOps, type Block, type Dashboard } from "@mydata/shared";

// Library cards use their canonical component id, while gallery cards use widget:<type>.
// Both paths must share a key; the model is free to choose the card's id.
const LIBRARY_WIDGET_TYPES: Record<string, string | undefined> = {
  money_story: "widget:story",
  savings_jar: "widget:jar",
  safe_gauge: "widget:gauge",
  money_flow: "widget:flow",
  whatif_coins: "widget:coins",
};

function widgetType(block: Block): string | undefined {
  if (block.component?.startsWith("widget:")) return block.component;
  const libraryType = block.component && LIBRARY_WIDGET_TYPES[block.component];
  if (libraryType) return libraryType;
  const legacyType = /^(story|jar|gauge|flow|coins)-/.exec(block.id)?.[1];
  return legacyType ? `widget:${legacyType}` : undefined;
}

export function uniqueWidgetTypes(blocks: Block[]): Block[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const type = widgetType(block);
    if (!type) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    return true;
  });
}

/** Widget types are singular on a dashboard; adding one replaces the existing card of that type. */
export function applyDashboardOps(dashboard: Dashboard, ops: Parameters<typeof applyOps>[1]): Dashboard {
  const newestWidgetIds = new Map<string, string>();
  for (const op of ops) {
    if (op.op === "add_block") {
      const type = widgetType(op.block);
      if (type) newestWidgetIds.set(type, op.block.id);
    }
  }
  const existing = dashboard.blocks.filter((block) => !newestWidgetIds.has(widgetType(block) ?? ""));
  const result = applyOps({ ...dashboard, blocks: existing }, ops);
  return {
    ...result,
    blocks: result.blocks.filter((block) => {
      const newestId = newestWidgetIds.get(widgetType(block) ?? "");
      return newestId === undefined || newestId === block.id;
    }),
  };
}
