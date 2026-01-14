/**
 * Production-ready script (ESM .mjs) to build a BASE58-encoded Solana transaction
 * that updates Metaplex Token Metadata (URI + optional name/symbol),
 * intended to be imported and executed by a multisig (e.g., Squads).
 *
 * ✅ Uses UMI to build the mpl-token-metadata instruction
 * ✅ Converts UMI instructions to @solana/web3.js Transaction
 * ✅ Outputs a BASE58 serialized tx (no signatures) for multisig import
 *
 * Install:
 *   npm i dotenv bs58 @solana/web3.js @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults @metaplex-foundation/mpl-token-metadata
 *
 * .env:
 *   RPC_URL=https://api.mainnet-beta.solana.com
 *   MINT=...
 *   UPDATE_AUTHORITY=...
 *   NEW_URI=...
 *   NEW_NAME=...        (optional)
 *   NEW_SYMBOL=...      (optional)
 * 
 *  To run: node update-metadata.mjs
 * 
 * made 1% by Lorkydey & 99% by VoidPrompt with gpt 5.2 models
 * always with love ofc <3
 */

import "dotenv/config";
import bs58 from "bs58";
import {
  Transaction,
  PublicKey as Web3PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import {
  mplTokenMetadata,
  fetchMetadata,
  findMetadataPda,
  updateMetadataAccountV2,
} from "@metaplex-foundation/mpl-token-metadata";

// -----------------------------
// Helpers
// -----------------------------
function mustEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing ${name} in .env`);
  return v.trim();
}

function optEnv(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function assertPublicKey(label, value) {
  try {
    // eslint-disable-next-line no-new
    new Web3PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana public key: ${value}`);
  }
}

function toWeb3Instruction(ix) {
  return new TransactionInstruction({
    programId: new Web3PublicKey(ix.programId.toString()),
    keys: ix.keys.map((k) => ({
      pubkey: new Web3PublicKey(k.pubkey.toString()),
      isSigner: Boolean(k.isSigner),
      isWritable: Boolean(k.isWritable),
    })),
    data: Buffer.from(ix.data),
  });
}

// -----------------------------
// Main
// -----------------------------
async function main() {
  // ===== ENV =====
  const RPC_URL =
    (process.env.RPC_URL && process.env.RPC_URL.trim()) ||
    "https://api.mainnet-beta.solana.com";

  const MINT_STR = mustEnv("MINT");
  const UPDATE_AUTHORITY_STR = mustEnv("UPDATE_AUTHORITY");
  const NEW_URI = mustEnv("NEW_URI");

  const NEW_NAME = optEnv("NEW_NAME");
  const NEW_SYMBOL = optEnv("NEW_SYMBOL");

  assertPublicKey("MINT", MINT_STR);
  assertPublicKey("UPDATE_AUTHORITY", UPDATE_AUTHORITY_STR);

  const updateAuthorityWeb3 = new Web3PublicKey(UPDATE_AUTHORITY_STR);

  // ===== UMI setup =====
  const umi = createUmi(RPC_URL).use(mplTokenMetadata());

  const mintUmi = publicKey(MINT_STR);
  const updateAuthUmi = publicKey(UPDATE_AUTHORITY_STR);

  // Metadata PDA
  const metadataPda = findMetadataPda(umi, { mint: mintUmi });

  // Fetch existing metadata
  const md = await fetchMetadata(umi, metadataPda);

  console.log("RPC URL:", RPC_URL);
  console.log("Mint:", MINT_STR);
  console.log("Metadata PDA:", metadataPda[0].toString());
  console.log("On-chain Update Authority:", md.updateAuthority.toString());
  console.log("Env Update Authority:", updateAuthUmi.toString());
  console.log("isMutable:", md.isMutable);
  console.log("Old URI:", md.uri);
  console.log("New URI:", NEW_URI);

  if (md.updateAuthority.toString() !== updateAuthUmi.toString()) {
    console.log("\n⚠️ WARNING: UPDATE_AUTHORITY does not match on-chain update authority.");
    console.log(
      "➡️ Use the EXACT 'On-chain Update Authority' address in UPDATE_AUTHORITY, otherwise your multisig will fail.\n",
    );
  }

  if (md.isMutable === false) {
    throw new Error("Metadata isMutable=false: metadata is frozen and cannot be updated.");
  }

  // Build DataV2 safely (preserve fields, update URI, optional name/symbol)
  const data = {
    name: NEW_NAME ?? md.name,
    symbol: NEW_SYMBOL ?? md.symbol,
    uri: NEW_URI,
    sellerFeeBasisPoints: md.sellerFeeBasisPoints,
    creators: md.creators,
    collection: md.collection,
    uses: md.uses,
  };

  // Build the instruction(s)
  const builder = updateMetadataAccountV2(umi, {
    metadata: metadataPda,
    updateAuthority: updateAuthUmi,
    data,
    newUpdateAuthority: null,
    primarySaleHappened: md.primarySaleHappened,
    isMutable: md.isMutable,
  });

  // Extract UMI instructions (compat across versions)
  let umiInstructions = [];
  if (typeof builder.getInstructions === "function") {
    umiInstructions = builder.getInstructions();
  } else if (Array.isArray(builder.items)) {
    umiInstructions = builder.items
      .map((it) => it && it.instruction)
      .filter(Boolean);
  } else {
    throw new Error("Unable to extract instructions from builder (version mismatch).");
  }

  if (!umiInstructions.length) {
    throw new Error("No instructions were produced. Nothing to serialize.");
  }

  // Convert to web3 Transaction
  const tx = new Transaction();
  for (const ix of umiInstructions) tx.add(toWeb3Instruction(ix));

  // Dummy fields (multisig replaces these)
  tx.recentBlockhash = Web3PublicKey.default.toBase58();
  tx.feePayer = updateAuthorityWeb3;

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  const base58Tx = bs58.encode(serialized);

  console.log("\n=== BASE58 TX (import into Squads) ===");
  console.log(base58Tx);
  console.log("=====================================\n");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err?.message ?? err);
  process.exit(1);
});
