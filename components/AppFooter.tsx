"use client";

import {
  FAQ_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/app-footer-links";

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <nav className="app-footer__nav" aria-label="Legal and support">
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Privacy Policy
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Terms &amp; Conditions
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={FAQ_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          FAQ
        </a>
        <span className="app-footer__sep" aria-hidden>
          ·
        </span>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer__link"
        >
          Support
        </a>
      </nav>
      <p className="app-footer__note">ArcadeX · Web3 Game Hub</p>
    </footer>
  );
}
