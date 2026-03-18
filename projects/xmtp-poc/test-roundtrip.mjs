#!/usr/bin/env node
/**
 * V3 End-to-end roundtrip test: MorpheusAI ↔ EverClaw
 * Tests bidirectional agent-to-agent messaging with:
 *  - V3 structured messages
 *  - EIP-191 replay-protected handshake
 *  - Challenge/counter-signature verification
 *  - Schema validation on all messages
 */
import {
  createAgentClient,
  buildHandshake,
  buildHandshakeResponse,
  validateMessage,
  PROTOCOL_VERSION,
} from "./agent-client.mjs";
import { verifyMessage } from "viem";

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`   ✅ ${label}`);
    passed++;
  } else {
    console.log(`   ❌ ${label}`);
    failed++;
  }
}

async function main() {
  console.log(`=== XMTP V3 Agent-to-Agent Roundtrip Test (Protocol ${PROTOCOL_VERSION}) ===\n`);

  // Step 1: Initialize both agents
  console.log("1. Initializing agents...");
  const morpheus = await createAgentClient("morpheusai");
  const everclaw = await createAgentClient("everclaw");
  check("MorpheusAI client initialized", !!morpheus.client);
  check("EverClaw client initialized", !!everclaw.client);

  const morpheusAddr = morpheus.identity.address;
  const everclawAddr = everclaw.identity.address;

  // Step 2: Mutual reachability
  console.log("\n2. Checking reachability...");
  const everclawId = { identifier: everclawAddr.toLowerCase(), identifierKind: 0 };
  const morpheusId = { identifier: morpheusAddr.toLowerCase(), identifierKind: 0 };
  const m2e = await morpheus.client.canMessage([everclawId]);
  const e2m = await everclaw.client.canMessage([morpheusId]);
  check(`MorpheusAI → EverClaw reachable`, m2e.get(everclawAddr.toLowerCase()) === true);
  check(`EverClaw → MorpheusAI reachable`, e2m.get(morpheusAddr.toLowerCase()) === true);

  // Step 3: MorpheusAI sends V3 HANDSHAKE with EIP-191 signed challenge
  console.log("\n3. MorpheusAI → EverClaw: V3 HANDSHAKE...");
  const conv1 = await morpheus.client.conversations.createDmWithIdentifier(everclawId);
  const handshakeMsg = await buildHandshake(morpheus.account, morpheus.identity, conv1.id);

  // Validate before sending
  const hsValidation = validateMessage(handshakeMsg);
  check("Handshake passes V3 schema validation", hsValidation.valid);
  check("Handshake has EIP-191 challenge signature", !!handshakeMsg.payload.challengeSignature);
  check("Handshake nonce is 32+ chars", handshakeMsg.nonce.length >= 32);
  check("Handshake challenge nonce is 32+ chars", handshakeMsg.payload.challenge.nonce.length >= 32);

  await conv1.sendText(JSON.stringify(handshakeMsg));
  console.log("   📤 Sent HANDSHAKE from MorpheusAI");

  // Step 4: EverClaw receives and validates HANDSHAKE
  console.log("\n4. EverClaw receives and validates HANDSHAKE...");
  await everclaw.client.conversations.sync();
  const conversations = await everclaw.client.conversations.list();

  let receivedHandshake = null;
  let handshakeConv = null;

  for (const conv of conversations) {
    await conv.sync();
    const messages = await conv.messages();
    for (const msg of messages) {
      if (msg.senderInboxId !== everclaw.client.inboxId) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.messageType === "HANDSHAKE" && parsed.version === PROTOCOL_VERSION) {
            receivedHandshake = parsed;
            handshakeConv = conv;
          }
        } catch { /* skip non-JSON */ }
      }
    }
  }

  check("EverClaw received V3 HANDSHAKE", !!receivedHandshake);

  if (receivedHandshake) {
    // Validate schema
    const rxValidation = validateMessage(receivedHandshake);
    check("Received handshake passes V3 validation", rxValidation.valid);

    // Verify EIP-191 challenge signature
    const challenge = receivedHandshake.payload.challenge;
    const canonicalChallenge = [
      `xmtp-comms-guard:handshake:v${challenge.version}`,
      `conversation:${challenge.conversationId}`,
      `timestamp:${challenge.timestamp}`,
      `nonce:${challenge.nonce}`,
    ].join("\n");

    const sigValid = await verifyMessage({
      address: receivedHandshake.payload.walletAddress,
      message: canonicalChallenge,
      signature: receivedHandshake.payload.challengeSignature,
    });
    check("EIP-191 challenge signature is valid", sigValid);
    check("Signer matches claimed walletAddress", sigValid && receivedHandshake.payload.walletAddress === morpheusAddr);

    // Step 5: EverClaw sends V3 RESPONSE with counter-signature
    console.log("\n5. EverClaw → MorpheusAI: V3 RESPONSE with counter-signature...");
    const responseMsg = await buildHandshakeResponse(everclaw.account, everclaw.identity, receivedHandshake);

    const respValidation = validateMessage(responseMsg);
    check("Response passes V3 schema validation", respValidation.valid);
    check("Response has counter-signature", !!responseMsg.payload.challengeResponse);
    check("Response correlationId matches handshake", responseMsg.correlationId === receivedHandshake.correlationId);

    await handshakeConv.sendText(JSON.stringify(responseMsg));
    console.log("   📤 Sent RESPONSE from EverClaw");

    // Step 6: MorpheusAI verifies the counter-signature
    console.log("\n6. MorpheusAI verifies counter-signature...");
    await morpheus.client.conversations.sync();
    await conv1.sync();
    const replies = await conv1.messages();

    let receivedResponse = null;
    for (const msg of replies) {
      if (msg.senderInboxId !== morpheus.client.inboxId) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.messageType === "RESPONSE" && parsed.version === PROTOCOL_VERSION) {
            receivedResponse = parsed;
          }
        } catch { /* skip */ }
      }
    }

    check("MorpheusAI received V3 RESPONSE", !!receivedResponse);

    if (receivedResponse) {
      // Verify counter-signature using the ORIGINAL challenge
      const counterSigValid = await verifyMessage({
        address: receivedResponse.payload.result.walletAddress,
        message: canonicalChallenge,
        signature: receivedResponse.payload.challengeResponse,
      });
      check("Counter-signature is valid", counterSigValid);
      check("Counter-signer is EverClaw", counterSigValid && receivedResponse.payload.result.walletAddress === everclawAddr);
      check("Response status is SUCCESS", receivedResponse.payload.status === "SUCCESS");
    }
  }

  // Summary
  console.log("\n=== Test Summary ===");
  console.log(`  Addresses:`);
  console.log(`    MorpheusAI: ${morpheusAddr}`);
  console.log(`    EverClaw:   ${everclawAddr}`);
  console.log(`  Protocol: V${PROTOCOL_VERSION}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`  Verdict: ${failed === 0 ? "✅ ALL PASS" : "❌ FAILURES DETECTED"}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
