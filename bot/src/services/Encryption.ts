import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import path from 'path';

// Safety net: load .env if not already loaded (handles import hoisting with tsx/ESM)
if (!process.env.ENCRYPTION_KEY) {
  const envPath = path.resolve(process.cwd(), '.env');
  const envPathAlt = path.resolve(__dirname, '..', '..', '.env');
  dotenv.config({ path: envPath });
  if (!process.env.ENCRYPTION_KEY) dotenv.config({ path: envPathAlt });
}

const ENC_KEY = process.env.ENCRYPTION_KEY;
if (!ENC_KEY || ENC_KEY.length < 64) {
  console.error('[FATAL] ENCRYPTION_KEY must be set and at least 64 hex characters (32 bytes). Refusing to start.');
  console.error(`[DEBUG] CWD: ${process.cwd()}`);
  console.error(`[DEBUG] ENCRYPTION_KEY present: ${!!ENC_KEY}, length: ${ENC_KEY?.length ?? 'N/A'}`);
  process.exit(1);
}
// Non-null assertion after validation
const key: string = ENC_KEY;

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, key).toString();
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const result = bytes.toString(CryptoJS.enc.Utf8);
  if (!result) throw new Error('Decryption failed — invalid ciphertext or wrong key');
  return result;
}

export function tryDecrypt(ciphertext: string): string | null {
  try { return decrypt(ciphertext); } catch { return null; }
}
