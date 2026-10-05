'use client';

/**
 * Prints server-rendered document HTML (receipt / invoice / quote) without leaving the page: the HTML goes into a hidden
 * iframe and the browser's print dialog is opened for it. The server already HTML-escaped every value; the iframe is
 * sandboxed anyway (scripts disabled) so a document can never run code.
 */
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  frame.onload = () => {
    const win = frame.contentWindow;
    win?.focus();
    win?.print();
    setTimeout(() => frame.remove(), 60_000); // keep it until the print dialog is done
  };
  frame.srcdoc = html;
}
