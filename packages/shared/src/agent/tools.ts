/**
 * The tools the model calls to answer: dashboard edits mirroring DashboardOp, plus `reply`.
 * Schemas are plain JSON Schema (Gemini `parametersJsonSchema`, also fine for other providers).
 * Deep values (Vega-Lite specs) travel as JSON strings, which models produce more reliably.
 */
import { TEMPLATE_IDS, WIDGET_LIBS } from "../blocks";
import { ENGINE_ARG_SPECS } from "../engine/args";
import { ENGINE_FNS } from "../engine/types";
import { MCC_CODES } from "../mcc";
import { SPENDING_CATEGORIES } from "../engine/util";
import { COMPONENT_IDS } from "../library/components";

export interface ToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Every engine argument with its type and allowed values, so the model sees named fields. With a
 * bare `{ type: "object" }` Gemini tends to send `args: {}`, and the card silently uses defaults.
 * Which arguments a function or component accepts is checked in validate.ts.
 */
function engineArgsSchema(description: string): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [fn, specs] of Object.entries(ENGINE_ARG_SPECS)) {
    for (const [key, spec] of Object.entries(specs)) {
      const usedBy = properties[key]?.description ? `${properties[key].description as string}, ${fn}` : `Used by ${fn}`;
      if (spec.type === "enum") properties[key] = { type: "string", enum: [...spec.values], description: usedBy };
      else if (spec.type === "category") properties[key] = { type: "string", enum: [...SPENDING_CATEGORIES], description: usedBy };
      else if (spec.type === "categories") properties[key] = { type: "array", items: { type: "string", enum: [...SPENDING_CATEGORIES] }, description: usedBy };
      else if (spec.type === "number") properties[key] = { type: "number", minimum: spec.min, maximum: spec.max, description: usedBy };
      else if (spec.type === "mcc") {
        properties[key] = { type: "string", enum: Object.keys(MCC_CODES), description: `Merchant type code from MERCHANT TYPES, e.g. 4121 for taxis. ${usedBy}` };
      } else properties[key] = { type: "string", maxLength: spec.maxLength, description: usedBy };
    }
  }
  return { type: "object", description, properties };
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
  source: { type: "string", enum: ["own", "peer", "public", "estimate"], description: "own data, peer comparison, public statistics (nationalCompare), or an estimate/forecast" },
  fn: { type: "string", enum: [...ENGINE_FNS], description: "Engine function that computes the data" },
  args: engineArgsSchema("Arguments for fn: only the ones it takes (see the catalog), set to what the question asks"),
  view_kind: { type: "string", enum: ["template", "spec", "code"] },
  template: { type: "string", enum: [...TEMPLATE_IDS], description: 'When view_kind is "template"' },
  spec: { type: "string", description: 'When view_kind is "spec": a Vega-Lite spec as a JSON string, without data (rows are injected)' },
  code: { type: "string", description: 'When view_kind is "code": HTML with an inline <script> using mydata.onData' },
  libs: {
    type: "array",
    items: { type: "string", enum: [...WIDGET_LIBS] },
    description: 'When view_kind is "code": libraries to load into the widget. Globals: gsap, Matter (matter), THREE (three). Only list what the code uses.',
  },
  controls: { type: "array", items: control },
  why_custom: {
    type: "string",
    description: 'Required when view_kind is "spec" or "code": why no library component fits this question',
  },
};

/**
 * The chat answer travels with the card call. Light models often make a single tool call and
 * stop, so asking for a separate `reply` call cost a second request for most answers.
 */
const replyField = {
  type: "string",
  description:
    "What you say to the user: two to four short sentences in their language, with the figures that answer the question and what they mean. " +
    "Quote only figures you were given (SNAPSHOT, LOOKED UP, CARD FIGURES); for a figure you have not seen, write {{<id>.value}} and the app fills in the card's headline figure.",
};

/** How the coach feels about what it is saying; the bill's face follows it. */
export const MOODS = ["happy", "proud", "concerned", "neutral"] as const;
export type Mood = (typeof MOODS)[number];

export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_CHARS = 60;

