import { describe, expect, it } from "vitest";
import { type Block, type ComponentId, type Dashboard, parseToolCalls, widgets } from "@mydata/shared";
import { applyDashboardOps, uniqueWidgetTypes } from "./dashboard";

const customerId = "CUST00001";
const dashboard = (blocks: Block[]): Dashboard => ({ customerId, blocks });

function coachWidget(component: ComponentId, id: string, args: Record<string, unknown> = {}): Block {
  const reply = parseToolCalls([{ name: "use_component", args: { id, component, args } }], []);
  expect(reply.errors).toEqual([]);
  const op = reply.ops[0];
  if (op?.op !== "add_block") throw new Error("Expected a component card");
  return op.block;
}

const widgetCases: { component: ComponentId; gallery: () => Block; args?: Record<string, unknown> }[] = [
  { component: "money_story", gallery: () => widgets.story() },
  { component: "savings_jar", gallery: () => widgets.jar(), args: { target: 25000 } },
  { component: "safe_gauge", gallery: () => widgets.gauge() },
  { component: "money_flow", gallery: () => widgets.flow() },
  { component: "whatif_coins", gallery: () => widgets.coins() },
];

const ordinary = (id: string, pinned = false): Block => ({
  id, title: id, explanation: "", source: "own", pinned,
  component: "spending_donut",
  data: { kind: "engine", fn: "spendBy", args: {} },
  view: { kind: "template", template: "baskets" },
});

describe("dashboard widget identity", () => {
  it.each(widgetCases)("deduplicates $component from both coach and gallery, including after reload", ({ component, gallery, args }) => {
    // Coach ids deliberately have no widget prefix: use_component accepts arbitrary ids.
    const first = coachWidget(component, "first-answer", args);
    const newest = coachWidget(component, "latest-answer", args);
    for (const previous of [first, gallery()]) {
      const result = applyDashboardOps(dashboard([previous]), [{ op: "add_block", block: newest, index: 0 }]);
      expect(result.blocks).toEqual([newest]);
      expect(uniqueWidgetTypes([newest, previous])).toEqual([newest]);
    }
    const fromGallery = gallery();
    expect(applyDashboardOps(dashboard([first]), [{ op: "add_block", block: fromGallery }]).blocks).toEqual([fromGallery]);
  });

  it("still recognises saved widgets created before component metadata was added", () => {
    const { component: _component, ...legacy } = widgets.jar();
    const newest = coachWidget("savings_jar", "home-goal", { target: 25000 });
    expect(applyDashboardOps(dashboard([legacy]), [{ op: "add_block", block: newest }]).blocks).toEqual([newest]);
    expect(uniqueWidgetTypes([newest, legacy])).toEqual([newest]);
  });

  it("keeps only the last addition of a widget type within one answer", () => {
    const first = coachWidget("safe_gauge", "first-answer");
    const last = coachWidget("safe_gauge", "last-answer");
    const other = ordinary("breakdown", true);
    expect(applyDashboardOps(dashboard([other]), [
      { op: "add_block", block: first, index: 0 },
      { op: "add_block", block: last, index: 0 },
    ])).toEqual(dashboard([last, other]));
  });

  it("retains pinned and unpinned cards of other types when adding a widget", () => {
    const pinned = ordinary("kept", true);
    const previousAnswer = ordinary("previous-answer");
    const jar = widgets.jar();
    const gauge = coachWidget("safe_gauge", "new-answer");
    expect(applyDashboardOps(dashboard([pinned, previousAnswer, jar]), [{ op: "add_block", block: gauge, index: 0 }]))
      .toEqual(dashboard([gauge, pinned, previousAnswer, jar]));
  });

  it("preserves ordinary card additions and updates with an existing id", () => {
    const first = ordinary("first-answer");
    const second = ordinary("second-answer");
    const added = applyDashboardOps(dashboard([first]), [{ op: "add_block", block: second }]);
    expect(added.blocks).toEqual([second, first]);
    const changed = { ...second, title: "A new title" };
    expect(applyDashboardOps(added, [{ op: "add_block", block: changed }]).blocks).toEqual([changed, first]);
    expect(uniqueWidgetTypes([first, second])).toEqual([first, second]);
  });

  it("preserves explicit update, move and remove operations", () => {
    const jar = coachWidget("savings_jar", "home-goal", { target: 25000 });
    const other = ordinary("breakdown");
    expect(applyDashboardOps(dashboard([jar, other]), [
      { op: "update_block", id: jar.id, patch: { title: "Updated goal", pinned: true } },
      { op: "move_block", id: jar.id, index: 1 },
    ]).blocks).toEqual([other, { ...jar, title: "Updated goal", pinned: true }]);
    expect(applyDashboardOps(dashboard([jar, other]), [{ op: "remove_block", id: jar.id }]).blocks).toEqual([other]);
  });
});
