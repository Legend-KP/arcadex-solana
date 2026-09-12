"use client";

import Logo from "@/components/Logo";

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = "Loading games" }: LoadingScreenProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      <header className="loading-screen__header">
        <Logo variant="loading" />
      </header>

      <div className="loading-screen__center">
        <div className="loading-screen__ring" aria-hidden="true" />
        <div className="loading-screen__ring loading-screen__ring--inner" aria-hidden="true" />

        <div className="loading-screen__content">
          <p className="loading-screen__text">
            {message}
            <span className="loading-screen__dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>

          <div className="loading-screen__bar-track" aria-hidden="true">
            <div className="loading-screen__bar-fill" />
          </div>
        </div>
      </div>
    </div>
  );
}
