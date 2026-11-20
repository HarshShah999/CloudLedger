/** Collects a PDFKit document into a Buffer. Call before doc.end(). */
export const pdfToBuffer = (doc: PDFKit.PDFDocument): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
