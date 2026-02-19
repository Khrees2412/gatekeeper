import * as anchor from "@coral-xyz/anchor";
import * as http from "http";
import { URL } from "url";
import {
  apiKeyPda,
  classifyConsumeError,
  getProgram,
  getProvider,
  loadEnvFile,
  parsePubkey,
  parseU64,
} from "./shared";

const ROUTE_SCOPE_BY_METHOD_PATH: Record<string, anchor.BN> = {
  "GET /read": parseU64("1", "READ"),
  "POST /write": parseU64("2", "WRITE"),
};

function json(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function main() {
  loadEnvFile();
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = getProgram(provider);
  const port = Number(process.env.GATEKEEPER_ADAPTER_PORT ?? "8080");

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const routeKey = `${method} ${url.pathname}`;
    const requiredScope = ROUTE_SCOPE_BY_METHOD_PATH[routeKey];

    if (!requiredScope) {
      json(res, 404, { error: "route_not_found" });
      return;
    }

    const ownerParam = url.searchParams.get("owner");
    if (!ownerParam) {
      json(res, 400, { error: "owner_query_param_required" });
      return;
    }

    let owner;
    try {
      owner = parsePubkey(ownerParam, "owner");
    } catch {
      json(res, 400, { error: "invalid_owner_pubkey" });
      return;
    }

    const apiKey = apiKeyPda(program.programId, owner);

    let keyAccount: any;
    try {
      keyAccount = await program.account.apiKey.fetch(apiKey);
    } catch {
      json(res, 401, { allowed: false, reason: "invalid_key" });
      return;
    }

    try {
      const signature = await program.methods
        .consume(requiredScope)
        .accountsPartial({
          apiKey,
          usagePlan: keyAccount.plan,
          role: keyAccount.role,
        })
        .rpc();

      json(res, 200, {
        allowed: true,
        signature,
      });
    } catch (error) {
      const classified = classifyConsumeError(error);
      json(res, classified.status, {
        allowed: false,
        reason: classified.reason,
        code: classified.code,
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Gatekeeper adapter listening on http://127.0.0.1:${port}`);
    console.log("Routes:");
    console.log("  GET  /read?owner=<pubkey>   -> READ scope");
    console.log("  POST /write?owner=<pubkey>  -> WRITE scope");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
