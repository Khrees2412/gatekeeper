import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  apiKeyPda,
  classifyConsumeError,
  explorerTxUrl,
  getProgram,
  getProvider,
  globalStatePda,
  loadEnvFile,
  parsePubkey,
  parseU64,
  planPda,
  rolePda,
} from "./shared";

function usage(): string {
  return [
    "Usage:",
    "  cli init",
    "  cli create-plan --plan-id <u64> --window <u64> --max <u64> [--inactive]",
    "  cli toggle-plan --plan-id <u64>",
    "  cli upsert-role --role-id <u64> --scopes <u64> --name <text>",
    "  cli issue-key --owner <pubkey> --plan-id <u64> --role-id <u64>",
    "  cli consume --owner <pubkey> --required-scopes <u64>",
    "  cli revoke-key --owner <pubkey>",
  ].join("\n");
}

function getFlag(args: string[], flag: string, required = true): string {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    if (required) {
      throw new Error(`Missing required flag ${flag}`);
    }
    return "";
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  loadEnvFile();
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = getProgram(provider);
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  const globalState = globalStatePda(program.programId);

  if (!command) {
    console.error(usage());
    process.exit(1);
  }

  if (command === "init") {
    const signature = await program.methods
      .initialize()
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`GlobalState: ${globalState.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  if (command === "create-plan") {
    const planId = parseU64(getFlag(rest, "--plan-id"), "--plan-id");
    const windowSeconds = parseU64(getFlag(rest, "--window"), "--window");
    const maxPerWindow = parseU64(getFlag(rest, "--max"), "--max");
    const isActive = !hasFlag(rest, "--inactive");
    const usagePlan = planPda(program.programId, planId);

    const signature = await program.methods
      .createPlan(planId, windowSeconds, maxPerWindow, isActive)
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        usagePlan,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Plan: ${usagePlan.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  if (command === "toggle-plan") {
    const planId = parseU64(getFlag(rest, "--plan-id"), "--plan-id");
    const usagePlan = planPda(program.programId, planId);

    const signature = await program.methods
      .togglePlan(planId)
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        usagePlan,
      })
      .rpc();

    console.log(`Plan: ${usagePlan.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  if (command === "upsert-role") {
    const roleId = parseU64(getFlag(rest, "--role-id"), "--role-id");
    const scopes = parseU64(getFlag(rest, "--scopes"), "--scopes");
    const name = getFlag(rest, "--name");
    const role = rolePda(program.programId, roleId);

    const signature = await program.methods
      .upsertRole(roleId, name, scopes)
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        role,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Role: ${role.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  if (command === "issue-key") {
    const owner = parsePubkey(getFlag(rest, "--owner"), "--owner");
    const planId = parseU64(getFlag(rest, "--plan-id"), "--plan-id");
    const roleId = parseU64(getFlag(rest, "--role-id"), "--role-id");
    const usagePlan = planPda(program.programId, planId);
    const role = rolePda(program.programId, roleId);
    const apiKey = apiKeyPda(program.programId, owner);

    const signature = await program.methods
      .issueKey(owner, planId, roleId)
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        usagePlan,
        role,
        apiKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`ApiKey: ${apiKey.toBase58()}`);
    console.log(`Plan: ${usagePlan.toBase58()}`);
    console.log(`Role: ${role.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  if (command === "consume") {
    const owner = parsePubkey(getFlag(rest, "--owner"), "--owner");
    const requiredScopes = parseU64(
      getFlag(rest, "--required-scopes"),
      "--required-scopes"
    );
    const apiKey = apiKeyPda(program.programId, owner);

    let keyAccount: any;
    try {
      keyAccount = await program.account.apiKey.fetch(apiKey);
    } catch {
      console.log(`DENY invalid key (401): ${apiKey.toBase58()}`);
      process.exitCode = 1;
      return;
    }

    try {
      const signature = await program.methods
        .consume(requiredScopes)
        .accountsPartial({
          apiKey,
          usagePlan: keyAccount.plan,
          role: keyAccount.role,
        })
        .rpc();

      console.log(`ALLOW: ${apiKey.toBase58()}`);
      console.log(`Signature: ${signature}`);
      console.log(`Explorer: ${explorerTxUrl(signature)}`);
    } catch (error) {
      const classified = classifyConsumeError(error);
      console.log(
        `DENY ${classified.reason} (${classified.status})${
          classified.code ? ` [${classified.code}]` : ""
        }`
      );
      process.exitCode = 1;
    }
    return;
  }

  if (command === "revoke-key") {
    const owner = parsePubkey(getFlag(rest, "--owner"), "--owner");
    const apiKey = apiKeyPda(program.programId, owner);
    const signature = await program.methods
      .revokeKey(owner)
      .accountsPartial({
        authority: provider.wallet.publicKey,
        globalState,
        apiKey,
      })
      .rpc();

    console.log(`ApiKey: ${apiKey.toBase58()}`);
    console.log(`Signature: ${signature}`);
    console.log(`Explorer: ${explorerTxUrl(signature)}`);
    return;
  }

  console.error(usage());
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
