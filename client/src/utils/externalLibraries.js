const pending = new Map();

function loadScript(key, src, ready) {
  if (ready()) return Promise.resolve();
  if (pending.has(key)) return pending.get(key);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-auditpro-lib="${key}"]`);
    const script = existing || document.createElement('script');
    const done = () => ready() ? resolve() : reject(new Error(`${key} loaded without its global API`));
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load ${key}`)), { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      script.dataset.auditproLib = key;
      document.head.appendChild(script);
    }
  }).catch(error => { pending.delete(key); throw error; });
  pending.set(key, promise);
  return promise;
}

export const loadLucide = () => loadScript('lucide', 'https://unpkg.com/lucide@1.58.0', () => !!window.lucide?.createIcons);
export const loadExcel = () => loadScript('xlsx', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => !!window.XLSX?.utils);
export const loadPdfJs = () => loadScript('pdfjs', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => !!window.pdfjsLib?.getDocument);
export const loadJsPdf = async () => {
  await loadScript('jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF);
  await loadScript('jspdf-autotable', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js', () => !!window.jspdf?.jsPDF?.API?.autoTable);
};
