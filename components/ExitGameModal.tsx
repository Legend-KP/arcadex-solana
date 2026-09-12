"use client";

import { createPortal } from "react-dom";

interface ExitGameModalProps {
  open: boolean;
  onCancel: () => void;
  onExit: () => void;
  onPlayMore: () => void;
}

export default function ExitGameModal({
  open,
  onCancel,
  onExit,
  onPlayMore,
}: ExitGameModalProps) {
  if (!open) return null;

  const modal = (
    <div className="exit-modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="exit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="exit-modal-title" className="exit-modal-title">
          Exit game?
        </h2>
        <p className="exit-modal-body">
          Are you sure that you want to exit the game?           
          .
        </p>
        <div className="exit-modal-actions">
          <button
            type="button"
            className="exit-modal-btn exit-modal-btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="exit-modal-btn exit-modal-btn--exit"
            onClick={onExit}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
