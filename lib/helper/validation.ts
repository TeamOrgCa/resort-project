
export const sanitizeName = (value: string) => {
  return value
    .replace(/[^\p{L}\s'-]/gu, "")
    .replace(/\s+/g, " ");
};

export const isValidName = (name: string) =>
  /^[\p{L}\s'-]+$/u.test(name);