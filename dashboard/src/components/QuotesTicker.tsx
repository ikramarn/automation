"use client";

import { useEffect, useState } from "react";

const QUOTES = [
  { text: "Automation is not about replacing humans — it's about freeing them.", author: "Unknown" },
  { text: "The best time to automate was yesterday. The second best time is now.", author: "AutomateSocials" },
  { text: "Work smarter, not harder. Let the machines do the repeating.", author: "Unknown" },
  { text: "Your content should work for you 24/7, even while you sleep.", author: "AutomateSocials" },
  { text: "Consistency is the key to growth. Automation is the key to consistency.", author: "Unknown" },
  { text: "Don't just post content — deploy it at scale.", author: "AutomateSocials" },
  { text: "The future belongs to those who automate the present.", author: "Unknown" },
  { text: "Every minute spent automating saves an hour of manual work.", author: "AutomateSocials" },
];

export default function QuotesTicker({ vertical = false }: { vertical?: boolean }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % QUOTES.length);
        setVisible(true);
      }, 600);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const quote = QUOTES[index];

  if (vertical) {
    return (
      <div
        className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        <div className="mb-3 flex justify-center">
          <svg className="h-8 w-8 text-indigo-200 opacity-60" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
          </svg>
        </div>
        <p className="text-center text-sm font-medium text-indigo-100 leading-relaxed italic px-2">
          "{quote?.text}"
        </p>
        <p className="mt-2 text-center text-xs text-indigo-300">— {quote?.author}</p>

        {/* Dots indicator */}
        <div className="mt-4 flex justify-center gap-1.5">
          {QUOTES.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === index ? "h-1.5 w-4 bg-indigo-300" : "h-1.5 w-1.5 bg-indigo-600"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"}`}
    >
      <p className="text-sm font-medium text-gray-500 leading-relaxed italic">
        "{quote?.text}"
      </p>
      <p className="mt-1 text-xs text-gray-400">— {quote?.author}</p>
    </div>
  );
}
