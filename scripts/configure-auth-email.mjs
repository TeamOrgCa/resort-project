import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const config = {
  mailer_otp_exp: 300,
  mailer_subjects_recovery: "Reset your MarVille Resort Complex password",
  mailer_templates_recovery_content: await readFile("docs/email-templates/reset-password.html", "utf8"),
  mailer_subjects_magic_link: "Your MarVille Resort Complex staff verification code",
  mailer_templates_magic_link_content: await readFile("docs/email-templates/staff-otp.html", "utf8"),
};
if (!process.argv.includes("--apply")) {
  console.log("Prepared: email OTP expiry = 300 seconds; branded reset-password and staff-code templates. Use --apply to save to Supabase.");
} else {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  if (!accessToken) throw new Error("Set the server-only SUPABASE_ACCESS_TOKEN to apply hosted Auth settings. The service-role key cannot manage Auth configuration.");
  const endpoint = `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/config/auth`;
  const response = await fetch(endpoint, { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(config), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Supabase Auth configuration failed (${response.status}).`);
  const verified = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000) });
  if (!verified.ok) throw new Error(`Unable to verify Auth settings (${verified.status}).`);
  const saved = await verified.json();
  for (const [key, value] of Object.entries(config)) if (saved[key] !== value) throw new Error(`Auth setting was not saved: ${key}`);
  console.log("Verified: Supabase email OTP expiry is 300 seconds and both email templates are saved.");
}
