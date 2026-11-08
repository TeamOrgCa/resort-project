import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const config = loadTsModule("lib/chatbot/config.ts");
const settings = { "chatbot.faqs": { "Can we bring food and drinks?": "Outside food needs prior approval. Ask the resort before your stay." }, "resort.social_links": { facebook: "@marvilleresort" }, "resort.contact_numbers": ["09172796592"], "resort.email": "office@example.com" };

test("FAQ validation bounds content and exact matching returns the saved answer", () => {
  assert.equal(config.validFaqs(settings["chatbot.faqs"]), true);
  assert.equal(config.exactFaqAnswer("CAN WE BRING FOOD AND DRINKS?", settings["chatbot.faqs"]), settings["chatbot.faqs"]["Can we bring food and drinks?"]);
  for (const value of [{ "Short": "" }, { "Hi": "Valid answer" }, { "One question?": "Okay", "one question": "Different" }, { "Valid question": "x".repeat(2001) }, []]) assert.equal(config.validFaqs(value), false);
  assert.equal(config.validFaqs({}), true);
});

test("human support uses the configured Facebook page and rejects unsafe redirects", () => {
  assert.equal(config.facebookChatUrl(settings), "https://m.me/marvilleresort");
  assert.equal(config.facebookChatUrl({ "resort.social_links": { facebook: "https://www.facebook.com/profile.php?id=12345" } }), "https://m.me/12345");
  for (const url of ["javascript:alert(1)", "https://m.me.evil.test/Resort", "https://evil.test", "https://user:pass@m.me/resort", "http://m.me/resort"]) assert.equal(config.validFacebookChatUrl(url), false);
  assert.equal(config.validFacebookChatUrl("https://m.me/marvilleresort"), true);
  assert.equal(config.wantsHumanSupport("Can I speak to a real person about my booking?"), true);
});

function harness({ signedIn = true, notifyFails = false, settingsFail = false } = {}) {
  const notifications = [], prompts = [], filters = [];
  const client = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: "guest" } : null }, error: null }) }, from(table) {
    const predicates = [];
    const result = () => ({ data: table === "guests" ? { first_name: "Ana", middle_name: "Reyes", last_name: "Santos", is_active: true }
      : predicates.some(([key, value]) => key === "reference_number" && value !== "SR-OWNBOOK1") ? null : { reference_number: "SR-OWNBOOK1" }, error: null });
    const q = { select: () => q, eq: (key, value) => { predicates.push([key, value]); filters.push([key, value]); return q; }, order: () => q, limit: async () => ({ data: [], error: null }), maybeSingle: async () => result() }; return q;
  } };
  const support = loadTsModule("lib/server/chatbot-support.ts", {
    "@/lib/notifications": { createNotifications: async value => { notifications.push(value); return { error: notifyFails ? Error("Offline") : null }; } },
  });
  const guardrails = loadTsModule("lib/chatbot/guardrails.ts");
  const oldKey = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "unit-test";
  let route;
  try {
    route = loadTsModule("app/api/chat/route.ts", {
      "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/server/package-rates": { loadPackageRates: async () => null },
      "@/lib/chatbot/guardrails": { ...guardrails, isRateLimited: () => false },
      "@/lib/server/chatbot-support": { ...support, loadChatbotSettings: async () => { if (settingsFail) throw Error("Unavailable"); return settings; } },
      "@google/generative-ai": { GoogleGenerativeAI: class { getGenerativeModel(options) { prompts.push(options); return { generateContent: async () => ({ response: { text: () => "Please follow the saved food policy." } }) }; } } },
    });
  } finally { if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey; }
  return { notifications, prompts, filters, post: async (message, extras = {}) => route.POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, ...extras }) })) };
}

test("saved FAQs override hardcoded guidance and paraphrases receive approved context", async () => {
  const h = harness();
  const response = await h.post("Can we bring food and drinks?");
  assert.equal((await response.json()).reply, settings["chatbot.faqs"]["Can we bring food and drinks?"]);
  assert.equal(h.prompts.length, 0);
  await h.post("Are outside meals allowed at the resort?");
  assert.match(h.prompts[0].systemInstruction, /Outside food needs prior approval/);
  assert.doesNotMatch(h.prompts[0].systemInstruction, /200 corkage fee|ROOM RATES|850 for 12 hours/);
  assert.equal((await harness({ settingsFail: true }).post("Can we bring food and drinks?")).status, 503);
});

test("human requests notify admins with the saved guest name, own booking and reason and return a Messenger link", async () => {
  const h = harness();
  const response = await h.post("I need human support about SR-OWNBOOK1. Please clarify my booking fees.", { guestName: "Forged Name" });
  const data = await response.json();
  assert.equal(data.supportLink.url, "https://m.me/marvilleresort"); assert.equal(data.notified, true);
  assert.equal(h.prompts.length, 0); assert.equal(h.notifications.length, 1);
  assert.deepEqual(h.notifications[0].staffRoles, ["admin"]);
  assert.match(h.notifications[0].message, /Ana Reyes Santos \(SR-OWNBOOK1\)/);
  assert.match(h.notifications[0].message, /clarify my booking fees/);
  assert.doesNotMatch(h.notifications[0].message, /Forged Name/);
  assert.ok(h.filters.some(([key, value]) => key === "guest_id" && value === "guest"));
});

test("anonymous requests and alert failures retain direct support without claiming delivery", async () => {
  const h = harness({ signedIn: false, notifyFails: true });
  const data = await (await h.post("I need human support with booking dates")).json();
  assert.equal(data.notified, false); assert.equal(data.supportLink.url, "https://m.me/marvilleresort");
  assert.match(data.reply, /could not be delivered/); assert.match(h.notifications[0].message, /not signed in/);
  assert.equal(h.notifications[0].actorId, null);
  const privateRequest = harness();
  await privateRequest.post("I need human support; my password is secret");
  assert.equal(privateRequest.notifications.length, 1);
  assert.doesNotMatch(privateRequest.notifications[0].message, /password|secret/);
  assert.match(privateRequest.notifications[0].message, /Sensitive details omitted/);
});
