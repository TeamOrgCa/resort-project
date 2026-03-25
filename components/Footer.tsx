import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer id="contact" className="bg-neutral text-base py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-12 mb-12">
          <div>
            <h3 className="text-2xl font-bold mb-4 text-base">MarVille Resort Complex</h3>
            <p className="text-base/70 mb-4">Where the sun never sets</p>
            <p className="text-base/70">Creating unforgettable memories since 1995</p>
          </div>
          <div>
            <h4 className="font-bold mb-4 text-highlight">Quick Links</h4>
            <ul className="space-y-2 text-base/70">
              <li><Link href="/" className="hover:text-highlight transition-colors">Home</Link></li>
              <li><Link href="/about" className="hover:text-highlight transition-colors">About Us</Link></li>
              <li><Link href="/booking" className="hover:text-highlight transition-colors">Book Now</Link></li>
              <li><Link href="/manage" className="hover:text-highlight transition-colors">Manage Booking</Link></li>
              <li><Link href="/reviews" className="hover:text-highlight transition-colors">Reviews</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-4 text-highlight">Contact</h4>
            <ul className="space-y-2 text-base/70">
              <li>Cabrera Road (Hilltop)</li>
              <li>Hapay na Mangga, Taytay</li>
              <li>Philippines, 1920</li>
              <li className="pt-2">Phone: +63 (555) 123-4567</li>
              <li>Email: marville@resort.com</li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-4 text-highlight">Follow Us</h4>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 bg-base/20 rounded-full flex items-center justify-center hover:bg-highlight/30 transition-colors">
                <span className="text-base">f</span>
              </a>
              <a href="#" className="w-10 h-10 bg-base/20 rounded-full flex items-center justify-center hover:bg-highlight/30 transition-colors">
                <span className="text-base">t</span>
              </a>
              <a href="#" className="w-10 h-10 bg-base/20 rounded-full flex items-center justify-center hover:bg-highlight/30 transition-colors">
                <span className="text-base">i</span>
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-base/20 pt-8 text-center text-base/60">
          <p>&copy; 2026 MarVille Resort Complex. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
