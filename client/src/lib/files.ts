import api from '../api/axios';

/** Downloads an authenticated API file (PDF/Excel) as a Blob. */
export const fetchBlob = async (url: string, params?: Record<string, unknown>) => {
    const res = await api.get(url, { params, responseType: 'blob' });
    return res.data as Blob;
};

/** Saves a Blob to the user's device. */
export const saveBlob = (blob: Blob, fileName: string) => {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
};

/** Opens the browser print dialog for a PDF Blob using a hidden iframe. */
export const printBlob = (blob: Blob) => {
    const href = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = href;
    frame.onload = () => {
        try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
        } catch {
            // Some mobile browsers cannot print from an iframe: open the PDF instead
            window.open(href, '_blank');
        }
    };
    document.body.appendChild(frame);
    setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(href);
    }, 60_000);
};

/** True when the device can share files (Android Chrome, iOS Safari, some desktop browsers). */
export const canShareFiles = () => {
    try {
        const probe = new File([new Blob(['x'], { type: 'application/pdf' })], 'x.pdf', { type: 'application/pdf' });
        return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
    } catch {
        return false;
    }
};
