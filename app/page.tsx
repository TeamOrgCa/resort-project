import Image from "next/image";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Hero Section */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <Image 
          src="/website_cover.jpg" 
          alt="Resort Cover" 
          fill 
          className="object-cover" 
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-neutral/50 via-neutral/30 to-neutral/60"></div>
        <div className="relative z-10 text-center px-4 max-w-5xl mx-auto">
          
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-6 leading-tight">
            Where the sun<br />never sets
          </h1>
          <p className="text-xl md:text-2xl text-white/80 mb-12 max-w-2xl mx-auto">
            Experience endless luxury and breathtaking moments at our exclusive beachfront resort
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking">
              <button className="bg-primary text-base px-8 py-4 rounded-full text-lg font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                Explore Our Rooms
              </button>
            </Link>
            <Link href="/about">
              <button className="bg-accent text-base px-8 py-4 rounded-full text-lg font-semibold hover:bg-accent/90 transition-all transform hover:scale-105">
                Learn More
              </button>
            </Link>
          </div>
        </div>
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 animate-bounce">
          <svg className="w-6 h-6 text-neutral/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-24 px-4 bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-5xl font-bold text-neutral mb-6">Your Paradise Awaits</h2>
              <p className="text-lg text-neutral/80 mb-6">
                Nestled along pristine golden shores, our resort offers an unparalleled escape where luxury meets nature. 
                Every moment is designed to create memories that last a lifetime.
              </p>
              <p className="text-lg text-neutral/80 mb-8">
                From sunrise to sunset and beyond, immerse yourself in world-class amenities, exquisite dining, 
                and breathtaking views that redefine coastal living.
              </p>
              <div className="flex gap-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary mb-2">250+</div>
                  <div className="text-sm text-neutral/70">Luxury Rooms</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-secondary mb-2">12</div>
                  <div className="text-sm text-neutral/70">Restaurants</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-accent mb-2">5</div>
                  <div className="text-sm text-neutral/70">Pools</div>
                </div>
              </div>
            </div>
            <div className="relative rounded-3xl h-96 overflow-hidden shadow-2xl">
              <Image 
                src="/website_photo.jpg" 
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
            <h2 className="text-5xl font-bold text-neutral mb-4">World-Class Amenities</h2>
            <p className="text-xl text-neutral/70">Everything you need for an unforgettable stay</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">Luxury Accommodations</h3>
              <p className="text-neutral/70">Elegantly designed rooms and suites with ocean views and premium amenities</p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">Spa & Wellness</h3>
              <p className="text-neutral/70">Rejuvenate your body and mind with our full-service spa and wellness center</p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-accent/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">Fine Dining</h3>
              <p className="text-neutral/70">Savor gourmet cuisine from around the world at our award-winning restaurants</p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-highlight/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">Beach Activities</h3>
              <p className="text-neutral/70">Endless water sports, beach volleyball, and seaside entertainment</p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">Event Spaces</h3>
              <p className="text-neutral/70">Perfect venues for weddings, conferences, and special celebrations</p>
            </div>

            <div className="bg-base p-8 rounded-2xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-neutral mb-3">24/7 Concierge</h3>
              <p className="text-neutral/70">Personal assistance anytime, ensuring your every need is met</p>
            </div>
          </div>
        </div>
      </section>

      {/* Experiences Section */}
      <section id="experiences" className="py-24 px-4 bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-neutral mb-4">Unforgettable Experiences</h2>
            <p className="text-xl text-neutral/70">Create moments that last forever</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="relative h-80 bg-gradient-to-br from-primary/30 to-highlight/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2">Sunset Sailing</h3>
                <p className="text-base/90">Private yacht tours along the coast</p>
              </div>
            </div>
            <div className="relative h-80 bg-gradient-to-br from-secondary/30 to-accent/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2">Culinary Journey</h3>
                <p className="text-base/90">Chef-led cooking classes and tastings</p>
              </div>
            </div>
            <div className="relative h-80 bg-gradient-to-br from-accent/30 to-secondary/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2">Island Adventures</h3>
                <p className="text-base/90">Guided tours and eco-experiences</p>
              </div>
            </div>
            <div className="relative h-80 bg-gradient-to-br from-highlight/30 to-primary/30 rounded-3xl overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-neutral/20 group-hover:bg-neutral/10 transition-colors"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-neutral/90 to-transparent">
                <h3 className="text-3xl font-bold text-base mb-2">Wellness Retreats</h3>
                <p className="text-base/90">Yoga, meditation, and mindfulness</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 bg-gradient-to-r from-primary to-primary/80">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold text-base mb-6">Ready for Your Escape?</h2>
          <p className="text-xl text-base/90 mb-10">Book your dream vacation today and experience paradise like never before</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking">
              <button className="bg-base text-neutral px-10 py-4 rounded-full text-lg font-semibold hover:bg-base/90 transition-all transform hover:scale-105">
                Check Availability
              </button>
            </Link>
            <Link href="/about">
              <button className="bg-accent text-base px-10 py-4 rounded-full text-lg font-semibold hover:bg-accent/90 transition-all transform hover:scale-105">
                Contact Us
              </button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
