'use client';

// src/lib/utils/exportFile.js — the three ways a document leaves the browser.
//
// The model and every decision about what a file contains live in the pure
// `analyticsExport.mjs`. This file is only the delivery: a blob, a print window
// and a spreadsheet writer. It is deliberately the one place that touches the
// DOM for a download, so a popup blocker or a failed write is reported to the
// person once, in one way, instead of a button that appears to do nothing.

import {
  cellValue,
  exportFileName,
  isFigureColumn,
  toCsv,
  toPrintHtml,
} from '@/lib/utils/analyticsExport.mjs';

/** Hands the browser a file it already has in memory. Nothing is uploaded. */
export function saveTextFile(fileName, text, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking in the same tick cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Opens a complete HTML document in its own window and prints it, which is how
 * a page becomes a PDF without a library: the browser draws the text with the
 * fonts it already has, so Cyrillic needs no font embedded and no dependency.
 *
 * Returns false when a popup blocker refused the window — the caller says so,
 * because from the outside a blocked print is indistinguishable from a dead
 * button.
 */
export function printHtmlDocument(html) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Printing before the styles apply produces an unstyled page, and closing
  // synchronously afterwards cancels the dialog in some browsers. Wait for the
  // load, then let the window close itself once printing is over.
  const startPrinting = () => {
    printWindow.print();
    printWindow.addEventListener('afterprint', () => printWindow.close());
  };
  if (printWindow.document.readyState === 'complete') startPrinting();
  else printWindow.addEventListener('load', startPrinting);
  return true;
}

// ── Spreadsheet ─────────────────────────────────────────────────────────────

const NUMBER_FORMATS = {
  hours: '#,##0.00',
  money: '#,##0.00',
  number: '#,##0',
  percent: '0"%"',
};

// Excel's own limits: a sheet name is at most 31 characters and may not carry
// any of these. A name it rejects fails the whole file, not the tab.
const UNSAFE_IN_SHEET_NAME = /[\\/:*?[\]]/g;

function sheetName(title, index) {
  const name = String(title || `Аркуш ${index + 1}`).replace(UNSAFE_IN_SHEET_NAME, ' ').trim();
  return name.slice(0, 31) || `Аркуш ${index + 1}`;
}

function headerCell(column) {
  return {
    value: column.label,
    fontWeight: 'bold',
    align: isFigureColumn(column) ? 'right' : 'left',
    borderBottomStyle: 'thin',
    borderBottomColor: '#1f1f1f',
  };
}

function bodyCell(column, row, { bold = false } = {}) {
  const value = cellValue(column, row);
  const numeric = isFigureColumn(column) && typeof value === 'number';
  return {
    // A blank cell must be `null`, not an empty string of the wrong type: the
    // writer validates every value against its column type.
    value: value === '' || value === null || value === undefined ? null : value,
    type: numeric ? Number : String,
    ...(numeric ? { format: NUMBER_FORMATS[column.type] } : {}),
    align: isFigureColumn(column) ? 'right' : 'left',
    ...(bold ? { fontWeight: 'bold', borderTopStyle: 'thin', borderTopColor: '#1f1f1f' } : {}),
  };
}

/**
 * The document as a real .xlsx: one sheet per block, so each table keeps its own
 * column widths, and every figure is a number rather than text that looks like
 * one. The library is loaded only here and only on the click, so nobody who
 * never exports pays for it.
 */
export async function saveSpreadsheetFile(document_) {
  // `write-excel-file/browser`, not the bare name: the package publishes no
  // root export, and its node build reaches for `fs`.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const blocks = document_.blocks || [];

  // What the figures were read under gets a sheet of its own rather than three
  // lines above the first table. That keeps every data sheet starting at its
  // header row, which is what lets the header be frozen on all of them — and a
  // total that looks wrong six months later is explained by the tab next to it.
  const parameters = {
    sheet: 'Параметри',
    columns: [{ width: 26 }, { width: 40 }],
    data: [
      [{ value: document_.title, fontWeight: 'bold', fontSize: 14 }],
      [],
      ...(document_.meta || []).map(item => ([
        { value: item.label, color: '#6a6a6a' },
        { value: item.value },
      ])),
    ],
  };

  const sheets = blocks.map((block, index) => ({
    sheet: sheetName(block.title || document_.title, index),
    columns: block.columns.map(column => ({ width: column.width || 18 })),
    // The header stays put while a long timesheet scrolls.
    stickyRowsCount: 1,
    data: [
      block.columns.map(headerCell),
      ...block.rows.map(row => block.columns.map(column => bodyCell(column, row))),
      ...(block.total ? [block.columns.map(column => bodyCell(column, block.total, { bold: true }))] : []),
    ],
  }));

  // Version 4 returns a writer rather than writing: `writeXlsxFile(...)` alone
  // builds nothing and resolves to an object, which is a silent no-op that
  // looks exactly like a working button.
  await writeXlsxFile([parameters, ...sheets]).toFile(exportFileName(document_, 'xlsx'));
}

// ── One entry point per format ──────────────────────────────────────────────

/**
 * @param {'xlsx'|'csv'|'pdf'} format
 * @returns {Promise<'saved'|'blocked'>} `blocked` only ever comes from print.
 */
export async function exportDocument(document_, format) {
  if (format === 'csv') {
    saveTextFile(exportFileName(document_, 'csv'), toCsv(document_), 'text/csv;charset=utf-8');
    return 'saved';
  }
  if (format === 'pdf') {
    return printHtmlDocument(toPrintHtml(document_)) ? 'saved' : 'blocked';
  }
  await saveSpreadsheetFile(document_);
  return 'saved';
}
