/**
 * Turns the model's tool calls into DashboardOps, rejecting anything the app could not run or
 * draw. Error messages go back to the model for one retry, so they name the problem plainly
 * and never contain customer data (validation only looks at the call itself).
 */
import { type Block, type BlockView, type Control, type DashboardOp, TEMPLATE_IDS, type TemplateId } from "../blocks";
import { ENGINE_ARG_SPECS, validateEngineArgs } from "../engine/args";
import { ENGINE_FNS, type EngineFn } from "../engine/types";
import { TEMPLATE_FNS } from "./catalog";
import type { ToolCall } from "./tools";

export const MAX_VIEW_CHARS = 30_000;
const ID_RE = /^[a-z][a-z0-9-]{0,47}$/;

export interface ParsedReply {
  ops: DashboardOp[];
  /** The reply text, with placeholders still in it. */
  text: string | null;
  errors: string[];
}

class CallError extends Error {}
const fail = (msg: string): never => {
  throw new CallError(msg);
};

const str = (v: unknown, name: string, max: number): string => {
  if (typeof v !== "string" || !v.trim()) fail(`${name} must be non-empty text.`);
  if ((v as string).length > max) fail(`${name} is longer than ${max} characters.`);
  return (v as string).trim();
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function engineFn(v: unknown): EngineFn {
  if (typeof v !== "string" || !(ENGINE_FNS as readonly string[]).includes(v)) fail(`fn must be one of: ${ENGINE_FNS.join(", ")}.`);
  return v as EngineFn;
}

function engineArgs(fn: EngineFn, v: unknown): Record<string, unknown> {
  if (v === undefined) return {};
  if (!isRecord(v)) fail("args must be an object.");
  try {
    // Keep the arguments as given (empty values mean "all" for the app's controls), but check them.
    validateEngineArgs(fn, v as Record<string, unknown>);
  } catch (e) {
    fail(`args for ${fn}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return v as Record<string, unknown>;
}

function view(a: Record<string, unknown>, fn: EngineFn): BlockView {
  switch (a.view_kind) {
    case "template": {
      const t = a.template;
      if (typeof t !== "string" || !(TEMPLATE_IDS as readonly string[]).includes(t)) fail(`template must be one of: ${TEMPLATE_IDS.join(", ")}.`);
      const fns = TEMPLATE_FNS[t as TemplateId];
      if (!fns.includes(fn)) fail(`template ${t} draws ${fns.join(" or ")}, not ${fn}. Use a spec or code view instead.`);
      return { kind: "template", template: t as TemplateId };
    }
    case "spec": {
      let spec: unknown = a.spec;
      if (typeof spec === "string") {
        if (spec.length > MAX_VIEW_CHARS) fail(`spec is longer than ${MAX_VIEW_CHARS} characters.`);
        try {
          spec = JSON.parse(spec);
        } catch {
          fail("spec is not valid JSON.");
        }
      }
      if (!isRecord(spec)) fail("spec must be a Vega-Lite spec object (as a JSON string).");
      return { kind: "spec", spec: spec as Record<string, unknown> };
    }
    case "code": {
      const code = str(a.code, "code", MAX_VIEW_CHARS);
      if (!code.includes("mydata.onData")) fail("code must read its rows with mydata.onData(function (rows, result) { ... }).");
      return { kind: "code", code };
    }
    default:
      return fail('view_kind must be "template", "spec" or "code".');
  }
}

function controls(v: unknown, fn: EngineFn): Control[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) fail("controls must be a list.");
  const allowed = Object.keys(ENGINE_ARG_SPECS[fn]);
  return (v as unknown[]).map((c): Control => {
    if (!isRecord(c)) return fail("each control must be an object.");
    if (typeof c.arg !== "string" || !allowed.includes(c.arg)) {
      fail(`control arg must be an argument of ${fn}: ${allowed.join(", ") || "it takes none"}.`);
    }
    const arg = c.arg as string;
    if (c.kind === "period") return { kind: "period", arg };
    const label = typeof c.label === "string" && c.label ? c.label : arg;
    if (c.kind === "select") {
      if (!Array.isArray(c.options) || c.options.length === 0 || c.options.length > 30) fail("a select control needs 1 to 30 options.");
      const options = (c.options as unknown[]).map((o) => {
        if (!isRecord(o) || typeof o.label !== "string") return fail("each option needs value and label.");
        return { value: String(o.value ?? ""), label: o.label };
      });
      return { kind: "select", arg, label, options };
    }
    if (c.kind === "slider") {
      const { min, max, step } = c;
      if (typeof min !== "number" || typeof max !== "number" || typeof step !== "number" || !(min < max) || !(step > 0)) {
        fail("a slider control needs numbers min < max and step > 0.");
      }
      return { kind: "slider", arg, label, min: min as number, max: max as number, step: step as number, ...(typeof c.unit === "string" ? { unit: c.unit } : {}) };
    }
    return fail('control kind must be "period", "select" or "slider".');
  });
}

function id(v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v)) fail("id must be short lowercase letters, digits and dashes, starting with a letter.");
  return v as string;
}

function addBlock(a: Record<string, unknown>): Block {
  const fn = engineFn(a.fn);
  const source = a.source;
  if (source !== "own" && source !== "peer" && source !== "estimate") fail('source must be "own", "peer" or "estimate".');
  const ctrls = controls(a.controls, fn);
  return {
    id: id(a.id),
    title: str(a.title, "title", 80),
    explanation: str(a.explanation, "explanation", 600),
    source: source as Block["source"],
    data: { kind: "engine", fn, args: engineArgs(fn, a.args) },
    view: view(a, fn),
    ...(ctrls ? { controls: ctrls } : {}),
  };
}

function updateBlock(a: Record<string, unknown>, existing: Block): DashboardOp {
  const prevFn = existing.data.kind === "engine" ? existing.data.fn : undefined;
  const fn = a.fn !== undefined ? engineFn(a.fn) : prevFn;
  if (!fn) fail(`card ${existing.id} has no engine request to update.`);
  const prevArgs = existing.data.kind === "engine" && a.fn === undefined ? existing.data.args : {};
  const patch: Partial<Omit<Block, "id">> = {};
  if (a.title !== undefined) patch.title = str(a.title, "title", 80);
  if (a.explanation !== undefined) patch.explanation = str(a.explanation, "explanation", 600);
  if (a.source !== undefined) {
    if (a.source !== "own" && a.source !== "peer" && a.source !== "estimate") fail('source must be "own", "peer" or "estimate".');
    patch.source = a.source as Block["source"];
  }
  if (a.fn !== undefined || a.args !== undefined) {
    const merged = { ...prevArgs, ...(isRecord(a.args) ? a.args : {}) };
    patch.data = { kind: "engine", fn: fn as EngineFn, args: engineArgs(fn as EngineFn, merged) };
  }
  if (a.view_kind !== undefined) patch.view = view(a, fn as EngineFn);
  else if (a.fn !== undefined && existing.view.kind === "template" && !TEMPLATE_FNS[existing.view.template].includes(fn as EngineFn)) {
    fail(`template ${existing.view.template} cannot draw ${fn}; give a new view_kind too.`);
  }
  if (a.controls !== undefined) patch.controls = controls(a.controls, fn as EngineFn);
  return { op: "update_block", id: existing.id, patch };
}

/** Validates each call on its own: valid ones become ops, invalid ones become error lines. */
export function parseToolCalls(calls: ToolCall[], current: Block[]): ParsedReply {
  const ops: DashboardOp[] = [];
  const errors: string[] = [];
  let text: string | null = null;
  // Ids known so far: the dashboard plus cards added earlier in this answer.
  const known = new Map(current.map((b) => [b.id, b]));

  for (const call of calls) {
    const a = isRecord(call.args) ? call.args : {};
    try {
      switch (call.name) {
        case "add_block": {
          const block = addBlock(a);
          known.set(block.id, block);
          ops.push({ op: "add_block", block, index: 0 });
          break;
        }
        case "update_block": {
          const existing = known.get(id(a.id));
          if (!existing) fail(`there is no card with id ${String(a.id)}.`);
          const op = updateBlock(a, existing as Block);
          if (op.op === "update_block") known.set(op.id, { ...(existing as Block), ...op.patch });
          ops.push(op);
          break;
        }
        case "remove_block":
        case "move_block": {
          const bid = id(a.id);
          if (!known.has(bid)) fail(`there is no card with id ${bid}.`);
          if (call.name === "remove_block") {
            known.delete(bid);
            ops.push({ op: "remove_block", id: bid });
          } else {
            if (typeof a.index !== "number" || !Number.isInteger(a.index) || a.index < 0) fail("index must be a whole number from 0.");
            ops.push({ op: "move_block", id: bid, index: a.index as number });
          }
          break;
        }
        case "reply":
          text = str(a.text, "text", 2000);
          break;
        default:
          fail(`unknown tool ${call.name}.`);
      }
    } catch (e) {
      if (!(e instanceof CallError)) throw e;
      errors.push(`${call.name}${typeof a.id === "string" ? ` (${a.id})` : ""}: ${e.message}`);
    }
  }
  return { ops, text, errors };
}
