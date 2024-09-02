import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_KEY = process.env.COOKIE_SECRET || "your-32-char-secret-key";
const IV_LENGTH = 16; // For AES, this is always 16

export function encrypt(text: string): string {
	let iv = randomBytes(IV_LENGTH);
	let cipher = createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
	let encrypted = cipher.update(text);

	encrypted = Buffer.concat([encrypted, cipher.final()]);

	return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string): string {
	let textParts = text.split(":");
	let iv = Buffer.from(textParts.shift()!, "hex");
	let encryptedText = Buffer.from(textParts.join(":"), "hex");
	let decipher = createDecipheriv(
		"aes-256-cbc",
		Buffer.from(ENCRYPTION_KEY),
		iv,
	);
	let decrypted = decipher.update(encryptedText);

	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString();
}