/** What every answering call carries besides its own arguments. */
const coachFields = {
  mood: {
    type: "string",
    enum: [...MOODS],
    description: "Your face while saying it: happy (good news), proud (the user did well), concerned (money is tight or a risk), neutral (plain facts).",
  },
  suggestions: {
    type: "array",
    items: { type: "string", maxLength: MAX_SUGGESTION_CHARS },
    description:
      `Up to ${MAX_SUGGESTIONS} short next steps, written as the user would say them ("Cut it by 20%", "Compare with people my age"). ` +
      "Only things you can actually do with your tools.",
  },
};

export const REPLY_TOOL = "reply";
export const LOOKUP_TOOL = "lookup";

/** Fetches figures without changing the dashboard. Offered only while the coach may still look things up. */
export const LOOKUP_DECLARATION: ToolDeclaration = {
  name: LOOKUP_TOOL,
  description:
    "Read figures you need but do not have yet: runs an engine function and gives you its result. Nothing is shown to the user. " +
    "Call it alone (several lookups at once are fine), then answer once the results arrive. Do not look up what is already in SNAPSHOT.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      fn: { type: "string", enum: [...ENGINE_FNS] },
      args: engineArgsSchema("Arguments for fn: only the ones it takes (see ENGINE FUNCTIONS)"),
    },
    required: ["fn"],
  },
};

export const HAND_OVER_TOOL = "hand_over";

/**
 * Offered to the fast model only, when a stronger one is available: lets it pass a turn on instead
 * of answering. The stronger model writes better coaching but takes several seconds longer, so
 * only the turns that gain from it should go there.
 */
export const HAND_OVER_DECLARATION: ToolDeclaration = {
  name: HAND_OVER_TOOL,
  description:
    "Pass this turn to the senior coach, a slower and more careful model, instead of answering yourself. Call it alone: no lookup, no card, no reply. " +
    "You MUST hand over, even when the question looks simple and you have the figures, when the user: " +
    "(1) mentions a savings goal, a target amount, a deadline or a plan, or asks anything about their savings plan; " +
    "(2) asks for advice or an assessment rather than a figure: how could I save more, where could I cut, what should I change, am I doing okay, what kind of spender am I; " +
    "(3) asks for a chart or widget the component library does not have. " +
    "Answer yourself when the user asks for a figure (how much did I spend on something, what is safe to spend, how one category compares), " +
    "when a follow-up only changes a card (another period, another category, remove it), and for greetings and small talk.",
  parametersJsonSchema: {
    type: "object",
    properties: { why: { type: "string", description: "A few words: what makes this turn one for the senior coach" } },
  },
};

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "use_component",
    description:
      "Preferred way to answer: add a ready-made card from the component library. Reusing an existing id replaces that card, " +
      "which is how to show the same thing as a different component.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short lowercase id like taxi-spend; used in reply placeholders" },
        component: { type: "string", enum: [...COMPONENT_IDS] },
        args: engineArgsSchema("Only the component's own args (see the library). Set every one the question implies: category, period, by..."),
        title: { type: "string", description: "Optional shorter, more specific title in the user's language" },
        reply: replyField,
        ...coachFields,
      },
      required: ["id", "component", "reply"],
    },
  },
  {
    name: "add_block",
    description:
      "Build a new card from an engine function and a view. Only when the user asked to SEE something and no library component can show it " +
      "(see CUSTOM CARDS for when not to). Reusing an existing id replaces that card.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short lowercase id like restaurants-trend; used in reply placeholders" },
        ...blockFields,
        reply: replyField,
        ...coachFields,
      },
      required: ["id", "title", "explanation", "source", "fn", "view_kind", "reply"],
    },
  },
  {
    name: "update_block",
    description:
      "Change a card that is on the dashboard: the way to act on follow-ups like 'make it 3 months' or 'rename it'. Only the given fields change; " +
      "args are merged into the current ones. To change a custom view, send view_kind with the whole edited spec or code.",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...blockFields, reply: replyField, ...coachFields },
      required: ["id", "reply"],
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
    name: REPLY_TOOL,
    description:
      "Answer in words without changing a card: the normal way to answer when the figures speak for themselves, when you ask the user something, " +
      "when something is outside what you can do, or after remove_block/move_block. Not needed when a card call already carries reply.",
    parametersJsonSchema: { type: "object", properties: { text: replyField, ...coachFields }, required: ["text"] },
  },
];
