import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { maskSecret } from "@symforyx/core";

/**
 * AES-256-GCM Key Vault.
 * Keys are encrypted at rest and decrypted only at call time, never returned in full to UI or logs.
 */
export class KeyVault {
  private masterKey: Buffer;

  constructor(opts?: { secret?: string; dataDir?: string }) {
    const envSecret = opts?.secret ?? process.env.SYMFORYX_SECRET;
    if (envSecret && envSecret.length >= 16) {
      this.masterKey = createHash("sha256").update(envSecret).digest();
    } else {
      const dataDir = opts?.dataDir ?? process.env.SYMFORYX_DATA_DIR ?? "./data";
      const keyFile = join(dataDir, ".vault.key");
      if (existsSync(keyFile)) {
        const raw = readFileSync(keyFile, "utf8").trim();
        this.masterKey = Buffer.from(raw, "hex");
      } else {
        mkdirSync(dirname(keyFile), { recursive: true });
        const generated = randomBytes(32);
        writeFileSync(keyFile, generated.toString("hex"), { mode: 0o600 });
        this.masterKey = generated;
      }
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted secret format");
    }
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  }

  mask(plaintext: string): string {
    return maskSecret(plaintext);
  }
}
