#!/usr/bin/env node
/**
 * Send an XMTP V3 structured message from one agent to another.
 * Usage: node send.mjs --from morpheusai --to <address> --message "hello" [--topic everclaw] [--sensitivity technical]
 */
import { createAgentClient, buildMessage, validateMessage, PROTOCOL_VERSION } from "./agent-client.mjs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "morpheusai" },
    to: { type: "string" },
    message: { type: "string", default: "Hello from EverClaw agent!" },
    topic: { type: "string", default: "general" },
    sensitivity: { type: "string", default: "public" },
  },
});

if (!values.to) {
  console.error("Usage: node send.mjs --from <agentId> --to <0xAddress> --message <text> [--topic <topic>] [--sensitivity <level>]");
  process.exit(1);
}

async function main() {
  const { client, identity, account } = await createAgentClient(values.from);
  const toId = { identifier: values.to.toLowerCase(), identifierKind: 0 };

  console.log(`\n[V3] Sending structured message from ${identity.agentId} (${identity.address}) to ${values.to}...`);

  // Check reachability
  const canMessage = await client.canMessage([toId]);
  const reachable = canMessage.get(values.to.toLowerCase());
  console.log(`Recipient reachable: ${reachable ?? "unknown"}`);
  if (!reachable) {
    console.error("❌ Recipient not reachable on XMTP. Aborting.");
    process.exit(1);
  }

  // Create DM conversation
  const conversation = await client.conversations.createDmWithIdentifier(toId);
  console.log(`Conversation ID: ${conversation.id}`);

  // Build V3 structured message
  const msg = buildMessage({
    messageType: "DATA",
    payload: {
      contentType: "text/plain",
      data: { text: values.message },
      encoding: "json",
    },
    topics: [values.topic],
    sensitivity: values.sensitivity,
    intent: "update",
  });

  // Validate before sending
  const validation = validateMessage(msg);
  if (!validation.valid) {
    console.error("❌ Message validation failed:", validation.errors);
    process.exit(1);
  }

  // Sign the message
  const msgHash = JSON.stringify(msg);
  msg.signature = await account.signMessage({ message: msgHash });

  // Send as JSON
  await conversation.sendText(JSON.stringify(msg));
  console.log(`✅ V3 message sent (${values.topic}/${values.sensitivity})`);
  console.log(`   correlationId: ${msg.correlationId}`);
  console.log(`   nonce: ${msg.nonce.slice(0, 16)}...`);
}

main().catch((err) => {
  console.error("❌ Send failed:", err.message);
  process.exit(1);
});
