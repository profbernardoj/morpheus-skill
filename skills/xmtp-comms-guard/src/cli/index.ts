#!/usr/bin/env ts-node
import { program } from "commander";
import { storage } from "../storage/bagmanStorage.js";
import { revocation } from "../revocation.js";
import { hashChain } from "../security/hashChain.js";

program
  .name("xmtp-guard")
  .description("XMTP V6 Trust Framework CLI")
  .version("6.0.0");

program
  .command("trust-list")
  .description("List all approved peers")
  .action(async () => {
    const peers = await storage.getAllPeers();
    console.table(peers.map((p: any) => ({ name: p.name, trust: p.trustLevel, profile: p.contextProfile })));
  });

program
  .command("audit <peer>")
  .description("Show audit log for a peer")
  .action(async (peer: string) => {
    const log = await storage.getAuditLogForPeer(peer);
    console.table(log);
  });

program
  .command("revoke <address> [reason]")
  .description("Security revoke a peer")
  .action(async (address: string, reason = "manual") => {
    await revocation.securityRevoke(address, reason);
    console.log(`✅ Security revocation complete for ${address}`);
  });

program
  .command("rotate-key <address>")
  .description("Handle key rotation for a peer")
  .action(async (address: string) => {
    await revocation.keyRotation(address);
  });

program
  .command("chain-verify")
  .description("Manually verify hash-chain integrity")
  .action(async () => {
    const result = await hashChain.verifyChain();
    console.log(result.valid ? "✅ Chain intact" : `❌ Chain broken at ${result.brokenAt}`);
  });

program.parse();
