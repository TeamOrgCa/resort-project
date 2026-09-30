export type GuestRegistration = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  phoneNumber: string;
  address: string;
  password: string;
};

export function validateGuestRegistration(input: unknown):
  | { value: GuestRegistration; error?: never }
  | { value?: never; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Please complete the registration form." };
  }

  const fields = input as Record<string, unknown>;
  const names = [fields.firstName, fields.lastName, fields.middleName];
  if (names.some((name) => typeof name !== "string")) {
    return { error: "Please enter a valid first and last name." };
  }

  const [firstName, lastName, middleName] = (names as string[]).map((name) => name.trim().replace(/\s+/g, " "));
  const validName = (name: string) => name.length <= 100 && /^[\p{L}]+(?:[\p{L}\s'-]*[\p{L}])?$/u.test(name);
  if (!validName(firstName) || !validName(lastName) || (middleName && !validName(middleName))) {
    return { error: "Please enter valid names using letters, spaces, apostrophes, or hyphens." };
  }

  if (typeof fields.email !== "string") return { error: "Please enter a valid email address." };
  const email = fields.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  if (typeof fields.phoneNumber !== "string") return { error: "Please enter a valid phone number." };
  const phoneNumber = fields.phoneNumber.trim();
  if (!/^\+?\d{7,15}$/.test(phoneNumber)) {
    return { error: "Phone number must contain 7 to 15 digits, with an optional leading +." };
  }

  if (typeof fields.address !== "string") return { error: "Please enter your address." };
  const address = fields.address.trim();
  if (address.length < 5 || address.length > 500) {
    return { error: "Address must be between 5 and 500 characters." };
  }

  if (typeof fields.password !== "string" || fields.password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (fields.password.length > 128) return { error: "Password must be 128 characters or fewer." };
  if (fields.password !== fields.confirmPassword) return { error: "Passwords do not match." };

  return { value: { firstName, lastName, middleName: middleName || null, email, phoneNumber, address, password: fields.password } };
}
