import { normalizePersonName, sanitizePersonName } from "@/lib/validation/name";
export const sanitizeName = (value: string) => {
  return sanitizePersonName(value).replace(/ +/g, " ");
};

export const isValidName = (name: string) =>
  normalizePersonName(name) !== null;

export const sanitizeAccountNumber = (value: string) => value.replace(/\D/g, "").slice(0, 20);

export const isValidAccountNumber = (value: string) => /^\d{6,20}$/.test(value);
