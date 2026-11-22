import { randomInt } from "node:crypto";

/** Generate on the server; return only with the create/reset response. */
export function generateTemporaryPassword(): string {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const alphabet = groups.join("");
  const characters = groups.map(group => group[randomInt(group.length)]);
  while (characters.length < 20) characters.push(alphabet[randomInt(alphabet.length)]);
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join("");
}
