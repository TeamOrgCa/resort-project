import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

function branding(value, { error = false, available = true, download = null } = {}) {
  const filters = [];
  const query = { select: () => query, eq: (...filter) => { filters.push(filter); return query; }, abortSignal: () => query,
    maybeSingle: async () => ({ data: value === undefined ? null : { setting_value: value }, error: error ? Error("Offline") : null }) };
  return { filters, ...loadTsModule("lib/server/email-branding.ts", {
    "@/lib/supabase/admin": { tryCreateAdminClient: () => available ? { from: () => query,
      storage: { from: bucket => ({ download: path => download(bucket, path) }) } } : null },
  }) };
}

test("the default website logo is embedded without a public site URL", async () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    for (const source of [undefined, "/website_logo_transparent.png"]) {
      const result = await branding(source).getEmailBranding();
      assert.equal(result.attachments.length, 1);
      assert.equal(result.logoUrl, `cid:${result.attachments[0].cid}`);
      assert.equal(result.attachments[0].contentDisposition, "inline");
      const metadata = await sharp(result.attachments[0].content).metadata();
      assert.equal(metadata.format, "png"); assert.ok(metadata.width > 0 && metadata.width <= 360);
    }
    const unsafe = await branding("/%2e%2e/lib/email.ts").getEmailBranding();
    assert.equal(unsafe.logoUrl, null); assert.equal(unsafe.attachments.length, 0);
  } finally { if(previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL=previous; }
});

test("Configuration uploads are downloaded from site-content and embedded instead of remote image links", async () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  const bytes = await readFile("public/website_logo_transparent.png"), downloads = [];
  try {
    const result = await branding("https://project.supabase.co/storage/v1/object/public/site-content/branding/logo.png", {
      download: async (...args) => { downloads.push(args); return { data: new Blob([bytes]), error: null }; },
    }).getEmailBranding();
    assert.deepEqual(downloads, [["site-content", "branding/logo.png"]]);
    assert.ok(result.logoUrl.startsWith("cid:")); assert.equal(result.attachments.length, 1);
    const unavailable = await branding("https://project.supabase.co/storage/v1/object/public/site-content/branding/logo.png", {
      download: async () => ({ data: null, error: Error("Offline") }),
    }).getEmailBranding();
    assert.equal(unavailable.attachments.length, 0);
  } finally { if(previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previous; }
});

test("email branding uses the admin-configured public logo and resolves local website assets", async () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://resort.example";
  try {
    const configured = branding("https://storage.example/site-content/custom-logo.png?v=2&size=large");
    assert.equal(await configured.getEmailLogoUrl(), "https://storage.example/site-content/custom-logo.png?v=2&size=large");
    assert.deepEqual(configured.filters, [["setting_key", "content.branding.logo"]]);
    assert.equal(await branding("/custom-logo.png").getEmailLogoUrl(), "https://resort.example/custom-logo.png");
    assert.equal(await branding(undefined).getEmailLogoUrl(), "https://resort.example/website_logo_transparent.png");
  } finally { if(previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL=previous; }
});

test("invalid logos and settings failures fall back to text branding", async () => {
  for (const value of ["javascript:alert(1)", "//other.example/logo.png", "data:image/svg+xml,test", "https://user:pass@example.com/logo.png", "", {}, "https://example.com/logo.png\" onerror=\"alert(1)"])
    assert.equal(await branding(value).getEmailLogoUrl(), null);
  assert.equal(await branding("https://example.com/logo.png", {error:true}).getEmailLogoUrl(), null);
  assert.equal(await branding("https://example.com/logo.png", {available:false}).getEmailLogoUrl(), null);
});

test("each email reads current branding and safely renders the logo without affecting delivery", async () => {
  const saved = Object.fromEntries(["EMAIL_USER", "EMAIL_PASS"].map(key=>[key,process.env[key]]));
  Object.assign(process.env, {EMAIL_USER:"mailer@example.com",EMAIL_PASS:"fixture-only"});
  let logo = "https://storage.example/logo.png?v=1&size=small"; const messages=[];
  try {
    const mail = loadTsModule("lib/email.ts", {
      "@/lib/server/email-branding": { getEmailBranding: async () => ({ logoUrl: logo, attachments: logo?.startsWith("cid:") ? [{ cid: logo.slice(4), filename: "logo.png", content: Buffer.from("fixture"), contentDisposition: "inline" }] : [] }) },
      nodemailer: {createTransport:()=>({sendMail:async message=>{messages.push(message);return {accepted:[message.to]};}})},
    });
    const payload={email:"guest@example.com",guestName:"Maria",confirmationUrl:"https://resort.example/auth/confirm?token_hash=test&type=email"};
    for (const next of [logo,"https://storage.example/replacement.png","cid:marville-website-logo@resort",null]) {
      logo=next; assert.equal(await mail.sendGuestConfirmationEmail(payload),true);
      const dom=new JSDOM(messages.at(-1).html);
      try {
        const img=dom.window.document.querySelector("img");
        if(next) { assert.equal(img.src,next); assert.equal(img.getAttribute("width"),"180"); assert.ok(img.alt.endsWith("logo")); }
        else assert.equal(img,null);
        assert.equal(messages.at(-1).attachments.length, next?.startsWith("cid:") ? 1 : 0);
        assert.match(dom.window.document.body.textContent,/Confirm your email/);
      } finally {dom.window.close();}
    }
  } finally {for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
