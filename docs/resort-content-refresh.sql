-- Optional: run in Supabase SQL Editor if old placeholder text was saved in Configuration.
-- Only exact matches to the former application defaults are replaced. Custom content stays intact.
-- New image/text fields use application defaults without inserting database rows.
begin;
with replacements(setting_key, old_value, new_value) as (values
  ('content.branding.footer_description', '"Creating unforgettable memories since 1995"'::jsonb, '"Private pool days, shared meals and good company in Taytay, Rizal."'::jsonb),
  ('content.home.your_paradise_awaits', '"Your Paradise Awaits"'::jsonb, '"Good company. Great pool days."'::jsonb),
  ('content.home.nestled_along_pristine_golden_shores_our_reso', '"Nestled along pristine golden shores, our resort offers an unparalleled escape where luxury meets nature. Every moment is designed to create memories that last a lifetime."'::jsonb, '"Bring the family, round up the barkada and make time for each other. MarVille Resort Complex in Taytay, Rizal is a place for poolside catch-ups, birthday celebrations and a refreshing break close to home."'::jsonb),
  ('content.home.from_sunrise_to_sunset_and_beyond_immerse_you', '"From sunrise to sunset and beyond, immerse yourself in world-class amenities, exquisite dining, and breathtaking views that redefine coastal living."'::jsonb, '"Pick a day, night or whole-day private swimming package. With a cottage, two air-conditioned rooms, videoke and a griller included, you can settle in, share a meal and enjoy the day together."'::jsonb),
  ('content.home.250', '"250+"'::jsonb, '"20"'::jsonb),
  ('content.home.luxury_rooms', '"Luxury Rooms"'::jsonb, '"Guests included"'::jsonb),
  ('content.home.12', '"12"'::jsonb, '"2"'::jsonb),
  ('content.home.restaurants', '"Restaurants"'::jsonb, '"Rooms included"'::jsonb),
  ('content.home.5', '"5"'::jsonb, '"3"'::jsonb),
  ('content.home.pools', '"Pools"'::jsonb, '"Swimming packages"'::jsonb),
  ('content.home.world_class_amenities', '"World-Class Amenities"'::jsonb, '"Settle in. Make yourself at home."'::jsonb),
  ('content.home.everything_you_need_for_an_unforgettable_stay', '"Everything you need for an unforgettable stay"'::jsonb, '"Simple comforts for swimming, sharing food and spending time together."'::jsonb),
  ('content.home.luxury_accommodations', '"Luxury Accommodations"'::jsonb, '"A place to rest"'::jsonb),
  ('content.home.elegantly_designed_rooms_and_suites_with_ocea', '"Elegantly designed rooms and suites with ocean views and premium amenities"'::jsonb, '"Two air-conditioned rooms with beds and private toilets come with your private swimming package, each ideal for two guests."'::jsonb),
  ('content.home.spa_wellness', '"Spa & Wellness"'::jsonb, '"Pool time, your way"'::jsonb),
  ('content.home.rejuvenate_your_body_and_mind_with_our_full_s', '"Rejuvenate your body and mind with our full-service spa and wellness center"'::jsonb, '"Choose day, night or whole-day swimming and plan a private pool gathering around your group."'::jsonb),
  ('content.home.fine_dining', '"Fine Dining"'::jsonb, '"Food for the whole group"'::jsonb),
  ('content.home.savor_gourmet_cuisine_from_around_the_world_a', '"Savor gourmet cuisine from around the world at our award-winning restaurants"'::jsonb, '"Enjoy consumable food with your package, in-house food service and a sari-sari store for the little things you need."'::jsonb),
  ('content.home.beach_activities', '"Beach Activities"'::jsonb, '"Sing a little louder"'::jsonb),
  ('content.home.endless_water_sports_beach_volleyball_and_sea', '"Endless water sports, beach volleyball, and seaside entertainment"'::jsonb, '"Videoke is included in private swimming packages. Bring your favorite songs and let everyone have a turn."'::jsonb),
  ('content.home.event_spaces', '"Event Spaces"'::jsonb, '"Room to gather"'::jsonb),
  ('content.home.perfect_venues_for_weddings_conferences_and_s', '"Perfect venues for weddings, conferences, and special celebrations"'::jsonb, '"A cottage and griller make shared meals easy. Ask the team about catering arrangements for your celebration."'::jsonb),
  ('content.home.24_7_concierge', '"24/7 Concierge"'::jsonb, '"An easy arrival"'::jsonb),
  ('content.home.personal_assistance_anytime_ensuring_your_eve', '"Personal assistance anytime, ensuring your every need is met"'::jsonb, '"Free parking is included. You can also schedule a free ocular visit to see the resort before booking."'::jsonb),
  ('content.home.unforgettable_experiences', '"Unforgettable Experiences"'::jsonb, '"Make a day of it"'::jsonb),
  ('content.home.create_moments_that_last_forever', '"Create moments that last forever"'::jsonb, '"A birthday, a reunion or a just-because outing. Bring your people."'::jsonb),
  ('content.home.sunset_sailing', '"Sunset Sailing"'::jsonb, '"Slow afternoons by the pool"'::jsonb),
  ('content.home.private_yacht_tours_along_the_coast', '"Private yacht tours along the coast"'::jsonb, '"Cool off, share snacks and catch up without rushing home."'::jsonb),
  ('content.home.culinary_journey', '"Culinary Journey"'::jsonb, '"Celebrate together"'::jsonb),
  ('content.home.chef_led_cooking_classes_and_tastings', '"Chef-led cooking classes and tastings"'::jsonb, '"Bring the birthday crew or gather the family for a poolside reunion."'::jsonb),
  ('content.home.island_adventures', '"Island Adventures"'::jsonb, '"One more meal, one more story"'::jsonb),
  ('content.home.guided_tours_and_eco_experiences', '"Guided tours and eco-experiences"'::jsonb, '"Fire up the griller and make space for good food and long conversations."'::jsonb),
  ('content.home.wellness_retreats', '"Wellness Retreats"'::jsonb, '"Stay a little longer"'::jsonb),
  ('content.home.yoga_meditation_and_mindfulness', '"Yoga, meditation, and mindfulness"'::jsonb, '"Let your get-together carry on with night or whole-day swimming."'::jsonb),
  ('content.home.ready_for_your_escape', '"Ready for Your Escape?"'::jsonb, '"Who are you bringing?"'::jsonb),
  ('content.home.book_your_dream_vacation_today_and_experience', '"Book your dream vacation today and experience paradise like never before"'::jsonb, '"Choose your swimming package and find a date for your next MarVille get-together."'::jsonb),
  ('content.home.contact_us', '"Contact Us"'::jsonb, '"Rates & resort info"'::jsonb),
  ('content.home.hero_description', '"Experience endless luxury and breathtaking moments at our exclusive beachfront resort"'::jsonb, '"Pool days, videoke nights and good company. Your next family or barkada get-together starts here in Taytay, Rizal."'::jsonb),
  ('content.home.hero_booking_label', '"Explore Our Rooms"'::jsonb, '"Plan your pool day"'::jsonb),
  ('content.home.hero_about_label', '"Learn More"'::jsonb, '"Explore MarVille"'::jsonb),
  ('content.about.about_us', '"About Us"'::jsonb, '"Meet MarVille"'::jsonb),
  ('content.about.discover_the_story_behind_paradise', '"Discover the story behind paradise"'::jsonb, '"Your place for pool days and good company in Taytay, Rizal."'::jsonb),
  ('content.about.our_story', '"Our Story"'::jsonb, '"Made for getting together"'::jsonb),
  ('content.about.since_1995_marville_resort_has_been_a_beacon_', '"Since 1995, MarVille Resort has been a beacon of luxury and tranquility on the pristine shores of Paradise Beach. What began as a vision to create an unparalleled coastal escape has blossomed into one of the most sought-after destinations in the region."'::jsonb, '"MarVille Resort Complex is a swimming and gathering spot on Cabrera Road in Taytay, Rizal. Come for a refreshing dip, a family celebration or a relaxed outing with friends."'::jsonb),
  ('content.about.our_founders_believed_that_true_hospitality_c', '"Our founders believed that true hospitality comes from the heart. This philosophy continues to guide us today as we welcome guests from around the world to experience the perfect blend of natural beauty, world-class amenities, and genuine warmth."'::jsonb, '"Our private swimming packages give your group a place to enjoy the pool, share food and sing along to videoke. Choose day, night or whole-day swimming, with weekday and weekend rates to suit your plans."'::jsonb),
  ('content.about.over_three_decades_we_ve_maintained_our_commi', '"Over three decades, we''ve maintained our commitment to excellence while expanding our offerings to include luxury accommodations, fine dining experiences, rejuvenating spa services, and countless memorable activities."'::jsonb, '"Want to look around first? Schedule a free ocular visit. The team can help with booking inquiries, additional rooms and catering arrangements for your gathering."'::jsonb),
  ('content.about.nestled_along_the_golden_shores_of_paradise_b', '"Nestled along the golden shores of Paradise Beach, our resort offers easy access to both natural wonders and local attractions. Just minutes from the airport yet worlds away from the everyday."'::jsonb, '"Find us on Cabrera Road, Hapay na Mangga, Barangay Dolores, Taytay, Rizal. Search for Marville Resort (Hapay na Mangga Taytay) on Waze, or use the map below to plan your route."'::jsonb),
  ('content.about.available_24_7', '"Available 24/7"'::jsonb, '"Call from 8:00 AM to 5:00 PM"'::jsonb),
  ('content.about.typical_response_in_24hrs', '"Typical response in 24hrs"'::jsonb, '"For booking inquiries and gathering plans"'::jsonb),
  ('content.about.live_chat', '"Live Chat"'::jsonb, '"Message on Facebook"'::jsonb),
  ('content.about.chat_with_our_team', '"Chat with our team"'::jsonb, '"Ask about availability, food orders and visits"'::jsonb),
  ('content.about.start_chat', '"Start Chat"'::jsonb, '"Visit our Facebook page"'::jsonb),
  ('content.about.stay_connected_with_us_on_social_media_for_up', '"Stay connected with us on social media for updates, special offers, and glimpses of paradise"'::jsonb, '"See poolside moments, resort updates and ideas for your next get-together."'::jsonb),
  ('content.about.ready_to_experience_paradise', '"Ready to Experience Paradise?"'::jsonb, '"Let''s plan your pool day"'::jsonb),
  ('content.about.book_your_stay_with_us_and_create_memories_th', '"Book your stay with us and create memories that last a lifetime"'::jsonb, '"Check available dates or come see the resort with a free ocular visit."'::jsonb),
  ('content.about.book_your_stay', '"Book Your Stay"'::jsonb, '"Check availability"'::jsonb)
)
update public.business_settings as settings
set setting_value = replacements.new_value, updated_at = now()
from replacements
where settings.setting_key = replacements.setting_key
  and settings.setting_value = replacements.old_value;
commit;
