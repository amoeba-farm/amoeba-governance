import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {PublicKey, Transaction} from "@solana/web3.js";
import {DEFAULT_TIMING_V3, DEVNET_SPREAD_V3, MAINNET_ORACLE_V3, MAINNET_FUTURES_V3, MAINNET_TARGET_BUILD_IMAGE_V3, MAINNET_FUTURES_BUILD_IMAGE_V3, deriveAuthorityV3, deriveConfigV3, deriveProgramdataV3, deriveTargetAuthorityV3, deriveVerificationMetadataV3, encodeActionV3, publishVerificationV3, verificationParamsV3, type ConfigV3, type ProposalV3} from "./governanceV3.js";
const controller = new PublicKey(Buffer.alloc(32,31));
const key=(n:number)=>new PublicKey(Buffer.alloc(32,n));
const config:ConfigV3={bump:deriveConfigV3(controller)[1],controller,programdata:deriveProgramdataV3(controller),authority:deriveAuthorityV3(controller)[0],treasury:key(32),seats:[40,41,42,43,44].map(key),councilEpoch:1n,timingVersion:1n,timing:DEFAULT_TIMING_V3,nextId:2n};
function proposal(target:PublicKey):ProposalV3 {return {bump:0,config:deriveConfigV3(controller)[0],id:1n,councilEpoch:1n,timingVersion:1n,timing:DEFAULT_TIMING_V3,created:100n,reviewEnd:1512100n,notBefore:4600n,expires:2592100n,action:{kind:"publishVerification",target,deployedSlot:123n,commit:"ab".repeat(20)},digest:Buffer.alloc(32,42),approvals:7,approvalCount:3,cancellations:0,cancellationCount:0,state:0,verifiedChunks:Buffer.alloc(16),verifiedCount:0,extensionSlot:0n,extendedCapacity:0n,executedSlot:0n};}
test("fixed verification action wire; rejects malformed commits and targets",()=>{
 const p=proposal(controller);assert.equal(encodeActionV3(p.action).toString("hex"),"06"+"1f".repeat(32)+"7b00000000000000"+"ab".repeat(20)+"00".repeat(132));
 for(const commit of ["", "00".repeat(20), "AB".repeat(20), "ab".repeat(21), "not a sha"]){assert.throws(()=>encodeActionV3({kind:"publishVerification",target:controller,deployedSlot:123n,commit}));}
 assert.throws(()=>verificationParamsV3(controller,{kind:"publishVerification",target:key(99),deployedSlot:123n,commit:"ab".repeat(20)}));
});

test("official oracle and futures recipes retain sibling sources and target PDA authorization",()=>{
 for(const [target,workspace,library] of [[MAINNET_ORACLE_V3,"oracle","ameba_oracle"],[MAINNET_FUTURES_V3,"futures","ameba_futures"]] as const){
  const p=proposal(target);assert(p.action.kind==="publishVerification");
  const bytes=verificationParamsV3(controller,p.action);let offset=0;
  const string=()=>{const n=bytes.readUInt32LE(offset);offset+=4;const value=bytes.subarray(offset,offset+n).toString();offset+=n;return value;};
  assert.equal(string(),"0.5.2");assert.equal(string(),"https://github.com/amoeba-farm/amoeba-program");assert.equal(string(),"ab".repeat(20));
  const n=bytes.readUInt32LE(offset);offset+=4;const args=Array.from({length:n},string);
  assert.deepEqual(args,["--workspace-path",workspace,"--library-name",library,"--base-image",target.equals(MAINNET_FUTURES_V3)?MAINNET_FUTURES_BUILD_IMAGE_V3:MAINNET_TARGET_BUILD_IMAGE_V3,"--arch","v1","--cargo-build-sbf-args","--tools-version v1.53"]);
  assert.equal(bytes.readBigUInt64LE(offset),123n);assert.equal(offset+8,bytes.length);assert(bytes.length<=640);
  const ix=publishVerificationV3(config,p,key(50));const authority=deriveTargetAuthorityV3(controller,target)[0];
  assert.equal(ix.keys.length,11);assert(ix.keys[5]!.pubkey.equals(authority));assert.equal(ix.keys[5]!.isSigner,false);
  assert(ix.keys[6]!.pubkey.equals(deriveVerificationMetadataV3(authority,target)[0]));
  assert.equal(ix.keys.filter(k=>k.isSigner).length,1);assert(ix.keys[0]!.pubkey.equals(key(50)));
  const tx=new Transaction({feePayer:key(50),recentBlockhash:PublicKey.default.toBase58()}).add(ix);
  assert(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<=1232);
 }
});
test("pinned public recipes and instruction accounts stay bounded",()=>{
 for(const target of [controller,DEVNET_SPREAD_V3]){
  const p=proposal(target);assert(p.action.kind==="publishVerification");const bytes=verificationParamsV3(controller,p.action);
  assert.equal(bytes.length,target.equals(controller)?311:434);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),target.equals(controller)?"e623ee1b4b62a0c9b03ec5b8c815a253975587ce60cde6ebad43f3da3488d167":"c7a8fbcd45c237e911d6f4b7297b3b1317b8cb34823f5d910bb8cc35a0d2d9cc");
  let offset=0;const string=()=>{const size=bytes.readUInt32LE(offset);offset+=4;const s=bytes.subarray(offset,offset+size).toString();offset+=size;return s;};
  assert.equal(string(),"0.5.1");assert.equal(string(),`https://github.com/amoeba-farm/${target.equals(controller)?"amoeba-governance":"amoeba-program"}`);assert.equal(string(),"ab".repeat(20));
  const count=bytes.readUInt32LE(offset);offset+=4;const args=Array.from({length:count},string);assert(!args.includes("--locked"));assert(args.includes("v1"));assert.equal(bytes.readBigUInt64LE(offset),123n);assert.equal(offset+8,bytes.length);assert(bytes.length<=640);
  if(!target.equals(controller)){
   assert.deepEqual(args.slice(-3),["--","--features","mainnet-v3"]);
   assert(!args.includes("--no-default-features"));
   assert(!args.some(arg=>arg.includes("devnet-solo-backfill-2026")));
  }
  const ix=publishVerificationV3(config,p,key(50));assert.equal(ix.data.toString("hex"),"10"+"2a".repeat(32));
  const authority=target.equals(controller)?config.authority:deriveTargetAuthorityV3(controller,target)[0];
  assert(ix.keys[5]!.pubkey.equals(authority));assert(ix.keys[6]!.pubkey.equals(deriveVerificationMetadataV3(authority,target)[0]));assert.equal(ix.keys[5]!.isSigner,false);
  assert.equal(ix.keys.length,target.equals(controller)?10:11);
  const tx=new Transaction({feePayer:key(50),recentBlockhash:PublicKey.default.toBase58()}).add(ix);assert(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<=1232);
 }
});
