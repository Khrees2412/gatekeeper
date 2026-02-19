import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import gatekeeperIdl from "../target/idl/gatekeeper.json";
import { Gatekeeper } from "../target/types/gatekeeper";

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const PLAN_SEED = Buffer.from("plan");
const ROLE_SEED = Buffer.from("role");
const KEY_SEED = Buffer.from("key");

type ConsumeClassification = {
  allowed: boolean;
  status: number;
  reason: string;
  code?: string;
};

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator === -1) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function loadEnvFile(filename = ".env"): void {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const body = fs.readFileSync(filePath, "utf8");
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function parsePubkey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} must be a valid public key`);
  }
}

export function parseU64(value: string, label: string): anchor.BN {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return new anchor.BN(value, 10);
}

function readWalletFromFile(walletPath: string): Keypair {
  const raw = fs.readFileSync(walletPath, "utf8");
  const bytes = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function getProvider(): anchor.AnchorProvider {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const walletPath = expandHome(
    process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json"
  );
  const keypair = readWalletFromFile(walletPath);
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getProgram(
  provider: anchor.AnchorProvider
): Program<Gatekeeper> {
  const configured = process.env.GATEKEEPER_PROGRAM_ID;
  const programId = configured
    ? new PublicKey(configured)
    : new PublicKey((gatekeeperIdl as any).address);

  const idl = {
    ...(gatekeeperIdl as any),
    address: programId.toBase58(),
  };

  return new Program(
    idl as Idl,
    provider
  ) as Program<Gatekeeper>;
}

export function globalStatePda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId)[0];
}

export function planPda(programId: PublicKey, planId: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PLAN_SEED, planId.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

export function rolePda(programId: PublicKey, roleId: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, roleId.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

export function apiKeyPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([KEY_SEED, owner.toBuffer()], programId)[0];
}

export function extractErrorCode(error: unknown): string | undefined {
  const e = error as any;
  return e?.error?.errorCode?.code ?? e?.errorCode?.code ?? undefined;
}

export function classifyConsumeError(error: unknown): ConsumeClassification {
  const code = extractErrorCode(error);
  if (code === "RateLimitExceeded") {
    return {
      allowed: false,
      status: 429,
      reason: "rate limit exceeded",
      code,
    };
  }

  if (code === "InsufficientScopes" || code === "PlanInactive") {
    return {
      allowed: false,
      status: 403,
      reason: code === "PlanInactive" ? "plan inactive" : "insufficient scopes",
      code,
    };
  }

  if (code === "KeyRevoked" || code === "InvalidPlanOrRole") {
    return {
      allowed: false,
      status: 401,
      reason: code === "KeyRevoked" ? "key revoked" : "invalid key",
      code,
    };
  }

  return {
    allowed: false,
    status: 500,
    reason: "internal error",
    code,
  };
}

export function clusterName(): string {
  return process.env.GATEKEEPER_CLUSTER ?? "localnet";
}

export function explorerTxUrl(signature: string): string {
  const cluster = clusterName();
  if (cluster === "mainnet-beta") {
    return `https://explorer.solana.com/tx/${signature}`;
  }
  if (cluster === "localnet") {
    const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://localhost:8899";
    return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function fail(message: string): never {
  throw new Error(message);
}
