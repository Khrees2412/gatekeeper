import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Gatekeeper } from "../target/types/gatekeeper";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

const GLOBAL_STATE_SEED = Buffer.from("global_state");
const PLAN_SEED = Buffer.from("plan");
const ROLE_SEED = Buffer.from("role");
const KEY_SEED = Buffer.from("key");

const KEY_STATUS_ACTIVE = 0;
const KEY_STATUS_REVOKED = 1;
const GLOBAL_STATE_SPACE = 8 + 32 + 1;
const USAGE_PLAN_SPACE = 8 + 8 + 8 + 8 + 1;
const ROLE_SPACE = 8 + 8 + 32 + 8;
const API_KEY_SPACE = 8 + 32 + 32 + 32 + 1 + 8 + 8 + 8;

const SCOPE_READ = new anchor.BN(1);
const SCOPE_WRITE = new anchor.BN(2);

describe("gatekeeper", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.gatekeeper as Program<Gatekeeper>;
  const authority = (provider.wallet as anchor.Wallet).publicKey;
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [GLOBAL_STATE_SEED],
    program.programId
  );

  let outsider: Keypair;
  let nextPlanId = 1_000;
  let nextRoleId = 2_000;

  const bn = (n: number): anchor.BN => new anchor.BN(n);
  const nextPlan = (): anchor.BN => bn(nextPlanId++);
  const nextRole = (): anchor.BN => bn(nextRoleId++);

  const planPda = (planId: anchor.BN): PublicKey =>
    PublicKey.findProgramAddressSync(
      [PLAN_SEED, planId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const rolePda = (roleId: anchor.BN): PublicKey =>
    PublicKey.findProgramAddressSync(
      [ROLE_SEED, roleId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const apiKeyPda = (owner: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync([KEY_SEED, owner.toBuffer()], program.programId)[0];

  const sleep = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const decodeName = (raw: number[]): string =>
    Buffer.from(raw)
      .toString("utf8")
      .replace(/\0+$/g, "");

  const extractErrorText = (error: unknown): string => {
    const e = error as any;
    return (
      e?.error?.errorCode?.code ??
      e?.errorCode?.code ??
      e?.message ??
      String(error)
    );
  };

  const expectProgramError = async (promise: Promise<unknown>, code: string) => {
    try {
      await promise;
      expect.fail(`Expected error ${code}, but transaction succeeded`);
    } catch (error) {
      const text = extractErrorText(error).toLowerCase();
      expect(text).to.contain(code.toLowerCase());
    }
  };

  const expectFailure = async (promise: Promise<unknown>) => {
    try {
      await promise;
      expect.fail("Expected transaction to fail");
    } catch (_) {
      // Expected.
    }
  };

  const fund = async (recipient: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(
      recipient,
      2 * LAMPORTS_PER_SOL
    );
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: sig,
        ...latest,
      },
      "confirmed"
    );
  };

  const createPlan = async (
    planId: anchor.BN,
    windowSeconds: anchor.BN,
    maxPerWindow: anchor.BN,
    isActive: boolean
  ) => {
    const usagePlan = planPda(planId);
    await program.methods
      .createPlan(planId, windowSeconds, maxPerWindow, isActive)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        usagePlan,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return usagePlan;
  };

  const togglePlan = async (planId: anchor.BN) => {
    await program.methods
      .togglePlan(planId)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        usagePlan: planPda(planId),
      })
      .rpc();
  };

  const upsertRole = async (
    roleId: anchor.BN,
    name: string,
    scopesBitmask: anchor.BN
  ) => {
    const role = rolePda(roleId);
    await program.methods
      .upsertRole(roleId, name, scopesBitmask)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        role,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return role;
  };

  const issueKey = async (owner: PublicKey, planId: anchor.BN, roleId: anchor.BN) => {
    const usagePlan = planPda(planId);
    const role = rolePda(roleId);
    const apiKey = apiKeyPda(owner);

    await program.methods
      .issueKey(owner, planId, roleId)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        usagePlan,
        role,
        apiKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return apiKey;
  };

  const revokeKey = async (owner: PublicKey) => {
    await program.methods
      .revokeKey(owner)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        apiKey: apiKeyPda(owner),
      })
      .rpc();
  };

  const consume = async (
    owner: PublicKey,
    planId: anchor.BN,
    roleId: anchor.BN,
    requiredScopesMask: anchor.BN
  ) =>
    program.methods
      .consume(requiredScopesMask)
      .accountsPartial({
        apiKey: apiKeyPda(owner),
        usagePlan: planPda(planId),
        role: rolePda(roleId),
      })
      .rpc();

  before(async () => {
    outsider = Keypair.generate();
    await fund(outsider.publicKey);
  });

  it("GK-001/GK-002: initializes global state, PDA determinism, and account sizing", async () => {
    await program.methods
      .initialize(authority)
      .accountsPartial({
        authority,
        globalState: globalStatePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.globalState.fetch(globalStatePda);
    expect(state.authority.toBase58()).to.equal(authority.toBase58());

    const accountInfo = await provider.connection.getAccountInfo(globalStatePda);
    expect(accountInfo).to.not.equal(null);
    expect(accountInfo!.data.length).to.equal(GLOBAL_STATE_SPACE);

    const samplePlan = bn(42);
    const sampleRole = bn(7);
    const sampleOwner = Keypair.generate().publicKey;
    const derivedPlanA = planPda(samplePlan);
    const derivedPlanB = planPda(samplePlan);
    const derivedRoleA = rolePda(sampleRole);
    const derivedRoleB = rolePda(sampleRole);
    const derivedKeyA = apiKeyPda(sampleOwner);
    const derivedKeyB = apiKeyPda(sampleOwner);

    expect(derivedPlanA.toBase58()).to.equal(derivedPlanB.toBase58());
    expect(derivedRoleA.toBase58()).to.equal(derivedRoleB.toBase58());
    expect(derivedKeyA.toBase58()).to.equal(derivedKeyB.toBase58());

    await expectFailure(
      program.methods
        .initialize(authority)
        .accountsPartial({
          authority,
          globalState: globalStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );
  });

  it("GK-003/GK-003b: creates plan, enforces authority, and toggles active state", async () => {
    const planId = nextPlan();
    const usagePlan = await createPlan(planId, bn(60), bn(10), true);
    const fetched = await program.account.usagePlan.fetch(usagePlan);

    expect(fetched.planId.toString()).to.equal(planId.toString());
    expect(fetched.windowSeconds.toString()).to.equal("60");
    expect(fetched.maxPerWindow.toString()).to.equal("10");
    expect(fetched.isActive).to.equal(true);

    const planInfo = await provider.connection.getAccountInfo(usagePlan);
    expect(planInfo!.data.length).to.equal(USAGE_PLAN_SPACE);

    const outsiderPlan = nextPlan();
    await expectProgramError(
      program.methods
        .createPlan(outsiderPlan, bn(60), bn(10), true)
        .accountsPartial({
          authority: outsider.publicKey,
          globalState: globalStatePda,
          usagePlan: planPda(outsiderPlan),
          systemProgram: SystemProgram.programId,
        })
        .signers([outsider])
        .rpc(),
      "Unauthorized"
    );

    await togglePlan(planId);
    expect((await program.account.usagePlan.fetch(usagePlan)).isActive).to.equal(false);
    await togglePlan(planId);
    expect((await program.account.usagePlan.fetch(usagePlan)).isActive).to.equal(true);

    await expectProgramError(
      program.methods
        .togglePlan(planId)
        .accountsPartial({
          authority: outsider.publicKey,
          globalState: globalStatePda,
          usagePlan,
        })
        .signers([outsider])
        .rpc(),
      "Unauthorized"
    );
  });

  it("GK-004: upserts role and enforces authority", async () => {
    const roleId = nextRole();
    const role = await upsertRole(roleId, "reader", SCOPE_READ);
    const created = await program.account.role.fetch(role);

    expect(created.roleId.toString()).to.equal(roleId.toString());
    expect(created.scopesBitmask.toString()).to.equal(SCOPE_READ.toString());
    expect(decodeName(created.name)).to.equal("reader");

    const roleInfo = await provider.connection.getAccountInfo(role);
    expect(roleInfo!.data.length).to.equal(ROLE_SPACE);

    await upsertRole(roleId, "writer", SCOPE_WRITE);
    const updated = await program.account.role.fetch(role);
    expect(updated.roleId.toString()).to.equal(roleId.toString());
    expect(updated.scopesBitmask.toString()).to.equal(SCOPE_WRITE.toString());
    expect(decodeName(updated.name)).to.equal("writer");

    const outsiderRole = nextRole();
    await expectProgramError(
      program.methods
        .upsertRole(outsiderRole, "bad", SCOPE_READ)
        .accountsPartial({
          authority: outsider.publicKey,
          globalState: globalStatePda,
          role: rolePda(outsiderRole),
          systemProgram: SystemProgram.programId,
        })
        .signers([outsider])
        .rpc(),
      "Unauthorized"
    );
  });

  it("GK-005: issues keys with deterministic plan/role checks", async () => {
    const planId = nextPlan();
    const roleId = nextRole();
    await createPlan(planId, bn(60), bn(10), true);
    await upsertRole(roleId, "issue", SCOPE_READ);

    const owner = Keypair.generate().publicKey;
    const apiKey = await issueKey(owner, planId, roleId);
    const keyAccount = await program.account.apiKey.fetch(apiKey);

    expect(keyAccount.owner.toBase58()).to.equal(owner.toBase58());
    expect(keyAccount.plan.toBase58()).to.equal(planPda(planId).toBase58());
    expect(keyAccount.role.toBase58()).to.equal(rolePda(roleId).toBase58());
    expect(keyAccount.status).to.equal(KEY_STATUS_ACTIVE);
    expect(keyAccount.windowStart.toString()).to.equal("0");
    expect(keyAccount.count.toString()).to.equal("0");

    const apiKeyInfo = await provider.connection.getAccountInfo(apiKey);
    expect(apiKeyInfo!.data.length).to.equal(API_KEY_SPACE);

    const wrongPlanId = nextPlan();
    await createPlan(wrongPlanId, bn(60), bn(10), true);
    const badOwner = Keypair.generate().publicKey;
    const badApiKey = apiKeyPda(badOwner);
    await expectProgramError(
      program.methods
        .issueKey(badOwner, planId, roleId)
        .accountsPartial({
          authority,
          globalState: globalStatePda,
          usagePlan: planPda(wrongPlanId),
          role: rolePda(roleId),
          apiKey: badApiKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      "InvalidPlanOrRole"
    );

    await expectFailure(
      program.methods
        .issueKey(owner, planId, roleId)
        .accountsPartial({
          authority,
          globalState: globalStatePda,
          usagePlan: planPda(planId),
          role: rolePda(roleId),
          apiKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );
  });

  it("GK-006: revokes keys and enforces authority", async () => {
    const planId = nextPlan();
    const roleId = nextRole();
    await createPlan(planId, bn(60), bn(10), true);
    await upsertRole(roleId, "revoker", SCOPE_READ);

    const owner = Keypair.generate().publicKey;
    const apiKey = await issueKey(owner, planId, roleId);
    await revokeKey(owner);

    const revoked = await program.account.apiKey.fetch(apiKey);
    expect(revoked.status).to.equal(KEY_STATUS_REVOKED);

    await expectProgramError(
      program.methods
        .revokeKey(owner)
        .accountsPartial({
          authority: outsider.publicKey,
          globalState: globalStatePda,
          apiKey,
        })
        .signers([outsider])
        .rpc(),
      "Unauthorized"
    );
  });

  it("GK-007: consume guard checks (revoked, inactive plan, invalid plan/role)", async () => {
    const revokedPlanId = nextPlan();
    const revokedRoleId = nextRole();
    await createPlan(revokedPlanId, bn(60), bn(10), true);
    await upsertRole(revokedRoleId, "consume-revoked", SCOPE_READ);
    const revokedOwner = Keypair.generate().publicKey;
    await issueKey(revokedOwner, revokedPlanId, revokedRoleId);
    await revokeKey(revokedOwner);
    await expectProgramError(
      consume(revokedOwner, revokedPlanId, revokedRoleId, SCOPE_READ),
      "KeyRevoked"
    );

    const inactivePlanId = nextPlan();
    const inactiveRoleId = nextRole();
    await createPlan(inactivePlanId, bn(60), bn(10), false);
    await upsertRole(inactiveRoleId, "consume-inactive", SCOPE_READ);
    const inactiveOwner = Keypair.generate().publicKey;
    await issueKey(inactiveOwner, inactivePlanId, inactiveRoleId);
    await expectProgramError(
      consume(inactiveOwner, inactivePlanId, inactiveRoleId, SCOPE_READ),
      "PlanInactive"
    );

    const validPlanId = nextPlan();
    const otherPlanId = nextPlan();
    const validRoleId = nextRole();
    await createPlan(validPlanId, bn(60), bn(10), true);
    await createPlan(otherPlanId, bn(60), bn(10), true);
    await upsertRole(validRoleId, "consume-valid", SCOPE_READ);
    const owner = Keypair.generate().publicKey;
    await issueKey(owner, validPlanId, validRoleId);
    await expectProgramError(
      program.methods
        .consume(SCOPE_READ)
        .accountsPartial({
          apiKey: apiKeyPda(owner),
          usagePlan: planPda(otherPlanId),
          role: rolePda(validRoleId),
        })
        .rpc(),
      "InvalidPlanOrRole"
    );
  });

  it("GK-008: consume scope authorization", async () => {
    const planId = nextPlan();
    const roleId = nextRole();
    await createPlan(planId, bn(60), bn(10), true);
    await upsertRole(roleId, "reader", SCOPE_READ);

    const owner = Keypair.generate().publicKey;
    await issueKey(owner, planId, roleId);

    await consume(owner, planId, roleId, SCOPE_READ);
    const afterAllowed = await program.account.apiKey.fetch(apiKeyPda(owner));
    expect(afterAllowed.count.toString()).to.equal("1");

    await expectProgramError(
      consume(owner, planId, roleId, SCOPE_WRITE),
      "InsufficientScopes"
    );
  });

  it("GK-009: consume fixed-window rate limiting", async () => {
    const planId = nextPlan();
    const roleId = nextRole();
    await createPlan(planId, bn(3), bn(2), true);
    await upsertRole(roleId, "limited", SCOPE_READ);

    const owner = Keypair.generate().publicKey;
    await issueKey(owner, planId, roleId);

    await consume(owner, planId, roleId, SCOPE_READ);
    await consume(owner, planId, roleId, SCOPE_READ);
    await expectProgramError(
      consume(owner, planId, roleId, SCOPE_READ),
      "RateLimitExceeded"
    );

    const beforeReset = await program.account.apiKey.fetch(apiKeyPda(owner));
    expect(beforeReset.count.toString()).to.equal("2");

    await sleep(4_000);
    await consume(owner, planId, roleId, SCOPE_READ);

    const afterReset = await program.account.apiKey.fetch(apiKeyPda(owner));
    expect(afterReset.count.toString()).to.equal("1");
    expect(afterReset.windowStart.toNumber()).to.be.gte(beforeReset.windowStart.toNumber());
  });

  it("GK-010: IDL exposes named custom errors", async () => {
    const idlErrors = ((program.idl as any).errors ?? []).map((e: any) =>
      String(e.name).toLowerCase()
    );
    expect(idlErrors).to.include.members([
      "unauthorized",
      "keyrevoked",
      "planinactive",
      "insufficientscopes",
      "ratelimitexceeded",
      "invalidplanorrole",
    ]);
  });
});
