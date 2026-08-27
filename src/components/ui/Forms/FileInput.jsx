'use client';

import React, { forwardRef } from 'react';

// ─── UI Kit: File Input ──────────────────────────────────────────────────────
// The invisible half of "attach a file": a hidden native input that a real
// button clicks through a ref.
//
// It has no look, which is exactly why it kept being retyped — four screens
// each wrote `<input type="file" className="hidden" />` next to their own
// trigger, and the audit counted four native controls that no design decision
// could ever reach. The kit owns the pairing instead: the trigger is a kit
// button, and this is what it opens.
/**
 * The invisible half of "attach a file": a hidden native input that a real
 * button clicks through a ref. Everything else — `accept`, `multiple`,
 * `onChange` — reaches the native input.
 *
 * @param {string} props.className Extra classes on the hidden input; it stays hidden regardless.
 */
const FileInput = forwardRef(function FileInput({ className = '', ...props }, ref) {
  return <input ref={ref} type="file" className={`hidden ${className}`.trim()} {...props} />;
});

export default FileInput;
