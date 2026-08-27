'use client';
import { useState, useEffect, useRef } from 'react';

export default function AnimatedLogo({ className = '' }) {
  const containerRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 }); // -1 to 1
  const [isHovered, setIsHovered] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [isAngry, setIsAngry] = useState(false);

  // Mouse tracking
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current || isAngry || isHovered) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;

      const maxDist = 400; // Track within 400px radius
      const nx = Math.max(-1, Math.min(1, dx / maxDist));
      const ny = Math.max(-1, Math.min(1, dy / maxDist));

      setMousePos({ x: nx, y: ny });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isAngry, isHovered]);

  // Click handling
  const handleClick = () => {
    setClicks(c => c + 1);
  };

  useEffect(() => {
    if (clicks >= 3) {
      queueMicrotask(() => setIsAngry(true));
      const timer = setTimeout(() => {
        setClicks(0);
        setIsAngry(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [clicks]);

  // Reset eye position on hover
  const pupilOffsetX = (isAngry || isHovered) ? 0 : mousePos.x * 2.5;
  const pupilOffsetY = (isAngry || isHovered) ? 0 : mousePos.y * 2.5;

  return (
    <div
      ref={containerRef}
      className={`relative select-none transition-transform duration-300 ${isHovered && !isAngry ? 'scale-100 logo-purr cursor-grab active:cursor-grabbing' : 'scale-100 cursor-pointer'} ${isAngry ? 'logo-shake cursor-not-allowed' : ''} ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <style>{`
        @keyframes logo-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px) rotate(-2deg); }
          40% { transform: translateX(4px) rotate(2deg); }
          60% { transform: translateX(-4px) rotate(-2deg); }
          80% { transform: translateX(4px) rotate(2deg); }
        }
        @keyframes logo-purr {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(1) rotate(2deg) translateY(-1.5px); }
          75% { transform: scale(1) rotate(-2deg) translateY(1.5px); }
        }
        @keyframes logo-boil {
          0%, 100% { fill: #fca5a5; } /* light reddish */
          50% { fill: #f87171; }      /* more intense coral red */
        }
        .logo-shake {
          animation: logo-shake 0.3s ease-in-out infinite;
        }
        .logo-purr {
          animation: logo-purr 0.8s ease-in-out infinite;
        }
        .logo-boil {
          animation: logo-boil 0.6s ease-in-out infinite;
        }
      `}</style>

      <svg width="120" height="120" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-2xl">
        <defs>
          <clipPath id="angryLeft">
            <polygon points="0,11.5 16,15.5 16,32 0,32" />
          </clipPath>
          <clipPath id="angryRight">
            <polygon points="16,15.5 32,11.5 32,32 16,32" />
          </clipPath>
        </defs>
        {/* Background Squircle */}
        <path
          d="M0 16C0 8.80395 0 5.20593 2.0716 2.84372C2.31185 2.56977 2.56977 2.31185 2.84372 2.0716C5.20593 0 8.80395 0 16 0C23.196 0 26.7941 0 29.1563 2.0716C29.4302 2.31185 29.6882 2.56977 29.9284 2.84372C32 5.20593 32 8.80395 32 16C32 23.196 32 26.7941 29.9284 29.1563C29.6882 29.4302 29.4302 29.6882 29.1563 29.9284C26.7941 32 23.196 32 16 32C8.80395 32 5.20593 32 2.84372 29.9284C2.56977 29.6882 2.31185 29.4302 2.0716 29.1563C0 26.7941 0 23.196 0 16Z"
          fill="white"
          className={`transition-colors duration-500 ${isAngry ? 'logo-boil' : ''}`}
        />

        {/* Eyes Group */}
        <g className="transition-all duration-200">
          {isAngry ? (
            // Angry Eyes (Clipped normal eyes)
            <g>
              <g clipPath="url(#angryLeft)">
                <path d="M3.2 14.4C3.2 11.3072 5.70721 8.8 8.8 8.8C11.8928 8.8 14.4 11.3072 14.4 14.4V15.2C14.4 18.2928 11.8928 20.8 8.8 20.8C5.70721 20.8 3.2 18.2928 3.2 15.2V14.4Z" fill="#1F1F1F"/>
                <circle cx="10" cy="16.5" r="2.2" fill="#fef08a" />
              </g>
              <g clipPath="url(#angryRight)">
                <path d="M17.6 14.4C17.6 11.3072 20.1072 8.8 23.2 8.8C26.2928 8.8 28.8 11.3072 28.8 14.4V15.2C28.8 18.2928 26.2928 20.8 23.2 20.8C20.1072 20.8 17.6 18.2928 17.6 15.2V14.4Z" fill="#1F1F1F"/>
                <circle cx="22" cy="16.5" r="2.2" fill="#fef08a" />
              </g>
            </g>
          ) : isHovered ? (
            // Smiling Eyes ^_^
            <g stroke="#1F1F1F" strokeWidth="2.5" strokeLinecap="round" fill="none">
              <path d="M 5 16 Q 8.8 11 12.6 16" />
              <path d="M 19.4 16 Q 23.2 11 27 16" />
            </g>
          ) : (
            // Normal Eyes
            <g>
              <path d="M3.2 14.4C3.2 11.3072 5.70721 8.8 8.8 8.8C11.8928 8.8 14.4 11.3072 14.4 14.4V15.2C14.4 18.2928 11.8928 20.8 8.8 20.8C5.70721 20.8 3.2 18.2928 3.2 15.2V14.4Z" fill="#1F1F1F"/>
              <path d="M17.6 14.4C17.6 11.3072 20.1072 8.8 23.2 8.8C26.2928 8.8 28.8 11.3072 28.8 14.4V15.2C28.8 18.2928 26.2928 20.8 23.2 20.8C20.1072 20.8 17.6 18.2928 17.6 15.2V14.4Z" fill="#1F1F1F"/>

              {/* Pupils with translation */}
              <circle
                cx="10.2" cy="13.4" r="3" fill="white"
                style={{ transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)` }}
                className="transition-transform duration-[50ms] ease-out origin-center"
              />
              <circle
                cx="24.6" cy="13.4" r="3" fill="white"
                style={{ transform: `translate(${pupilOffsetX}px, ${pupilOffsetY}px)` }}
                className="transition-transform duration-[50ms] ease-out origin-center"
              />
            </g>
          )}
        </g>

        {/* Anime Popping Vein (Angry mark) */}
        {isAngry && (
          <g transform="translate(23, 2.5) scale(0.35)" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" fill="none" className="animate-pulse">
            <path d="M5,5 Q10,10 15,5" />
            <path d="M15,5 Q10,10 15,15" />
            <path d="M15,15 Q10,10 5,15" />
            <path d="M5,15 Q10,10 5,5" />
          </g>
        )}
      </svg>

      {/* Click counter tooltip */}
      {!isAngry && clicks > 0 && clicks < 3 && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[12px] font-bold text-white/50 bg-black/20 px-3 py-1 rounded-full backdrop-blur-md opacity-0 animate-in fade-in slide-in-from-top-2 duration-300">
          Тиць... ({clicks}/3)
        </div>
      )}
    </div>
  );
}
