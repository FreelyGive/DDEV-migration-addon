import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

// Supports ANTHROPIC_API_KEY env var or Claude Code's apiKeyHelper via --bare mode
const client = new Anthropic({
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
});

const SYSTEM_PROMPT =
  "You are a React component architect. Given a screenshot of a website section, list the React components needed to rebuild it. " +
  'Return ONLY valid JSON with this exact shape: { "components": [{ "name": string, "type": string, "description": string, "children": string[] }] }';

export async function analyzeSection(imagePath) {
  const imageData = readFileSync(imagePath).toString("base64");

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: imageData },
          },
          {
            type: "text",
            text: "Identify the React components needed to rebuild this section.",
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON found in response: ${text}`);
  return JSON.parse(jsonMatch[0]);
}
