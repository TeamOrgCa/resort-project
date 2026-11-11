# Chatbot FAQs and human assistance

Administrators manage answers in **Configuration → Chatbot**. Add or edit FAQ questions and approved answers, then select **Save chatbot settings**. Remove a row to remove it from the advertised FAQ list. Each question can contain 5–200 characters and each answer 2–2,000 characters, with up to 40 FAQs.

Matching FAQ questions return the saved answer directly. Other general questions use the approved FAQs and current contact settings as the model's reference. Live package rates and the signed-in customer's own booking data remain separate sources. Missing facts are referred to staff. The guest FAQ list refreshes with website content, while each chat request reads the latest saved settings.

The **Facebook chat link** setting accepts an HTTPS Messenger link such as `https://m.me/marvilleresort`. When blank, the chatbot derives a Messenger link from **Resort information → Social media links → Facebook**. Contact numbers and email come from Resort information.

Guests can select **Talk to a resort employee**, enter a reason and optionally a booking reference, then request assistance. A direct request for a human in the conversation also works. The reply includes **Chat with MarVille Resort on Facebook**; the customer opens Messenger and sends their message there.

An in-app notification is sent to active administrators with the customer's saved name, the reason and any reference verified as their own booking. Visitors who are not signed in are identified as website visitors. Sensitive account details are omitted. If the alert cannot be saved, the reply still provides the direct channel and explains that the administrator notification failed.

## Manager ocular cancellations

Apply [manager-ocular-cancellation-migration.sql](manager-ocular-cancellation-migration.sql) after its listed prerequisites. Managers with **Ocular approval** permission can cancel pending or confirmed visits from the calendar or **Records → Ocular Visit Records**. A reason of 5–2,000 characters is required. The cancellation, actor, timestamp, reason and audit record save together. The guest receives the reason in-app and by email when delivery succeeds. Cancellation reasons remain visible in Records.

FAQ configuration uses the existing business settings storage and requires no additional database migration.

The guest chat displays its quick questions and saved FAQs in one horizontally scrollable chip row. The separate FAQ dropdown and booking navigation buttons are removed. Human assistance opens inside the scrolling conversation so the composer stays visible. The panel follows the mobile visual viewport when the keyboard opens; scrolling new replies stays inside the conversation.

Requests such as `services`, `resort services` and `show me services` describe the resort's offerings: private pool packages, included rooms and amenities, food service, catering arrangements and free ocular visits. These replies do not depend on the paid add-on catalog. Explicit requests for additional, extra or optional services return the active Business Catalog add-ons and current prices. An exact saved FAQ still takes priority. Empty or unavailable add-on catalogs receive an explicit response instead of guessed names or prices. Run `node scripts/check-chatbot-layout.mjs` for credential-free Chromium checks of narrow, landscape and keyboard-sized viewports, including 40 saved FAQs and the support form.
