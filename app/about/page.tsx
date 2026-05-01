import Image from "next/image";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function About() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Hero Section */}
      <section className="relative h-96 flex items-center justify-center overflow-hidden mt-20">
        <Image 
          src="/website_cover.jpg" 
          alt="About Resort" 
          fill 
          className="object-cover brightness-75" 
          priority
        />
        <div className="absolute inset-0 bg-neutral/40"></div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-6xl font-bold text-base mb-4">About Us</h1>
          <p className="text-xl text-base/90">Discover the story behind paradise</p>
        </div>
      </section>

      {/* History Section */}
      <section className="py-20 px-4 bg-base">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
            <div>
              <h2 className="text-4xl font-bold text-neutral mb-6">Our Story</h2>
              <p className="text-lg text-neutral/80 mb-4">
                Since 1995, MarVille Resort has been a beacon of luxury and tranquility on the pristine shores of Paradise Beach. 
                What began as a vision to create an unparalleled coastal escape has blossomed into one of the most sought-after 
                destinations in the region.
              </p>
              <p className="text-lg text-neutral/80 mb-4">
                Our founders believed that true hospitality comes from the heart. This philosophy continues to guide us today 
                as we welcome guests from around the world to experience the perfect blend of natural beauty, world-class 
                amenities, and genuine warmth.
              </p>
              <p className="text-lg text-neutral/80">
                Over three decades, we've maintained our commitment to excellence while expanding our offerings to include 
                luxury accommodations, fine dining experiences, rejuvenating spa services, and countless memorable activities.
              </p>
            </div>
            <div className="relative h-96 rounded-3xl overflow-hidden shadow-2xl">
              <Image 
                src="/website_photo.jpg" 
                alt="Resort History" 
                fill 
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Location Section */}
      <section className="py-20 px-4 bg-neutral/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-neutral mb-12 text-center">Find Us</h2>
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-2xl font-bold text-primary mb-4">Location</h3>
              <p className="text-lg text-neutral/80 mb-6">
                Nestled along the golden shores of Paradise Beach, our resort offers easy access to both natural wonders 
                and local attractions. Just minutes from the airport yet worlds away from the everyday.
              </p>
              <div className="space-y-4">
                <div className="flex items-start">
                  <svg className="w-6 h-6 text-primary mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-neutral">Address</p>
                    <p className="text-neutral/70">Cabrera Road (Hilltop)<br/>Hapay na Mangga, Taytay<br/>Philippines, 1920</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <svg className="w-6 h-6 text-primary mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-neutral">Phone</p>
                    <p className="text-neutral/70">+1 (555) 123-4567<br/>+1 (555) 123-4568</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <svg className="w-6 h-6 text-primary mr-3 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-neutral">Email</p>
                    <p className="text-neutral/70">info@marvilleresort.com<br/>reservations@marvilleresort.com</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-neutral/10 rounded-2xl h-96 overflow-hidden">
              <iframe
              src="https://www.google.com/maps?q=MarVille+Resort+Taytay+Rizal&output=embed"
              title="MarVille Resort Location"
              className="w-full h-full border-0"
              loading="lazy"
            ></iframe>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-20 px-4 bg-base">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-neutral mb-12 text-center">Get In Touch</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-base border-2 border-neutral/10 p-8 rounded-2xl text-center hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral mb-2">Call Us</h3>
              <p className="text-neutral/70 mb-2">Available 24/7</p>
              <p className="text-primary font-semibold">+1 (555) 123-4567</p>
            </div>

            <div className="bg-base border-2 border-neutral/10 p-8 rounded-2xl text-center hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral mb-2">Email Us</h3>
              <p className="text-neutral/70 mb-2">Typical response in 24hrs</p>
              <p className="text-secondary font-semibold">info@marvilleresort.com</p>
            </div>

            <div className="bg-base border-2 border-neutral/10 p-8 rounded-2xl text-center hover:border-primary/50 transition-colors">
              <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral mb-2">Live Chat</h3>
              <p className="text-neutral/70 mb-2">Chat with our team</p>
              <p className="text-accent font-semibold">Start Chat</p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Media Section */}
      <section className="py-20 px-4 bg-neutral/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-neutral mb-6">Follow Our Journey</h2>
          <p className="text-lg text-neutral/70 mb-10">Stay connected with us on social media for updates, special offers, and glimpses of paradise</p>
          <div className="flex justify-center gap-6 flex-wrap">
            <a href="https://facebook.com/marvilleresort" target="_blank" rel="noopener noreferrer" 
               className="flex items-center gap-3 bg-base border-2 border-neutral/10 px-8 py-4 rounded-full hover:border-primary hover:bg-primary/5 transition-all">
              <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              <span className="font-semibold text-neutral">Facebook</span>
            </a>
            
            <a href="https://instagram.com/marvilleresort" target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-3 bg-base border-2 border-neutral/10 px-8 py-4 rounded-full hover:border-secondary hover:bg-secondary/5 transition-all">
              <svg className="w-6 h-6 text-secondary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              <span className="font-semibold text-neutral">Instagram</span>
            </a>

            <a href="https://tiktok.com/@marvilleresort" target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-3 bg-base border-2 border-neutral/10 px-8 py-4 rounded-full hover:border-accent hover:bg-accent/5 transition-all">
              <svg className="w-6 h-6 text-accent" fill="currentColor" viewBox="0 0 24 24">
               <path d="M12.75 2c.414 2.89 2.77 5.182 5.75 5.422v2.718c-1.664-.05-3.245-.548-4.5-1.403v6.608c0 3.36-2.728 6.089-6.089 6.089S1.822 18.705 1.822 15.345 4.55 9.256 7.911 9.256c.36 0 .712.032 1.053.093v2.87a3.215 3.215 0 00-1.053-.178c-1.778 0-3.22 1.442-3.22 3.22s1.442 3.22 3.22 3.22 3.22-1.442 3.22-3.22V2h1.619z"/>
              </svg>
              <span className="font-semibold text-neutral">TikTok</span>
            </a>

          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-linear-to-r from-primary to-primary/80">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-base mb-6">Ready to Experience Paradise?</h2>
          <p className="text-xl text-base/90 mb-10">Book your stay with us and create memories that last a lifetime</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking">
              <button className="bg-base text-neutral px-10 py-4 rounded-full text-lg font-semibold hover:bg-base/90 transition-all transform hover:scale-105">
                Book Your Stay
              </button>
            </Link>
            <Link href="/ocular">
              <button className="bg-accent text-base px-10 py-4 rounded-full text-lg font-semibold hover:bg-accent/90 transition-all transform hover:scale-105">
                Schedule Visit
              </button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
