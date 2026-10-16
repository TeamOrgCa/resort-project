import type { SettingDefinition } from "./types";

type Section = { id: string; label: string; description: string; keys: string[] };
type ContentGroup = NonNullable<SettingDefinition["group"]>;

const layouts: Record<ContentGroup, Section[]> = {
  Branding: [
    { id: "branding", label: "Logo & footer", description: "Your resort identity and the short introduction at the bottom of the website.", keys: ["logo", "tagline", "footer_description"] },
  ],
  "Home page": [
    { id: "hero", label: "Hero banner", description: "The opening headline, buttons and rotating photos.", keys: ["hero_title", "hero_description", "hero_booking_label", "hero_about_label", "hero_image_1", "hero_image_2", "hero_image_3"] },
    { id: "introduction", label: "Introduction", description: "Introduce the resort and highlight what each package includes.", keys: ["your_paradise_awaits", "nestled_along_pristine_golden_shores_our_reso", "from_sunrise_to_sunset_and_beyond_immerse_you", "about_image", "250", "luxury_rooms", "12", "restaurants", "5", "pools"] },
    { id: "amenities", label: "Amenities", description: "Titles and descriptions for the resort's amenities.", keys: ["world_class_amenities", "everything_you_need_for_an_unforgettable_stay", "luxury_accommodations", "elegantly_designed_rooms_and_suites_with_ocea", "spa_wellness", "rejuvenate_your_body_and_mind_with_our_full_s", "fine_dining", "savor_gourmet_cuisine_from_around_the_world_a", "beach_activities", "endless_water_sports_beach_volleyball_and_sea", "event_spaces", "perfect_venues_for_weddings_conferences_and_s", "24_7_concierge", "personal_assistance_anytime_ensuring_your_eve"] },
    { id: "experiences", label: "Experiences", description: "Photos and descriptions of pool days, celebrations and gatherings.", keys: ["unforgettable_experiences", "create_moments_that_last_forever", "sunset_sailing", "private_yacht_tours_along_the_coast", "culinary_journey", "chef_led_cooking_classes_and_tastings", "island_adventures", "guided_tours_and_eco_experiences", "wellness_retreats", "yoga_meditation_and_mindfulness", "experience_day_image", "experience_celebration_image", "experience_gathering_image", "experience_night_image"] },
    { id: "booking", label: "Booking invitation", description: "The final invitation and links to book or learn more.", keys: ["ready_for_your_escape", "book_your_dream_vacation_today_and_experience", "check_availability", "contact_us"] },
  ],
  "About page": [
    { id: "overview", label: "Resort story", description: "The cover, introduction and story behind the resort.", keys: ["about_us", "discover_the_story_behind_paradise", "cover_image", "our_story", "since_1995_marville_resort_has_been_a_beacon_", "our_founders_believed_that_true_hospitality_c", "over_three_decades_we_ve_maintained_our_commi", "story_image"] },
    { id: "rates", label: "Rates & inclusions", description: "Package descriptions, inclusions and guest reminders. Edit prices in Business Catalog > Package rates.", keys: ["rates_heading", "rates_description", "rates_note", "inclusions_heading", "inclusions", "reminders_heading", "reminders"] },
    { id: "brochures", label: "Brochures", description: "Resort guide images, their titles and accompanying notes.", keys: ["posters_heading", "posters_description", "posters_note", "info_poster_title", "info_poster", "pricing_poster_title", "pricing_poster"] },
    { id: "contact", label: "Location & contact", description: "Location and contact labels. Change the actual address, phone numbers and social links under Resort information.", keys: ["find_us", "location", "nestled_along_the_golden_shores_of_paradise_b", "address", "phone", "email", "get_in_touch", "call_us", "available_24_7", "email_us", "typical_response_in_24hrs", "live_chat", "chat_with_our_team", "start_chat", "follow_our_journey", "stay_connected_with_us_on_social_media_for_up"] },
    { id: "booking", label: "Booking invitation", description: "The closing invitation to book or arrange an ocular visit.", keys: ["ready_to_experience_paradise", "book_your_stay_with_us_and_create_memories_th", "book_your_stay", "schedule_visit"] },
  ],
};

export function contentSections(group: ContentGroup, definitions: SettingDefinition[]) {
  const prefix = group === "Branding" ? "content.branding." : group === "Home page" ? "content.home." : "content.about.";
  const sections = layouts[group].map(section => ({ ...section, definitions: section.keys.flatMap(key => {
    const definition = definitions.find(item => item.key === prefix + key);
    return definition ? [definition] : [];
  }) })).filter(section => section.definitions.length > 0);
  const assigned = new Set(sections.flatMap(section => section.definitions.map(definition => definition.key)));
  const remaining = definitions.filter(definition => !assigned.has(definition.key));
  if (remaining.length) sections.push({ id: "other", label: "Other content", description: "Additional website content.", keys: [], definitions: remaining });
  return sections;
}

export function contentFieldDefinition(definition: SettingDefinition): SettingDefinition {
  // Display prose as wrapped text without changing saved keys or validation rules.
  if (definition.input === "text" && (/description|paragraph|introduction/i.test(definition.label) || String(definition.defaultValue).length > 90)) {
    return { ...definition, input: "textarea" };
  }
  return definition;
}
