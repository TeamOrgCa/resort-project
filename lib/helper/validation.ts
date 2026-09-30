
export const sanitizeName = (value: string) => {
  return value
    .replace(/[^\p{L}\s'-]/gu, "")
    .replace(/\s+/g, " ");
};

export const isValidName = (name: string) =>
  /^[\p{L}\s'-]+$/u.test(name);

export const sanitizeAccountNumber = (value: string) => value.replace(/\D/g, "").slice(0, 20);

export const isValidAccountNumber = (value: string) => /^\d{6,20}$/.test(value);
