import {
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";

export const U8_MAX = 0xff;
export const U16_MAX = 0xffff;
export const U32_MAX = 0xffff_ffff;
export const U64_MAX = 0xffff_ffff_ffff_ffffn;
export const MAX_RELEASE1_INSTRUCTION_DATA_LEN = 16_384;
export const MAX_CEREMONY_COMPUTE_UNIT_LIMIT_V1 = 1_400_000;
export const MAX_CEREMONY_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1 = 10_000_000n;

export function integer(value: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} is outside its fixed unsigned range`);
  }
  return value;
}

export function u64Value(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    throw new RangeError(`${field} must be a u64`);
  }
  return value;
}

export function exactBytes(value: Buffer, length: number, field: string): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== length) {
    throw new RangeError(`${field} must be exactly ${length} bytes`);
  }
  return value;
}

export function nonzeroHash(value: Buffer, field: string): Buffer {
  exactBytes(value, 32, field);
  if (value.equals(Buffer.alloc(32))) throw new Error(`${field} must be nonzero`);
  return value;
}

export function exactKey(value: PublicKey, field: string): PublicKey {
  if (!(value instanceof PublicKey)) throw new TypeError(`${field} must be a PublicKey`);
  return value;
}

export function nondefaultKey(value: PublicKey, field: string): PublicKey {
  exactKey(value, field);
  if (value.equals(PublicKey.default)) throw new Error(`${field} must be nondefault`);
  return value;
}

export function enumByte<T extends number>(value: number, values: readonly number[], field: string): T {
  integer(value, U8_MAX, field);
  if (!values.includes(value)) throw new RangeError(`${field} has an unknown discriminant`);
  return value as T;
}

export class FixedWriter {
  private readonly parts: Buffer[] = [];

  byte(value: number, field: string): this {
    this.parts.push(Buffer.from([integer(value, U8_MAX, field)]));
    return this;
  }

  u16(value: number, field: string): this {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(integer(value, U16_MAX, field));
    this.parts.push(out);
    return this;
  }

  u32(value: number, field: string): this {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(integer(value, U32_MAX, field));
    this.parts.push(out);
    return this;
  }

  u64(value: bigint, field: string): this {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(u64Value(value, field));
    this.parts.push(out);
    return this;
  }

  bytes(value: Buffer, length: number, field: string): this {
    this.parts.push(Buffer.from(exactBytes(value, length, field)));
    return this;
  }

  key(value: PublicKey, field: string): this {
    this.parts.push(exactKey(value, field).toBuffer());
    return this;
  }

  finish(expectedLength: number): Buffer {
    const data = Buffer.concat(this.parts);
    if (data.length !== expectedLength || data.length > MAX_RELEASE1_INSTRUCTION_DATA_LEN) {
      throw new Error(`internal fixed codec length ${data.length} != ${expectedLength}`);
    }
    return data;
  }
}

export class FixedReader {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  bytes(length: number): Buffer {
    const end = this.offset + length;
    if (end > this.data.length) throw new Error("truncated fixed instruction");
    const value = Buffer.from(this.data.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  byte(): number { return this.bytes(1)[0]!; }
  u16(): number { return this.bytes(2).readUInt16LE(); }
  u32(): number { return this.bytes(4).readUInt32LE(); }
  u64(): bigint { return this.bytes(8).readBigUInt64LE(); }
  key(): PublicKey { return new PublicKey(this.bytes(32)); }

  finish(): void {
    if (this.offset !== this.data.length) throw new Error("trailing fixed instruction bytes");
  }
}

export function encodeFixed(
  tag: number,
  length: number,
  write: (writer: FixedWriter) => void,
): Buffer {
  const writer = new FixedWriter().byte(tag, "tag");
  write(writer);
  return writer.finish(length);
}

export function decodeFixed<T>(
  data: Buffer,
  tag: number,
  length: number,
  read: (reader: FixedReader) => T,
  validate: (value: T) => void,
): T {
  if (!Buffer.isBuffer(data) || data.length !== length || data[0] !== tag || data.length > MAX_RELEASE1_INSTRUCTION_DATA_LEN) {
    throw new Error("invalid fixed instruction tag or length");
  }
  const reader = new FixedReader(data.subarray(1));
  const value = read(reader);
  reader.finish();
  validate(value);
  return value;
}

export interface OptionalPublicKeyV1 {
  present: boolean;
  value: PublicKey;
}

export function writeOptionalKey(writer: FixedWriter, value: OptionalPublicKeyV1, field: string): void {
  if (typeof value !== "object" || value === null) throw new TypeError(`${field} must be an optional key`);
  if (value.present) nondefaultKey(value.value, `${field}.value`);
  else if (!exactKey(value.value, `${field}.value`).equals(PublicKey.default)) throw new Error(`${field} absent value must be default`);
  writer.byte(value.present ? 1 : 0, `${field}.present`).key(value.value, `${field}.value`);
}

export function readOptionalKey(reader: FixedReader, field: string): OptionalPublicKeyV1 {
  const present = reader.byte();
  const value = reader.key();
  if (present === 0 && value.equals(PublicKey.default)) return { present: false, value };
  if (present === 1 && !value.equals(PublicKey.default)) return { present: true, value };
  throw new Error(`${field} is not canonical`);
}

export interface CeremonyEnvelopeV1 {
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
  durableNonceAccount: OptionalPublicKeyV1;
  durableNonceAuthority: OptionalPublicKeyV1;
}

export const CEREMONY_ENVELOPE_V1_LEN = 78;

export function validateCeremonyEnvelopeV1(value: CeremonyEnvelopeV1): void {
  integer(value.computeUnitLimit, MAX_CEREMONY_COMPUTE_UNIT_LIMIT_V1, "computeUnitLimit");
  if (value.computeUnitLimit === 0) throw new Error("computeUnitLimit must be nonzero");
  u64Value(value.computeUnitPriceMicroLamports, "computeUnitPriceMicroLamports");
  if (value.computeUnitPriceMicroLamports > MAX_CEREMONY_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1) {
    throw new Error("computeUnitPriceMicroLamports exceeds ceremony bound");
  }
  const probe = new FixedWriter();
  writeOptionalKey(probe, value.durableNonceAccount, "durableNonceAccount");
  writeOptionalKey(probe, value.durableNonceAuthority, "durableNonceAuthority");
  if (value.durableNonceAccount.present !== value.durableNonceAuthority.present) {
    throw new Error("durable nonce account and authority must be paired");
  }
}

export function writeCeremonyEnvelope(writer: FixedWriter, value: CeremonyEnvelopeV1): void {
  validateCeremonyEnvelopeV1(value);
  writer.u32(value.computeUnitLimit, "envelope.computeUnitLimit")
    .u64(value.computeUnitPriceMicroLamports, "envelope.computeUnitPriceMicroLamports");
  writeOptionalKey(writer, value.durableNonceAccount, "envelope.durableNonceAccount");
  writeOptionalKey(writer, value.durableNonceAuthority, "envelope.durableNonceAuthority");
}

export function readCeremonyEnvelope(reader: FixedReader): CeremonyEnvelopeV1 {
  const value = {
    computeUnitLimit: reader.u32(),
    computeUnitPriceMicroLamports: reader.u64(),
    durableNonceAccount: readOptionalKey(reader, "envelope.durableNonceAccount"),
    durableNonceAuthority: readOptionalKey(reader, "envelope.durableNonceAuthority"),
  };
  validateCeremonyEnvelopeV1(value);
  return value;
}

export const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey: exactKey(pubkey, "account"), isSigner: false, isWritable: false });
export const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey: exactKey(pubkey, "account"), isSigner: false, isWritable: true });
export const rs = (pubkey: PublicKey): AccountMeta => ({ pubkey: exactKey(pubkey, "account"), isSigner: true, isWritable: false });
export const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey: exactKey(pubkey, "account"), isSigner: true, isWritable: true });

export function fixedInstruction(programId: PublicKey, keys: readonly AccountMeta[], data: Buffer): TransactionInstruction {
  exactKey(programId, "programId");
  keys.forEach((meta, index) => exactKey(meta.pubkey, `accounts[${index}]`));
  return new TransactionInstruction({ programId, keys: [...keys], data });
}
