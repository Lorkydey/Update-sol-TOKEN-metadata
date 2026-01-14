import "dotenv/config";
import bs58 from "bs58";
import { Transaction, PublicKey as Web3PublicKey } from "@solana/web3.js";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import {
  mplTokenMetadata,
  fetchMetadata,
  findMetadataPda,
  updateMetadataAccountV2,
} from "@metaplex-foundation/mpl-token-metadata";

// ===== ENV =====
const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const MINT_STR = process.env.MINT;
const UPDATE_AUTHORITY_STR = process.env.UPDATE_AUTHORITY;
const NEW_URI = process.env.NEW_URI;

const NEW_NAME = process.env.NEW_NAME;     // optionnel
const NEW_SYMBOL = process.env.NEW_SYMBOL; // optionnel

if (!MINT_STR) throw new Error("Missing MINT in .env");
if (!UPDATE_AUTHORITY_STR) throw new Error("Missing UPDATE_AUTHORITY in .env");
if (!NEW_URI) throw new Error("Missing NEW_URI in .env");

// Pour la TX web3 (Squads)
const UPDATE_AUTHORITY_WEB3 = new Web3PublicKey(UPDATE_AUTHORITY_STR);

// ===== UMI setup =====
const umi = createUmi(RPC_URL).use(mplTokenMetadata());

const mintUmi = publicKey(MINT_STR);
const updateAuthUmi = publicKey(UPDATE_AUTHORITY_STR);

// Metadata PDA
const metadataPda = findMetadataPda(umi, { mint: mintUmi });

// Fetch + decode metadata existante
const md = await fetchMetadata(umi, metadataPda);

console.log("Metadata PDA:", metadataPda[0].toString());
console.log("On-chain Update Authority:", md.updateAuthority.toString());
console.log("Env Update Authority:", updateAuthUmi.toString());
console.log("isMutable:", md.isMutable);
console.log("Old URI:", md.uri);
console.log("New URI:", NEW_URI);

if (md.updateAuthority.toString() !== updateAuthUmi.toString()) {
  console.log("\n⚠️ UPDATE_AUTHORITY ne match pas on-chain.");
  console.log("➡️ Mets EXACTEMENT l'adresse 'On-chain Update Authority' dans UPDATE_AUTHORITY sinon Squads va fail.\n");
}

if (md.isMutable === false) {
  throw new Error("Metadata isMutable=false : tu ne peux plus modifier la metadata.");
}

// Reconstruit DataV2 (SAFE) + change URI (et name/symbol si fournis)
const data = {
  name: NEW_NAME ?? md.name,
  symbol: NEW_SYMBOL ?? md.symbol,
  uri: NEW_URI,
  sellerFeeBasisPoints: md.sellerFeeBasisPoints,
  creators: md.creators,
  collection: md.collection,
  uses: md.uses,
};

// Build instruction(s)
const builder = updateMetadataAccountV2(umi, {
  metadata: metadataPda,
  updateAuthority: updateAuthUmi,
  data,
  newUpdateAuthority: null,
  primarySaleHappened: md.primarySaleHappened,
  isMutable: md.isMutable,
});

// Récup instructions UMI (compat multi versions)
let umiInstructions = [];
if (typeof builder.getInstructions === "function") {
  umiInstructions = builder.getInstructions();
} else if (Array.isArray(builder.items)) {
  umiInstructions = builder.items.map((it) => it.instruction).filter(Boolean);
} else {
  throw new Error("Impossible d'extraire les instructions du builder (version mismatch).");
}

// Convert UMI instructions -> web3 tx (import Squads)
const web3Ixs = umiInstructions.map((ix) => ({
  programId: new Web3PublicKey(ix.programId.toString()),
  keys: ix.keys.map((k) => ({
    pubkey: new Web3PublicKey(k.pubkey.toString()),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  })),
  data: Buffer.from(ix.data),
}));

const tx = new Transaction();
for (const ix of web3Ixs) tx.add(ix);

// Dummy fields (Squads remplace)
tx.recentBlockhash = Web3PublicKey.default.toBase58();
tx.feePayer = UPDATE_AUTHORITY_WEB3;

const serialized = tx.serialize({
  requireAllSignatures: false,
  verifySignatures: false,
});

console.log("\n=== BASE58 TX (à importer dans Squads) ===");
console.log(bs58.encode(serialized));
console.log("=========================================");
