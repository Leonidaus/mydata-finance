/**
 * The tools the model calls to answer: dashboard edits mirroring DashboardOp, plus `reply`.
 * Schemas are plain JSON Schema (Gemini `parametersJsonSchema`, also fine for other providers).
 * Deep values (Vega-Lite specs) travel as JSON strings, which models produce more reliably.
 */
import { TEMPLATE_IDS } from "../blocks";
import { ENGINE_FNS } from "../engine/types";

export interface ToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

const control = {
  type: "object",
  description:
    'A control on the card that edits one engine argument. kind "period": a period picker (no label/options). ' +
    'kind "select": options [{value,label}]. kind "slider": min, max, step, optional unit.',
  properties: {
    kind: { type: "string", enum: ["period", "select", "slider"] },
    arg: { type: "string", description: "Name of the engine argument it edits" },
    label: { type: "string" },
    options: {
      type: "array",
      items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"] },
    },
    min: { type: "number" },
    max: { type: "number" },
    step: { type: "number" },
    unit: { type: "string" },
  },
  required: ["kind", "arg"],
};

const blockFields = {
  title: { type: "string", description: "Short card title, in the user's language" },
  explanation: { type: "string", description: "One or two plain sentences: how the figures are computed" },
  source: { type: "string", enum: ["own", "peer", "estimate"], description: "own data, peer comparison, or an estimate/forecast" },
  fn: { type: "string", enum: [...ENGINE_FNS], description: "Engine function that computes the data" },
  args: { type: "object", description: "Arguments for fn, exactly as listed in the catalog" },
  view_kind: { type: "string", enum: ["template", "spec", "code"] },
  template: { type: "string", enum: [...TEMPLATE_IDS], description: 'When view_kind is "template"' },
  spec: { type: "string", description: 'When view_kind is "spec": a Vega-Lite spec as a JSON string, without data (rows are injected)' },
  code: { type: "string", description: 'When view_kind is "code": HTML with an inline <script> using mydata.onData' },
  controls: { type: "array", items: control },
};

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "add_block",
    description: "Add a card to the top of the dashboard. Reusing an existing id replaces that card.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short lowercase id like restaurants-trend; used in reply placeholders" },
        ...blockFields,
      },
      required: ["id", "title", "explanation", "source", "fn", "view_kind"],
    },
  },
  {
    name: "update_block",
    description: "Change an existing card. Only the given fields change; args are merged into the current ones.",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...blockFields },
      required: ["id"],
    },
  },
  {
    name: "remove_block",
    description: "Remove a card from the dashboard.",
    parametersJsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "move_block",
    description: "Move a card to a position (0 is the top).",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "string" }, index: { type: "integer" } },
      required: ["id", "index"],
    },
  },
  {
    name: "reply",
    description:
      "The chat answer shown to the user. Call exactly once. Never write a number from the data yourself: use placeholders " +
      "{{<blockId>.value}} (the card's headline figure) or {{<blockId>.caption}} (its one-line summary).",
    parametersJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];
