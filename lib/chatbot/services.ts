import { normalizeQuestion } from "@/lib/chatbot/config";

export function wantsServiceList(message: string) {
  const question = normalizeQuestion(message);
  return /\bservices?\b/.test(question)
    && !/\b(my|our|existing|cancel|remove|refund|payment|customer|human)\b/.test(question)
    && (/^(?:(?:your|the|available|resort|additional|extra|optional|add ons?)\s+)*services?$/.test(question)
      || /\b(show|list|browse|what|which|offer|provide|available)\b/.test(question));
}

export function wantsAdditionalServices(message: string) {
  return wantsServiceList(message) && /\b(additional|extra|optional|add ons?)\b/.test(normalizeQuestion(message));
}

export function resortServicesReply() {
  return "MarVille Resort offers:\n"
    + "- Private pool swimming for day, overnight, or whole-day stays.\n"
    + "- Two air-conditioned rooms with beds and private toilets included in the swimming package.\n"
    + "- A cottage, videoke, griller, and free parking.\n"
    + "- Consumable food with the package, in-house food service, and a sari-sari store.\n"
    + "- Catering arrangements for celebrations; please coordinate with resort staff.\n"
    + "- Free ocular visits so you can see the resort before booking.\n\n"
    + "Check /booking for available dates and current package rates. Which resort service would you like to know more about?";
}

export function additionalServiceListReply(services: { name: string; price: number | string }[] | null) {
  const intro = "You can book a private pool stay or arrange a free ocular visit at /booking.";
  if (services === null) return `${intro}\n\nThe additional service list is temporarily unavailable. Check the services step at /booking or ask a resort employee for current options and prices.`;
  if (services.length === 0) return `${intro}\n\nNo additional services are currently listed for online booking. Ask a resort employee about any special requests.`;
  const prices = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
  return `${intro}\n\nAdditional services currently offered:\n${services.map(service => `- ${service.name}: ${prices.format(Number(service.price))}`).join("\n")}\n\nSelect extras in the services step at /booking and review the total before paying.`;
}
