"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const slides = [
  {
    src: "/resort-images/resort_img2.jpg",
    alt: "Elegant resort lounge",
    eyebrow: "Welcome to MarVille",
    title: "A brighter way to arrive",
    description:
      "Warm lighting, curated spaces, and a serene atmosphere set the tone for your stay.",
  },
//   {
//     src: "/resort-images/resort_img3.jpg",
//     alt: "Resort dining experience",
//     eyebrow: "Dining Experience",
//     title: "Evenings worth lingering for",
//     description:
//       "From intimate dinners to shared celebrations, every table feels like a special occasion.",
//   },
  {
    src: "/resort-images/resort_img8.jpg",
    alt: "Relaxing resort space",
    eyebrow: "Relax and Unwind",
    title: "Spaces designed to slow time down",
    description:
      "Sink into comfort with resort corners made for calm, conversation, and quiet escapes.",
  },
  {
    src: "/resort-images/resort_img11.jpg",
    alt: "Poolside resort view",
    eyebrow: "Poolside Escape",
    title: "Sunlit moments by the water",
    description:
      "Cool water, open skies, and a view that makes every afternoon feel like a vacation.",
  },
//   {
//     src: "/resort-images/resort_img4.jpg",
//     alt: "Casual resort gathering area",
//     eyebrow: "Community and Comfort",
//     title: "A place to gather naturally",
//     description:
//       "Thoughtful social spaces let guests connect, celebrate, and simply enjoy being here.",
//   },
//   {
//     src: "/resort-images/resort_img9.jpg",
//     alt: "Outdoor resort landscape",
//     eyebrow: "Nature First",
//     title: "Wrapped in greenery and calm",
//     description:
//       "Lush surroundings and soft light bring a sense of balance to the entire resort experience.",
//   },
//   {
//     src: "/resort-images/resort_img10.jpg",
//     alt: "Resort pathway",
//     eyebrow: "A peaceful arrival",
//     title: "Every path leads somewhere beautiful",
//     description:
//       "Walkthrough spaces are crafted to feel inviting, open, and easy to move through.",
//   },
//   {
//     src: "/resort-images/resort_img9.jpg",
//     alt: "Resort architecture",
//     eyebrow: "Refined Design",
//     title: "Details that make the stay memorable",
//     description:
//       "Architectural touches and layered textures help the resort feel both elegant and personal.",
//   },
//   {
//     src: "/resort-images/resort_img10.jpg",
//     alt: "Resort outdoor amenities",
//     eyebrow: "Leisure Time",
//     title: "Room to breathe, space to enjoy",
//     description:
//       "Open-air amenities invite guests to stretch out, relax, and enjoy the property at their pace.",
//   },
//   {
//     src: "/resort-images/resort_img11.jpg",
//     alt: "Resort evening ambiance",
//     eyebrow: "Evening Ambiance",
//     title: "Where the day settles beautifully",
//     description:
//       "Soft night lighting and a calm mood make the resort feel inviting long after sunset.",
//   },
];

export default function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const totalSlides = slides.length;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((currentIndex) => (currentIndex + 1) % totalSlides);
    }, 6000);

    return () => window.clearInterval(timer);
  }, [totalSlides]);

  return (
    <section className="relative min-h-svh overflow-hidden">
      {slides.map((slide, index) => (
        <div
          key={slide.src}
          className={`absolute inset-0 transition-opacity duration-500 ease-out ${
            index === activeIndex ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden={index !== activeIndex}
        >
          <Image
            src={slide.src}
            alt={slide.alt}
            fill
            priority={index === 0}
            className="object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-b from-neutral/35 via-neutral/20 to-neutral/65" />
        </div>
      ))}

      <div className="absolute inset-0 z-10 flex items-center justify-center px-4 pt-20 sm:pt-24">
        <div className="w-full max-w-4xl text-center sm:max-w-5xl">
          <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl md:text-7xl lg:text-8xl mb-5 sm:mb-6">
            Where the sun<br />never sets
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-white/80 sm:mb-10 sm:text-lg md:text-2xl">
            Experience endless luxury and breathtaking moments at our exclusive beachfront resort
          </p>

          <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a href="/booking" className="rounded-full bg-primary px-6 py-3 text-base font-semibold transition-all transform hover:scale-105 hover:bg-primary/90 sm:px-8 sm:py-4 sm:text-lg">
              Explore Our Rooms
            </a>
            <a href="/about" className="rounded-full bg-accent px-6 py-3 text-base font-semibold transition-all transform hover:scale-105 hover:bg-accent/90 sm:px-8 sm:py-4 sm:text-lg">
              Learn More
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
