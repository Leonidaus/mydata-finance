/**
 * The two ways a question gets answered:
 * - `cannedReply`: the suggested prompts. Answered locally by the keyword rules, instantly and
 *   without an API call, also after the LLM is connected.
 * - `askAgent`: free text. Uses the keyword rules for now; swap the body for a call to /api/chat
 *   (phase 2) that returns the same { text, ops }.
 */
import type { Block } from "@mydata/shared";
import { type AgentReply, type RunEngine, respond } from "./mockAgent";

export type { AgentReply, RunEngine };

export const cannedReply = (prompt: string, blocks: Block[], run: RunEngine): Promise<AgentReply> => respond(prompt, blocks, run);

export const askAgent = (question: string, blocks: Block[], run: RunEngine): Promise<AgentReply> => respond(question, blocks, run);
