"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import UserMenu from "./UserMenu";

export default function Navigation() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <nav className="fixed top-0 w-full bg-base/95 backdrop-blur-sm z-50 border-b border-neutral/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <Link href="/" className="flex items-center" onClick={closeMenu}>
            <Image src="/website_logo_transparent.png" alt="MarVille Resort Complex Logo" width={180} height={60} className="object-contain" priority />
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex space-x-8">
            <Link href="/about" className="text-neutral hover:text-primary transition-colors">About</Link>
            <Link href="/booking" className="text-neutral hover:text-primary transition-colors">Book Now</Link>
            <Link href="/manage" className="text-neutral hover:text-primary transition-colors">Manage Booking</Link>
            <Link href="/reviews" className="text-neutral hover:text-primary transition-colors">Reviews</Link>
          </div>
          
          {/* Desktop User Menu / Auth */}
          <div className="hidden md:block">
            <UserMenu />
          </div>

          {/* Mobile Hamburger Menu */}
          <button
            onClick={toggleMenu}
            className="md:hidden text-neutral p-2 hover:bg-neutral/10 rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              // Close Icon
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              // Hamburger Icon
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMenuOpen && (
          <div className="md:hidden pb-6 pt-2 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <Link 
              href="/about" 
              className="block text-neutral hover:text-primary hover:bg-primary/5 px-4 py-3 rounded-lg transition-colors"
              onClick={closeMenu}
            >
              About
            </Link>
            <Link 
              href="/booking" 
              className="block text-neutral hover:text-primary hover:bg-primary/5 px-4 py-3 rounded-lg transition-colors"
              onClick={closeMenu}
            >
              Book Now
            </Link>
            <Link 
              href="/manage" 
              className="block text-neutral hover:text-primary hover:bg-primary/5 px-4 py-3 rounded-lg transition-colors"
              onClick={closeMenu}
            >
              Manage Booking
            </Link>
            <Link 
              href="/reviews" 
              className="block text-neutral hover:text-primary hover:bg-primary/5 px-4 py-3 rounded-lg transition-colors"
              onClick={closeMenu}
            >
              Reviews
            </Link>
            <div className="px-4 pt-2 border-t border-neutral/10">
              <UserMenu />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
