#!/usr/bin/env node
/**
 * Listen for XMTP V3 messages on an agent's inbox.
 * Validates all incoming messages against V3 schema.
 * Usage: node receive.mjs --agent everclaw [--timeout 30]
 */
import { createAgentClient, validateMessage, PROTOCOL_VERSION } from "./agent-client.mjs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    agent: { type: "string", default: "everclaw" },
    timeout: { type: "string", default: "30" },
  },
});

function formatMessage(parsed) {
  const sensitivity = parsed.sensitivity || "unknown";
  const topics = (parsed.topics || []).join(", ");
  return `[${parsed.messageType}] topics=${topics} sensitivity=${sensitivity} intent=${parsed.intent || "?"}`;
}

async function main() {
  const { client, identity } = await createAgentClient(values.agent);
  const timeoutMs = parseInt(values.timeout) * 1000;

  console.log(`\n[V3] Listening for messages to ${identity.agentId} (${identity.address})...`);
  console.log(`Timeout: ${values.timeout}s | Protocol: V${PROTOCOL_VERSION}\n`);

  // Sync conversations
  await client.conversations.sync();
  const conversations = await client.conversations.list();
  console.log(`Found ${conversations.length} existing conversation(s)\n`);

  // Process existing messages
  for (const conv of conversations) {
    await conv.sync();
    const messages = await conv.messages();
    for (const msg of messages) {
      if (msg.senderInboxId !== client.inboxId) {
        processInbound(msg, "existing");
      }
    }
  }

  // Stream new messages
  console.log("Streaming new messages...\n");
  const stream = await client.conversations.streamAllMessages();

  const timer = setTimeout(() => {
    console.log(`\n⏱️  Timeout reached (${values.timeout}s). Closing.`);
    stream.return(undefined);
    process.exit(0);
  }, timeoutMs);

  for await (const message of stream) {
    if (message.senderInboxId === client.inboxId) continue;
    processInbound(message, "new");
  }

  clearTimeout(timer);
}

function processInbound(msg, source) {
  const time = new Date(Number(msg.sentAtNs) / 1_000_000).toISOString();

  try {
    const parsed = JSON.parse(msg.content);

    // V3 schema validation
    const validation = validateMessage(parsed);
    if (!validation.valid) {
      console.log(`⚠️  [${source}] INVALID V3 message from ${msg.senderInboxId}`);
      console.log(`   Errors: ${validation.errors.join("; ")}`);
      console.log(`   Raw content (truncated): ${msg.content.slice(0, 200)}`);
      console.log(`   Sent: ${time}\n`);
      return;
    }

    // V3 valid message
    console.log(`📨 [${source}] ${formatMessage(parsed)}`);
    console.log(`   From: ${parsed.payload?.agentId || parsed.payload?.result?.agentId || msg.senderInboxId}`);
    console.log(`   correlationId: ${parsed.correlationId}`);

    if (parsed.messageType === "HANDSHAKE") {
      console.log(`   Challenge nonce: ${parsed.payload?.challenge?.nonce?.slice(0, 16)}...`);
      console.log(`   Signature present: ${!!parsed.payload?.challengeSignature}`);
    } else if (parsed.messageType === "RESPONSE") {
      console.log(`   Status: ${parsed.payload?.status}`);
      console.log(`   Counter-sig present: ${!!parsed.payload?.challengeResponse}`);
    } else if (parsed.messageType === "DATA") {
      console.log(`   Content: ${JSON.stringify(parsed.payload?.data)?.slice(0, 200)}`);
    } else if (parsed.messageType === "BYE") {
      console.log(`   Reason: ${parsed.payload?.reason}`);
      console.log(`   Revocation receipt: ${!!parsed.payload?.revocationReceipt}`);
    }

    console.log(`   Sent: ${time}\n`);

  } catch {
    // Not JSON — legacy or plain text
    console.log(`⚠️  [${source}] Non-JSON message from ${msg.senderInboxId}`);
    console.log(`   Content: ${msg.content?.slice(0, 200)}`);
    console.log(`   Sent: ${time}\n`);
  }
}

main().catch((err) => {
  console.error("❌ Receive failed:", err.message);
  process.exit(1);
});
