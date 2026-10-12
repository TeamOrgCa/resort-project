import { SiteText, SiteImage } from "@/components/content/SiteContent";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import ChatBotMars from "@/components/ChatBotMars";
import HeroCarousel from "@/components/HeroCarousel";

export default function Home() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Hero Section */}
      <HeroCarousel />

      {/* About Section */}
      <section id="about" className="py-24 px-4 bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-5xl font-bold text-neutral mb-6"><SiteText contentKey="content.home.your_paradise_awaits" /></h2>
              <p className="text-lg text-neutral/80 mb-6"><SiteText contentKey="content.home.nestled_along_pristine_golden_shores_our_reso" /></p>
              <p className="text-lg text-neutral/80 mb-8"><SiteText contentKey="content.home.from_sunrise_to_sunset_and_beyond_immerse_you" /></p>
              <div className="flex gap-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary mb-2"><SiteText contentKey="content.home.250" /></div>
                  <div className="text-sm text-neutral/70"><SiteText contentKey="content.home.luxury_rooms" /></div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-secondary mb-2"><SiteText contentKey="content.home.12" /></div>
                  <div className="text-sm text-neutral/70"><SiteText contentKey="content.home.restaurants" /></div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-accent mb-2"><SiteText contentKey="content.home.5" /></div>
                  <div className="text-sm text-neutral/70"><SiteText contentKey="content.home.pools" /></div>
                </div>
              </div>
            </div>
            <div className="relative rounded-3xl h-96 overflow-hidden shadow-2xl">
              <SiteImage
                contentKey="content.home.about_image"
                alt="Resort View" 
                fill 
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Amenities Section */}
      <section id="amenities" className="py-24 px-4 bg-neutral/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-neutral mb-4"><SiteText contentKey="content.home.world_class_amenities" /></h2>
            <p className="text-xl text-neutral/70"><SiteText contentKey="content.home.everything_you_need_for_an_unforgettable_stay" /></p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.luxury_accommodations" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.elegantly_designed_rooms_and_suites_with_ocea" /></p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.spa_wellness" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.rejuvenate_your_body_and_mind_with_our_full_s" /></p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-accent/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.fine_dining" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.savor_gourmet_cuisine_from_around_the_world_a" /></p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-highlight/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.beach_activities" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.endless_water_sports_beach_volleyball_and_sea" /></p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.event_spaces" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.perfect_venues_for_weddings_conferences_and_s" /></p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3"><SiteText contentKey="content.home.24_7_concierge" /></h3>
              <p className="text-neutral/70"><SiteText contentKey="content.home.personal_assistance_anytime_ensuring_your_eve" /></p>
            </div>
          </div>
        </div>
      </section>

      {/* Experiences Section */}
      <section id="experiences" className="py-24 px-4 bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-neutral mb-4"><SiteText contentKey="content.home.unforgettable_experiences" /></h2>
            <p className="text-xl text-neutral/70"><SiteText contentKey="content.home.create_moments_that_last_forever" /></p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="relative h-80 bg-linear-to-br from-primary/30 to-highlight/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-linear-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2"><SiteText contentKey="content.home.sunset_sailing" /></h3>
                <p className="text-base/90"><SiteText contentKey="content.home.private_yacht_tours_along_the_coast" /></p>
              </div>
            </div>
            <div className="relative h-80 bg-linear-to-br from-secondary/30 to-accent/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-linear-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2"><SiteText contentKey="content.home.culinary_journey" /></h3>
                <p className="text-base/90"><SiteText contentKey="content.home.chef_led_cooking_classes_and_tastings" /></p>
              </div>
            </div>
            <div className="relative h-80 bg-linear-to-br from-accent/30 to-secondary/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-linear-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2"><SiteText contentKey="content.home.island_adventures" /></h3>
                <p className="text-base/90"><SiteText contentKey="content.home.guided_tours_and_eco_experiences" /></p>
              </div>
            </div>
            <div className="relative h-80 bg-linear-to-br from-highlight/30 to-primary/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-linear-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2"><SiteText contentKey="content.home.wellness_retreats" /></h3>
                <p className="text-base/90"><SiteText contentKey="content.home.yoga_meditation_and_mindfulness" /></p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 bg-linear-to-r from-primary to-primary/80">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold text-base mb-6"><SiteText contentKey="content.home.ready_for_your_escape" /></h2>
          <p className="text-xl text-base/90 mb-10"><SiteText contentKey="content.home.book_your_dream_vacation_today_and_experience" /></p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking">
              <button className="bg-base text-neutral px-10 py-4 rounded-full text-lg font-semibold hover:bg-base/90 transition-all transform hover:scale-105"><SiteText contentKey="content.home.check_availability" /></button>
            </Link>
            <Link href="/about">
              <button className="bg-accent text-base px-10 py-4 rounded-full text-lg font-semibold hover:bg-accent/90 transition-all transform hover:scale-105"><SiteText contentKey="content.home.contact_us" /></button>
            </Link>
          </div>
        </div>
      </section>

      <ChatBotMars />

      <Footer />
    </div>
  );
}
