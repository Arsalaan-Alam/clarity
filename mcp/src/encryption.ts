import { createHash, randomBytes, webcrypto } from "node:crypto";

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string; // Included for compatibility, not used in subtle API flow.
  algorithm: "aes-256-gcm";
};

function deriveKey(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function importAesKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return webcrypto.subtle.importKey("raw", deriveKey(secret), "AES-GCM", false, usage);
}

export async function encryptDeliverable(plaintext: string, secret: string): Promise<EncryptedPayload> {
  const iv = new Uint8Array(randomBytes(12));
  const key = await importAesKey(secret, ["encrypt"]);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const bytes = new Uint8Array(encrypted);

  return {
    ciphertext: toBase64(bytes),
    iv: toBase64(iv),
    authTag: "",
    algorithm: "aes-256-gcm",
  };
}

export async function decryptDeliverable(payload: EncryptedPayload, secret: string): Promise<string> {
  const key = await importAesKey(secret, ["decrypt"]);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const decrypted = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
